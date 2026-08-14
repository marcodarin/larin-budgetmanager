-- =============================================================================
-- Gare: offerte con origine imposta, non un dominio parallelo
-- =============================================================================
-- Copre FR-32 a FR-35 e realizza AD-10. Una gara è un'offerta con
-- `origin = 'tender'`: tutto ciò che sta a valle (tranche, fatture, statistica)
-- resta identico, e il blocco aggiunge solo ciò che le gare hanno in più. Il
-- contrario, un dominio separato, produrrebbe due strade verso contratto e
-- fatture e due statistiche da riconciliare.
--
-- Cosa hanno in più: una scadenza di presentazione, che è la data che conta e
-- che va vista prima di scadere; un esito; e i documenti prodotti fuori, che
-- restano dove sono. Il sistema non li rigenera e non li tocca: un'offerta
-- tecnica firmata digitalmente non si riscrive.
--
-- Cosa hanno in meno: righe di prodotto, prezzo e firma non sono obbligatori
-- (AD-10). Il vincolo che impone la firma per accettare, giusto per il
-- commerciale, qui va reso condizionale all'origine: un ente pubblico non firma
-- un link.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Quello che una gara ha in più
-- -----------------------------------------------------------------------------

CREATE TYPE public.tender_outcome AS ENUM ('in_corso', 'vinta', 'persa', 'ritirata', 'annullata');

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS tender_subject text,
  ADD COLUMN IF NOT EXISTS tender_submission_deadline date,
  ADD COLUMN IF NOT EXISTS tender_estimated_value numeric(12,2) CHECK (tender_estimated_value IS NULL OR tender_estimated_value >= 0),
  ADD COLUMN IF NOT EXISTS tender_outcome public.tender_outcome,
  ADD COLUMN IF NOT EXISTS tender_outcome_note text,
  ADD COLUMN IF NOT EXISTS tender_reference text;

COMMENT ON COLUMN public.offers.tender_subject IS 'Oggetto della gara come lo scrive il bando, che di rado coincide con il nome di un nostro prodotto.';
COMMENT ON COLUMN public.offers.tender_submission_deadline IS 'Scadenza di presentazione: per una gara è la data che conta, e serve vederla prima che passi. Non è la validità dell''offerta, che vive sulla versione.';
COMMENT ON COLUMN public.offers.tender_estimated_value IS 'Valore stimato del bando, che esiste prima che esista un prezzo nostro: serve a decidere se partecipare.';
COMMENT ON COLUMN public.offers.tender_reference IS 'Il riferimento del bando (CIG, numero di procedura): è la chiave con cui l''ente ci risponde, e senza di essa una gara è irrintracciabile.';

-- I campi di gara hanno senso solo su un'offerta di gara: un'offerta
-- commerciale con una scadenza di presentazione è un dato che nessuno saprà
-- interpretare.
CREATE OR REPLACE FUNCTION public.guard_tender_fields_only_on_tenders()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origin <> 'tender' AND (
       NEW.tender_subject IS NOT NULL
    OR NEW.tender_submission_deadline IS NOT NULL
    OR NEW.tender_estimated_value IS NOT NULL
    OR NEW.tender_outcome IS NOT NULL
    OR NEW.tender_reference IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'I dati di gara si compilano solo su un''offerta con origine tender'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_offers_tender_fields
BEFORE INSERT OR UPDATE ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.guard_tender_fields_only_on_tenders();

GRANT UPDATE (tender_subject, tender_submission_deadline, tender_estimated_value, tender_outcome, tender_outcome_note, tender_reference)
  ON public.offers TO authenticated;


-- -----------------------------------------------------------------------------
-- 2) I documenti prodotti fuori
-- -----------------------------------------------------------------------------
-- Collegamenti, non copie: l'offerta tecnica di una gara sta su Drive, spesso
-- firmata digitalmente e in formati che non sono nostri. Il sistema registra
-- dove è e chi l'ha messa, e non la tocca.

CREATE TABLE public.offer_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (btrim(title) <> ''),
  external_url text NOT NULL CHECK (external_url ~* '^https?://'),
  kind text,
  note text,
  added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.offer_attachments IS 'Documenti dell''offerta prodotti fuori dal sistema, tipicamente su Drive (FR-33). Sono collegamenti e non copie: un documento firmato digitalmente perde valore se rigenerato, quindi il sistema registra dove sta e non lo tocca.';
COMMENT ON COLUMN public.offer_attachments.external_url IS 'Il vincolo verifica che sia un indirizzo http o https e non un percorso locale, che non sarebbe raggiungibile da nessun altro.';

CREATE INDEX idx_offer_attachments_offer_id ON public.offer_attachments(offer_id);

ALTER TABLE public.offer_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.offer_attachments FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.offer_attachments TO authenticated;
GRANT ALL ON public.offer_attachments TO service_role;

CREATE POLICY "Approved users can view offer attachments"
ON public.offer_attachments FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Offer managers can add attachments"
ON public.offer_attachments FOR INSERT TO authenticated
WITH CHECK (public.can_manage_offer(offer_id));

CREATE POLICY "Offer managers can remove attachments"
ON public.offer_attachments FOR DELETE TO authenticated
USING (public.can_manage_offer(offer_id));


-- -----------------------------------------------------------------------------
-- 3) La firma non è obbligatoria per una gara (AD-10)
-- -----------------------------------------------------------------------------
-- Il vincolo attuale impone l'immagine della firma per ogni accettazione. Sulle
-- offerte commerciali è la decisione presa il 14 agosto e resta; su una gara è
-- un impedimento, perché l'esito lo comunica l'ente con un provvedimento e non
-- tracciando un dito su un link.

ALTER TABLE public.offer_signatures
  DROP CONSTRAINT IF EXISTS offer_signatures_accepted_needs_signature_check;

CREATE OR REPLACE FUNCTION public.guard_signature_required_unless_tender()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _origin public.offer_origin;
BEGIN
  SELECT o.origin INTO _origin
    FROM public.offers o
    JOIN public.offer_versions v ON v.offer_id = o.id
   WHERE v.id = NEW.offer_version_id;

  IF NEW.decision = 'accettata'
     AND _origin <> 'tender'
     AND (NEW.signature_image_path IS NULL OR btrim(NEW.signature_image_path) = '') THEN
    RAISE EXCEPTION 'L''accettazione di un''offerta commerciale richiede la firma tracciata'
      USING errcode = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_offer_signatures_require_signature
BEFORE INSERT ON public.offer_signatures
FOR EACH ROW EXECUTE FUNCTION public.guard_signature_required_unless_tender();

COMMENT ON FUNCTION public.guard_signature_required_unless_tender() IS 'La firma tracciata resta obbligatoria per accettare un''offerta commerciale (decisione del 2026-08-14) e non lo è per le gare (AD-10), dove l''esito arriva da un provvedimento dell''ente. Sostituisce un CHECK di colonna, che non poteva leggere l''origine dell''offerta.';


-- La funzione che registra la decisione del cliente aveva lo stesso controllo
-- scritto a mano: va allineata, altrimenti rifiuterebbe prima che il trigger
-- possa distinguere il caso.
CREATE OR REPLACE FUNCTION public.record_offer_client_decision(
  _token text,
  _decision public.offer_client_decision,
  _signer_name text,
  _expected_document_hash text,
  _client_ip inet DEFAULT NULL,
  _user_agent text DEFAULT NULL,
  _signer_role text DEFAULT NULL,
  _signer_email text DEFAULT NULL,
  _signature_image_path text DEFAULT NULL,
  _reject_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _link public.offer_public_links;
  _offer public.offers;
  _version public.offer_versions;
  _document public.offer_version_documents;
  _signature public.offer_signatures;
  _ip inet;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'La decisione del cliente si registra solo da un processo di sistema (service role)';
  END IF;

  _ip := COALESCE(_client_ip, '0.0.0.0'::inet);

  SELECT * INTO _link FROM public.offer_public_links WHERE token = _token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link non valido';
  END IF;
  IF _link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Link revocato';
  END IF;
  IF _link.expires_at IS NOT NULL AND _link.expires_at < now() THEN
    RAISE EXCEPTION 'Link scaduto';
  END IF;

  SELECT * INTO _offer FROM public.offers WHERE id = _link.offer_id;

  SELECT * INTO _version
    FROM public.offer_versions
   WHERE id = _offer.current_version_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questa offerta non ha una versione corrente';
  END IF;

  IF _version.status NOT IN ('inviata', 'vista') THEN
    RAISE EXCEPTION 'La versione non è accettabile nello stato %', _version.status
      USING errcode = 'check_violation';
  END IF;

  SELECT * INTO _document FROM public.offer_version_documents WHERE offer_version_id = _version.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento congelato assente per la versione %', _version.id;
  END IF;

  IF _document.snapshot_hash <> _expected_document_hash THEN
    RAISE EXCEPTION 'Il documento è cambiato da quando è stato aperto: ricaricare la pagina prima di firmare'
      USING errcode = 'check_violation';
  END IF;

  -- Firma obbligatoria per il commerciale, facoltativa per le gare (AD-10).
  IF _decision = 'accettata'
     AND _offer.origin <> 'tender'
     AND (_signature_image_path IS NULL OR btrim(_signature_image_path) = '') THEN
    RAISE EXCEPTION 'L''accettazione richiede la firma';
  END IF;

  INSERT INTO public.offer_signatures (
    offer_version_id, public_link_id, decision, signer_name, signer_role, signer_email,
    signature_image_path, document_hash, client_ip, user_agent, reject_reason
  ) VALUES (
    _version.id, _link.id, _decision, btrim(_signer_name), nullif(btrim(_signer_role), ''), nullif(btrim(_signer_email), ''),
    _signature_image_path, _document.snapshot_hash, _ip, _user_agent, nullif(btrim(_reject_reason), '')
  )
  RETURNING * INTO _signature;

  PERFORM public.set_offer_version_status(
    _version.id,
    CASE WHEN _decision = 'accettata' THEN 'accettata'::public.offer_status ELSE 'rifiutata'::public.offer_status END,
    CASE WHEN _decision = 'accettata' THEN 'firmata' ELSE 'rifiutata' END,
    'client', NULL, _token, _ip,
    CASE WHEN _decision = 'accettata'
         THEN format('firmata da %s%s', btrim(_signer_name), COALESCE(' (' || nullif(btrim(_signer_role), '') || ')', ''))
         ELSE nullif(btrim(_reject_reason), '') END
  );

  RETURN jsonb_build_object(
    'signature_id', _signature.id,
    'offer_version_id', _version.id,
    'decision', _signature.decision,
    'document_hash', _signature.document_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_offer_client_decision(text, public.offer_client_decision, text, text, inet, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_offer_client_decision(text, public.offer_client_decision, text, text, inet, text, text, text, text, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 4) Le scadenze che contano
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.tender_pipeline AS
SELECT
  o.id AS offer_id,
  o.year,
  o.number,
  o.client_id,
  c.name AS client_name,
  o.tender_subject,
  o.tender_reference,
  o.tender_submission_deadline,
  o.tender_submission_deadline - current_date AS giorni_alla_scadenza,
  o.tender_estimated_value,
  COALESCE(o.tender_outcome, 'in_corso') AS tender_outcome,
  v.status AS stato_versione,
  v.offered_total,
  (SELECT count(*) FROM public.offer_attachments a WHERE a.offer_id = o.id) AS allegati
FROM public.offers o
JOIN public.clients c ON c.id = o.client_id
LEFT JOIN public.offer_versions v ON v.id = o.current_version_id
WHERE o.origin = 'tender';

COMMENT ON VIEW public.tender_pipeline IS 'Le gare con la scadenza di presentazione e i giorni che restano (FR-32). Una gara persa per una scadenza dimenticata è il solo modo di perderla senza nemmeno provarci.';

ALTER VIEW public.tender_pipeline SET (security_invoker = on);
GRANT SELECT ON public.tender_pipeline TO authenticated;


CREATE OR REPLACE FUNCTION public.notify_tender_deadlines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
  _dest RECORD;
  _inviate integer := 0;
BEGIN
  SELECT count(*) INTO _n
    FROM public.tender_pipeline
   WHERE tender_outcome = 'in_corso'
     AND tender_submission_deadline IS NOT NULL
     AND tender_submission_deadline BETWEEN current_date AND current_date + 7;

  IF _n = 0 THEN
    RETURN 0;
  END IF;

  FOR _dest IN
    SELECT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('admin', 'account') AND p.approved = true AND p.deleted_at IS NULL
  LOOP
    PERFORM public.notify_user_if_enabled(
      _dest.user_id,
      'tender_deadline',
      format('%s gare in scadenza entro sette giorni', _n),
      format('Ci sono %s gare la cui presentazione scade entro sette giorni.', _n),
      NULL
    );
    _inviate := _inviate + 1;
  END LOOP;

  RETURN _inviate;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_tender_deadlines() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_tender_deadlines() TO service_role;
