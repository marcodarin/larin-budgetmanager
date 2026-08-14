-- =============================================================================
-- La coda delle fatture da emettere
-- =============================================================================
-- Copre FR-21 a FR-24 e realizza AD-2, AD-8. È la parte che Alberto ha chiesto
-- alla lettera: che l'amministrazione clicchi un bottone invece di comporre a
-- mano la fattura di saldo, e che si sappia sempre quanto di un'offerta è già
-- stato fatturato e quanto manca. Oggi quella domanda non ha risposta, ed è la
-- causa diretta dei centoquaranta messaggi Slack al mese di Vetto.
--
-- Tre scelte portanti.
--
-- 1) L'idempotenza è un vincolo del database, non un controllo applicativo
--    (AD-8): ogni riga porta una chiave che include l'origine puntuale (quale
--    tranche, e in futuro quale periodo di abbonamento), con un indice univoco.
--    Un evento ripetuto, un doppio click o due processi concorrenti non possono
--    produrre due fatture, perché la seconda scrittura viola il vincolo.
--
-- 2) Il residuo si calcola in casa, da tranche ed emissioni, mai da una lettura
--    di Fatture in Cloud (AD-7). FiC non sa nulla del nostro piano di pagamento:
--    chiedere a lui quanto manca significherebbe dedurlo da quello che è già
--    uscito, che è esattamente il ragionamento che oggi si fa a mano.
--
-- 3) Lo stato della riga si muove solo attraverso funzioni, come per le offerte.
--    Una riga che passa a "emessa" senza il riferimento al documento FiC è una
--    fattura che nessuno ritrova: il vincolo lo impedisce.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Tipi
-- -----------------------------------------------------------------------------

CREATE TYPE public.invoice_queue_status AS ENUM (
  'prevista',      -- la tranche è maturata, la fattura non è ancora uscita
  'in_emissione',  -- trasmissione a FiC in corso: chiude la finestra del doppio click
  'emessa',        -- documento creato in FiC, con il suo riferimento
  'incassata',     -- incasso registrato (a mano finché non arriva la riconciliazione)
  'annullata'      -- la riga non va emessa, con motivo
);

CREATE TYPE public.invoice_document_kind AS ENUM ('fattura', 'proforma');


-- -----------------------------------------------------------------------------
-- 2) invoice_queue
-- -----------------------------------------------------------------------------
-- Una riga per fattura da emettere. Oggi nasce solo da una tranche del piano di
-- pagamento; il blocco abbonamenti aggiungerà la propria origine con la sua
-- chiave esterna, e per questo la chiave di idempotenza è testuale e prefissata
-- invece di essere l'identificativo nudo della tranche.

CREATE TABLE public.invoice_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_payment_term_id uuid REFERENCES public.offer_payment_terms(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE RESTRICT,
  offer_version_id uuid NOT NULL REFERENCES public.offer_versions(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  document_kind public.invoice_document_kind NOT NULL DEFAULT 'fattura',
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  vat_rate numeric NOT NULL DEFAULT 22,
  description text NOT NULL CHECK (btrim(description) <> ''),
  due_date date,
  status public.invoice_queue_status NOT NULL DEFAULT 'prevista',
  idempotency_key text NOT NULL,
  fic_document_id bigint,
  fic_document_url text,
  issued_at timestamptz,
  issued_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at timestamptz,
  cancelled_reason text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_queue_issued_shape_check CHECK (
    (status IN ('emessa', 'incassata')) = (fic_document_id IS NOT NULL AND issued_at IS NOT NULL)
  ),
  CONSTRAINT invoice_queue_paid_shape_check CHECK (
    (status = 'incassata') = (paid_at IS NOT NULL)
  ),
  CONSTRAINT invoice_queue_cancelled_shape_check CHECK (
    status <> 'annullata' OR (cancelled_reason IS NOT NULL AND btrim(cancelled_reason) <> '')
  )
);

COMMENT ON TABLE public.invoice_queue IS 'Fatture da emettere, una riga per tranche maturata (e in futuro per periodo di abbonamento). Il residuo di un''offerta si calcola da qui e dalle tranche, mai leggendo Fatture in Cloud.';
COMMENT ON COLUMN public.invoice_queue.idempotency_key IS 'Include l''origine puntuale, es. offer_payment_term:<uuid>. Testuale e prefissata perché il blocco abbonamenti aggiungerà origini di natura diversa senza dover cambiare il vincolo (AD-8).';
COMMENT ON COLUMN public.invoice_queue.offer_version_id IS 'La versione da cui la tranche discende: una v1 accettata e poi sostituita conserva le fatture emesse sotto di lei, che restano valide e attribuite a quella versione (AD-6).';
COMMENT ON CONSTRAINT invoice_queue_issued_shape_check ON public.invoice_queue IS 'Una riga emessa senza riferimento al documento FiC è una fattura che nessuno ritrova, e un riferimento su una riga non emessa è una bugia: i due stati stanno insieme o non stanno.';
COMMENT ON COLUMN public.invoice_queue.last_error IS 'Ultimo errore di trasmissione. Un errore verso FiC non annulla lo stato commerciale raggiunto: la riga resta ritentabile e visibile (FR-20).';

CREATE UNIQUE INDEX idx_invoice_queue_idempotency ON public.invoice_queue(idempotency_key);
COMMENT ON INDEX public.idx_invoice_queue_idempotency IS 'AD-8: l''unicità è imposta dal database, non da un controllo applicativo prima dell''inserimento. Due processi concorrenti non possono creare la stessa fattura.';

CREATE INDEX idx_invoice_queue_status ON public.invoice_queue(status);
CREATE INDEX idx_invoice_queue_offer_id ON public.invoice_queue(offer_id);
CREATE INDEX idx_invoice_queue_client_id ON public.invoice_queue(client_id);
CREATE INDEX idx_invoice_queue_due_date ON public.invoice_queue(due_date) WHERE status = 'prevista';

CREATE TRIGGER update_invoice_queue_updated_at
BEFORE UPDATE ON public.invoice_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lo stato si muove solo dalle funzioni dedicate, come per le offerte.
CREATE OR REPLACE FUNCTION public.guard_invoice_queue_status_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND current_setting('app.invoice_queue_transition_allowed', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'invoice_queue.status si cambia solo tramite le funzioni dedicate (emissione, incasso, annullamento)'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_invoice_queue_status
BEFORE UPDATE ON public.invoice_queue
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_queue_status_update();


-- -----------------------------------------------------------------------------
-- 3) Accodare le tranche maturate
-- -----------------------------------------------------------------------------
-- La causale deve leggersi come la scriverebbe l'amministrazione ("Saldo 30%
-- offerta 2026/11, Aurora Manifatture Srl"), perché finisce sul documento
-- fiscale e negli elenchi di chi emette.

CREATE OR REPLACE FUNCTION public.build_invoice_description(_offer_payment_term_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT format('%s offerta %s/%s, %s',
    CASE t.maturity_event
      WHEN 'firma' THEN CASE WHEN t.display_order = 1 THEN 'Acconto' ELSE 'Quota' END
      WHEN 'consegna' THEN 'Saldo'
      WHEN 'pubblicazione_fase' THEN format('Quota %s', coalesce(t.phase_label, 'fase'))
      WHEN 'data_calendario' THEN 'Quota'
      WHEN 'ricorrente' THEN 'Canone'
    END,
    o.year, o.number, c.name)
  FROM public.offer_payment_terms t
  JOIN public.offer_versions v ON v.id = t.offer_version_id
  JOIN public.offers o ON o.id = v.offer_id
  JOIN public.clients c ON c.id = o.client_id
  WHERE t.id = _offer_payment_term_id
$$;

REVOKE ALL ON FUNCTION public.build_invoice_description(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_invoice_description(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.enqueue_invoice_for_payment_term(_offer_payment_term_id uuid)
RETURNS public.invoice_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t public.offer_payment_terms;
  _v public.offer_versions;
  _o public.offers;
  _amount numeric(12,2);
  _due date;
  _row public.invoice_queue;
BEGIN
  SELECT * INTO _t FROM public.offer_payment_terms WHERE id = _offer_payment_term_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tranche % non trovata', _offer_payment_term_id;
  END IF;

  IF _t.maturity_status <> 'maturata' THEN
    RAISE EXCEPTION 'La tranche non è maturata: non c''è niente da fatturare'
      USING errcode = 'check_violation';
  END IF;

  SELECT * INTO _v FROM public.offer_versions WHERE id = _t.offer_version_id;
  SELECT * INTO _o FROM public.offers WHERE id = _v.offer_id;

  -- Solo da una versione accettata discendono fatture (AD-6). Una versione
  -- sostituita conserva le sue, già emesse, ma non ne genera di nuove.
  IF _v.status <> 'accettata' THEN
    RAISE EXCEPTION 'Le fatture discendono solo da una versione accettata (questa è %)', _v.status
      USING errcode = 'check_violation';
  END IF;

  -- L'importo: se la tranche è espressa in percentuale si applica al totale
  -- offerto della versione, arrotondando al centesimo. La quadratura è già
  -- garantita a monte (validate_offer_payment_terms_balance), quindi qui non si
  -- ricontrolla: si converte.
  _amount := COALESCE(_t.amount, round(_v.offered_total * _t.percentage / 100, 2));

  _due := public.compute_payment_term_due_date(_t.payment_term_id, COALESCE(_t.matured_at::date, current_date));

  INSERT INTO public.invoice_queue (
    offer_payment_term_id, offer_id, offer_version_id, client_id,
    amount, description, due_date, idempotency_key
  ) VALUES (
    _t.id, _o.id, _v.id, _o.client_id,
    _amount,
    public.build_invoice_description(_t.id),
    _due,
    'offer_payment_term:' || _t.id::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO _row;

  -- Nessuna riga restituita significa che c'era già: è il comportamento voluto,
  -- non un errore da propagare a chi ha cliccato.
  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.invoice_queue WHERE idempotency_key = 'offer_payment_term:' || _t.id::text;
  END IF;

  RETURN _row;
END;
$$;

COMMENT ON FUNCTION public.enqueue_invoice_for_payment_term(uuid) IS 'Crea la fattura prevista di una tranche maturata (FR-21). Idempotente per costruzione: la chiave include l''identificativo della tranche e l''unicità è del database.';

REVOKE ALL ON FUNCTION public.enqueue_invoice_for_payment_term(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_invoice_for_payment_term(uuid) TO service_role;


-- Alla maturazione di una tranche la fattura prevista nasce da sé: senza questo,
-- "maturata" e "da fatturare" resterebbero due verità da tenere allineate a mano.
CREATE OR REPLACE FUNCTION public.enqueue_invoice_on_maturity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.maturity_status = 'maturata' AND OLD.maturity_status IS DISTINCT FROM 'maturata' THEN
    BEGIN
      PERFORM public.enqueue_invoice_for_payment_term(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- Una tranche che matura è un fatto commerciale: se l'accodamento non
      -- riesce (per esempio la versione non è accettata) non si annulla la
      -- maturazione, si lascia traccia e si potrà accodare dopo.
      RAISE WARNING 'Tranche % maturata ma non accodata: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enqueue_invoice_on_maturity
AFTER UPDATE OF maturity_status ON public.offer_payment_terms
FOR EACH ROW EXECUTE FUNCTION public.enqueue_invoice_on_maturity();


-- La maturazione ammetteva solo un utente che gestisce l'offerta
-- (can_manage_offer_version), quindi nessun processo automatico poteva maturare
-- una tranche: né l'accettazione del cliente, che è l'evento che fa maturare il
-- "40% alla firma", né una schedulazione per le tranche a data di calendario.
-- Il controllo era giusto per la strada manuale e cieco su quella di sistema.
CREATE OR REPLACE FUNCTION public.mark_offer_payment_term_matured(
  _offer_payment_term_id uuid,
  _matured_at timestamptz DEFAULT now()
)
RETURNS public.offer_payment_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _offer_version_id uuid;
  _row public.offer_payment_terms;
BEGIN
  SELECT offer_version_id INTO _offer_version_id
    FROM public.offer_payment_terms
   WHERE id = _offer_payment_term_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tranche % non trovata', _offer_payment_term_id;
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.can_manage_offer_version(_offer_version_id) THEN
    RAISE EXCEPTION 'Non autorizzato a registrare la maturazione di questa tranche';
  END IF;

  PERFORM set_config('app.offer_payment_term_maturity_transition_allowed', 'on', true);

  UPDATE public.offer_payment_terms
     SET maturity_status = 'maturata',
         matured_at = COALESCE(_matured_at, now())
   WHERE id = _offer_payment_term_id
  RETURNING * INTO _row;

  PERFORM set_config('app.offer_payment_term_maturity_transition_allowed', 'off', true);

  RETURN _row;
END;
$$;

COMMENT ON FUNCTION public.mark_offer_payment_term_matured(uuid, timestamptz) IS 'Registra la maturazione di una tranche. Ammessa a chi gestisce l''offerta e ai processi di sistema: la maturazione "alla firma" la determina l''accettazione del cliente, non un utente che se ne ricorda.';

REVOKE ALL ON FUNCTION public.mark_offer_payment_term_matured(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_offer_payment_term_matured(uuid, timestamptz) TO authenticated, service_role;


-- All'accettazione dell'offerta le tranche legate alla firma maturano subito:
-- è il senso di "40% alla firma", e aspettare un gesto manuale significherebbe
-- che il primo acconto resta invisibile finché qualcuno non se ne ricorda.
CREATE OR REPLACE FUNCTION public.mature_signature_payment_terms(_offer_version_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t RECORD;
  _n integer := 0;
BEGIN
  FOR _t IN
    SELECT id FROM public.offer_payment_terms
     WHERE offer_version_id = _offer_version_id
       AND maturity_event = 'firma'
       AND maturity_status = 'da_maturare'
  LOOP
    PERFORM public.mark_offer_payment_term_matured(_t.id, now());
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.mature_signature_payment_terms(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mature_signature_payment_terms(uuid) TO service_role;


-- -----------------------------------------------------------------------------
-- 4) Emissione, incasso, annullamento
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_invoice_for_issue(_invoice_queue_id uuid)
RETURNS public.invoice_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.invoice_queue;
BEGIN
  -- FOR UPDATE più il controllo dello stato dentro la stessa transazione: è
  -- questo che chiude la finestra del doppio click, prima che qualcuno chiami
  -- Fatture in Cloud due volte per la stessa riga (FR-22).
  SELECT * INTO _row FROM public.invoice_queue WHERE id = _invoice_queue_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Riga di coda % non trovata', _invoice_queue_id;
  END IF;

  IF _row.status <> 'prevista' THEN
    RAISE EXCEPTION 'Questa fattura è già in stato %: non si emette due volte', _row.status
      USING errcode = 'check_violation';
  END IF;

  PERFORM set_config('app.invoice_queue_transition_allowed', 'on', true);
  UPDATE public.invoice_queue SET status = 'in_emissione', last_error = NULL
   WHERE id = _invoice_queue_id RETURNING * INTO _row;
  PERFORM set_config('app.invoice_queue_transition_allowed', 'off', true);

  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_invoice_issued(
  _invoice_queue_id uuid,
  _fic_document_id bigint,
  _fic_document_url text DEFAULT NULL,
  _issued_by uuid DEFAULT NULL
)
RETURNS public.invoice_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.invoice_queue;
BEGIN
  PERFORM set_config('app.invoice_queue_transition_allowed', 'on', true);
  UPDATE public.invoice_queue
     SET status = 'emessa',
         fic_document_id = _fic_document_id,
         fic_document_url = _fic_document_url,
         issued_at = now(),
         issued_by = _issued_by,
         last_error = NULL
   WHERE id = _invoice_queue_id
  RETURNING * INTO _row;
  PERFORM set_config('app.invoice_queue_transition_allowed', 'off', true);

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Riga di coda % non trovata', _invoice_queue_id;
  END IF;
  RETURN _row;
END;
$$;

-- Il fallimento della trasmissione riporta la riga in coda: l'accettazione e la
-- maturazione restano, e chi emette vede perché non è uscita.
CREATE OR REPLACE FUNCTION public.mark_invoice_issue_failed(_invoice_queue_id uuid, _error text)
RETURNS public.invoice_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.invoice_queue;
BEGIN
  PERFORM set_config('app.invoice_queue_transition_allowed', 'on', true);
  UPDATE public.invoice_queue
     SET status = 'prevista', last_error = left(coalesce(_error, 'errore non specificato'), 2000)
   WHERE id = _invoice_queue_id AND status = 'in_emissione'
  RETURNING * INTO _row;
  PERFORM set_config('app.invoice_queue_transition_allowed', 'off', true);
  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_invoice_paid(_invoice_queue_id uuid, _paid_at timestamptz DEFAULT now())
RETURNS public.invoice_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.invoice_queue;
BEGIN
  IF NOT (public.is_approved_user(auth.uid()) AND (public.has_role(auth.uid(), 'finance') OR public.has_role(auth.uid(), 'admin')))
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Solo amministrazione o un processo di sistema registrano un incasso';
  END IF;

  PERFORM set_config('app.invoice_queue_transition_allowed', 'on', true);
  UPDATE public.invoice_queue
     SET status = 'incassata', paid_at = _paid_at
   WHERE id = _invoice_queue_id AND status = 'emessa'
  RETURNING * INTO _row;
  PERFORM set_config('app.invoice_queue_transition_allowed', 'off', true);

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Solo una fattura emessa può risultare incassata';
  END IF;
  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_invoice_queue_row(_invoice_queue_id uuid, _reason text)
RETURNS public.invoice_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.invoice_queue;
BEGIN
  IF NOT (public.is_approved_user(auth.uid()) AND (public.has_role(auth.uid(), 'finance') OR public.has_role(auth.uid(), 'admin'))) THEN
    RAISE EXCEPTION 'Solo amministrazione annulla una fattura prevista';
  END IF;

  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'Annullare una fattura prevista richiede un motivo';
  END IF;

  PERFORM set_config('app.invoice_queue_transition_allowed', 'on', true);
  UPDATE public.invoice_queue
     SET status = 'annullata', cancelled_reason = btrim(_reason)
   WHERE id = _invoice_queue_id AND status = 'prevista'
  RETURNING * INTO _row;
  PERFORM set_config('app.invoice_queue_transition_allowed', 'off', true);

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Si annulla solo una fattura ancora prevista';
  END IF;
  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invoice_for_issue(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_invoice_for_issue(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mark_invoice_issued(uuid, bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_invoice_issued(uuid, bigint, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mark_invoice_issue_failed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_invoice_issue_failed(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.mark_invoice_paid(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_paid(uuid, timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_invoice_queue_row(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invoice_queue_row(uuid, text) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5) Il residuo (FR-24)
-- -----------------------------------------------------------------------------
-- Quanto vale l'offerta, quanto è già uscito, quanto manca. Calcolato da tranche
-- ed emissioni nostre: FiC non conosce il piano di pagamento, e dedurre il
-- residuo da quello che è già uscito è il ragionamento che oggi si fa a mano.

CREATE OR REPLACE VIEW public.offer_billing_summary AS
SELECT
  o.id AS offer_id,
  o.year,
  o.number,
  o.client_id,
  c.name AS client_name,
  v.id AS offer_version_id,
  v.offered_total AS valore,
  COALESCE(emesse.totale, 0) AS fatturato,
  COALESCE(incassate.totale, 0) AS incassato,
  v.offered_total - COALESCE(emesse.totale, 0) AS residuo,
  COALESCE(previste.numero, 0) AS fatture_previste
FROM public.offers o
JOIN public.offer_versions v ON v.id = o.current_version_id AND v.status IN ('accettata', 'sostituita')
JOIN public.clients c ON c.id = o.client_id
LEFT JOIN (
  SELECT offer_id, sum(amount) AS totale FROM public.invoice_queue
   WHERE status IN ('emessa', 'incassata') GROUP BY offer_id
) emesse ON emesse.offer_id = o.id
LEFT JOIN (
  SELECT offer_id, sum(amount) AS totale FROM public.invoice_queue
   WHERE status = 'incassata' GROUP BY offer_id
) incassate ON incassate.offer_id = o.id
LEFT JOIN (
  SELECT offer_id, count(*) AS numero FROM public.invoice_queue
   WHERE status = 'prevista' GROUP BY offer_id
) previste ON previste.offer_id = o.id;

COMMENT ON VIEW public.offer_billing_summary IS 'Valore, fatturato, incassato e residuo per offerta accettata (FR-24). La vista eredita la RLS delle tabelle sottostanti perché è security_invoker.';

ALTER VIEW public.offer_billing_summary SET (security_invoker = on);

GRANT SELECT ON public.offer_billing_summary TO authenticated;


-- -----------------------------------------------------------------------------
-- 6) Permessi
-- -----------------------------------------------------------------------------
-- Il residuo lo guarda anche il commerciale, quindi la lettura è di tutti gli
-- utenti approvati. Le scritture passano solo dalle funzioni: qui non si concede
-- nessun INSERT o UPDATE diretto, e la forma è quella obbligata (REVOKE ALL e
-- poi GRANT dell'elenco esatto), perché il progetto assegna da sé tutti i
-- privilegi a ogni tabella nuova.

ALTER TABLE public.invoice_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.invoice_queue FROM anon;
REVOKE ALL ON public.invoice_queue FROM authenticated;
GRANT SELECT ON public.invoice_queue TO authenticated;
GRANT ALL ON public.invoice_queue TO service_role;

CREATE POLICY "Approved users can view the invoice queue"
ON public.invoice_queue FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));


-- -----------------------------------------------------------------------------
-- 7) Avviso di fatture da emettere (FR-48)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_invoices_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
  _totale numeric;
  _dest RECORD;
  _inviate integer := 0;
BEGIN
  SELECT count(*), COALESCE(sum(amount), 0) INTO _n, _totale
    FROM public.invoice_queue
   WHERE status = 'prevista'
     AND (due_date IS NULL OR due_date <= current_date + 7);

  IF _n = 0 THEN
    RETURN 0;
  END IF;

  FOR _dest IN
    SELECT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('finance', 'admin') AND p.approved = true AND p.deleted_at IS NULL
  LOOP
    PERFORM public.notify_user_if_enabled(
      _dest.user_id,
      'invoice_due',
      format('%s fatture da emettere', _n),
      format('Ci sono %s fatture previste in scadenza entro sette giorni, per %s € complessivi.', _n, _totale),
      NULL
    );
    _inviate := _inviate + 1;
  END LOOP;

  RETURN _inviate;
END;
$$;

COMMENT ON FUNCTION public.notify_invoices_due() IS 'Avvisa amministrazione delle fatture previste maturate o in scadenza entro una settimana (FR-48). Pensata per essere chiamata da una schedulazione, non da un utente.';

REVOKE ALL ON FUNCTION public.notify_invoices_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_invoices_due() TO service_role;


-- -----------------------------------------------------------------------------
-- 8) Le offerte già accettate entrano in coda
-- -----------------------------------------------------------------------------
-- Senza questo, le accettazioni di prova già presenti resterebbero senza
-- fatture previste e la coda sembrerebbe vuota per un difetto che non esiste.

DO $$
DECLARE
  _v RECORD;
BEGIN
  -- La maturazione è riservata a utenti approvati o a un processo di sistema, e
  -- qui non c'è nessuno dei due: la migration gira come proprietario del
  -- database, senza claim. Dichiararsi processo di sistema è corretto, perché
  -- questo backfill è esattamente questo.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  FOR _v IN
    SELECT ov.id FROM public.offer_versions ov WHERE ov.status = 'accettata'
  LOOP
    PERFORM public.mature_signature_payment_terms(_v.id);
  END LOOP;
END $$;
