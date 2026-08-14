import type { BadgeProps } from '@/components/ui/badge';
import type { Database } from '@/integrations/supabase/types';

// I campi di gara su offers e la vista tender_pipeline / offer_attachments
// (migration 20260814150000) non sono ancora nei tipi generati
// (src/integrations/supabase/types.ts): vedi la nota nel rapporto di
// consegna. Tipi scritti a mano rispecchiando lo schema della migration.

export type TenderOutcome = 'in_corso' | 'vinta' | 'persa' | 'ritirata' | 'annullata';
export type OfferStatus = Database['public']['Enums']['offer_status'];

export interface TenderPipelineRow {
  offer_id: string;
  year: number;
  number: number;
  client_id: string;
  client_name: string;
  tender_subject: string | null;
  tender_reference: string | null;
  tender_submission_deadline: string | null;
  giorni_alla_scadenza: number | null;
  tender_estimated_value: number | null;
  tender_outcome: TenderOutcome;
  stato_versione: OfferStatus | null;
  offered_total: number | null;
  allegati: number;
}

export interface OfferAttachmentRow {
  id: string;
  offer_id: string;
  title: string;
  external_url: string;
  kind: string | null;
  note: string | null;
  added_by: string | null;
  created_at: string;
}

export const tenderOutcomeLabels: Record<TenderOutcome, string> = {
  in_corso: 'In corso',
  vinta: 'Vinta',
  persa: 'Persa',
  ritirata: 'Ritirata',
  annullata: 'Annullata',
};

export const tenderOutcomeConfig: Record<TenderOutcome, { label: string; variant: BadgeProps['variant'] }> = {
  in_corso: { label: 'In corso', variant: 'blue' },
  vinta: { label: 'Vinta', variant: 'green' },
  persa: { label: 'Persa', variant: 'destructive' },
  ritirata: { label: 'Ritirata', variant: 'gray' },
  annullata: { label: 'Annullata', variant: 'gray' },
};

/** Traduce un errore del database in un messaggio comprensibile su questo dominio. */
export function friendlyTenderError(error: { code?: string; message: string }): string {
  if (error.code === '23514') {
    return 'I dati inseriti non rispettano un vincolo del database: controlla i valori e riprova.';
  }
  return error.message;
}
