-- =============================================================================
-- Invarianti della coda fatture: ogni caso prova a violarne uno
-- =============================================================================
-- Stesso spirito di invarianti-offerte.sql: non verificano che il codice faccia
-- quello che dice, verificano che il database impedisca quello che non deve
-- succedere. Qui la posta in gioco è una fattura emessa due volte allo stesso
-- cliente, o un residuo che mente.
--
-- Si lancia come l'altro file, contro lo STAGING:
--
--   PAT=$(security find-generic-password -s "supabase-pat-timetrap" -a "$USER" -w)
--   curl -sS -X POST "https://api.supabase.com/v1/projects/jtbgvidwvgwrayqhlzvw/database/query" \
--     -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
--     --data "$(python3 -c "import json;print(json.dumps({'query':open('supabase/tests/invarianti-fatture.sql').read()}))")"
--
-- Tutto in transazione con ROLLBACK finale.
-- =============================================================================
BEGIN;

CREATE TEMP TABLE _res(n text, atteso text, esito text, dettaglio text) ON COMMIT DROP;

CREATE TEMP TABLE _fix ON COMMIT DROP AS
SELECT q.id AS queue_id, q.offer_payment_term_id, q.offer_id, q.offer_version_id, q.amount
  FROM public.invoice_queue q
 WHERE q.status = 'prevista'
 ORDER BY q.created_at
 LIMIT 1;

DO $outer$
DECLARE
  _account uuid := '22222222-2222-4222-8222-222222222222'; -- ruolo account
  _finance uuid := '33333333-3333-4333-8333-333333333333'; -- ruolo finance
  _queue uuid;
  _term uuid;
  _offer uuid;
  _version uuid;
  _amount numeric;
  _tmp jsonb;
  _n integer;
BEGIN
  SELECT queue_id, offer_payment_term_id, offer_id, offer_version_id, amount
    INTO _queue, _term, _offer, _version, _amount FROM _fix;

  -- ===== quello che un utente autenticato non deve poter fare =====

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _finance, 'role', 'authenticated')::text, true);
    EXECUTE format('UPDATE public.invoice_queue SET status = ''emessa'' WHERE id = %L', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res
    SELECT 'F01 marcare emessa con un update diretto', 'respinto',
           CASE WHEN status = 'emessa' THEN 'PASSATO' ELSE 'senza effetto' END, 'stato: ' || status
      FROM public.invoice_queue WHERE id = _queue;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F01 marcare emessa con un update diretto', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _finance, 'role', 'authenticated')::text, true);
    EXECUTE format('INSERT INTO public.invoice_queue (offer_id, offer_version_id, client_id, amount, description, idempotency_key) SELECT offer_id, %L, (SELECT client_id FROM public.offers WHERE id = offer_id), 999, ''fattura inventata'', ''finta:1'' FROM _fix', _version);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res
    SELECT 'F02 inserire una fattura inventata', 'respinto',
           CASE WHEN count(*) > 0 THEN 'PASSATO' ELSE 'senza effetto' END, count(*) || ' righe finte'
      FROM public.invoice_queue WHERE idempotency_key = 'finta:1';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F02 inserire una fattura inventata', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _account, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.mark_invoice_paid(%L)', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F03 incasso registrato da un ruolo non amministrativo', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F03 incasso registrato da un ruolo non amministrativo', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _account, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.cancel_invoice_queue_row(%L, ''non mi va'')', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F04 annullamento da un ruolo non amministrativo', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F04 annullamento da un ruolo non amministrativo', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _finance, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.cancel_invoice_queue_row(%L, ''   '')', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F05 annullamento senza motivo', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F05 annullamento senza motivo', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SELECT count(*) FROM public.invoice_queue' INTO _tmp;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F06 lettura della coda da anon', 'respinto o zero',
      CASE WHEN _tmp::text = '0' THEN 'zero righe' ELSE 'PASSATO' END, 'righe: ' || _tmp::text);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F06 lettura della coda da anon', 'respinto o zero', 'respinto', SQLERRM);
  END;

  -- ===== quello che nemmeno il sistema deve poter fare =====

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    -- Una fattura non può dirsi emessa senza il riferimento al documento FiC:
    -- sarebbe una fattura che nessuno ritrova.
    PERFORM set_config('app.invoice_queue_transition_allowed', 'on', true);
    EXECUTE format('UPDATE public.invoice_queue SET status = ''emessa'', issued_at = now() WHERE id = %L', _queue);
    PERFORM set_config('app.invoice_queue_transition_allowed', 'off', true);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F07 emessa senza riferimento al documento FiC', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F07 emessa senza riferimento al documento FiC', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    -- Accodare due volte la stessa tranche: la chiave di idempotenza deve
    -- restituire la riga esistente, non crearne una seconda.
    EXECUTE format('SELECT public.enqueue_invoice_for_payment_term(%L)', _term);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res
    SELECT 'F08 doppio accodamento della stessa tranche', 'una sola riga',
           CASE WHEN count(*) = 1 THEN 'ok' ELSE 'PASSATO' END, count(*) || ' righe per quella tranche'
      FROM public.invoice_queue WHERE offer_payment_term_id = _term;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F08 doppio accodamento della stessa tranche', 'una sola riga', 'respinto', SQLERRM);
  END;

  -- Accodare una tranche non maturata.
  DECLARE
    _da_maturare uuid;
  BEGIN
    SELECT id INTO _da_maturare FROM public.offer_payment_terms
     WHERE maturity_status = 'da_maturare' LIMIT 1;

    IF _da_maturare IS NULL THEN
      INSERT INTO _res VALUES ('F09 accodare una tranche non maturata', 'respinto', 'non provato', 'nessuna tranche da maturare sullo staging');
    ELSE
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
      EXECUTE format('SELECT public.enqueue_invoice_for_payment_term(%L)', _da_maturare);
      EXECUTE 'RESET ROLE';
      INSERT INTO _res VALUES ('F09 accodare una tranche non maturata', 'respinto', 'PASSATO', NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F09 accodare una tranche non maturata', 'respinto', 'respinto', SQLERRM);
  END;

  -- ===== il percorso felice deve funzionare =====

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.claim_invoice_for_issue(%L)', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res
    SELECT 'F10 presa in carico per l''emissione', 'ok',
           CASE WHEN status = 'in_emissione' THEN 'ok' ELSE 'FALLITO' END, 'stato: ' || status
      FROM public.invoice_queue WHERE id = _queue;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F10 presa in carico per l''emissione', 'ok', 'FALLITO', SQLERRM);
  END;

  -- Doppia presa in carico: è la finestra del doppio click, e deve chiudersi.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.claim_invoice_for_issue(%L)', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F11 seconda presa in carico della stessa riga', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F11 seconda presa in carico della stessa riga', 'respinto', 'respinto', SQLERRM);
  END;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE format('SELECT public.mark_invoice_issued(%L, 987654, ''https://esempio/doc'', NULL)', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res
    SELECT 'F12 emissione registrata', 'ok',
           CASE WHEN status = 'emessa' AND fic_document_id = 987654 THEN 'ok' ELSE 'FALLITO' END,
           format('stato %s, doc %s', status, fic_document_id)
      FROM public.invoice_queue WHERE id = _queue;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F12 emissione registrata', 'ok', 'FALLITO', SQLERRM);
  END;

  -- Il residuo deve riflettere l'emissione, altrimenti mente.
  INSERT INTO _res
  SELECT 'F13 il residuo riflette il fatturato', 'ok',
         CASE WHEN fatturato >= _amount THEN 'ok' ELSE 'FALLITO' END,
         format('valore %s, fatturato %s, residuo %s', valore, fatturato, residuo)
    FROM public.offer_billing_summary WHERE offer_id = _offer;

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _finance, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.mark_invoice_paid(%L)', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res
    SELECT 'F14 incasso registrato da amministrazione', 'ok',
           CASE WHEN status = 'incassata' AND paid_at IS NOT NULL THEN 'ok' ELSE 'FALLITO' END, 'stato: ' || status
      FROM public.invoice_queue WHERE id = _queue;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F14 incasso registrato da amministrazione', 'ok', 'FALLITO', SQLERRM);
  END;

  -- Annullare una fattura già emessa non ha senso: si stornerebbe, non si annulla.
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _finance, 'role', 'authenticated')::text, true);
    EXECUTE format('SELECT public.cancel_invoice_queue_row(%L, ''ci ho ripensato'')', _queue);
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F15 annullare una fattura già emessa', 'respinto', 'PASSATO', NULL);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F15 annullare una fattura già emessa', 'respinto', 'respinto', SQLERRM);
  END;

  -- L'avviso all'amministrazione deve raggiungere qualcuno.
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE 'SELECT public.notify_invoices_due()' INTO _n;
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F16 avviso di fatture da emettere', 'almeno un destinatario',
      CASE WHEN _n > 0 THEN 'ok' ELSE 'FALLITO' END, _n || ' destinatari');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _res VALUES ('F16 avviso di fatture da emettere', 'almeno un destinatario', 'FALLITO', SQLERRM);
  END;
END
$outer$;

SELECT n AS test, atteso, esito, left(coalesce(dettaglio, ''), 120) AS dettaglio FROM _res ORDER BY n;

ROLLBACK;
