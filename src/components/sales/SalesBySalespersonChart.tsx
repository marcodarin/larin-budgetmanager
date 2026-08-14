import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { useSalesChartColors } from './colors';
import type { SalesBySalespersonRow } from './types';

interface SalesBySalespersonChartProps {
  rows: SalesBySalespersonRow[];
}

const chartConfig: ChartConfig = {
  una_tantum: { label: 'Una tantum' },
  ricorrente: { label: 'Ricorrente' },
};

/**
 * Venduto per commerciale ("rc_center" di Fatture in Cloud: l'account del
 * cliente quando c'è, altrimenti chi ha composto l'offerta). Stessa coppia
 * blu/arancio di RevenueMixSection: l'identità di colore "una tantum /
 * ricorrente" resta coerente in tutto il cruscotto.
 */
export const SalesBySalespersonChart = ({ rows }: SalesBySalespersonChartProps) => {
  const { nature } = useSalesChartColors();

  const data = useMemo(
    () =>
      [...rows]
        .map((r) => ({
          name: r.salesperson_name,
          ricorrente: Number(r.venduto_ricorrente ?? 0),
          una_tantum: Number(r.venduto ?? 0) - Number(r.venduto_ricorrente ?? 0),
          venduto: Number(r.venduto ?? 0),
          offerte: Number(r.offerte ?? 0),
        }))
        .sort((a, b) => b.venduto - a.venduto),
    [rows]
  );

  if (data.length === 0) {
    return <EmptyState message="Nessuna offerta accettata quest'anno: nessun venduto per commerciale." />;
  }

  const hasRicorrente = data.some((d) => d.ricorrente > 0);
  const height = Math.max(160, data.length * 48);

  return (
    <div>
      {hasRicorrente && (
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: nature.una_tantum }} />
            <span className="text-muted-foreground">Una tantum</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: nature.ricorrente }} />
            <span className="text-muted-foreground">Ricorrente</span>
          </span>
        </div>
      )}

      <ChartContainer config={chartConfig} className="w-full" style={{ height: `${height}px` }}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 64, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} />
          <ChartTooltip
            cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => payload?.[0]?.payload?.name ?? ''}
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{name === 'una_tantum' ? 'Una tantum' : 'Ricorrente'}</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatCurrency(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar
            dataKey="una_tantum"
            stackId="venduto"
            fill={nature.una_tantum}
            stroke="hsl(var(--card))"
            strokeWidth={2}
            radius={hasRicorrente ? [0, 0, 0, 0] : [0, 4, 4, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          >
            {!hasRicorrente && (
              <LabelList dataKey="venduto" position="right" formatter={(v: number) => formatCurrency(v)} className="fill-foreground text-xs" />
            )}
          </Bar>
          {hasRicorrente && (
            <Bar dataKey="ricorrente" stackId="venduto" fill={nature.ricorrente} stroke="hsl(var(--card))" strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
              <LabelList dataKey="venduto" position="right" formatter={(v: number) => formatCurrency(v)} className="fill-foreground text-xs" />
            </Bar>
          )}
        </BarChart>
      </ChartContainer>
    </div>
  );
};
