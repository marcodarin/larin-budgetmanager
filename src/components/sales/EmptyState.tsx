import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  message: string;
}

/**
 * Sezione senza dati per l'anno selezionato: mai un grafico vuoto senza
 * spiegazione, mai "NaN"/"null" a schermo.
 */
export const EmptyState = ({ message }: EmptyStateProps) => (
  <div className="empty-state">
    <Inbox className="empty-state-icon" />
    <p className="empty-state-text">{message}</p>
  </div>
);
