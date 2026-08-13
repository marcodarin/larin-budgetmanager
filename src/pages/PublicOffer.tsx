import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { addDays, endOfMonth, format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  FileText, Building2, Download, Printer, CheckCircle2, XCircle,
  AlertCircle, Loader2, RefreshCw, CalendarClock,
} from 'lucide-react';
import { SignaturePad, type SignaturePadHandle } from '@/components/offers/SignaturePad';

// La pagina pubblica non usa mai il client Supabase autenticato (il cliente
// non ha un account): parla solo con la edge function `offer-public`, con
// verify_jwt = false. URL costruito dalle stesse env del client interno,
// così in locale punta allo stesso progetto di staging senza duplicare la
// configurazione.
const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

interface OfferLineSnapshot {
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

type MaturityEvent = 'firma' | 'consegna' | 'pubblicazione_fase' | 'data_calendario' | 'ricorrente';
type PaymentTermDueBasis = 'data_documento' | 'fine_mese';
type BillingMode = 'importo_finito' | 'ricorrente' | 'a_giornate' | 'tetto_di_spesa';

interface PaymentPlanEntrySnapshot {
  amount: number | null;
  percentage: number | null;
  maturity_event: MaturityEvent;
  scheduled_date: string | null;
  phase_label: string | null;
  payment_term_label: string;
  payment_term_days: number | null;
  payment_term_due_basis: PaymentTermDueBasis | null;
}

interface OfferDocumentSnapshot {
  schema_version: number;
  offer: { id: string; year: number; number: number; reference: string; origin: string };
  client: { id: string; name: string; email: string | null };
  version: {
    id: string;
    version_number: number;
    billing_mode: BillingMode;
    list_total: number;
    offered_total: number;
    effective_discount_percentage: number;
    payment_terms_text: string | null;
    valid_until: string | null;
  };
  lines: OfferLineSnapshot[];
  payment_plan: PaymentPlanEntrySnapshot[];
  terms: {
    general: string;
    specific: { product_name: string; text: string }[];
  };
}

type ResolveOutcome = 'ok' | 'revocato' | 'scaduto' | 'non_trovato' | 'documento_assente';

interface ExistingSignature {
  decision: 'accettata' | 'rifiutata';
  signer_name: string;
  signer_role: string | null;
  signed_at: string;
}

interface ResolveResult {
  outcome: ResolveOutcome;
  offer_version_id?: string;
  status?: string;
  signable?: boolean;
  not_signable_reason?: string | null;
  document_hash?: string;
  has_pdf?: boolean;
  pdf_path?: string | null;
  document?: OfferDocumentSnapshot;
  signature?: ExistingSignature | null;
}

interface DecisionResult {
  decision: 'accettata' | 'rifiutata';
  pdfUrl: string | null;
}

const billingModeLabels: Record<BillingMode, string> = {
  importo_finito: 'Importo finito',
  ricorrente: 'Ricorrente',
  a_giornate: 'A giornate',
  tetto_di_spesa: 'Tetto di spesa',
};

const dueBasisLabels: Record<PaymentTermDueBasis, string> = {
  data_documento: 'data documento',
  fine_mese: 'fine mese',
};

// Messaggi per ogni esito diverso da "ok": la pagina deve sempre dire al
// cliente cosa fare, mai mostrare uno schermo bianco o un errore tecnico.
const outcomeMessages: Record<Exclude<ResolveOutcome, 'ok'>, { title: string; message: string }> = {
  non_trovato: {
    title: 'Link non valido',
    message: 'Non abbiamo trovato nessuna offerta associata a questo indirizzo. Controlla di averlo copiato per intero, oppure chiedi a chi te lo ha inviato un link aggiornato.',
  },
  revocato: {
    title: 'Link non più attivo',
    message: 'Questo link è stato disattivato e non è più raggiungibile. Contatta il tuo referente per ricevere un link aggiornato.',
  },
  scaduto: {
    title: 'Link scaduto',
    message: 'Questo link non è più valido perché è scaduto. Contatta il tuo referente per ricevere un link aggiornato.',
  },
  documento_assente: {
    title: 'Documento non ancora disponibile',
    message: 'Il documento di questa offerta non è ancora pronto. Riprova tra qualche minuto o contatta il tuo referente: verificheremo la situazione.',
  },
};

function formatCurrency(value: number): string {
  return `€${Number(value).toFixed(2)}`;
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(2)}%`;
}

function maturityEventText(entry: PaymentPlanEntrySnapshot): string {
  switch (entry.maturity_event) {
    case 'firma': return 'alla firma';
    case 'consegna': return 'alla consegna';
    case 'pubblicazione_fase': return `alla pubblicazione della fase "${entry.phase_label ?? ''}"`;
    case 'data_calendario':
      return entry.scheduled_date
        ? `il ${format(parseISO(entry.scheduled_date), 'dd/MM/yyyy', { locale: it })}`
        : 'a una data da definire';
    case 'ricorrente': return 'con cadenza ricorrente';
    default: return '';
  }
}

// Traduce una tranche in una frase leggibile ("50% alla firma, pagamento a 30
// giorni data documento") invece che nei campi grezzi del record: è così che
// deve leggersi un piano di pagamento per chi non lavora nel gestionale.
function describeTranche(entry: PaymentPlanEntrySnapshot): string {
  const value = entry.amount != null ? formatCurrency(Number(entry.amount)) : formatPercent(Number(entry.percentage));
  const eventText = maturityEventText(entry);

  let termText = '';
  if (entry.payment_term_days != null) {
    const basis = dueBasisLabels[entry.payment_term_due_basis ?? 'data_documento'];
    termText = `, pagamento a ${entry.payment_term_days} giorni ${basis}`;
  } else if (entry.payment_term_label) {
    termText = `, ${entry.payment_term_label.toLowerCase()}`;
  }

  // Solo per "a data calendario" la scadenza effettiva è calcolabile subito:
  // per "alla firma"/"alla consegna"/"pubblicazione fase" l'evento che fa
  // partire il conteggio dei giorni non è ancora accaduto.
  let dueText = '';
  if (entry.maturity_event === 'data_calendario' && entry.scheduled_date && entry.payment_term_days != null) {
    const base = entry.payment_term_due_basis === 'fine_mese'
      ? endOfMonth(parseISO(entry.scheduled_date))
      : parseISO(entry.scheduled_date);
    const due = addDays(base, entry.payment_term_days);
    dueText = ` (scadenza ${format(due, 'dd/MM/yyyy', { locale: it })})`;
  }

  return `${value} ${eventText}${termText}${dueText}.`;
}

function validityBadgeClass(daysLeft: number): string {
  if (daysLeft <= 0) return 'bg-destructive/10 text-destructive border-destructive/30';
  if (daysLeft <= 7) return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30 dark:text-yellow-400';
  return 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400';
}

const PublicOffer = () => {
  const { token } = useParams<{ token: string }>();

  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<ResolveResult | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [acceptChecked, setAcceptChecked] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  const [submitting, setSubmitting] = useState<'accept' | 'reject' | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [decisionResult, setDecisionResult] = useState<DecisionResult | null>(null);

  const loadDocument = async () => {
    if (!token) {
      setLoadState('error');
      setLoadError('Il link non contiene un codice valido.');
      return;
    }
    setLoadState('loading');
    try {
      const response = await fetch(`${FUNCTIONS_BASE}/offer-public?token=${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) {
        throw new Error(result?.error || 'Il server non ha risposto correttamente.');
      }
      setData(result as ResolveResult);
      setLoadState('loaded');
    } catch (err) {
      console.error('Error loading public offer:', err);
      setLoadError(err instanceof Error ? err.message : 'Errore di caricamento.');
      setLoadState('error');
    }
  };

  useEffect(() => {
    loadDocument();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (data?.outcome === 'ok' && data.document) {
      document.title = `Offerta ${data.document.offer.reference} · Larin`;
    }
  }, [data]);

  const handleDownloadPdf = async () => {
    if (!token) return;
    setPdfLoading(true);
    try {
      const response = await fetch(`${FUNCTIONS_BASE}/offer-public?token=${encodeURIComponent(token)}&pdf=1`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.url) {
        throw new Error(result?.error || 'Non è stato possibile generare il PDF.');
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('Error downloading offer pdf:', err);
      toast.error(err instanceof Error ? err.message : 'Non è stato possibile generare il PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  const submitDecision = async (action: 'accept' | 'reject') => {
    if (!token || !data?.document_hash) return;
    setSubmitting(action);
    try {
      const body: Record<string, unknown> = {
        token,
        action,
        document_hash: data.document_hash,
        signer_name: signerName.trim(),
        signer_role: signerRole.trim() || undefined,
        signer_email: signerEmail.trim() || undefined,
      };
      if (action === 'accept') {
        body.signature_png = sigRef.current?.toDataURL() ?? undefined;
      } else {
        body.reject_reason = rejectReason.trim() || undefined;
      }

      const response = await fetch(`${FUNCTIONS_BASE}/offer-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        // Il caso più delicato è il documento cambiato nel frattempo (il
        // cliente teneva la pagina aperta mentre l'offerta veniva rivista):
        // qui non basta il messaggio, va anche ricaricato il documento,
        // perché l'hash e il contenuto mostrati non sono più quelli veri.
        toast.error(result?.error || 'Non è stato possibile registrare la risposta.');
        await loadDocument();
        return;
      }

      setDecisionResult({
        decision: action === 'accept' ? 'accettata' : 'rifiutata',
        pdfUrl: result?.pdf_url ?? null,
      });
      toast.success(action === 'accept' ? 'Offerta accettata e firmata.' : 'La tua risposta è stata registrata.');
    } catch (err) {
      console.error('Error submitting offer decision:', err);
      toast.error('Errore di rete: la risposta non è stata inviata. Riprova.');
    } finally {
      setSubmitting(null);
    }
  };

  const handleAcceptClick = () => {
    if (!signerName.trim()) {
      toast.error('Inserisci il tuo nome e cognome.');
      return;
    }
    if (!acceptChecked) {
      toast.error('Devi accettare le condizioni per poter firmare.');
      return;
    }
    if (sigRef.current?.isEmpty()) {
      toast.error('Disegna la firma prima di accettare.');
      return;
    }
    submitDecision('accept');
  };

  const handleRejectClick = () => {
    if (!signerName.trim()) {
      toast.error('Inserisci il tuo nome e cognome prima di rifiutare.');
      return;
    }
    setRejectDialogOpen(true);
  };

  const handleRejectConfirm = async () => {
    await submitDecision('reject');
    setRejectDialogOpen(false);
  };

  // --- Stati che non mostrano il documento -----------------------------

  if (loadState === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadState === 'error' || !data) {
    return (
      <OutcomeScreen
        title="Impossibile caricare l'offerta"
        message={loadError || 'Si è verificato un problema imprevisto. Riprova tra qualche istante o contatta il tuo referente.'}
        onRetry={loadDocument}
      />
    );
  }

  if (data.outcome !== 'ok' || !data.document) {
    const cfg = outcomeMessages[data.outcome === 'ok' ? 'documento_assente' : data.outcome];
    return <OutcomeScreen title={cfg.title} message={cfg.message} onRetry={loadDocument} />;
  }

  // --- Documento -----------------------------------------------------

  const doc = data.document;
  const lines = doc.lines ?? [];
  const paymentPlan = doc.payment_plan ?? [];

  // Regola commerciale (non un bug): se la somma dei totali di riga non
  // torna sul totale offerto (oltre un centesimo per riga di tolleranza per
  // arrotondamenti), significa che lo sconto o il prezzo sono stati decisi
  // in blocco sul totale e non riga per riga (prezzo unico omnicomprensivo).
  // Mostrare comunque i prezzi di riga esporrebbe numeri che non sommano: si
  // mostra quindi solo il perimetro (cosa è incluso) e il totale finale.
  const sumLineTotal = lines.reduce((sum, l) => sum + Number(l.line_total), 0);
  const tolerance = lines.length * 0.01;
  const showLinePrices = lines.length > 0 && Math.abs(sumLineTotal - Number(doc.version.offered_total)) <= tolerance;

  const hasTerms = doc.terms.general.trim().length > 0 || doc.terms.specific.length > 0;
  const effectiveSignable = data.signable && !decisionResult && !data.signature;

  const validUntilDate = doc.version.valid_until ? parseISO(doc.version.valid_until) : null;
  const daysLeft = validUntilDate ? Math.ceil((validUntilDate.getTime() - Date.now()) / 86400000) : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        {/* Intestazione */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <FileText className="h-7 w-7 text-primary" />
              <h1 className="text-2xl font-bold md:text-3xl">Offerta {doc.offer.reference}</h1>
              <Badge variant="outline">v{doc.version.version_number}</Badge>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>{doc.client.name}</span>
            </div>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Stampa
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={pdfLoading}>
              {pdfLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Scarica PDF
            </Button>
          </div>
        </div>

        {validUntilDate && daysLeft !== null && (
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${validityBadgeClass(daysLeft)}`}>
            <CalendarClock className="h-3 w-3" />
            {daysLeft <= 0
              ? `Validità scaduta il ${format(validUntilDate, 'dd/MM/yyyy', { locale: it })}`
              : `Offerta valida fino al ${format(validUntilDate, 'dd/MM/yyyy', { locale: it })}`}
          </div>
        )}

        {/* Conferma della decisione appena presa in questa sessione */}
        {decisionResult && (
          <Card variant="static" className="border-primary/40">
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                {decisionResult.decision === 'accettata'
                  ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-600" />
                  : <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" />}
                <div>
                  <p className="font-semibold">
                    {decisionResult.decision === 'accettata' ? 'Offerta accettata e firmata' : 'Offerta rifiutata'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {decisionResult.decision === 'accettata'
                      ? `Grazie ${signerName.trim()}, abbiamo registrato la tua firma. Riceverai anche una copia via email.`
                      : 'Abbiamo registrato la tua risposta. Il tuo referente ne sarà informato.'}
                  </p>
                </div>
              </div>
              {decisionResult.pdfUrl && (
                <Button size="sm" onClick={() => window.open(decisionResult.pdfUrl!, '_blank', 'noopener,noreferrer')} className="print:hidden">
                  <Download className="mr-2 h-4 w-4" />
                  Scarica il PDF firmato
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Decisione già registrata in una sessione precedente */}
        {!decisionResult && data.signature && (
          <Card variant="static">
            <CardContent className="flex items-start gap-3 pt-6">
              {data.signature.decision === 'accettata'
                ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-green-600" />
                : <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" />}
              <div>
                <p className="font-semibold">
                  {data.signature.decision === 'accettata' ? 'Offerta accettata e firmata' : 'Offerta rifiutata'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data.signature.signer_name}
                  {data.signature.signer_role ? ` (${data.signature.signer_role})` : ''}, il{' '}
                  {format(new Date(data.signature.signed_at), "dd/MM/yyyy 'alle' HH:mm", { locale: it })}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Motivo per cui l'offerta non è (più) firmabile, quando non c'è già una firma da mostrare */}
        {!decisionResult && !data.signature && !data.signable && data.not_signable_reason && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Non firmabile</AlertTitle>
            <AlertDescription>{data.not_signable_reason}</AlertDescription>
          </Alert>
        )}

        {/* Composizione dell'offerta */}
        <Card variant="static">
          <CardHeader>
            <CardTitle>Composizione dell'offerta</CardTitle>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nessuna riga in questa offerta.</p>
            ) : showLinePrices ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Descrizione</TableHead>
                        <TableHead className="text-right">Quantità</TableHead>
                        <TableHead className="text-right">Prezzo unitario</TableHead>
                        <TableHead className="text-right">Sconto</TableHead>
                        <TableHead className="text-right">IVA</TableHead>
                        <TableHead className="text-right">Totale</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{line.description}</TableCell>
                          <TableCell className="text-right">{line.quantity}</TableCell>
                          <TableCell className="text-right">{formatCurrency(line.unit_list_price)}</TableCell>
                          <TableCell className="text-right">{formatPercent(line.discount_percentage)}</TableCell>
                          <TableCell className="text-right">{formatPercent(line.vat_rate)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(line.line_total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-4 space-y-1.5 border-t pt-4">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Totale di listino</span>
                    <span>{formatCurrency(doc.version.list_total)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Sconto applicato</span>
                    <span>{doc.version.effective_discount_percentage.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold">
                    <span>Totale offerto</span>
                    <span>{formatCurrency(doc.version.offered_total)}</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Prezzo unico omnicomprensivo: niente prezzi di riga, solo
                    il perimetro (vedi commento sopra sulla regola). */}
                <ul className="list-disc space-y-1.5 pl-5 text-sm">
                  {lines.map((line, idx) => (
                    <li key={idx}>{line.description}</li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">Prezzo complessivo per l'intero pacchetto descritto sopra.</p>
                <div className="mt-4 flex justify-between border-t pt-4 text-lg font-bold">
                  <span>Totale offerto</span>
                  <span>{formatCurrency(doc.version.offered_total)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Piano di pagamento */}
        <Card variant="static">
          <CardHeader>
            <CardTitle>Piano di pagamento</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Modalità di fatturazione: {billingModeLabels[doc.version.billing_mode]}
            </p>
            {paymentPlan.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Il pagamento non è suddiviso in tranche.</p>
            ) : (
              <ol className="space-y-2">
                {paymentPlan.map((entry, idx) => (
                  <li key={idx} className="flex gap-2 text-sm">
                    <span className="font-semibold text-muted-foreground">{idx + 1}.</span>
                    <span>{describeTranche(entry)}</span>
                  </li>
                ))}
              </ol>
            )}
            {doc.version.payment_terms_text && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{doc.version.payment_terms_text}</p>
            )}
          </CardContent>
        </Card>

        {/* Condizioni */}
        {hasTerms && (
          <Card variant="static">
            <CardHeader>
              <CardTitle>Condizioni generali e specifiche</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {doc.terms.general.trim().length > 0 && (
                <p className="whitespace-pre-wrap">{doc.terms.general}</p>
              )}
              {doc.terms.specific.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  {doc.terms.specific.map((t, idx) => (
                    <p key={idx}>
                      <span className="font-medium">{t.product_name}: </span>
                      <span className="whitespace-pre-wrap text-muted-foreground">{t.text}</span>
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Accettazione / rifiuto */}
        {effectiveSignable && (
          <Card variant="static" className="print:hidden">
            <CardHeader>
              <CardTitle>Accetta o rifiuta questa offerta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="signer-name">Nome e cognome *</Label>
                  <Input
                    id="signer-name"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Mario Rossi"
                    disabled={submitting !== null}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signer-role">Ruolo</Label>
                  <Input
                    id="signer-role"
                    value={signerRole}
                    onChange={(e) => setSignerRole(e.target.value)}
                    placeholder="Es. Amministratore delegato"
                    disabled={submitting !== null}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="signer-email">Email</Label>
                  <Input
                    id="signer-email"
                    type="email"
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                    placeholder="mario.rossi@azienda.it"
                    disabled={submitting !== null}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Firma</Label>
                <SignaturePad
                  ref={sigRef}
                  disabled={submitting !== null}
                  onStrokeEnd={() => setHasSignature(true)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { sigRef.current?.clear(); setHasSignature(false); }}
                  disabled={submitting !== null}
                >
                  Cancella firma
                </Button>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="accept-terms"
                  checked={acceptChecked}
                  onCheckedChange={(checked) => setAcceptChecked(checked === true)}
                  disabled={submitting !== null}
                  className="mt-0.5"
                />
                <Label htmlFor="accept-terms" className="text-sm font-normal leading-snug">
                  Dichiaro di aver letto e accettato le condizioni generali e specifiche riportate sopra.
                </Label>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={handleRejectClick}
                  disabled={submitting !== null}
                >
                  Rifiuta l'offerta
                </Button>
                <Button
                  type="button"
                  onClick={handleAcceptClick}
                  disabled={submitting !== null || !signerName.trim() || !acceptChecked || !hasSignature}
                >
                  {submitting === 'accept' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Accetta e firma
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Documento generato automaticamente da Larin. Per domande contatta il tuo referente.
        </p>
      </div>

      {/* Conferma di rifiuto: un click involontario non deve poter annullare
          una risposta al cliente, quindi passa sempre da qui. */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={(open) => { if (submitting === null) setRejectDialogOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confermi il rifiuto dell'offerta?</AlertDialogTitle>
            <AlertDialogDescription>
              Questa risposta verrà registrata e comunicata al tuo referente. Puoi indicare facoltativamente il motivo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Motivo del rifiuto (facoltativo)"
            disabled={submitting !== null}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting !== null}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleRejectConfirm(); }}
              disabled={submitting !== null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {submitting === 'reject' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Conferma rifiuto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// Schermata unica per tutti gli esiti che non mostrano il documento
// (revocato, scaduto, non trovato, documento assente, o un errore di rete):
// un cliente che vede una pagina bianca o un errore tecnico è il modo più
// efficace di perdere una vendita, quindi ognuno ha un messaggio in italiano
// che dice cosa fare, più un modo per riprovare.
const OutcomeScreen = ({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) => (
  <div className="min-h-screen bg-background flex items-center justify-center p-4">
    <Card variant="static" className="w-full max-w-md">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <div>
            <h2 className="mb-2 text-xl font-semibold">{title}</h2>
            <p className="text-muted-foreground">{message}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Riprova
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
);

export default PublicOffer;
