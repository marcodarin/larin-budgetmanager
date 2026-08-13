// Generatore del PDF dell'offerta, a partire dallo snapshot congelato in
// offer_version_documents.snapshot. Nessuna tabella viva viene letta qui: il
// documento è deterministico rispetto allo snapshot che riceve, così lo stesso
// contenuto produce sempre lo stesso PDF (a meno delle sole differenze di
// libreria non evitabili, es. timestamp interno del file).
//
// Font standard Helvetica (encoding WinAnsi): copre le lettere accentate
// italiane e l'Euro, ma non è garantito coprire qualunque carattere immesso a
// mano (es. nomi cliente con caratteri esotici). sanitizeForPdf() sostituisce
// con '?' i soli caratteri che il font non può codificare, invece di lasciar
// esplodere pdf-lib a metà generazione.
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from 'https://esm.sh/pdf-lib@1.17.1';

export interface OfferSnapshotLine {
  description: string;
  product_code: string | null;
  product_name: string | null;
  revenue_category: string | null;
  quantity: number;
  unit_list_price: number;
  discount_percentage: number;
  vat_rate: number;
  line_total: number;
}

export interface OfferSnapshotPaymentPlanItem {
  amount: number | null;
  percentage: number | null;
  maturity_event: 'firma' | 'consegna' | 'pubblicazione_fase' | 'data_calendario' | 'ricorrente';
  scheduled_date: string | null;
  phase_label: string | null;
  payment_term_label: string;
  payment_term_days: number | null;
  payment_term_due_basis: 'data_documento' | 'fine_mese' | null;
}

export interface OfferSnapshotTermsSpecific {
  product_name: string;
  text: string;
}

export interface OfferSnapshot {
  schema_version: number;
  offer: { id: string; year: number; number: number; reference: string; origin: string };
  client: { id: string; name: string; email: string | null };
  version: {
    id: string;
    version_number: number;
    billing_mode: 'importo_finito' | 'ricorrente' | 'a_giornate' | 'tetto_di_spesa';
    list_total: number;
    offered_total: number;
    effective_discount_percentage: number;
    payment_terms_text: string | null;
    valid_until: string | null;
  };
  lines: OfferSnapshotLine[];
  payment_plan: OfferSnapshotPaymentPlanItem[];
  terms: { general: string; specific: OfferSnapshotTermsSpecific[] };
}

export interface GenerateOfferPdfOptions {
  /** sha256 hex (64 caratteri) di offer_version_documents.snapshot_hash */
  documentHash: string;
  /** ISO timestamp di offer_version_documents.frozen_at */
  frozenAt: string;
}

export interface SignatureCertificateOptions {
  signerName: string;
  signerRole: string | null;
  signerEmail: string | null;
  /** ISO timestamp della firma (offer_signatures.created_at) */
  signedAt: string;
  clientIp: string;
  userAgent: string | null;
  signaturePngBytes: Uint8Array;
}

const PAGE_WIDTH = 595.28; // A4 in punti
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_RESERVE = 34;

const COLOR_TEXT = rgb(0.13, 0.13, 0.13);
const COLOR_GRAY = rgb(0.42, 0.42, 0.42);
const COLOR_LINE = rgb(0.75, 0.75, 0.75);

// -----------------------------------------------------------------------------
// Formattazione italiana
// -----------------------------------------------------------------------------

function formatNumber(value: number, minDecimals: number, maxDecimals: number): string {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

function formatCurrency(value: number): string {
  return `${formatNumber(Number(value) || 0, 2, 2)} €`;
}

function formatQuantity(value: number): string {
  return formatNumber(Number(value) || 0, 0, 2);
}

function formatPercentage(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  const isInteger = Number.isInteger(rounded);
  return `${formatNumber(rounded, isInteger ? 0 : 2, 2)}%`;
}

/** Data (senza ora) per campi `date` come valid_until o scheduled_date. */
function formatDateIt(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Istante (timestamptz) formattato in ora italiana, per congelamento e firma. */
function formatDateTimeIt(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const formatted = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${formatted} (ora italiana)`;
}

/** Spezza l'hash in blocchi separati da spazi, altrimenti wrapText() lo tratta
 * come un'unica parola non spezzabile e lo fa uscire dal margine della pagina. */
function formatHashForDisplay(hash: string): string {
  return hash.match(/.{1,8}/g)?.join(' ') ?? hash;
}

// -----------------------------------------------------------------------------
// Sanificazione: WinAnsi copre le accentate italiane ma non ogni carattere
// -----------------------------------------------------------------------------

/**
 * I font standard del PDF coprono WinAnsi, che basta per l'italiano ma non per
 * la ř di Přemysl o per un nome cinese. Prima di rinunciare a un carattere si
 * prova a toglierne i segni diacritici: "Přemysl" diventa "Premysl", che è
 * leggibile e riconoscibile, mentre "P?emysl" non è né l'uno né l'altro.
 *
 * Per gli alfabeti non latini il ripiego resta il punto interrogativo: coprirli
 * richiede di incorporare un font Unicode nel documento, che è la strada giusta
 * quando servirà davvero e va deciso allora, non improvvisato qui.
 */
function sanitizeForPdf(text: string, font: PDFFont): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    let out = '';
    for (const ch of text) {
      try {
        font.encodeText(ch);
        out += ch;
        continue;
      } catch {
        // il carattere non è rappresentabile: si tenta la forma senza accenti
      }

      const senzaDiacritici = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (senzaDiacritici && senzaDiacritici !== ch) {
        try {
          font.encodeText(senzaDiacritici);
          out += senzaDiacritici;
          continue;
        } catch {
          // nemmeno la forma base è rappresentabile
        }
      }

      out += '?';
    }
    return out;
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = sanitizeForPdf(text, font);
  const words = safe.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawAligned(
  page: PDFPage,
  text: string,
  x: number,
  width: number,
  y: number,
  size: number,
  font: PDFFont,
  align: 'left' | 'right',
) {
  const w = font.widthOfTextAtSize(text, size);
  const drawX = align === 'right' ? x + width - w : x;
  page.drawText(text, { x: drawX, y, size, font, color: COLOR_TEXT });
}

// -----------------------------------------------------------------------------
// Piano di pagamento: dal record al testo che si legge, non che si interpreta
// -----------------------------------------------------------------------------

function maturityEventPhrase(item: OfferSnapshotPaymentPlanItem): string {
  switch (item.maturity_event) {
    case 'firma':
      return 'alla firma';
    case 'consegna':
      return 'alla consegna';
    case 'pubblicazione_fase':
      return item.phase_label
        ? `alla pubblicazione della fase "${item.phase_label}"`
        : 'alla pubblicazione della fase';
    case 'data_calendario':
      return item.scheduled_date ? `il ${formatDateIt(item.scheduled_date)}` : 'a data da definire';
    case 'ricorrente':
      return item.phase_label ? `con cadenza ricorrente (${item.phase_label})` : 'con cadenza ricorrente';
    default:
      return '';
  }
}

function paymentTermPhrase(item: OfferSnapshotPaymentPlanItem): string {
  if (item.payment_term_days != null && item.payment_term_due_basis) {
    const basis = item.payment_term_due_basis === 'data_documento' ? 'data documento' : 'fine mese';
    return `pagamento a ${item.payment_term_days} giorni ${basis}`;
  }
  // Termine senza giorni/base (es. "Pagamento immediato"): l'etichetta è già
  // la frase giusta, va solo resa minuscola per incastrarsi nel periodo.
  const label = (item.payment_term_label ?? '').trim();
  if (!label) return 'condizioni di pagamento da definire';
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function paymentPlanSentence(item: OfferSnapshotPaymentPlanItem): string {
  const quota = item.percentage != null ? formatPercentage(item.percentage) : formatCurrency(item.amount ?? 0);
  const sentence = `${quota} ${maturityEventPhrase(item)}, ${paymentTermPhrase(item)}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// -----------------------------------------------------------------------------
// Regola del prezzo unico omnicomprensivo (importo_finito)
// -----------------------------------------------------------------------------

/**
 * Quando la modalità è importo_finito e le righe sono un elenco di comodo che
 * non deve sommare al totale offerto (prezzo unico concordato a corpo, scelta
 * commerciale precisa), mostrare prezzi di riga che non tornano sarebbe
 * fuorviante. Regola esplicita: se la somma dei line_total differisce
 * dall'offered_total di più di un centesimo per riga (tolleranza per gli
 * arrotondamenti di più voci), si nasconde il prezzo di riga e resta solo il
 * totale.
 */
export function shouldHideLinePrices(snapshot: OfferSnapshot): boolean {
  if (snapshot.version.billing_mode !== 'importo_finito') return false;
  if (snapshot.lines.length === 0) return false;
  const sumLineTotals = snapshot.lines.reduce((acc, l) => acc + (Number(l.line_total) || 0), 0);
  const tolerance = 0.01 * snapshot.lines.length;
  return Math.abs(sumLineTotals - (Number(snapshot.version.offered_total) || 0)) > tolerance;
}

// -----------------------------------------------------------------------------
// Motore di impaginazione: cursore verticale con paginazione automatica
// -----------------------------------------------------------------------------

class Layout {
  doc: PDFDocument;
  fontRegular: PDFFont;
  fontBold: PDFFont;
  page!: PDFPage;
  y = 0;

  constructor(doc: PDFDocument, fontRegular: PDFFont, fontBold: PDFFont) {
    this.doc = doc;
    this.fontRegular = fontRegular;
    this.fontBold = fontBold;
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(height: number) {
    if (this.y - height < MARGIN + FOOTER_RESERVE) {
      this.newPage();
    }
  }

  spacer(height: number) {
    this.ensureSpace(1);
    this.y -= height;
  }

  line(text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; x?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.fontRegular;
    const x = opts.x ?? MARGIN;
    const gap = opts.gap ?? 4;
    this.ensureSpace(size + gap);
    this.page.drawText(sanitizeForPdf(text, font), {
      x,
      y: this.y - size,
      size,
      font,
      color: opts.color ?? COLOR_TEXT,
    });
    this.y -= size + gap;
  }

  paragraph(
    text: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; x?: number; maxWidth?: number } = {},
  ) {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.fontRegular;
    const x = opts.x ?? MARGIN;
    const maxWidth = opts.maxWidth ?? PAGE_WIDTH - x - MARGIN;
    const lineGap = 3;
    const lines = wrapText(text, font, size, maxWidth);
    for (const l of lines) {
      this.ensureSpace(size + lineGap);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: opts.color ?? COLOR_TEXT });
      this.y -= size + lineGap;
    }
    this.y -= (opts.gap ?? 4) - lineGap;
  }

  divider() {
    this.ensureSpace(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.5,
      color: COLOR_LINE,
    });
    this.y -= 10;
  }
}

// -----------------------------------------------------------------------------
// Tabella delle righe offerta
// -----------------------------------------------------------------------------

function drawLinesSection(layout: Layout, snapshot: OfferSnapshot) {
  const hidePrices = shouldHideLinePrices(snapshot);

  layout.line(hidePrices ? "Perimetro dell'offerta" : 'Voci offerte', {
    size: 12,
    font: layout.fontBold,
    gap: 8,
  });

  if (hidePrices) {
    // Prezzo unico omnicomprensivo: si elencano le voci comprese, senza i
    // prezzi di riga che non sommerebbero al totale e confonderebbero il
    // cliente invece di chiarire.
    for (const l of snapshot.lines) {
      const qtyNote = Number(l.quantity) !== 1 ? ` (x${formatQuantity(l.quantity)})` : '';
      layout.paragraph(`• ${l.description}${qtyNote}`, { size: 10, gap: 6 });
    }
    layout.spacer(4);
    layout.line(`Totale offerto: ${formatCurrency(snapshot.version.offered_total)}`, {
      size: 12,
      font: layout.fontBold,
      gap: 4,
    });
    drawVatSummary(layout, snapshot);
    return;
  }

  const cols = [
    { label: 'Descrizione', x: MARGIN, width: 195, align: 'left' as const },
    { label: 'Quantità', x: MARGIN + 195, width: 55, align: 'right' as const },
    { label: 'Prezzo unitario', x: MARGIN + 250, width: 90, align: 'right' as const },
    { label: 'Sconto', x: MARGIN + 340, width: 55, align: 'right' as const },
    { label: 'Totale', x: MARGIN + 395, width: 100, align: 'right' as const },
  ];

  layout.ensureSpace(22);
  for (const c of cols) {
    drawAligned(layout.page, c.label, c.x, c.width, layout.y - 9, 9, layout.fontBold, c.align);
  }
  layout.y -= 14;
  layout.divider();

  for (const l of snapshot.lines) {
    const descLines = wrapText(l.description, layout.fontRegular, 9.5, cols[0].width - 4);
    const rowHeight = Math.max(descLines.length, 1) * 12 + 6;
    layout.ensureSpace(rowHeight);
    const rowTopY = layout.y;

    descLines.forEach((dl, i) => {
      layout.page.drawText(dl, {
        x: cols[0].x,
        y: rowTopY - 10 - i * 12,
        size: 9.5,
        font: layout.fontRegular,
        color: COLOR_TEXT,
      });
    });

    const cellY = rowTopY - 10;
    drawAligned(layout.page, formatQuantity(l.quantity), cols[1].x, cols[1].width, cellY, 9.5, layout.fontRegular, 'right');
    drawAligned(layout.page, formatCurrency(l.unit_list_price), cols[2].x, cols[2].width, cellY, 9.5, layout.fontRegular, 'right');
    const discountText = Number(l.discount_percentage) > 0 ? formatPercentage(l.discount_percentage) : '-';
    drawAligned(layout.page, discountText, cols[3].x, cols[3].width, cellY, 9.5, layout.fontRegular, 'right');
    drawAligned(layout.page, formatCurrency(l.line_total), cols[4].x, cols[4].width, cellY, 9.5, layout.fontBold, 'right');

    layout.y -= rowHeight;
  }

  layout.divider();
  layout.spacer(2);
  drawAligned(
    layout.page,
    `Totale offerto: ${formatCurrency(snapshot.version.offered_total)}`,
    MARGIN,
    CONTENT_WIDTH,
    layout.y - 12,
    12,
    layout.fontBold,
    'right',
  );
  layout.y -= 20;

  drawVatSummary(layout, snapshot);
}

/**
 * L'IVA sul documento che il cliente firma non è un dettaglio estetico: senza,
 * si firma un importo senza sapere se è netto o lordo. Il dato sta nello
 * snapshot per riga, quindi si espone da lì e non da un testo libero che
 * qualcuno potrebbe dimenticare di scrivere.
 *
 * Con una sola aliquota si scrive la riga classica imponibile, IVA, totale. Con
 * aliquote diverse si dettaglia per aliquota, perché sommarle darebbe un numero
 * che non corrisponde a nessuna delle due.
 */
function drawVatSummary(layout: Layout, snapshot: OfferSnapshot) {
  const lines = snapshot.lines ?? [];
  if (lines.length === 0) return;

  const imponibile = Number(snapshot.version.offered_total);
  const aliquote = [...new Set(lines.map((l) => Number(l.vat_rate)))].sort((a, b) => a - b);

  layout.spacer(4);

  if (aliquote.length === 1) {
    const aliquota = aliquote[0];
    const iva = Math.round(imponibile * aliquota) / 100;
    layout.line(
      `Imponibile ${formatCurrency(imponibile)}, IVA ${formatPercentage(aliquota)} ${formatCurrency(iva)}, totale ${formatCurrency(imponibile + iva)}`,
      { size: 9.5, font: layout.fontRegular, color: COLOR_GRAY, gap: 4 },
    );
    return;
  }

  // Più aliquote: il totale offerto è quello che il cliente accetta, e la
  // ripartizione dell'imponibile fra aliquote diverse dipende da come si
  // applica lo sconto complessivo. Si dichiara quello che è certo, senza
  // inventare una ripartizione che nessuno ha deciso.
  layout.line(
    `Importi al netto di IVA, con aliquote ${aliquote.map((a) => formatPercentage(a)).join(' e ')} secondo le voci sopra.`,
    { size: 9.5, font: layout.fontRegular, color: COLOR_GRAY, gap: 4 },
  );
}

// -----------------------------------------------------------------------------
// Corpo del documento: intestazione, cliente, righe, piano, condizioni, validità
// -----------------------------------------------------------------------------

function renderOfferContent(layout: Layout, snapshot: OfferSnapshot, options: GenerateOfferPdfOptions) {
  layout.line('LARIN', { size: 20, font: layout.fontBold, gap: 6 });
  layout.line(`Offerta ${snapshot.offer.reference} - Versione ${snapshot.version.version_number}`, {
    size: 13,
    font: layout.fontBold,
    gap: 3,
  });
  layout.line(`Documento congelato il ${formatDateTimeIt(options.frozenAt)}`, {
    size: 9,
    color: COLOR_GRAY,
    gap: 10,
  });
  layout.divider();
  layout.spacer(4);

  layout.line('Cliente', { size: 11, font: layout.fontBold, gap: 4 });
  layout.line(snapshot.client.name, { size: 11, gap: snapshot.client.email ? 2 : 10 });
  if (snapshot.client.email) {
    layout.line(snapshot.client.email, { size: 9, color: COLOR_GRAY, gap: 10 });
  }

  drawLinesSection(layout, snapshot);

  if (snapshot.payment_plan.length > 0) {
    layout.spacer(6);
    layout.line('Piano di pagamento', { size: 12, font: layout.fontBold, gap: 8 });
    for (const item of snapshot.payment_plan) {
      layout.paragraph(`• ${paymentPlanSentence(item)}`, { size: 10, gap: 6 });
    }
  }

  layout.spacer(6);
  layout.line('Condizioni generali', { size: 12, font: layout.fontBold, gap: 8 });
  const generalTerms = snapshot.terms.general?.trim();
  layout.paragraph(generalTerms || 'Nessuna condizione generale registrata.', { size: 9.5, gap: 6 });

  if (snapshot.terms.specific.length > 0) {
    layout.spacer(6);
    layout.line('Condizioni specifiche', { size: 12, font: layout.fontBold, gap: 8 });
    for (const spec of snapshot.terms.specific) {
      layout.line(spec.product_name, { size: 10, font: layout.fontBold, gap: 3 });
      layout.paragraph(spec.text, { size: 9.5, gap: 8 });
    }
  }

  if (snapshot.version.valid_until) {
    layout.spacer(6);
    layout.line(`Validità: offerta valida fino al ${formatDateIt(snapshot.version.valid_until)}.`, {
      size: 9.5,
      font: layout.fontBold,
    });
  }
}

function drawFooters(doc: PDFDocument, font: PDFFont, documentHash: string) {
  const pages = doc.getPages();
  const total = pages.length;
  const shortHash = formatHashForDisplay(documentHash.slice(0, 16));
  pages.forEach((page, idx) => {
    page.drawText(`Pagina ${idx + 1} di ${total}`, {
      x: MARGIN,
      y: 24,
      size: 8,
      font,
      color: COLOR_GRAY,
    });
    const hashLabel = `Documento verificabile, hash ${shortHash}`;
    const w = font.widthOfTextAtSize(hashLabel, 8);
    page.drawText(hashLabel, {
      x: PAGE_WIDTH - MARGIN - w,
      y: 24,
      size: 8,
      font,
      color: COLOR_GRAY,
    });
  });
}

/** Genera il PDF non firmato dell'offerta, dallo snapshot congelato. */
export async function generateOfferPdf(snapshot: OfferSnapshot, options: GenerateOfferPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const layout = new Layout(doc, fontRegular, fontBold);
  layout.newPage();

  renderOfferContent(layout, snapshot, options);

  // I piè di pagina si disegnano per ultimi, quando il numero totale di
  // pagine è definitivo: pdf-lib non permette di "ripulire" una pagina già
  // disegnata, quindi vanno scritti una sola volta a documento completo.
  drawFooters(doc, fontRegular, options.documentHash);

  return doc.save();
}

/**
 * Genera il PDF firmato: stesso contenuto di generateOfferPdf più una pagina
 * finale di certificazione in stile SignRequest. Ricostruita da zero (non a
 * partire dai byte già salvati) in un solo passaggio, così i piè di pagina si
 * scrivono una volta sola con il conteggio pagine corretto, compresa quella
 * di certificazione.
 */
export async function generateSignedOfferPdf(
  snapshot: OfferSnapshot,
  options: GenerateOfferPdfOptions,
  cert: SignatureCertificateOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const layout = new Layout(doc, fontRegular, fontBold);
  layout.newPage();

  renderOfferContent(layout, snapshot, options);

  layout.newPage();
  layout.line('Certificato di firma', { size: 18, font: fontBold, gap: 12 });

  // Il certificato dimostra COSA è stato firmato (l'hash del documento),
  // non solo quando: è il punto che lo distingue da un semplice timestamp.
  layout.paragraph(
    "Questo certificato attesta che il documento a cui è allegato è stato firmato elettronicamente dalla persona indicata di seguito. L'impronta digitale (hash SHA-256) riportata in fondo identifica in modo univoco il contenuto esatto del documento firmato: chi la verifica dimostra che cosa è stato firmato, non soltanto quando.",
    { size: 10, gap: 14 },
  );

  const field = (label: string, value: string) => {
    layout.line(label, { size: 9, font: fontBold, color: COLOR_GRAY, gap: 2 });
    layout.paragraph(value, { size: 11, gap: 12 });
  };

  field('Nominativo', cert.signerName);
  if (cert.signerRole) field('Ruolo', cert.signerRole);
  if (cert.signerEmail) field('Email', cert.signerEmail);
  field('Firmato il', formatDateTimeIt(cert.signedAt));
  field('Indirizzo IP', cert.clientIp);
  field('User agent', cert.userAgent || 'non rilevato');
  field('Hash del documento firmato (SHA-256)', formatHashForDisplay(options.documentHash));

  layout.line('Firma', { size: 9, font: fontBold, color: COLOR_GRAY, gap: 6 });

  // L'immagine viene validata prima di essere accettata, ma se per qualunque
  // ragione risultasse illeggibile qui, il certificato deve uscire lo stesso:
  // la prova sta nell'hash e nei dati registrati, non nel disegno. Far fallire
  // tutto il PDF lascerebbe l'offerta accettata e senza documento, che è il
  // guasto peggiore fra i due.
  let pngImage: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try {
    pngImage = await doc.embedPng(cert.signaturePngBytes);
  } catch (error) {
    console.error('immagine della firma illeggibile, certificato senza tratto', error);
  }

  if (pngImage) {
    const maxWidth = 220;
    const maxHeight = 90;
    const scale = Math.min(maxWidth / pngImage.width, maxHeight / pngImage.height, 1);
    const imgWidth = pngImage.width * scale;
    const imgHeight = pngImage.height * scale;
    const padding = 10;

    layout.ensureSpace(imgHeight + padding * 2 + 6);
    const boxY = layout.y - imgHeight - padding * 2;
    layout.page.drawRectangle({
      x: MARGIN,
      y: boxY,
      width: imgWidth + padding * 2,
      height: imgHeight + padding * 2,
      borderColor: COLOR_LINE,
      borderWidth: 1,
    });
    layout.page.drawImage(pngImage, {
      x: MARGIN + padding,
      y: boxY + padding,
      width: imgWidth,
      height: imgHeight,
    });
    layout.y = boxY - 10;
  } else {
    layout.paragraph(
      "Il tratto della firma non è disponibile in forma grafica. La firma resta provata dai dati riportati sopra e dall'impronta del documento.",
      { size: 9.5, gap: 6 },
    );
  }

  drawFooters(doc, fontRegular, options.documentHash);

  return doc.save();
}
