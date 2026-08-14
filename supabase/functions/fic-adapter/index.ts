import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  FicNotConnectedError,
  FicReconnectRequiredError,
  getValidFicToken,
  isUsingManualFicToken,
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
//
// Unica eccezione al "solo proxy verso FiC": syncProductCatalog scrive anche
// in locale (tabella products). Non è un'incoerenza col principio sopra: qui
// dentro c'è già il client service-role e il ruolo del chiamante verificato,
// quindi scrivere qui evita di far viaggiare l'intero listino su un secondo
// giro HTTP interno per nessun vantaggio reale.
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
// Gli scope EFFETTIVAMENTE concessi dipendono da quale token sta usando
// fic-token.ts (vedi getGrantedScopes sotto), non sono più un'unica costante:
// - token manuale (FIC_MANUAL_TOKEN presente): un'app di proprietà di Marco
//   con tutti i permessi, verificato il 13/08/2026: tutti gli scope sono
//   concessi per davvero, ALL_SCOPES lo dice il vero.
// - OAuth (nessun token manuale): resta l'elenco storico OAUTH_GRANTED_SCOPES
//   sotto, perché descrive il TOKEN ESISTENTE, non quello che vorremmo. La
//   URL di autorizzazione in fatture-in-cloud-oauth chiede ora anche
//   products:r, entity.clients:a e issued_documents.invoices:a, ma un token
//   già emesso non li contiene: gli scope si fissano nel momento in cui il
//   token nasce. Finché l'account OAuth non viene ricollegato, aggiungerli
//   qui produrrebbe 403 opachi da FiC al posto degli errori parlanti di
//   FicScopeError.
//
// Quando l'OAuth sarà ricollegato, OAUTH_GRANTED_SCOPES diventa:
//   'entity.suppliers:a', 'entity.clients:a', 'settings:a',
//   'products:r', 'issued_documents.quotes:a', 'issued_documents.invoices:a'
//
// La soluzione strutturale, da fare quando si tocca la produzione OAuth: FiC
// restituisce gli scope concessi nella risposta del token endpoint. Salvarli su
// fic_oauth_tokens e leggerli da lì toglie di mezzo la costante OAuth e la
// possibilità che menta (il token manuale invece non ha questo problema: gli
// scope concessi sono noti e verificati una volta per tutte).
// ─────────────────────────────────────────────────────────────────────────
const FIC_SCOPES = [
  'entity.clients:r', 'entity.clients:a',
  'entity.suppliers:r', 'entity.suppliers:a',
  'settings:r', 'settings:a',
  'products:r', 'products:a',
  'issued_documents.quotes:r', 'issued_documents.quotes:a',
  'issued_documents.invoices:r', 'issued_documents.invoices:a',
] as const;
type FicScope = typeof FIC_SCOPES[number];

const ALL_SCOPES: ReadonlySet<FicScope> = new Set<FicScope>(FIC_SCOPES);

const OAUTH_GRANTED_SCOPES: ReadonlySet<FicScope> = new Set<FicScope>([
  'entity.suppliers:a',
  'settings:a', // concesso ma nessuna operazione lo usa ancora (vedi report)
  'issued_documents.quotes:a',
]);

function getGrantedScopes(): ReadonlySet<FicScope> {
  return isUsingManualFicToken() ? ALL_SCOPES : OAUTH_GRANTED_SCOPES;
}

// Ogni operazione di dominio dichiara qui lo scope che richiede. Questa
// tabella è controllata PRIMA di leggere il token o chiamare FiC: se lo
// scope non è tra quelli concessi (vedi getGrantedScopes), l'operazione
// fallisce subito (vedi assertScope in serve()) invece di arrivare a un 403
// opaco dall'API.
const OPERATION_SCOPES = {
  listSuppliers: 'entity.suppliers:a',
  getSupplier: 'entity.suppliers:a',
  listQuotes: 'issued_documents.quotes:a',
  getQuote: 'issued_documents.quotes:a',
  getQuotePreCreateInfo: 'issued_documents.quotes:a',
  createQuote: 'issued_documents.quotes:a',
  // Con OAuth non concessi oggi; con il token manuale sì (vedi getGrantedScopes).
  listProducts: 'products:r',
  syncProductCatalog: 'products:r',
  getClient: 'entity.clients:a',
  upsertClient: 'entity.clients:a',
  createInvoice: 'issued_documents.invoices:a',
} as const satisfies Record<string, FicScope>;

type OperationName = keyof typeof OPERATION_SCOPES;

class FicScopeError extends Error {
  constructor(public readonly scope: FicScope, public readonly operation: string) {
    super(
      `L'operazione "${operation}" richiede lo scope "${scope}", non concesso al token Fatture in Cloud in uso. ` +
      `Con OAuth: richiedere lo scope in Fatture in Cloud > Impostazioni > App collegate, poi ricollegare ` +
      `l'account (disconnect + nuova autorizzazione) perché il token attuale non lo includerà finché non viene riemesso.`,
    );
    this.name = 'FicScopeError';
  }
}

function assertScope(grantedScopes: ReadonlySet<FicScope>, scope: FicScope, operation: string): void {
  if (!grantedScopes.has(scope)) throw new FicScopeError(scope, operation);
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
  id: z.number().int().optional(), // fic_id di un'entità già esistente su FiC (mai usato da createQuote: lì l'entity è sempre inline, vedi opCreateQuote)
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
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

const UpsertClientParamsSchema = z.object({
  // Riga locale di clients: dopo la creazione su FiC, fic_id viene scritto
  // qui (stesso motivo di syncProductCatalog: fic-adapter ha già il client
  // service-role, un secondo giro HTTP interno non avrebbe alcun vantaggio).
  clientId: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  vatNumber: z.string().optional(),
});

// A differenza di QuoteItemSchema (vatId già risolto da chi chiama),
// l'aliquota qui è la percentuale grezza (vat_rate su invoice_queue): l'id
// FiC è un dettaglio di questa company e si risolve dentro opCreateInvoice
// leggendo /issued_documents/info, non a monte.
const InvoiceItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  qty: z.number().positive(),
  netPrice: z.number(),
  vatRate: z.number().min(0).max(100),
  discount: z.number().min(0).max(100).optional(),
});

const CreateInvoiceParamsSchema = z.object({
  type: z.enum(['invoice', 'proforma']), // fattura vs proforma: due IssuedDocumentType diversi in FiC
  entity: QuoteEntitySchema,
  subject: z.string().optional(),
  items: z.array(InvoiceItemSchema).min(1),
  dueDate: z.string().optional(), // scadenza dell'unica rata (payments_list)
  showPayments: z.boolean().optional(),
  showPaymentMethod: z.boolean().optional(),
  // true: costruisce il payload esatto e risolve l'aliquota leggendo FiC
  // (sola lettura), ma NON esegue il POST /issued_documents. Vive qui e non
  // in invoice-issue perché è l'unico punto che parla davvero con FiC: la
  // garanzia "mai un POST in dry run" deve stare accanto alla riga che
  // farebbe il POST, non essere una proprietà emergente di chi chiama.
  dryRun: z.boolean().optional(),
});

const RequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('listSuppliers'), params: ListParamsSchema }),
  z.object({ operation: z.literal('getSupplier'), params: SupplierIdParamsSchema }),
  z.object({ operation: z.literal('listQuotes'), params: ListParamsSchema }),
  z.object({ operation: z.literal('getQuote'), params: DocumentIdParamsSchema }),
  z.object({ operation: z.literal('getQuotePreCreateInfo'), params: EmptyParamsSchema }),
  z.object({ operation: z.literal('createQuote'), params: CreateQuoteParamsSchema }),
  z.object({ operation: z.literal('listProducts'), params: ListParamsSchema }),
  z.object({ operation: z.literal('syncProductCatalog'), params: EmptyParamsSchema }),
  z.object({ operation: z.literal('getClient'), params: ClientIdParamsSchema }),
  z.object({ operation: z.literal('upsertClient'), params: UpsertClientParamsSchema }),
  z.object({ operation: z.literal('createInvoice'), params: CreateInvoiceParamsSchema }),
]);

type ListParams = z.infer<typeof ListParamsSchema>;

function entityToFicPayload(entity: z.infer<typeof QuoteEntitySchema>) {
  return {
    id: entity.id,
    name: entity.name,
    email: entity.email,
    phone: entity.phone,
    vat_number: entity.vatNumber,
    tax_code: entity.taxCode,
    address_street: entity.addressStreet,
    address_postal_code: entity.addressPostalCode,
    address_city: entity.addressCity,
    address_province: entity.addressProvince,
  };
}

// Endpoint reale: GET /issued_documents/info (NON /issued_documents/pre_create_info,
// che risponde 404 su questo account: bug preesistente in opGetQuotePreCreateInfo,
// scoperto implementando createInvoice e corretto qui perché la funzione serve
// a entrambe le operazioni. Verificato il 14/08/2026 su company 22474 per
// type=quote, type=invoice e type=proforma.
async function fetchIssuedDocumentPreCreateInfo(
  token: string,
  companyId: number,
  type: 'quote' | 'invoice' | 'proforma',
) {
  const json = await callFic(token, `/c/${companyId}/issued_documents/info?type=${type}`);
  return json?.data;
}

// L'id di un vat_type è specifico della company, mai un valore a piacere
// (VatType.value è read-only lato FiC, stesso principio già vale per le
// quotes). Preferenza: il default dell'account per quel tipo di documento se
// la sua aliquota coincide (è letteralmente quello che FiC propone per una
// riga senza prodotto collegato), altrimenti il primo vat_type non disabilitato
// con quel valore, scegliendo l'id più basso quando ce ne sono più d'uno: sul
// company 22474 esistono decine di vat_type storici allo stesso valore (es.
// 22%), e gli id bassi (0, 3, 4...) sono quelli generici sempre presenti,
// mentre quelli alti sono spesso legati a un prodotto specifico importato.
function resolveVatTypeId(preCreateInfo: any, vatRatePercent: number): number {
  const defaultVat = preCreateInfo?.items_default_values?.vat;
  if (defaultVat && !defaultVat.is_disabled && Number(defaultVat.value) === Number(vatRatePercent)) {
    return defaultVat.id;
  }

  const list: Array<{ id: number; value: number; is_disabled?: boolean }> = preCreateInfo?.vat_types_list ?? [];
  const candidates = list
    .filter((v) => !v.is_disabled && Number(v.value) === Number(vatRatePercent))
    .sort((a, b) => a.id - b.id);

  if (candidates.length === 0) {
    throw new Error(
      `Nessuna aliquota IVA al ${vatRatePercent}% configurata su Fatture in Cloud per questa azienda: crearla in Impostazioni > Aliquote IVA prima di riprovare.`,
    );
  }
  return candidates[0].id;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
function opGetQuotePreCreateInfo(token: string, companyId: number) {
  return fetchIssuedDocumentPreCreateInfo(token, companyId, 'quote');
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
// OPERAZIONI DI DOMINIO - scope: products:r
// ─────────────────────────────────────────────────────────────────────────
async function opListProducts(token: string, companyId: number, params: ListParams) {
  const qs = new URLSearchParams({
    fieldset: 'detailed',
    // FiC risponde 422 sotto per_page=10: non è un problema di permessi, è un
    // vincolo dell'endpoint. Il default 20 qui sotto sta sopra la soglia.
    page: String(params.page ?? 1),
    per_page: String(params.perPage ?? 20),
  });
  if (params.query) qs.set('q', params.query);
  const json = await callFic(token, `/c/${companyId}/products?${qs}`);
  return json?.data;
}

// Legge l'intero listino paginando (per_page=100, poi last_page): oggi sono
// 70 prodotti e stanno in una pagina sola, ma il loop non si ferma alla prima
// pagina "a occhio": si ferma quando FiC dice che è l'ultima.
async function fetchAllFicProducts(token: string, companyId: number): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const json = await callFic(token, `/c/${companyId}/products?fieldset=detailed&per_page=100&page=${page}`);
    const items: any[] = json?.data ?? [];
    all.push(...items);
    const lastPage = json?.last_page ?? page;
    if (page >= lastPage || items.length === 0) break;
    page++;
  }
  return all;
}

type ProductNature = 'una_tantum' | 'ricorrente' | 'a_giornate';

// Regola dichiarata per dedurre product_nature dal listino FiC (FR-1/B1),
// in ordine di priorità:
// 1) la categoria FiC contiene "CANONI" (RICAVI CANONI MARKETING, RICAVI
//    CANONI TECH) → ricorrente: è Larin stessa a nominarle così, non è
//    un'inferenza nostra.
// 2) nome o descrizione contengono la parola "giornat" (giornata/giornate)
//    → a_giornate: è il lessico reale con cui questi pacchetti sono descritti
//    in FiC (es. "10 giornate lavoro"), non un pattern generico sui numeri.
// 3) altrimenti una_tantum: il default meno dannoso per i casi ambigui.
function deriveProductNature(category: string, name: string, description: string): ProductNature {
  if (category.toUpperCase().includes('CANONI')) return 'ricorrente';
  if (/giornat/i.test(`${name} ${description}`)) return 'a_giornate';
  return 'una_tantum';
}

function numbersDiffer(a: number, b: number): boolean {
  return Math.abs(a - b) >= 0.005;
}

interface ProductSyncSkip { code: string; name: string; reason: string }
interface ProductSyncResult {
  totalInFic: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: ProductSyncSkip[];
}

// Aggiorna/crea in products una singola riga a partire da un prodotto FiC.
// Match: prima per fic_id (i run successivi al primo passano sempre da qui),
// poi per code (aggancia prodotti già presenti in TimeTrap creati a mano
// prima che esistesse il fic_id: è il caso del seed di staging, che
// condivide i code col listino reale).
async function upsertProductFromFic(
  supabase: ReturnType<typeof createClient>,
  p: any,
  defaultUserId: string,
): Promise<'created' | 'updated' | 'unchanged'> {
  const ficId: number = p.id;
  const code: string = p.code;
  if (!code) throw new Error('prodotto FiC senza code');

  let existing: any = null;
  const { data: byFicId } = await supabase.from('products').select('*').eq('fic_id', ficId).maybeSingle();
  existing = byFicId;
  if (!existing) {
    const { data: byCode } = await supabase
      .from('products')
      .select('*')
      .eq('code', code)
      .order('created_at', { ascending: true })
      .limit(1);
    const candidate = byCode?.[0];
    if (candidate) {
      if (candidate.fic_id != null && candidate.fic_id !== ficId) {
        throw new Error(`code "${code}" già collegato al fic_id ${candidate.fic_id}, non a ${ficId}`);
      }
      existing = candidate;
    }
  }

  const ficNet: number | null = p.net_price ?? null;
  const ficGrossRaw: number | null = p.gross_price ?? null;
  const ficVat: number | null = p.default_vat?.value ?? null;

  // Aliquota di riferimento per calcolare il lordo quando FiC non lo fornisce
  // esplicitamente: quella di FiC se c'è, altrimenti quella già su TimeTrap,
  // altrimenti il default di schema (22).
  const referenceVat = ficVat ?? (existing ? Number(existing.vat_rate) : null) ?? 22;
  const ficGross = ficGrossRaw ?? (ficNet != null ? Math.round(ficNet * (1 + referenceVat / 100) * 100) / 100 : null);

  const productNature = deriveProductNature(p.category ?? '', p.name ?? '', p.description ?? '');

  // Campi sempre allineati al listino FiC: sono anagrafica/identità del
  // prodotto, non dati che qualcuno modifica a mano in TimeTrap.
  const patch: Record<string, unknown> = {
    fic_id: ficId,
    code,
    name: p.name,
    description: p.description || null,
    revenue_category: p.category ?? null,
    product_nature: productNature,
  };

  // Prezzi e aliquota: entrano nel patch SOLO se FiC ha un valore non nullo.
  // Nel listino reale diversi prodotti "custom" hanno net_price/gross_price
  // nulli apposta (prezzo deciso caso per caso): se il valore manca il campo
  // resta fuori dal patch e la riga esistente non si tocca, invece di essere
  // azzerata.
  if (ficNet != null) patch.net_price = ficNet;
  if (ficGross != null) patch.gross_price = ficGross;
  if (ficVat != null) patch.vat_rate = ficVat;

  if (!existing) {
    const { error } = await supabase.from('products').insert({
      ...patch,
      user_id: defaultUserId,
      category: p.category, // colonna legacy distinta da revenue_category, ma richiesta NOT NULL: stesso valore, non c'è altro da mettere in un insert
      net_price: ficNet ?? 0,
      gross_price: ficGross ?? 0,
      vat_rate: ficVat ?? 22,
    });
    if (error) throw error;
    return 'created';
  }

  const changed = Object.entries(patch).some(([key, value]) => {
    const current = existing[key];
    if (key === 'net_price' || key === 'gross_price' || key === 'vat_rate') {
      return numbersDiffer(Number(current), Number(value));
    }
    return (current ?? null) !== (value ?? null);
  });
  if (!changed) return 'unchanged';

  const { error } = await supabase.from('products').update(patch).eq('id', existing.id);
  if (error) throw error;
  return 'updated';
}

// Legge il listino intero e lo porta in products. Fa scrittura locale (non
// solo lettura da FiC) perché fic-adapter ha già qui il client service-role e
// il ruolo del chiamante verificato: separarla in un'altra function
// costringerebbe a far viaggiare tutto il catalogo su un secondo giro HTTP
// interno senza alcun vantaggio.
async function opSyncProductCatalog(
  supabase: ReturnType<typeof createClient>,
  token: string,
  companyId: number,
  callerId: string,
): Promise<ProductSyncResult> {
  const ficProducts = await fetchAllFicProducts(token, companyId);

  let created = 0, updated = 0, unchanged = 0;
  const skipped: ProductSyncSkip[] = [];

  for (const p of ficProducts) {
    try {
      const result = await upsertProductFromFic(supabase, p, callerId);
      if (result === 'created') created++;
      else if (result === 'updated') updated++;
      else unchanged++;
    } catch (e) {
      skipped.push({ code: p.code ?? '?', name: p.name ?? '?', reason: (e as Error).message });
    }
  }

  return { totalInFic: ficProducts.length, created, updated, unchanged, skipped };
}

// ─────────────────────────────────────────────────────────────────────────
// OPERAZIONI DI DOMINIO — scope: entity.clients:a (concesso col token manuale)
// ─────────────────────────────────────────────────────────────────────────
async function opGetClient(token: string, companyId: number, params: { clientId: number }) {
  const json = await callFic(token, `/c/${companyId}/entities/clients/${params.clientId}?fieldset=detailed`);
  return json?.data;
}

// Crea sempre (non aggiorna): il chiamante (invoice-issue) invoca questa
// operazione solo quando clients.fic_id è nullo, cioè il cliente non esiste
// ancora su FiC (vedi report di consegna dell'emissione fatture). Non cerca
// un'entità omonima già presente su FiC: la fonte di verità è il nostro
// fic_id, non un match per nome (fragile, vedi i gotcha di ricerca `q=`).
async function opUpsertClient(
  supabase: ReturnType<typeof createClient>,
  token: string,
  companyId: number,
  params: z.infer<typeof UpsertClientParamsSchema>,
) {
  const payload = {
    data: {
      type: 'company', // i clienti Larin sono aziende B2B; non c'è un campo persona/azienda su clients
      name: params.name,
      email: params.email || undefined,
      phone: params.phone || undefined,
      vat_number: params.vatNumber || undefined,
    },
  };

  const json = await callFic(token, `/c/${companyId}/entities/clients`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const ficId = json?.data?.id;
  if (!ficId) throw new Error('Fatture in Cloud non ha restituito un id per il cliente creato');

  const { error } = await supabase.from('clients').update({ fic_id: ficId }).eq('id', params.clientId);
  if (error) throw error;

  return { id: ficId };
}

// ─────────────────────────────────────────────────────────────────────────
// OPERAZIONI DI DOMINIO — scope: issued_documents.invoices:a (concesso col
// token manuale). Vale anche per document_kind = proforma: il vero scope FiC
// per le proforma è issued_documents.proformas:a, MAI verificato esplicitamente
// col token manuale (solo invoice e quote lo sono state, vedi fic-token.ts).
// Nessuna riga di test aveva document_kind = proforma al momento di scrivere
// questo codice: primo utilizzo reale da verificare (vedi report).
// ─────────────────────────────────────────────────────────────────────────
// Endpoint reale: POST /c/{company_id}/issued_documents.
//
// Bozza voluta dal PRD, non emissione fiscale: qui non si imposta MAI
// `e_invoice`, per nessun valore di dryRun. La trasmissione a SDI è un gesto
// umano dentro FiC (POST /issued_documents/{id}/e_invoice/send), fuori dal
// perimetro di questa funzione: nessun parametro di questa operazione può
// farla scattare.
async function opCreateInvoice(token: string, companyId: number, params: z.infer<typeof CreateInvoiceParamsSchema>) {
  const preCreateInfo = await fetchIssuedDocumentPreCreateInfo(token, companyId, params.type);

  let grossTotal = 0;
  const itemsList = params.items.map((item) => {
    const vatId = resolveVatTypeId(preCreateInfo, item.vatRate);
    const discount = item.discount ?? 0;
    const netAfterDiscount = item.netPrice * item.qty * (1 - discount / 100);
    grossTotal += netAfterDiscount * (1 + item.vatRate / 100);
    return {
      name: item.name,
      description: item.description,
      qty: item.qty,
      net_price: item.netPrice,
      vat: { id: vatId },
      discount,
    };
  });

  const payload = {
    data: {
      type: params.type,
      entity: entityToFicPayload(params.entity),
      subject: params.subject,
      items_list: itemsList,
      payments_list: params.dueDate
        ? [{ due_date: params.dueDate, amount: round2(grossTotal) }]
        : undefined,
      show_payments: params.showPayments ?? true,
      show_payment_method: params.showPaymentMethod ?? true,
    },
  };

  // Il vincolo assoluto vive qui, accanto all'unica riga che farebbe il POST:
  // con dryRun true si esce PRIMA di chiamare callFic, qualunque cosa dica il
  // resto del payload.
  if (params.dryRun) {
    return { payload, ficDocument: null };
  }

  const json = await callFic(token, `/c/${companyId}/issued_documents`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { payload, ficDocument: json?.data };
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
    assertScope(getGrantedScopes(), OPERATION_SCOPES[operation], operation);

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
      case 'syncProductCatalog':
        result = await opSyncProductCatalog(supabase, token, companyId, callerId);
        break;
      case 'getClient':
        result = await opGetClient(token, companyId, parsed.data.params);
        break;
      case 'upsertClient':
        result = await opUpsertClient(supabase, token, companyId, parsed.data.params);
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
