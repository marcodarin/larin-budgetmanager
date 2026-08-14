import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { AlertCircle, ExternalLink, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableNameCell } from '@/components/ui/table-name-cell';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import type { Database } from '@/integrations/supabase/types';

type InvoiceQueueRow = Database['public']['Tables']['invoice_queue']['Row'];
type InvoiceStatus = Database['public']['Enums']['invoice_queue_status'];
type DocumentKind = Database['public']['Enums']['invoice_document_kind'];

export interface InvoiceQueueRowWithRef extends InvoiceQueueRow {
  offer_year: number | null;
  offer_number: number | null;
  client_name: string | null;
}

const STATUS_PRIORITY: Record<InvoiceStatus, number> = {
  prevista: 0,
  in_emissione: 1,
  emessa: 2,
  incassata: 3,
  annullata: 4,
};

const statusConfig: Record<InvoiceStatus, { label: string; variant: BadgeProps['variant'] }> = {
  prevista: { label: 'Prevista', variant: 'gray' },
  in_emissione: { label: 'In emissione', variant: 'yellow' },
  emessa: { label: 'Emessa', variant: 'blue' },
  incassata: { label: 'Incassata', variant: 'green' },
  annullata: { label: 'Annullata', variant: 'destructive' },
};

const documentKindLabels: Record<DocumentKind, string> = {
  fattura: 'Fattura',
  proforma: 'Proforma',
};

type DueUrgency = 'overdue' | 'soon' | 'normal';

// Solo le righe ancora "prevista" hanno un senso di urgenza: una volta emessa,
// annullata o incassata la scadenza è storia, non un allarme da colorare.
function getDueUrgency(row: InvoiceQueueRowWithRef): DueUrgency {
  if (row.status !== 'prevista' || !row.due_date) return 'normal';
  const days = differenceInCalendarDays(parseISO(row.due_date), new Date());
  if (days < 0) return 'overdue';
  if (days <= 7) return 'soon';
  return 'normal';
}

interface InvoiceQueueTableProps {
  rows: InvoiceQueueRowWithRef[];
  isLoading: boolean;
  canManage: boolean;
}

export const InvoiceQueueTable = ({ rows, isLoading, canManage }: InvoiceQueueTableProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<InvoiceQueueRowWithRef | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [markPaidTarget, setMarkPaidTarget] = useState<InvoiceQueueRowWithRef | null>(null);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['invoice-queue'] });
    queryClient.invalidateQueries({ queryKey: ['offer-billing-summary'] });
  };

  const issueMutation = useMutation({
    mutationFn: async (invoiceQueueId: string) => {
      const { data, error } = await supabase.functions.invoke('invoice-issue', {
        body: { invoice_queue_id: invoiceQueueId },
      });
      if (error) {
        // Se la function non è ancora deployata, questo è un errore di rete
        // (FunctionsFetchError/FunctionsRelayError): niente da leggere nel
        // corpo, si mostra un messaggio comprensibile e basta, senza inventare
        // un esito che non abbiamo osservato.
        let message = 'Impossibile contattare il servizio di emissione. Riprova più tardi.';
        if (error instanceof FunctionsHttpError) {
          try {
            const body = await error.context.json();
            if (body?.error) message = body.error;
          } catch {
            // risposta non json: resta il messaggio generico sopra
          }
        }
        throw new Error(message);
      }
      return data as { ok: boolean; fic_document_id: number; fic_document_url: string };
    },
    onMutate: (invoiceQueueId: string) => setIssuingId(invoiceQueueId),
    onSuccess: (data) => {
      toast.success('Fattura emessa', {
        description: `Documento Fatture in Cloud #${data.fic_document_id} creato.`,
      });
    },
    onError: (error: Error) => {
      toast.error('Emissione non riuscita', { description: error.message });
    },
    onSettled: () => {
      setIssuingId(null);
      invalidateAll();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('cancel_invoice_queue_row', {
        _invoice_queue_id: id,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Fattura annullata');
      setCancelTarget(null);
      setCancelReason('');
    },
    onError: (error: Error) => {
      toast.error('Annullamento non riuscito', { description: error.message });
    },
    onSettled: invalidateAll,
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_invoice_paid', { _invoice_queue_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Fattura segnata come incassata');
      setMarkPaidTarget(null);
    },
    onError: (error: Error) => {
      toast.error('Operazione non riuscita', { description: error.message });
    },
    onSettled: invalidateAll,
  });

  const sortedRows = [...rows].sort((a, b) => {
    const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priorityDiff !== 0) return priorityDiff;
    const dueA = a.due_date ? parseISO(a.due_date).getTime() : Infinity;
    const dueB = b.due_date ? parseISO(b.due_date).getTime() : Infinity;
    return dueA - dueB;
  });

  const closeCancelDialog = () => {
    setCancelTarget(null);
    setCancelReason('');
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-10 bg-muted rounded" />
        <div className="h-64 bg-muted rounded" />
      </div>
    );
  }

  return (
    <>
      {sortedRows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-text">Nessuna fattura in coda.</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Causale</TableHead>
                <TableHead className="text-right">Importo</TableHead>
                <TableHead>Scadenza</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Offerta</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead>Rif. FiC</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => {
                const urgency = getDueUrgency(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.client_name ?? '-'}</TableCell>
                    <TableCell className="max-w-[240px] truncate" title={row.description}>
                      {row.description}
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">
                      {formatCurrency(Number(row.amount))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.due_date ? (
                        <span
                          className={cn(
                            'text-sm',
                            urgency === 'overdue' && 'text-destructive font-semibold',
                            urgency === 'soon' && 'text-amber-600 font-medium'
                          )}
                        >
                          {format(parseISO(row.due_date), 'dd/MM/yyyy')}
                          {urgency === 'overdue' && ' · scaduta'}
                          {urgency === 'soon' && ' · in scadenza'}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {row.status === 'prevista' ? (
                        <div className="flex items-center gap-1">
                          {/* Sola lettura: non c'è un privilegio (né una RPC) per cambiare
                              document_kind, vedi nota nel rapporto di consegna. */}
                          <Select value={row.document_kind} disabled>
                            <SelectTrigger className="w-[110px] h-8">
                              <SelectValue>{documentKindLabels[row.document_kind]}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fattura">Fattura</SelectItem>
                              <SelectItem value="proforma">Proforma</SelectItem>
                            </SelectContent>
                          </Select>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              Non modificabile da qui: manca una funzione dedicata con i privilegi
                              per cambiare il tipo di documento prima dell'emissione.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      ) : (
                        <Badge variant="outline">{documentKindLabels[row.document_kind]}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.offer_number != null ? (
                        <TableNameCell
                          name={`${row.offer_number}/${row.offer_year}`}
                          href={`/offers/${row.offer_id}`}
                          onClick={() => navigate(`/offers/${row.offer_id}`)}
                        />
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={statusConfig[row.status].variant}>
                          {statusConfig[row.status].label}
                        </Badge>
                        {row.last_error && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 text-xs text-destructive cursor-help">
                                <AlertCircle className="h-3 w-3" /> Errore emissione
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{row.last_error}</TooltipContent>
                          </Tooltip>
                        )}
                        {row.status === 'annullata' && row.cancelled_reason && (
                          <span className="text-xs text-muted-foreground italic">
                            "{row.cancelled_reason}"
                          </span>
                        )}
                        {row.status === 'incassata' && row.paid_at && (
                          <span className="text-xs text-muted-foreground">
                            il {format(parseISO(row.paid_at), 'dd/MM/yyyy')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.fic_document_url ? (
                        <a
                          href={row.fic_document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline text-sm whitespace-nowrap"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Apri
                        </a>
                      ) : row.fic_document_id ? (
                        <span className="text-sm text-muted-foreground">#{row.fic_document_id}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!canManage ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : row.status === 'prevista' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => issueMutation.mutate(row.id)}
                            disabled={issuingId === row.id}
                          >
                            {issuingId === row.id ? 'Emissione...' : 'Emetti'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCancelTarget(row)}
                            disabled={issuingId === row.id}
                          >
                            Annulla
                          </Button>
                        </div>
                      ) : row.status === 'emessa' ? (
                        <Button size="sm" variant="outline" onClick={() => setMarkPaidTarget(row)}>
                          Segna incassata
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) closeCancelDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Annulla fattura prevista</DialogTitle>
            <DialogDescription>
              {cancelTarget && (
                <>
                  {cancelTarget.client_name ?? 'Cliente'} · {formatCurrency(Number(cancelTarget.amount))}
                  {cancelTarget.offer_number != null && ` · offerta ${cancelTarget.offer_number}/${cancelTarget.offer_year}`}
                  . Il motivo è obbligatorio e resta in archivio.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Motivo dell'annullamento</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Es. offerta rinegoziata, tranche assorbita da un'altra fattura..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCancelDialog}>
              Chiudi
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim() || cancelMutation.isPending}
              onClick={() =>
                cancelTarget && cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason.trim() })
              }
            >
              {cancelMutation.isPending ? 'Annullamento...' : 'Annulla fattura'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!markPaidTarget} onOpenChange={(open) => { if (!open) setMarkPaidTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Segnare questa fattura come incassata?</AlertDialogTitle>
            <AlertDialogDescription>
              {markPaidTarget && (
                <>
                  {markPaidTarget.client_name ?? 'Cliente'} · {formatCurrency(Number(markPaidTarget.amount))}.
                  L'incasso viene registrato con la data odierna.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => markPaidTarget && markPaidMutation.mutate(markPaidTarget.id)}>
              Segna incassata
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
