-- =============================================================================
-- Invarianti del dominio offerte: ogni caso prova a violarne uno
-- =============================================================================
-- Non sono unit test: sono tentativi di rompere le regole che il database deve
-- imporre da sé, scritti dopo che due review adversariali hanno dimostrato che
-- leggere il codice non basta. Metà di questi casi è nata da un buco vero.
--
-- Come si lancia (sullo STAGING, mai in produzione):
--
--   PAT=$(security find-generic-password -s "supabase-pat-timetrap" -a "$USER" -w)
--   curl -sS -X POST "https://api.supabase.com/v1/projects/jtbgvidwvgwrayqhlzvw/database/query" \
--     -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
--     --data "$(python3 -c "import json;print(json.dumps({'query':open('supabase/tests/invarianti-offerte.sql').read()}))")"
--
-- Ogni riga del risultato dice cosa si è tentato, cosa ci si aspettava e cosa è
-- successo. Un `esito` diverso da respinto, ok o zero righe è un difetto.
--
-- Avvertenza pagata sul campo: un'operazione che non solleva errore non è
-- necessariamente riuscita. La RLS filtra a zero righe in silenzio, quindi dove
-- conta si verifica l'effetto sui dati, non l'assenza di eccezione.
--
-- Tutto gira in una transazione con ROLLBACK finale: lo staging resta pulito.
-- =============================================================================
BEGIN;

CREATE TEMP TABLE _res(n text, atteso text, esito text, dettaglio text) ON COMMIT DROP;

-- Scenario: offerta 2026/2, versione inviata, con un link attivo.
CREATE TEMP TABLE _fix ON COMMIT DROP AS
SELECT o.id AS offer_id,
       o.current_version_id AS version_id,
       d.snapshot_hash AS hash
  FROM public.offers o
  JOIN public.offer_version_documents d ON d.offer_version_id = o.current_version_id
 WHERE o.number = 2 AND o.year = 2026;

INSERT INTO public.offer_public_links (offer_id, token, expires_at)
SELECT offer_id, 'tokvalido' || encode(extensions.gen_random_bytes(24), 'hex'), NULL FROM _fix;

CREATE TEMP TABLE _tok ON COMMIT DROP AS
SELECT l.token, l.id AS link_id FROM public.offer_public_links l JOIN _fix f ON f.offer_id = l.offer_id
 WHERE l.revoked_at IS NULL;

DO $outer$
DECLARE
  _uid uuid := '22222222-2222-4222-8222-222222222222'; -- account approvato
  _unapproved uuid := '99999999-9999-4999-8999-999999999999';
  _version uuid;
  _offer uuid;
  _hash text;
  _token text;
  _link uuid;
  _other_version uuid;
  _tmp jsonb;
BEGIN
  SELECT version_id, offer_id, hash INTO _version, _offer, _hash FROM _fix;
  SELECT token, link_id INTO _token, _link FROM _tok;

  -- ===== gruppo A: quello che un utente autenticato non deve poter fare =====

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('UPDATE public.offer_versions SET status = ''accettata'' WHERE id = %L', _version);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T01 update diretto dello stato', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T01 update diretto dello stato', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('INSERT INTO public.offer_version_documents (offer_version_id, snapshot, snapshot_hash) VALUES (%L, ''{}''::jsonb, ''finto'')', _version);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T02 insert di un documento falso', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T02 insert di un documento falso', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('UPDATE public.offer_version_documents SET snapshot = ''{"manomesso":true}''::jsonb WHERE offer_version_id = %L', _version);
    EXECUTE 'RESET ROLE';
    -- Non basta che l'istruzione non sollevi errore: la RLS può filtrarla a
    -- zero righe in silenzio. Quello che conta è se il dato è cambiato.
    INSERT INTO _res
    SELECT 'T03 manomissione dello snapshot', 'respinto',
           CASE WHEN snapshot ? 'manomesso' THEN 'PASSATO' ELSE 'senza effetto' END,
           'snapshot integro: ' || (NOT (snapshot ? 'manomesso'))::text
      FROM public.offer_version_documents WHERE offer_version_id = _version;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T03 manomissione dello snapshot', 'respinto', 'respinto', SQLERRM);
  END;

  -- Stessa manomissione ma da superuser, senza il flag: deve fermarla il trigger.
  BEGIN
    EXECUTE format('UPDATE public.offer_version_documents SET snapshot = ''{"manomesso":true}''::jsonb WHERE offer_version_id = %L', _version);
    INSERT INTO _res VALUES ('T04 manomissione da superuser senza flag', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _res VALUES ('T04 manomissione da superuser senza flag', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.resolve_offer_public_link(%L, NULL, NULL)', _token);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T05 resolve chiamata da authenticated', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T05 resolve chiamata da authenticated', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.record_offer_client_decision(%L, ''accettata'', ''Finto Firmatario'', %L, NULL, NULL, NULL, NULL, ''signatures/x.png'', NULL)', _token, _hash);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T06 firma falsificata da authenticated', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T06 firma falsificata da authenticated', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.freeze_offer_version_document(%L)', _version);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T07 rigenerazione dello snapshot da authenticated', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T07 rigenerazione dello snapshot da authenticated', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.notify_user_if_enabled(%L, ''offer_signed'', ''Falso'', ''Falso'', NULL)', _uid);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T08 notifica arbitraria da authenticated', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T08 notifica arbitraria da authenticated', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('UPDATE public.offers SET current_version_id = %L WHERE id = %L', _version, _offer);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T09 spostamento del puntatore da authenticated', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T09 spostamento del puntatore da authenticated', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('INSERT INTO public.offer_public_link_accesses (public_link_id, outcome) VALUES (%L, ''ok'')', _link);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res
    SELECT 'T10 accesso inventato da authenticated', 'respinto',
           CASE WHEN count(*) > 0 THEN 'PASSATO' ELSE 'senza effetto' END,
           count(*) || ' accessi finti scritti'
      FROM public.offer_public_link_accesses WHERE public_link_id = _link;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T10 cancellazione della traccia degli accessi', 'respinto', 'respinto', SQLERRM);
  END;

  -- ===== gruppo B: quello che nemmeno il service role deve poter fare =====

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.record_offer_client_decision(%L, ''accettata'', ''Mario Rossi'', ''hash-sbagliato'', ''1.2.3.4''::inet, ''test'', NULL, NULL, ''signatures/x.png'', NULL)', _token);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T11 firma su documento diverso da quello visto', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T11 firma su documento diverso da quello visto', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.record_offer_client_decision(%L, ''accettata'', ''Mario Rossi'', %L, ''1.2.3.4''::inet, ''test'', NULL, NULL, NULL, NULL)', _token, _hash);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T12 accettazione senza firma', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T12 accettazione senza firma', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.record_offer_client_decision(''token-inesistente'', ''accettata'', ''Mario Rossi'', %L, ''1.2.3.4''::inet, ''test'', NULL, NULL, ''signatures/x.png'', NULL)', _hash);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T13 firma con token inventato', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T13 firma con token inventato', 'respinto', 'respinto', SQLERRM);
  END;

  -- Versione non corrente: la corrente viene spostata su un'altra versione
  -- della stessa offerta, poi si prova ad accettare quella vecchia.
  SELECT id INTO _other_version FROM public.offer_versions WHERE offer_id = _offer AND id <> _version LIMIT 1;
  IF _other_version IS NULL THEN
    INSERT INTO public.offer_versions (offer_id, status, list_total, offered_total)
    VALUES (_offer, 'bozza', 0, 0) RETURNING id INTO _other_version;
  END IF;

  BEGIN
    UPDATE public.offers SET current_version_id = _other_version WHERE id = _offer;
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.set_offer_version_status(%L, ''accettata'', ''firmata'', ''client'', NULL, %L, ''1.2.3.4''::inet, NULL)', _version, _token);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T14 accettazione di una versione non corrente', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T14 accettazione di una versione non corrente', 'respinto', 'respinto', SQLERRM);
  END;
  UPDATE public.offers SET current_version_id = _version WHERE id = _offer;

  BEGIN
    UPDATE public.offer_public_links SET revoked_at = now() WHERE id = _link;
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.record_offer_client_decision(%L, ''accettata'', ''Mario Rossi'', %L, ''1.2.3.4''::inet, ''test'', NULL, NULL, ''signatures/x.png'', NULL)', _token, _hash);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T15 firma con link revocato', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T15 firma con link revocato', 'respinto', 'respinto', SQLERRM);
  END;
  UPDATE public.offer_public_links SET revoked_at = NULL WHERE id = _link;

  BEGIN
    UPDATE public.offer_public_links SET expires_at = now() - interval '1 day' WHERE id = _link;
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.record_offer_client_decision(%L, ''accettata'', ''Mario Rossi'', %L, ''1.2.3.4''::inet, ''test'', NULL, NULL, ''signatures/x.png'', NULL)', _token, _hash);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T16 firma con link scaduto', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T16 firma con link scaduto', 'respinto', 'respinto', SQLERRM);
  END;
  UPDATE public.offer_public_links SET expires_at = NULL WHERE id = _link;

  -- ===== gruppo C: il percorso felice deve funzionare davvero =====

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.resolve_offer_public_link(%L, ''8.8.8.8''::inet, ''Mozilla test'')', _token) INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T17 apertura del link dal cliente', 'ok',
      CASE WHEN _tmp->>'outcome' = 'ok' AND (_tmp->>'signable')::boolean THEN 'ok' ELSE 'FALLITO' END,
      format('outcome=%s status=%s signable=%s', _tmp->>'outcome', _tmp->>'status', _tmp->>'signable'));
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T17 apertura del link dal cliente', 'ok', 'FALLITO', SQLERRM);
  END;

  INSERT INTO _res
  SELECT 'T18 la prima apertura porta a vista', 'ok',
         CASE WHEN status = 'vista' THEN 'ok' ELSE 'FALLITO' END, 'stato: ' || status
    FROM public.offer_versions WHERE id = _version;

  INSERT INTO _res
  SELECT 'T19 l''accesso è registrato', 'ok',
         CASE WHEN count(*) >= 1 THEN 'ok' ELSE 'FALLITO' END, count(*) || ' accessi'
    FROM public.offer_public_link_accesses WHERE public_link_id = _link;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.record_offer_client_decision(%L, ''accettata'', ''  Mario Rossi  '', %L, ''8.8.8.8''::inet, ''Mozilla test'', ''Amministratore delegato'', ''mario@example.com'', ''signatures/test/x.png'', NULL)', _token, _hash) INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T20 accettazione con firma', 'ok', 'ok', 'firma ' || (_tmp->>'signature_id'));
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T20 accettazione con firma', 'ok', 'FALLITO', SQLERRM);
  END;

  INSERT INTO _res
  SELECT 'T21 lo stato diventa accettata', 'ok',
         CASE WHEN status = 'accettata' THEN 'ok' ELSE 'FALLITO' END, 'stato: ' || status
    FROM public.offer_versions WHERE id = _version;

  INSERT INTO _res
  SELECT 'T22 l''evento firmata è nel registro', 'ok',
         CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FALLITO' END, count(*) || ' eventi firmata'
    FROM public.offer_events WHERE offer_version_id = _version AND event_type = 'firmata';

  INSERT INTO _res
  SELECT 'T23 il nome del firmatario è ripulito', 'ok',
         CASE WHEN signer_name = 'Mario Rossi' THEN 'ok' ELSE 'FALLITO' END, '[' || signer_name || ']'
    FROM public.offer_signatures WHERE offer_version_id = _version;

  INSERT INTO _res
  SELECT 'T24 la notifica di firma è partita', 'ok',
         CASE WHEN count(*) >= 1 THEN 'ok' ELSE 'FALLITO' END, count(*) || ' notifiche offer_signed'
    FROM public.notifications WHERE type = 'offer_signed';

  -- Doppia accettazione: il secondo tentativo trova lo stato già cambiato.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.record_offer_client_decision(%L, ''accettata'', ''Mario Rossi'', %L, ''8.8.8.8''::inet, ''test'', NULL, NULL, ''signatures/test/y.png'', NULL)', _token, _hash);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T25 doppia accettazione', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T25 doppia accettazione', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('DELETE FROM public.offer_signatures WHERE offer_version_id = %L', _version);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res
    SELECT 'T26 cancellazione di una firma', 'respinto',
           CASE WHEN count(*) = 0 THEN 'PASSATO' ELSE 'senza effetto' END,
           count(*) || ' firme ancora presenti'
      FROM public.offer_signatures WHERE offer_version_id = _version;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T26 cancellazione di una firma', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE format('UPDATE public.offer_signatures SET signer_name = ''Altro Nome'' WHERE offer_version_id = %L', _version);
    INSERT INTO _res VALUES ('T27 modifica del nome del firmatario da superuser', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _res VALUES ('T27 modifica del nome del firmatario da superuser', 'respinto', 'respinto', SQLERRM);
  END;

  -- Due link vivi sulla stessa offerta.
  BEGIN
    INSERT INTO public.offer_public_links (offer_id, token) VALUES (_offer, 'secondotoken' || encode(extensions.gen_random_bytes(24), 'hex'));
    INSERT INTO _res VALUES ('T28 due link attivi sulla stessa offerta', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _res VALUES ('T28 due link attivi sulla stessa offerta', 'respinto', 'respinto', SQLERRM);
  END;

  -- Puntatore verso la versione di un'altra offerta.
  BEGIN
    UPDATE public.offers SET current_version_id = (
      SELECT id FROM public.offer_versions WHERE offer_id <> _offer LIMIT 1
    ) WHERE id = _offer;
    INSERT INTO _res VALUES ('T29 puntatore alla versione di un''altra offerta', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _res VALUES ('T29 puntatore alla versione di un''altra offerta', 'respinto', 'respinto', SQLERRM);
  END;

  -- Lettura da anon.
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SELECT count(*) FROM public.offer_signatures' INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T30 lettura delle firme da anon', 'respinto o zero righe',
      CASE WHEN _tmp::text = '0' THEN 'zero righe' ELSE 'PASSATO' END, 'righe viste: ' || _tmp::text);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T30 lettura delle firme da anon', 'respinto o zero righe', 'respinto', SQLERRM);
  END;

  -- Lettura da utente autenticato ma non approvato.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _unapproved, 'role', 'authenticated')::text, true);
    EXECUTE 'SELECT count(*) FROM public.offer_version_documents' INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T31 lettura dei documenti da utente non approvato', 'zero righe',
      CASE WHEN _tmp::text = '0' THEN 'zero righe' ELSE 'PASSATO' END, 'righe viste: ' || _tmp::text);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T31 lettura dei documenti da utente non approvato', 'zero righe', 'respinto', SQLERRM);
  END;

  -- Apertura di un link revocato: deve dire 'revocato' e restare tracciata.
  BEGIN
    UPDATE public.offer_public_links SET revoked_at = now() WHERE id = _link;
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.resolve_offer_public_link(%L, ''9.9.9.9''::inet, ''test'')', _token) INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T32 apertura di un link revocato', 'outcome revocato',
      CASE WHEN _tmp->>'outcome' = 'revocato' THEN 'ok' ELSE 'FALLITO' END, _tmp::text);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T32 apertura di un link revocato', 'outcome revocato', 'FALLITO', SQLERRM);
  END;
  -- ===== gruppo D: i buchi chiusi dalla review adversariale =====

  -- Un utente interno non può fabbricare l'accettazione del cliente.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.set_offer_version_status(%L, ''accettata'', ''firmata'', ''user'', %L, NULL, NULL, ''firmata da Falso Firmatario'')', _other_version, _uid);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T33 accettazione fabbricata da un utente interno', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T33 accettazione fabbricata da un utente interno', 'respinto', 'respinto', SQLERRM);
  END;

  -- Né il rifiuto: sabotare una trattativa altrui deve essere impossibile.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.set_offer_version_status(%L, ''rifiutata'', ''rifiutata'', ''user'', %L, NULL, NULL, NULL)', _other_version, _uid);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T34 rifiuto fabbricato da un utente interno', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T34 rifiuto fabbricato da un utente interno', 'respinto', 'respinto', SQLERRM);
  END;

  -- Né l'apertura: "vista" è una traccia del cliente, non una nostra dichiarazione.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.set_offer_version_status(%L, ''vista'', ''vista'', ''user'', %L, NULL, NULL, NULL)', _other_version, _uid);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T35 apertura fabbricata da un utente interno', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T35 apertura fabbricata da un utente interno', 'respinto', 'respinto', SQLERRM);
  END;

  -- Nemmeno il service role può marcare "scaduta" fingendosi un utente.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.set_offer_version_status(%L, ''scaduta'', ''scaduta'', ''client'', NULL, %L, ''1.2.3.4''::inet, NULL)', _other_version, _token);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T36 scadenza attribuita al cliente', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T36 scadenza attribuita al cliente', 'respinto', 'respinto', SQLERRM);
  END;

  -- Il documento non si legge scavalcando la RLS con la funzione di snapshot.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _unapproved, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.build_offer_version_snapshot(%L)', _version) INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T37 documento letto da utente non approvato', 'respinto', 'PASSATO', _tmp->'client'->>'name');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T37 documento letto da utente non approvato', 'respinto', 'respinto', SQLERRM);
  END;

  -- Il token è una credenziale: chi non fa commerciale non deve vederlo.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
    EXECUTE 'SELECT count(*) FROM public.offer_public_links' INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T38 token letto da un ruolo non commerciale', 'zero righe',
      CASE WHEN _tmp::text = '0' THEN 'zero righe' ELSE 'PASSATO' END, 'token visti: ' || _tmp::text);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T38 token letto da un ruolo non commerciale', 'zero righe', 'respinto', SQLERRM);
  END;

  -- Controprova: chi fa commerciale deve continuare a vederlo, altrimenti la
  -- stretta ha rotto il pannello invece di proteggerlo.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    EXECUTE 'SELECT count(*) FROM public.offer_public_links' INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T39 token letto da chi gestisce le offerte', 'almeno uno',
      CASE WHEN _tmp::text <> '0' THEN 'ok' ELSE 'FALLITO' END, 'token visti: ' || _tmp::text);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T39 token letto da chi gestisce le offerte', 'almeno uno', 'FALLITO', SQLERRM);
  END;
  -- ===== gruppo E: quello che protegge la prova di firma =====

  -- Il contratto firmato non si riapre: da 'bozza' il contenuto tornerebbe
  -- modificabile e lo snapshot verrebbe rigenerato con un hash nuovo, lasciando
  -- la firma appesa a un documento che non esiste più.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.set_offer_version_status(%L, ''bozza'', ''creata'', ''system'', NULL, NULL, NULL, ''riapertura'')', _version);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T40 riapertura di un contratto firmato', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T40 riapertura di un contratto firmato', 'respinto', 'respinto', SQLERRM);
  END;

  -- Anche chiamando direttamente il congelamento, che è il punto in cui il
  -- danno si materializzerebbe.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.freeze_offer_version_document(%L)', _version);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T41 rigenerazione del documento firmato', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T41 rigenerazione del documento firmato', 'respinto', 'respinto', SQLERRM);
  END;

  -- Essere di Larin non basta per mandare al cliente l'offerta di un altro.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
    EXECUTE format('SELECT public.set_offer_version_status(%L, ''inviata'', ''inviata'', ''user'', ''44444444-4444-4444-8444-444444444444'', NULL, NULL, NULL)', _other_version);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T42 invio della bozza di un altro', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T42 invio della bozza di un altro', 'respinto', 'respinto', SQLERRM);
  END;

  -- Quando una revisione muore, il link deve tornare al contratto in vigore:
  -- altrimenti il cliente legge "offerta rifiutata" mentre ha firmato con noi.
  DECLARE
    _offer2 uuid;
    _v1 uuid;
    _v2 uuid;
    _t uuid;
    _link2 uuid;
    _token2 text;
    _hash2 text;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

    SELECT id INTO _t FROM public.payment_terms WHERE days IS NOT NULL LIMIT 1;
    INSERT INTO public.offers (client_id, created_by)
      SELECT client_id, _uid FROM public.offers WHERE id = _offer RETURNING id INTO _offer2;

    INSERT INTO public.offer_versions (offer_id, created_by, list_total, offered_total)
      VALUES (_offer2, _uid, 1000, 1000) RETURNING id INTO _v1;
    INSERT INTO public.offer_payment_terms (offer_version_id, percentage, payment_term_id, maturity_event)
      VALUES (_v1, 100, _t, 'firma');
    PERFORM public.set_offer_version_status(_v1, 'inviata', 'inviata', 'system', NULL, NULL, NULL, NULL);

    INSERT INTO public.offer_public_links (offer_id, token)
      VALUES (_offer2, 'contrattoinvigore' || encode(extensions.gen_random_bytes(20), 'hex'))
      RETURNING id, token INTO _link2, _token2;
    SELECT snapshot_hash INTO _hash2 FROM public.offer_version_documents WHERE offer_version_id = _v1;

    PERFORM public.record_offer_client_decision(_token2, 'accettata', 'Cliente Fedele', _hash2,
      '1.1.1.1'::inet, 'test', NULL, NULL, 'signatures/t.png', NULL);

    -- Nasce e parte la revisione, che il cliente rifiuta.
    INSERT INTO public.offer_versions (offer_id, created_by, list_total, offered_total)
      VALUES (_offer2, _uid, 1200, 1200) RETURNING id INTO _v2;
    INSERT INTO public.offer_payment_terms (offer_version_id, percentage, payment_term_id, maturity_event)
      VALUES (_v2, 100, _t, 'firma');
    PERFORM public.set_offer_version_status(_v2, 'inviata', 'inviata', 'system', NULL, NULL, NULL, NULL);
    PERFORM public.set_offer_version_status(_v2, 'rifiutata', 'rifiutata', 'client', NULL, _token2, '1.1.1.1'::inet, 'troppo caro');

    EXECUTE 'RESET ROLE';

    INSERT INTO _res
    SELECT 'T43 il link torna al contratto in vigore', 'ok',
           CASE WHEN o.current_version_id = _v1 THEN 'ok' ELSE 'FALLITO' END,
           CASE WHEN o.current_version_id = _v1 THEN 'punta alla v1 accettata'
                ELSE 'punta alla revisione rifiutata: il contratto firmato è invisibile' END
      FROM public.offers o WHERE o.id = _offer2;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('T43 il link torna al contratto in vigore', 'ok', 'FALLITO', SQLERRM);
  END;
END
$outer$;

SELECT n AS test, atteso, esito, left(coalesce(dettaglio, ''), 130) AS dettaglio FROM _res ORDER BY n;

ROLLBACK;
