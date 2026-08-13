-- =============================================================================
-- B5 — Link pubblico, documento congelato, accettazione e firma del cliente
-- =============================================================================
-- Copre FR-15 (condizioni congelate e pertinenti), FR-16 (link con token),
-- FR-17 (firma tracciata), FR-42 (la firma vale sulla versione firmata) e la
-- parte di FR-47 che riguarda apertura e firma. Realizza AD-5 (attore client),
-- AD-6 (solo la versione corrente è accettabile), AD-12 (la pagina pubblica
-- legge solo attraverso una funzione che risolve il token).
--
-- Il pezzo che mancava al primo rilascio: fino a qui l'offerta si compone ma
-- non esce. Il disegno segue tre scelte, tutte imposte dal database e non
-- dall'applicazione:
--
-- 1) Il token vive sull'OFFERTA, non sulla versione. Un link già mandato al
--    cliente continua a funzionare quando nasce una versione nuova, e mostra
--    sempre la corrente (AD-6). L'accettazione invece si attacca alla versione
--    puntuale (FR-42): è il documento che si firma, non la trattativa.
--
-- 2) Il documento firmato è uno SNAPSHOT immutabile in jsonb, congelato alla
--    prima uscita dalla bozza, con il proprio hash. Il PDF si genera da lì e
--    non dalle tabelle vive: senza questo, "il PDF archiviato è la versione che
--    il cliente ha visto" resterebbe una speranza. Le condizioni congelate sono
--    solo quelle pertinenti ai prodotti offerti (FR-15), non sette pagine
--    identiche su ogni preventivo come oggi.
--
-- 3) L'accettazione richiede sempre una firma disegnata, e la firma registra
--    nominativo, ruolo, IP, user agent, istante e l'hash del documento visto,
--    come fa un servizio di firma (SignRequest, Yousign): l'hash è ciò che
--    permette di dimostrare a posteriori CHE COSA è stato firmato, non solo
--    quando.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Condizioni: pertinenti al prodotto, più un blocco generale
-- -----------------------------------------------------------------------------
-- FR-15 chiede che le condizioni allegate siano solo quelle pertinenti ai
-- prodotti offerti. Servono quindi due sorgenti: un testo per prodotto (nuovo)
-- e un blocco generale valido per tutti (in app_settings, come le soglie di
-- approvazione). Nessuna tabella nuova: products si estende (AD-16).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS terms_text text;

COMMENT ON COLUMN public.products.terms_text IS 'Condizioni contrattuali pertinenti a questo prodotto, allegate all''offerta solo quando il prodotto è presente tra le righe (FR-15). NULL = nessuna condizione specifica oltre a quelle generali.';

INSERT INTO public.app_settings (setting_key, setting_value, description) VALUES (
  'offer_general_terms',
  '{"text": ""}'::jsonb,
  'Condizioni generali allegate a ogni offerta, congelate nello snapshot al momento dell''invio (FR-15). Le condizioni specifiche dei singoli prodotti stanno su products.terms_text.'
) ON CONFLICT (setting_key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2) offer_public_links — il link con token, revocabile e a scadenza
-- -----------------------------------------------------------------------------
-- Il token è generato dal database con gen_random_bytes(32): 256 bit, non
-- indovinabile e non derivabile dall'id dell'offerta. Un token per riga e più
-- righe nel tempo (revoca e rigenerazione), perché "il token è revocabile"
-- (FR-16) e un token revocato deve restare leggibile negli accessi già
-- registrati: cancellare la riga cancellerebbe la storia.

CREATE TABLE public.offer_public_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT offer_public_links_token_length_check CHECK (length(token) >= 32),
  CONSTRAINT offer_public_links_revoked_shape_check CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL) OR revoked_at IS NOT NULL
  )
);

COMMENT ON TABLE public.offer_public_links IS 'Link pubblici con token verso un''offerta (FR-16). Il token è sull''offerta e non sulla versione: risolve sempre la versione corrente (AD-6), così un link già inviato resta valido quando nasce una revisione. Righe append-only nella pratica: si revoca (revoked_at) e se serve si crea un link nuovo, non si cancella.';
COMMENT ON COLUMN public.offer_public_links.expires_at IS 'Scadenza del link, indipendente da offer_versions.valid_until (che è la validità commerciale dell''offerta). NULL = il link non scade da sé.';

CREATE UNIQUE INDEX idx_offer_public_links_one_active_per_offer
  ON public.offer_public_links(offer_id)
  WHERE revoked_at IS NULL;

COMMENT ON INDEX public.idx_offer_public_links_one_active_per_offer IS 'Un solo link attivo per offerta: due link vivi contemporaneamente renderebbero la revoca una falsa sicurezza (si revoca quello noto e il cliente entra con l''altro).';

CREATE INDEX idx_offer_public_links_offer_id ON public.offer_public_links(offer_id);


-- -----------------------------------------------------------------------------
-- 3) offer_public_link_accesses — ogni apertura, non solo la prima
-- -----------------------------------------------------------------------------
-- La transizione a 'vista' avviene una volta sola (ed è quella che genera la
-- notifica, FR-47: "una sola notifica per versione, non una per ogni visita").
-- Ma per un contenzioso serve sapere quante volte e quando il cliente ha
-- aperto: questa tabella è il registro completo, offer_events resta il registro
-- delle transizioni.

CREATE TABLE public.offer_public_link_accesses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  public_link_id uuid NOT NULL REFERENCES public.offer_public_links(id) ON DELETE CASCADE,
  offer_version_id uuid REFERENCES public.offer_versions(id) ON DELETE SET NULL,
  client_ip inet,
  user_agent text,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'revocato', 'scaduto', 'non_trovato')),
  accessed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.offer_public_link_accesses IS 'Registro di ogni apertura del link pubblico, compresi i tentativi respinti (token revocato o scaduto): serve a distinguere "il cliente non ha mai aperto" da "il cliente ha provato e il link era morto". Append-only.';
COMMENT ON COLUMN public.offer_public_link_accesses.offer_version_id IS 'Versione mostrata a quell''accesso: cambia nel tempo se nasce una revisione, quindi va registrata per accesso e non dedotta.';

CREATE INDEX idx_offer_public_link_accesses_link_id ON public.offer_public_link_accesses(public_link_id);
CREATE INDEX idx_offer_public_link_accesses_version_id ON public.offer_public_link_accesses(offer_version_id);


-- -----------------------------------------------------------------------------
-- 4) offer_version_documents — lo snapshot congelato e il suo hash
-- -----------------------------------------------------------------------------
-- Una riga per versione. Lo snapshot si scrive alla prima uscita dalla bozza e
-- si riscrive solo se la versione torna in bozza (respinta) e riesce: in quel
-- caso il contenuto è legittimamente cambiato, l'hash cambia con lui e il PDF
-- già generato viene invalidato.
--
-- L'hash è sha256 del jsonb serializzato. jsonb in Postgres normalizza l'ordine
-- delle chiavi, quindi la serializzazione è deterministica e l'hash è
-- riproducibile: si può ricalcolare a distanza di anni e confrontarlo con
-- quello registrato nella firma.

CREATE TABLE public.offer_version_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_version_id uuid NOT NULL UNIQUE REFERENCES public.offer_versions(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  pdf_path text,
  pdf_generated_at timestamptz,
  CONSTRAINT offer_version_documents_pdf_shape_check CHECK (
    (pdf_path IS NULL AND pdf_generated_at IS NULL)
    OR (pdf_path IS NOT NULL AND pdf_generated_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.offer_version_documents IS 'Documento congelato di una versione di offerta: lo snapshot jsonb di tutto ciò che il cliente vede (righe, totali, piano di pagamento, condizioni pertinenti) più il suo hash sha256. Il PDF si genera da questo snapshot, non dalle tabelle vive, così "il PDF archiviato è la versione che il cliente ha visto" è una proprietà e non una speranza.';
COMMENT ON COLUMN public.offer_version_documents.snapshot_hash IS 'sha256 di snapshot::text. jsonb normalizza l''ordine delle chiavi, quindi l''hash è ricalcolabile e verificabile a posteriori. È il valore che offer_signatures.document_hash deve riprodurre.';
COMMENT ON COLUMN public.offer_version_documents.pdf_path IS 'Path nel bucket privato offer-documents. NULL finché il PDF non è stato generato: lo snapshot esiste da subito, il PDF è materializzazione.';

CREATE INDEX idx_offer_version_documents_version_id ON public.offer_version_documents(offer_version_id);

-- Immutabilità: stesso meccanismo del flag di transazione già usato per
-- offer_versions.status (20260813120000), e per la stessa ragione: lega la
-- scrittura al codice che l'ha prodotta e non al suo risultato. Le funzioni
-- autorizzate accendono il flag immediatamente prima di scrivere e lo spengono
-- subito dopo.
CREATE OR REPLACE FUNCTION public.guard_offer_version_document_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.offer_document_write_allowed', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'offer_version_documents si scrive solo tramite public.freeze_offer_version_document() o public.attach_offer_version_pdf()'
      USING errcode = 'check_violation';
  END IF;
  RETURN CASE WHEN tg_op = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER guard_offer_version_documents_write
BEFORE INSERT OR UPDATE OR DELETE ON public.offer_version_documents
FOR EACH ROW EXECUTE FUNCTION public.guard_offer_version_document_immutable();


-- -----------------------------------------------------------------------------
-- 5) offer_signatures — accettazione e rifiuto tracciati
-- -----------------------------------------------------------------------------
-- Una riga per decisione del cliente. Append-only: una firma che si può
-- modificare non è una firma.

CREATE TYPE public.offer_client_decision AS ENUM ('accettata', 'rifiutata');

CREATE TABLE public.offer_signatures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_version_id uuid NOT NULL REFERENCES public.offer_versions(id) ON DELETE CASCADE,
  public_link_id uuid NOT NULL REFERENCES public.offer_public_links(id) ON DELETE RESTRICT,
  decision public.offer_client_decision NOT NULL,
  signer_name text NOT NULL,
  signer_role text,
  signer_email text,
  signature_image_path text,
  document_hash text NOT NULL,
  client_ip inet NOT NULL,
  user_agent text,
  reject_reason text,
  signed_pdf_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_signatures_signer_name_check CHECK (btrim(signer_name) <> ''),
  CONSTRAINT offer_signatures_accepted_needs_signature_check CHECK (
    decision <> 'accettata' OR (signature_image_path IS NOT NULL AND btrim(signature_image_path) <> '')
  )
);

COMMENT ON TABLE public.offer_signatures IS 'Decisione del cliente su una versione di offerta (FR-17, FR-42), con firma disegnata, identità dichiarata e tracce tecniche. Append-only: nessuna policy né privilegio di UPDATE o DELETE, per nessun ruolo applicativo.';
COMMENT ON COLUMN public.offer_signatures.document_hash IS 'Hash del documento effettivamente mostrato al firmatario, copiato da offer_version_documents.snapshot_hash al momento della firma. Se lo snapshot venisse rigenerato, il confronto rivelerebbe che la firma si riferisce a un contenuto diverso.';
COMMENT ON COLUMN public.offer_signatures.signature_image_path IS 'PNG della firma tracciata, nel bucket privato offer-documents. Obbligatorio per l''accettazione (offer_signatures_accepted_needs_signature_check), non per il rifiuto: a chi rifiuta non si chiede di firmare.';
COMMENT ON COLUMN public.offer_signatures.client_ip IS 'IP di provenienza. 0.0.0.0 significa "non rilevabile dagli header della richiesta", non "sconosciuto per errore": il vincolo di forma di offer_events impone un IP per gli attori di tipo client, e bloccare una firma perché manca un header sarebbe peggio.';

CREATE UNIQUE INDEX idx_offer_signatures_one_acceptance_per_version
  ON public.offer_signatures(offer_version_id)
  WHERE decision = 'accettata';

COMMENT ON INDEX public.idx_offer_signatures_one_acceptance_per_version IS 'Una sola accettazione per versione, imposta dal database e non da un controllo applicativo: due click ravvicinati del cliente non producono due firme (AD-8 applicato alla firma).';

CREATE INDEX idx_offer_signatures_version_id ON public.offer_signatures(offer_version_id);
CREATE INDEX idx_offer_signatures_link_id ON public.offer_signatures(public_link_id);

CREATE OR REPLACE FUNCTION public.guard_offer_signatures_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF tg_op = 'UPDATE' THEN
    -- Unica eccezione: attaccare il PDF firmato a una firma che non ne ha
    -- ancora uno. Il PDF nasce dopo la riga (va generato e caricato), e senza
    -- questa eccezione servirebbe una seconda tabella per un solo campo.
    IF current_setting('app.offer_signature_pdf_write_allowed', true) = 'on'
       AND OLD.signed_pdf_path IS NULL
       AND NEW.signed_pdf_path IS NOT NULL
       AND to_jsonb(NEW) - 'signed_pdf_path' = to_jsonb(OLD) - 'signed_pdf_path' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'offer_signatures non si modifica: una firma modificabile non è una firma'
      USING errcode = 'check_violation';
  END IF;
  RAISE EXCEPTION 'offer_signatures non si elimina'
    USING errcode = 'check_violation';
END;
$$;

CREATE TRIGGER guard_offer_signatures_append_only
BEFORE UPDATE OR DELETE ON public.offer_signatures
FOR EACH ROW EXECUTE FUNCTION public.guard_offer_signatures_append_only();


-- -----------------------------------------------------------------------------
-- 6) Lo snapshot: costruzione, congelamento, PDF
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.build_offer_version_snapshot(_offer_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _snapshot jsonb;
BEGIN
  SELECT jsonb_build_object(
    'schema_version', 1,
    'offer', jsonb_build_object(
      'id', o.id,
      'year', o.year,
      'number', o.number,
      'reference', format('%s/%s', o.year, o.number),
      'origin', o.origin
    ),
    'client', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'email', c.email
    ),
    'version', jsonb_build_object(
      'id', ov.id,
      'version_number', ov.version_number,
      'billing_mode', ov.billing_mode,
      'list_total', ov.list_total,
      'offered_total', ov.offered_total,
      'effective_discount_percentage', round(public.get_offer_version_effective_discount_percentage(ov.id), 2),
      'payment_terms_text', ov.payment_terms,
      'valid_until', ov.valid_until
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'description', l.description,
               'product_code', p.code,
               'product_name', p.name,
               'revenue_category', l.revenue_category,
               'quantity', l.quantity,
               'unit_list_price', l.unit_list_price,
               'discount_percentage', l.discount_percentage,
               'vat_rate', l.vat_rate,
               'line_total', l.line_total
             ) ORDER BY l.display_order, l.description)
        FROM public.offer_lines l
        LEFT JOIN public.products p ON p.id = l.product_id
       WHERE l.offer_version_id = ov.id
    ), '[]'::jsonb),
    'payment_plan', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'amount', t.amount,
               'percentage', t.percentage,
               'maturity_event', t.maturity_event,
               'scheduled_date', t.scheduled_date,
               'phase_label', t.phase_label,
               'payment_term_label', pt.label,
               'payment_term_days', pt.days,
               'payment_term_due_basis', pt.due_basis
             ) ORDER BY t.display_order, t.created_at)
        FROM public.offer_payment_terms t
        JOIN public.payment_terms pt ON pt.id = t.payment_term_id
       WHERE t.offer_version_id = ov.id
    ), '[]'::jsonb),
    -- FR-15: le condizioni pertinenti sono quelle dei prodotti effettivamente
    -- offerti, deduplicate, più il blocco generale. Un prodotto senza
    -- terms_text non contribuisce: è così che si evitano le sette pagine
    -- identiche su ogni preventivo.
    'terms', jsonb_build_object(
      'general', COALESCE((SELECT setting_value->>'text' FROM public.app_settings WHERE setting_key = 'offer_general_terms'), ''),
      'specific', COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object('product_name', p.name, 'text', p.terms_text))
          FROM public.offer_lines l
          JOIN public.products p ON p.id = l.product_id
         WHERE l.offer_version_id = ov.id
           AND p.terms_text IS NOT NULL
           AND btrim(p.terms_text) <> ''
      ), '[]'::jsonb)
    )
  )
  INTO _snapshot
  FROM public.offer_versions ov
  JOIN public.offers o ON o.id = ov.offer_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE ov.id = _offer_version_id;

  IF _snapshot IS NULL THEN
    RAISE EXCEPTION 'Versione offerta % non trovata', _offer_version_id;
  END IF;

  RETURN _snapshot;
END;
$$;

COMMENT ON FUNCTION public.build_offer_version_snapshot(uuid) IS 'Costruisce il documento jsonb di una versione: tutto ciò che il cliente deve vedere, niente di più (nessun dato di margine, nessun riferimento interno). Non scrive: il congelamento è di freeze_offer_version_document.';

REVOKE ALL ON FUNCTION public.build_offer_version_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_offer_version_snapshot(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.freeze_offer_version_document(_offer_version_id uuid)
RETURNS public.offer_version_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _snapshot jsonb;
  _hash text;
  _row public.offer_version_documents;
BEGIN
  _snapshot := public.build_offer_version_snapshot(_offer_version_id);
  _hash := encode(extensions.digest(_snapshot::text, 'sha256'), 'hex');

  PERFORM set_config('app.offer_document_write_allowed', 'on', true);

  INSERT INTO public.offer_version_documents (offer_version_id, snapshot, snapshot_hash)
  VALUES (_offer_version_id, _snapshot, _hash)
  ON CONFLICT (offer_version_id) DO UPDATE
    SET snapshot = EXCLUDED.snapshot,
        snapshot_hash = EXCLUDED.snapshot_hash,
        frozen_at = now(),
        -- Il PDF già generato apparteneva al contenuto precedente: se l'hash
        -- cambia va rigenerato, altrimenti resterebbe archiviato un PDF che
        -- non corrisponde più a nulla.
        pdf_path = CASE WHEN public.offer_version_documents.snapshot_hash = EXCLUDED.snapshot_hash
                        THEN public.offer_version_documents.pdf_path ELSE NULL END,
        pdf_generated_at = CASE WHEN public.offer_version_documents.snapshot_hash = EXCLUDED.snapshot_hash
                                THEN public.offer_version_documents.pdf_generated_at ELSE NULL END
  RETURNING * INTO _row;

  PERFORM set_config('app.offer_document_write_allowed', 'off', true);

  RETURN _row;
END;
$$;

COMMENT ON FUNCTION public.freeze_offer_version_document(uuid) IS 'Congela il documento di una versione. Chiamata da set_offer_version_status alla prima uscita dalla bozza, e di nuovo se una versione respinta torna in bozza e riesce: in quel caso il contenuto è cambiato legittimamente, e il PDF generato sul contenuto vecchio viene invalidato.';

REVOKE ALL ON FUNCTION public.freeze_offer_version_document(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_offer_version_document(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.attach_offer_version_pdf(
  _offer_version_id uuid,
  _pdf_path text,
  _expected_snapshot_hash text DEFAULT NULL
)
RETURNS public.offer_version_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.offer_version_documents;
BEGIN
  SELECT * INTO _row FROM public.offer_version_documents WHERE offer_version_id = _offer_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nessun documento congelato per la versione %: il PDF non può precedere lo snapshot', _offer_version_id;
  END IF;

  -- Chi genera il PDF ha letto uno snapshot preciso. Se nel frattempo è
  -- cambiato, quel PDF non è più il documento di questa versione e va
  -- rifiutato: allegarlo comunque significherebbe archiviare come "firmato"
  -- un file che mostra numeri diversi da quelli correnti.
  IF _expected_snapshot_hash IS NOT NULL AND _row.snapshot_hash <> _expected_snapshot_hash THEN
    RAISE EXCEPTION 'Il documento è cambiato mentre il PDF veniva generato (atteso %, corrente %)', _expected_snapshot_hash, _row.snapshot_hash;
  END IF;

  IF _row.pdf_path IS NOT NULL THEN
    RETURN _row; -- idempotente: un secondo tentativo non sovrascrive l'archiviato
  END IF;

  PERFORM set_config('app.offer_document_write_allowed', 'on', true);

  UPDATE public.offer_version_documents
     SET pdf_path = _pdf_path,
         pdf_generated_at = now()
   WHERE offer_version_id = _offer_version_id
  RETURNING * INTO _row;

  PERFORM set_config('app.offer_document_write_allowed', 'off', true);

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_offer_version_pdf(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_offer_version_pdf(uuid, text, text) TO service_role;


CREATE OR REPLACE FUNCTION public.attach_offer_signature_pdf(_signature_id uuid, _pdf_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.offer_signature_pdf_write_allowed', 'on', true);

  UPDATE public.offer_signatures
     SET signed_pdf_path = _pdf_path
   WHERE id = _signature_id
     AND signed_pdf_path IS NULL;

  PERFORM set_config('app.offer_signature_pdf_write_allowed', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_offer_signature_pdf(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_offer_signature_pdf(uuid, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 7) Notifiche di apertura e di decisione (FR-47)
-- -----------------------------------------------------------------------------
-- Destinatari: chi ha composto la versione e l'account del cliente. Alla firma
-- si aggiunge l'amministrazione, che da quel momento ha lavoro in coda: i ruoli
-- finance, e in loro assenza gli admin, perché un avviso che non raggiunge
-- nessuno è peggio di un avviso ridondante.

CREATE OR REPLACE FUNCTION public.notify_offer_client_activity(
  _offer_version_id uuid,
  _kind text,
  _detail text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _composer_id uuid;
  _account_id uuid;
  _project_id uuid;
  _year integer;
  _number integer;
  _version_number integer;
  _client_name text;
  _offered_total numeric;
  _type text;
  _title text;
  _message text;
  _recipients uuid[];
  _recipient uuid;
  _admin RECORD;
BEGIN
  SELECT ov.created_by, c.account_user_id, o.project_id, o.year, o.number,
         ov.version_number, c.name, ov.offered_total
    INTO _composer_id, _account_id, _project_id, _year, _number,
         _version_number, _client_name, _offered_total
  FROM public.offer_versions ov
  JOIN public.offers o ON o.id = ov.offer_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE ov.id = _offer_version_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF _kind = 'viewed' THEN
    _type := 'offer_viewed';
    _title := format('Offerta %s/%s aperta dal cliente', _year, _number);
    _message := format('%s ha aperto l''offerta %s/%s (v%s).', _client_name, _year, _number, _version_number);
  ELSIF _kind = 'signed' THEN
    _type := 'offer_signed';
    _title := format('Offerta %s/%s accettata e firmata', _year, _number);
    _message := format('%s ha accettato e firmato l''offerta %s/%s (v%s) per %s €.%s',
                       _client_name, _year, _number, _version_number, _offered_total,
                       CASE WHEN _detail IS NOT NULL THEN ' Firmatario: ' || _detail || '.' ELSE '' END);
  ELSIF _kind = 'rejected' THEN
    _type := 'offer_rejected';
    _title := format('Offerta %s/%s rifiutata dal cliente', _year, _number);
    _message := format('%s ha rifiutato l''offerta %s/%s (v%s).%s',
                       _client_name, _year, _number, _version_number,
                       CASE WHEN _detail IS NOT NULL THEN ' Motivo: ' || _detail || '.' ELSE '' END);
  ELSE
    RAISE EXCEPTION 'Tipo di attività cliente non riconosciuto: %', _kind;
  END IF;

  _recipients := ARRAY[]::uuid[];
  IF _composer_id IS NOT NULL THEN
    _recipients := _recipients || _composer_id;
  END IF;
  IF _account_id IS NOT NULL AND NOT (_account_id = ANY(_recipients)) THEN
    _recipients := _recipients || _account_id;
  END IF;

  -- Alla firma avvisa anche l'amministrazione (FR-47).
  IF _kind = 'signed' THEN
    FOR _admin IN
      SELECT ur.user_id
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.role = 'finance'
        AND p.approved = true
        AND p.deleted_at IS NULL
    LOOP
      IF NOT (_admin.user_id = ANY(_recipients)) THEN
        _recipients := _recipients || _admin.user_id;
      END IF;
    END LOOP;

    -- Nessun ruolo finance configurato: l'avviso va agli admin, perché una
    -- firma di cui nessuno in amministrazione sa nulla è il guasto che questa
    -- notifica esiste per evitare.
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.role = 'finance' AND p.approved = true AND p.deleted_at IS NULL
    ) THEN
      FOR _admin IN
        SELECT ur.user_id
        FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
        WHERE ur.role = 'admin'
          AND p.approved = true
          AND p.deleted_at IS NULL
      LOOP
        IF NOT (_admin.user_id = ANY(_recipients)) THEN
          _recipients := _recipients || _admin.user_id;
        END IF;
      END LOOP;
    END IF;
  END IF;

  FOREACH _recipient IN ARRAY _recipients LOOP
    PERFORM public.notify_user_if_enabled(_recipient, _type, _title, _message, _project_id);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.notify_offer_client_activity(uuid, text, text) IS 'Notifiche di apertura, firma e rifiuto (FR-47). L''apertura ne genera una sola per versione perché la transizione inviata->vista avviene una volta sola: le visite successive restano in offer_public_link_accesses senza avvisare nessuno.';

REVOKE ALL ON FUNCTION public.notify_offer_client_activity(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_offer_client_activity(uuid, text, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 8) set_offer_version_status — terza revisione: congela e notifica il cliente
-- -----------------------------------------------------------------------------
-- Aggiunge alla versione di 20260813150000 due sole cose, entrambe legate al
-- fatto che ora l'offerta esce davvero:
--  - il congelamento del documento alla prima uscita dalla bozza (dopo la
--    quadratura: se il piano di pagamento non torna, non si congela nulla);
--  - le notifiche di apertura, firma e rifiuto, nello stesso blocco protetto
--    da EXCEPTION delle altre: un avviso che non parte non annulla una
--    transizione valida.

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

  -- Quadratura: solo alla prima uscita dalla bozza, sullo stato EFFETTIVO.
  IF _old_status = 'bozza' AND _final_status <> 'bozza' THEN
    PERFORM public.validate_offer_payment_terms_balance(_offer_version_id);
  END IF;

  PERFORM set_config('app.offer_status_transition_allowed', 'on', true);

  UPDATE public.offer_versions
     SET status = _final_status
   WHERE id = _offer_version_id;

  PERFORM set_config('app.offer_status_transition_allowed', 'off', true);

  -- Congelamento del documento: dopo la quadratura e dopo l'UPDATE, così lo
  -- snapshot riflette lo stato raggiunto. Non è dentro il blocco protetto
  -- delle notifiche: se il documento non si può congelare, l'offerta NON deve
  -- uscire, perché uscirebbe senza un documento firmabile.
  IF _old_status = 'bozza' AND _final_status <> 'bozza' THEN
    PERFORM public.freeze_offer_version_document(_offer_version_id);
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

COMMENT ON FUNCTION public.set_offer_version_status(uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text) IS 'Unico varco per cambiare offer_versions.status. Oltre a quadratura, soglie di approvazione e notifiche interne (20260813140000, 20260813150000): congela il documento alla prima uscita dalla bozza (freeze_offer_version_document) e notifica apertura, firma e rifiuto del cliente (FR-47).';

REVOKE ALL ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 9) Creare e revocare il link
-- -----------------------------------------------------------------------------
-- Il token non si genera lato applicazione: se lo facesse il client, la qualità
-- della casualità dipenderebbe dal browser e il token trafficherebbe in chiaro
-- prima di essere salvato. Qui nasce e resta nel database.

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
  _has_sent_version boolean;
BEGIN
  IF NOT public.can_manage_offer(_offer_id) THEN
    RAISE EXCEPTION 'Non autorizzato a generare il link di questa offerta';
  END IF;

  -- Un link verso un'offerta che non è mai uscita mostrerebbe una bozza: è il
  -- modo più diretto di far vedere al cliente numeri non ancora decisi.
  SELECT EXISTS (
    SELECT 1 FROM public.offer_versions ov
    WHERE ov.offer_id = _offer_id AND ov.status <> 'bozza'
  ) INTO _has_sent_version;

  IF NOT _has_sent_version THEN
    RAISE EXCEPTION 'L''offerta non ha nessuna versione uscita dalla bozza: inviala prima di generare il link';
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

COMMENT ON FUNCTION public.create_offer_public_link(uuid, integer) IS 'Genera il link pubblico di un''offerta, revocando quello attivo (un solo link vivo per offerta). Richiede almeno una versione uscita dalla bozza: un link su una bozza mostrerebbe al cliente numeri non ancora decisi.';

REVOKE ALL ON FUNCTION public.create_offer_public_link(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_offer_public_link(uuid, integer) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.revoke_offer_public_link(_public_link_id uuid)
RETURNS public.offer_public_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.offer_public_links;
  _offer_id uuid;
BEGIN
  SELECT offer_id INTO _offer_id FROM public.offer_public_links WHERE id = _public_link_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link % non trovato', _public_link_id;
  END IF;

  IF NOT public.can_manage_offer(_offer_id) THEN
    RAISE EXCEPTION 'Non autorizzato a revocare il link di questa offerta';
  END IF;

  UPDATE public.offer_public_links
     SET revoked_at = COALESCE(revoked_at, now()),
         revoked_by = COALESCE(revoked_by, auth.uid())
   WHERE id = _public_link_id
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_offer_public_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_offer_public_link(uuid) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 10) resolve_offer_public_link — quello che vede il cliente
-- -----------------------------------------------------------------------------
-- Riservata al service role: la chiama l'edge function, mai il browser del
-- cliente (AD-12). Fa quattro cose in una transazione: risolve il token,
-- registra l'accesso, porta a 'vista' la prima apertura e restituisce il
-- documento congelato. La scadenza commerciale si applica qui, alla lettura:
-- senza un cron che marchi le offerte scadute, il momento in cui la scadenza
-- conta davvero è quando qualcuno prova a guardare l'offerta.

CREATE OR REPLACE FUNCTION public.resolve_offer_public_link(
  _token text,
  _client_ip inet DEFAULT NULL,
  _user_agent text DEFAULT NULL
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
  _outcome text;
  _signable boolean;
  _reason text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'La risoluzione del link pubblico passa solo da un processo di sistema (service role)';
  END IF;

  _ip := COALESCE(_client_ip, '0.0.0.0'::inet);

  SELECT * INTO _link FROM public.offer_public_links WHERE token = _token;

  IF NOT FOUND THEN
    -- Nessun accesso registrabile: senza link non c'è una FK a cui appenderlo.
    -- Il tentativo su token inesistente resta comunque visibile nei log della
    -- edge function.
    RETURN jsonb_build_object('outcome', 'non_trovato');
  END IF;

  IF _link.revoked_at IS NOT NULL THEN
    _outcome := 'revocato';
  ELSIF _link.expires_at IS NOT NULL AND _link.expires_at < now() THEN
    _outcome := 'scaduto';
  ELSE
    _outcome := 'ok';
  END IF;

  SELECT * INTO _offer FROM public.offers WHERE id = _link.offer_id;
  SELECT * INTO _version FROM public.offer_versions WHERE id = _offer.current_version_id;

  INSERT INTO public.offer_public_link_accesses (public_link_id, offer_version_id, client_ip, user_agent, outcome)
  VALUES (_link.id, _version.id, _ip, _user_agent, _outcome);

  IF _outcome <> 'ok' THEN
    RETURN jsonb_build_object('outcome', _outcome);
  END IF;

  IF _version.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'non_trovato');
  END IF;

  -- Scadenza commerciale: applicata alla lettura, con attore 'system' perché
  -- non la compie né noi né il cliente, la compie il calendario.
  IF _version.valid_until IS NOT NULL
     AND _version.valid_until < current_date
     AND _version.status IN ('inviata', 'vista') THEN
    PERFORM public.set_offer_version_status(
      _version.id, 'scaduta', 'scaduta', 'system', NULL, NULL, NULL,
      format('validità superata il %s', _version.valid_until)
    );
    SELECT * INTO _version FROM public.offer_versions WHERE id = _version.id;
  END IF;

  -- Prima apertura: inviata -> vista, con attore client (token + IP).
  IF _version.status = 'inviata' THEN
    PERFORM public.set_offer_version_status(
      _version.id, 'vista', 'vista', 'client', NULL, _token, _ip, NULL
    );
    SELECT * INTO _version FROM public.offer_versions WHERE id = _version.id;
  END IF;

  SELECT * INTO _document FROM public.offer_version_documents WHERE offer_version_id = _version.id;

  IF _document.id IS NULL THEN
    -- Una versione uscita dalla bozza ha sempre il suo snapshot; se manca, il
    -- congelamento è stato saltato e mostrare le tabelle vive al cliente
    -- sarebbe esattamente ciò che lo snapshot esiste per impedire.
    RETURN jsonb_build_object('outcome', 'documento_assente');
  END IF;

  SELECT * INTO _signature
    FROM public.offer_signatures
   WHERE offer_version_id = _version.id
   ORDER BY created_at DESC LIMIT 1;

  _signable := _version.status IN ('inviata', 'vista');
  _reason := CASE
    WHEN _signable THEN NULL
    WHEN _version.status = 'accettata' THEN 'Questa offerta è già stata accettata.'
    WHEN _version.status = 'rifiutata' THEN 'Questa offerta è stata rifiutata.'
    WHEN _version.status = 'scaduta' THEN 'Questa offerta è scaduta: chiedici una nuova proposta.'
    WHEN _version.status IN ('superata', 'sostituita') THEN 'Esiste una versione più recente di questa offerta.'
    ELSE 'Questa offerta non è al momento accettabile.'
  END;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'offer_version_id', _version.id,
    'status', _version.status,
    'signable', _signable,
    'not_signable_reason', _reason,
    'document_hash', _document.snapshot_hash,
    'has_pdf', _document.pdf_path IS NOT NULL,
    'pdf_path', _document.pdf_path,
    'document', _document.snapshot,
    'signature', CASE WHEN _signature.id IS NULL THEN NULL ELSE jsonb_build_object(
      'decision', _signature.decision,
      'signer_name', _signature.signer_name,
      'signer_role', _signature.signer_role,
      'signed_at', _signature.created_at
    ) END
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_offer_public_link(text, inet, text) IS 'Risolve il token del link pubblico e restituisce il documento congelato della versione corrente (AD-6, AD-12). Registra ogni accesso, porta a vista la prima apertura, e marca scaduta una versione oltre la validità. Solo service role: la pagina pubblica non legge mai le tabelle.';

REVOKE ALL ON FUNCTION public.resolve_offer_public_link(text, inet, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_offer_public_link(text, inet, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 11) record_offer_client_decision — accettazione con firma, o rifiuto
-- -----------------------------------------------------------------------------
-- Controlla, in questo ordine: token vivo, versione ancora corrente, stato
-- accettabile, e che l'hash del documento visto dal firmatario coincida con
-- quello congelato. L'ultimo controllo è il più importante e il meno ovvio:
-- protegge dal caso in cui il cliente tenga la pagina aperta mentre noi
-- rivediamo l'offerta, e poi firmi ciò che non è più in vigore.

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

  -- Blocca la versione: due firme concorrenti sullo stesso documento si
  -- serializzano qui, e la seconda trova lo stato già cambiato.
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

  IF _decision = 'accettata' AND (_signature_image_path IS NULL OR btrim(_signature_image_path) = '') THEN
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

  -- La firma è inserita prima della transizione perché la notifica di firma,
  -- che parte da dentro set_offer_version_status, deve poter riportare il
  -- nominativo del firmatario. Stessa transazione: se la transizione fallisce,
  -- la firma non resta.
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

COMMENT ON FUNCTION public.record_offer_client_decision(text, public.offer_client_decision, text, text, inet, text, text, text, text, text) IS 'Registra accettazione (con firma obbligatoria) o rifiuto del cliente su una versione di offerta. Verifica token, versione corrente, stato e coincidenza dell''hash del documento visto: firmare un documento diverso da quello in vigore è l''errore che questa funzione esiste per rendere impossibile.';

REVOKE ALL ON FUNCTION public.record_offer_client_decision(text, public.offer_client_decision, text, text, inet, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_offer_client_decision(text, public.offer_client_decision, text, text, inet, text, text, text, text, text) TO service_role;


-- -----------------------------------------------------------------------------
-- 12) RLS e privilegi
-- -----------------------------------------------------------------------------
-- Tutte le tabelle nuove: lettura ai soli utenti approvati (AD-12: la
-- registrazione al progetto è aperta, "authenticated" non significa "di
-- Larin"), scrittura a nessuno se non attraverso le funzioni. Ad anon non è
-- concesso nulla: il cliente non tocca il database, parla con l'edge function.

ALTER TABLE public.offer_public_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_public_link_accesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_version_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_signatures ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.offer_public_links TO authenticated;
GRANT SELECT ON public.offer_public_link_accesses TO authenticated;
GRANT SELECT ON public.offer_version_documents TO authenticated;
GRANT SELECT ON public.offer_signatures TO authenticated;
GRANT ALL ON public.offer_public_links TO service_role;
GRANT ALL ON public.offer_public_link_accesses TO service_role;
GRANT ALL ON public.offer_version_documents TO service_role;
GRANT ALL ON public.offer_signatures TO service_role;

CREATE POLICY "Approved users can view offer public links"
ON public.offer_public_links FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Approved users can view offer link accesses"
ON public.offer_public_link_accesses FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Approved users can view offer documents"
ON public.offer_version_documents FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Approved users can view offer signatures"
ON public.offer_signatures FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));


-- -----------------------------------------------------------------------------
-- 13) Bucket privato per documenti e firme
-- -----------------------------------------------------------------------------
-- L'unico bucket esistente era 'avatars', pubblico. I documenti di offerta non
-- possono stare in un bucket pubblico: un PDF con prezzi e condizioni
-- raggiungibile da chiunque conosca l'URL è una fuga di dati commerciali.
-- Scrittura solo service role (nessuna policy di INSERT/UPDATE/DELETE);
-- lettura agli utenti approvati, così il pannello interno può creare un signed
-- URL con la sessione dell'utente. Il cliente non legge dal bucket: riceve il
-- PDF attraverso la edge function.

INSERT INTO storage.buckets (id, name, public)
VALUES ('offer-documents', 'offer-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Approved users can read offer documents" ON storage.objects;
CREATE POLICY "Approved users can read offer documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'offer-documents' AND public.is_approved_user(auth.uid()));


-- -----------------------------------------------------------------------------
-- 14) Backfill: le versioni già uscite non hanno snapshot
-- -----------------------------------------------------------------------------
-- Senza questo, ogni offerta già inviata prima di questa migration risulterebbe
-- 'documento_assente' sul link pubblico. Lo snapshot ricostruito riflette il
-- contenuto attuale, che per una versione non in bozza è immutabile dal
-- 20260813130000: quindi coincide con quello che il cliente ha ricevuto.

DO $$
DECLARE
  _v RECORD;
BEGIN
  FOR _v IN
    SELECT ov.id
    FROM public.offer_versions ov
    LEFT JOIN public.offer_version_documents d ON d.offer_version_id = ov.id
    WHERE ov.status <> 'bozza' AND d.id IS NULL
  LOOP
    PERFORM public.freeze_offer_version_document(_v.id);
  END LOOP;
END $$;
