-- =============================================================================
-- Approvazione delle offerte sopra soglia, e notifica a chi deve approvare
-- =============================================================================
-- Estende il dominio offerte (20260813120000 / 20260813130000 / 20260813140000)
-- con:
--
--  1) Soglie di approvazione configurabili in app_settings (sconto effettivo in
--     punti percentuali, importo offerto in euro), lette da una funzione
--     dedicata: public.get_offer_approval_thresholds().
--
--  2) Lo sconto effettivo derivato, mai gli sconti di riga: public.get_offer_-
--     version_effective_discount_percentage() e public.offer_version_requires_-
--     approval() usano SEMPRE (list_total - offered_total) / list_total, che è
--     l'unica misura corretta anche quando l'offerta espone un prezzo unico e i
--     discount_percentage di riga restano a zero (vedi commento già presente su
--     offer_versions.offered_total nella migration 20260813120000).
--
--  3) Il passaggio in approvazione: public.set_offer_version_status() viene
--     sostituita di nuovo (terza volta, dopo 20260813120000 e 20260813140000).
--     Chi chiede 'inviata' da 'bozza' ottiene 'in_approvazione' invece, se una
--     soglia è superata; da 'in_approvazione' si può solo andare a 'inviata'
--     (approvata) o 'bozza' (respinta, motivo obbligatorio), e SOLO un admin
--     diverso da chi ha composto QUESTA versione (offer_versions.created_by)
--     può farlo. La quadratura del piano di pagamento innestata in
--     20260813140000 resta intatta e si applica allo stato EFFETTIVO della
--     transizione (vedi sezione 7 per il perché è corretto anche col redirect).
--
--  4) Le notifiche. Il vincolo da risolvere: la policy di INSERT su
--     notifications è "auth.uid() = user_id" (vedi migration 20260310141701),
--     quindi un utente può notificare solo se stesso. La soluzione NON è
--     aprire una policy permissiva (chiunque potrebbe scrivere notifiche a
--     chiunque), ma una funzione SECURITY DEFINER, sullo stesso principio già
--     sfruttato da tutti i trigger di notifica esistenti (notify_budget_status_-
--     change, notify_project_leader_assignment, ecc: la nota nella migration
--     20260310141701 lo dice esplicitamente: "SECURITY DEFINER triggers bypass
--     RLS"). Qui però la funzione NON è un trigger ma un helper esplicito,
--     dedicato e NON concesso a authenticated (vedi sezione 5 per il dettaglio
--     di come resta comunque chiamabile da set_offer_version_status).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Soglie di approvazione in app_settings
-- -----------------------------------------------------------------------------
-- Un'unica riga con entrambe le soglie (stesso pattern già in uso altrove nella
-- tabella per impostazioni composite, es. projection_thresholds: {"warning":
-- ..., "critical": ...}), non due righe scalari separate: le due soglie si
-- leggono sempre insieme (basta superarne una) e cambiano insieme quando la
-- policy commerciale cambia.

INSERT INTO public.app_settings (setting_key, setting_value, description) VALUES (
  'offer_approval_thresholds',
  '{"discount_percentage": 15, "amount": 30000}'::jsonb,
  'Soglie oltre le quali una versione di offerta richiede approvazione admin prima di passare da bozza a inviata: sconto effettivo (list_total, offered_total, MAI gli sconti di riga) in punti percentuali, e importo offerto in euro. Basta superarne una delle due. Valori di partenza, non un vincolo di prodotto: modificabili qui senza migration. Lette da public.get_offer_approval_thresholds().'
) ON CONFLICT (setting_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_offer_approval_thresholds()
RETURNS TABLE(discount_threshold_percentage numeric, amount_threshold numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((SELECT (setting_value->>'discount_percentage')::numeric FROM public.app_settings WHERE setting_key = 'offer_approval_thresholds'), 15),
    COALESCE((SELECT (setting_value->>'amount')::numeric FROM public.app_settings WHERE setting_key = 'offer_approval_thresholds'), 30000)
$$;

COMMENT ON FUNCTION public.get_offer_approval_thresholds() IS 'Soglie correnti di approvazione offerte, da app_settings (chiave offer_approval_thresholds). Valori di default hard-coded qui SOLO come rete di sicurezza se la riga in app_settings viene rimossa: la fonte di verità resta la tabella.';

REVOKE ALL ON FUNCTION public.get_offer_approval_thresholds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_offer_approval_thresholds() TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2) Sconto effettivo derivato (mai gli sconti di riga)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_offer_version_effective_discount_percentage(_offer_version_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- list_total = 0 non ha uno sconto percentuale definito (divisione per
  -- zero): capita solo su una bozza appena creata senza righe, e in quel caso
  -- 0 è il valore corretto (nessuno sconto da segnalare, non un errore).
  SELECT CASE WHEN list_total > 0
           THEN round((list_total - offered_total) / list_total * 100, 4)
           ELSE 0
         END
  FROM public.offer_versions
  WHERE id = _offer_version_id
$$;

COMMENT ON FUNCTION public.get_offer_version_effective_discount_percentage(uuid) IS 'Sconto effettivo di una versione, in punti percentuali: (list_total - offered_total) / list_total. Deriva SEMPRE dai totali di versione, mai da offer_lines.discount_percentage: un''offerta con prezzo unico esposto al cliente ha gli sconti di riga a zero ma uno sconto reale che questa funzione intercetta comunque.';

REVOKE ALL ON FUNCTION public.get_offer_version_effective_discount_percentage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_offer_version_effective_discount_percentage(uuid) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3) Verifica se una versione richiede approvazione
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.offer_version_requires_approval(_offer_version_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _discount_percentage numeric;
  _offered_total numeric;
  _threshold_percentage numeric;
  _threshold_amount numeric;
BEGIN
  SELECT public.get_offer_version_effective_discount_percentage(_offer_version_id), offered_total
    INTO _discount_percentage, _offered_total
  FROM public.offer_versions
  WHERE id = _offer_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versione offerta % non trovata', _offer_version_id;
  END IF;

  SELECT discount_threshold_percentage, amount_threshold INTO _threshold_percentage, _threshold_amount
    FROM public.get_offer_approval_thresholds();

  RETURN _discount_percentage > _threshold_percentage OR _offered_total > _threshold_amount;
END;
$$;

COMMENT ON FUNCTION public.offer_version_requires_approval(uuid) IS 'true se lo sconto effettivo o l''importo offerto della versione superano le soglie correnti (public.get_offer_approval_thresholds). Usata dal redirect automatico in public.set_offer_version_status(); esposta anche a authenticated per un eventuale avviso in UI prima dell''invio (non ancora implementato: questa migration è solo backend).';

REVOKE ALL ON FUNCTION public.offer_version_requires_approval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_version_requires_approval(uuid) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4) Nuovo event_type per il rifiuto in approvazione
-- -----------------------------------------------------------------------------
-- 'in_approvazione' e 'inviata' sono già valori ammessi dal CHECK esistente
-- (la migration 20260813120000 li aveva già previsti insieme allo stato
-- omonimo). Manca un event_type per "un admin respinge la richiesta di
-- approvazione, la versione torna in bozza": non è 'rifiutata', che nell'enum
-- di stato e nel registro eventi indica il CLIENTE che rifiuta l'offerta
-- ricevuta (semantica diversa, riusarla confonderebbe le due cose). Il CHECK
-- era senza nome esplicito alla creazione, quindi Postgres gli ha assegnato un
-- nome automatico che non possiamo conoscere con certezza da qui (questa
-- migration non va eseguita contro il DB per verificarlo): lo si individua per
-- struttura (l'unico CHECK su offer_events il cui vincolo di colonna è
-- esattamente event_type), non per nome presunto, e lo si ricrea con un nome
-- esplicito così che le prossime migration possano riferirlo con certezza.

DO $$
DECLARE
  v_conname text;
  v_attnum smallint;
BEGIN
  SELECT attnum INTO v_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.offer_events'::regclass AND attname = 'event_type';

  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.offer_events'::regclass
    AND contype = 'c'
    AND conkey = ARRAY[v_attnum];

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.offer_events DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.offer_events ADD CONSTRAINT offer_events_event_type_check CHECK (event_type IN (
  'creata', 'in_approvazione', 'inviata', 'vista', 'accettata', 'rifiutata',
  'scaduta', 'superata', 'sostituita', 'firmata', 'respinta'
));

COMMENT ON CONSTRAINT offer_events_event_type_check ON public.offer_events IS 'respinta = un admin respinge una richiesta di approvazione (in_approvazione -> bozza); distinto da rifiutata, che è il CLIENTE che rifiuta l''offerta ricevuta.';


-- -----------------------------------------------------------------------------
-- 5) notify_user_if_enabled — il varco per notificare terzi
-- -----------------------------------------------------------------------------
-- Risolve il vincolo di notifications (INSERT ammessa solo con auth.uid() =
-- user_id): questa funzione è SECURITY DEFINER, quindi il suo INSERT viene
-- eseguito con i privilegi del proprietario della funzione (in Supabase il
-- ruolo che esegue le migration, tipicamente superuser o comunque proprietario
-- della tabella), che bypassa la RLS indipendentemente dal ruolo di chi ha
-- chiamato la funzione a monte. Esattamente il meccanismo con cui già oggi
-- notify_budget_status_change scrive notifiche per utenti diversi da
-- auth.uid() (vedi commento esplicito nella migration 20260310141701).
--
-- La differenza rispetto a "aprire una policy permissiva" è cruciale: qui NON
-- viene concesso EXECUTE a authenticated. Se lo facessimo, qualunque utente
-- autenticato potrebbe chiamare direttamente questa funzione per scrivere una
-- notifica con qualunque titolo/testo verso qualunque user_id - esattamente lo
-- scenario che dobbiamo evitare. Resta comunque richiamabile da dentro
-- set_offer_version_status() perché quest'ultima è anch'essa SECURITY DEFINER:
-- durante la sua esecuzione il ruolo effettivo è già il proprietario (lo
-- stesso di questa funzione), quindi la chiamata annidata non passa mai dai
-- privilegi del chiamante originale e non richiede alcun GRANT a authenticated.

CREATE OR REPLACE FUNCTION public.notify_user_if_enabled(
  _user_id uuid,
  _type text,
  _title text,
  _message text,
  _project_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _in_app_enabled boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(in_app_enabled, true) INTO _in_app_enabled
    FROM public.notification_preferences
   WHERE user_id = _user_id AND notification_type = _type;

  _in_app_enabled := COALESCE(_in_app_enabled, true);

  IF _in_app_enabled THEN
    INSERT INTO public.notifications (user_id, type, title, message, project_id, read)
    VALUES (_user_id, _type, _title, _message, _project_id, false);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.notify_user_if_enabled(uuid, text, text, text, uuid) IS 'Inserisce una notifica per conto del sistema, rispettando notification_preferences.in_app_enabled (default abilitato se non c''è preferenza, stesso default di get_user_email_preference). SECURITY DEFINER per bypassare la RLS di notifications (INSERT vincolata a auth.uid() = user_id). Deliberatamente NON concessa a authenticated: si invoca solo da altre funzioni SECURITY DEFINER del dominio offerte, per non diventare un varco che permetta a un client di scrivere notifiche a piacere verso chiunque.';

REVOKE ALL ON FUNCTION public.notify_user_if_enabled(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_user_if_enabled(uuid, text, text, text, uuid) TO service_role;


-- -----------------------------------------------------------------------------
-- 6) Notifiche del flusso di approvazione
-- -----------------------------------------------------------------------------
-- Stesso principio di accesso di notify_user_if_enabled: SECURITY DEFINER, non
-- concesse a authenticated, richiamabili solo da set_offer_version_status().
-- Il contenuto del messaggio riporta cliente, importo e sconto applicato,
-- oltre al riferimento dell'offerta (anno/numero/versione) perché un admin può
-- avere più offerte in coda: senza questo riferimento la notifica avviserebbe
-- "qualcosa richiede approvazione" senza dire quale.

CREATE OR REPLACE FUNCTION public.notify_offer_approval_required(_offer_version_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _composer_id uuid;
  _project_id uuid;
  _year integer;
  _number integer;
  _version_number integer;
  _client_name text;
  _offered_total numeric;
  _discount_percentage numeric;
  _title text;
  _message text;
  _admin RECORD;
BEGIN
  SELECT ov.created_by, o.project_id, o.year, o.number, ov.version_number, c.name, ov.offered_total,
         public.get_offer_version_effective_discount_percentage(ov.id)
    INTO _composer_id, _project_id, _year, _number, _version_number, _client_name, _offered_total, _discount_percentage
  FROM public.offer_versions ov
  JOIN public.offers o ON o.id = ov.offer_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE ov.id = _offer_version_id;

  _title := format('Offerta %s/%s in attesa di approvazione', _year, _number);
  _message := format(
    'Offerta %s/%s (v%s) per %s: importo offerto %s €, sconto effettivo %s%%. %s',
    _year, _number, _version_number, _client_name, _offered_total, round(_discount_percentage, 2), coalesce(_reason, '')
  );

  -- Tutti gli admin approvati, tranne chi ha composto la versione (che non
  -- potrebbe comunque approvarla) e tranne chi ha materialmente eseguito
  -- questa transizione (di norma coincide col compositore, ma IS DISTINCT
  -- FROM regge anche il caso auth.uid() nullo di una chiamata service_role,
  -- a differenza di un semplice <> che in quel caso filtrerebbe via ogni riga).
  FOR _admin IN
    SELECT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin'
      AND p.approved = true
      AND p.deleted_at IS NULL
      AND ur.user_id IS DISTINCT FROM auth.uid()
      AND ur.user_id IS DISTINCT FROM _composer_id
  LOOP
    PERFORM public.notify_user_if_enabled(_admin.user_id, 'offer_approval_required', _title, _message, _project_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_offer_approval_outcome(_offer_version_id uuid, _approved boolean, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _composer_id uuid;
  _project_id uuid;
  _year integer;
  _number integer;
  _version_number integer;
  _client_name text;
  _offered_total numeric;
  _discount_percentage numeric;
  _type text;
  _title text;
  _message text;
BEGIN
  SELECT ov.created_by, o.project_id, o.year, o.number, ov.version_number, c.name, ov.offered_total,
         public.get_offer_version_effective_discount_percentage(ov.id)
    INTO _composer_id, _project_id, _year, _number, _version_number, _client_name, _offered_total, _discount_percentage
  FROM public.offer_versions ov
  JOIN public.offers o ON o.id = ov.offer_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE ov.id = _offer_version_id;

  IF _composer_id IS NULL THEN
    -- Versione senza autore registrato (profilo cancellato): niente da notificare.
    RETURN;
  END IF;

  IF _approved THEN
    _type := 'offer_approved';
    _title := format('Offerta %s/%s approvata', _year, _number);
    _message := format(
      'Offerta %s/%s (v%s) per %s: importo %s €, sconto %s%%. Approvata, pronta per l''invio.%s',
      _year, _number, _version_number, _client_name, _offered_total, round(_discount_percentage, 2),
      CASE WHEN _reason IS NOT NULL THEN format(' Nota: %s', _reason) ELSE '' END
    );
  ELSE
    _type := 'offer_rejected';
    _title := format('Offerta %s/%s respinta', _year, _number);
    _message := format(
      'Offerta %s/%s (v%s) per %s: importo %s €, sconto %s%%. Respinta. Motivo: %s',
      _year, _number, _version_number, _client_name, _offered_total, round(_discount_percentage, 2),
      coalesce(_reason, 'non specificato')
    );
  END IF;

  PERFORM public.notify_user_if_enabled(_composer_id, _type, _title, _message, _project_id);
END;
$$;

COMMENT ON FUNCTION public.notify_offer_approval_required(uuid, text) IS 'Notifica (tipo offer_approval_required) tutti gli admin approvati e non cancellati, escludendo chi ha composto la versione e chi ha eseguito la transizione. Richiamata da set_offer_version_status() quando bozza -> inviata viene rediretta a in_approvazione.';
COMMENT ON FUNCTION public.notify_offer_approval_outcome(uuid, boolean, text) IS 'Notifica (tipo offer_approved o offer_rejected) chi ha composto la versione, con l''esito della decisione di approvazione. Richiamata da set_offer_version_status() sulle transizioni in_approvazione -> inviata/bozza.';

REVOKE ALL ON FUNCTION public.notify_offer_approval_required(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_offer_approval_outcome(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_offer_approval_required(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_offer_approval_outcome(uuid, boolean, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 7) set_offer_version_status — redirect automatico + decisione di approvazione
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE della funzione della migration 20260813140000 (che a sua
-- volta l'aveva sostituita rispetto a 20260813120000, innestando la quadratura
-- del piano di pagamento): stesso corpo, quadratura inclusa e invariata nella
-- sua logica, con due aggiunte.
--
-- A) Redirect automatico (bozza -> inviata richiesta, in_approvazione ottenuta
--    se sopra soglia). La quadratura resta agganciata a "old_status = bozza e
--    lo stato che si ottiene DAVVERO non è bozza" (_final_status, non
--    _new_status): deve valere anche col redirect, perché è comunque il
--    momento in cui il contenuto si congela (guard_offer_version_content_-
--    immutable tratta ogni stato diverso da 'bozza' come congelato, quindi
--    'in_approvazione' congela il contenuto esattamente come 'inviata').
--
-- B) Decisione di approvazione (in_approvazione -> inviata/bozza): solo un
--    admin (has_role) diverso da chi ha composto QUESTA versione
--    (offer_versions.created_by), anche se admin. Il rifiuto richiede sempre
--    un motivo non vuoto.
--
-- Le notifiche sono racchiuse in un blocco con EXCEPTION WHEN OTHERS che si
-- limita a un RAISE WARNING: un fallimento nell'invio non deve annullare una
-- transizione di stato già scritta e valida, stesso principio di resilienza
-- già seguito da notify_project_leader_assignment per l'invio email.

CREATE OR REPLACE FUNCTION public.set_offer_version_status(
  _offer_version_id uuid,
  _new_status public.offer_status,
  _event_type text,
  _actor_type public.offer_event_actor_type,
  _actor_user_id uuid DEFAULT NULL,
  _client_token text DEFAULT NULL,
  _client_ip inet DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS public.offer_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_status public.offer_status;
  _composer_id uuid;
  _final_status public.offer_status;
  _final_event_type text;
  _final_note text;
  _discount_percentage numeric;
  _offered_total numeric;
  _threshold_percentage numeric;
  _threshold_amount numeric;
  _event public.offer_events;
BEGIN
  IF _actor_type = 'user' THEN
    IF _actor_user_id IS NULL OR _actor_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'actor_user_id deve coincidere con l''utente autenticato corrente';
    END IF;
    IF NOT public.is_approved_user(auth.uid()) THEN
      RAISE EXCEPTION 'Utente non approvato';
    END IF;
  ELSE
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Gli eventi di tipo client o system si registrano solo da un processo di sistema (service role)';
    END IF;
  END IF;

  SELECT status, created_by INTO _old_status, _composer_id
    FROM public.offer_versions
   WHERE id = _offer_version_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versione offerta % non trovata', _offer_version_id;
  END IF;

  _final_status := _new_status;
  _final_event_type := _event_type;
  _final_note := _note;

  -- ---------------------------------------------------------------------
  -- A) Redirect automatico al superamento soglia (bozza -> inviata)
  -- ---------------------------------------------------------------------
  IF _old_status = 'bozza' AND _new_status = 'inviata' AND public.offer_version_requires_approval(_offer_version_id) THEN
    SELECT public.get_offer_version_effective_discount_percentage(_offer_version_id), ov.offered_total
      INTO _discount_percentage, _offered_total
    FROM public.offer_versions ov WHERE ov.id = _offer_version_id;

    SELECT discount_threshold_percentage, amount_threshold INTO _threshold_percentage, _threshold_amount
      FROM public.get_offer_approval_thresholds();

    _final_status := 'in_approvazione';
    _final_event_type := 'in_approvazione';
    -- concat_ws scarta automaticamente i rami NULL (soglia non superata) e la
    -- nota del chiamante se non fornita: il motivo registrato riporta sempre
    -- almeno la soglia che ha fatto scattare il redirect.
    _final_note := concat_ws('; ',
      CASE WHEN _discount_percentage > _threshold_percentage THEN
        format('sconto effettivo %s%% oltre la soglia del %s%%', round(_discount_percentage, 2), _threshold_percentage)
      END,
      CASE WHEN _offered_total > _threshold_amount THEN
        format('importo offerto %s € oltre la soglia di %s €', _offered_total, _threshold_amount)
      END,
      _note
    );
  END IF;

  -- ---------------------------------------------------------------------
  -- B) Decisione di approvazione (in_approvazione -> inviata oppure bozza)
  -- ---------------------------------------------------------------------
  IF _old_status = 'in_approvazione' AND _new_status IN ('inviata', 'bozza') THEN
    IF _actor_type <> 'user' OR NOT public.has_role(_actor_user_id, 'admin') THEN
      RAISE EXCEPTION 'Solo un utente con ruolo admin può approvare o respingere un''offerta in approvazione';
    END IF;

    IF _actor_user_id = _composer_id THEN
      RAISE EXCEPTION 'Chi ha composto l''offerta non può approvarla né respingerla, anche da admin';
    END IF;

    IF _new_status = 'bozza' THEN
      IF _note IS NULL OR btrim(_note) = '' THEN
        RAISE EXCEPTION 'Il rifiuto di un''offerta in approvazione richiede un motivo';
      END IF;
      _final_event_type := 'respinta';
    ELSE
      _final_event_type := 'inviata';
    END IF;
  END IF;

  -- Quadratura: solo alla prima uscita dalla bozza, sullo stato EFFETTIVO
  -- (vedi punto A: vale sia per 'inviata' diretta sia per il redirect a
  -- 'in_approvazione', perché entrambi congelano il contenuto).
  IF _old_status = 'bozza' AND _final_status <> 'bozza' THEN
    PERFORM public.validate_offer_payment_terms_balance(_offer_version_id);
  END IF;

  PERFORM set_config('app.offer_status_transition_allowed', 'on', true);

  UPDATE public.offer_versions
     SET status = _final_status
   WHERE id = _offer_version_id;

  PERFORM set_config('app.offer_status_transition_allowed', 'off', true);

  INSERT INTO public.offer_events (
    offer_version_id, event_type, previous_status, new_status,
    actor_type, actor_user_id, client_token, client_ip, note
  ) VALUES (
    _offer_version_id, _final_event_type, _old_status, _final_status,
    _actor_type, _actor_user_id, _client_token, _client_ip, _final_note
  )
  RETURNING * INTO _event;

  BEGIN
    IF _old_status = 'bozza' AND _final_status = 'in_approvazione' THEN
      PERFORM public.notify_offer_approval_required(_offer_version_id, _final_note);
    ELSIF _old_status = 'in_approvazione' AND _final_status = 'inviata' THEN
      PERFORM public.notify_offer_approval_outcome(_offer_version_id, true, _final_note);
    ELSIF _old_status = 'in_approvazione' AND _final_status = 'bozza' THEN
      PERFORM public.notify_offer_approval_outcome(_offer_version_id, false, _final_note);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Errore nell''invio della notifica per la transizione di %: %', _offer_version_id, SQLERRM;
  END;

  RETURN _event;
END;
$$;

COMMENT ON FUNCTION public.set_offer_version_status(uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text) IS 'Unico varco per cambiare offer_versions.status. Oltre alla quadratura del piano di pagamento (20260813140000): redirige bozza->inviata a in_approvazione se sopra soglia (public.offer_version_requires_approval), impone che solo un admin diverso dal compositore della versione decida in_approvazione->inviata/bozza, e notifica admin/compositore ai due passaggi.';

REVOKE ALL ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) TO authenticated, service_role;
