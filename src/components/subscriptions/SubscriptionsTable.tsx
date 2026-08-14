import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import {
  currentAmount,
  periodicityLabels,
  subscriptionStatusConfig,
  type SubscriptionListRow,
  type SubscriptionStatus,
} from './types';

interface SubscriptionsTableProps {
  rows: SubscriptionListRow[];
  isLoading: boolean;
  onRowClick: (row: SubscriptionListRow) => void;
}

const STATUS_PRIORITY: Record<SubscriptionStatus, number> = {
  attivo: 0,
  disdettato: 1,
  concluso: 2,
};

export const SubscriptionsTable = ({ rows, isLoading, onRowClick }: SubscriptionsTableProps) => {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-10 bg-muted rounded" />
        <div className="h-64 bg-muted rounded" />
      </div>
    );
  }

  const sortedRows = [...rows].sort((a, b) => {
    const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (priorityDiff !== 0) return priorityDiff;
    return (a.clients?.name ?? '').localeCompare(b.clients?.name ?? '');
  });

  if (sortedRows.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-text">Nessun abbonamento creato ancora.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cliente</TableHead>
            <TableHead>Descrizione</TableHead>
            <TableHead>Periodicità</TableHead>
            <TableHead className="text-right">Canone corrente</TableHead>
            <TableHead>Stato</TableHead>
            <TableHead>Fine impegno</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row) => {
            const canone = currentAmount(row.subscription_amounts);
            return (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => onRowClick(row)}>
                <TableCell className="font-medium">{row.clients?.name ?? '-'}</TableCell>
                <TableCell className="max-w-[260px] truncate hover:text-primary hover:underline" title={row.description}>
                  {row.description}
                </TableCell>
                <TableCell>{periodicityLabels[row.periodicity]}</TableCell>
                <TableCell className="text-right font-semibold whitespace-nowrap">
                  {canone ? formatCurrency(Number(canone.amount)) : '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={subscriptionStatusConfig[row.status].variant}>
                    {subscriptionStatusConfig[row.status].label}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.end_date ? format(parseISO(row.end_date), 'dd/MM/yyyy') : row.auto_renew ? 'Indeterminato' : '-'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
