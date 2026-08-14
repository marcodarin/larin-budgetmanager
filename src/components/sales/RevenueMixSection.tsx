import { formatCurrency } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { StatTile } from './StatTile';
import { useSalesChartColors } from './colors';
import type { RevenueMixRow } from './types';

interface RevenueMixSectionProps {
  mix: RevenueMixRow | null | undefined;
  year: number;
}

/**
 * Mix ricorrente/una tantum: la domanda strategica ("quanto del fatturato è
 * prevedibile"). Un'unica barra impilata orizzontale (part-to-whole su 2
 * categorie), stessa coppia di colori usata anche per il venduto per
 * commerciale, così l'identità "blu = una tantum, arancio = ricorrente" vale
 * in tutto il cruscotto.
 */
export const RevenueMixSection = ({ mix, year }: RevenueMixSectionProps) => {
  const { nature } = useSalesChartColors();

  if (!mix || Number(mix.totale) === 0) {
    return <EmptyState message={`Nessun venduto registrato nel ${year}: nessun dato sul mix ricavi.`} />;
  }

  const totale = Number(mix.totale);
  const unaTantum = Number(mix.una_tantum);
  const ricorrente = Number(mix.ricorrente);
  const quota = Number(mix.quota_ricorrente_percentuale ?? 0);
  const hasRicorrente = ricorrente > 0;

  const unaTantumPct = (unaTantum / totale) * 100;
  const ricorrentePct = (ricorrente / totale) * 100;

  return (
    <div className="space-y-4">
      <StatTile
        label="Quota ricorrente sul venduto"
        value={`${quota.toFixed(1).replace('.', ',')}%`}
        hint={hasRicorrente ? undefined : 'Nessun ricavo ricorrente ancora registrato'}
      />

      <div>
        <div className="flex h-7 w-full gap-0.5" role="img" aria-label={`Una tantum ${formatCurrency(unaTantum)}, ricorrente ${formatCurrency(ricorrente)}`}>
          <div
            className={hasRicorrente ? 'h-full rounded-l-md' : 'h-full rounded-md'}
            style={{ width: `${unaTantumPct}%`, backgroundColor: nature.una_tantum }}
            title={`Una tantum: ${formatCurrency(unaTantum)}`}
          />
          {hasRicorrente && (
            <div
              className="h-full rounded-r-md"
              style={{ width: `${ricorrentePct}%`, backgroundColor: nature.ricorrente }}
              title={`Ricorrente: ${formatCurrency(ricorrente)}`}
            />
          )}
        </div>

        {hasRicorrente ? (
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: nature.una_tantum }} />
              <span className="text-muted-foreground">Una tantum</span>
              <span className="font-mono tabular-nums text-foreground">{formatCurrency(unaTantum)}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: nature.ricorrente }} />
              <span className="text-muted-foreground">Ricorrente</span>
              <span className="font-mono tabular-nums text-foreground">{formatCurrency(ricorrente)}</span>
            </span>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Tutto il venduto del {year} ({formatCurrency(unaTantum)}) è una tantum: nessun canone o abbonamento
            venduto quest'anno.
          </p>
        )}
      </div>
    </div>
  );
};
