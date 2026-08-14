import { format, parseISO } from 'date-fns';
import { Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn, formatCurrency } from '@/lib/utils';
import { tenderOutcomeConfig, type TenderPipelineRow } from './types';

interface TendersTableProps {
  rows: TenderPipelineRow[];
  isLoading: boolean;
  onRowClick: (row: TenderPipelineRow) => void;
}

export const TendersTable = ({ rows, isLoading, onRowClick }: TendersTableProps) => {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-10 bg-muted rounded" />
        <div className="h-64 bg-muted rounded" />
      </div>
    );
  }

  const sortedRows = [...rows].sort((a, b) => {
    if (a.giorni_alla_scadenza == null) return 1;
    if (b.giorni_alla_scadenza == null) return -1;
    return a.giorni_alla_scadenza - b.giorni_alla_scadenza;
  });

  if (sortedRows.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-text">Nessuna gara creata ancora.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Gara</TableHead>
            <TableHead>Cliente / Ente</TableHead>
            <TableHead>Scadenza presentazione</TableHead>
            <TableHead className="text-right">Valore stimato</TableHead>
            <TableHead>Esito</TableHead>
            <TableHead className="text-right">Allegati</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row) => {
            const days = row.giorni_alla_scadenza;
            const ongoing = row.tender_outcome === 'in_corso';
            const overdue = ongoing && days != null && days < 0;
            const urgent = ongoing && days != null && days >= 0 && days <= 7;
            return (
              <TableRow key={row.offer_id} className="cursor-pointer" onClick={() => onRowClick(row)}>
                <TableCell className="max-w-[260px]">
                  <div className="font-medium truncate hover:text-primary hover:underline" title={row.tender_subject ?? undefined}>
                    {row.tender_subject ?? `Gara ${row.number}/${row.year}`}
                  </div>
                  {row.tender_reference && <div className="helper-text truncate">{row.tender_reference}</div>}
                </TableCell>
                <TableCell>{row.client_name}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.tender_submission_deadline ? (
                    <span
                      className={cn(
                        'text-sm font-medium',
                        overdue && 'text-destructive font-semibold',
                        urgent && 'text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {format(parseISO(row.tender_submission_deadline), 'dd/MM/yyyy')}
                      {overdue && ' · scaduta'}
                      {urgent && ` · tra ${days} giorni`}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {row.tender_estimated_value != null ? formatCurrency(Number(row.tender_estimated_value)) : '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={tenderOutcomeConfig[row.tender_outcome].variant}>
                    {tenderOutcomeConfig[row.tender_outcome].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {row.allegati > 0 ? (
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Paperclip className="h-3.5 w-3.5" /> {row.allegati}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
