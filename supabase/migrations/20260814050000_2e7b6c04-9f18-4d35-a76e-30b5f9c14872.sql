-- =============================================================================
-- Chi può compiere quale transizione, e chi può leggere il documento
-- =============================================================================
-- Tre buchi trovati da una review adversariale sul lavoro di poche ore fa, i
-- primi due verificati sullo staging con la prova in mano.
--
-- 1) Un utente interno approvato poteva marcare un'offerta "accettata" da sé,
--    chiamando set_offer_version_status con actor_type='user'. Nessuna firma,
--    nessun token, nessun IP, e le notifiche partivano dicendo "il cliente ha
--    accettato e firmato". La funzione controllava che la versione fosse la
--    corrente e che lo stato di partenza fosse giusto (AD-6), ma non CHI
--    poteva guidare quella transizione: il commento diceva "l'accettazione
--    arriva dal cliente", il codice non lo imponeva. In un sistema il cui
--    scopo è provare che un cliente ha firmato, era il difetto peggiore
--    possibile.
--
-- 2) build_offer_version_snapshot era SECURITY DEFINER, concessa ad
--    authenticated, senza controlli al suo interno: scavalcava la RLS e
--    restituiva cliente, righe, prezzi, sconti e condizioni a chiunque avesse
--    un account, anche NON approvato. La registrazione al progetto è aperta
--    (AD-12), quindi la difesa residua era solo la difficoltà di indovinare un
--    uuid, che non è una difesa.
--
-- 3) Il token del link era leggibile da qualunque utente approvato, compresi i
--    ruoli che non fanno commerciale. Un token è una credenziale al portatore:
--    chi lo legge può aprire la pagina pubblica e firmare al posto del cliente
--    producendo una firma indistinguibile da quella vera, con hash corretto e
--    IP reale. Nessuna delle tracce che smascherano il caso 1.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Ogni transizione ha il suo attore legittimo
-- -----------------------------------------------------------------------------
-- La regola, letta dal ciclo di vita nella spina: comporre, mandare in
-- approvazione, approvare e inviare sono atti nostri; vedere, accettare e
-- rifiutare sono atti del cliente e passano solo dal link pubblico; scadere,
-- superare e sostituire non li compie nessuno, li compie il tempo o l'arrivo di
-- una versione nuova.
--
-- Conseguenza deliberata: **non esiste più un modo di registrare
-- un'accettazione avvenuta fuori dal link** (il cliente che dice di sì al
-- telefono, o firma su carta). Serve, ed è un caso reale, ma va costruito come
-- atto dichiarato per quello che è, con il suo tipo di evento e il suo autore
-- visibile, non travestito da firma del cliente. Finché non esiste, l'unica
-- accettazione possibile è quella vera.

CREATE OR REPLACE FUNCTION public.assert_offer_transition_actor(
  _new_status public.offer_status,
  _actor_type public.offer_event_actor_type
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF _new_status IN ('vista', 'accettata', 'rifiutata') AND _actor_type <> 'client' THEN
    RAISE EXCEPTION 'Lo stato % lo determina il cliente dal link pubblico, non un utente interno né un automatismo', _new_status
      USING errcode = 'check_violation',
            hint = 'Per registrare un''accettazione avvenuta fuori dal link serve un atto dedicato, che dichiari chi l''ha registrata';
  END IF;

  IF _new_status IN ('scaduta', 'superata', 'sostituita') AND _actor_type <> 'system' THEN
    RAISE EXCEPTION 'Lo stato % è una conseguenza, non una scelta: lo scrive il sistema', _new_status
      USING errcode = 'check_violation';
  END IF;

  IF _new_status IN ('bozza', 'in_approvazione', 'inviata') AND _actor_type = 'client' THEN
    RAISE EXCEPTION 'Il cliente non compone né invia le offerte'
      USING errcode = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_offer_transition_actor(public.offer_status, public.offer_event_actor_type) IS 'Vincola ogni stato all''attore che ha titolo per raggiungerlo. Estratta in una funzione a sé perché è una regola di dominio che va letta in un posto solo, e perché così la si può provare senza inscenare una transizione.';

REVOKE ALL ON FUNCTION public.assert_offer_transition_actor(public.offer_status, public.offer_event_actor_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_offer_transition_actor(public.offer_status, public.offer_event_actor_type) TO authenticated, service_role;


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

  -- Prima di tutto il resto: questo attore ha titolo per portare la versione
  -- in questo stato? Il controllo sta qui e non nei chiamanti perché questa è
  -- l'unica porta, e una regola che vive nei chiamanti è una regola che il
  -- prossimo chiamante dimenticherà.
  PERFORM public.assert_offer_transition_actor(_new_status, _actor_type);

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

  -- C) Accettazione e rifiuto valgono solo sulla versione corrente (AD-6).
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

  IF _old_status = 'bozza' AND _final_status <> 'bozza' THEN
    PERFORM public.freeze_offer_version_document(_offer_version_id);
  END IF;

  -- D) Il puntatore alla versione corrente si muove all'invio.
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

COMMENT ON FUNCTION public.set_offer_version_status(uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text) IS 'Unico varco per cambiare offer_versions.status. Vincola ogni stato all''attore legittimo (assert_offer_transition_actor), applica soglie di approvazione e quadratura, congela il documento alla prima uscita dalla bozza, muove il puntatore alla versione corrente all''invio, e notifica. Vedere, accettare e rifiutare restano atti del cliente: nessun utente interno può produrli.';

REVOKE ALL ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2) Il documento non si legge scavalcando la RLS
-- -----------------------------------------------------------------------------
-- Serve SECURITY DEFINER perché il congelamento gira anche in contesti dove
-- l'RLS del chiamante non basta, ma allora il controllo va messo dentro. Il
-- livello scelto è lo stesso della RLS delle tabelle che legge (utente
-- approvato), non uno più stretto: chi già vede l'offerta a schermo non deve
-- trovare qui una porta più chiusa.

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
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_approved_user(auth.uid()) THEN
    RAISE EXCEPTION 'Non autorizzato a leggere il documento di questa offerta';
  END IF;

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

REVOKE ALL ON FUNCTION public.build_offer_version_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_offer_version_snapshot(uuid) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3) Il token è una credenziale, non un dato
-- -----------------------------------------------------------------------------
-- Il resto del cantiere lascia leggere le offerte a tutto il team approvato, ed
-- è una scelta di prodotto ragionevole. Ma qui l'oggetto esposto non è un
-- prezzo: è la chiave con cui si firma. Chi la legge può aprire la pagina
-- pubblica e produrre una firma con hash corretto e IP reale, indistinguibile
-- da quella del cliente. Si restringe a chi ha titolo di gestire l'offerta, che
-- resta comunque tutto il commerciale, e i ruoli che con le offerte non
-- c'entrano smettono di vedere le chiavi.

DROP POLICY IF EXISTS "Approved users can view offer public links" ON public.offer_public_links;
CREATE POLICY "Offer managers can view offer public links"
ON public.offer_public_links FOR SELECT TO authenticated
USING (public.can_manage_offer(offer_id));
