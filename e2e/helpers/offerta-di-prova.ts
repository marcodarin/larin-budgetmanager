import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Prepara sullo staging un'offerta inviata con il suo link pubblico, e
 * restituisce quello che serve ai test: il token, l'hash del documento
 * congelato e gli identificativi.
 *
 * Le offerte create non vengono cancellate a fine test: una volta firmate non
 * sono più cancellabili (offer_signatures è append-only e blocca la DELETE
 * anche al service role, il che è esattamente ciò che vogliamo da una firma).
 * Sullo staging il costo è qualche numero d'offerta in più.
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'https://jtbgvidwvgwrayqhlzvw.supabase.co';
const SERVICE_ROLE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';

/** Utente "Account Staging", autore delle offerte di prova. */
export const AUTORE = '22222222-2222-4222-8222-222222222222';

export type OffertaDiProva = {
  offerId: string;
  versionId: string;
  token: string;
  documentHash: string;
  reference: string;
  offeredTotal: number;
};

export function serviceClient(): SupabaseClient {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      'Manca E2E_SERVICE_ROLE_KEY. Recuperala dal Keychain prima di lanciare i test:\n' +
        '  export E2E_SERVICE_ROLE_KEY=$(security find-generic-password -s supabase-staging-service_role -a "$USER" -w)',
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Crea un'offerta con tre righe e tre tranche, la porta a "inviata" (che è ciò
 * che congela il documento) e genera il link.
 *
 * `varianteSenzaPrezziDiRiga` serve a coprire il caso commerciale del prezzo
 * unico omnicomprensivo: le righe restano nei dati ma la loro somma non
 * coincide con il totale offerto, e il documento non deve esporle.
 */
export async function creaOffertaInviata(
  db: SupabaseClient,
  opzioni: { varianteSenzaPrezziDiRiga?: boolean } = {},
): Promise<OffertaDiProva> {
  const { data: cliente } = await db
    .from('clients')
    .select('id')
    .eq('name', 'Aurora Manifatture Srl')
    .maybeSingle();
  if (!cliente) throw new Error('Cliente di prova assente sullo staging');

  const { data: termine } = await db
    .from('payment_terms')
    .select('id')
    .eq('value', '30gg DF')
    .maybeSingle();
  if (!termine) throw new Error('Termine di pagamento 30gg DF assente sullo staging');

  // 11.500 su un listino di 13.000 è uno sconto effettivo dell'11,5%: sotto la
  // soglia di approvazione del 15%, quindi l'offerta esce davvero invece di
  // fermarsi in approvazione, e resta comunque lontano dai 12.250 delle righe,
  // che è ciò che attiva il caso del prezzo unico omnicomprensivo.
  const offeredTotal = opzioni.varianteSenzaPrezziDiRiga ? 11500 : 12250;

  const { data: offerta, error: erroreOfferta } = await db
    .from('offers')
    .insert({ client_id: cliente.id, created_by: AUTORE } as never)
    .select('id, year, number')
    .single();
  if (erroreOfferta) throw erroreOfferta;

  const { data: versione, error: erroreVersione } = await db
    .from('offer_versions')
    .insert({
      offer_id: offerta.id,
      created_by: AUTORE,
      list_total: 13000,
      offered_total: offeredTotal,
      valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      billing_mode: 'importo_finito',
    } as never)
    .select('id')
    .single();
  if (erroreVersione) throw erroreVersione;

  const righe = [
    { description: 'Analisi strategica e piano di comunicazione', unit_list_price: 3500, discount_percentage: 0, line_total: 3500 },
    { description: 'Sviluppo del nuovo sito, prima fase', unit_list_price: 7500, discount_percentage: 10, line_total: 6750 },
    { description: 'Coordinato grafico e materiali di stampa', unit_list_price: 2000, discount_percentage: 0, line_total: 2000 },
  ];
  const { error: erroreRighe } = await db.from('offer_lines').insert(
    righe.map((riga, indice) => ({
      offer_version_id: versione.id,
      quantity: 1,
      vat_rate: 22,
      display_order: indice + 1,
      ...riga,
    })) as never,
  );
  if (erroreRighe) throw erroreRighe;

  const { error: erroreTranche } = await db.from('offer_payment_terms').insert([
    { offer_version_id: versione.id, percentage: 40, payment_term_id: termine.id, maturity_event: 'firma', display_order: 1 },
    { offer_version_id: versione.id, percentage: 30, payment_term_id: termine.id, maturity_event: 'consegna', display_order: 2 },
    {
      offer_version_id: versione.id,
      percentage: 30,
      payment_term_id: termine.id,
      maturity_event: 'data_calendario',
      scheduled_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
      display_order: 3,
    },
  ] as never);
  if (erroreTranche) throw erroreTranche;

  const { error: erroreInvio } = await db.rpc('set_offer_version_status', {
    _offer_version_id: versione.id,
    _new_status: 'inviata',
    _event_type: 'inviata',
    _actor_type: 'system',
    _note: 'creata da un test end to end',
  });
  if (erroreInvio) throw erroreInvio;

  const token = 'e2e' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const { error: erroreLink } = await db
    .from('offer_public_links')
    .insert({ offer_id: offerta.id, token, created_by: AUTORE } as never);
  if (erroreLink) throw erroreLink;

  const { data: documento } = await db
    .from('offer_version_documents')
    .select('snapshot_hash')
    .eq('offer_version_id', versione.id)
    .single();

  return {
    offerId: offerta.id,
    versionId: versione.id,
    token,
    documentHash: documento!.snapshot_hash,
    reference: `${offerta.year}/${offerta.number}`,
    offeredTotal,
  };
}

/** Legge lo stato corrente di una versione, per verificare gli effetti. */
export async function statoVersione(db: SupabaseClient, versionId: string): Promise<string> {
  const { data } = await db.from('offer_versions').select('status').eq('id', versionId).single();
  return data!.status;
}
