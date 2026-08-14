import type { Database } from '@/integrations/supabase/types';
import type { BadgeProps } from '@/components/ui/badge';

// Le tabelle e viste degli abbonamenti (migration 20260814110000) non sono
// ancora nei tipi generati (src/integrations/supabase/types.ts): un altro
// agente potrebbe averli in mano, vedi il rapporto di consegna. Nel frattempo
// i tipi sono scritti a mano rispecchiando esattamente lo schema della
// migration, e le chiamate supabase su queste tabelle passano da un cast
// puntuale (vedi RAW_TABLE in questo file).

export type SubscriptionPeriodicity = 'mensile' | 'trimestrale' | 'annuale';
export type SubscriptionStatus = 'attivo' | 'disdettato' | 'concluso';
export type SubscriptionPeriodStatus = 'previsto' | 'accodato' | 'annullato';
export type DocumentKind = Database['public']['Enums']['invoice_document_kind'];

export interface SubscriptionRow {
  id: string;
  client_id: string;
  offer_id: string | null;
  product_id: string | null;
  description: string;
  periodicity: SubscriptionPeriodicity;
  start_date: string;
  end_date: string | null;
  auto_renew: boolean;
  notice_days: number | null;
  document_kind: DocumentKind;
  generate_days_before: number;
  status: SubscriptionStatus;
  cancelled_at: string | null;
  cancelled_effective_date: string | null;
  cancelled_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionAmountRow {
  id: string;
  subscription_id: string;
  amount: number;
  vat_rate: number;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SubscriptionPeriodRow {
  id: string;
  subscription_id: string;
  period_key: string;
  period_start: string;
  period_end: string;
  amount: number;
  vat_rate: number;
  status: SubscriptionPeriodStatus;
  generated_at: string;
}

export interface SubscriptionListRow extends SubscriptionRow {
  clients: { id: string; name: string } | null;
  subscription_amounts: SubscriptionAmountRow[];
}

export interface RecurringValueSummaryRow {
  ricorrente_mensile: number;
  ricorrente_annuo: number;
  abbonamenti_attivi: number;
  mensile_a_rischio_90_giorni: number;
  mensile_in_disdetta: number;
}

export interface SubscriptionRenewalRow {
  subscription_id: string;
  client_id: string;
  client_name: string;
  description: string;
  periodicity: SubscriptionPeriodicity;
  end_date: string | null;
  auto_renew: boolean;
  notice_days: number | null;
  notice_deadline: string | null;
  canone_corrente: number | null;
}

export const periodicityLabels: Record<SubscriptionPeriodicity, string> = {
  mensile: 'Mensile',
  trimestrale: 'Trimestrale',
  annuale: 'Annuale',
};

export const subscriptionStatusConfig: Record<SubscriptionStatus, { label: string; variant: BadgeProps['variant'] }> = {
  attivo: { label: 'Attivo', variant: 'green' },
  disdettato: { label: 'Disdettato', variant: 'yellow' },
  concluso: { label: 'Concluso', variant: 'gray' },
};

export const periodStatusConfig: Record<SubscriptionPeriodStatus, { label: string; variant: BadgeProps['variant'] }> = {
  previsto: { label: 'Previsto', variant: 'gray' },
  accodato: { label: 'Accodato', variant: 'blue' },
  annullato: { label: 'Annullato', variant: 'destructive' },
};

export const documentKindLabels: Record<DocumentKind, string> = {
  fattura: 'Fattura',
  proforma: 'Proforma',
};

/** Il canone valido a una certa data (default oggi) tra le righe di storico. */
export function currentAmount(
  amounts: SubscriptionAmountRow[],
  at: string = new Date().toISOString().slice(0, 10)
): SubscriptionAmountRow | null {
  return amounts.find((a) => a.valid_from <= at && (a.valid_to === null || a.valid_to > at)) ?? null;
}

/**
 * Traduce gli errori del database più prevedibili su questo dominio in un
 * messaggio comprensibile, invece di mostrare l'errore Postgres grezzo.
 */
export function friendlySubscriptionError(error: { code?: string; message: string }): string {
  if (error.code === '23P01') {
    return 'Il periodo indicato si sovrappone a un canone già registrato per questo abbonamento. Se il canone attuale non ha una data di fine, non è possibile aggiungerne uno successivo da qui: va chiuso al momento della sua registrazione, indicando fino a quando vale.';
  }
  if (error.code === '23514') {
    return 'I dati inseriti non rispettano un vincolo del database: controlla le date (la fine non può precedere l\'inizio) e riprova.';
  }
  return error.message;
}
