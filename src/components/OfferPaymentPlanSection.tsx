import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, endOfMonth, format, parseISO } from 'date-fns';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CalendarIcon, CheckCircle2, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Constants, type Database } from '@/integrations/supabase/types';

type OfferPaymentTermRow = Database['public']['Tables']['offer_payment_terms']['Row'];
type PaymentTermRow = Database['public']['Tables']['payment_terms']['Row'];
type MaturityEvent = Database['public']['Enums']['offer_payment_term_maturity_event'];
type BillingMode = Database['public']['Enums']['offer_billing_mode'];

const maturityEventLabels: Record<MaturityEvent, string> = {
  firma: 'Alla firma',
  consegna: 'Alla consegna',
  pubblicazione_fase: 'Alla pubblicazione di una fase',
  data_calendario: 'A una data',
  ricorrente: 'Ricorrente',
};

const billingModeLabels: Record<BillingMode, string> = {
  importo_finito: 'Importo finito',
  ricorrente: 'Ricorrente',
  a_giornate: 'A giornate',
  tetto_di_spesa: 'Tetto di spesa',
};

type ValueType = 'amount' | 'percentage';

interface TrancheDraft {
  valueType: ValueType;
  amount: string;
  percentage: string;
  payment_term_id: string;
  maturity_event: MaturityEvent;
  scheduled_date: string; // 'yyyy-MM-dd' oppure ''
  phase_label: string;
}

const buildEmptyDraft = (defaultTermId: string): TrancheDraft => ({
  valueType: 'percentage',
  amount: '',
  percentage: '',
  payment_term_id: defaultTermId,
  maturity_event: 'firma',
  scheduled_date: '',
  phase_label: '',
});

// Replica in TypeScript della stessa formula di public.compute_payment_term_due_date
// (migration 20260813140000): solo per l'anteprima immediata in UI mentre si
// compila una tranche o si guarda l'elenco, senza un round-trip per riga. Il
// valore autorevole ai fini di fatturazione resta quello calcolato dalla
// funzione lato database.
function computeDueDatePreview(term: PaymentTermRow, documentDate: Date): Date | null {
  if (term.days == null || !term.due_basis) return null;
  const base = term.due_basis === 'fine_mese' ? endOfMonth(documentDate) : documentDate;
  return addDays(base, term.days);
}

interface OfferPaymentPlanSectionProps {
  offerVersionId: string;
  offeredTotal: number;
  billingMode: BillingMode;
  canManage: boolean;
  isBozza: boolean;
  onBillingModeChange: () => void;
}

export const OfferPaymentPlanSection = ({
  offerVersionId,
  offeredTotal,
  billingMode,
  canManage,
  isBozza,
  onBillingModeChange,
}: OfferPaymentPlanSectionProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Le tranche (come le righe) si modificano solo in bozza; la maturazione
  // invece resta possibile sempre (vedi guard_offer_payment_term_maturity_update,
  // che non è condizionata dallo stato della versione).
  const canEditPlan = canManage && isBozza;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TrancheDraft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isChangingBillingMode, setIsChangingBillingMode] = useState(false);
  const [markingMaturedId, setMarkingMaturedId] = useState<string | null>(null);

  const { data: tranches = [], isLoading: isLoadingTranches, refetch: refetchTranches } = useQuery({
    queryKey: ['offer-payment-terms', offerVersionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_payment_terms')
        .select('*')
        .eq('offer_version_id', offerVersionId)
        .order('display_order');
      if (error) throw error;
      return data as OfferPaymentTermRow[];
    },
    enabled: !!offerVersionId,
  });

  const { data: paymentTerms = [] } = useQuery({
    queryKey: ['payment-terms-for-offers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payment_terms').select('*').order('display_order');
      if (error) throw error;
      return data as PaymentTermRow[];
    },
  });

  const paymentTermsById = useMemo(() => new Map(paymentTerms.map((t) => [t.id, t])), [paymentTerms]);

  // Solo i termini con "days" impostato sanno calcolare una scadenza: sono gli
  // unici selezionabili su una tranche nuova (vedi trigger
  // guard_offer_payment_term_selectable, migration 20260813140000).
  const selectableTerms = useMemo(
    () => paymentTerms.filter((t) => t.is_active && t.days !== null),
    [paymentTerms]
  );

  // Se si sta modificando una tranche il cui termine non è (più) selezionabile
  // (disattivato nel frattempo), lo si include comunque nell'elenco per non
  // farlo sparire dalla select e cambiarlo a sua insaputa.
  const termsForDialog = useMemo(() => {
    if (!draft) return selectableTerms;
    if (selectableTerms.some((t) => t.id === draft.payment_term_id)) return selectableTerms;
    const current = paymentTermsById.get(draft.payment_term_id);
    return current ? [...selectableTerms, current] : selectableTerms;
  }, [selectableTerms, draft, paymentTermsById]);

  const dueDateByTrancheId = useMemo(() => {
    const map = new Map<string, Date | null>();
    for (const t of tranches) {
      if (t.maturity_event === 'data_calendario' && t.scheduled_date) {
        const term = paymentTermsById.get(t.payment_term_id);
        map.set(t.id, term ? computeDueDatePreview(term, parseISO(t.scheduled_date)) : null);
      }
    }
    return map;
  }, [tranches, paymentTermsById]);

  // Quadratura per importo finito: stessa logica di
  // public.validate_offer_payment_terms_balance (migration 20260813140000).
  // Usa il totale offerto "live" (non ancora salvato) per anticipare l'esito,
  // non solo quello persistito: è una guida, non la validazione autorevole.
  const balance = useMemo(() => {
    const count = tranches.length;
    const sum = tranches.reduce((acc, t) => {
      const value = t.amount != null
        ? Number(t.amount)
        : Math.round((offeredTotal * Number(t.percentage ?? 0)) / 100 * 100) / 100;
      return acc + value;
    }, 0);
    const tolerance = Math.round((offeredTotal * (count * 0.01)) / 100 * 100) / 100;
    const diff = Math.round((sum - offeredTotal) * 100) / 100;
    const withinTolerance = Math.abs(diff) <= tolerance;
    return { count, sum, tolerance, diff, withinTolerance };
  }, [tranches, offeredTotal]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleBillingModeChange = async (value: string) => {
    if (value === billingMode) return;
    setIsChangingBillingMode(true);
    try {
      const { error } = await supabase
        .from('offer_versions')
        .update({ billing_mode: value as BillingMode })
        .eq('id', offerVersionId);
      if (error) throw error;
      toast({
        title: 'Modo di fatturazione aggiornato',
        description: `Ora è "${billingModeLabels[value as BillingMode]}".`,
      });
      onBillingModeChange();
    } catch (error) {
      console.error('Error updating billing mode:', error);
      toast({ title: 'Errore', description: 'Errore durante l\'aggiornamento del modo di fatturazione.', variant: 'destructive' });
    } finally {
      setIsChangingBillingMode(false);
    }
  };

  const openAddDialog = () => {
    if (selectableTerms.length === 0) {
      toast({
        title: 'Nessun termine disponibile',
        description: 'Configura almeno un termine di pagamento con giorni di dilazione in Impostazioni prima di aggiungere una tranche.',
        variant: 'destructive',
      });
      return;
    }
    setEditingId(null);
    setDraft(buildEmptyDraft(selectableTerms[0].id));
    setDialogOpen(true);
  };

  const openEditDialog = (t: OfferPaymentTermRow) => {
    setEditingId(t.id);
    setDraft({
      valueType: t.amount != null ? 'amount' : 'percentage',
      amount: t.amount != null ? String(t.amount) : '',
      percentage: t.percentage != null ? String(t.percentage) : '',
      payment_term_id: t.payment_term_id,
      maturity_event: t.maturity_event,
      scheduled_date: t.scheduled_date ?? '',
      phase_label: t.phase_label ?? '',
    });
    setDialogOpen(true);
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setDraft(null);
      setEditingId(null);
    }
  };

  const validateDraft = (d: TrancheDraft): string | null => {
    if (d.valueType === 'amount') {
      const amt = Number(d.amount);
      if (!d.amount || !(amt > 0)) return 'Inserisci un importo maggiore di zero.';
    } else {
      const pct = Number(d.percentage);
      if (!d.percentage || !(pct > 0) || pct > 100) return 'Inserisci una percentuale tra 0 e 100.';
    }
    if (!d.payment_term_id) return 'Seleziona un termine di pagamento.';
    if (d.maturity_event === 'data_calendario' && !d.scheduled_date) return 'Seleziona la data di maturazione.';
    if (d.maturity_event === 'pubblicazione_fase' && !d.phase_label.trim()) return 'Indica il nome della fase.';
    return null;
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    const validationError = validateDraft(draft);
    if (validationError) {
      toast({ title: 'Dati incompleti', description: validationError, variant: 'destructive' });
      return;
    }

    setIsSavingDraft(true);
    try {
      const payload = {
        amount: draft.valueType === 'amount' ? Math.round(Number(draft.amount) * 100) / 100 : null,
        percentage: draft.valueType === 'percentage' ? Number(draft.percentage) : null,
        payment_term_id: draft.payment_term_id,
        maturity_event: draft.maturity_event,
        scheduled_date: draft.maturity_event === 'data_calendario' ? draft.scheduled_date : null,
        phase_label: draft.maturity_event === 'pubblicazione_fase' ? draft.phase_label.trim() : null,
      };

      if (editingId) {
        const { error } = await supabase.from('offer_payment_terms').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const maxOrder = tranches.reduce((max, t) => Math.max(max, t.display_order), 0);
        const { error } = await supabase
          .from('offer_payment_terms')
          .insert({ ...payload, offer_version_id: offerVersionId, display_order: maxOrder + 1 });
        if (error) throw error;
      }

      toast({
        title: editingId ? 'Tranche aggiornata' : 'Tranche aggiunta',
        description: 'Il piano di pagamento è stato aggiornato.',
      });
      closeDialog(false);
      refetchTranches();
    } catch (error) {
      console.error('Error saving payment term tranche:', error);
      toast({ title: 'Errore', description: 'Errore durante il salvataggio della tranche.', variant: 'destructive' });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Sei sicuro di voler rimuovere questa tranche?')) return;
    const { error } = await supabase.from('offer_payment_terms').delete().eq('id', id);
    if (error) {
      console.error('Error removing payment term tranche:', error);
      toast({ title: 'Errore', description: 'Errore durante la rimozione della tranche.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Tranche rimossa', description: 'La tranche è stata rimossa dal piano di pagamento.' });
    refetchTranches();
  };

  const handleMarkMatured = async (id: string) => {
    setMarkingMaturedId(id);
    try {
      const { error } = await supabase.rpc('mark_offer_payment_term_matured', { _offer_payment_term_id: id });
      if (error) throw error;
      toast({ title: 'Tranche maturata', description: 'La maturazione è stata registrata.' });
      refetchTranches();
    } catch (error) {
      console.error('Error marking payment term as matured:', error);
      toast({ title: 'Errore', description: 'Errore durante la registrazione della maturazione.', variant: 'destructive' });
    } finally {
      setMarkingMaturedId(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tranches.findIndex((t) => t.id === active.id);
    const newIndex = tranches.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(tranches, oldIndex, newIndex).map((t, i) => ({ ...t, display_order: i + 1 }));

    // Aggiornamento ottimistico locale, poi persistenza dell'ordine.
    queryClient.setQueryData(['offer-payment-terms', offerVersionId], reordered);

    try {
      await Promise.all(
        reordered.map((t) => supabase.from('offer_payment_terms').update({ display_order: t.display_order }).eq('id', t.id))
      );
    } catch (error) {
      console.error('Error reordering payment term tranches:', error);
      toast({ title: 'Errore', description: 'Errore durante il riordinamento delle tranche.', variant: 'destructive' });
    } finally {
      refetchTranches();
    }
  };

  const applyShortcut = async (shortcut: 'firma100' | 'fiftyFifty' | 'thirtyFortyThirty') => {
    if (selectableTerms.length === 0) {
      toast({
        title: 'Nessun termine disponibile',
        description: 'Configura almeno un termine di pagamento con giorni di dilazione in Impostazioni prima di usare uno schema rapido.',
        variant: 'destructive',
      });
      return;
    }

    const defaultTermId = selectableTerms[0].id;
    const rows: Array<{ percentage: number; maturity_event: MaturityEvent; phase_label?: string }> =
      shortcut === 'firma100'
        ? [{ percentage: 100, maturity_event: 'firma' }]
        : shortcut === 'fiftyFifty'
          ? [
              { percentage: 50, maturity_event: 'firma' },
              { percentage: 50, maturity_event: 'consegna' },
            ]
          : [
              { percentage: 30, maturity_event: 'firma' },
              { percentage: 40, maturity_event: 'pubblicazione_fase', phase_label: 'Avanzamento lavori' },
              { percentage: 30, maturity_event: 'consegna' },
            ];

    const payload = rows.map((r, i) => ({
      offer_version_id: offerVersionId,
      payment_term_id: defaultTermId,
      display_order: i + 1,
      amount: null,
      percentage: r.percentage,
      maturity_event: r.maturity_event,
      scheduled_date: null,
      phase_label: r.phase_label ?? null,
    }));

    try {
      const { error } = await supabase.from('offer_payment_terms').insert(payload);
      if (error) throw error;
      toast({ title: 'Schema applicato', description: 'Puoi modificare ogni tranche prima di inviare l\'offerta.' });
      refetchTranches();
    } catch (error) {
      console.error('Error applying payment plan shortcut:', error);
      toast({ title: 'Errore', description: 'Errore durante la creazione delle tranche.', variant: 'destructive' });
    }
  };

  const coveragePct = offeredTotal > 0 ? (balance.sum / offeredTotal) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <CardTitle>Piano di pagamento</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Modo di fatturazione</Label>
            <Select
              value={billingMode}
              onValueChange={handleBillingModeChange}
              disabled={!canEditPlan || isChangingBillingMode}
            >
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Constants.public.Enums.offer_billing_mode.map((mode) => (
                  <SelectItem key={mode} value={mode}>{billingModeLabels[mode]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {billingMode === 'importo_finito' ? (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Quadratura del piano</span>
              {balance.count > 0 && (
                <Badge variant={balance.withinTolerance ? 'green' : 'destructive'}>
                  {balance.withinTolerance ? 'Quadra' : 'Non quadra'}
                </Badge>
              )}
            </div>
            {balance.count === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nessuna tranche configurata: il piano di pagamento non è obbligatorio, l'offerta può comunque uscire dalla bozza.
              </p>
            ) : (
              <>
                <Progress
                  value={Math.min(100, Math.max(0, coveragePct))}
                  indicatorClassName={
                    balance.withinTolerance ? 'bg-green-500' : balance.diff < 0 ? 'bg-amber-500' : 'bg-red-500'
                  }
                />
                <div className="flex justify-between items-center text-sm flex-wrap gap-1">
                  <span className="text-muted-foreground">
                    Coperto: €{balance.sum.toFixed(2)} di €{offeredTotal.toFixed(2)}
                  </span>
                  <span className={balance.withinTolerance ? 'text-green-600 font-medium' : 'text-destructive font-medium'}>
                    {balance.withinTolerance
                      ? 'Quadra con il totale offerto'
                      : balance.diff < 0
                        ? `Mancano €${Math.abs(balance.diff).toFixed(2)}`
                        : `Eccedono €${balance.diff.toFixed(2)}`}
                  </span>
                </div>
                {!balance.withinTolerance && (
                  <p className="text-xs text-muted-foreground">
                    La tolleranza ammessa per {balance.count} {balance.count === 1 ? 'tranche' : 'tranche'} è di €{balance.tolerance.toFixed(2)}: sotto la soglia l'offerta può uscire dalla bozza, sopra viene rifiutata.
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Modo di fatturazione "{billingModeLabels[billingMode]}": il piano di pagamento non richiede quadratura su un totale fisso (si applica solo a "Importo finito").
            </p>
          </div>
        )}

        {canEditPlan && tranches.length === 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Schemi rapidi:</span>
            <Button variant="outline" size="sm" onClick={() => applyShortcut('firma100')}>100% alla firma</Button>
            <Button variant="outline" size="sm" onClick={() => applyShortcut('fiftyFifty')}>50% e 50%</Button>
            <Button variant="outline" size="sm" onClick={() => applyShortcut('thirtyFortyThirty')}>30/40/30</Button>
          </div>
        )}

        {isLoadingTranches ? (
          <div className="animate-pulse h-20 bg-muted rounded"></div>
        ) : tranches.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nessuna tranche in questo piano di pagamento</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Importo / percentuale</TableHead>
                  <TableHead>Evento di maturazione</TableHead>
                  <TableHead>Termine</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <SortableContext items={tranches.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <TableBody>
                  {tranches.map((t) => (
                    <SortableTrancheRow
                      key={t.id}
                      tranche={t}
                      term={paymentTermsById.get(t.payment_term_id)}
                      dueDate={dueDateByTrancheId.get(t.id) ?? null}
                      canEditPlan={canEditPlan}
                      canMarkMatured={canManage}
                      isMarking={markingMaturedId === t.id}
                      onEdit={() => openEditDialog(t)}
                      onDelete={() => handleDelete(t.id)}
                      onMarkMatured={() => handleMarkMatured(t.id)}
                    />
                  ))}
                </TableBody>
              </SortableContext>
            </Table>
          </DndContext>
        )}

        {canEditPlan && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={openAddDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Aggiungi tranche
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Modifica tranche' : 'Aggiungi tranche'}</DialogTitle>
            <DialogDescription>
              Specifica importo o percentuale, l'evento che la fa maturare e il termine di pagamento per calcolare la scadenza.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Importo o percentuale</Label>
                <ToggleGroup
                  type="single"
                  value={draft.valueType}
                  onValueChange={(v) => { if (v) setDraft({ ...draft, valueType: v as ValueType }); }}
                  className="justify-start"
                >
                  <ToggleGroupItem value="percentage" aria-label="Percentuale">Percentuale (%)</ToggleGroupItem>
                  <ToggleGroupItem value="amount" aria-label="Importo">Importo (€)</ToggleGroupItem>
                </ToggleGroup>
                {draft.valueType === 'percentage' ? (
                  <Input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={draft.percentage}
                    onChange={(e) => setDraft({ ...draft, percentage: e.target.value })}
                    placeholder="Es. 33.33"
                  />
                ) : (
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    placeholder="Es. 5000.00"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label>Evento di maturazione</Label>
                <Select value={draft.maturity_event} onValueChange={(v) => setDraft({ ...draft, maturity_event: v as MaturityEvent })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Constants.public.Enums.offer_payment_term_maturity_event.map((ev) => (
                      <SelectItem key={ev} value={ev}>{maturityEventLabels[ev]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {draft.maturity_event === 'data_calendario' && (
                <div className="space-y-2">
                  <Label>Data di maturazione</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn('w-full justify-start text-left font-normal', !draft.scheduled_date && 'text-muted-foreground')}
                      >
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        {draft.scheduled_date ? format(parseISO(draft.scheduled_date), 'dd/MM/yyyy') : 'Seleziona una data'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={draft.scheduled_date ? parseISO(draft.scheduled_date) : undefined}
                        onSelect={(date) => setDraft({ ...draft, scheduled_date: date ? format(date, 'yyyy-MM-dd') : '' })}
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {draft.maturity_event === 'pubblicazione_fase' && (
                <div className="space-y-2">
                  <Label>Nome della fase</Label>
                  <Input
                    value={draft.phase_label}
                    onChange={(e) => setDraft({ ...draft, phase_label: e.target.value })}
                    placeholder="Es. Avanzamento lavori"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Termine di pagamento</Label>
                <Select value={draft.payment_term_id} onValueChange={(v) => setDraft({ ...draft, payment_term_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona termine" /></SelectTrigger>
                  <SelectContent>
                    {termsForDialog.map((term) => (
                      <SelectItem key={term.id} value={term.id}>{term.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Solo i termini con giorni di dilazione impostati possono calcolare una scadenza.</p>
              </div>

              {draft.maturity_event === 'data_calendario' && draft.scheduled_date && draft.payment_term_id && (() => {
                const term = paymentTermsById.get(draft.payment_term_id);
                const due = term ? computeDueDatePreview(term, parseISO(draft.scheduled_date)) : null;
                return (
                  <p className="text-sm text-muted-foreground">
                    Scadenza calcolata: {due ? format(due, 'dd/MM/yyyy') : '-'}
                  </p>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => closeDialog(false)}>Annulla</Button>
            <Button onClick={handleSaveDraft} disabled={isSavingDraft}>
              {isSavingDraft ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

interface SortableTrancheRowProps {
  tranche: OfferPaymentTermRow;
  term: PaymentTermRow | undefined;
  dueDate: Date | null;
  canEditPlan: boolean;
  canMarkMatured: boolean;
  isMarking: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMarkMatured: () => void;
}

const SortableTrancheRow = ({
  tranche,
  term,
  dueDate,
  canEditPlan,
  canMarkMatured,
  isMarking,
  onEdit,
  onDelete,
  onMarkMatured,
}: SortableTrancheRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tranche.id,
    disabled: !canEditPlan,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style} className={isDragging ? 'bg-muted/50' : undefined}>
      <TableCell className="w-8">
        {canEditPlan && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded touch-none"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </TableCell>
      <TableCell className="font-medium">
        {tranche.amount != null ? `€${Number(tranche.amount).toFixed(2)}` : `${Number(tranche.percentage).toFixed(2)}%`}
      </TableCell>
      <TableCell>
        {maturityEventLabels[tranche.maturity_event]}
        {tranche.maturity_event === 'pubblicazione_fase' && tranche.phase_label ? ` · ${tranche.phase_label}` : ''}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{term?.label ?? '-'}</TableCell>
      <TableCell className="text-sm">{dueDate ? format(dueDate, 'dd/MM/yyyy') : '-'}</TableCell>
      <TableCell>
        <Badge variant={tranche.maturity_status === 'maturata' ? 'green' : 'gray'}>
          {tranche.maturity_status === 'maturata' ? 'Maturata' : 'Da maturare'}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {tranche.maturity_status === 'da_maturare' && canMarkMatured && (
            <Button variant="ghost" size="sm" onClick={onMarkMatured} disabled={isMarking} title="Segna come maturata">
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          )}
          {canEditPlan && (
            <>
              <Button variant="ghost" size="sm" onClick={onEdit} title="Modifica">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete} title="Rimuovi">
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};
