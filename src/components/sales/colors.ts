/**
 * Colori per i grafici del cruscotto vendite.
 *
 * Segue la skill dataviz: hue categoriche assegnate in ordine fisso (mai
 * generate), colori di stato riservati a good/warning/serious/critical e mai
 * riusati come categoria. Validati con scripts/validate_palette.js dalla skill
 * contro le superfici card reali dell'app (bianco in chiaro, #12211e in scuro,
 * derivato da hsl(168 30% 10%) di src/index.css):
 * - coppia categorica blu/arancio: PASS su entrambe le modalità
 * - quartetto di stato: la coppia warning/serious FALLISCE il check
 *   "distinguibile per identità" se letta come categoria pura, cosa attesa e
 *   documentata dalla skill per i colori di stato (`palette.md`, sezione
 *   "Status palette"): la mitigazione è l'abbinamento icona+etichetta, mai
 *   il colore da solo. Applicata di conseguenza nei componenti che li usano.
 */
import { useTheme } from 'next-themes';

interface NatureColorSet {
  una_tantum: string;
  ricorrente: string;
}

const NATURE_COLORS_LIGHT: NatureColorSet = {
  una_tantum: '#2a78d6', // categorico slot 1 (blu)
  ricorrente: '#eb6834', // categorico slot 2 (arancio)
};

const NATURE_COLORS_DARK: NatureColorSet = {
  una_tantum: '#3987e5',
  ricorrente: '#d95926',
};

// Colori di stato: fissi, identici in chiaro e scuro (palette.md).
export const STATUS_COLORS = {
  good: '#0ca30c', // accettate
  critical: '#d03b3b', // rifiutate
  serious: '#ec835a', // scadute
} as const;

// Grigio neutro per stati non di successo/insuccesso (in attesa: non ancora
// deciso, non va letto come "problema").
export const NEUTRAL_PENDING_COLOR = '#898781';

/**
 * Restituisce i colori corretti per la modalità chiaro/scuro attualmente
 * attiva. Il rendering iniziale (prima che next-themes risolva il tema)
 * usa i valori chiari: la palette è validata in entrambe le modalità, quindi
 * l'eventuale ridisegno al mount non introduce un colore "sbagliato".
 */
export function useSalesChartColors() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return {
    nature: isDark ? NATURE_COLORS_DARK : NATURE_COLORS_LIGHT,
    status: STATUS_COLORS,
    pending: NEUTRAL_PENDING_COLOR,
  };
}
