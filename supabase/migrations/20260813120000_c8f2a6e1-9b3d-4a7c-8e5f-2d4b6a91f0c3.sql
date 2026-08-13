-- =============================================================================
-- Dominio offerte commerciali (TimeTrap / Larin)
-- =============================================================================
-- Introduce offers / offer_versions / offer_lines / offer_events e ESTENDE
-- products in place. Non tocca quotes / quote_payment_splits / quote_budgets:
-- restano il flusso di produzione esistente.
--
-- Principi seguiti (vedi discussione di architettura):
--  - Il contenuto (righe, totali, sconti, condizioni) appartiene alla VERSIONE,
--    non all'offerta. offers porta solo identità/numerazione/riferimenti.
--  - Le versioni non consumano la numerazione dell'offerta: version_number è
--    un indice progressivo interno all'offerta (offer_id, version_number).
--  - Lo stato vive su offer_versions ed è protetto: non è aggiornabile con una
--    UPDATE diretta dal client, solo tramite la funzione
--    public.set_offer_version_status(), che aggiorna lo stato E inserisce
--    l'evento corrispondente nello stesso passaggio (vedi sezione dedicata
--    più sotto per i dettagli del meccanismo di guardia scelto).
--  - offer_events è un registro append-only: nessuna policy di UPDATE/DELETE,
--    e a authenticated non viene concesso nemmeno il privilegio di INSERT
--    diretto (si scrive solo attraverso la funzione SECURITY DEFINER sopra).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Estensione di products (in place, colonne nullable/con default)
-- -----------------------------------------------------------------------------

-- Natura del prodotto: nullable perché non possiamo dedurre in modo affidabile
-- la natura dei prodotti già a catalogo; va valorizzata quando si compila la
-- scheda prodotto per l'uso nelle offerte.
CREATE TYPE public.product_nature AS ENUM ('una_tantum', 'ricorrente', 'a_giornate');

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS fic_id integer,
  ADD COLUMN IF NOT EXISTS revenue_category text,
  ADD COLUMN IF NOT EXISTS product_nature public.product_nature;

-- fic_id: riferimento al prodotto in Fatture in Cloud (stesso pattern già usato
-- per suppliers.fic_id / clients.fic_id). Nullable: non tutti i prodotti sono
-- ancora sincronizzati con FIC.
ALTER TABLE public.products
  ADD CONSTRAINT products_fic_id_key UNIQUE (fic_id);

COMMENT ON COLUMN public.products.vat_rate IS 'Aliquota IVA percentuale del prodotto (default 22%, stesso significato di budget_items.vat_rate/services.vat_rate)';
COMMENT ON COLUMN public.products.fic_id IS 'ID del prodotto corrispondente in Fatture in Cloud, per sync';
COMMENT ON COLUMN public.products.revenue_category IS 'Categoria di ricavo per la reportistica commerciale (testo libero: es. RICAVI MARKETING, RICAVI TECH - SOFTWARE, RICAVI BRANDING, RICAVI TECH - WEB, RICAVI JARVIS, RICAVI CANONI TECH, RICAVI CANONI MARKETING). Non è un enum perché il piano dei conti può evolvere senza richiedere una migration.';
COMMENT ON COLUMN public.products.product_nature IS 'Natura del prodotto ai fini di offerta/fatturazione: una tantum, ricorrente (canone) o a giornate';
COMMENT ON COLUMN public.products.category IS 'NB: colonna preesistente, categoria merceologica libera scelta in UI (non va confusa con revenue_category, che è la categoria di ricavo contabile)';


-- -----------------------------------------------------------------------------
-- 2) Enum del dominio offerte
-- -----------------------------------------------------------------------------

CREATE TYPE public.offer_origin AS ENUM ('commercial', 'tender');

-- Stato della VERSIONE (non dell'offerta). "accettata" non è terminale: una
-- versione accettata può essere sostituita da una versione successiva a sua
-- volta accettata (rinegoziazione, scope change concordato col cliente).
CREATE TYPE public.offer_status AS ENUM (
  'bozza',
  'in_approvazione',
  'inviata',
  'vista',
  'accettata',
  'rifiutata',
  'scaduta',
  'superata',
  'sostituita'
);

-- Attore di un evento sul registro: chi ha compiuto la transizione.
CREATE TYPE public.offer_event_actor_type AS ENUM ('user', 'client', 'system');


-- -----------------------------------------------------------------------------
-- 3) offers — identità, cliente, progetto, numerazione, origine
-- -----------------------------------------------------------------------------
-- current_version_id referenzia offer_versions, che non esiste ancora a questo
-- punto della migration: la colonna viene creata qui senza FK e il vincolo
-- viene aggiunto più sotto con ALTER TABLE, una volta creata offer_versions.

CREATE TABLE public.offers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  year integer NOT NULL,
  number integer NOT NULL,
  origin public.offer_origin NOT NULL DEFAULT 'commercial',
  current_version_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offers_year_number_key UNIQUE (year, number)
);

COMMENT ON TABLE public.offers IS 'Identità di un''offerta commerciale: cliente, progetto (opzionale), numerazione annuale, origine, puntatore alla versione corrente. Righe/totali/sconti/condizioni vivono su offer_versions.';
COMMENT ON COLUMN public.offers.client_id IS 'ON DELETE RESTRICT: un cliente con offerte storiche non è cancellabile (documento commerciale, non va perso in cascata)';
COMMENT ON COLUMN public.offers.number IS 'Progressivo assegnato alla creazione (vedi trigger offers_set_number). La garanzia di unicità reale è offers_year_number_key, non la sequenza in sé.';
COMMENT ON COLUMN public.offers.current_version_id IS 'FK a offer_versions aggiunta dopo la creazione della tabella (dipendenza circolare offers <-> offer_versions). Nullable perché alla creazione dell''offerta la prima versione non esiste ancora.';

-- Sequenza dedicata alla numerazione. Riparte da 1 ad ogni nuovo anno solare
-- (vedi trigger set_next_offer_number): è solo il generatore "veloce" del
-- candidato, non la garanzia di unicità, che è demandata all'indice univoco
-- (year, number) sopra.
CREATE SEQUENCE public.offer_number_seq;

CREATE OR REPLACE FUNCTION public.set_next_offer_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.year IS NULL THEN
    NEW.year := EXTRACT(year FROM now())::int;
  END IF;

  IF NEW.number IS NULL THEN
    -- Lock avvisorio per-anno: serializza solo le creazioni che cadono nello
    -- stesso anno (rilasciato automaticamente a fine transazione), per non
    -- affidarsi al solo "SELECT ... poi nextval" quando due offerte del primo
    -- giorno dell'anno arrivano nello stesso istante.
    PERFORM pg_advisory_xact_lock(hashtext('offer_number_seq:' || NEW.year::text));

    IF NOT EXISTS (SELECT 1 FROM public.offers WHERE year = NEW.year) THEN
      PERFORM setval('public.offer_number_seq', 1, false);
    END IF;

    NEW.number := nextval('public.offer_number_seq');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER offers_set_number
BEFORE INSERT ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.set_next_offer_number();

CREATE TRIGGER update_offers_updated_at
BEFORE UPDATE ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_offers_client_id ON public.offers(client_id);
CREATE INDEX idx_offers_project_id ON public.offers(project_id) WHERE project_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 4) offer_versions — contenuto, stato, totali
-- -----------------------------------------------------------------------------

CREATE TABLE public.offer_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  status public.offer_status NOT NULL DEFAULT 'bozza',
  list_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (list_total >= 0),
  offered_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (offered_total >= 0),
  payment_terms text,
  valid_until date,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_versions_offer_version_number_key UNIQUE (offer_id, version_number)
);

COMMENT ON TABLE public.offer_versions IS 'Contenuto versionato di un''offerta: stato, totali, condizioni. Le righe stanno su offer_lines.';
COMMENT ON COLUMN public.offer_versions.version_number IS 'Indice progressivo interno all''offerta (1, 2, 3...), assegnato dal trigger offer_versions_set_number. Le versioni NON consumano la numerazione dell''offerta (offers.number).';
COMMENT ON COLUMN public.offer_versions.list_total IS 'Totale a valore di listino (somma righe a prezzo pieno, senza sconti)';
COMMENT ON COLUMN public.offer_versions.offered_total IS 'Totale effettivamente offerto al cliente. Lo sconto effettivo è sempre calcolabile come (list_total - offered_total) anche quando le righe sono esposte al cliente a prezzo unico e i loro discount_percentage sono a zero.';
COMMENT ON COLUMN public.offer_versions.valid_until IS 'Data di validità dell''offerta: necessaria perché lo stato "scaduta" abbia un criterio oggettivo di applicazione (va gestito lato applicazione/cron, questa migration non aggiunge automatismi di scadenza)';
COMMENT ON COLUMN public.offer_versions.status IS 'Scrivibile SOLO tramite public.set_offer_version_status(): vedi trigger guard_offer_version_status e la REVOKE UPDATE(status) più sotto.';

-- Ora che offer_versions esiste, chiudiamo la dipendenza circolare.
ALTER TABLE public.offers
  ADD CONSTRAINT offers_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES public.offer_versions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_next_offer_version_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.version_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('offer_version_seq:' || NEW.offer_id::text));

    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO NEW.version_number
      FROM public.offer_versions
      WHERE offer_id = NEW.offer_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER offer_versions_set_number
BEFORE INSERT ON public.offer_versions
FOR EACH ROW EXECUTE FUNCTION public.set_next_offer_version_number();

CREATE TRIGGER update_offer_versions_updated_at
BEFORE UPDATE ON public.offer_versions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_offer_versions_offer_id ON public.offer_versions(offer_id);
CREATE INDEX idx_offer_versions_status ON public.offer_versions(status);


-- -----------------------------------------------------------------------------
-- 5) Guardia sullo stato: status aggiornabile solo via set_offer_version_status
-- -----------------------------------------------------------------------------
-- Meccanismo scelto (in alternativa al "trigger che verifica a posteriori se è
-- stato inserito l'evento corrispondente"): un trigger che rifiuta qualunque
-- UPDATE di status non accompagnata da un flag di sessione locale alla
-- transazione, flag che SOLO public.set_offer_version_status() può accendere
-- immediatamente prima di scrivere, e che spegne subito dopo. Il motivo per
-- cui questa strada è più solida di un trigger che "guarda indietro" in
-- offer_events: un trigger che si limita a controllare "esiste una riga in
-- offer_events che corrisponde a questa transizione" può essere aggirato
-- inserendo una riga finta in offer_events con gli stessi valori, perché la
-- verifica è per contenuto e non per provenienza. Il flag di transazione invece
-- lega la UPDATE al codice che l'ha prodotta, non al suo risultato.
-- In aggiunta, per authenticated viene revocato il privilegio di UPDATE sulla
-- sola colonna status (privilegio a livello di colonna): un client che provi
-- una "UPDATE offer_versions SET status = ..." diretta riceve un errore di
-- permessi ancora prima di arrivare al trigger. Il trigger resta comunque
-- attivo come seconda barriera, valida anche per chi avesse privilegi più ampi
-- sulla tabella (es. accesso diretto da SQL editor).

CREATE OR REPLACE FUNCTION public.guard_offer_version_status_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF current_setting('app.offer_status_transition_allowed', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'offer_versions.status si aggiorna solo tramite public.set_offer_version_status(), per garantire che ogni transizione sia registrata in offer_events';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_offer_version_status
BEFORE UPDATE ON public.offer_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_offer_version_status_update();

-- Nota: il privilegio UPDATE su offer_versions viene concesso più sotto
-- (sezione 11) solo su un elenco esplicito di colonne che NON include status
-- (non un GRANT su tutta la tabella seguito da una REVOKE della colonna: in
-- Postgres un GRANT di tabella successivo annullerebbe la REVOKE precedente,
-- verificato empiricamente in fase di stesura).


-- -----------------------------------------------------------------------------
-- 6) offer_lines — righe da listino, snapshot al momento dell'offerta
-- -----------------------------------------------------------------------------
-- I prezzi/aliquote/categoria sono copiati da products al momento della
-- creazione della riga (non un live join): un'offerta storica non deve
-- cambiare valore se il prodotto viene ripriceto in seguito. product_id resta
-- solo come riferimento per la reportistica ("quante offerte includono X").

CREATE TABLE public.offer_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_version_id uuid NOT NULL REFERENCES public.offer_versions(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  description text NOT NULL,
  revenue_category text,
  quantity numeric(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_list_price numeric(12,2) NOT NULL CHECK (unit_list_price >= 0),
  discount_percentage numeric NOT NULL DEFAULT 0 CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  vat_rate numeric NOT NULL DEFAULT 22,
  line_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.offer_lines IS 'Righe di una versione di offerta. Prezzo/aliquota/categoria sono uno snapshot da products al momento della creazione della riga, non un live join.';
COMMENT ON COLUMN public.offer_lines.product_id IS 'Riferimento al prodotto di catalogo per reportistica; ON DELETE SET NULL perché la riga ha già il proprio snapshot e sopravvive alla cancellazione del prodotto';
COMMENT ON COLUMN public.offer_lines.discount_percentage IS 'Sconto di riga; può restare a 0 quando lo sconto si applica solo a livello di versione (prezzo unico esposto al cliente), lo sconto effettivo si ricava comunque da offer_versions (list_total - offered_total)';

CREATE TRIGGER update_offer_lines_updated_at
BEFORE UPDATE ON public.offer_lines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_offer_lines_offer_version_id ON public.offer_lines(offer_version_id);
CREATE INDEX idx_offer_lines_product_id ON public.offer_lines(product_id) WHERE product_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 7) offer_events — registro append-only delle transizioni
-- -----------------------------------------------------------------------------
-- event_type è testo libero (non l'enum offer_status) perché non ogni evento
-- corrisponde 1:1 a una transizione di stato: "firmata" ad esempio accompagna
-- l'accettazione da parte del cliente senza essere uno stato a sé nell'enum
-- richiesto. previous_status/new_status restano nullable e si valorizzano solo
-- quando l'evento corrisponde effettivamente a un cambio di stato (sono questi
-- due campi che la funzione set_offer_version_status usa per accoppiare
-- l'evento alla UPDATE).

CREATE TABLE public.offer_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_version_id uuid NOT NULL REFERENCES public.offer_versions(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'creata', 'in_approvazione', 'inviata', 'vista', 'accettata', 'rifiutata',
    'scaduta', 'superata', 'sostituita', 'firmata'
  )),
  previous_status public.offer_status,
  new_status public.offer_status,
  actor_type public.offer_event_actor_type NOT NULL,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_token text,
  client_ip inet,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_events_actor_shape_check CHECK (
    (actor_type = 'user' AND actor_user_id IS NOT NULL AND client_token IS NULL AND client_ip IS NULL)
    OR (actor_type = 'client' AND actor_user_id IS NULL AND client_token IS NOT NULL AND client_ip IS NOT NULL)
    OR (actor_type = 'system' AND actor_user_id IS NULL AND client_token IS NULL)
  )
);

COMMENT ON TABLE public.offer_events IS 'Registro append-only delle transizioni di offer_versions. Nessuna policy di UPDATE/DELETE; a authenticated non è concesso nemmeno INSERT diretto (privilegio non garantito) - si scrive solo tramite public.set_offer_version_status(), SECURITY DEFINER.';
COMMENT ON COLUMN public.offer_events.actor_type IS 'user = staff Larin autenticato (FK a profiles); client = chi accetta/vede/firma senza account, identificato da token+IP; system = automatismi (es. scadenza)';
COMMENT ON CONSTRAINT offer_events_actor_shape_check ON public.offer_events IS 'Solo per actor_type=''user'' esiste una FK a un account; per ''client'' si registrano token e IP invece di un utente, perché le transizioni vista/accettata/firmata sono compiute da un cliente senza account';

CREATE INDEX idx_offer_events_offer_version_id ON public.offer_events(offer_version_id);


-- -----------------------------------------------------------------------------
-- 8) set_offer_version_status — unico varco per cambiare status
-- -----------------------------------------------------------------------------
-- Autorizzazione differenziata per tipo di attore:
--  - actor_type='user': il chiamante deve essere l'utente autenticato stesso
--    (actor_user_id = auth.uid()) e deve essere un utente approvato. Non è
--    sufficiente essere "authenticated": la registrazione al progetto è
--    aperta, quindi l'autorizzazione reale passa da is_approved_user().
--  - actor_type IN ('client','system'): riservato al service role. Un utente
--    autenticato normale NON può auto-dichiararsi "client" o "system": se
--    potesse, un membro dello staff potrebbe falsificare un'accettazione o una
--    firma del cliente. Il flusso reale (edge function che valida il token del
--    cliente) chiama questa funzione con la service role key, che in Supabase
--    espone auth.role() = 'service_role'.

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
-- 9) RLS — helper di autorizzazione
-- -----------------------------------------------------------------------------
-- Stesso pattern di public.can_access_project_tasks: is_approved_user() più
-- ruolo commerciale/finance (stessi ruoli già usati per quote_payment_splits)
-- oppure essere il creatore dell'offerta. "authenticated" da solo non basta:
-- la registrazione è aperta, quindi l'appartenenza a Larin passa sempre da
-- is_approved_user().

CREATE OR REPLACE FUNCTION public.can_manage_offer(_offer_id uuid)
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
    OR EXISTS (SELECT 1 FROM public.offers o WHERE o.id = _offer_id AND o.created_by = auth.uid())
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_offer_version(_offer_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.offer_versions v
    WHERE v.id = _offer_version_id AND public.can_manage_offer(v.offer_id)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.can_manage_offer(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_offer_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_offer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_offer_version(uuid) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 10) RLS — offers
-- -----------------------------------------------------------------------------

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.offers TO authenticated;
GRANT ALL ON public.offers TO service_role;

-- UPDATE concessa solo sulle colonne che è legittimo cambiare dopo la
-- creazione (a chi cliente è associata l'offerta, il progetto, quale versione
-- è "corrente"). year/number/client_id/created_by restano scrivibili solo dal
-- trigger di creazione e da service_role: un GRANT UPDATE a livello di tabella
-- qui non funzionerebbe come si vorrebbe, perché in Postgres una REVOKE su una
-- singola colonna non riduce un GRANT già dato sull'intera tabella (il
-- privilegio più ampio vince sempre) - va quindi concesso UPDATE solo sulle
-- colonne volute fin dall'inizio, non concesso-tutto-e-poi-tolto-un-pezzo.
GRANT UPDATE (project_id, origin, current_version_id) ON public.offers TO authenticated;

CREATE POLICY "Approved users can view offers"
ON public.offers FOR SELECT
TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Commercial roles or creator can create offers"
ON public.offers FOR INSERT
TO authenticated
WITH CHECK (
  public.is_approved_user(auth.uid())
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'account')
    OR public.has_role(auth.uid(), 'finance')
    OR created_by = auth.uid()
  )
);

CREATE POLICY "Commercial roles or creator can update offers"
ON public.offers FOR UPDATE
TO authenticated
USING (public.can_manage_offer(id))
WITH CHECK (public.can_manage_offer(id));

-- DELETE ammessa solo se nessuna versione ha mai lasciato lo stato di bozza:
-- coerente con l'idea di registro/versioni come storico da non perdere in
-- cascata una volta che l'offerta è uscita "in produzione" (inviata al cliente
-- o oltre). Le bozze createe per errore restano cancellabili.
CREATE POLICY "Commercial roles or creator can delete draft-only offers"
ON public.offers FOR DELETE
TO authenticated
USING (
  public.can_manage_offer(id)
  AND NOT EXISTS (
    SELECT 1 FROM public.offer_versions v
    WHERE v.offer_id = offers.id AND v.status <> 'bozza'
  )
);


-- -----------------------------------------------------------------------------
-- 11) RLS — offer_versions
-- -----------------------------------------------------------------------------

ALTER TABLE public.offer_versions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.offer_versions TO authenticated;
GRANT ALL ON public.offer_versions TO service_role;

-- UPDATE concessa solo sulle colonne di contenuto, MAI su status: status si
-- cambia solo tramite public.set_offer_version_status(). Come sopra per
-- offers, il motivo per cui questo è un GRANT su un elenco esplicito di
-- colonne e non un "GRANT tutto, poi REVOKE status" è che in Postgres un
-- GRANT UPDATE a livello di tabella non viene ridotto da una REVOKE su una
-- singola colonna (vince il privilegio più ampio) - verificato empiricamente
-- in fase di stesura di questa migration. Il trigger guard_offer_version_status
-- resta comunque attivo come seconda barriera indipendente dai privilegi.
GRANT UPDATE (list_total, offered_total, payment_terms, valid_until) ON public.offer_versions TO authenticated;

CREATE POLICY "Approved users can view offer versions"
ON public.offer_versions FOR SELECT
TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Offer managers can create versions"
ON public.offer_versions FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_offer(offer_id));

CREATE POLICY "Offer managers can update versions"
ON public.offer_versions FOR UPDATE
TO authenticated
USING (public.can_manage_offer(offer_id))
WITH CHECK (public.can_manage_offer(offer_id));

-- Stessa logica della DELETE su offers: una volta uscita dalla bozza, la
-- versione è storico e non va persa (con essa andrebbe perso anche il
-- relativo registro eventi, che è append-only per definizione).
CREATE POLICY "Offer managers can delete draft versions"
ON public.offer_versions FOR DELETE
TO authenticated
USING (public.can_manage_offer(offer_id) AND status = 'bozza');


-- -----------------------------------------------------------------------------
-- 12) RLS — offer_lines
-- -----------------------------------------------------------------------------

ALTER TABLE public.offer_lines ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_lines TO authenticated;
GRANT ALL ON public.offer_lines TO service_role;

CREATE POLICY "Approved users can view offer lines"
ON public.offer_lines FOR SELECT
TO authenticated
USING (public.is_approved_user(auth.uid()));

CREATE POLICY "Offer managers can create lines"
ON public.offer_lines FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_offer_version(offer_version_id));

CREATE POLICY "Offer managers can update lines"
ON public.offer_lines FOR UPDATE
TO authenticated
USING (public.can_manage_offer_version(offer_version_id))
WITH CHECK (public.can_manage_offer_version(offer_version_id));

CREATE POLICY "Offer managers can delete lines"
ON public.offer_lines FOR DELETE
TO authenticated
USING (public.can_manage_offer_version(offer_version_id));


-- -----------------------------------------------------------------------------
-- 13) RLS — offer_events (sola lettura per i client, scrittura solo via RPC)
-- -----------------------------------------------------------------------------

ALTER TABLE public.offer_events ENABLE ROW LEVEL SECURITY;

-- Nota: nessun GRANT INSERT/UPDATE/DELETE a authenticated. Anche in presenza
-- di una policy permissiva, senza il privilegio di colonna/tabella la scrittura
-- diretta fallirebbe comunque: la si nega ad entrambi i livelli (privilegi e
-- RLS) invece di affidarsi soltanto all'assenza di policy.
GRANT SELECT ON public.offer_events TO authenticated;
GRANT ALL ON public.offer_events TO service_role;

CREATE POLICY "Approved users can view offer events"
ON public.offer_events FOR SELECT
TO authenticated
USING (public.is_approved_user(auth.uid()));

-- Nessuna policy di INSERT/UPDATE/DELETE per authenticated: si scrive solo
-- tramite public.set_offer_version_status(), SECURITY DEFINER, che come
-- owner della tabella bypassa RLS by design in Postgres.
