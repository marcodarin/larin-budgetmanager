import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';

interface CancelSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string;
  subscriptionDescription: string;
  onCancelled: () => void;
}

export const CancelSubscriptionDialog = ({
  open,
  onOpenChange,
  subscriptionId,
  subscriptionDescription,
  onCancelled,
}: CancelSubscriptionDialogProps) => {
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEffectiveDate('');
      setReason('');
    }
  }, [open]);

  const handleConfirm = async () => {
    // La data di efficacia è obbligatoria lato database (il parametro della
    // funzione non ha un default): senza, i periodi futuri non saprebbero da
    // quando smettere di generarsi.
    if (!effectiveDate) {
      toast.error('La data di efficacia della disdetta è obbligatoria.');
      return;
    }

    setIsSaving(true);
    try {
      // cancel_subscription non è ancora nei tipi generati (vedi ./types.ts).
      const { error } = await (supabase.rpc as any)('cancel_subscription', {
        _subscription_id: subscriptionId,
        _effective_date: effectiveDate,
        _reason: reason.trim() || null,
      });
      if (error) throw error;

      toast.success('Disdetta registrata.');
      onOpenChange(false);
      onCancelled();
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      const message = error instanceof Error ? error.message : 'Errore durante la registrazione della disdetta.';
      toast.error('Disdetta non riuscita', { description: message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registra disdetta</DialogTitle>
          <DialogDescription>
            {subscriptionDescription}. I periodi non ancora fatturati che iniziano dalla data di efficacia in poi
            vengono annullati; quelli già accodati o fatturati restano.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cancel-effective-date">Data di efficacia *</Label>
            <Input
              id="cancel-effective-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              min={format(new Date(), 'yyyy-MM-dd')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Motivo</Label>
            <Textarea
              id="cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Facoltativo"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Chiudi</Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isSaving || !effectiveDate}>
            {isSaving ? 'Registrazione...' : 'Registra disdetta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
