import { useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { PRODUCT_NATURE_LABELS, type SalesByProductRow } from './types';

interface TopProductsTableProps {
  rows: SalesByProductRow[];
}

const quantityFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });

/**
 * Classifica dei prodotti: risponde direttamente alla domanda di Alberto
 * ("quante analisi strategiche abbiamo venduto") tramite la colonna Quantità,
 * che è il conteggio reale, non una ripartizione monetaria.
 */
export const TopProductsTable = ({ rows }: TopProductsTableProps) => {
  const sorted = useMemo(() => [...rows].sort((a, b) => Number(b.venduto) - Number(a.venduto)), [rows]);

  if (sorted.length === 0) {
    return <EmptyState message="Nessun prodotto venduto registrato per quest'anno." />;
  }

  return (
    <div>
      <div className="max-h-[420px] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[160px]">Prodotto</TableHead>
              <TableHead className="min-w-[140px]">Categoria</TableHead>
              <TableHead className="whitespace-nowrap text-right">Quantità</TableHead>
              <TableHead className="whitespace-nowrap text-right">Offerte</TableHead>
              <TableHead className="whitespace-nowrap text-right">Venduto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={`${row.product_code}-${row.product_name}`}>
                <TableCell>
                  <div className="font-medium">{row.product_name}</div>
                  {row.product_nature !== 'una_tantum' && (
                    <Badge variant="outline" className="mt-1 text-xs">
                      {PRODUCT_NATURE_LABELS[row.product_nature]}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.revenue_category}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {quantityFormatter.format(Number(row.quantita ?? 0))}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">{row.offerte}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {formatCurrency(Number(row.venduto ?? 0))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Nelle offerte a prezzo unico onnicomprensivo il venduto per prodotto è ripartito in proporzione ai
        valori di riga: la somma per prodotto coincide sempre col venduto totale, ma il singolo valore è una
        ripartizione, non un prezzo battuto. La colonna Quantità non risente di questa ripartizione.
      </p>
    </div>
  );
};
