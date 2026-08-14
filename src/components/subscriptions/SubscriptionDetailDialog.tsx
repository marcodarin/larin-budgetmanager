import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { AddSubscriptionAmountDialog } from './AddSubscriptionAmountDialog';
import { CancelSubscriptionDialog } from './CancelSubscriptionDialog';
import {
  currentAmount,
  documentKindLabels,
  periodStatusConfig,
  periodicityLabels,
  subscriptionStatusConfig,
  type SubscriptionAmountRow,
  type SubscriptionListRow,
  type SubscriptionPeriodRow,
} from './types';

interface SubscriptionDetailDialogProps {
  subscription: SubscriptionListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onChanged: () => void;
}

const fmt = (date: string | null) => (date ? format(parseISO(date), 'dd/MM/yyyy') : '-');

export const SubscriptionDetailDialog = ({
  subscription,
  open,
  onOpenChange,
  canManage,
  onChanged,
}: SubscriptionDetailDialogProps) => {
  const queryClient = useQueryClient();
  const [showAddAmount, setShowAddAmount] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const subscriptionId = subscription?.id ?? null;

  const { data: amounts = [], refetch: refetchAmounts } = useQuery({
    queryKey: ['subscription-amounts', subscriptionId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('subscription_amounts')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('valid_from', { ascending: false });
      if (error) throw error;
      return data as SubscriptionAmountRow[];
    },
    enabled: open && !!subscriptionId,
  });

  const { data: periods = [], refetch: refetchPeriods } = useQuery({
    queryKey: ['subscription-periods', subscriptionId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('subscription_periods')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('period_start', { ascending: false });
      if (error) throw error;
      return data as SubscriptionPeriodRow[];
    },
    enabled: open && !!subscriptionId,
  });

  if (!subscription) return null;

  const canone = currentAmount(amounts.length > 0 ? amounts : subscription.subscription_amounts);
  const hasNonPreliminaryPeriods = periods.some((p) => p.status !== 'previsto');

  const refreshAll = () => {
    refetchAmounts();
    refetchPeriods();
    queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
    queryClient.invalidateQueries({ queryKey: ['recurring-value-summary'] });
    queryClient.invalidateQueries({ queryKey: ['subscription-renewals'] });
    onChanged();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const { data, error } = await (supabase.from as any)('subscriptions')
        .delete()
        .eq('id', subscription.id)
        .select('id');
      if (error) throw error;
      // Le policy RLS filtrano la riga invece di dare errore: un array vuoto
      // significa che la cancellazione non è stata ammessa (ci sono già
      // periodi accodati o fatturati), non che non ci fosse nulla da fare.
      if (!data || data.length === 0) {
        toast.error('Impossibile eliminare', {
          description: 'Questo abbonamento ha già periodi accodati o fatturati: non può essere eliminato.',
        });
        return;
      }
      toast.success('Abbonamento eliminato.');
      setConfirmDelete(false);
      onOpenChange(false);
      refreshAll();
    } catch (error) {
      console.error('Error deleting subscription:', error);
      toast.error('Eliminazione non riuscita', {
        description: error instanceof Error ? error.message : 'Errore imprevisto.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {subscription.description}
              <Badge variant={subscriptionStatusConfig[subscription.status].variant}>
                {subscriptionStatusConfig[subscription.status].label}
              </Badge>
            </DialogTitle>
            <DialogDescription>{subscription.clients?.name ?? 'Cliente non disponibile'}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="data-label">Periodicità</p>
                <p className="data-value">{periodicityLabels[subscription.periodicity]}</p>
              </div>
              <div>
                <p className="data-label">Canone corrente</p>
                <p className="data-value-lg">{canone ? formatCurrency(Number(canone.amount)) : '-'}</p>
              </div>
              <div>
                <p className="data-label">Documento</p>
                <p className="data-value">{documentKindLabels[subscription.document_kind]}</p>
              </div>
              <div>
                <p className="data-label">Data di inizio</p>
                <p className="data-value">{fmt(subscription.start_date)}</p>
              </div>
              <div>
                <p className="data-label">Data di fine</p>
                <p className="data-value">{fmt(subscription.end_date)}</p>
              </div>
              <div>
                <p className="data-label">Rinnovo automatico</p>
                <p className="data-value">{subscription.auto_renew ? 'Sì' : 'No'}</p>
              </div>
              <div>
                <p className="data-label">Preavviso disdetta</p>
                <p className="data-value">{subscription.notice_days != null ? `${subscription.notice_days} giorni` : '-'}</p>
              </div>
              <div>
                <p className="data-label">Anticipo fatturazione</p>
                <p className="data-value">{subscription.generate_days_before} giorni</p>
              </div>
            </div>

            {subscription.status === 'disdettato' && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-1">
                <p className="label-text flex items-center gap-2"><XCircle className="h-4 w-4" /> Disdetta registrata</p>
                <p className="helper-text">Efficace dal {fmt(subscription.cancelled_effective_date)}</p>
                {subscription.cancelled_reason && (
                  <p className="helper-text italic">"{subscription.cancelled_reason}"</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="label-text">Storico canoni</h4>
                {canManage && (
                  <Button size="sm" variant="outline" onClick={() => setShowAddAmount(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Aggiungi variazione
                  </Button>
                )}
              </div>
              {amounts.length === 0 ? (
                <p className="empty-state-text text-sm">Nessun canone registrato.</p>
              ) : (
                <div className="rounded-lg border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Valido dal</TableHead>
                        <TableHead>Valido fino al</TableHead>
                        <TableHead className="text-right">Importo</TableHead>
                        <TableHead className="text-right">IVA</TableHead>
                        <TableHead>Nota</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {amounts.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{fmt(a.valid_from)}</TableCell>
                          <TableCell>{a.valid_to ? fmt(a.valid_to) : <Badge variant="outline">attuale</Badge>}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(Number(a.amount))}</TableCell>
                          <TableCell className="text-right">{Number(a.vat_rate)}%</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={a.note ?? undefined}>
                            {a.note ?? '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="label-text">Periodi generati</h4>
              {periods.length === 0 ? (
                <p className="empty-state-text text-sm">
                  Nessun periodo ancora generato: la generazione è automatica e riservata alla schedulazione.
                </p>
              ) : (
                <div className="rounded-lg border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periodo</TableHead>
                        <TableHead>Dal</TableHead>
                        <TableHead>Al</TableHead>
                        <TableHead className="text-right">Importo</TableHead>
                        <TableHead>Stato</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {periods.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.period_key}</TableCell>
                          <TableCell>{fmt(p.period_start)}</TableCell>
                          <TableCell>{fmt(p.period_end)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(p.amount))}</TableCell>
                          <TableCell>
                            <Badge variant={periodStatusConfig[p.status].variant}>{periodStatusConfig[p.status].label}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>

          {canManage && (
            <DialogFooter className="justify-between sm:justify-between">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={hasNonPreliminaryPeriods}
                title={hasNonPreliminaryPeriods ? 'Non eliminabile: ci sono già periodi accodati o fatturati' : undefined}
              >
                <Trash2 className="h-4 w-4 mr-1" /> Elimina
              </Button>
              {subscription.status === 'attivo' && (
                <Button variant="outline" onClick={() => setShowCancel(true)}>
                  Registra disdetta
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AddSubscriptionAmountDialog
        open={showAddAmount}
        onOpenChange={setShowAddAmount}
        subscriptionId={subscription.id}
        onAdded={refreshAll}
      />

      <CancelSubscriptionDialog
        open={showCancel}
        onOpenChange={setShowCancel}
        subscriptionId={subscription.id}
        subscriptionDescription={subscription.description}
        onCancelled={refreshAll}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare questo abbonamento?</AlertDialogTitle>
            <AlertDialogDescription>
              L'operazione non può essere annullata. È ammessa solo se non ci sono ancora periodi accodati o
              fatturati.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
              {isDeleting ? 'Eliminazione...' : 'Elimina'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
