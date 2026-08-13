import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Constants, type Database } from '@/integrations/supabase/types';

type OfferStatus = Database['public']['Enums']['offer_status'];

export const offerStatusConfig: Record<OfferStatus, { label: string; variant: BadgeProps['variant'] }> = {
  bozza: { label: 'Bozza', variant: 'secondary' },
  in_approvazione: { label: 'In approvazione', variant: 'yellow' },
  inviata: { label: 'Inviata', variant: 'blue' },
  vista: { label: 'Vista', variant: 'purple' },
  accettata: { label: 'Accettata', variant: 'green' },
  rifiutata: { label: 'Rifiutata', variant: 'destructive' },
  scaduta: { label: 'Scaduta', variant: 'gray' },
  superata: { label: 'Superata', variant: 'outline' },
  sostituita: { label: 'Sostituita', variant: 'outline' },
};

// "bozza" è lo stato di partenza di una nuova versione (non un traguardo da
// selezionare manualmente); "superata"/"sostituita" si applicano a una
// versione quando ne viene creata una successiva, un'operazione che queste
// due schermate di base non costruiscono ancora. Restano visibili nel menu
// (per trasparenza sullo stato) ma disabilitate.
const NON_MANUAL_STATUSES: OfferStatus[] = ['bozza', 'superata', 'sostituita'];

interface OfferStatusSelectorProps {
  offerVersionId: string;
  currentStatus: OfferStatus;
  onStatusChange?: () => void;
  readOnly?: boolean;
}

export const OfferStatusSelector = ({
  offerVersionId,
  currentStatus,
  onStatusChange,
  readOnly = false,
}: OfferStatusSelectorProps) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();

  const config = offerStatusConfig[currentStatus];

  if (readOnly) {
    return <Badge variant={config.variant}>{config.label}</Badge>;
  }

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === currentStatus) return;

    setIsUpdating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Utente non autenticato');

      // event_type coincide con il valore di new_status per tutte le
      // transizioni manuali qui esposte (vedi CHECK su offer_events.event_type).
      const { error } = await supabase.rpc('set_offer_version_status', {
        _offer_version_id: offerVersionId,
        _new_status: newStatus as OfferStatus,
        _event_type: newStatus,
        _actor_type: 'user',
        _actor_user_id: user.id,
      });

      if (error) throw error;

      toast({
        title: 'Stato aggiornato',
        description: `L'offerta è ora "${offerStatusConfig[newStatus as OfferStatus].label}".`,
      });
      onStatusChange?.();
    } catch (error) {
      console.error('Error updating offer status:', error);
      toast({
        title: 'Errore',
        description: 'Si è verificato un errore durante l\'aggiornamento dello stato.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Select value={currentStatus} onValueChange={handleStatusChange} disabled={isUpdating}>
      <SelectTrigger className="w-[170px]">
        <SelectValue>
          <Badge variant={config.variant}>{config.label}</Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Constants.public.Enums.offer_status.map((status) => (
          <SelectItem key={status} value={status} disabled={NON_MANUAL_STATUSES.includes(status)}>
            <Badge variant={offerStatusConfig[status].variant}>{offerStatusConfig[status].label}</Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
