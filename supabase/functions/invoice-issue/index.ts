import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// ═══════════════════════════════════════════════════════════════════════════
// invoice-issue — l'ultimo passo del percorso offerta -> tranche maturata ->
// riga di coda -> fattura: preso in carico da questa function, il documento
// esce su Fatture in Cloud. Non parla MAI direttamente con l'API di FiC:
// passa sempre da fic-adapter (vedi il commento in testa a quel file), come
// ogni altro componente del sistema.
//
// Il flusso, in ordine (FR-22/FR-23):
// 1) claim_invoice_for_issue porta la riga a "in_emissione": chiude la
//    finestra del doppio click. Se la riga non è "prevista" la funzione SQL
//    solleva un errore, e questo errore si propaga così com'è, non si aggira.
// 2) Se il cliente non ha ancora un fic_id, lo si crea su FiC (fic-adapter,
//    operazione upsertClient) e si salva il fic_id.
// 3) Si crea il documento su FiC (fic-adapter, operazione createInvoice),
//    come bozza: nessuna trasmissione elettronica, che resta un gesto umano
//    dentro FiC (vedi il commento su opCreateInvoice in fic-adapter).
// 4) Successo: mark_invoice_issued. Fallimento PRIMA che il documento FiC
//    esista per davvero: mark_invoice_issue_failed, che riporta la riga a
//    "prevista" con l'errore visibile — l'accettazione e la maturazione non
//    si perdono mai per un errore di trasmissione.
//    Fallimento DOPO che il documento FiC esiste (client.fic_id o
//    mark_invoice_issued falliscono a valle di un createInvoice riuscito):
//    la riga NON torna a "prevista". Rifarlo produrrebbe un secondo
//    documento reale per la stessa tranche: meglio una riga bloccata che
//    richiede una verifica manuale, di un doppione in produzione.
//
// dry_run: true rifà tutto (claim escluso) e ottiene da fic-adapter il
// payload esatto che verrebbe inviato — inclusa l'aliquota IVA risolta per
// davvero leggendo FiC in lettura — ma senza mai chiamare claim né il POST
// di creazione: nessuna riga cambia stato, nessun documento nasce.
// ═══════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const BodySchema = z.object({
  invoice_queue_id: z.string().uuid(),
  dry_run: z.boolean().optional().default(false),
});

// Segnala specificamente un fallimento della chiamata a fic-adapter (quindi,
// in ultima analisi, verso FiC), distinto da un errore nostro (riga/cliente
// non trovati): serve a scegliere lo status HTTP di risposta nel catch finale.
class FicAdapterError extends Error {}

async function callFicAdapter(authHeader: string, operation: string, params: unknown): Promise<any> {
  const res = await fetch(`${supabaseUrl}/functions/v1/fic-adapter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': authHeader,
    },
    body: JSON.stringify({ operation, params }),
  });

  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* corpo non-JSON, resta null */ }

  if (!res.ok) {
    const message = body?.error?.message || (typeof body?.error === 'string' ? body.error : null) || text || `HTTP ${res.status}`;
    throw new FicAdapterError(`Fatture in Cloud: ${message}`);
  }
  return body?.data;
}

type ClientRow = { id: string; name: string; email: string | null; phone: string | null; fic_id: number | null };

// Il tipo IssuedDocumentType di FiC ha 'invoice' e 'proforma' come valori
// distinti (fattura e proforma NON sono la stessa risorsa con un flag).
function ficDocumentType(documentKind: string): 'invoice' | 'proforma' {
  return documentKind === 'proforma' ? 'proforma' : 'invoice';
}

// Un'unica riga di coda produce un'unica riga documento: la causale già
// completa (build_invoice_description) fa da nome dell'articolo, non serve
// altro testo.
function buildInvoiceItems(row: { description: string; amount: number; vat_rate: number }) {
  return [{
    name: row.description,
    qty: 1,
    netPrice: Number(row.amount),
    vatRate: Number(row.vat_rate),
  }];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo non supportato' }, 405);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const { data: claimsData, error: claimsError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (claimsError || !claimsData?.user) {
    return jsonResponse({ error: 'Token non valido' }, 401);
  }
  const callerId = claimsData.user.id;

  // Utente approvato (stesso controllo di send-budget-notification) e ruolo
  // finance o admin: sono gli unici due ammessi dalle RPC di emissione,
  // annullamento e incasso della coda (vedi claim_invoice_for_issue e
  // cancel_invoice_queue_row) — "account" qui NON è incluso, a differenza di
  // altri punti dell'app dove è trattato come equivalente ad admin.
  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('approved, deleted_at')
    .eq('id', callerId)
    .maybeSingle();
  if (!callerProfile?.approved || callerProfile.deleted_at) {
    return jsonResponse({ error: 'Utente non approvato.' }, 403);
  }

  const [{ data: isAdmin }, { data: isFinance }] = await Promise.all([
    supabase.rpc('has_role', { _user_id: callerId, _role: 'admin' }),
    supabase.rpc('has_role', { _user_id: callerId, _role: 'finance' }),
  ]);
  if (!isAdmin && !isFinance) {
    return jsonResponse({ error: 'Solo amministrazione (finance o admin) può emettere fatture.' }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Body JSON non valido' }, 400);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: `Parametri non validi: ${parsed.error.issues.map((i) => i.message).join('; ')}` }, 400);
  }
  const { invoice_queue_id, dry_run } = parsed.data;

  // ───────────────────────────────────────────────────────────────────────
  // dry_run: nessuna scrittura. Niente claim_invoice_for_issue (che porta la
  // riga a "in_emissione"): si rilegge lo stato e si replica la stessa
  // validazione che quella funzione farebbe, senza mai muovere la riga.
  // ───────────────────────────────────────────────────────────────────────
  if (dry_run) {
    const { data: row, error: rowError } = await supabase
      .from('invoice_queue')
      .select('*')
      .eq('id', invoice_queue_id)
      .maybeSingle();
    if (rowError) return jsonResponse({ error: rowError.message }, 500);
    if (!row) return jsonResponse({ error: `Riga di coda ${invoice_queue_id} non trovata` }, 404);
    if (row.status !== 'prevista') {
      return jsonResponse({ error: `Questa fattura è già in stato ${row.status}: non si emette due volte` }, 409);
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, email, phone, fic_id')
      .eq('id', row.client_id)
      .maybeSingle<ClientRow>();
    if (clientError || !client) return jsonResponse({ error: 'Cliente non trovato' }, 404);

    try {
      const clientWillBeCreated = !client.fic_id;
      const entity = client.fic_id
        ? { id: client.fic_id, name: client.name, email: client.email ?? undefined, phone: client.phone ?? undefined }
        : { name: client.name, email: client.email ?? undefined, phone: client.phone ?? undefined };

      const result = await callFicAdapter(authHeader, 'createInvoice', {
        type: ficDocumentType(row.document_kind),
        entity,
        items: buildInvoiceItems(row),
        dueDate: row.due_date ?? undefined,
        dryRun: true,
      });

      return jsonResponse({
        ok: true,
        dry_run: true,
        payload: result.payload,
        client_will_be_created: clientWillBeCreated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: message }, err instanceof FicAdapterError ? 502 : 500);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Percorso reale: da qui in poi la riga è "in_emissione". Se qualcosa va
  // storto PRIMA che il documento FiC esista, si torna a "prevista"
  // (mark_invoice_issue_failed). Se va storto DOPO, la riga resta bloccata
  // di proposito: vedi il commento in testa al file.
  // ───────────────────────────────────────────────────────────────────────
  const { data: claimedRow, error: claimError } = await supabase.rpc('claim_invoice_for_issue', {
    _invoice_queue_id: invoice_queue_id,
  });
  if (claimError) {
    const msg = claimError.message || 'Impossibile prendere in carico la fattura';
    const status = /non trovat/i.test(msg) ? 404 : /già in stato/i.test(msg) ? 409 : 400;
    return jsonResponse({ error: msg }, status);
  }
  const row = claimedRow as {
    id: string; client_id: string; description: string; amount: number; vat_rate: number;
    due_date: string | null; document_kind: string;
  };

  let ficDocument: { id: number; url?: string | null } | null = null;
  try {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, email, phone, fic_id')
      .eq('id', row.client_id)
      .maybeSingle<ClientRow>();
    if (clientError || !client) throw new Error('Cliente non trovato');

    let ficClientId = client.fic_id;
    if (!ficClientId) {
      const created = await callFicAdapter(authHeader, 'upsertClient', {
        clientId: client.id,
        name: client.name,
        email: client.email ?? undefined,
        phone: client.phone ?? undefined,
      });
      ficClientId = created.id;
    }

    const entity = { id: ficClientId, name: client.name, email: client.email ?? undefined, phone: client.phone ?? undefined };

    const result = await callFicAdapter(authHeader, 'createInvoice', {
      type: ficDocumentType(row.document_kind),
      entity,
      items: buildInvoiceItems(row),
      dueDate: row.due_date ?? undefined,
      dryRun: false,
    });

    ficDocument = result.ficDocument;
    if (!ficDocument?.id) throw new Error('Fatture in Cloud non ha restituito un id per il documento creato');
  } catch (err) {
    // Nessun documento FiC in mano (o comunque nessuna prova che esista):
    // sicuro riportare la riga a "prevista" con l'errore visibile.
    const message = err instanceof Error ? err.message : String(err);
    await supabase.rpc('mark_invoice_issue_failed', { _invoice_queue_id: invoice_queue_id, _error: message });
    return jsonResponse({ error: message }, err instanceof FicAdapterError ? 502 : 500);
  }

  // Il documento esiste per davvero su FiC da qui in poi: un fallimento nel
  // registrarlo NON deve riportare la riga a "prevista", altrimenti un
  // secondo tentativo creerebbe un secondo documento reale per la stessa
  // tranche. Si segnala e basta: la riga resta "in_emissione" in attesa di
  // una verifica manuale (fic_document_id è già noto dai log).
  const { error: markError } = await supabase.rpc('mark_invoice_issued', {
    _invoice_queue_id: invoice_queue_id,
    _fic_document_id: ficDocument.id,
    _fic_document_url: ficDocument.url ?? null,
    _issued_by: callerId,
  });
  if (markError) {
    console.error('[invoice-issue] documento FiC creato ma mark_invoice_issued fallita', invoice_queue_id, ficDocument.id, markError);
    return jsonResponse({
      error: `Documento Fatture in Cloud #${ficDocument.id} creato correttamente, ma la registrazione nel database è fallita (${markError.message}). La riga resta "in emissione": serve un intervento manuale per non creare un doppione.`,
    }, 500);
  }

  return jsonResponse({ ok: true, fic_document_id: ficDocument.id, fic_document_url: ficDocument.url ?? null });
});
