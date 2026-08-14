/**
 * Tipi per le viste di reportistica vendite (sales_by_product, sales_by_salesperson,
 * revenue_mix, offer_conversion). Le viste non sono ancora presenti in
 * src/integrations/supabase/types.ts (generato da un altro agente in parallelo),
 * quindi qui i tipi sono scritti a mano sulla base delle colonne verificate
 * direttamente sul database di staging.
 */
import type { Database } from '@/integrations/supabase/types';

export type ProductNature = Database['public']['Enums']['product_nature'];
export type OfferOrigin = Database['public']['Enums']['offer_origin'];

export const PRODUCT_NATURE_LABELS: Record<ProductNature, string> = {
  una_tantum: 'una tantum',
  ricorrente: 'ricorrente',
  a_giornate: 'a giornate',
};

export const ORIGIN_LABELS: Record<OfferOrigin, string> = {
  commercial: 'Commerciale',
  tender: 'Gara',
};

export interface SalesByProductRow {
  anno: number;
  product_code: string;
  product_name: string;
  revenue_category: string;
  product_nature: ProductNature;
  offerte: number;
  quantita: number;
  venduto: number;
}

export interface SalesBySalespersonRow {
  anno: number;
  salesperson_id: string;
  salesperson_name: string;
  offerte: number;
  venduto: number;
  venduto_ricorrente: number;
}

export interface RevenueMixRow {
  anno: number;
  ricorrente: number;
  una_tantum: number;
  totale: number;
  quota_ricorrente_percentuale: number;
}

export interface OfferConversionRow {
  anno: number;
  origin: OfferOrigin;
  salesperson_id: string | null;
  offerte_uscite: number;
  accettate: number;
  rifiutate: number;
  scadute: number;
  in_attesa: number;
  tasso_conversione_percentuale: number | null;
  giorni_medi_alla_firma: number | null;
  valore_accettato: number;
  valore_in_attesa: number;
}
