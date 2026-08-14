-- =============================================================================
-- L'avviso delle fatture da emettere guardava solo le scadenze imminenti
-- =============================================================================
-- FR-48 chiede di avvisare l'amministrazione quando ci sono fatture previste
-- "maturate o in scadenza". La prima versione avvisava solo per quelle con
-- scadenza entro sette giorni, e siccome una fattura prevista nasce già maturata
-- (la crea la maturazione della tranche), il risultato era che trentasei fatture
-- pronte da emettere non producevano nessun avviso: tutte con scadenza a trenta
-- giorni, quindi tutte fuori dalla finestra.
--
-- Trovato provando la funzione invece di leggerla: rispondeva zero destinatari
-- su una coda piena.
--
-- Il criterio giusto: si avvisa quando c'è qualcosa da emettere, e si dice
-- quante di quelle stanno per scadere. Le due informazioni servono entrambe, e
-- la seconda da sola tace proprio quando il lavoro si accumula.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_invoices_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _totali integer;
  _importo numeric;
  _in_scadenza integer;
  _dest RECORD;
  _inviate integer := 0;
  _messaggio text;
BEGIN
  SELECT count(*), COALESCE(sum(amount), 0)
    INTO _totali, _importo
    FROM public.invoice_queue
   WHERE status = 'prevista';

  IF _totali = 0 THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO _in_scadenza
    FROM public.invoice_queue
   WHERE status = 'prevista'
     AND due_date IS NOT NULL
     AND due_date <= current_date + 7;

  _messaggio := format('Ci sono %s fatture previste da emettere, per %s € complessivi.', _totali, _importo);
  IF _in_scadenza > 0 THEN
    _messaggio := _messaggio || format(' Di queste, %s in scadenza entro sette giorni.', _in_scadenza);
  END IF;

  FOR _dest IN
    SELECT ur.user_id FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role IN ('finance', 'admin') AND p.approved = true AND p.deleted_at IS NULL
  LOOP
    PERFORM public.notify_user_if_enabled(
      _dest.user_id,
      'invoice_due',
      CASE WHEN _in_scadenza > 0
           THEN format('%s fatture da emettere, %s in scadenza', _totali, _in_scadenza)
           ELSE format('%s fatture da emettere', _totali) END,
      _messaggio,
      NULL
    );
    _inviate := _inviate + 1;
  END LOOP;

  RETURN _inviate;
END;
$$;

COMMENT ON FUNCTION public.notify_invoices_due() IS 'Avvisa amministrazione delle fatture previste da emettere, segnalando quante sono in scadenza entro una settimana (FR-48). Una fattura prevista è già maturata per costruzione, quindi il criterio non può essere la sola scadenza imminente: tacerebbe proprio quando il lavoro si accumula.';

REVOKE ALL ON FUNCTION public.notify_invoices_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_invoices_due() TO service_role;
