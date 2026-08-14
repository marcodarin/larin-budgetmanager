import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { StatTile } from './StatTile';
import { useSalesChartColors } from './colors';
import { ORIGIN_LABELS, type OfferConversionRow, type OfferOrigin } from './types';

interface ConversionSectionProps {
  rows: OfferConversionRow[];
}

const chartConfig: ChartConfig = {
  accettate: { label: 'Accettate' },
  rifiutate: { label: 'Rifiutate' },
  scadute: { label: 'Scadute' },
  in_attesa: { label: 'In attesa' },
};

/**
 * Conversione: quante offerte uscite diventano accettate, in quanti giorni, e
 * quanto vale la pipeline ancora in attesa. Lo stato di ogni offerta
 * (accettata/rifiutata/scaduta/in attesa) è un vero stato, non un'identità
 * categorica: usa la palette di stato della skill dataviz. Il quartetto
 * good/critical/serious fallisce il check di distinguibilità "a colpo
 * d'occhio" se letto come 4 categorie pure (verificato con
 * validate_palette.js): la mitigazione prevista dalla skill per i colori di
 * stato è l'abbinamento icona+etichetta, mai il colore da solo, applicata qui
 * nella legenda e nella tabella sottostante (che tiene comunque ogni valore
 * leggibile senza passare dal grafico).
 */
export const ConversionSection = ({ rows }: ConversionSectionProps) => {
  const { status, pending } = useSalesChartColors();

  const { totals, byOrigin } = useMemo(() => {
    const totals = {
      offerte_uscite: 0,
      accettate: 0,
      rifiutate: 0,
      scadute: 0,
      in_attesa: 0,
      valore_accettato: 0,
      valore_in_attesa: 0,
      weightedDaysSum: 0,
      weightedDaysWeight: 0,
    };
    const byOrigin = new Map<
      OfferOrigin,
      { origin: OfferOrigin; accettate: number; rifiutate: number; scadute: number; in_attesa: number; offerte_uscite: number }
    >();

    for (const row of rows) {
      totals.offerte_uscite += Number(row.offerte_uscite ?? 0);
      totals.accettate += Number(row.accettate ?? 0);
      totals.rifiutate += Number(row.rifiutate ?? 0);
      totals.scadute += Number(row.scadute ?? 0);
      totals.in_attesa += Number(row.in_attesa ?? 0);
      totals.valore_accettato += Number(row.valore_accettato ?? 0);
      totals.valore_in_attesa += Number(row.valore_in_attesa ?? 0);
      if (row.giorni_medi_alla_firma !== null && Number(row.accettate ?? 0) > 0) {
        totals.weightedDaysSum += Number(row.giorni_medi_alla_firma) * Number(row.accettate);
        totals.weightedDaysWeight += Number(row.accettate);
      }

      const existing = byOrigin.get(row.origin);
      if (existing) {
        existing.accettate += Number(row.accettate ?? 0);
        existing.rifiutate += Number(row.rifiutate ?? 0);
        existing.scadute += Number(row.scadute ?? 0);
        existing.in_attesa += Number(row.in_attesa ?? 0);
        existing.offerte_uscite += Number(row.offerte_uscite ?? 0);
      } else {
        byOrigin.set(row.origin, {
          origin: row.origin,
          accettate: Number(row.accettate ?? 0),
          rifiutate: Number(row.rifiutate ?? 0),
          scadute: Number(row.scadute ?? 0),
          in_attesa: Number(row.in_attesa ?? 0),
          offerte_uscite: Number(row.offerte_uscite ?? 0),
        });
      }
    }

    return { totals, byOrigin };
  }, [rows]);

  if (rows.length === 0) {
    return <EmptyState message="Nessuna offerta uscita registrata per quest'anno." />;
  }

  const tassoConversione = totals.offerte_uscite > 0 ? (totals.accettate / totals.offerte_uscite) * 100 : null;
  const giorniMedi = totals.weightedDaysWeight > 0 ? totals.weightedDaysSum / totals.weightedDaysWeight : null;

  const chartData = [...byOrigin.values()]
    .sort((a, b) => b.offerte_uscite - a.offerte_uscite)
    .map((o) => ({ ...o, originLabel: ORIGIN_LABELS[o.origin] ?? o.origin }));

  const legendItems = [
    { key: 'accettate', label: 'Accettate', color: status.good, Icon: CheckCircle2 },
    { key: 'rifiutate', label: 'Rifiutate', color: status.critical, Icon: XCircle },
    { key: 'scadute', label: 'Scadute', color: status.serious, Icon: AlertTriangle },
    { key: 'in_attesa', label: 'In attesa', color: pending, Icon: Clock },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <StatTile label="Offerte uscite" value={String(totals.offerte_uscite)} />
        <StatTile
          label="Tasso di conversione"
          value={tassoConversione === null ? 'n/d' : `${tassoConversione.toFixed(1).replace('.', ',')}%`}
        />
        <StatTile
          label="Giorni medi alla firma"
          value={giorniMedi === null ? 'n/d' : giorniMedi.toFixed(0)}
          hint={giorniMedi === null ? 'nessuna offerta accettata' : undefined}
        />
        <StatTile label="Valore in attesa (pipeline)" value={formatCurrency(totals.valore_in_attesa)} />
      </div>

      <div>
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          {legendItems.map(({ key, label, color, Icon }) => (
            <span key={key} className="flex items-center gap-1.5 text-muted-foreground">
              <Icon className="h-3.5 w-3.5" style={{ color }} />
              {label}
            </span>
          ))}
        </div>

        <ChartContainer config={chartConfig} className="w-full" style={{ height: `${Math.max(120, chartData.length * 56)}px` }}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="originLabel" width={90} tickLine={false} axisLine={false} />
            <ChartTooltip
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
              content={<ChartTooltipContent labelFormatter={(_, payload) => payload?.[0]?.payload?.originLabel ?? ''} />}
            />
            <Bar dataKey="accettate" stackId="esito" fill={status.good} stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={24} name="Accettate" isAnimationActive={false} />
            <Bar dataKey="rifiutate" stackId="esito" fill={status.critical} stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={24} name="Rifiutate" isAnimationActive={false} />
            <Bar dataKey="scadute" stackId="esito" fill={status.serious} stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={24} name="Scadute" isAnimationActive={false} />
            <Bar
              dataKey="in_attesa"
              stackId="esito"
              fill={pending}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              radius={[0, 4, 4, 0]}
              maxBarSize={24}
              name="In attesa"
              isAnimationActive={false}
            >
              <LabelList dataKey="offerte_uscite" position="right" className="fill-foreground text-xs" />
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origine</TableHead>
              <TableHead className="text-right">Accettate</TableHead>
              <TableHead className="text-right">Rifiutate</TableHead>
              <TableHead className="text-right">Scadute</TableHead>
              <TableHead className="text-right">In attesa</TableHead>
              <TableHead className="text-right">Uscite</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {chartData.map((o) => (
              <TableRow key={o.origin}>
                <TableCell className="font-medium">{o.originLabel}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{o.accettate}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{o.rifiutate}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{o.scadute}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{o.in_attesa}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{o.offerte_uscite}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
