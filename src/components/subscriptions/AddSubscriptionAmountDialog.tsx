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
import { friendlySubscriptionError } from './types';

interface AddSubscriptionAmountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionId: string;
  onAdded: () => void;
}

export const AddSubscriptionAmountDialog = ({
  open,
  onOpenChange,
  subscriptionId,
  onAdded,
}: AddSubscriptionAmountDialogProps) => {
  const [validFrom, setValidFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [validTo, setValidTo] = useState('');
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState('22');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValidFrom(format(new Date(), 'yyyy-MM-dd'));
      setValidTo('');
      setAmount('');
      setVatRate('22');
      setNote('');
    }
  }, [open]);

  const handleSave = async () => {
    if (!validFrom) {
      toast.error('La data da cui vale il canone è obbligatoria.');
      return;
    }
    const amountValue = parseFloat(amount);
    if (!amount || Number.isNaN(amountValue) || amountValue <= 0) {
      toast.error('Indica un importo maggiore di zero.');
      return;
    }
    if (validTo && validTo <= validFrom) {
      toast.error('La data di fine deve essere successiva alla data di inizio.');
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // subscription_amounts non è ancora nei tipi generati: vedi ./types.ts.
      const { error } = await (supabase.from as any)('subscription_amounts').insert({
        subscription_id: subscriptionId,
        amount: amountValue,
        vat_rate: vatRate ? parseFloat(vatRate) : 22,
        valid_from: validFrom,
        valid_to: validTo || null,
        note: note.trim() || null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;

      toast.success('Variazione di canone registrata.');
      onOpenChange(false);
      onAdded();
    } catch (error) {
      console.error('Error adding subscription amount:', error);
      const message = error instanceof Error
        ? friendlySubscriptionError({ code: (error as { code?: string }).code, message: error.message })
        : 'Errore durante il salvataggio.';
      toast.error('Salvataggio non riuscito', { description: message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuova variazione di canone</DialogTitle>
          <DialogDescription>
            Registra il nuovo importo e la data da cui vale. Se il canone attuale è ancora aperto (senza data di
            fine), questa operazione verrà rifiutata: va indicata una data di fine già al momento in cui si conosce
            in anticipo un futuro cambio di importo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount-valid-from">Valido dal *</Label>
              <Input id="amount-valid-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount-valid-to">Valido fino al</Label>
              <Input id="amount-valid-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
              <p className="helper-text">Lascia vuoto se è il canone attuale.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount-value">Importo (€) *</Label>
              <Input
                id="amount-value"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount-vat">Aliquota IVA (%)</Label>
              <Input id="amount-vat" type="number" min="0" step="0.01" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amount-note">Nota</Label>
            <Textarea id="amount-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facoltativa" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Annulla</Button>
          <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Salvataggio...' : 'Registra variazione'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
