-- =============================================================================
-- Il cruscotto: venduto, conversione, ricorrente
-- =============================================================================
-- Copre FR-36, FR-37 e FR-38. Nessun dato nuovo: sono letture su quello che il
-- cantiere ha già costruito. La domanda a cui deve rispondere senza esportare
-- niente è "quante analisi strategiche abbiamo venduto quest'anno", che oggi non
-- ha risposta perché il venduto vive in preventivi il cui contenuto è testo.
--
-- Tre scelte che vanno dichiarate, perché cambiano i numeri.
--
-- 1) Si conta l'OFFERTA, non la versione (FR-44). Un'offerta rivista tre volte è
--    un'offerta sola, al valore della versione accettata: contare le versioni
--    gonfierebbe il venduto in proporzione a quanto abbiamo trattato.
--
-- 2) Il venduto per prodotto, quando l'offerta espone un prezzo unico
--    omnicomprensivo, si **ripartisce in proporzione** ai valori di riga. È
--    l'unica ripartizione difendibile: le righe esistono e dicono il peso
--    relativo delle voci, mentre attribuire tutto alla prima o dividere in parti
--    uguali sarebbe inventare. Il totale per prodotto somma quindi sempre al
--    totale venduto, che è la proprietà che rende confrontabili le due viste.
--
-- 3) Il commerciale è l'account del cliente quando c'è, altrimenti chi ha
--    composto l'offerta. È il concetto di `rc_center` di FiC, dove
--    l'attribuzione segue la relazione e non chi ha materialmente scritto il
--    documento.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Il venduto, riga per riga, con la ripartizione dichiarata
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.sales_lines AS
WITH accettate AS (
  -- Una versione per offerta: quella accettata (o sostituita, che è stata
  -- accettata a suo tempo e ha prodotto fatture valide).
  SELECT DISTINCT ON (v.offer_id)
    v.id AS offer_version_id,
    v.offer_id,
    v.offered_total,
    v.billing_mode,
    v.created_by,
    (SELECT e.occurred_at FROM public.offer_events e
      WHERE e.offer_version_id = v.id AND e.new_status = 'accettata'
      ORDER BY e.occurred_at LIMIT 1) AS accepted_at
  FROM public.offer_versions v
  WHERE v.status IN ('accettata', 'sostituita')
  ORDER BY v.offer_id, v.version_number DESC
),
somme AS (
  SELECT l.offer_version_id, sum(l.line_total) AS totale_righe
  FROM public.offer_lines l GROUP BY l.offer_version_id
)
SELECT
  a.offer_id,
  a.offer_version_id,
  o.year,
  o.number,
  o.origin,
  a.accepted_at,
  o.client_id,
  c.name AS client_name,
  COALESCE(c.account_user_id, a.created_by) AS salesperson_id,
  l.product_id,
  COALESCE(p.code, '(fuori listino)') AS product_code,
  COALESCE(p.name, l.description) AS product_name,
  COALESCE(l.revenue_category, p.revenue_category, '(senza categoria)') AS revenue_category,
  COALESCE(p.product_nature, 'una_tantum') AS product_nature,
  l.quantity,
  -- Il valore venduto della riga: ripartizione proporzionale del totale offerto
  -- sui valori di riga, così la somma per prodotto coincide sempre col venduto.
  CASE
    WHEN s.totale_righe IS NULL OR s.totale_righe = 0 THEN 0
    ELSE round(a.offered_total * (l.line_total / s.totale_righe), 2)
  END AS valore_venduto
FROM accettate a
JOIN public.offers o ON o.id = a.offer_id
JOIN public.clients c ON c.id = o.client_id
JOIN public.offer_lines l ON l.offer_version_id = a.offer_version_id
LEFT JOIN public.products p ON p.id = l.product_id
LEFT JOIN somme s ON s.offer_version_id = a.offer_version_id;

COMMENT ON VIEW public.sales_lines IS 'Il venduto riga per riga sulle offerte accettate, con il valore ripartito in proporzione quando l''offerta espone un prezzo unico. Una versione per offerta (FR-44): le revisioni non moltiplicano il venduto.';

ALTER VIEW public.sales_lines SET (security_invoker = on);
GRANT SELECT ON public.sales_lines TO authenticated;


-- -----------------------------------------------------------------------------
-- 2) Le aggregazioni che rispondono alle domande vere
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.sales_by_product AS
SELECT
  date_part('year', accepted_at)::integer AS anno,
  product_code,
  product_name,
  revenue_category,
  product_nature,
  count(DISTINCT offer_id) AS offerte,
  sum(quantity) AS quantita,
  sum(valore_venduto)::numeric(12,2) AS venduto
FROM public.sales_lines
GROUP BY 1, 2, 3, 4, 5;

COMMENT ON VIEW public.sales_by_product IS 'Risponde a "quante analisi strategiche abbiamo venduto quest''anno" (FR-36), che oggi richiede di aprire i preventivi uno per uno.';

ALTER VIEW public.sales_by_product SET (security_invoker = on);
GRANT SELECT ON public.sales_by_product TO authenticated;


CREATE OR REPLACE VIEW public.sales_by_salesperson AS
SELECT
  date_part('year', sl.accepted_at)::integer AS anno,
  sl.salesperson_id,
  COALESCE(pr.full_name, '(non attribuito)') AS salesperson_name,
  count(DISTINCT sl.offer_id) AS offerte,
  sum(sl.valore_venduto)::numeric(12,2) AS venduto,
  sum(sl.valore_venduto) FILTER (WHERE sl.product_nature = 'ricorrente')::numeric(12,2) AS venduto_ricorrente
FROM public.sales_lines sl
LEFT JOIN public.profiles pr ON pr.id = sl.salesperson_id
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.sales_by_salesperson IS 'Venduto per commerciale (FR-36). L''attribuzione è l''account del cliente quando c''è, altrimenti chi ha composto l''offerta: è il concetto di rc_center di FiC, dove conta la relazione e non chi ha scritto il documento.';

ALTER VIEW public.sales_by_salesperson SET (security_invoker = on);
GRANT SELECT ON public.sales_by_salesperson TO authenticated;


CREATE OR REPLACE VIEW public.revenue_mix AS
SELECT
  date_part('year', accepted_at)::integer AS anno,
  sum(valore_venduto) FILTER (WHERE product_nature = 'ricorrente')::numeric(12,2) AS ricorrente,
  sum(valore_venduto) FILTER (WHERE product_nature <> 'ricorrente')::numeric(12,2) AS una_tantum,
  sum(valore_venduto)::numeric(12,2) AS totale,
  CASE WHEN sum(valore_venduto) > 0
       THEN round(100 * sum(valore_venduto) FILTER (WHERE product_nature = 'ricorrente') / sum(valore_venduto), 1)
  END AS quota_ricorrente_percentuale
FROM public.sales_lines
GROUP BY 1;

COMMENT ON VIEW public.revenue_mix IS 'Ricorrente contro una tantum (FR-38). La natura arriva dal listino: è il motivo per cui l''import da Fatture in Cloud deve classificare i canoni e non solo copiarli.';

ALTER VIEW public.revenue_mix SET (security_invoker = on);
GRANT SELECT ON public.revenue_mix TO authenticated;


-- -----------------------------------------------------------------------------
-- 3) La conversione (FR-37)
-- -----------------------------------------------------------------------------
-- Quante offerte uscite diventano accettate, e in quanto tempo. Il tempo si
-- misura dall'invio all'accettazione leggendo il registro eventi, che è l'unico
-- posto dove quei due istanti esistono davvero.

CREATE OR REPLACE VIEW public.offer_conversion AS
WITH per_offerta AS (
  SELECT
    o.id AS offer_id,
    o.year,
    o.origin,
    COALESCE(c.account_user_id, (SELECT v.created_by FROM public.offer_versions v WHERE v.offer_id = o.id ORDER BY v.version_number LIMIT 1)) AS salesperson_id,
    -- Lo stato dell'offerta è quello della sua versione più avanzata: una v1
    -- superata da una v2 accettata conta come accettata, non come superata.
    (SELECT v.status FROM public.offer_versions v
      WHERE v.offer_id = o.id
      ORDER BY CASE v.status
                 WHEN 'accettata' THEN 1 WHEN 'sostituita' THEN 2
                 WHEN 'rifiutata' THEN 3 WHEN 'scaduta' THEN 4
                 WHEN 'vista' THEN 5 WHEN 'inviata' THEN 6
                 WHEN 'in_approvazione' THEN 7 WHEN 'superata' THEN 8
                 ELSE 9 END
      LIMIT 1) AS stato,
    (SELECT max(v.offered_total) FROM public.offer_versions v WHERE v.offer_id = o.id) AS valore,
    (SELECT min(e.occurred_at) FROM public.offer_events e
      JOIN public.offer_versions v ON v.id = e.offer_version_id
      WHERE v.offer_id = o.id AND e.new_status = 'inviata') AS inviata_il,
    (SELECT min(e.occurred_at) FROM public.offer_events e
      JOIN public.offer_versions v ON v.id = e.offer_version_id
      WHERE v.offer_id = o.id AND e.new_status = 'accettata') AS accettata_il
  FROM public.offers o
  JOIN public.clients c ON c.id = o.client_id
)
SELECT
  year AS anno,
  origin,
  salesperson_id,
  count(*) FILTER (WHERE inviata_il IS NOT NULL) AS offerte_uscite,
  count(*) FILTER (WHERE stato IN ('accettata', 'sostituita')) AS accettate,
  count(*) FILTER (WHERE stato = 'rifiutata') AS rifiutate,
  count(*) FILTER (WHERE stato = 'scaduta') AS scadute,
  count(*) FILTER (WHERE stato IN ('inviata', 'vista')) AS in_attesa,
  CASE WHEN count(*) FILTER (WHERE inviata_il IS NOT NULL) > 0
       THEN round(100.0 * count(*) FILTER (WHERE stato IN ('accettata', 'sostituita'))
                  / count(*) FILTER (WHERE inviata_il IS NOT NULL), 1)
  END AS tasso_conversione_percentuale,
  round(avg(EXTRACT(EPOCH FROM (accettata_il - inviata_il)) / 86400)
        FILTER (WHERE accettata_il IS NOT NULL AND inviata_il IS NOT NULL), 1) AS giorni_medi_alla_firma,
  sum(valore) FILTER (WHERE stato IN ('accettata', 'sostituita'))::numeric(12,2) AS valore_accettato,
  sum(valore) FILTER (WHERE stato IN ('inviata', 'vista'))::numeric(12,2) AS valore_in_attesa
FROM per_offerta
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.offer_conversion IS 'Tasso di conversione e tempo medio dall''invio alla firma (FR-37), per anno, origine e commerciale. Si conta l''offerta e non la versione: un''offerta rivista tre volte resta una.';

ALTER VIEW public.offer_conversion SET (security_invoker = on);
GRANT SELECT ON public.offer_conversion TO authenticated;
