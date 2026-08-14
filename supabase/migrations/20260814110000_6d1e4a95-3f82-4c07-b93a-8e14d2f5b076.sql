-- =============================================================================
-- Abbonamenti: l'entità che sopravvive all'offerta
-- =============================================================================
-- Copre FR-26 a FR-30 e realizza AD-9. Oggi Larin non ha un gestionale
-- abbonamenti: sono automatizzati solo WPZen e ActiveCampaign, il resto passa da
-- proforma scritte a mano. Nei preventivi i canoni pesano 1.218.192 euro su 106
-- documenti, quindi è la parte di ricorrente più grande e meno controllata, e nel
-- listino di Fatture in Cloud sono già identificabili: 25 prodotti su 70 stanno
-- nelle categorie CANONI TECH e CANONI MARKETING.
--
-- Quattro scelte portanti.
--
-- 1) L'abbonamento ha **vita propria** (AD-9). Nasce spesso da un'offerta, ma un
--    canone modificato o disdetto tre anni dopo non deve doversi leggere
--    attraverso il documento che lo ha originato. Il riferimento all'offerta
--    esiste e resta facoltativo.
--
-- 2) Il canone è **storicizzato**, non aggiornato in place (FR-29): le fatture
--    già emesse devono restare coerenti con il canone dell'epoca. La non
--    sovrapposizione dei periodi di validità è imposta da un vincolo di
--    esclusione, non da un controllo applicativo: due canoni validi lo stesso
--    giorno renderebbero indeterminato l'importo da fatturare.
--
-- 3) I periodi generati sono **materializzati** in una tabella, non calcolati al
--    volo. Serve sapere quali sono già stati fatturati e a quale importo, e un
--    calcolo al volo cambierebbe risposta ogni volta che cambia una regola.
--
-- 4) I periodi sfociano nella **stessa coda** delle fatture da offerta, con la
--    stessa chiave di idempotenza prefissata (AD-8): l'amministrazione ha un
--    posto solo dove guardare, e la coda non sa né deve sapere da dove arriva
--    ciascuna riga.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;


-- -----------------------------------------------------------------------------
-- 1) Tipi
-- -----------------------------------------------------------------------------

CREATE TYPE public.subscription_periodicity AS ENUM ('mensile', 'trimestrale', 'annuale');
CREATE TYPE public.subscription_status AS ENUM ('attivo', 'disdettato', 'concluso');
CREATE TYPE public.subscription_period_status AS ENUM ('previsto', 'accodato', 'annullato');


-- -----------------------------------------------------------------------------
-- 2) subscriptions
-- -----------------------------------------------------------------------------

CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  description text NOT NULL CHECK (btrim(description) <> ''),
  periodicity public.subscription_periodicity NOT NULL,
  start_date date NOT NULL,
  end_date date,
  auto_renew boolean NOT NULL DEFAULT true,
  notice_days integer CHECK (notice_days IS NULL OR notice_days >= 0),
  document_kind public.invoice_document_kind NOT NULL DEFAULT 'fattura',
  generate_days_before integer NOT NULL DEFAULT 15 CHECK (generate_days_before >= 0),
  status public.subscription_status NOT NULL DEFAULT 'attivo',
  cancelled_at timestamptz,
  cancelled_effective_date date,
  cancelled_reason text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_dates_check CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT subscriptions_cancelled_shape_check CHECK (
    (status = 'disdettato') = (cancelled_at IS NOT NULL AND cancelled_effective_date IS NOT NULL)
  )
);

COMMENT ON TABLE public.subscriptions IS 'Abbonamenti e canoni ricorrenti. Hanno vita propria: il riferimento all''offerta di origine è facoltativo, perché un canone disdetto tre anni dopo non deve doversi leggere attraverso il documento che lo ha originato (AD-9).';
COMMENT ON COLUMN public.subscriptions.end_date IS 'Fine dell''impegno. NULL significa a tempo indeterminato con rinnovo. Un impegno pluriennale (osservato: assistenza 2026-2028) si esprime con start_date e end_date, senza trucchi.';
COMMENT ON COLUMN public.subscriptions.notice_days IS 'Giorni di preavviso per la disdetta. Serve a elencare i rinnovi in avvicinamento prima che il preavviso scada, che è l''unico momento in cui l''informazione è utile.';
COMMENT ON COLUMN public.subscriptions.generate_days_before IS 'Quanti giorni prima dell''inizio del periodo la fattura prevista entra in coda (FR-27: generazione in anticipo configurabile).';
COMMENT ON COLUMN public.subscriptions.cancelled_effective_date IS 'Data da cui la disdetta ha effetto: i periodi che iniziano dopo non si generano più, quelli già fatturati restano.';

CREATE INDEX idx_subscriptions_client_id ON public.subscriptions(client_id);
CREATE INDEX idx_subscriptions_offer_id ON public.subscriptions(offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);

CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- -----------------------------------------------------------------------------
-- 3) subscription_amounts — la storia del canone
-- -----------------------------------------------------------------------------
-- Il canone cambia nel tempo e le fatture già emesse devono restare coerenti con
-- quello dell'epoca (FR-29). Il vincolo di esclusione impedisce che due importi
-- siano validi nello stesso giorno: senza, l'importo da fatturare per un periodo
-- sarebbe indeterminato e la scelta cadrebbe su chi legge.

CREATE TABLE public.subscription_amounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  vat_rate numeric NOT NULL DEFAULT 22,
  valid_from date NOT NULL,
  valid_to date,
  note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_amounts_range_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT subscription_amounts_no_overlap EXCLUDE USING gist (
    subscription_id WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&
  )
);

COMMENT ON TABLE public.subscription_amounts IS 'Storia del canone di un abbonamento. Le variazioni sono righe nuove, non aggiornamenti: una fattura emessa a marzo deve continuare a corrispondere al canone di marzo.';
COMMENT ON CONSTRAINT subscription_amounts_no_overlap ON public.subscription_amounts IS 'Due canoni validi nello stesso giorno renderebbero indeterminato l''importo del periodo. Il vincolo lo rende impossibile, invece di lasciarlo a un controllo che qualcuno dimenticherà.';

CREATE INDEX idx_subscription_amounts_subscription_id ON public.subscription_amounts(subscription_id);


-- -----------------------------------------------------------------------------
-- 4) subscription_periods — i periodi materializzati
-- -----------------------------------------------------------------------------

CREATE TABLE public.subscription_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  vat_rate numeric NOT NULL DEFAULT 22,
  status public.subscription_period_status NOT NULL DEFAULT 'previsto',
  generated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_periods_range_check CHECK (period_end >= period_start)
);

COMMENT ON TABLE public.subscription_periods IS 'Periodi di un abbonamento, materializzati e non calcolati al volo: serve sapere quali sono già stati fatturati e a quale importo, e un calcolo al volo cambierebbe risposta ogni volta che cambia una regola.';
COMMENT ON COLUMN public.subscription_periods.period_key IS 'Chiave leggibile e deterministica del periodo: 2026-03 per il mensile, 2026-Q2 per il trimestrale, 2026 per l''annuale. È ciò che rende riconoscibile un periodo già generato.';
COMMENT ON COLUMN public.subscription_periods.amount IS 'Il canone valido all''inizio del periodo, copiato qui: se domani il canone cambia, questo periodo resta quello che è stato fatturato.';

CREATE UNIQUE INDEX idx_subscription_periods_unique ON public.subscription_periods(subscription_id, period_key);
CREATE INDEX idx_subscription_periods_status ON public.subscription_periods(status);
CREATE INDEX idx_subscription_periods_start ON public.subscription_periods(period_start);


-- -----------------------------------------------------------------------------
-- 5) La coda accoglie anche i periodi di abbonamento
-- -----------------------------------------------------------------------------
-- Un abbonamento può non avere offerta (AD-9), quindi le colonne che legano la
-- riga di coda all'offerta diventano facoltative, e un vincolo impone che ogni
-- riga abbia **una sola** origine riconoscibile: senza, esisterebbero righe
-- orfane che nessuno sa da dove vengono.

ALTER TABLE public.invoice_queue
  ADD COLUMN IF NOT EXISTS subscription_period_id uuid REFERENCES public.subscription_periods(id) ON DELETE RESTRICT;

ALTER TABLE public.invoice_queue ALTER COLUMN offer_id DROP NOT NULL;
ALTER TABLE public.invoice_queue ALTER COLUMN offer_version_id DROP NOT NULL;

ALTER TABLE public.invoice_queue
  ADD CONSTRAINT invoice_queue_single_origin_check CHECK (
    (offer_payment_term_id IS NOT NULL AND subscription_period_id IS NULL AND offer_id IS NOT NULL AND offer_version_id IS NOT NULL)
    OR
    (subscription_period_id IS NOT NULL AND offer_payment_term_id IS NULL)
  );

COMMENT ON CONSTRAINT invoice_queue_single_origin_check ON public.invoice_queue IS 'Ogni riga di coda ha una sola origine: una tranche di offerta (e allora offerta e versione sono obbligatorie) oppure un periodo di abbonamento (che può non avere offerta). Una riga senza origine sarebbe una fattura che nessuno sa spiegare.';

CREATE INDEX idx_invoice_queue_subscription_period ON public.invoice_queue(subscription_period_id) WHERE subscription_period_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 6) Il canone valido a una data
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_subscription_amount_at(_subscription_id uuid, _at date)
RETURNS public.subscription_amounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.subscription_amounts
   WHERE subscription_id = _subscription_id
     AND valid_from <= _at
     AND (valid_to IS NULL OR valid_to > _at)
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_subscription_amount_at(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_subscription_amount_at(uuid, date) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7) Generazione dei periodi
-- -----------------------------------------------------------------------------
-- Deterministica e ripetibile: la chiave del periodo è l'unicità, quindi
-- rilanciare la generazione non duplica niente (FR-27).

CREATE OR REPLACE FUNCTION public.subscription_period_key(_periodicity public.subscription_periodicity, _start date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _periodicity
    WHEN 'mensile' THEN to_char(_start, 'YYYY-MM')
    WHEN 'trimestrale' THEN to_char(_start, 'YYYY') || '-Q' || to_char(_start, 'Q')
    WHEN 'annuale' THEN to_char(_start, 'YYYY')
  END
$$;

CREATE OR REPLACE FUNCTION public.generate_subscription_periods(
  _subscription_id uuid,
  _until date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s public.subscriptions;
  _step interval;
  _cursore date;
  _fine_periodo date;
  _limite date;
  _canone public.subscription_amounts;
  _creati integer := 0;
BEGIN
  SELECT * INTO _s FROM public.subscriptions WHERE id = _subscription_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Abbonamento % non trovato', _subscription_id;
  END IF;

  _step := CASE _s.periodicity
             WHEN 'mensile' THEN interval '1 month'
             WHEN 'trimestrale' THEN interval '3 months'
             WHEN 'annuale' THEN interval '1 year'
           END;

  -- Fin dove generare: l'anticipo configurato, senza superare la fine
  -- dell'impegno né la data di efficacia di una disdetta.
  _limite := COALESCE(_until, current_date + _s.generate_days_before);
  IF _s.end_date IS NOT NULL AND _s.end_date < _limite THEN
    _limite := _s.end_date;
  END IF;
  IF _s.cancelled_effective_date IS NOT NULL AND _s.cancelled_effective_date < _limite THEN
    _limite := _s.cancelled_effective_date;
  END IF;

  _cursore := _s.start_date;
  WHILE _cursore <= _limite LOOP
    _fine_periodo := (_cursore + _step - interval '1 day')::date;
    _canone := public.get_subscription_amount_at(_subscription_id, _cursore);

    IF _canone.id IS NULL THEN
      -- Nessun canone valido per quel periodo: si ferma qui invece di inventare
      -- un importo. Chi ha inserito l'abbonamento senza canone lo scopre subito.
      RAISE EXCEPTION 'Nessun canone valido al %: registrare l''importo prima di generare i periodi', _cursore;
    END IF;

    INSERT INTO public.subscription_periods (
      subscription_id, period_key, period_start, period_end, amount, vat_rate
    ) VALUES (
      _subscription_id,
      public.subscription_period_key(_s.periodicity, _cursore),
      _cursore, _fine_periodo, _canone.amount, _canone.vat_rate
    )
    ON CONFLICT (subscription_id, period_key) DO NOTHING;

    IF FOUND THEN
      _creati := _creati + 1;
    END IF;

    _cursore := (_cursore + _step)::date;
  END LOOP;

  RETURN _creati;
END;
$$;

COMMENT ON FUNCTION public.generate_subscription_periods(uuid, date) IS 'Crea i periodi mancanti di un abbonamento fino all''anticipo configurato, copiando il canone valido all''inizio di ciascuno. Ripetibile: la chiave del periodo impedisce i doppioni (FR-27).';

REVOKE ALL ON FUNCTION public.generate_subscription_periods(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_subscription_periods(uuid, date) TO service_role;


-- -----------------------------------------------------------------------------
-- 8) Dal periodo alla coda
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_invoice_for_subscription_period(_subscription_period_id uuid)
RETURNS public.invoice_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p public.subscription_periods;
  _s public.subscriptions;
  _row public.invoice_queue;
  _chiave text;
BEGIN
  SELECT * INTO _p FROM public.subscription_periods WHERE id = _subscription_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Periodo % non trovato', _subscription_period_id;
  END IF;

  IF _p.status = 'annullato' THEN
    RAISE EXCEPTION 'Il periodo è annullato: non va fatturato'
      USING errcode = 'check_violation';
  END IF;

  SELECT * INTO _s FROM public.subscriptions WHERE id = _p.subscription_id;

  _chiave := 'subscription_period:' || _p.id::text;

  INSERT INTO public.invoice_queue (
    subscription_period_id, offer_id, client_id, document_kind,
    amount, vat_rate, description, due_date, idempotency_key
  ) VALUES (
    _p.id, _s.offer_id, _s.client_id, _s.document_kind,
    _p.amount, _p.vat_rate,
    format('%s, periodo %s', _s.description, _p.period_key),
    _p.period_start,
    _chiave
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.invoice_queue WHERE idempotency_key = _chiave;
  ELSE
    UPDATE public.subscription_periods SET status = 'accodato' WHERE id = _p.id;
  END IF;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_invoice_for_subscription_period(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_invoice_for_subscription_period(uuid) TO service_role;


-- Il giro completo per tutti gli abbonamenti attivi: è la funzione che una
-- schedulazione chiama una volta al giorno.
CREATE OR REPLACE FUNCTION public.run_subscription_billing()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s RECORD;
  _p RECORD;
  _periodi integer := 0;
  _accodate integer := 0;
  _errori jsonb := '[]'::jsonb;
BEGIN
  FOR _s IN SELECT id FROM public.subscriptions WHERE status = 'attivo' LOOP
    BEGIN
      _periodi := _periodi + public.generate_subscription_periods(_s.id);
    EXCEPTION WHEN OTHERS THEN
      -- Un abbonamento incompleto non deve fermare gli altri: si segnala e si va
      -- avanti, altrimenti un dato mancante su un cliente blocca la
      -- fatturazione di tutti.
      _errori := _errori || jsonb_build_object('subscription_id', _s.id, 'errore', SQLERRM);
    END;
  END LOOP;

  FOR _p IN
    SELECT sp.id FROM public.subscription_periods sp
    JOIN public.subscriptions s ON s.id = sp.subscription_id
    WHERE sp.status = 'previsto'
      AND s.status = 'attivo'
      AND sp.period_start <= current_date + s.generate_days_before
  LOOP
    BEGIN
      PERFORM public.enqueue_invoice_for_subscription_period(_p.id);
      _accodate := _accodate + 1;
    EXCEPTION WHEN OTHERS THEN
      _errori := _errori || jsonb_build_object('subscription_period_id', _p.id, 'errore', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('periodi_creati', _periodi, 'fatture_accodate', _accodate, 'errori', _errori);
END;
$$;

COMMENT ON FUNCTION public.run_subscription_billing() IS 'Giro completo della fatturazione ricorrente: genera i periodi mancanti e accoda quelli entro l''anticipo. Pensata per una schedulazione giornaliera. Un abbonamento incompleto non ferma gli altri.';

REVOKE ALL ON FUNCTION public.run_subscription_billing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_subscription_billing() TO service_role;


-- -----------------------------------------------------------------------------
-- 9) Disdetta
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_subscription(
  _subscription_id uuid,
  _effective_date date,
  _reason text DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.subscriptions;
BEGIN
  IF NOT public.is_approved_user(auth.uid()) AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Non autorizzato a registrare una disdetta';
  END IF;

  UPDATE public.subscriptions
     SET status = 'disdettato',
         cancelled_at = now(),
         cancelled_effective_date = _effective_date,
         cancelled_reason = nullif(btrim(_reason), '')
   WHERE id = _subscription_id AND status = 'attivo'
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Si disdice solo un abbonamento attivo';
  END IF;

  -- I periodi che iniziano dopo la disdetta non si fatturano più. Quelli già
  -- accodati o fatturati restano: il servizio in quel periodo è stato reso.
  UPDATE public.subscription_periods
     SET status = 'annullato'
   WHERE subscription_id = _subscription_id
     AND status = 'previsto'
     AND period_start >= _effective_date;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_subscription(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_subscription(uuid, date, text) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 10) Il ricorrente in cifre (FR-30)
-- -----------------------------------------------------------------------------
-- Il valore ricorrente su base mensile e annua, e la quota a rischio di disdetta
-- nei prossimi novanta giorni: è il numero che dice quanto del fatturato è
-- prevedibile e quanto è appeso a un preavviso.

CREATE OR REPLACE VIEW public.recurring_value_summary AS
WITH canone_corrente AS (
  SELECT
    s.id,
    s.client_id,
    s.status,
    s.periodicity,
    s.end_date,
    s.auto_renew,
    s.notice_days,
    s.cancelled_effective_date,
    a.amount
  FROM public.subscriptions s
  LEFT JOIN public.subscription_amounts a
    ON a.subscription_id = s.id
   AND a.valid_from <= current_date
   AND (a.valid_to IS NULL OR a.valid_to > current_date)
  WHERE s.status IN ('attivo', 'disdettato')
),
normalizzato AS (
  SELECT
    id, client_id, status, end_date, auto_renew, notice_days, cancelled_effective_date,
    CASE periodicity
      WHEN 'mensile' THEN amount
      WHEN 'trimestrale' THEN amount / 3
      WHEN 'annuale' THEN amount / 12
    END AS mensile
  FROM canone_corrente
)
SELECT
  COALESCE(sum(mensile) FILTER (WHERE status = 'attivo'), 0)::numeric(12,2) AS ricorrente_mensile,
  (COALESCE(sum(mensile) FILTER (WHERE status = 'attivo'), 0) * 12)::numeric(12,2) AS ricorrente_annuo,
  count(*) FILTER (WHERE status = 'attivo') AS abbonamenti_attivi,
  -- A rischio: quelli la cui finestra di preavviso cade nei prossimi novanta
  -- giorni, più quelli che finiscono senza rinnovo automatico.
  COALESCE(sum(mensile) FILTER (
    WHERE status = 'attivo'
      AND end_date IS NOT NULL
      AND (
        (NOT auto_renew AND end_date <= current_date + 90)
        OR (notice_days IS NOT NULL AND end_date - notice_days <= current_date + 90 AND end_date > current_date)
      )
  ), 0)::numeric(12,2) AS mensile_a_rischio_90_giorni,
  COALESCE(sum(mensile) FILTER (WHERE status = 'disdettato'), 0)::numeric(12,2) AS mensile_in_disdetta
FROM normalizzato;

COMMENT ON VIEW public.recurring_value_summary IS 'Valore ricorrente mensile e annuo, e la quota a rischio nei prossimi novanta giorni (FR-30). I canoni si normalizzano al mese per poterli sommare: trimestrale diviso tre, annuale diviso dodici.';

ALTER VIEW public.recurring_value_summary SET (security_invoker = on);
GRANT SELECT ON public.recurring_value_summary TO authenticated;


-- -----------------------------------------------------------------------------
-- 11) Rinnovi in avvicinamento (FR-28)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.subscription_renewals AS
SELECT
  s.id AS subscription_id,
  s.client_id,
  c.name AS client_name,
  s.description,
  s.periodicity,
  s.end_date,
  s.auto_renew,
  s.notice_days,
  CASE WHEN s.notice_days IS NOT NULL AND s.end_date IS NOT NULL
       THEN s.end_date - s.notice_days
  END AS notice_deadline,
  a.amount AS canone_corrente
FROM public.subscriptions s
JOIN public.clients c ON c.id = s.client_id
LEFT JOIN public.subscription_amounts a
  ON a.subscription_id = s.id
 AND a.valid_from <= current_date
 AND (a.valid_to IS NULL OR a.valid_to > current_date)
WHERE s.status = 'attivo'
  AND s.end_date IS NOT NULL
  AND s.end_date <= current_date + 120;

COMMENT ON VIEW public.subscription_renewals IS 'Abbonamenti in scadenza nei prossimi quattro mesi con la data entro cui va data la disdetta. Il preavviso è l''unica informazione che conta, e conta solo prima che scada.';

ALTER VIEW public.subscription_renewals SET (security_invoker = on);
GRANT SELECT ON public.subscription_renewals TO authenticated;


CREATE OR REPLACE FUNCTION public.notify_subscription_renewals()
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
    FROM public.subscription_renewals
   WHERE notice_deadline IS NOT NULL
     AND notice_deadline BETWEEN current_date AND current_date + 30;

  IF _n = 0 THEN
    RETURN 0;
  END IF;

  FOR _dest IN
    SELECT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('admin', 'account', 'finance') AND p.approved = true AND p.deleted_at IS NULL
  LOOP
    PERFORM public.notify_user_if_enabled(
      _dest.user_id,
      'subscription_renewal',
      format('%s abbonamenti con preavviso in scadenza', _n),
      format('Per %s abbonamenti il termine per la disdetta cade entro trenta giorni: dopo, il rinnovo è automatico.', _n),
      NULL
    );
    _inviate := _inviate + 1;
  END LOOP;

  RETURN _inviate;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_subscription_renewals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_subscription_renewals() TO service_role;


-- -----------------------------------------------------------------------------
-- 12) Permessi
-- -----------------------------------------------------------------------------
-- Gli abbonamenti li leggono tutti gli approvati (servono al commerciale come
-- all'amministrazione) e li scrivono i ruoli commerciali, con la stessa forma
-- obbligata: REVOKE ALL e poi GRANT dell'elenco esatto.

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_amounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_periods ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.subscriptions FROM anon, authenticated;
REVOKE ALL ON public.subscription_amounts FROM anon, authenticated;
REVOKE ALL ON public.subscription_periods FROM anon, authenticated;

GRANT SELECT, INSERT, DELETE ON public.subscriptions TO authenticated;
GRANT UPDATE (description, periodicity, end_date, auto_renew, notice_days, document_kind, generate_days_before, product_id, offer_id)
  ON public.subscriptions TO authenticated;
GRANT SELECT, INSERT ON public.subscription_amounts TO authenticated;
GRANT SELECT ON public.subscription_periods TO authenticated;

GRANT ALL ON public.subscriptions TO service_role;
GRANT ALL ON public.subscription_amounts TO service_role;
GRANT ALL ON public.subscription_periods TO service_role;

CREATE OR REPLACE FUNCTION public.can_manage_subscriptions()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_approved_user(auth.uid()) AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'account')
    OR public.has_role(auth.uid(), 'finance')
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_subscriptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_subscriptions() TO authenticated, service_role;

CREATE POLICY "Approved users can view subscriptions"
ON public.subscriptions FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Commercial roles can create subscriptions"
ON public.subscriptions FOR INSERT TO authenticated
WITH CHECK (public.can_manage_subscriptions());

CREATE POLICY "Commercial roles can update subscriptions"
ON public.subscriptions FOR UPDATE TO authenticated
USING (public.can_manage_subscriptions());

CREATE POLICY "Commercial roles can delete subscriptions without history"
ON public.subscriptions FOR DELETE TO authenticated
USING (
  public.can_manage_subscriptions()
  AND NOT EXISTS (
    SELECT 1 FROM public.subscription_periods sp
     WHERE sp.subscription_id = subscriptions.id AND sp.status <> 'previsto'
  )
);

CREATE POLICY "Approved users can view subscription amounts"
ON public.subscription_amounts FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Commercial roles can add subscription amounts"
ON public.subscription_amounts FOR INSERT TO authenticated
WITH CHECK (public.can_manage_subscriptions());

CREATE POLICY "Approved users can view subscription periods"
ON public.subscription_periods FOR SELECT TO authenticated
USING (public.is_approved_user(auth.uid()));
