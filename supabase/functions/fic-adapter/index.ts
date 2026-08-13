import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  FicNotConnectedError,
  FicReconnectRequiredError,
  getValidFicToken,
} from "../_shared/fic-token.ts";

// ═══════════════════════════════════════════════════════════════════════════
// fic-adapter — UNICO punto di contatto del sistema con l'API di Fatture in
// Cloud. Nessun altro componente (function, cron, frontend) deve chiamare
// api-v2.fattureincloud.it direttamente: passa sempre da qui, con un
// `operation` di dominio (vedi OPERATION_SCOPES sotto), mai con un proxy
// generico verso un path arbitrario.
//
// Le function fatture-in-cloud-oauth, -send-quote, -webhook e
// -register-webhook esistenti NON sono state toccate: restano i chiamanti
// diretti storici. Migrarle a passare da qui è un refactor successivo,
// fuori dal perimetro di questo file.
// ═══════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const FIC_API_BASE = 'https://api-v2.fattureincloud.it';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// SCOPE REGISTRY — unica fonte di verità sugli scope OAuth. Elenco completo
// degli scope esistenti in FiC: https://developers.fattureincloud.it/docs/basics/scopes/
// (qui dichiariamo solo quelli rilevanti per i domini che questo adapter
// espone o potrebbe esporre in futuro).
//
// GRANTED_SCOPES sono quelli EFFETTIVAMENTE concessi all'app Larin oggi
// (verificare/aggiornare in Fatture in Cloud > Impostazioni > App
// collegate). Se in futuro serve un dominio nuovo, il primo passo è
// aggiungere lo scope là e poi qui: aggiungerlo solo qui senza che sia
// davvero concesso farebbe fallire l'operazione allo stesso modo (assertScope
// verifica GRANTED_SCOPES, non l'esistenza dello scope in astratto).
// ─────────────────────────────────────────────────────────────────────────
type FicScope =
  | 'entity.clients:r' | 'entity.clients:a'
  | 'entity.suppliers:r' | 'entity.suppliers:a'
  | 'settings:r' | 'settings:a'
  | 'products:r' | 'products:a'
  | 'issued_documents.quotes:r' | 'issued_documents.quotes:a'
  | 'issued_documents.invoices:r' | 'issued_documents.invoices:a';

const GRANTED_SCOPES: ReadonlySet<FicScope> = new Set<FicScope>([
  'entity.suppliers:a',
  'settings:a', // concesso ma nessuna operazione lo usa ancora (vedi report)
  'issued_documents.quotes:a',
]);

// Ogni operazione di dominio dichiara qui lo scope che richiede. Questa
// tabella è controllata PRIMA di leggere il token o chiamare FiC: se lo
// scope non è in GRANTED_SCOPES, l'operazione fallisce subito (vedi
// assertScope in serve()) invece di arrivare a un 403 opaco dall'API.
const OPERATION_SCOPES = {
  listSuppliers: 'entity.suppliers:a',
  getSupplier: 'entity.suppliers:a',
  listQuotes: 'issued_documents.quotes:a',
  getQuote: 'issued_documents.quotes:a',
  getQuotePreCreateInfo: 'issued_documents.quotes:a',
  createQuote: 'issued_documents.quotes:a',
  // Non concessi oggi: prodotti, clienti e fatture non sono accessibili.
  listProducts: 'products:a',
  getClient: 'entity.clients:a',
  upsertClient: 'entity.clients:a',
  createInvoice: 'issued_documents.invoices:a',
} as const satisfies Record<string, FicScope>;

type OperationName = keyof typeof OPERATION_SCOPES;

class FicScopeError extends Error {
  constructor(public readonly scope: FicScope, public readonly operation: string) {
    super(
      `L'operazione "${operation}" richiede lo scope OAuth "${scope}", non concesso all'app Larin in Fatture in Cloud. ` +
      `Per abilitarla: richiedere lo scope in Fatture in Cloud > Impostazioni > App collegate, poi ricollegare ` +
      `l'account (disconnect + nuova autorizzazione) perché il token attuale non lo includerà finché non viene riemesso.`,
    );
    this.name = 'FicScopeError';
  }
}

function assertScope(scope: FicScope, operation: string): void {
  if (!GRANTED_SCOPES.has(scope)) throw new FicScopeError(scope, operation);
}

// ─────────────────────────────────────────────────────────────────────────
// Wrapper HTTP verso FiC — l'UNICA funzione che fa fetch verso FIC_API_BASE.
// Tutte le operazioni sotto passano da qui.
// ─────────────────────────────────────────────────────────────────────────
class FicApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) {
    super(message);
    this.name = 'FicApiError';
  }
}

async function callFic(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${FIC_API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* corpo non-JSON, resta null */ }

  if (!res.ok) {
    const message = body?.error?.message || text || `HTTP ${res.status}`;
    console.error(`[fic-adapter] FiC error ${res.status} on ${path}:`, text);
    throw new FicApiError(res.status, message, body);
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────────
// Schemi di input per operazione
// ─────────────────────────────────────────────────────────────────────────
const ListParamsSchema = z.object({
  page: z.number().int().positive().optional(),
  perPage: z.number().int().positive().max(100).optional(),
  query: z.string().optional(),
}).default({});

const QuoteEntitySchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  vatNumber: z.string().optional(),
  taxCode: z.string().optional(),
  addressStreet: z.string().optional(),
  addressPostalCode: z.string().optional(),
  addressCity: z.string().optional(),
  addressProvince: z.string().optional(),
});

// vatId deve riferire un vat_type reale della company (vedi getQuotePreCreateInfo
// -> vat_types_list), non un valore percentuale a piacere: VatType.value è
// read-only lato FiC, quindi non ha senso mandarlo in scrittura (vedi report).
const QuoteItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  qty: z.number().positive(),
  netPrice: z.number(),
  vatId: z.number().int(),
  discount: z.number().min(0).max(100).optional(),
});

const CreateQuoteParamsSchema = z.object({
  entity: QuoteEntitySchema,
  subject: z.string().optional(),
  items: z.array(QuoteItemSchema).min(1),
  showPayments: z.boolean().optional(),
  showPaymentMethod: z.boolean().optional(),
});

const DocumentIdParamsSchema = z.object({ documentId: z.number().int() });
const SupplierIdParamsSchema = z.object({ supplierId: z.number().int() });
const ClientIdParamsSchema = z.object({ clientId: z.number().int() });
const EmptyParamsSchema = z.object({}).default({});

// Stub non raggiungibili oggi (scope non concesso): schema minimo, giusto per
// documentare la forma attesa dell'operazione quando lo scope sarà concesso.
const UpsertClientParamsSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  vatNumber: z.string().optional(),
});
const CreateInvoiceParamsSchema = z.object({
  entity: QuoteEntitySchema,
  subject: z.string().optional(),
  items: z.array(QuoteItemSchema).min(1),
});

const RequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('listSuppliers'), params: ListParamsSchema }),
  z.object({ operation: z.literal('getSupplier'), params: SupplierIdParamsSchema }),
  z.object({ operation: z.literal('listQuotes'), params: ListParamsSchema }),
  z.object({ operation: z.literal('getQuote'), params: DocumentIdParamsSchema }),
  z.object({ operation: z.literal('getQuotePreCreateInfo'), params: EmptyParamsSchema }),
  z.object({ operation: z.literal('createQuote'), params: CreateQuoteParamsSchema }),
  z.object({ operation: z.literal('listProducts'), params: ListParamsSchema }),
  z.object({ operation: z.literal('getClient'), params: ClientIdParamsSchema }),
  z.object({ operation: z.literal('upsertClient'), params: UpsertClientParamsSchema }),
  z.object({ operation: z.literal('createInvoice'), params: CreateInvoiceParamsSchema }),
]);

type ListParams = z.infer<typeof ListParamsSchema>;

function entityToFicPayload(entity: z.infer<typeof QuoteEntitySchema>) {
  return {
    name: entity.name,
    email: entity.email,
    vat_number: entity.vatNumber,
    tax_code: entity.taxCode,
    address_street: entity.addressStreet,
    address_postal_code: entity.addressPostalCode,
    address_city: entity.addressCity,
    address_province: entity.addressProvince,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OPERAZIONI DI DOMINIO — scope: entity.suppliers:a (concesso)
// ─────────────────────────────────────────────────────────────────────────
async function opListSuppliers(token: string, companyId: number, params: ListParams) {
  const qs = new URLSearchParams({
    fieldset: 'detailed',
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 20),
  });
  if (params.query) qs.set('q', params.query);
  const json = await callFic(token, `/c/${companyId}/entities/suppliers?${qs}`);
  return json?.data;
}

async function opGetSupplier(token: string, companyId: number, params: { supplierId: number }) {
  const json = await callFic(token, `/c/${companyId}/entities/suppliers/${params.supplierId}?fieldset=detailed`);
  return json?.data;
}

// ─────────────────────────────────────────────────────────────────────────
// OPERAZIONI DI DOMINIO — scope: issued_documents.quotes:a (concesso)
// ─────────────────────────────────────────────────────────────────────────
async function opListQuotes(token: string, companyId: number, params: ListParams) {
  const qs = new URLSearchParams({
    type: 'quote', // singolare: IssuedDocumentType (vedi report, il codice esistente usa 'quotes')
    fieldset: 'detailed',
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 20),
  });
  if (params.query) qs.set('q', params.query);
  const json = await callFic(token, `/c/${companyId}/issued_documents?${qs}`);
  return json?.data;
}

async function opGetQuote(token: string, companyId: number, params: { documentId: number }) {
  // Niente parametro `type` qui: il document_id identifica già il documento,
  // a differenza della list.
  const json = await callFic(token, `/c/${companyId}/issued_documents/${params.documentId}?fieldset=detailed`);
  return json?.data;
}

// Dati di riferimento per costruire correttamente un preventivo: vat_types
// reali della company, metodi/conti di pagamento, numerazioni disponibili.
// Sotto lo stesso scope delle quotes (fa parte di IssuedDocumentsApi), quindi
// NON serve settings:a per questo. Non accetta `fieldset`: a differenza di
// list/get issued_documents, questo endpoint ha solo company_id + type.
async function opGetQuotePreCreateInfo(token: string, companyId: number) {
  const json = await callFic(token, `/c/${companyId}/issued_documents/pre_create_info?type=quote`);
  return json?.data;
}

async function opCreateQuote(token: string, companyId: number, params: z.infer<typeof CreateQuoteParamsSchema>) {
  // entity.clients:a non è concesso: non possiamo cercare o creare un
  // cliente persistente su FiC. Per questo l'entity va sempre inline (FiC
  // supporta un "cliente occasionale" senza id, vedi report) — non esiste
  // un percorso clientId/fic_id in questa operazione, ed è voluto.
  const payload = {
    data: {
      type: 'quote', // enum IssuedDocumentType: singolare
      entity: entityToFicPayload(params.entity),
      subject: params.subject,
      items_list: params.items.map((item) => ({
        name: item.name,
        description: item.description,
        qty: item.qty,
        net_price: item.netPrice,
        vat: { id: item.vatId },
        discount: item.discount ?? 0,
      })),
      show_payments: params.showPayments ?? true,
      show_payment_method: params.showPaymentMethod ?? true,
    },
  };

  const json = await callFic(token, `/c/${companyId}/issued_documents`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return json?.data;
}

// ─────────────────────────────────────────────────────────────────────────
// OPERAZIONI DI DOMINIO — scope NON concessi oggi
//
// Queste funzioni non vengono mai eseguite: assertScope() in serve() blocca
// la richiesta prima ancora di arrivare qui (vedi OPERATION_SCOPES). Restano
// dichiarate per due motivi: rendono esplicito nel codice che prodotti,
// clienti e fatture sono domini noti ma non abilitati, e danno un punto
// pronto dove scrivere la vera implementazione se/quando lo scope verrà
// concesso — senza dover ridisegnare il contratto dell'adapter.
// ─────────────────────────────────────────────────────────────────────────

// Scope mancante: products:a. Endpoint reale: GET /c/{company_id}/products?fieldset=detailed
async function opListProducts(_token: string, _companyId: number, _params: ListParams): Promise<never> {
  throw new Error('products:a non concesso: vedi GRANTED_SCOPES in cima al file.');
}

// Scope mancante: entity.clients:a. Endpoint reale: GET /c/{company_id}/entities/clients/{client_id}?fieldset=detailed
async function opGetClient(_token: string, _companyId: number, _params: { clientId: number }): Promise<never> {
  throw new Error('entity.clients:a non concesso: vedi GRANTED_SCOPES in cima al file.');
}

// Scope mancante: entity.clients:a. Endpoint reale: POST/PUT /c/{company_id}/entities/clients[/{client_id}]
async function opUpsertClient(_token: string, _companyId: number, _params: z.infer<typeof UpsertClientParamsSchema>): Promise<never> {
  throw new Error('entity.clients:a non concesso: vedi GRANTED_SCOPES in cima al file.');
}

// Scope mancante: issued_documents.invoices:a. Endpoint reale: POST /c/{company_id}/issued_documents (type: 'invoice')
async function opCreateInvoice(_token: string, _companyId: number, _params: z.infer<typeof CreateInvoiceParamsSchema>): Promise<never> {
  throw new Error('issued_documents.invoices:a non concesso: vedi GRANTED_SCOPES in cima al file.');
}

// ─────────────────────────────────────────────────────────────────────────
// Errori strutturati — un errore verso FiC non deve mai tradursi in un 500
// generico senza contesto: il chiamante riceve sempre { kind, message,
// retryable, status }, distinguendo scope mancante, token non rinnovabile,
// errore di FiC ed errore nostro.
// ─────────────────────────────────────────────────────────────────────────
type FicErrorKind = 'scope_missing' | 'reconnect_required' | 'fic_error' | 'internal_error';

interface FicErrorBody {
  kind: FicErrorKind;
  message: string;
  retryable: boolean;
  status: number;
  scope?: FicScope;
  ficStatus?: number;
}

function toErrorBody(err: unknown): FicErrorBody {
  if (err instanceof FicScopeError) {
    return { kind: 'scope_missing', message: err.message, retryable: false, status: 403, scope: err.scope };
  }
  if (err instanceof FicNotConnectedError || err instanceof FicReconnectRequiredError) {
    return { kind: 'reconnect_required', message: err.message, retryable: false, status: 409 };
  }
  if (err instanceof FicApiError) {
    // Un 401 qui è sospetto: il nostro token risultava valido (altrimenti
    // getValidFicToken lo avrebbe già rinnovato), quindi FiC lo ha
    // invalidato lato suo (revoca, permessi cambiati). Trattarlo come
    // "serve riconnettere" invece che come generico errore FiC.
    if (err.status === 401) {
      return { kind: 'reconnect_required', message: `FiC ha rifiutato il token (401): ${err.message}`, retryable: false, status: 409 };
    }
    // 429/5xx sono transitori lato FiC (rate limit, disservizio): ha senso
    // ritentare. Un 4xx "nostro" (dati malformati, 404, ecc.) no.
    const retryable = err.status === 429 || err.status >= 500;
    return { kind: 'fic_error', message: err.message, retryable, status: err.status, ficStatus: err.status };
  }
  return {
    kind: 'internal_error',
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
    status: 500,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Handler HTTP
// ─────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Metodo non supportato' }, 405);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // JWT utente + ruolo, come fatture-in-cloud-send-quote: non ci si fida del
  // solo gateway.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const { data: claimsData, error: claimsError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (claimsError || !claimsData?.user) {
    return jsonResponse({ error: 'Token non valido' }, 401);
  }

  const callerId = claimsData.user.id;
  const [{ data: isAdmin }, { data: isAccount }, { data: isFinance }] = await Promise.all([
    supabase.rpc('has_role', { _user_id: callerId, _role: 'admin' }),
    supabase.rpc('has_role', { _user_id: callerId, _role: 'account' }),
    supabase.rpc('has_role', { _user_id: callerId, _role: 'finance' }),
  ]);
  if (!isAdmin && !isAccount && !isFinance) {
    return jsonResponse({ error: 'Forbidden: ruolo non autorizzato' }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Body JSON non valido' }, 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.flatten() }, 400);
  }

  // ── Da qui in poi: unico varco verso FiC. Ogni fallimento è tipizzato. ──
  try {
    const operation: OperationName = parsed.data.operation;
    assertScope(OPERATION_SCOPES[operation], operation);

    const tokenRow = await getValidFicToken(supabase);
    const { access_token: token, company_id: companyId } = tokenRow;

    let result: unknown;
    switch (parsed.data.operation) {
      case 'listSuppliers':
        result = await opListSuppliers(token, companyId, parsed.data.params);
        break;
      case 'getSupplier':
        result = await opGetSupplier(token, companyId, parsed.data.params);
        break;
      case 'listQuotes':
        result = await opListQuotes(token, companyId, parsed.data.params);
        break;
      case 'getQuote':
        result = await opGetQuote(token, companyId, parsed.data.params);
        break;
      case 'getQuotePreCreateInfo':
        result = await opGetQuotePreCreateInfo(token, companyId);
        break;
      case 'createQuote':
        result = await opCreateQuote(token, companyId, parsed.data.params);
        break;
      case 'listProducts':
        result = await opListProducts(token, companyId, parsed.data.params);
        break;
      case 'getClient':
        result = await opGetClient(token, companyId, parsed.data.params);
        break;
      case 'upsertClient':
        result = await opUpsertClient(token, companyId, parsed.data.params);
        break;
      case 'createInvoice':
        result = await opCreateInvoice(token, companyId, parsed.data.params);
        break;
    }

    return jsonResponse({ data: result });
  } catch (err) {
    const errorBody = toErrorBody(err);
    console.error('[fic-adapter]', parsed.data.operation, errorBody);
    return jsonResponse({ error: errorBody }, errorBody.status);
  }
});
