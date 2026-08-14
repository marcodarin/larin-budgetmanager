-- =============================================================================
-- La disdetta efficace dal primo del mese generava ancora quel periodo
-- =============================================================================
-- generate_subscription_periods si fermava a `cancelled_effective_date`
-- inclusa, quindi un abbonamento disdetto con effetto dal 1 gennaio produceva
-- ancora il periodo che inizia il 1 gennaio: una fattura per un servizio che da
-- quel giorno non si presta più.
--
-- La differenza è di un giorno e cambia il significato: "efficace dal" è
-- l'inizio del non dovuto, non l'ultimo giorno dovuto. Per la fine
-- dell'impegno (end_date) il confronto inclusivo invece è giusto, perché un
-- periodo che inizia dentro l'impegno va fatturato anche se finisce l'ultimo
-- giorno.
-- =============================================================================

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

  _limite := COALESCE(_until, current_date + _s.generate_days_before);

  -- Fine dell'impegno: inclusiva. Un periodo che inizia dentro l'impegno va
  -- fatturato anche se si chiude l'ultimo giorno.
  IF _s.end_date IS NOT NULL AND _s.end_date < _limite THEN
    _limite := _s.end_date;
  END IF;

  -- Disdetta: esclusiva. "Efficace dal 1 gennaio" significa che il periodo che
  -- inizia il 1 gennaio non è più dovuto.
  IF _s.cancelled_effective_date IS NOT NULL AND (_s.cancelled_effective_date - 1) < _limite THEN
    _limite := _s.cancelled_effective_date - 1;
  END IF;

  _cursore := _s.start_date;
  WHILE _cursore <= _limite LOOP
    _fine_periodo := (_cursore + _step - interval '1 day')::date;
    _canone := public.get_subscription_amount_at(_subscription_id, _cursore);

    IF _canone.id IS NULL THEN
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

REVOKE ALL ON FUNCTION public.generate_subscription_periods(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_subscription_periods(uuid, date) TO service_role;
