import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClientSelector } from '@/components/ClientSelector';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllClients } from '@/lib/fetchAllClients';
import { friendlySubscriptionError, periodicityLabels, type SubscriptionPeriodicity } from './types';

interface CreateSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface Product {
  id: string;
  code: string;
  name: string;
}

const NONE_PRODUCT = 'none';

export const CreateSubscriptionDialog = ({ open, onOpenChange, onCreated }: CreateSubscriptionDialogProps) => {
  const [clientId, setClientId] = useState('');
  const [description, setDescription] = useState('');
  const [periodicity, setPeriodicity] = useState<SubscriptionPeriodicity>('mensile');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [noticeDays, setNoticeDays] = useState('');
  const [documentKind, setDocumentKind] = useState<'fattura' | 'proforma'>('fattura');
  const [generateDaysBefore, setGenerateDaysBefore] = useState('15');
  const [productId, setProductId] = useState(NONE_PRODUCT);
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState('22');
  const [amountValidTo, setAmountValidTo] = useState('');
  const [note, setNote] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const { data: clients = [], refetch: refetchClients } = useQuery({
    queryKey: ['all-clients-for-subscriptions'],
    queryFn: () => fetchAllClients<{ id: string; name: string }>('id, name'),
    enabled: open,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['recurring-products-for-subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, code, name')
        .eq('product_nature', 'ricorrente')
        .order('name')
        .returns<Product[]>();
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const resetForm = () => {
    setClientId('');
    setDescription('');
    setPeriodicity('mensile');
    setStartDate(format(new Date(), 'yyyy-MM-dd'));
    setEndDate('');
    setAutoRenew(true);
    setNoticeDays('');
    setDocumentKind('fattura');
    setGenerateDaysBefore('15');
    setProductId(NONE_PRODUCT);
    setAmount('');
    setVatRate('22');
    setAmountValidTo('');
    setNote('');
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
      toast.error('Seleziona un cliente.');
      return;
    }
    if (!description.trim()) {
      toast.error('La descrizione è obbligatoria.');
      return;
    }
    if (!startDate) {
      toast.error('La data di inizio è obbligatoria.');
      return;
    }
    if (endDate && endDate < startDate) {
      toast.error('La data di fine non può precedere la data di inizio.');
      return;
    }
    const amountValue = parseFloat(amount);
    if (!amount || Number.isNaN(amountValue) || amountValue <= 0) {
      toast.error('Indica il canone iniziale (un importo maggiore di zero).');
      return;
    }
    if (amountValidTo && amountValidTo <= startDate) {
      toast.error('La fine del canone iniziale deve essere successiva alla data di inizio.');
      return;
    }

    setIsCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Utente non autenticato');

      // subscriptions/subscription_amounts non sono ancora nei tipi generati:
      // vedi la nota in ./types.ts.
      const { data: newSubscription, error: subError } = await (supabase.from as any)('subscriptions')
        .insert({
          client_id: clientId,
          description: description.trim(),
          periodicity,
          start_date: startDate,
          end_date: endDate || null,
          auto_renew: autoRenew,
          notice_days: noticeDays ? parseInt(noticeDays, 10) : null,
          document_kind: documentKind,
          generate_days_before: generateDaysBefore ? parseInt(generateDaysBefore, 10) : 15,
          product_id: productId === NONE_PRODUCT ? null : productId,
          created_by: user.id,
        })
        .select('id')
        .single();
      if (subError) throw subError;

      const { error: amountError } = await (supabase.from as any)('subscription_amounts').insert({
        subscription_id: newSubscription.id,
        amount: amountValue,
        vat_rate: vatRate ? parseFloat(vatRate) : 22,
        valid_from: startDate,
        valid_to: amountValidTo || null,
        note: note.trim() || null,
        created_by: user.id,
      });
      if (amountError) throw amountError;

      toast.success('Abbonamento creato.');
      onOpenChange(false);
      onCreated();
    } catch (error) {
      console.error('Error creating subscription:', error);
      const message = error instanceof Error
        ? friendlySubscriptionError({ code: (error as { code?: string }).code, message: error.message })
        : 'Errore durante la creazione dell\'abbonamento.';
      toast.error('Creazione non riuscita', { description: message });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeAndReset(); else onOpenChange(next); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuovo abbonamento</DialogTitle>
          <DialogDescription>
            Il canone indicato qui sotto è quello valido dall'inizio. Variazioni successive si registrano dal
            dettaglio dell'abbonamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Cliente *</Label>
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
            <Label htmlFor="sub-description">Descrizione *</Label>
            <Input
              id="sub-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Es. Assistenza e manutenzione software"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Periodicità *</Label>
              <Select value={periodicity} onValueChange={(v) => setPeriodicity(v as SubscriptionPeriodicity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['mensile', 'trimestrale', 'annuale'] as const).map((p) => (
                    <SelectItem key={p} value={p}>{periodicityLabels[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prodotto collegato</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_PRODUCT}>Nessuno</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sub-start">Data di inizio *</Label>
              <Input id="sub-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-end">Data di fine</Label>
              <Input id="sub-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              <p className="helper-text">Lascia vuoto per un impegno a tempo indeterminato con rinnovo.</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="sub-auto-renew">Rinnovo automatico</Label>
              <p className="helper-text">Se disattivato, l'abbonamento termina alla data di fine senza rinnovarsi.</p>
            </div>
            <Switch id="sub-auto-renew" checked={autoRenew} onCheckedChange={setAutoRenew} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sub-notice">Giorni di preavviso disdetta</Label>
              <Input
                id="sub-notice"
                type="number"
                min="0"
                value={noticeDays}
                onChange={(e) => setNoticeDays(e.target.value)}
                placeholder="Es. 60"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-generate-before">Giorni di anticipo fatturazione</Label>
              <Input
                id="sub-generate-before"
                type="number"
                min="0"
                value={generateDaysBefore}
                onChange={(e) => setGenerateDaysBefore(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Documento da generare</Label>
            <Select value={documentKind} onValueChange={(v) => setDocumentKind(v as 'fattura' | 'proforma')}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fattura">Fattura</SelectItem>
                <SelectItem value="proforma">Proforma</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="section-divider space-y-4">
            <h4 className="label-text">Canone iniziale</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sub-amount">Importo (€) *</Label>
                <Input
                  id="sub-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sub-vat">Aliquota IVA (%)</Label>
                <Input id="sub-vat" type="number" min="0" step="0.01" value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-amount-valid-to">Valido fino al</Label>
              <Input
                id="sub-amount-valid-to"
                type="date"
                value={amountValidTo}
                onChange={(e) => setAmountValidTo(e.target.value)}
              />
              <p className="helper-text">
                Lascia vuoto se è il canone attuale. Compilalo solo se è già noto un cambio futuro (es. un aumento
                concordato a contratto): dopo la creazione non è più possibile chiudere questo canone da qui.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-note">Nota sul canone</Label>
              <Textarea id="sub-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facoltativa" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeAndReset} disabled={isCreating}>Annulla</Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? 'Creazione...' : 'Crea abbonamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
