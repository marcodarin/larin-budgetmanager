-- =============================================================================
-- I privilegi di tabella dichiarati non erano quelli reali
-- =============================================================================
-- Scoperto provando a violare gli invarianti sullo staging: su ogni tabella del
-- cantiere, `anon` e `authenticated` hanno DELETE, INSERT, SELECT, TRUNCATE e
-- UPDATE. Non perché qualcuno li abbia concessi, ma perché il progetto ha
-- privilegi di default sullo schema public (ALTER DEFAULT PRIVILEGES) che li
-- assegnano a ogni tabella nuova nel momento in cui nasce.
--
-- Conseguenza: le GRANT scritte nelle migration di questo cantiere non
-- limitavano niente, erano additive su un privilegio già pieno. In particolare
-- non era vero, come dichiarato in 20260813120000, che la colonna `status`
-- fosse protetta anche dal privilegio oltre che dal trigger: la proteggeva solo
-- il trigger. E non era vero, come dichiarato per offer_events, che a
-- authenticated "non è concesso nemmeno INSERT diretto".
--
-- Il sistema ha retto lo stesso perché la RLS ferma tutto ciò che non ha una
-- policy: le scritture non passano, ma passano in silenzio, restituendo zero
-- righe invece di un errore. Una difesa sola, e muta.
--
-- Qui si riportano i privilegi a quello che le migration dicevano di fare. La
-- forma è obbligata: prima REVOKE ALL (che porta via anche i privilegi per
-- colonna), poi GRANT dell'elenco esatto. Concedere per colonna senza revocare
-- prima non toglie niente, ed è esattamente l'errore che ha reso inefficaci le
-- GRANT precedenti.
--
-- Perimetro: le tabelle di questo cantiere. Le tabelle storiche di TimeTrap
-- hanno lo stesso difetto ma non si toccano qui, perché cambiarne i privilegi
-- senza poter provare l'intera applicazione sposterebbe il rischio invece di
-- ridurlo. Va segnalato a parte.
-- =============================================================================

-- anon non ha alcun titolo su nessuna tabella del cantiere: il cliente esterno
-- parla con la edge function, non con il database (AD-12).
REVOKE ALL ON public.offers FROM anon;
REVOKE ALL ON public.offer_versions FROM anon;
REVOKE ALL ON public.offer_lines FROM anon;
REVOKE ALL ON public.offer_events FROM anon;
REVOKE ALL ON public.offer_payment_terms FROM anon;
REVOKE ALL ON public.offer_public_links FROM anon;
REVOKE ALL ON public.offer_public_link_accesses FROM anon;
REVOKE ALL ON public.offer_version_documents FROM anon;
REVOKE ALL ON public.offer_signatures FROM anon;

-- offer_versions: si compone e si cancella una bozza, si aggiornano i totali e
-- le condizioni. Lo stato no: quello passa da set_offer_version_status.
REVOKE ALL ON public.offer_versions FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.offer_versions TO authenticated;
GRANT UPDATE (list_total, offered_total, payment_terms, valid_until, billing_mode)
  ON public.offer_versions TO authenticated;

-- offer_lines: le righe di una bozza si modificano liberamente; su una versione
-- uscita le blocca guard_offer_version_content_immutable.
REVOKE ALL ON public.offer_lines FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_lines TO authenticated;

-- offer_events: registro append-only. Si legge e basta.
REVOKE ALL ON public.offer_events FROM authenticated;
GRANT SELECT ON public.offer_events TO authenticated;

-- offer_payment_terms: le tranche si compongono; maturity_status e matured_at
-- restano fuori, perché passano da mark_offer_payment_term_matured.
REVOKE ALL ON public.offer_payment_terms FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.offer_payment_terms TO authenticated;
GRANT UPDATE (amount, percentage, payment_term_id, maturity_event, scheduled_date, phase_label, display_order)
  ON public.offer_payment_terms TO authenticated;

-- Le tabelle di B5: sola lettura per chiunque non sia il service role. Link,
-- accessi, documenti e firme si scrivono solo attraverso le funzioni.
REVOKE ALL ON public.offer_public_links FROM authenticated;
GRANT SELECT ON public.offer_public_links TO authenticated;

REVOKE ALL ON public.offer_public_link_accesses FROM authenticated;
GRANT SELECT ON public.offer_public_link_accesses TO authenticated;

REVOKE ALL ON public.offer_version_documents FROM authenticated;
GRANT SELECT ON public.offer_version_documents TO authenticated;

REVOKE ALL ON public.offer_signatures FROM authenticated;
GRANT SELECT ON public.offer_signatures TO authenticated;

-- offers: la revoca era già stata fatta nella migration precedente, si ripete
-- l'elenco per avere in un solo posto la fotografia completa del cantiere.
REVOKE ALL ON public.offers FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.offers TO authenticated;
GRANT UPDATE (project_id, origin) ON public.offers TO authenticated;

-- Il service role resta pieno: è il ruolo delle edge function e delle funzioni
-- di sistema, e non passa dalla RLS per definizione.
GRANT ALL ON public.offers TO service_role;
GRANT ALL ON public.offer_versions TO service_role;
GRANT ALL ON public.offer_lines TO service_role;
GRANT ALL ON public.offer_events TO service_role;
GRANT ALL ON public.offer_payment_terms TO service_role;
GRANT ALL ON public.offer_public_links TO service_role;
GRANT ALL ON public.offer_public_link_accesses TO service_role;
GRANT ALL ON public.offer_version_documents TO service_role;
GRANT ALL ON public.offer_signatures TO service_role;
