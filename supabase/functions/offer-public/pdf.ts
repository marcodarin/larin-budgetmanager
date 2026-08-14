// Generatore del PDF dell'offerta, a partire dallo snapshot congelato in
// offer_version_documents.snapshot. Nessuna tabella viva viene letta qui: il
// documento è deterministico rispetto allo snapshot che riceve, così lo stesso
// contenuto produce sempre lo stesso PDF (a meno delle sole differenze di
// libreria non evitabili, es. timestamp interno del file).
//
// La veste grafica rispecchia deliberatamente src/pages/PublicOffer.tsx (la
// pagina pubblica dell'offerta): stessa palette, stesse etichette, stessa
// gerarchia tipografica e lo stesso marchio disegnato con le stesse
// proporzioni. Se la pagina pubblica cambia, questo file va aggiornato con lei.
//
// Font Manrope (pesi 300/400/500) incorporato via @pdf-lib/fontkit: copre il
// latino esteso (accenti, ceco, polacco, turco...), a differenza di Helvetica
// standard limitato a WinAnsi. Per gli alfabeti non latini (cinese, arabo...)
// resta il ripiego di sanitizeForPdf(), che toglie prima i segni diacritici e
// solo come ultima risorsa sostituisce con '?'.
// @ts-ignore: i types generati da esm.sh per questo pacchetto non dichiarano
// l'export default, ma il modulo lo espone regolarmente a runtime.
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
} from 'https://esm.sh/pdf-lib@1.17.1';
// I tre pesi di Manrope, incorporati come stringhe base64 (vedi il commento
// in fonts/manrope-regular.ts sul perché non sono file .ttf letti a runtime).
import { MANROPE_LIGHT_BASE64 } from './fonts/manrope-light.ts';
import { MANROPE_REGULAR_BASE64 } from './fonts/manrope-regular.ts';
import { MANROPE_MEDIUM_BASE64 } from './fonts/manrope-medium.ts';

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
const FOOTER_RESERVE = 40;

// -----------------------------------------------------------------------------
// Palette Larin, identica a quella di src/pages/PublicOffer.tsx
// -----------------------------------------------------------------------------

const COLOR_INK = rgb(0x21 / 255, 0x28 / 255, 0x2a / 255); // #21282A, testo principale
const COLOR_ANTRACITE = rgb(0x4e / 255, 0x57 / 255, 0x58 / 255); // #4E5758, marchio, nome cliente, condizioni
const COLOR_GRAY = rgb(0x8a / 255, 0x90 / 255, 0x92 / 255); // #8A9092, etichette
const COLOR_MUTED = rgb(0x6b / 255, 0x72 / 255, 0x74 / 255); // #6B7274, testo secondario (validità)
const COLOR_LINE = rgb(0xe2 / 255, 0xe1 / 255, 0xdc / 255); // #E2E1DC, filetti
const COLOR_LINE_FAINT = rgb(0xf1 / 255, 0xf0 / 255, 0xec / 255); // #F1F0EC, filetti chiarissimi tra le righe
const COLOR_ACCENT = rgb(0xf7 / 255, 0xdb / 255, 0x45 / 255); // #F7DB45, giallo, con parsimonia
const COLOR_DOT_BORDER = rgb(0xb9 / 255, 0xbd / 255, 0xbe / 255); // #B9BDBE, bordo dei punti non ancora "attivi"
const COLOR_PAYOFF = rgb(0xa6 / 255, 0xab / 255, 0xac / 255); // #A6ABAC, payoff sotto il marchio
const COLOR_WHITE = rgb(1, 1, 1);

// -----------------------------------------------------------------------------
// Formattazione italiana
// -----------------------------------------------------------------------------

function formatNumber(value: number, minDecimals: number, maxDecimals: number): string {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
    // Senza 'always' l'it-IT di V8 raggruppa le migliaia solo da 10.000 in su
    // (useGrouping di default è 'auto', non 'true'): nella stessa tabella si
    // leggerebbe "3500,00 €" accanto a "12.250,00 €". Stesso fix di
    // formattatoreEuro in PublicOffer.tsx, per lo stesso motivo: i due
    // documenti devono mostrare gli stessi numeri nello stesso modo.
    useGrouping: 'always',
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

/** Data (senza ora) per campi `date` come scheduled_date nel piano di pagamento. */
function formatDateIt(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Data per esteso ("12 settembre 2026"), come la usa la pagina pubblica per la
 * validità dell'offerta (date-fns 'dd MMMM yyyy'). */
function formatDateItLong(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'long',
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
// Sanificazione: Manrope copre il latino esteso ma non ogni carattere
// -----------------------------------------------------------------------------

/**
 * Copertura glifi per font incorporato via fontkit, indicizzata sul PDFFont
 * restituito da doc.embedFont(). Popolata in loadFonts().
 *
 * PDFFont.encodeText() NON è affidabile per rilevare i caratteri mancanti in
 * un font incorporato con fontkit: per i font standard (WinAnsiEncoding)
 * lancia un'eccezione sul carattere fuori codifica, ma per un font TrueType
 * incorporato risolve silenziosamente sul glifo .notdef (il quadratino vuoto)
 * invece di lanciare. Verificato: encodeText('中') con Manrope non lancia,
 * quindi il vecchio controllo try/catch lascerebbe passare caratteri che il
 * font non sa disegnare, producendo quadratini invece del ripiego in '?'. Il
 * controllo vero va fatto sul font grezzo di fontkit, con hasGlyphForCodePoint.
 */
const glyphCoverage = new WeakMap<PDFFont, (codePoint: number) => boolean>();

function hasGlyph(font: PDFFont, ch: string): boolean {
  const checker = glyphCoverage.get(font);
  if (!checker) return true; // font non censito: meglio assumere codificabile che censurare per errore
  const codePoint = ch.codePointAt(0);
  if (codePoint == null) return true;
  try {
    return checker(codePoint);
  } catch {
    return true;
  }
}

/**
 * Manrope copre il latino esteso (accenti italiani, ř ceca, ł polacca, ş turca,
 * l'Euro...), ma non è garantito coprire qualunque carattere immesso a mano
 * (es. nomi cliente in caratteri non latini). Prima di rinunciare a un
 * carattere si prova a toglierne i segni diacritici: "Přemysl" diventa
 * "Premysl", che è leggibile e riconoscibile, mentre "P?emysl" non è né
 * l'uno né l'altro.
 *
 * Per gli alfabeti non latini (cinese, arabo, cirillico...) il ripiego resta
 * il punto interrogativo: coprirli richiederebbe un font Unicode molto più
 * grande, che è la strada giusta quando servirà davvero e va deciso allora.
 */
function sanitizeForPdf(text: string, font: PDFFont): string {
  let out = '';
  let changed = false;
  for (const ch of text) {
    if (hasGlyph(font, ch)) {
      out += ch;
      continue;
    }
    changed = true;

    const senzaDiacritici = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (senzaDiacritici && senzaDiacritici !== ch && Array.from(senzaDiacritici).every((c) => hasGlyph(font, c))) {
      out += senzaDiacritici;
      continue;
    }

    out += '?';
  }
  return changed ? out : text;
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
  color: ReturnType<typeof rgb> = COLOR_INK,
) {
  const safe = sanitizeForPdf(text, font);
  const w = font.widthOfTextAtSize(safe, size);
  const drawX = align === 'right' ? x + width - w : x;
  page.drawText(safe, { x: drawX, y, size, font, color });
}

// -----------------------------------------------------------------------------
// Testo con tracking (letter-spacing): pdf-lib non lo supporta nativamente. Si
// disegna carattere per carattere avanzando la x della larghezza del glifo più
// il tracking, esattamente come le etichette maiuscole e la wordmark a
// schermo (tracking-[0.14em]/[0.18em]/[0.22em] di PublicOffer.tsx).
// -----------------------------------------------------------------------------

function trackedTextWidth(text: string, font: PDFFont, size: number, tracking: number): number {
  const chars = Array.from(text);
  if (chars.length === 0) return 0;
  let width = -tracking;
  for (const ch of chars) width += font.widthOfTextAtSize(ch, size) + tracking;
  return width;
}

function drawTrackedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  tracking: number,
): void {
  const safe = sanitizeForPdf(text, font);
  let cx = x;
  for (const ch of Array.from(safe)) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + tracking;
  }
}

function drawTrackedTextRight(
  page: PDFPage,
  text: string,
  xEnd: number,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  tracking: number,
): void {
  const safe = sanitizeForPdf(text, font);
  const w = trackedTextWidth(safe, font, size, tracking);
  drawTrackedText(page, safe, xEnd - w, y, size, font, color, tracking);
}

// -----------------------------------------------------------------------------
// Il marchio Larin: anello sottile con tre punti in colonna (piccolo, grande,
// piccolo). Stesse proporzioni dell'SVG <LarinMark> di PublicOffer.tsx
// (viewBox 30, cerchio r=13, punti r 1.55/2.5/1.55 a cy 9.4/15/20.6).
// -----------------------------------------------------------------------------

function drawLarinMark(
  page: PDFPage,
  cx: number,
  cy: number,
  radius: number,
  color: ReturnType<typeof rgb>,
  opts: { ringOnly?: boolean } = {},
): void {
  page.drawCircle({
    x: cx,
    y: cy,
    size: radius,
    borderWidth: Math.max(1, radius * 0.131),
    borderColor: color,
  });
  if (opts.ringOnly) return;
  const offset = radius * 0.431;
  const smallR = radius * 0.119;
  const bigR = radius * 0.192;
  page.drawCircle({ x: cx, y: cy + offset, size: smallR, color });
  page.drawCircle({ x: cx, y: cy, size: bigR, color });
  page.drawCircle({ x: cx, y: cy - offset, size: smallR, color });
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
 * totale. Stessa regola calcolata indipendentemente in PublicOffer.tsx.
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
  fontLight: PDFFont;
  fontRegular: PDFFont;
  fontMedium: PDFFont;
  page!: PDFPage;
  y = 0;

  constructor(doc: PDFDocument, fontLight: PDFFont, fontRegular: PDFFont, fontMedium: PDFFont) {
    this.doc = doc;
    this.fontLight = fontLight;
    this.fontRegular = fontRegular;
    this.fontMedium = fontMedium;
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
      color: opts.color ?? COLOR_INK,
    });
    this.y -= size + gap;
  }

  /** Etichetta minuta in maiuscolo con tracking ampio: il ritmo tipografico
   * delle sezioni, identico a <Etichetta> nella pagina pubblica. */
  kicker(
    text: string,
    opts: { size?: number; color?: ReturnType<typeof rgb>; tracking?: number; font?: PDFFont; gap?: number } = {},
  ) {
    const size = opts.size ?? 8.5;
    const font = opts.font ?? this.fontMedium;
    const color = opts.color ?? COLOR_GRAY;
    const tracking = opts.tracking ?? size * 0.18;
    this.ensureSpace(size + 4);
    drawTrackedText(this.page, text.toLocaleUpperCase('it-IT'), MARGIN, this.y - size, size, font, color, tracking);
    this.y -= size + (opts.gap ?? 4);
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
      this.page.drawText(l, { x, y: this.y - size, size, font, color: opts.color ?? COLOR_INK });
      this.y -= size + lineGap;
    }
    this.y -= (opts.gap ?? 4) - lineGap;
  }

  /** Come paragraph(), ma rispetta gli a capo manuali del testo (whitespace-
   * pre-line a schermo): condizioni generali/specifiche e note di pagamento
   * hanno paragrafi distinti che non vanno fusi in uno solo. */
  preservedParagraph(
    text: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; x?: number; maxWidth?: number } = {},
  ) {
    const blocks = text.split('\n');
    const size = opts.size ?? 10;
    blocks.forEach((block, i) => {
      const isLast = i === blocks.length - 1;
      if (block.trim() === '') {
        this.spacer(size * 0.5);
        return;
      }
      this.paragraph(block, { ...opts, gap: isLast ? (opts.gap ?? 6) : size * 0.45 });
    });
  }

  divider(color: ReturnType<typeof rgb> = COLOR_LINE, thickness = 0.75) {
    this.ensureSpace(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness,
      color,
    });
    this.y -= 10;
  }
}

// -----------------------------------------------------------------------------
// Apertura del documento: marchio, titolo leggero, cliente, validità. Stessa
// gerarchia della sezione di apertura di PublicOffer.tsx.
// -----------------------------------------------------------------------------

function drawBrandHeader(layout: Layout): void {
  const radius = 13;
  const topY = layout.y;
  const cy = topY - radius;
  const cx = MARGIN + radius;
  drawLarinMark(layout.page, cx, cy, radius, COLOR_ANTRACITE);

  const textX = cx + radius + 12;
  const wordSize = 13;
  const wordBaseline = cy - wordSize * 0.32;
  drawTrackedText(layout.page, 'LARIN', textX, wordBaseline, wordSize, layout.fontMedium, COLOR_ANTRACITE, wordSize * 0.22);

  const payoffSize = 6;
  const payoffBaseline = wordBaseline - 10;
  drawTrackedText(
    layout.page,
    'CONNECT THE DOTS',
    textX,
    payoffBaseline,
    payoffSize,
    layout.fontMedium,
    COLOR_PAYOFF,
    payoffSize * 0.28,
  );

  layout.y = topY - radius * 2 - 6;
}

function drawOfferHeader(layout: Layout, snapshot: OfferSnapshot, options: GenerateOfferPdfOptions): void {
  drawBrandHeader(layout);
  layout.spacer(6);
  layout.divider();
  layout.spacer(24);

  layout.kicker('Offerta commerciale');
  layout.spacer(6);

  // Titolo: "Offerta" leggero + riferimento in peso medio, come l'h1 della
  // pagina pubblica; "v{n}" piccolo e grigio accanto, sulla stessa riga.
  const titleSize = 27;
  layout.ensureSpace(titleSize + 10);
  const baseline = layout.y - titleSize;
  const prefix = sanitizeForPdf('Offerta ', layout.fontLight);
  layout.page.drawText(prefix, { x: MARGIN, y: baseline, size: titleSize, font: layout.fontLight, color: COLOR_INK });
  let cx = MARGIN + layout.fontLight.widthOfTextAtSize(prefix, titleSize);
  const reference = sanitizeForPdf(snapshot.offer.reference, layout.fontMedium);
  layout.page.drawText(reference, { x: cx, y: baseline, size: titleSize, font: layout.fontMedium, color: COLOR_INK });
  cx += layout.fontMedium.widthOfTextAtSize(reference, titleSize);
  const versionText = sanitizeForPdf(`v${snapshot.version.version_number}`, layout.fontRegular);
  layout.page.drawText(versionText, { x: cx + 8, y: baseline + 1, size: 10, font: layout.fontRegular, color: COLOR_GRAY });
  layout.y = baseline - 10;

  layout.line(`Documento congelato il ${formatDateTimeIt(options.frozenAt)}`, { size: 8.5, color: COLOR_GRAY, gap: 14 });

  // Nome cliente: stesso trattamento della pagina pubblica (antracite, corpo
  // più grande del testo normale). L'email non c'è a schermo, ma il PDF è un
  // documento legale che ne beneficia: resta, in piccolo e discreto.
  layout.line(snapshot.client.name, {
    size: 13,
    font: layout.fontRegular,
    color: COLOR_ANTRACITE,
    gap: snapshot.client.email ? 3 : 14,
  });
  if (snapshot.client.email) {
    layout.line(snapshot.client.email, { size: 9, color: COLOR_GRAY, gap: 16 });
  }

  if (snapshot.version.valid_until) {
    layout.ensureSpace(18);
    const barY = layout.y - 7;
    layout.page.drawRectangle({ x: MARGIN, y: barY, width: 40, height: 3, color: COLOR_ACCENT });
    layout.page.drawText(
      sanitizeForPdf(`Offerta valida fino al ${formatDateItLong(snapshot.version.valid_until)}`, layout.fontRegular),
      { x: MARGIN + 52, y: barY - 1, size: 10, font: layout.fontRegular, color: COLOR_MUTED },
    );
    layout.y = barY - 16;
  }

  layout.spacer(8);
  layout.divider();
  layout.spacer(24);
}

// -----------------------------------------------------------------------------
// Composizione dell'offerta: tabella o elenco a seconda del prezzo unico
// -----------------------------------------------------------------------------

const TABLE_COLS = [
  { label: 'Descrizione', width: 190, align: 'left' as const },
  { label: 'QTÀ', width: 38, align: 'right' as const },
  { label: 'Prezzo', width: 78, align: 'right' as const },
  { label: 'Sconto', width: 50, align: 'right' as const },
  { label: 'IVA', width: 42, align: 'right' as const },
  { label: 'Totale', width: 97, align: 'right' as const },
];

function tableColX(): number[] {
  const xs: number[] = [];
  let x = MARGIN;
  for (const c of TABLE_COLS) {
    xs.push(x);
    x += c.width;
  }
  return xs;
}

/** Punto pieno + testo: come i bullet <span className="rounded-full bg-[#4E5758]">
 * dell'elenco a prezzo unico omnicomprensivo, non un carattere "•". */
function drawBulletParagraph(layout: Layout, text: string): void {
  const bulletX = MARGIN + 3;
  const textX = MARGIN + 14;
  const textWidth = CONTENT_WIDTH - 14;
  const size = 10;
  const lineH = 14;
  const lines = wrapText(text, layout.fontRegular, size, textWidth);
  const rowHeight = Math.max(lines.length, 1) * lineH + 6;
  layout.ensureSpace(rowHeight);
  const topY = layout.y;
  layout.page.drawCircle({ x: bulletX, y: topY - 7, size: 1.4, color: COLOR_ANTRACITE });
  lines.forEach((l, i) => {
    layout.page.drawText(sanitizeForPdf(l, layout.fontRegular), {
      x: textX,
      y: topY - 10 - i * lineH,
      size,
      font: layout.fontRegular,
      color: COLOR_INK,
    });
  });
  layout.y -= rowHeight;
}

/** Il totale sta da solo, staccato: filetto scuro sopra a tutta larghezza,
 * come <Totale> nella pagina pubblica (border-t border-[#21282A]). */
function drawTotaleBlock(layout: Layout, total: number): void {
  layout.spacer(8);
  const valueSize = 18;
  const labelSize = 8.5;
  layout.ensureSpace(valueSize + 20);
  layout.page.drawLine({
    start: { x: MARGIN, y: layout.y },
    end: { x: PAGE_WIDTH - MARGIN, y: layout.y },
    thickness: 1,
    color: COLOR_INK,
  });
  layout.y -= 16;
  const baseline = layout.y - valueSize;
  drawTrackedText(layout.page, 'TOTALE OFFERTO', MARGIN, baseline, labelSize, layout.fontMedium, COLOR_GRAY, labelSize * 0.18);
  drawAligned(layout.page, formatCurrency(total), MARGIN, CONTENT_WIDTH, baseline, valueSize, layout.fontMedium, 'right', COLOR_INK);
  layout.y = baseline - 6;
}

/**
 * L'IVA sul documento che il cliente firma non è un dettaglio estetico: senza,
 * si firma un importo senza sapere se è netto o lordo. Requisito legale che
 * resta anche se la pagina pubblica mostra l'IVA solo per riga: qui si
 * aggiunge il riepilogo aggregato (imponibile, aliquota, totale).
 */
function drawVatSummary(layout: Layout, snapshot: OfferSnapshot): void {
  const lines = snapshot.lines ?? [];
  if (lines.length === 0) return;

  const imponibile = Number(snapshot.version.offered_total);
  const aliquote = [...new Set(lines.map((l) => Number(l.vat_rate)))].sort((a, b) => a - b);

  layout.spacer(6);

  if (aliquote.length === 1) {
    const aliquota = aliquote[0];
    const iva = Math.round(imponibile * aliquota) / 100;
    layout.line(
      `Imponibile ${formatCurrency(imponibile)}, IVA ${formatPercentage(aliquota)} ${formatCurrency(iva)}, totale ${formatCurrency(imponibile + iva)}`,
      { size: 9, font: layout.fontRegular, color: COLOR_GRAY, gap: 4 },
    );
    return;
  }

  // Più aliquote: il totale offerto è quello che il cliente accetta, e la
  // ripartizione dell'imponibile fra aliquote diverse dipende da come si
  // applica lo sconto complessivo. Si dichiara quello che è certo, senza
  // inventare una ripartizione che nessuno ha deciso.
  layout.line(
    `Importi al netto di IVA, con aliquote ${aliquote.map((a) => formatPercentage(a)).join(' e ')} secondo le voci sopra.`,
    { size: 9, font: layout.fontRegular, color: COLOR_GRAY, gap: 4 },
  );
}

function drawLinesSection(layout: Layout, snapshot: OfferSnapshot): void {
  layout.kicker("Composizione dell'offerta");
  layout.spacer(12);

  if (snapshot.lines.length === 0) {
    layout.paragraph('Nessuna riga in questa offerta.', { size: 9.5, color: COLOR_GRAY, gap: 4 });
    return;
  }

  const hidePrices = shouldHideLinePrices(snapshot);

  if (hidePrices) {
    // Prezzo unico omnicomprensivo: si elencano le voci comprese, senza i
    // prezzi di riga che non sommerebbero al totale e confonderebbero il
    // cliente invece di chiarire.
    for (const l of snapshot.lines) {
      const qtyNote = Number(l.quantity) !== 1 ? ` (x${formatQuantity(l.quantity)})` : '';
      drawBulletParagraph(layout, `${l.description}${qtyNote}`);
    }
    layout.paragraph("Prezzo complessivo per l'intero pacchetto descritto sopra.", {
      size: 9,
      color: COLOR_GRAY,
      gap: 4,
    });
    drawTotaleBlock(layout, snapshot.version.offered_total);
    drawVatSummary(layout, snapshot);
    return;
  }

  const xs = tableColX();
  const headerSize = 8.5;
  const headerTracking = headerSize * 0.14;
  layout.ensureSpace(headerSize + 18);
  TABLE_COLS.forEach((c, i) => {
    if (c.align === 'left') {
      drawTrackedText(layout.page, c.label, xs[i], layout.y - headerSize, headerSize, layout.fontMedium, COLOR_GRAY, headerTracking);
    } else {
      drawTrackedTextRight(
        layout.page,
        c.label,
        xs[i] + c.width,
        layout.y - headerSize,
        headerSize,
        layout.fontMedium,
        COLOR_GRAY,
        headerTracking,
      );
    }
  });
  layout.y -= headerSize + 8;
  layout.divider();
  layout.spacer(4);

  snapshot.lines.forEach((l, idx) => {
    const descLines = wrapText(l.description, layout.fontRegular, 9.5, TABLE_COLS[0].width - 4);
    const lineH = 13;
    const rowHeight = Math.max(descLines.length, 1) * lineH + 14;
    layout.ensureSpace(rowHeight);
    const rowTopY = layout.y;

    descLines.forEach((dl, i) => {
      layout.page.drawText(sanitizeForPdf(dl, layout.fontRegular), {
        x: xs[0],
        y: rowTopY - 11 - i * lineH,
        size: 9.5,
        font: layout.fontRegular,
        color: COLOR_INK,
      });
    });

    const cellY = rowTopY - 11;
    drawAligned(layout.page, formatQuantity(l.quantity), xs[1], TABLE_COLS[1].width, cellY, 9.5, layout.fontRegular, 'right');
    drawAligned(layout.page, formatCurrency(l.unit_list_price), xs[2], TABLE_COLS[2].width, cellY, 9.5, layout.fontRegular, 'right');
    const discountText = Number(l.discount_percentage) > 0 ? formatPercentage(l.discount_percentage) : '–';
    drawAligned(layout.page, discountText, xs[3], TABLE_COLS[3].width, cellY, 9.5, layout.fontRegular, 'right', COLOR_GRAY);
    drawAligned(layout.page, formatPercentage(l.vat_rate), xs[4], TABLE_COLS[4].width, cellY, 9.5, layout.fontRegular, 'right', COLOR_GRAY);
    drawAligned(layout.page, formatCurrency(l.line_total), xs[5], TABLE_COLS[5].width, cellY, 9.5, layout.fontMedium, 'right');

    layout.y -= rowHeight;
    // Filetto chiarissimo tra le righe (non sotto l'ultima: la chiude il
    // filetto scuro del totale, che arriverebbe troppo vicino altrimenti).
    if (idx < snapshot.lines.length - 1) {
      layout.page.drawLine({
        start: { x: MARGIN, y: layout.y },
        end: { x: PAGE_WIDTH - MARGIN, y: layout.y },
        thickness: 0.5,
        color: COLOR_LINE_FAINT,
      });
    }
  });

  drawTotaleBlock(layout, snapshot.version.offered_total);
  drawVatSummary(layout, snapshot);
}

// -----------------------------------------------------------------------------
// Piano di pagamento: il "connect the dots" del marchio, non un elenco puntato
// -----------------------------------------------------------------------------

function drawPaymentPlanSection(layout: Layout, items: OfferSnapshotPaymentPlanItem[]): void {
  if (items.length === 0) return;

  layout.divider();
  layout.spacer(24);
  layout.kicker('Piano di pagamento');
  layout.spacer(16);

  const dotX = MARGIN + 8;
  const textX = MARGIN + 24;
  const textWidth = CONTENT_WIDTH - 24;
  const dotRadius = 4;
  let prevPage: PDFPage | null = null;
  let prevDotY: number | null = null;

  items.forEach((item, idx) => {
    const sentence = paymentPlanSentence(item);
    const lines = wrapText(sentence, layout.fontRegular, 10, textWidth);
    const lineH = 14;
    const textBlockHeight = Math.max(lines.length, 1) * lineH;
    const rowHeight = textBlockHeight + 10;
    layout.ensureSpace(rowHeight + 4);
    const page = layout.page;
    const topY = layout.y;
    const dotY = topY - 9;

    // Linea sottile che collega i punti: solo fra punti sulla stessa pagina,
    // un piano di pagamento non dovrebbe comunque avere decine di tranche.
    if (prevPage === page && prevDotY !== null) {
      page.drawLine({ start: { x: dotX, y: prevDotY }, end: { x: dotX, y: dotY }, thickness: 1, color: COLOR_LINE });
    }

    const isFirst = idx === 0;
    page.drawCircle({
      x: dotX,
      y: dotY,
      size: dotRadius,
      color: isFirst ? COLOR_ANTRACITE : COLOR_WHITE,
      borderWidth: 1.4,
      borderColor: isFirst ? COLOR_ANTRACITE : COLOR_DOT_BORDER,
    });

    lines.forEach((l, i) => {
      page.drawText(sanitizeForPdf(l, layout.fontRegular), {
        x: textX,
        y: topY - 10 - i * lineH,
        size: 10,
        font: layout.fontRegular,
        color: COLOR_INK,
      });
    });

    prevPage = page;
    prevDotY = dotY;
    layout.y -= rowHeight;
  });
}

// -----------------------------------------------------------------------------
// Note di pagamento e condizioni
// -----------------------------------------------------------------------------

function drawPaymentNotesSection(layout: Layout, text: string | null): void {
  const trimmed = text?.trim();
  if (!trimmed) return;

  layout.divider();
  layout.spacer(24);
  layout.kicker('Note di pagamento');
  layout.spacer(14);
  layout.preservedParagraph(trimmed, { size: 9.5, color: COLOR_INK, gap: 6 });
}

function drawConditionsSection(layout: Layout, snapshot: OfferSnapshot): void {
  const general = snapshot.terms.general?.trim() ?? '';
  const specific = snapshot.terms.specific ?? [];
  if (!general && specific.length === 0) return;

  layout.divider();
  layout.spacer(24);
  layout.kicker('Condizioni');
  layout.spacer(14);

  if (general) {
    layout.preservedParagraph(snapshot.terms.general, { size: 9.5, color: COLOR_ANTRACITE, gap: 6 });
  }

  if (specific.length > 0) {
    if (general) layout.spacer(10);
    for (const spec of specific) {
      layout.kicker(spec.product_name, { size: 8.5, tracking: 8.5 * 0.14, gap: 5 });
      layout.preservedParagraph(spec.text, { size: 9.5, color: COLOR_ANTRACITE, gap: 12 });
    }
  }
}

// -----------------------------------------------------------------------------
// Corpo del documento: apertura, righe, piano di pagamento, note, condizioni
// -----------------------------------------------------------------------------

function renderOfferContent(layout: Layout, snapshot: OfferSnapshot, options: GenerateOfferPdfOptions) {
  drawOfferHeader(layout, snapshot, options);
  drawLinesSection(layout, snapshot);
  drawPaymentPlanSection(layout, snapshot.payment_plan ?? []);
  drawPaymentNotesSection(layout, snapshot.version.payment_terms_text);
  drawConditionsSection(layout, snapshot);
}

function drawFooters(doc: PDFDocument, font: PDFFont, documentHash: string): void {
  const pages = doc.getPages();
  const total = pages.length;
  const shortHash = formatHashForDisplay(documentHash.slice(0, 16));
  const footerY = 26;
  const labelSize = 7.5;
  const tracking = labelSize * 0.12;

  pages.forEach((page, idx) => {
    page.drawLine({
      start: { x: MARGIN, y: footerY + 14 },
      end: { x: PAGE_WIDTH - MARGIN, y: footerY + 14 },
      thickness: 0.5,
      color: COLOR_LINE,
    });
    // Marchio ridotto: solo l'anello, come richiesto per il piè di pagina.
    drawLarinMark(page, MARGIN + 5, footerY + 4, 5, COLOR_ANTRACITE, { ringOnly: true });
    drawTrackedText(page, `PAGINA ${idx + 1} DI ${total}`, MARGIN + 18, footerY, labelSize, font, COLOR_GRAY, tracking);
    const hashLabel = `DOCUMENTO VERIFICABILE, HASH ${shortHash}`;
    drawTrackedTextRight(page, hashLabel, PAGE_WIDTH - MARGIN, footerY, labelSize, font, COLOR_GRAY, tracking);
  });
}

function drawCertificateHeader(layout: Layout): void {
  const radius = 11;
  const topY = layout.y;
  const cy = topY - radius;
  const cx = MARGIN + radius;
  drawLarinMark(layout.page, cx, cy, radius, COLOR_ANTRACITE);

  const textX = cx + radius + 10;
  const titleSize = 13;
  const baseline = cy - titleSize * 0.32;
  drawTrackedText(
    layout.page,
    'CERTIFICATO DI FIRMA',
    textX,
    baseline,
    titleSize,
    layout.fontMedium,
    COLOR_ANTRACITE,
    titleSize * 0.16,
  );

  layout.y = topY - radius * 2 - 10;
  layout.spacer(6);
  layout.divider();
  layout.spacer(22);
}

// -----------------------------------------------------------------------------
// Font: Manrope (300/400/500) incorporato con fontkit, letto dalla cartella
// della function. Il subsetting riduce il PDF alle sole lettere usate:
// un'offerta breve non deve portarsi dietro l'intero alfabeto di Manrope.
// -----------------------------------------------------------------------------

/** Legge la copertura glifi del font grezzo (fontkit) e la registra nella
 * WeakMap indicizzata sul PDFFont incorporato, per il ripiego di sanitizeForPdf. */
function registerGlyphCoverage(pdfFont: PDFFont, rawBytes: Uint8Array): void {
  try {
    // deno-lint-ignore no-explicit-any
    const rawFont = (fontkit as any).create(rawBytes);
    glyphCoverage.set(pdfFont, (codePoint: number) => rawFont.hasGlyphForCodePoint(codePoint));
  } catch (error) {
    console.error('impossibile leggere la copertura glifi del font, si assume tutto codificabile', error);
  }
}

/** Base64 -> byte, stesso schema di decodeSignaturePng() in index.ts. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadFonts(doc: PDFDocument): Promise<{ light: PDFFont; regular: PDFFont; medium: PDFFont }> {
  doc.registerFontkit(fontkit);
  const lightBytes = decodeBase64(MANROPE_LIGHT_BASE64);
  const regularBytes = decodeBase64(MANROPE_REGULAR_BASE64);
  const mediumBytes = decodeBase64(MANROPE_MEDIUM_BASE64);
  const [light, regular, medium] = await Promise.all([
    doc.embedFont(lightBytes, { subset: true }),
    doc.embedFont(regularBytes, { subset: true }),
    doc.embedFont(mediumBytes, { subset: true }),
  ]);
  registerGlyphCoverage(light, lightBytes);
  registerGlyphCoverage(regular, regularBytes);
  registerGlyphCoverage(medium, mediumBytes);
  return { light, regular, medium };
}

/** Genera il PDF non firmato dell'offerta, dallo snapshot congelato. */
export async function generateOfferPdf(snapshot: OfferSnapshot, options: GenerateOfferPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await loadFonts(doc);
  const layout = new Layout(doc, fonts.light, fonts.regular, fonts.medium);
  layout.newPage();

  renderOfferContent(layout, snapshot, options);

  // I piè di pagina si disegnano per ultimi, quando il numero totale di
  // pagine è definitivo: pdf-lib non permette di "ripulire" una pagina già
  // disegnata, quindi vanno scritti una sola volta a documento completo.
  drawFooters(doc, fonts.medium, options.documentHash);

  return doc.save();
}

/**
 * Genera il PDF firmato: stesso contenuto di generateOfferPdf più una pagina
 * finale di certificazione in stile SignRequest, con la stessa veste Larin
 * (marchio, etichette maiuscole, filetti sottili). Ricostruita da zero (non a
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
  const fonts = await loadFonts(doc);
  const layout = new Layout(doc, fonts.light, fonts.regular, fonts.medium);
  layout.newPage();

  renderOfferContent(layout, snapshot, options);

  layout.newPage();
  drawCertificateHeader(layout);

  // Il certificato dimostra COSA è stato firmato (l'hash del documento),
  // non solo quando: è il punto che lo distingue da un semplice timestamp.
  layout.paragraph(
    "Questo certificato attesta che il documento a cui è allegato è stato firmato elettronicamente dalla persona indicata di seguito. L'impronta digitale (hash SHA-256) riportata in fondo identifica in modo univoco il contenuto esatto del documento firmato: chi la verifica dimostra che cosa è stato firmato, non soltanto quando.",
    { size: 10, color: COLOR_INK, gap: 18 },
  );

  const field = (label: string, value: string) => {
    layout.kicker(label, { size: 8, gap: 4 });
    layout.paragraph(value, { size: 11, color: COLOR_INK, gap: 16 });
  };

  field('Nominativo', cert.signerName);
  if (cert.signerRole) field('Ruolo', cert.signerRole);
  if (cert.signerEmail) field('Email', cert.signerEmail);
  field('Firmato il', formatDateTimeIt(cert.signedAt));
  field('Indirizzo IP', cert.clientIp);
  field('User agent', cert.userAgent || 'non rilevato');
  field('Hash del documento firmato (SHA-256)', formatHashForDisplay(options.documentHash));

  layout.kicker('Firma', { size: 8, gap: 10 });

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
    const padding = 12;

    layout.ensureSpace(imgHeight + padding * 2 + 14);
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
    // Filetto giallo sotto, come la riga di firma di un contratto di carta:
    // l'unico altro punto del documento, insieme alla validità, dove
    // compare l'accento giallo.
    layout.page.drawRectangle({
      x: MARGIN,
      y: boxY - 4,
      width: imgWidth + padding * 2,
      height: 2.5,
      color: COLOR_ACCENT,
    });
    layout.y = boxY - 18;
  } else {
    layout.paragraph(
      "Il tratto della firma non è disponibile in forma grafica. La firma resta provata dai dati riportati sopra e dall'impronta del documento.",
      { size: 9.5, color: COLOR_GRAY, gap: 6 },
    );
  }

  drawFooters(doc, fonts.medium, options.documentHash);

  return doc.save();
}
