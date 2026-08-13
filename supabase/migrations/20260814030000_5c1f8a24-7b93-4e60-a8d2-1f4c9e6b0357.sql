-- =============================================================================
-- La versione corrente è un fatto del dominio, non una scrittura del client
-- =============================================================================
-- AD-6 dice che offers.current_version_id è unico e obbligatorio dopo il primo
-- invio, e che il link pubblico risolve sempre la versione corrente. Oggi non è
-- così: il puntatore lo scrive il client (CreateOfferDialog) subito dopo aver
-- creato la versione, e su tutte le offerte dello staging è rimasto NULL,
-- perché chi le ha create per altra via non ha fatto quella UPDATE. Un link
-- pubblico verso una di quelle offerte non risolverebbe nulla.
--
-- C'è un difetto peggiore del dato mancante, e si vedrà appena esisteranno le
-- revisioni: "corrente = l'ultima versione creata" significa che aprire una v2
-- in bozza per rivedere i prezzi sposta subito il puntatore, e il cliente che
-- riapre il link ricevuto ieri si trova davanti una bozza in lavorazione.
--
-- Regola corretta, e imposta qui dentro: la versione corrente è l'ultima
-- INVIATA. Finché una revisione è in bozza o in approvazione, la corrente resta
-- quella che il cliente ha già in mano. Una versione appena creata diventa
-- corrente solo se l'offerta non ne ha ancora nessuna.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Coerenza del puntatore: la corrente appartiene all'offerta
-- -----------------------------------------------------------------------------
-- La FK garantisce che punti a una versione esistente, non che sia una versione
-- DI QUESTA offerta. Senza questo controllo il puntatore può indicare il
-- documento di un altro cliente, che è il modo più diretto di mostrare a
-- qualcuno i prezzi di qualcun altro.

CREATE OR REPLACE FUNCTION public.guard_offer_current_version_belongs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.offer_versions v
     WHERE v.id = NEW.current_version_id AND v.offer_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'La versione corrente deve appartenere a questa offerta'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_offers_current_version_belongs
BEFORE INSERT OR UPDATE OF current_version_id ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.guard_offer_current_version_belongs();


-- -----------------------------------------------------------------------------
-- 2) Superamento delle altre versioni
-- -----------------------------------------------------------------------------
-- Chiamata solo da dentro set_offer_version_status, che ha già verificato chi è
-- l'attore: qui non si ricontrolla l'autorizzazione, si applica la conseguenza.
-- L'attore degli eventi prodotti è 'system' perché il superamento non lo compie
-- nessuno in particolare: è l'effetto dell'invio di un'altra versione.
--
-- Le versioni accettate NON vengono superate da un semplice invio: se la v1 è
-- firmata, quel contratto resta in vigore mentre discutiamo la v2, con le sue
-- tranche e le fatture già emesse sotto di lei (AD-6). Passa a 'sostituita'
-- solo quando una nuova versione viene a sua volta accettata.

CREATE OR REPLACE FUNCTION public.supersede_other_offer_versions(
  _offer_id uuid,
  _keep_version_id uuid,
  _also_supersede_accepted boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _v RECORD;
  _new_status public.offer_status;
BEGIN
  FOR _v IN
    SELECT id, status
      FROM public.offer_versions
     WHERE offer_id = _offer_id
       AND id <> _keep_version_id
       AND (
         status IN ('inviata', 'vista')
         OR (_also_supersede_accepted AND status = 'accettata')
       )
     FOR UPDATE
  LOOP
    _new_status := CASE WHEN _v.status = 'accettata' THEN 'sostituita' ELSE 'superata' END;

    PERFORM set_config('app.offer_status_transition_allowed', 'on', true);
    UPDATE public.offer_versions SET status = _new_status WHERE id = _v.id;
    PERFORM set_config('app.offer_status_transition_allowed', 'off', true);

    INSERT INTO public.offer_events (
      offer_version_id, event_type, previous_status, new_status, actor_type, note
    ) VALUES (
      _v.id,
      CASE WHEN _new_status = 'sostituita' THEN 'sostituita' ELSE 'superata' END,
      _v.status, _new_status, 'system',
      'una versione più recente ha preso il suo posto'
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.supersede_other_offer_versions(uuid, uuid, boolean) IS 'Porta a superata le altre versioni inviate o viste della stessa offerta, e a sostituita quelle accettate quando una nuova accettazione le rimpiazza (AD-6). Non verifica l''autorizzazione: si chiama solo da set_offer_version_status, che l''ha già fatto.';

REVOKE ALL ON FUNCTION public.supersede_other_offer_versions(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_other_offer_versions(uuid, uuid, boolean) TO service_role;


-- -----------------------------------------------------------------------------
-- 3) set_offer_version_status — quarta revisione: muove il puntatore
-- -----------------------------------------------------------------------------

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
  _offer_id uuid;
  _current_version_id uuid;
  _final_status public.offer_status;
  _final_event_type text;
  _final_note text;
  _discount_percentage numeric;
  _offered_total numeric;
  _threshold_percentage numeric;
  _threshold_amount numeric;
  _event public.offer_events;
  _signer text;
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

  SELECT ov.status, ov.created_by, ov.offer_id INTO _old_status, _composer_id, _offer_id
    FROM public.offer_versions ov
   WHERE ov.id = _offer_version_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versione offerta % non trovata', _offer_version_id;
  END IF;

  _final_status := _new_status;
  _final_event_type := _event_type;
  _final_note := _note;

  -- A) Redirect automatico al superamento soglia (bozza -> inviata)
  IF _old_status = 'bozza' AND _new_status = 'inviata' AND public.offer_version_requires_approval(_offer_version_id) THEN
    SELECT public.get_offer_version_effective_discount_percentage(_offer_version_id), ov.offered_total
      INTO _discount_percentage, _offered_total
    FROM public.offer_versions ov WHERE ov.id = _offer_version_id;

    SELECT discount_threshold_percentage, amount_threshold INTO _threshold_percentage, _threshold_amount
      FROM public.get_offer_approval_thresholds();

    _final_status := 'in_approvazione';
    _final_event_type := 'in_approvazione';
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

  -- B) Decisione di approvazione (in_approvazione -> inviata oppure bozza)
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

  -- C) Accettazione e rifiuto arrivano dal cliente, che parla solo con la
  -- versione corrente. Una versione non corrente non si accetta nemmeno se
  -- qualcuno chiama questa funzione direttamente: è l'invariante AD-6, e vale
  -- anche per il service role.
  IF _new_status IN ('accettata', 'rifiutata') THEN
    SELECT current_version_id INTO _current_version_id FROM public.offers WHERE id = _offer_id;
    IF _current_version_id IS DISTINCT FROM _offer_version_id THEN
      RAISE EXCEPTION 'Solo la versione corrente di un''offerta può essere accettata o rifiutata'
        USING errcode = 'check_violation';
    END IF;
    IF _old_status NOT IN ('inviata', 'vista') THEN
      RAISE EXCEPTION 'Una versione in stato % non è accettabile né rifiutabile', _old_status
        USING errcode = 'check_violation';
    END IF;
  END IF;

  -- Quadratura: solo alla prima uscita dalla bozza, sullo stato EFFETTIVO.
  IF _old_status = 'bozza' AND _final_status <> 'bozza' THEN
    PERFORM public.validate_offer_payment_terms_balance(_offer_version_id);
  END IF;

  PERFORM set_config('app.offer_status_transition_allowed', 'on', true);

  UPDATE public.offer_versions
     SET status = _final_status
   WHERE id = _offer_version_id;

  PERFORM set_config('app.offer_status_transition_allowed', 'off', true);

  -- Congelamento del documento alla prima uscita dalla bozza.
  IF _old_status = 'bozza' AND _final_status <> 'bozza' THEN
    PERFORM public.freeze_offer_version_document(_offer_version_id);
  END IF;

  -- D) Il puntatore alla versione corrente si muove all'INVIO, non alla
  -- creazione: finché una revisione è in bozza o in approvazione, il cliente
  -- continua a vedere la versione che ha già ricevuto.
  IF _final_status = 'inviata' THEN
    UPDATE public.offers SET current_version_id = _offer_version_id WHERE id = _offer_id;
    PERFORM public.supersede_other_offer_versions(_offer_id, _offer_version_id, false);
  ELSIF _final_status = 'accettata' THEN
    PERFORM public.supersede_other_offer_versions(_offer_id, _offer_version_id, true);
  END IF;

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
    ELSIF _final_status = 'vista' AND _old_status = 'inviata' THEN
      PERFORM public.notify_offer_client_activity(_offer_version_id, 'viewed');
    ELSIF _final_status = 'accettata' THEN
      SELECT concat_ws(' ', s.signer_name, nullif('(' || s.signer_role || ')', '()'))
        INTO _signer
        FROM public.offer_signatures s
       WHERE s.offer_version_id = _offer_version_id AND s.decision = 'accettata'
       ORDER BY s.created_at DESC LIMIT 1;
      PERFORM public.notify_offer_client_activity(_offer_version_id, 'signed', _signer);
    ELSIF _final_status = 'rifiutata' THEN
      PERFORM public.notify_offer_client_activity(_offer_version_id, 'rejected', _final_note);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Errore nell''invio della notifica per la transizione di %: %', _offer_version_id, SQLERRM;
  END;

  RETURN _event;
END;
$$;

COMMENT ON FUNCTION public.set_offer_version_status(uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text) IS 'Unico varco per cambiare offer_versions.status. Quadratura, soglie di approvazione, congelamento del documento, notifiche, e il puntatore alla versione corrente: si muove all''invio (non alla creazione), superando le altre versioni in gioco. Accettazione e rifiuto sono ammessi solo sulla versione corrente (AD-6).';

REVOKE ALL ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4) La prima versione di un'offerta diventa corrente da sé
-- -----------------------------------------------------------------------------
-- Così il client non deve più scrivere il puntatore (e non potrà più: vedi 5).
-- Vale solo quando l'offerta non ha ancora una corrente: una revisione creata
-- su un'offerta già inviata non sposta niente.

CREATE OR REPLACE FUNCTION public.set_first_offer_version_as_current()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.offers
     SET current_version_id = NEW.id
   WHERE id = NEW.offer_id
     AND current_version_id IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER offer_versions_set_first_as_current
AFTER INSERT ON public.offer_versions
FOR EACH ROW EXECUTE FUNCTION public.set_first_offer_version_as_current();


-- -----------------------------------------------------------------------------
-- 5) Il client non scrive più il puntatore
-- -----------------------------------------------------------------------------
-- In Postgres una REVOKE sulla singola colonna non riduce un GRANT già dato su
-- un elenco di colonne: va tolto tutto l'UPDATE sulla tabella e riconcesso
-- l'elenco senza current_version_id (la stessa trappola già annotata nella
-- migration 20260813120000).

REVOKE UPDATE ON public.offers FROM authenticated;
GRANT UPDATE (project_id, origin) ON public.offers TO authenticated;


-- -----------------------------------------------------------------------------
-- 6) Il link si genera solo se esiste una versione corrente
-- -----------------------------------------------------------------------------
-- Più stretto del controllo precedente ("esiste una versione fuori dalla
-- bozza"), che lasciava passare un'offerta la cui unica versione è in
-- approvazione: il link ci sarebbe, ma non risolverebbe nulla.

CREATE OR REPLACE FUNCTION public.create_offer_public_link(
  _offer_id uuid,
  _expires_in_days integer DEFAULT NULL
)
RETURNS public.offer_public_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.offer_public_links;
  _current_version_id uuid;
  _current_status public.offer_status;
BEGIN
  IF NOT public.can_manage_offer(_offer_id) THEN
    RAISE EXCEPTION 'Non autorizzato a generare il link di questa offerta';
  END IF;

  SELECT o.current_version_id, v.status INTO _current_version_id, _current_status
    FROM public.offers o
    LEFT JOIN public.offer_versions v ON v.id = o.current_version_id
   WHERE o.id = _offer_id;

  IF _current_version_id IS NULL OR _current_status = 'bozza' THEN
    RAISE EXCEPTION 'L''offerta non ha una versione inviata: inviala prima di generare il link per il cliente';
  END IF;

  UPDATE public.offer_public_links
     SET revoked_at = now(), revoked_by = auth.uid()
   WHERE offer_id = _offer_id AND revoked_at IS NULL;

  INSERT INTO public.offer_public_links (offer_id, token, created_by, expires_at)
  VALUES (
    _offer_id,
    encode(extensions.gen_random_bytes(32), 'hex'),
    auth.uid(),
    CASE WHEN _expires_in_days IS NOT NULL THEN now() + make_interval(days => _expires_in_days) END
  )
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_offer_public_link(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_offer_public_link(uuid, integer) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7) Tracciare l'invio al cliente
-- -----------------------------------------------------------------------------
-- "Gliel'ho mandata o no?" è la domanda che l'account si fa mezz'ora dopo, e
-- oggi non ha risposta: la data di creazione del link dice quando è nato, non
-- quando è partita l'email.

ALTER TABLE public.offer_public_links
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sent_to text,
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.offer_public_links.sent_count IS 'Quante volte il link è stato spedito al cliente: un secondo invio è un sollecito, e vederlo contato evita di scrivere "te la rimando" a chi l''ha già ricevuta tre volte.';

CREATE OR REPLACE FUNCTION public.record_offer_link_sent(_public_link_id uuid, _sent_to text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.offer_public_links
     SET last_sent_at = now(),
         last_sent_to = _sent_to,
         sent_count = sent_count + 1
   WHERE id = _public_link_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_offer_link_sent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_offer_link_sent(uuid, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 8) Backfill del puntatore sulle offerte esistenti
-- -----------------------------------------------------------------------------
-- Priorità: l'ultima versione inviata o oltre; in mancanza, la prima creata.
-- Senza questo, ogni offerta già in essere resterebbe senza versione corrente e
-- quindi senza link pubblico possibile.

UPDATE public.offers o
   SET current_version_id = scelta.id
  FROM (
    SELECT DISTINCT ON (v.offer_id)
           v.offer_id, v.id
      FROM public.offer_versions v
     ORDER BY v.offer_id,
              (v.status <> 'bozza') DESC,
              v.version_number DESC
  ) AS scelta
 WHERE scelta.offer_id = o.id
   AND o.current_version_id IS NULL;
