import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FIC_TOKEN_URL = 'https://api-v2.fattureincloud.it/oauth/token';

export interface FicTokenRow {
  id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  company_id: number;
  company_name: string | null;
}

// Nessuna riga in fic_oauth_tokens: l'account non è mai stato collegato.
export class FicNotConnectedError extends Error {
  constructor() {
    super("Fatture in Cloud non è collegato: nessun token in fic_oauth_tokens. Collegare l'account dalle impostazioni.");
    this.name = 'FicNotConnectedError';
  }
}

// Il refresh token non funziona più (revocato, o l'app è stata scollegata da
// FiC): serve un nuovo giro di OAuth, non ha senso ritentare la stessa chiamata.
export class FicReconnectRequiredError extends Error {
  constructor(detail?: string) {
    super(`Il refresh del token Fatture in Cloud è fallito: ricollegare l'account dalle impostazioni.${detail ? ` (${detail})` : ''}`);
    this.name = 'FicReconnectRequiredError';
  }
}

// Vero se esiste il secret FIC_MANUAL_TOKEN: un token emesso a mano da
// un'app di proprietà di Marco con tutti i permessi (verificato il
// 13/08/2026 su company/info, products, entities/clients, issued_documents
// type=invoice e type=quote, info/payment_methods). Esportata perché
// fic-adapter deve saperlo PRIMA di chiamare getValidFicToken, per calcolare
// gli scope concessi senza duplicare qui il nome della env var.
export function isUsingManualFicToken(): boolean {
  return Boolean(Deno.env.get('FIC_MANUAL_TOKEN'));
}

// Il token manuale non scade e non passa da fic_oauth_tokens: niente refresh,
// niente riga da leggere o riscrivere. company_id viene dal secret
// FIC_COMPANY_ID (22474 per Larin), non dalla tabella.
function getManualFicToken(): FicTokenRow | null {
  const manualToken = Deno.env.get('FIC_MANUAL_TOKEN');
  if (!manualToken) return null;
  return {
    id: 'manual-token',
    access_token: manualToken,
    refresh_token: '',
    token_expiry: '2099-01-01T00:00:00.000Z', // sentinella "non scade mai"
    company_id: Number(Deno.env.get('FIC_COMPANY_ID')),
    company_name: null,
  };
}

/**
 * Legge l'ultimo token FiC da fic_oauth_tokens e lo rinnova se scade entro 5
 * minuti, riscrivendo la riga con il nuovo access/refresh token. Se è
 * presente il secret FIC_MANUAL_TOKEN, quel percorso ha la precedenza e
 * questa funzione non tocca affatto fic_oauth_tokens (vedi getManualFicToken).
 *
 * Stessa logica finora duplicata (con lievi variazioni) in
 * fatture-in-cloud-oauth, fatture-in-cloud-send-quote,
 * fatture-in-cloud-webhook e fatture-in-cloud-register-webhook. Questa è la
 * versione condivisa: fic-adapter la usa come unica fonte. Le quattro
 * function esistenti non sono state toccate qui — migrarle a questo helper
 * è un refactor separato, da fare quando si spostano su fic-adapter.
 */
export async function getValidFicToken(
  supabase: ReturnType<typeof createClient>,
): Promise<FicTokenRow> {
  const manual = getManualFicToken();
  if (manual) return manual;

  const clientId = Deno.env.get('FATTURE_IN_CLOUD_CLIENT_ID')!;
  const clientSecret = Deno.env.get('FATTURE_IN_CLOUD_CLIENT_SECRET')!;

  const { data: tokenRow, error } = await supabase
    .from('fic_oauth_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !tokenRow) throw new FicNotConnectedError();

  const tokens = tokenRow as unknown as FicTokenRow;
  const isExpired = new Date(tokens.token_expiry) < new Date(Date.now() + 5 * 60 * 1000);
  if (!isExpired) return tokens;

  const response = await fetch(FIC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[fic-token] Refresh fallito:', text);
    throw new FicReconnectRequiredError(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const tokenExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

  await supabase.from('fic_oauth_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    token_expiry: tokenExpiry,
  }).eq('id', tokens.id);

  return { ...tokens, access_token: data.access_token, token_expiry: tokenExpiry };
}
