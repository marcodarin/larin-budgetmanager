-- =============================================================================
-- Piano di pagamento delle offerte
-- =============================================================================
-- Estende il dominio offerte (20260813120000 / 20260813130000) con:
--  1) payment_terms che sa calcolare una scadenza (giorni + regola di decorrenza),
--     invece di essere solo un'etichetta.
--  2) offer_versions.billing_mode: il modo di fatturazione della versione
--     (importo finito / ricorrente / a giornate / tetto di spesa), da cui
--     dipende SE la quadratura per importo ha senso.
--  3) offer_payment_terms: le tranche del piano di pagamento.
--  4) La quadratura per le offerte a importo finito, verificata al momento
--     giusto (vedi sezione 7 per la scelta e il perché).
--
-- Nota terminologica: offer_versions.billing_mode NON è projects.billing_type
-- (one_shot/pack/recurring/interno, testo libero sul progetto operativo) né
-- products.product_nature (una_tantum/ricorrente/a_giornate, sul prodotto di
-- catalogo). billing_mode vive sulla VERSIONE dell'offerta commerciale ed è il
-- concetto che decide come deve quadrare il piano di pagamento: un'offerta può
-- contenere prodotti di nature diverse ma ha un solo modo di fatturazione
-- complessivo nei confronti del cliente.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) payment_terms — da etichetta a regola di scadenza
-- -----------------------------------------------------------------------------
-- days e due_basis sono nullable: le righe esistenti restano valide per il
-- codice che le usa oggi come semplice etichetta (value/label). Un termine con
-- days IS NULL però non deve poter essere scelto su una tranche nuova: vedi il
-- trigger guard_offer_payment_term_selectable più sotto, in sezione 5.

CREATE TYPE public.payment_term_due_basis AS ENUM ('data_documento', 'fine_mese');

ALTER TABLE public.payment_terms
  ADD COLUMN IF NOT EXISTS days integer,
  ADD COLUMN IF NOT EXISTS due_basis public.payment_term_due_basis;

ALTER TABLE public.payment_terms
  ADD CONSTRAINT payment_terms_days_check CHECK (days IS NULL OR days >= 0),
  ADD CONSTRAINT payment_terms_days_due_basis_check CHECK (
    (days IS NULL AND due_basis IS NULL) OR (days IS NOT NULL AND due_basis IS NOT NULL)
  );

COMMENT ON COLUMN public.payment_terms.days IS 'Giorni di dilazione dalla base di calcolo indicata da due_basis. NULL sui termini storici che restano etichette pure: non selezionabili su una tranche di offer_payment_terms (vedi guard_offer_payment_term_selectable).';
COMMENT ON COLUMN public.payment_terms.due_basis IS 'Base di calcolo della scadenza: data_documento = data del documento + days; fine_mese = fine mese del documento + days (es. "60gg FM" = fine mese + 60 giorni). Nullo se e solo se days è nullo (payment_terms_days_due_basis_check).';

-- Backfill mirato: solo per i valori storici la cui etichetta codifica già
-- giorni e base in modo inequivocabile (i suffissi "DF"/"FM" già in uso).
-- Le altre righe (Anticipo 50/100%, A consegna, Rimessa diretta) non sono
-- termini "a giorni" e restano NULL: non è un'omissione, è che non lo sono.
UPDATE public.payment_terms SET days = 30, due_basis = 'data_documento' WHERE value = '30gg DF' AND days IS NULL;
UPDATE public.payment_terms SET days = 60, due_basis = 'data_documento' WHERE value = '60gg DF' AND days IS NULL;
UPDATE public.payment_terms SET days = 90, due_basis = 'data_documento' WHERE value = '90gg DF' AND days IS NULL;
UPDATE public.payment_terms SET days = 30, due_basis = 'fine_mese'     WHERE value = '30gg FM' AND days IS NULL;
UPDATE public.payment_terms SET days = 60, due_basis = 'fine_mese'     WHERE value = '60gg FM' AND days IS NULL;
UPDATE public.payment_terms SET days = 90, due_basis = 'fine_mese'     WHERE value = '90gg FM' AND days IS NULL;

-- Funzione che produce davvero la scadenza, dato un termine e la data del
-- documento da cui decorre (fattura o altro documento di riferimento).
CREATE OR REPLACE FUNCTION public.compute_payment_term_due_date(_payment_term_id uuid, _document_date date)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_days integer;
  v_due_basis public.payment_term_due_basis;
  v_base date;
BEGIN
  SELECT days, due_basis INTO v_days, v_due_basis
    FROM public.payment_terms
   WHERE id = _payment_term_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Termine di pagamento % non trovato', _payment_term_id;
  END IF;

  IF v_days IS NULL THEN
    RAISE EXCEPTION 'Il termine di pagamento % è solo un''etichetta storica (giorni non impostati): non può calcolare una scadenza', _payment_term_id;
  END IF;

  IF v_due_basis = 'fine_mese' THEN
    v_base := (date_trunc('month', _document_date) + interval '1 month - 1 day')::date;
  ELSE
    v_base := _document_date;
  END IF;

  RETURN v_base + v_days;
END;
$$;

COMMENT ON FUNCTION public.compute_payment_term_due_date(uuid, date) IS 'Calcola la data di scadenza di un termine di pagamento a partire dalla data del documento (fattura o altro). Solleva eccezione sui termini storici senza days/due_basis.';

REVOKE ALL ON FUNCTION public.compute_payment_term_due_date(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_payment_term_due_date(uuid, date) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2) offer_versions.billing_mode — il modo di fatturazione della versione
-- -----------------------------------------------------------------------------

CREATE TYPE public.offer_billing_mode AS ENUM ('importo_finito', 'ricorrente', 'a_giornate', 'tetto_di_spesa');

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS billing_mode public.offer_billing_mode NOT NULL DEFAULT 'importo_finito';

COMMENT ON COLUMN public.offer_versions.billing_mode IS 'Modo di fatturazione dell''offerta: importo_finito (il caso più comune, il piano quadra sul totale offerto), ricorrente/a_giornate/tetto_di_spesa (quadrano per periodo o consumo, non su un totale fisso: vedi validate_offer_payment_terms_balance).';

-- Contenuto della versione: billing_mode si aggiunge ai campi già congelati da
-- guard_offer_version_content_immutable una volta uscita dalla bozza (stessa
-- funzione della migration 20260813130000, qui sostituita per intero: la
-- CREATE OR REPLACE mantiene lo stesso trigger già agganciato, che continua a
-- puntare a questa funzione per OID e non richiede di essere ricreato).
create or replace function public.guard_offer_version_content_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'bozza' then
      raise exception 'Non si elimina una versione già uscita (stato %): crearne una nuova.', old.status
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'bozza' then
    return new;
  end if;

  -- Su una versione non più in bozza si tollera solo il cambio di stato
  -- (gestito dalla sua guardia) e l'aggiornamento tecnico di updated_at.
  if new.list_total     is distinct from old.list_total
     or new.offered_total is distinct from old.offered_total
     or new.payment_terms is distinct from old.payment_terms
     or new.valid_until   is distinct from old.valid_until
     or new.billing_mode  is distinct from old.billing_mode
     or new.offer_id      is distinct from old.offer_id
     or new.version_number is distinct from old.version_number then
    raise exception 'Il contenuto di una versione già uscita (stato %) non è modificabile: crearne una nuova.', old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Colonna nuova nell'elenco già concesso in UPDATE ad authenticated (additivo:
-- non sostituisce il grant esistente, lo estende - vedi nota sulla semantica
-- dei GRANT per colonna nella migration 20260813120000, sezione 11).
GRANT UPDATE (billing_mode) ON public.offer_versions TO authenticated;


-- -----------------------------------------------------------------------------
-- 3) Enum delle tranche
-- -----------------------------------------------------------------------------

CREATE TYPE public.offer_payment_term_maturity_event AS ENUM (
  'firma', 'consegna', 'pubblicazione_fase', 'data_calendario', 'ricorrente'
);

CREATE TYPE public.offer_payment_term_maturity_status AS ENUM ('da_maturare', 'maturata');


-- -----------------------------------------------------------------------------
-- 4) offer_payment_terms — le tranche del piano di pagamento
-- -----------------------------------------------------------------------------
-- Importo XOR percentuale: mai entrambi, mai nessuno dei due (constraint
-- amount_xor_percentage). payment_term_id è NOT NULL con ON DELETE RESTRICT:
-- a differenza delle *_payment_splits esistenti (dove il termine è opzionale
-- e il payment_mode porta già il senso della riga), qui il termine è
-- l'unico modo per calcolare la scadenza, quindi è obbligatorio; RESTRICT
-- perché un termine usato da una tranche storica non va perso in cascata
-- (per ritirarlo si usa payment_terms.is_active, non la cancellazione).
--
-- scheduled_date e phase_label sono usati solo dal rispettivo evento di
-- maturazione (data_calendario / pubblicazione_fase): non esiste ancora
-- un'entità "fase di progetto" nello schema, quindi phase_label resta testo
-- libero, stesso principio già seguito per products.revenue_category.

CREATE TABLE public.offer_payment_terms (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_version_id uuid NOT NULL REFERENCES public.offer_versions(id) ON DELETE CASCADE,
  amount numeric(12,2) CHECK (amount > 0),
  percentage numeric CHECK (percentage > 0 AND percentage <= 100),
  payment_term_id uuid NOT NULL REFERENCES public.payment_terms(id) ON DELETE RESTRICT,
  maturity_event public.offer_payment_term_maturity_event NOT NULL,
  scheduled_date date,
  phase_label text,
  display_order integer NOT NULL DEFAULT 0,
  maturity_status public.offer_payment_term_maturity_status NOT NULL DEFAULT 'da_maturare',
  matured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_payment_terms_amount_xor_percentage_check CHECK (
    (amount IS NOT NULL AND percentage IS NULL) OR (amount IS NULL AND percentage IS NOT NULL)
  ),
  CONSTRAINT offer_payment_terms_scheduled_date_check CHECK (
    (maturity_event = 'data_calendario') = (scheduled_date IS NOT NULL)
  ),
  CONSTRAINT offer_payment_terms_phase_label_check CHECK (
    (maturity_event = 'pubblicazione_fase') = (phase_label IS NOT NULL)
  )
);

COMMENT ON TABLE public.offer_payment_terms IS 'Tranche del piano di pagamento di una versione di offerta. Importo o percentuale (mai entrambi), termine di pagamento per calcolare la scadenza, evento che fa maturare la tranche, stato di maturazione.';
COMMENT ON COLUMN public.offer_payment_terms.amount IS 'Importo fisso della tranche; esclusivo con percentage (offer_payment_terms_amount_xor_percentage_check)';
COMMENT ON COLUMN public.offer_payment_terms.percentage IS 'Percentuale della tranche sul totale offerto della versione; esclusiva con amount. Su offerte a importo finito concorre alla quadratura (vedi validate_offer_payment_terms_balance)';
COMMENT ON COLUMN public.offer_payment_terms.payment_term_id IS 'FK a payment_terms per calcolare la scadenza (giorni + decorrenza). Deve avere days valorizzato: vedi guard_offer_payment_term_selectable';
COMMENT ON COLUMN public.offer_payment_terms.maturity_event IS 'Evento che fa maturare la tranche: firma, consegna, pubblicazione di una fase, una data di calendario, oppure ricorrente (periodica). Non aggiunge automatismi di generazione delle occorrenze ricorrenti: resta un tag, la schedulazione concreta è demandata all''applicazione.';
COMMENT ON COLUMN public.offer_payment_terms.scheduled_date IS 'Data di calendario a cui la tranche matura; valorizzata solo quando maturity_event = data_calendario';
COMMENT ON COLUMN public.offer_payment_terms.phase_label IS 'Etichetta libera della fase il cui rilascio fa maturare la tranche; valorizzata solo quando maturity_event = pubblicazione_fase (non esiste ancora un''entità "fase" in schema)';
COMMENT ON COLUMN public.offer_payment_terms.maturity_status IS 'Scrivibile SOLO tramite public.mark_offer_payment_term_matured(): vedi trigger guard_offer_payment_term_maturity e il GRANT UPDATE per colonne più sotto.';
COMMENT ON COLUMN public.offer_payment_terms.matured_at IS 'Timestamp in cui la tranche è maturata, impostato da public.mark_offer_payment_term_matured(). Nessun automatismo di sistema la valorizza da sola (es. il passaggio di scheduled_date non matura la tranche in automatico: va gestito lato applicazione/cron, come già per offer_versions.valid_until).';

CREATE TRIGGER update_offer_payment_terms_updated_at
BEFORE UPDATE ON public.offer_payment_terms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_offer_payment_terms_offer_version_id ON public.offer_payment_terms(offer_version_id);
CREATE INDEX idx_offer_payment_terms_payment_term_id ON public.offer_payment_terms(payment_term_id);


-- -----------------------------------------------------------------------------
-- 5) Guardia: il termine selezionato deve saper calcolare una scadenza
-- -----------------------------------------------------------------------------
-- Un payment_term con days IS NULL resta valido per il vecchio codice (che lo
-- legge solo come label) ma non è utilizzabile su una tranche nuova: qui è un
-- controllo di riga singola (non serve sommare righe sorelle), quindi un
-- trigger BEFORE INSERT/UPDATE OF payment_term_id basta ed è la scelta più
-- semplice.

CREATE OR REPLACE FUNCTION public.guard_offer_payment_term_selectable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_days integer;
BEGIN
  SELECT days INTO v_days FROM public.payment_terms WHERE id = new.payment_term_id;

  IF v_days IS NULL THEN
    RAISE EXCEPTION 'Il termine di pagamento selezionato non ha i giorni di dilazione impostati: non è utilizzabile su una tranche di offerta (è solo un''etichetta storica)'
      USING errcode = 'check_violation';
  END IF;

  RETURN new;
END;
$$;

CREATE TRIGGER trg_offer_payment_terms_selectable
BEFORE INSERT OR UPDATE OF payment_term_id ON public.offer_payment_terms
FOR EACH ROW EXECUTE FUNCTION public.guard_offer_payment_term_selectable();


-- -----------------------------------------------------------------------------
-- 6) Guardia sulla maturazione: stessa meccanica di guard_offer_version_status
-- -----------------------------------------------------------------------------
-- maturity_status/matured_at si scrivono SOLO tramite
-- public.mark_offer_payment_term_matured(), riusando esattamente il
-- meccanismo già scelto per offer_versions.status: un flag di transazione che
-- solo la funzione accende immediatamente prima di scrivere. La guardia è
-- incondizionata rispetto allo stato della versione (si applica anche in
-- bozza): a differenza del contenuto (sezione 7), la maturazione non ha un
-- "periodo libero" in cui è modificabile a piacere, ha sempre e solo
-- quell'unico varco.

CREATE OR REPLACE FUNCTION public.guard_offer_payment_term_maturity_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF tg_op = 'INSERT' THEN
    IF (new.maturity_status IS DISTINCT FROM 'da_maturare' OR new.matured_at IS NOT NULL)
       AND current_setting('app.offer_payment_term_maturity_transition_allowed', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'Una tranche nuova nasce sempre da_maturare: la maturazione si registra solo tramite public.mark_offer_payment_term_matured()';
    END IF;
    RETURN new;
  END IF;

  IF new.maturity_status IS DISTINCT FROM old.maturity_status
     OR new.matured_at IS DISTINCT FROM old.matured_at THEN
    IF current_setting('app.offer_payment_term_maturity_transition_allowed', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'offer_payment_terms.maturity_status/matured_at si aggiornano solo tramite public.mark_offer_payment_term_matured()';
    END IF;
  END IF;

  RETURN new;
END;
$$;

CREATE TRIGGER guard_offer_payment_term_maturity
BEFORE INSERT OR UPDATE ON public.offer_payment_terms
FOR EACH ROW EXECUTE FUNCTION public.guard_offer_payment_term_maturity_update();

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

  IF NOT public.can_manage_offer_version(_offer_version_id) THEN
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

COMMENT ON FUNCTION public.mark_offer_payment_term_matured(uuid, timestamptz) IS 'Unico varco per marcare una tranche come maturata (nessun revert: non richiesto). Non genera automatismi per data_calendario/ricorrente: la valutazione "è arrivata la data" resta a carico dell''applicazione/cron, questa funzione registra solo il fatto compiuto.';

REVOKE ALL ON FUNCTION public.mark_offer_payment_term_matured(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_offer_payment_term_matured(uuid, timestamptz) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7) Immutabilità del contenuto: stesso meccanismo di offer_lines
-- -----------------------------------------------------------------------------
-- Stessa regola di offer_lines: si modifica/inserisce/elimina solo finché la
-- versione è in bozza. Unica differenza rispetto a offer_lines: qui esistono
-- due colonne (maturity_status, matured_at) che DEVONO poter cambiare anche
-- dopo l'uscita dalla bozza (è l'intero senso di tracciare la maturazione, che
-- avviene tipicamente a offerta già accettata) - sono quindi escluse dal
-- confronto, e sono già protette per conto loro dalla guardia della sezione 6.
-- Stesso principio con cui offer_versions esclude "status" dalla propria
-- guardia di contenuto (vedi commento in quella funzione).

CREATE OR REPLACE FUNCTION public.guard_offer_payment_terms_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status public.offer_status;
  v_version_id uuid;
BEGIN
  v_version_id := coalesce(new.offer_version_id, old.offer_version_id);
  SELECT status INTO v_status FROM public.offer_versions WHERE id = v_version_id;

  -- Versione già sparita (cancellazione a cascata di una bozza): niente da difendere.
  IF v_status IS NULL THEN
    RETURN coalesce(new, old);
  END IF;

  IF v_status = 'bozza' THEN
    RETURN coalesce(new, old);
  END IF;

  IF tg_op = 'DELETE' THEN
    RAISE EXCEPTION 'Le tranche di una versione già uscita (stato %) non sono eliminabili: crearne una nuova.', v_status
      USING errcode = 'check_violation';
  END IF;

  IF tg_op = 'INSERT' THEN
    RAISE EXCEPTION 'Non si aggiungono tranche a una versione già uscita (stato %): crearne una nuova.', v_status
      USING errcode = 'check_violation';
  END IF;

  IF new.amount IS DISTINCT FROM old.amount
     OR new.percentage IS DISTINCT FROM old.percentage
     OR new.payment_term_id IS DISTINCT FROM old.payment_term_id
     OR new.maturity_event IS DISTINCT FROM old.maturity_event
     OR new.scheduled_date IS DISTINCT FROM old.scheduled_date
     OR new.phase_label IS DISTINCT FROM old.phase_label
     OR new.display_order IS DISTINCT FROM old.display_order
     OR new.offer_version_id IS DISTINCT FROM old.offer_version_id THEN
    RAISE EXCEPTION 'Il contenuto di una tranche su una versione già uscita (stato %) non è modificabile: crearne una nuova versione. Solo lo stato di maturazione può ancora evolvere.', v_status
      USING errcode = 'check_violation';
  END IF;

  RETURN new;
END;
$$;

CREATE TRIGGER trg_offer_payment_terms_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.offer_payment_terms
FOR EACH ROW EXECUTE FUNCTION public.guard_offer_payment_terms_immutable();


-- -----------------------------------------------------------------------------
-- 8) Quadratura per importo finito
-- -----------------------------------------------------------------------------
-- Perché una funzione invocata al momento giusto e non un trigger su
-- offer_payment_terms: un CHECK di riga non può sommare le righe sorelle, e un
-- trigger AFTER EACH ROW/STATEMENT su INSERT/UPDATE/DELETE di
-- offer_payment_terms romperebbe il flusso normale di compilazione di
-- un'offerta in bozza, dove si aggiunge una tranche alla volta e la somma NON
-- quadra finché non si è inserita anche l'ultima (un trigger che pretendesse
-- di quadrare ad ogni riga bloccherebbe la primissima tranche di ogni
-- offerta). Il momento in cui il piano DEVE essere quadrato è invece ben
-- definito ed è già presidiato da un varco unico nel dominio: l'uscita dalla
-- bozza, cioè esattamente quando guard_offer_version_content_immutable
-- congela il contenuto per sempre. La validazione si aggancia quindi dentro
-- public.set_offer_version_status(), nel punto in cui old_status = 'bozza' e
-- new_status è diverso: è l'ultima occasione utile per rifiutare la
-- transizione, e rifiutandola con un'eccezione si annulla anche lo UPDATE di
-- status nella stessa transazione (nessuno stato "a metà").

CREATE OR REPLACE FUNCTION public.validate_offer_payment_terms_balance(_offer_version_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_billing_mode public.offer_billing_mode;
  v_offered_total numeric(12,2);
  v_count integer;
  v_sum numeric;
  v_tolerance numeric;
BEGIN
  SELECT billing_mode, offered_total INTO v_billing_mode, v_offered_total
    FROM public.offer_versions
   WHERE id = _offer_version_id;

  IF v_billing_mode IS DISTINCT FROM 'importo_finito' THEN
    -- Ricorrente / a giornate / tetto di spesa: quadrano per periodo o per
    -- consumo, non su un totale fisso che per queste offerte non esiste.
    RETURN;
  END IF;

  SELECT count(*), coalesce(sum(coalesce(amount, round(v_offered_total * percentage / 100, 2))), 0)
    INTO v_count, v_sum
    FROM public.offer_payment_terms
   WHERE offer_version_id = _offer_version_id;

  -- Nessuna tranche: non c'è quadratura da verificare, e l'offerta esce
  -- comunque dalla bozza. Rendere il piano di pagamento OBBLIGATORIO per
  -- inviare è una decisione di prodotto che non è stata presa: né il PRD né
  -- l'architettura la stabiliscono, e imporla qui bloccherebbe il flusso base
  -- (comporre e mandare un'offerta) prima che esista l'interfaccia delle
  -- tranche. Se in seguito si decide che il piano è obbligatorio, questa è
  -- una riga, ma va decisa come regola commerciale e non introdotta come
  -- effetto collaterale di una validazione tecnica.
  IF v_count = 0 THEN
    RETURN;
  END IF;

  -- Tolleranza di un centesimo di PUNTO PERCENTUALE per tranche, non di
  -- valuta: tre tranche al 33,33% non sommano a 100 (33,33 x 3 = 99,99, uno
  -- scarto di 0,01 punti percentuali), e lo stesso scarto vale sia su
  -- un'offerta da 100 euro sia su una da 100.000 - deve quindi essere
  -- calcolato in proporzione al totale offerto, non come un numero fisso di
  -- centesimi di euro (che coprirebbe l'esempio solo per un'offerta da
  -- esattamente 100 euro). count(*) * 0.01 sono i punti percentuali di
  -- scarto tollerati; il tetto in valuta si ottiene applicandoli al totale.
  v_tolerance := round(v_offered_total * (v_count * 0.01) / 100, 2);

  IF abs(v_sum - v_offered_total) > v_tolerance THEN
    RAISE EXCEPTION 'Le tranche di pagamento (%) non quadrano con il totale offerto (%): differenza % oltre la tolleranza di % (0,01 punti percentuali per tranche, % tranche)',
      v_sum, v_offered_total, abs(v_sum - v_offered_total), v_tolerance, v_count;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.validate_offer_payment_terms_balance(uuid) IS 'Verifica che le tranche quadrino col totale offerto, solo per billing_mode = importo_finito. Invocata da public.set_offer_version_status() alla prima uscita dalla bozza (vedi sezione 8 per il perché non è un trigger su offer_payment_terms).';

REVOKE ALL ON FUNCTION public.validate_offer_payment_terms_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_offer_payment_terms_balance(uuid) TO authenticated, service_role;

-- CREATE OR REPLACE della funzione della migration 20260813120000, stesso
-- corpo con l'aggiunta della chiamata di validazione appena prima di
-- eseguire la transizione, solo quando si sta lasciando la bozza.
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

  SELECT status INTO _old_status
    FROM public.offer_versions
   WHERE id = _offer_version_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versione offerta % non trovata', _offer_version_id;
  END IF;

  -- Quadratura: solo alla prima uscita dalla bozza, perché è il momento in
  -- cui il contenuto (comprese le tranche) si congela per sempre.
  IF _old_status = 'bozza' AND _new_status <> 'bozza' THEN
    PERFORM public.validate_offer_payment_terms_balance(_offer_version_id);
  END IF;

  PERFORM set_config('app.offer_status_transition_allowed', 'on', true);

  UPDATE public.offer_versions
     SET status = _new_status
   WHERE id = _offer_version_id;

  PERFORM set_config('app.offer_status_transition_allowed', 'off', true);

  INSERT INTO public.offer_events (
    offer_version_id, event_type, previous_status, new_status,
    actor_type, actor_user_id, client_token, client_ip, note
  ) VALUES (
    _offer_version_id, _event_type, _old_status, _new_status,
    _actor_type, _actor_user_id, _client_token, _client_ip, _note
  )
  RETURNING * INTO _event;

  RETURN _event;
END;
$$;

REVOKE ALL ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_offer_version_status(
  uuid, public.offer_status, text, public.offer_event_actor_type, uuid, text, inet, text
) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 9) RLS — offer_payment_terms
-- -----------------------------------------------------------------------------
-- Stesso pattern di offer_lines (is_approved_user() + can_manage_offer_version,
-- mai USING (true)). maturity_status/matured_at restano fuori dal GRANT UPDATE
-- per colonne, esattamente come offer_versions.status: chi ha privilegi di
-- UPDATE sulla tabella non può comunque scriverle con una UPDATE diretta,
-- deve passare da public.mark_offer_payment_term_matured() (SECURITY DEFINER,
-- non soggetta ai grant per colonna del chiamante).

ALTER TABLE public.offer_payment_terms ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.offer_payment_terms TO authenticated;
GRANT ALL ON public.offer_payment_terms TO service_role;
GRANT UPDATE (amount, percentage, payment_term_id, maturity_event, scheduled_date, phase_label, display_order)
  ON public.offer_payment_terms TO authenticated;

CREATE POLICY "Approved users can view offer payment terms"
ON public.offer_payment_terms FOR SELECT
TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Offer managers can create payment terms"
ON public.offer_payment_terms FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_offer_version(offer_version_id));

CREATE POLICY "Offer managers can update payment terms"
ON public.offer_payment_terms FOR UPDATE
TO authenticated
USING (public.can_manage_offer_version(offer_version_id))
WITH CHECK (public.can_manage_offer_version(offer_version_id));

CREATE POLICY "Offer managers can delete payment terms"
ON public.offer_payment_terms FOR DELETE
TO authenticated
USING (public.can_manage_offer_version(offer_version_id));
