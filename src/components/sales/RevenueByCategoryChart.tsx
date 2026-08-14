import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { useSalesChartColors } from './colors';
import type { SalesByProductRow } from './types';

interface RevenueByCategoryChartProps {
  rows: SalesByProductRow[];
}

const MAX_LABEL_CHARS = 22;

const truncate = (label: string) =>
  label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;

const chartConfig: ChartConfig = {
  venduto: { label: 'Venduto' },
};

/**
 * Confronto del venduto per categoria di ricavo: un'unica serie (il venduto
 * dell'anno), quindi una sola hue e nessuna legenda (job "compare magnitude",
 * non identità: colorare ogni barra in modo diverso sarebbe un value-ramp su
 * categorie nominali, un anti-pattern della skill dataviz).
 */
export const RevenueByCategoryChart = ({ rows }: RevenueByCategoryChartProps) => {
  const { nature } = useSalesChartColors();

  const data = useMemo(() => {
    const byCategory = new Map<string, { category: string; venduto: number; offerte: number }>();
    for (const row of rows) {
      const existing = byCategory.get(row.revenue_category);
      if (existing) {
        existing.venduto += Number(row.venduto ?? 0);
        existing.offerte += Number(row.offerte ?? 0);
      } else {
        byCategory.set(row.revenue_category, {
          category: row.revenue_category,
          venduto: Number(row.venduto ?? 0),
          offerte: Number(row.offerte ?? 0),
        });
      }
    }
    return [...byCategory.values()].sort((a, b) => b.venduto - a.venduto);
  }, [rows]);

  if (data.length === 0) {
    return <EmptyState message="Nessun venduto registrato per quest'anno." />;
  }

  const height = Math.max(160, data.length * 48);

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ height: `${height}px` }}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 96, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="category"
          width={140}
          tickLine={false}
          axisLine={false}
          tickFormatter={truncate}
        />
        <ChartTooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, payload) => payload?.[0]?.payload?.category ?? ''}
              formatter={(value, _name, item) => (
                <div className="flex w-full flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Venduto</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatCurrency(Number(value))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Offerte</span>
                    <span className="font-mono tabular-nums text-foreground">{item.payload.offerte}</span>
                  </div>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="venduto" fill={nature.una_tantum} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
          <LabelList
            dataKey="venduto"
            position="right"
            formatter={(value: number) => formatCurrency(value)}
            className="fill-foreground text-xs"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
};
