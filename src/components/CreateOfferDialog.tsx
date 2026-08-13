import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClientSelector } from '@/components/ClientSelector';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { fetchAllClients } from '@/lib/fetchAllClients';
import type { Database } from '@/integrations/supabase/types';

type OfferOrigin = Database['public']['Enums']['offer_origin'];

const originLabels: Record<OfferOrigin, string> = {
  commercial: 'Commerciale',
  tender: 'Gara',
};

interface CreateOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (offerId: string) => void;
}

export const CreateOfferDialog = ({ open, onOpenChange, onCreated }: CreateOfferDialogProps) => {
  const { toast } = useToast();
  const [clientId, setClientId] = useState('');
  const [origin, setOrigin] = useState<OfferOrigin>('commercial');
  const [isCreating, setIsCreating] = useState(false);

  const { data: clients = [], refetch: refetchClients } = useQuery({
    queryKey: ['all-clients-for-offers'],
    queryFn: () => fetchAllClients<{ id: string; name: string }>('id, name'),
    enabled: open,
  });

  const resetAndClose = () => {
    setClientId('');
    setOrigin('commercial');
    onOpenChange(false);
  };

  const handleCreate = async () => {
    if (!clientId) {
      toast({ title: 'Errore', description: 'Seleziona un cliente per la nuova offerta.', variant: 'destructive' });
      return;
    }

    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Utente non autenticato');

      // year/number sono assegnati dal trigger offers_set_number solo se
      // omessi dall'insert: i tipi generati li segnano come obbligatori
      // perché non hanno un DEFAULT a livello di colonna (il default arriva
      // dal trigger, non dallo schema), da cui il cast.
      const { data: newOffer, error: offerError } = await supabase
        .from('offers')
        .insert({
          client_id: clientId,
          origin,
          created_by: user.id,
        } as never)
        .select('id')
        .single();
      if (offerError) throw offerError;

      // Stesso motivo per version_number su offer_versions.
      const { data: newVersion, error: versionError } = await supabase
        .from('offer_versions')
        .insert({
          offer_id: newOffer.id,
          created_by: user.id,
        } as never)
        .select('id')
        .single();
      if (versionError) throw versionError;

      // La versione corrente non si scrive più da qui: la prima versione di
      // un'offerta la assume da sé (trigger offer_versions_set_first_as_current)
      // e dopo il puntatore si muove solo all'invio, mai alla creazione di una
      // revisione. Il privilegio di UPDATE su quella colonna è stato revocato
      // proprio per impedire che due strade decidano chi è la corrente.

      // Registra l'evento di creazione nel registro append-only (transizione
      // "bozza" -> "bozza": nessun cambio di stato reale, solo la traccia).
      const { error: rpcError } = await supabase.rpc('set_offer_version_status', {
        _offer_version_id: newVersion.id,
        _new_status: 'bozza',
        _event_type: 'creata',
        _actor_type: 'user',
        _actor_user_id: user.id,
      });
      if (rpcError) throw rpcError;

      toast({ title: 'Offerta creata', description: 'La nuova offerta è stata creata in bozza.' });
      resetAndClose();
      onCreated(newOffer.id);
    } catch (error) {
      console.error('Error creating offer:', error);
      toast({ title: 'Errore', description: 'Errore durante la creazione dell\'offerta.', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isCreating) { if (!next) resetAndClose(); else onOpenChange(next); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuova offerta</DialogTitle>
          <DialogDescription>
            Seleziona il cliente e l'origine dell'offerta. Numero e anno vengono assegnati automaticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <ClientSelector
              value={clientId}
              onValueChange={setClientId}
              clients={clients}
              onClientCreated={() => refetchClients()}
              showCancelButton={false}
              triggerClassName="h-9 w-full"
              placeholder="Seleziona cliente"
            />
          </div>
          <div className="space-y-2">
            <Label>Origine</Label>
            <Select value={origin} onValueChange={(value) => setOrigin(value as OfferOrigin)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="commercial">{originLabels.commercial}</SelectItem>
                <SelectItem value="tender">{originLabels.tender}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={isCreating}>Annulla</Button>
          <Button onClick={handleCreate} disabled={isCreating || !clientId}>
            {isCreating ? 'Creazione...' : 'Crea offerta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
