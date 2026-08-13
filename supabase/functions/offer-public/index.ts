// Edge function pubblica del link offerta (verify_jwt = false, vedi
// supabase/config.toml). Il cliente non tocca mai il database: ogni lettura
// passa da resolve_offer_public_link, ogni decisione da
// record_offer_client_decision, entrambe riservate al service role (AD-12).
// Contratto HTTP e forma dello snapshot: vedi il contratto del blocco B5.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { generateOfferPdf, generateSignedOfferPdf, OfferSnapshot } from './pdf.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PDF_URL_TTL_SECONDS = 600; // 10 minuti, come richiesto dal contratto
const DOCUMENTS_BUCKET = 'offer-documents';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Primo valore di x-forwarded-for; null se assente (mai stringa vuota verso l'inet di Postgres). */
function extractClientIp(req: Request): string | null {
  const header = req.headers.get('x-forwarded-for');
  if (!header) return null;
  const first = header.split(',')[0].trim();
  return first || null;
}

/** Firma tracciata a mano: un PNG di qualche decina di kilobyte, non di più. */
const MAX_FIRMA_BYTE = 3 * 1024 * 1024;

/** I primi otto byte di ogni PNG, per specifica. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Verificare che sia davvero un PNG non è pignoleria: senza questo controllo un
 * file qualsiasi viene accettato come firma, l'offerta passa ad "accettata", e
 * poi il PDF firmato non si genera mai perché la libreria non riesce a leggere
 * l'immagine. A quel punto l'offerta è bloccata per sempre: c'è una sola
 * accettazione ammessa per versione, quindi non si può nemmeno rifirmare, e
 * l'unica uscita è aprire una revisione. Meglio un 400 subito.
 */
function decodeSignaturePng(dataUrl: unknown): Uint8Array {
  if (typeof dataUrl !== 'string') {
    throw new Error('Formato della firma non valido.');
  }
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl.trim());
  if (!match) {
    throw new Error('Formato della firma non valido: atteso un PNG in data URL.');
  }
  // Il base64 cresce di un terzo rispetto ai byte: si controlla prima di
  // decodificare, per non allocare comunque il file enorme.
  if (match[1].length > MAX_FIRMA_BYTE * 1.4) {
    throw new Error('La firma è troppo grande: riprova a tracciarla.');
  }

  let binary: string;
  try {
    binary = atob(match[1]);
  } catch {
    throw new Error('Formato della firma non valido: contenuto illeggibile.');
  }

  if (binary.length > MAX_FIRMA_BYTE) {
    throw new Error('La firma è troppo grande: riprova a tracciarla.');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  if (bytes.length < PNG_MAGIC.length || PNG_MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error('Formato della firma non valido: il contenuto non è un PNG.');
  }

  return bytes;
}

function buildOfferPdfPath(snapshot: OfferSnapshot): string {
  return `offers/${snapshot.version.id}/offerta-${snapshot.offer.year}-${snapshot.offer.number}-v${snapshot.version.version_number}.pdf`;
}

function buildSignedPdfPath(snapshot: OfferSnapshot): string {
  return `offers/${snapshot.version.id}/offerta-${snapshot.offer.year}-${snapshot.offer.number}-v${snapshot.version.version_number}-firmata.pdf`;
}

async function createSignedPdfUrl(supabase: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, PDF_URL_TTL_SECONDS);
  if (error || !data) {
    throw new Error(`Impossibile generare il link al PDF: ${error?.message ?? 'errore sconosciuto'}`);
  }
  return data.signedUrl;
}

/** Genera (se manca) e restituisce l'URL firmato del PDF non firmato di una versione. */
async function ensureBasePdfUrl(supabase: SupabaseClient, offerVersionId: string): Promise<string> {
  const { data: docRow, error: docError } = await supabase
    .from('offer_version_documents')
    .select('snapshot, snapshot_hash, frozen_at, pdf_path')
    .eq('offer_version_id', offerVersionId)
    .maybeSingle();

  if (docError || !docRow) {
    throw new Error('Documento congelato non trovato per questa versione.');
  }

  let pdfPath = docRow.pdf_path as string | null;

  if (!pdfPath) {
    const snapshot = docRow.snapshot as OfferSnapshot;
    const pdfBytes = await generateOfferPdf(snapshot, {
      documentHash: docRow.snapshot_hash,
      frozenAt: docRow.frozen_at,
    });

    pdfPath = buildOfferPdfPath(snapshot);
    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) {
      throw new Error(`Caricamento del PDF fallito: ${uploadError.message}`);
    }

    const { error: attachError } = await supabase.rpc('attach_offer_version_pdf', {
      _offer_version_id: offerVersionId,
      _pdf_path: pdfPath,
      _expected_snapshot_hash: docRow.snapshot_hash,
    });
    if (attachError) {
      // Una richiesta concorrente potrebbe aver già attaccato il path prima
      // di noi: attach_offer_version_pdf è idempotente e non lo sovrascrive,
      // quindi si rilegge quello attuale invece di trattarlo come un errore.
      const { data: refreshed } = await supabase
        .from('offer_version_documents')
        .select('pdf_path')
        .eq('offer_version_id', offerVersionId)
        .maybeSingle();
      if (!refreshed?.pdf_path) {
        throw new Error(`Registrazione del PDF fallita: ${attachError.message}`);
      }
      pdfPath = refreshed.pdf_path;
    }
  }

  if (!pdfPath) {
    throw new Error('Path del PDF mancante dopo il tentativo di registrazione.');
  }
  return createSignedPdfUrl(supabase, pdfPath);
}

/** Genera (se manca) e restituisce l'URL firmato del PDF firmato, per una versione già accettata. */
async function ensureSignedPdfUrl(supabase: SupabaseClient, offerVersionId: string): Promise<string> {
  const { data: signatureRow, error: signatureError } = await supabase
    .from('offer_signatures')
    .select('*')
    .eq('offer_version_id', offerVersionId)
    .eq('decision', 'accettata')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (signatureError || !signatureRow) {
    throw new Error('Nessuna firma di accettazione trovata per questa versione.');
  }

  if (signatureRow.signed_pdf_path) {
    return createSignedPdfUrl(supabase, signatureRow.signed_pdf_path);
  }

  const { data: docRow, error: docError } = await supabase
    .from('offer_version_documents')
    .select('snapshot, snapshot_hash, frozen_at')
    .eq('offer_version_id', offerVersionId)
    .maybeSingle();
  if (docError || !docRow) {
    throw new Error('Documento congelato non trovato per questa versione.');
  }

  if (!signatureRow.signature_image_path) {
    throw new Error("Immagine della firma mancante per l'accettazione registrata.");
  }
  const { data: pngBlob, error: pngError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(signatureRow.signature_image_path);
  if (pngError || !pngBlob) {
    throw new Error("Impossibile leggere l'immagine della firma archiviata.");
  }
  const signaturePngBytes = new Uint8Array(await pngBlob.arrayBuffer());

  const snapshot = docRow.snapshot as OfferSnapshot;
  const signedBytes = await generateSignedOfferPdf(
    snapshot,
    { documentHash: docRow.snapshot_hash, frozenAt: docRow.frozen_at },
    {
      signerName: signatureRow.signer_name,
      signerRole: signatureRow.signer_role,
      signerEmail: signatureRow.signer_email,
      signedAt: signatureRow.created_at,
      clientIp: signatureRow.client_ip,
      userAgent: signatureRow.user_agent,
      signaturePngBytes,
    },
  );

  const signedPdfPath = buildSignedPdfPath(snapshot);
  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(signedPdfPath, signedBytes, { contentType: 'application/pdf', upsert: true });
  if (uploadError) {
    throw new Error(`Caricamento del PDF firmato fallito: ${uploadError.message}`);
  }

  const { error: attachError } = await supabase.rpc('attach_offer_signature_pdf', {
    _signature_id: signatureRow.id,
    _pdf_path: signedPdfPath,
  });
  if (attachError) {
    throw new Error(`Registrazione del PDF firmato fallita: ${attachError.message}`);
  }

  return createSignedPdfUrl(supabase, signedPdfPath);
}

/** Sceglie fra PDF firmato e non, in base alla presenza di un'accettazione per la versione. */
async function ensurePdfUrlForVersion(supabase: SupabaseClient, offerVersionId: string, isAccepted: boolean): Promise<string> {
  return isAccepted
    ? ensureSignedPdfUrl(supabase, offerVersionId)
    : ensureBasePdfUrl(supabase, offerVersionId);
}

function outcomeToItalianError(outcome: string): string {
  switch (outcome) {
    case 'revocato':
      return 'Questo link è stato revocato.';
    case 'scaduto':
      return 'Questo link è scaduto.';
    case 'non_trovato':
      return 'Link non valido.';
    case 'documento_assente':
      return 'Il documento di questa offerta non è ancora disponibile.';
    default:
      return 'Impossibile generare il documento.';
  }
}

/**
 * L'unico vincolo che il database impone davvero (idx_offer_signatures_one_
 * acceptance_per_version) potrebbe emergere come violazione univoca (23505)
 * oppure, più spesso, come il check_violation che record_offer_client_decision
 * solleva quando rilegge lo stato già portato ad 'accettata' da una richiesta
 * gemella. Un doppio invio del cliente deve risolversi in un successo
 * idempotente in entrambi i casi, non in un errore Postgres grezzo.
 */
function isAlreadyAcceptedError(error: { code?: string; message?: string }): boolean {
  if (error.code === '23505') return true;
  if (typeof error.message === 'string' && /nello stato accettata/i.test(error.message)) return true;
  return false;
}

function mapDecisionErrorStatus(error: { message?: string }): number {
  const msg = error.message ?? '';
  if (/link (non valido|revocato|scaduto)/i.test(msg)) return 400;
  if (/firma è obbligatoria/i.test(msg)) return 400;
  // Stato non più accettabile, hash cambiato nel frattempo, versione non
  // corrente: sono conflitti con lo stato attuale del documento, non input
  // malformato.
  return 409;
}

/** Le eccezioni della RPC sono già testo italiano leggibile; qui si toglie solo
 * il contesto che Postgres a volte aggiunge in coda al messaggio. */
function cleanPostgresMessage(message: string | undefined): string {
  if (!message) return 'Richiesta non valida.';
  return message.split('\nCONTEXT:')[0].trim();
}

async function handleGet(supabase: SupabaseClient, req: Request, clientIp: string | null, userAgent: string | null): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const wantsPdf = url.searchParams.get('pdf') === '1';

  if (!token) {
    return json(400, { error: 'Token mancante.' });
  }

  const { data: resolved, error: resolveError } = await supabase.rpc('resolve_offer_public_link', {
    _token: token,
    _client_ip: clientIp,
    _user_agent: userAgent,
  });

  if (resolveError) {
    console.error('resolve_offer_public_link error', resolveError);
    return json(500, { error: "Errore nel recupero dell'offerta." });
  }

  if (!wantsPdf) {
    return json(200, resolved);
  }

  if (resolved.outcome !== 'ok') {
    return json(404, { error: outcomeToItalianError(resolved.outcome) });
  }

  try {
    const isAccepted = resolved.signature?.decision === 'accettata';
    const pdfUrl = await ensurePdfUrlForVersion(supabase, resolved.offer_version_id, isAccepted);
    return json(200, { url: pdfUrl });
  } catch (error) {
    console.error('pdf generation error', error);
    return json(500, { error: 'Errore nella generazione del PDF.' });
  }
}

async function handlePost(supabase: SupabaseClient, req: Request, clientIp: string | null, userAgent: string | null): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Corpo della richiesta non valido.' });
  }

  const token = typeof body.token === 'string' ? body.token : null;
  const action = body.action;
  const signerName = typeof body.signer_name === 'string' ? body.signer_name.trim() : '';
  const signerRole = typeof body.signer_role === 'string' && body.signer_role.trim() ? body.signer_role.trim() : null;
  const signerEmail = typeof body.signer_email === 'string' && body.signer_email.trim() ? body.signer_email.trim() : null;
  const documentHash = typeof body.document_hash === 'string' ? body.document_hash : null;
  const rejectReason = typeof body.reject_reason === 'string' && body.reject_reason.trim() ? body.reject_reason.trim() : null;

  if (!token) return json(400, { error: 'Token mancante.' });
  if (action !== 'accept' && action !== 'reject') return json(400, { error: 'Azione non riconosciuta.' });
  if (!documentHash) return json(400, { error: 'Hash del documento mancante: ricaricare la pagina e riprovare.' });
  if (!signerName) return json(400, { error: 'Il nominativo di chi firma o rifiuta è obbligatorio.' });
  if (action === 'accept' && !body.signature_png) {
    return json(400, { error: "La firma disegnata è obbligatoria per accettare l'offerta." });
  }

  // Serve solo a sapere DOVE salvare l'eventuale PNG prima di chiamare la RPC
  // (che vuole già il path). La RPC resta l'unica fonte di verità su token,
  // scadenza e versione corrente: rifà tutti questi controlli sotto lock.
  const { data: link, error: linkError } = await supabase
    .from('offer_public_links')
    .select('id, offer_id, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (linkError) {
    console.error('offer_public_links lookup error', linkError);
    return json(500, { error: 'Errore nel recupero del link.' });
  }
  if (!link) return json(400, { error: 'Link non valido.' });
  if (link.revoked_at) return json(400, { error: 'Questo link è stato revocato.' });
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return json(400, { error: 'Questo link è scaduto.' });
  }

  const { data: offer, error: offerError } = await supabase
    .from('offers')
    .select('current_version_id')
    .eq('id', link.offer_id)
    .maybeSingle();
  if (offerError || !offer?.current_version_id) {
    return json(400, { error: 'Questa offerta non ha una versione corrente.' });
  }
  const offerVersionId = offer.current_version_id as string;

  let signatureImagePath: string | null = null;
  if (action === 'accept') {
    // La validazione va prima e per conto suo: se la firma non è un PNG buono,
    // il cliente deve saperlo con un messaggio che dice cosa fare, e soprattutto
    // niente deve essere ancora stato scritto.
    let pngBytes: Uint8Array;
    try {
      pngBytes = decodeSignaturePng(body.signature_png);
    } catch (error) {
      const messaggio = error instanceof Error ? error.message : 'Formato della firma non valido.';
      return json(400, { error: `${messaggio} Riprova a firmare, oppure scrivi al tuo referente.` });
    }

    try {
      signatureImagePath = `signatures/${offerVersionId}/${crypto.randomUUID()}.png`;
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(signatureImagePath, pngBytes, { contentType: 'image/png' });
      if (uploadError) throw new Error(uploadError.message);
    } catch (error) {
      console.error('signature upload failed', error);
      return json(400, { error: 'Impossibile salvare la firma: ricaricare la pagina e riprovare.' });
    }
  }

  const { data: decisionResult, error: decisionError } = await supabase.rpc('record_offer_client_decision', {
    _token: token,
    _decision: action === 'accept' ? 'accettata' : 'rifiutata',
    _signer_name: signerName,
    _expected_document_hash: documentHash,
    _client_ip: clientIp,
    _user_agent: userAgent,
    _signer_role: signerRole,
    _signer_email: signerEmail,
    _signature_image_path: signatureImagePath,
    _reject_reason: rejectReason,
  });

  if (decisionError) {
    // La RPC non ha usato l'immagine caricata: senza questa pulizia resta un
    // PNG orfano nel bucket, mai referenziato da nessuna riga.
    if (signatureImagePath) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([signatureImagePath]).catch((e) => {
        console.error('orphan signature cleanup failed', e);
      });
    }

    if (action === 'accept' && isAlreadyAcceptedError(decisionError)) {
      try {
        const pdfUrl = await ensureSignedPdfUrl(supabase, offerVersionId);
        const { data: existing } = await supabase
          .from('offer_signatures')
          .select('id')
          .eq('offer_version_id', offerVersionId)
          .eq('decision', 'accettata')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return json(200, { ok: true, signature_id: existing?.id ?? null, pdf_url: pdfUrl });
      } catch (error) {
        console.error('idempotent duplicate-accept recovery failed', error);
        return json(500, { error: "Offerta già accettata, ma il recupero del PDF firmato è fallito: riprovare tra poco." });
      }
    }

    console.error('record_offer_client_decision error', decisionError);
    return json(mapDecisionErrorStatus(decisionError), { error: cleanPostgresMessage(decisionError.message) });
  }

  try {
    const pdfUrl = await ensurePdfUrlForVersion(supabase, offerVersionId, action === 'accept');
    return json(200, { ok: true, signature_id: decisionResult.signature_id, pdf_url: pdfUrl });
  } catch (error) {
    // La decisione È stata registrata correttamente: un intoppo nella sola
    // generazione del PDF non deve travestirsi da fallimento dell'operazione.
    console.error('post-decision pdf generation failed', error);
    return json(200, { ok: true, signature_id: decisionResult.signature_id, pdf_url: null });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const clientIp = extractClientIp(req);
  const userAgent = req.headers.get('user-agent');

  try {
    if (req.method === 'GET') {
      return await handleGet(supabase, req, clientIp, userAgent);
    }
    if (req.method === 'POST') {
      return await handlePost(supabase, req, clientIp, userAgent);
    }
    return json(405, { error: 'Metodo non consentito.' });
  } catch (error) {
    console.error('Unexpected error', error);
    return json(500, { error: 'Errore interno del server.' });
  }
});
