import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { ClientSelector } from '@/components/ClientSelector';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllClients } from '@/lib/fetchAllClients';
import { friendlyTenderError } from './types';

interface CreateTenderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (offerId: string) => void;
}

export const CreateTenderDialog = ({ open, onOpenChange, onCreated }: CreateTenderDialogProps) => {
  const [clientId, setClientId] = useState('');
  const [subject, setSubject] = useState('');
  const [reference, setReference] = useState('');
  const [deadline, setDeadline] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const { data: clients = [], refetch: refetchClients } = useQuery({
    queryKey: ['all-clients-for-tenders'],
    queryFn: () => fetchAllClients<{ id: string; name: string }>('id, name'),
    enabled: open,
  });

  const resetForm = () => {
    setClientId('');
    setSubject('');
    setReference('');
    setDeadline('');
    setEstimatedValue('');
  };

  useEffect(() => {
    if (!open) resetForm();
  }, [open]);

  const closeAndReset = () => {
    if (isCreating) return;
    onOpenChange(false);
  };

  const handleCreate = async () => {
    if (!clientId) {
      toast.error('Seleziona l\'ente o il cliente per cui si partecipa.');
      return;
    }
    if (!subject.trim()) {
      toast.error('L\'oggetto della gara è obbligatorio.');
      return;
    }

    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Utente non autenticato');

      // Una gara nasce senza righe e senza prezzo (AD-10): niente
      // offer_versions qui, solo l'offerta con origine tender e i suoi campi
      // specifici. I tipi generati non hanno ancora le colonne tender_*
      // (vedi ./types.ts), da cui il cast.
      const { data: newOffer, error } = await (supabase.from as any)('offers')
        .insert({
          client_id: clientId,
          origin: 'tender',
          created_by: user.id,
          tender_subject: subject.trim(),
          tender_reference: reference.trim() || null,
          tender_submission_deadline: deadline || null,
          tender_estimated_value: estimatedValue ? parseFloat(estimatedValue) : null,
        })
        .select('id')
        .single();
      if (error) throw error;

      toast.success('Gara creata.');
      closeAndReset();
      onCreated(newOffer.id);
    } catch (error) {
      console.error('Error creating tender:', error);
      const message = error instanceof Error
        ? friendlyTenderError({ code: (error as { code?: string }).code, message: error.message })
        : 'Errore durante la creazione della gara.';
      toast.error('Creazione non riuscita', { description: message });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeAndReset(); else onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuova gara</DialogTitle>
          <DialogDescription>
            Si registra senza righe né prezzo: l'offerta tecnica ed economica, quando esistono, si allegano da
            Drive nel dettaglio della gara.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Ente / Cliente *</Label>
            <ClientSelector
              value={clientId}
              onValueChange={setClientId}
              clients={clients}
              onClientCreated={() => refetchClients()}
              showCancelButton={false}
              triggerClassName="h-9 w-full"
              placeholder="Seleziona ente o cliente"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tender-subject">Oggetto della gara *</Label>
            <Input
              id="tender-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Come lo scrive il bando"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tender-reference">Riferimento (CIG, procedura)</Label>
              <Input id="tender-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tender-deadline">Scadenza presentazione</Label>
              <Input id="tender-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tender-value">Valore stimato del bando (€)</Label>
            <Input
              id="tender-value"
              type="number"
              min="0"
              step="0.01"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              placeholder="Facoltativo"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeAndReset} disabled={isCreating}>Annulla</Button>
          <Button onClick={handleCreate} disabled={isCreating}>{isCreating ? 'Creazione...' : 'Crea gara'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
