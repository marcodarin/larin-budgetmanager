import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { addDays, endOfMonth, format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Download, Printer, CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
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

/**
 * Gli importi si scrivono come in Italia (1.234,56 €), non come nel PDF di un
 * gestionale americano: il cliente legge un documento commerciale, e "€1234.56"
 * lo fa sembrare una schermata di debug. È anche la forma che usa il PDF, e le
 * due cose devono coincidere.
 */
const formattatoreEuro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  // Senza 'always' l'italiano non raggruppa i numeri di quattro cifre, e nella
  // stessa tabella si leggerebbe "3500,00 €" accanto a "12.250,00 €". Il PDF
  // raggruppa sempre: due documenti che mostrano gli stessi numeri in due modi
  // diversi fanno dubitare di entrambi.
  useGrouping: 'always',
});

function formatCurrency(value: number): string {
  return formattatoreEuro.format(Number(value));
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
        // Il messaggio del database dice "ricaricare la pagina prima di
        // firmare", ma la pagina si ricarica da sola qui sotto: al cliente
        // chiederebbe una cosa già fatta. Meglio dirgli cosa è successo e cosa
        // guardare adesso.
        if (response.status === 409) {
          toast.error("L'offerta è stata aggiornata nel frattempo: controlla i nuovi importi e firma di nuovo.");
          sigRef.current?.clear();
          setHasSignature(false);
        } else {
          toast.error(result?.error || 'Non è stato possibile registrare la risposta.');
        }
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

  // Lo spinner a tutta pagina vale solo per il primo caricamento. Se il
  // documento è già a schermo e lo stiamo rileggendo (succede dopo un conflitto,
  // quando l'offerta è cambiata mentre il cliente firmava), sostituire l'intera
  // pagina smonterebbe il canvas e cancellerebbe la firma appena disegnata,
  // lasciando però il pulsante abilitato: il cliente ripreme convinto di aver
  // firmato e si sente dire di firmare. Proprio nel momento più delicato.
  if (loadState === 'loading' && !data) {
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
    <div className="min-h-screen bg-[#F5F4F1] font-sans text-[#21282A] antialiased">
      {/* Barra di marca: il cliente sta leggendo un documento di Larin, non una
          schermata del gestionale. Da qui in giù la pagina non usa il tema
          dell'applicazione interna. */}
      <header className="border-b border-[#E2E1DC] print:border-none">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <LarinMark />
          <div className="flex gap-2 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-full border border-[#D6D5CF] px-4 py-2 text-[13px] transition-colors hover:border-[#4E5758] hover:bg-white"
            >
              <Printer className="h-3.5 w-3.5" />
              Stampa
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              className="inline-flex items-center gap-2 rounded-full border border-[#D6D5CF] px-4 py-2 text-[13px] transition-colors hover:border-[#4E5758] hover:bg-white disabled:opacity-50"
            >
              {pdfLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Scarica PDF
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        {/* Apertura: l'etichetta minuta e il riferimento grande e leggero sono
            il ritmo tipografico delle presentazioni Larin. */}
        <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 pt-12 pb-10">
          <Etichetta>Offerta commerciale</Etichetta>
          <h1 className="mt-3 text-[2.5rem] font-light leading-[1.05] tracking-tight md:text-[3.25rem]">
            Offerta <span className="font-medium">{doc.offer.reference}</span>
            <span className="ml-3 align-middle text-base font-normal text-[#8A9092]">v{doc.version.version_number}</span>
          </h1>
          <p className="mt-4 text-lg text-[#4E5758]">{doc.client.name}</p>

          {validUntilDate && daysLeft !== null && (
            <p className="mt-6 flex items-center gap-3 text-sm text-[#6B7274]">
              <span
                aria-hidden
                className={`inline-block h-[3px] w-10 ${daysLeft <= 0 ? 'bg-[#C1502E]' : 'bg-[#F7DB45]'}`}
              />
              {daysLeft <= 0
                ? `Validità scaduta il ${format(validUntilDate, 'dd MMMM yyyy', { locale: it })}`
                : `Offerta valida fino al ${format(validUntilDate, 'dd MMMM yyyy', { locale: it })}`}
            </p>
          )}
        </section>

        {/* Conferma della decisione appena presa in questa sessione */}
        {decisionResult && (
          <section className="animate-in fade-in slide-in-from-bottom-2 mb-10 border-l-2 border-[#F7DB45] bg-white px-6 py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {decisionResult.decision === 'accettata'
                  ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#4E5758]" />
                  : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#8A9092]" />}
                <div>
                  <p className="font-medium">
                    {decisionResult.decision === 'accettata' ? 'Offerta accettata e firmata' : 'Offerta rifiutata'}
                  </p>
                  <p className="mt-1 text-sm text-[#6B7274]">
                    {decisionResult.decision === 'accettata'
                      ? `Grazie ${signerName.trim()}, abbiamo registrato la tua firma. Riceverai anche una copia via email.`
                      : 'Abbiamo registrato la tua risposta. Il tuo referente ne sarà informato.'}
                  </p>
                </div>
              </div>
              {decisionResult.pdfUrl && (
                <button
                  type="button"
                  onClick={() => window.open(decisionResult.pdfUrl!, '_blank', 'noopener,noreferrer')}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#21282A] px-5 py-2.5 text-[13px] text-white transition-opacity hover:opacity-90 print:hidden"
                >
                  <Download className="h-3.5 w-3.5" />
                  {/* Su un rifiuto non esiste nessuna firma, e promettere un
                      "PDF firmato" fa temere al cliente di aver accettato per
                      sbaglio proprio mentre stava dicendo di no. */}
                  {decisionResult.decision === 'accettata' ? 'Scarica il PDF firmato' : "Scarica il PDF dell'offerta"}
                </button>
              )}
            </div>
          </section>
        )}

        {/* Decisione già registrata in una sessione precedente */}
        {!decisionResult && data.signature && (
          <section className="mb-10 border-l-2 border-[#D6D5CF] bg-white px-6 py-5">
            <div className="flex items-start gap-3">
              {data.signature.decision === 'accettata'
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#4E5758]" />
                : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#8A9092]" />}
              <div>
                <p className="font-medium">
                  {data.signature.decision === 'accettata' ? 'Offerta accettata e firmata' : 'Offerta rifiutata'}
                </p>
                <p className="mt-1 text-sm text-[#6B7274]">
                  {data.signature.signer_name}
                  {data.signature.signer_role ? ` (${data.signature.signer_role})` : ''}
                  {`, il ${format(parseISO(data.signature.signed_at), "dd/MM/yyyy 'alle' HH:mm", { locale: it })}`}
                </p>
              </div>
            </div>
          </section>
        )}

        {!effectiveSignable && !decisionResult && !data.signature && data.not_signable_reason && (
          <section className="mb-10 flex items-start gap-3 border-l-2 border-[#D6D5CF] bg-white px-6 py-5">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#8A9092]" />
            <p className="text-sm text-[#4E5758]">{data.not_signable_reason}</p>
          </section>
        )}

        {/* Il documento: un foglio bianco che galleggia sul fondo caldo, con le
            sezioni separate da aria e filetti invece che da riquadri. */}
        <article className="animate-in fade-in slide-in-from-bottom-2 duration-700 bg-white px-6 py-10 shadow-[0_1px_2px_rgba(33,40,42,0.04),0_8px_32px_-16px_rgba(33,40,42,0.12)] md:px-12">
          <Sezione titolo="Composizione dell'offerta">
            {lines.length === 0 ? (
              <p className="text-sm text-[#8A9092]">Nessuna riga in questa offerta.</p>
            ) : showLinePrices ? (
              <>
                {/* Sul telefono la tabella a sei colonne non ci sta: sconto, IVA
                    e totale di riga finivano fuori schermo dentro uno scroll
                    orizzontale che nessun cliente scopre. Su schermo stretto
                    ogni riga diventa una scheda, che si legge anche stampata. */}
                <div className="divide-y divide-[#EFEEE9] sm:hidden">
                  {lines.map((line, idx) => (
                    <div key={idx} className="py-4 first:pt-0">
                      <p className="font-medium leading-snug">{line.description}</p>
                      <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-[#8A9092]">Quantità</dt>
                          <dd className="tabular-nums">{line.quantity}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-[#8A9092]">Prezzo unitario</dt>
                          <dd className="tabular-nums">{formatCurrency(line.unit_list_price)}</dd>
                        </div>
                        {Number(line.discount_percentage) > 0 && (
                          <div className="flex justify-between">
                            <dt className="text-[#8A9092]">Sconto</dt>
                            <dd className="tabular-nums">{formatPercent(line.discount_percentage)}</dd>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <dt className="text-[#8A9092]">IVA</dt>
                          <dd className="tabular-nums">{formatPercent(line.vat_rate)}</dd>
                        </div>
                        <div className="flex justify-between border-t border-[#EFEEE9] pt-1.5 font-medium">
                          <dt>Totale</dt>
                          <dd className="tabular-nums">{formatCurrency(line.line_total)}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>

                <table className="hidden w-full text-sm sm:table">
                  <thead>
                    <tr className="border-b border-[#E2E1DC] text-left">
                      <th className="pb-3 pr-4 text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">Descrizione</th>
                      <th className="pb-3 px-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">Qtà</th>
                      <th className="pb-3 px-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">Prezzo</th>
                      <th className="pb-3 px-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">Sconto</th>
                      <th className="pb-3 px-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">IVA</th>
                      <th className="pb-3 pl-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">Totale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F0EC]">
                    {lines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="py-4 pr-4 leading-snug">{line.description}</td>
                        <td className="py-4 px-3 text-right tabular-nums">{line.quantity}</td>
                        <td className="py-4 px-3 text-right tabular-nums">{formatCurrency(line.unit_list_price)}</td>
                        <td className="py-4 px-3 text-right tabular-nums text-[#8A9092]">
                          {Number(line.discount_percentage) > 0 ? formatPercent(line.discount_percentage) : '–'}
                        </td>
                        <td className="py-4 px-3 text-right tabular-nums text-[#8A9092]">{formatPercent(line.vat_rate)}</td>
                        <td className="py-4 pl-3 text-right font-medium tabular-nums">{formatCurrency(line.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totale di listino e sconto effettivo restano fuori: sono
                    numeri nostri, servono alle soglie di approvazione e alla
                    statistica interna. Dirli al cliente sposta la trattativa
                    sullo sconto invece che sul valore, e il PDF che firma non
                    li riporta: le due cose devono coincidere. */}
                <Totale valore={doc.version.offered_total} />
              </>
            ) : (
              <>
                {/* Prezzo unico omnicomprensivo: si elencano le voci comprese,
                    senza i prezzi di riga che non sommerebbero al totale. */}
                <ul className="space-y-3">
                  {lines.map((line, idx) => (
                    <li key={idx} className="flex gap-3 leading-snug">
                      <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#4E5758]" />
                      <span>{line.description}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm text-[#8A9092]">Prezzo complessivo per l'intero pacchetto descritto sopra.</p>
                <Totale valore={doc.version.offered_total} />
              </>
            )}
          </Sezione>

          {paymentPlan.length > 0 && (
            <Sezione titolo="Piano di pagamento">
              {/* Il marchio di Larin sono tre punti connessi: le tranche sono
                  letteralmente punti su una linea, quindi il piano di pagamento
                  si legge come una sequenza e non come un elenco. Il primo
                  punto è pieno, perché è quello che viene per primo. */}
              <ol className="relative space-y-6 pl-8">
                <span aria-hidden className="absolute left-[5px] top-2 bottom-2 w-px bg-[#E2E1DC]" />
                {paymentPlan.map((entry, idx) => (
                  <li key={idx} className="relative leading-relaxed">
                    <span
                      aria-hidden
                      className={`absolute -left-8 top-[7px] h-[11px] w-[11px] rounded-full border-2 ${
                        idx === 0 ? 'border-[#4E5758] bg-[#4E5758]' : 'border-[#B9BDBE] bg-white'
                      }`}
                    />
                    {describeTranche(entry)}
                  </li>
                ))}
              </ol>
            </Sezione>
          )}

          {doc.version.payment_terms_text && (
            <Sezione titolo="Note di pagamento">
              <p className="whitespace-pre-line leading-relaxed">{doc.version.payment_terms_text}</p>
            </Sezione>
          )}

          {hasTerms && (
            <Sezione titolo="Condizioni">
              {doc.terms.general.trim() && (
                <p className="whitespace-pre-line leading-relaxed text-[#4E5758]">{doc.terms.general}</p>
              )}
              {doc.terms.specific.length > 0 && (
                <div className="mt-6 space-y-5">
                  {doc.terms.specific.map((t, idx) => (
                    <div key={idx}>
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">{t.product_name}</p>
                      <p className="mt-1.5 whitespace-pre-line leading-relaxed text-[#4E5758]">{t.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </Sezione>
          )}
        </article>

        {/* Accettazione e firma */}
        {effectiveSignable && (
          <section className="animate-in fade-in slide-in-from-bottom-2 duration-700 mt-10 bg-white px-6 py-10 shadow-[0_1px_2px_rgba(33,40,42,0.04),0_8px_32px_-16px_rgba(33,40,42,0.12)] md:px-12 print:hidden">
            <Etichetta>Accettazione</Etichetta>
            <h2 className="mt-3 text-2xl font-light">Accetta o rifiuta questa offerta</h2>

            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signer-name" className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">
                  Nome e cognome *
                </Label>
                <Input
                  id="signer-name"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Mario Rossi"
                  disabled={submitting !== null}
                  className="h-11 rounded-none border-0 border-b border-[#D6D5CF] bg-transparent px-0 text-base focus-visible:border-[#4E5758] focus-visible:ring-0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signer-role" className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">
                  Ruolo
                </Label>
                <Input
                  id="signer-role"
                  value={signerRole}
                  onChange={(e) => setSignerRole(e.target.value)}
                  placeholder="Es. Amministratore delegato"
                  disabled={submitting !== null}
                  className="h-11 rounded-none border-0 border-b border-[#D6D5CF] bg-transparent px-0 text-base focus-visible:border-[#4E5758] focus-visible:ring-0"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="signer-email" className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">
                  Email
                </Label>
                <Input
                  id="signer-email"
                  type="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                  placeholder="mario.rossi@azienda.it"
                  disabled={submitting !== null}
                  className="h-11 rounded-none border-0 border-b border-[#D6D5CF] bg-transparent px-0 text-base focus-visible:border-[#4E5758] focus-visible:ring-0"
                />
              </div>
            </div>

            <div className="mt-8 space-y-2">
              <Label htmlFor="firma-cliente" className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A9092]">
                Firma *
              </Label>
              <SignaturePad
                id="firma-cliente"
                ref={sigRef}
                disabled={submitting !== null}
                onStrokeEnd={() => setHasSignature(true)}
              />
              <button
                type="button"
                onClick={() => { sigRef.current?.clear(); setHasSignature(false); }}
                disabled={submitting !== null}
                className="text-[13px] text-[#8A9092] underline underline-offset-4 transition-colors hover:text-[#21282A] disabled:opacity-50"
              >
                Cancella firma
              </button>
            </div>

            <div className="mt-8 flex items-start gap-3">
              <Checkbox
                id="accept-terms"
                checked={acceptChecked}
                onCheckedChange={(checked) => setAcceptChecked(checked === true)}
                disabled={submitting !== null}
                className="mt-0.5"
              />
              <Label htmlFor="accept-terms" className="text-sm font-normal leading-snug text-[#4E5758]">
                Dichiaro di aver letto e accettato le condizioni generali e specifiche riportate sopra.
              </Label>
            </div>

            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleRejectClick}
                disabled={submitting !== null}
                className="rounded-full border border-[#D6D5CF] px-6 py-3 text-sm text-[#6B7274] transition-colors hover:border-[#C1502E] hover:text-[#C1502E] disabled:opacity-50"
              >
                Rifiuta l'offerta
              </button>
              <button
                type="button"
                onClick={handleAcceptClick}
                disabled={submitting !== null || !signerName.trim() || !acceptChecked || !hasSignature}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#21282A] px-8 py-3 text-sm text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting === 'accept' && <Loader2 className="h-4 w-4 animate-spin" />}
                Accetta e firma
              </button>
            </div>
          </section>
        )}

        <footer className="mt-12 flex items-center justify-between gap-4 text-[11px] text-[#8A9092]">
          <span>Documento generato da Larin. Per domande contatta il tuo referente.</span>
          <span aria-hidden className="hidden shrink-0 items-center gap-1 sm:flex">
            <span className="h-1 w-1 rounded-full bg-[#C9CCCD]" />
            <span className="h-px w-4 bg-[#E2E1DC]" />
            <span className="h-1.5 w-1.5 rounded-full bg-[#B9BDBE]" />
            <span className="h-px w-4 bg-[#E2E1DC]" />
            <span className="h-1 w-1 rounded-full bg-[#C9CCCD]" />
          </span>
        </footer>
      </main>

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
              className="bg-[#21282A] text-white hover:bg-[#21282A]/90"
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

/**
 * Il marchio: un anello sottile con tre punti in colonna, piccolo grande
 * piccolo. Disegnato in SVG e non caricato come immagine, così resta nitido a
 * ogni dimensione, si stampa bene e non aggiunge una richiesta di rete a una
 * pagina che il cliente aprirà spesso da rete mobile.
 */
const LarinMark = () => (
  <div className="flex items-center gap-3">
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden className="shrink-0">
      <circle cx="15" cy="15" r="13" fill="none" stroke="#4E5758" strokeWidth="1.7" />
      <circle cx="15" cy="9.4" r="1.55" fill="#4E5758" />
      <circle cx="15" cy="15" r="2.5" fill="#4E5758" />
      <circle cx="15" cy="20.6" r="1.55" fill="#4E5758" />
    </svg>
    <div className="leading-none">
      <p className="text-[15px] font-semibold tracking-[0.22em] text-[#4E5758]">LARIN</p>
      {/* Il payoff sparisce sotto i 380px: andrebbe a capo spezzato in due
          righe, che è peggio del non averlo. */}
      <p className="mt-1 hidden whitespace-nowrap text-[8px] font-medium tracking-[0.28em] text-[#A6ABAC] min-[380px]:block">
        CONNECT THE DOTS
      </p>
    </div>
  </div>
);

/** Etichetta minuta in maiuscolo: il ritmo tipografico delle presentazioni. */
const Etichetta = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8A9092]">{children}</p>
);

/** Sezione del documento: separata da aria e da un filetto, non da un riquadro. */
const Sezione = ({ titolo, children }: { titolo: string; children: React.ReactNode }) => (
  <section className="border-t border-[#E2E1DC] pt-8 first:border-t-0 first:pt-0 [&+section]:mt-10">
    <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8A9092]">{titolo}</h2>
    <div className="mt-5">{children}</div>
  </section>
);

/** Il totale è l'unico numero che il cliente deve ricordare: sta da solo. */
const Totale = ({ valore }: { valore: number }) => (
  <div className="mt-8 flex items-baseline justify-between border-t border-[#21282A] pt-4">
    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8A9092]">Totale offerto</span>
    <span className="text-2xl font-medium tabular-nums">{formatCurrency(valore)}</span>
  </div>
);

/**
 * Schermata unica per tutti gli esiti che non mostrano il documento (revocato,
 * scaduto, non trovato, documento assente, o un errore di rete): un cliente che
 * vede una pagina bianca o un errore tecnico è il modo più efficace di perdere
 * una vendita, quindi ognuno ha un messaggio in italiano che dice cosa fare,
 * più un modo per riprovare. Anche qui il marchio, perché il cliente deve
 * capire da chi arriva il link anche quando il link non funziona.
 */
const OutcomeScreen = ({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) => (
  <div className="flex min-h-screen flex-col bg-[#F5F4F1] font-sans text-[#21282A] antialiased">
    <header className="border-b border-[#E2E1DC]">
      <div className="mx-auto flex max-w-3xl px-6 py-5">
        <LarinMark />
      </div>
    </header>
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <span aria-hidden className="mb-6 block h-[3px] w-10 bg-[#F7DB45]" />
        <h1 className="text-2xl font-light">{title}</h1>
        <p className="mt-3 leading-relaxed text-[#6B7274]">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-8 inline-flex items-center gap-2 rounded-full border border-[#D6D5CF] px-5 py-2.5 text-[13px] transition-colors hover:border-[#4E5758] hover:bg-white"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Riprova
        </button>
      </div>
    </main>
  </div>
);

export default PublicOffer;
