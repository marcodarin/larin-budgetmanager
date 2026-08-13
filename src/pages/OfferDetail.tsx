import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { hasPermission } from '@/lib/permissions';
import { OfferStatusSelector, offerStatusConfig } from '@/components/OfferStatusSelector';
import { OfferPaymentPlanSection } from '@/components/OfferPaymentPlanSection';
import { OfferPublicLinkPanel } from '@/components/offers/OfferPublicLinkPanel';
import type { Database } from '@/integrations/supabase/types';

type OfferLineRow = Database['public']['Tables']['offer_lines']['Row'];
type OfferVersionRow = Database['public']['Tables']['offer_versions']['Row'];
type UserRole = 'admin' | 'account' | 'finance' | 'team_leader' | 'coordinator' | 'member' | 'external';

type OfferDetailRow = {
  id: string;
  year: number;
  number: number;
  project_id: string | null;
  current_version_id: string | null;
  clients: { id: string; name: string; email: string | null } | null;
  projects: { id: string; name: string } | null;
};

const productNatureLabels: Record<string, string> = {
  una_tantum: 'una tantum',
  ricorrente: 'ricorrente',
  a_giornate: 'a giornate',
};

const OfferDetail = () => {
  const { offerId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [editingLines, setEditingLines] = useState<OfferLineRow[]>([]);
  const [offeredTotalValue, setOfferedTotalValue] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const [showAddLineDialog, setShowAddLineDialog] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [lineQuantity, setLineQuantity] = useState(1);
  const [lineUnitPrice, setLineUnitPrice] = useState(0);
  const [lineDiscount, setLineDiscount] = useState(0);

  useEffect(() => {
    const fetchUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
      setUserRole(roleData?.role as UserRole | null);
    };
    fetchUserRole();
  }, []);

  const { data: offer, isLoading: isLoadingOffer } = useQuery({
    queryKey: ['offer', offerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select(`
          id, year, number, project_id, current_version_id,
          clients ( id, name, email ),
          projects ( id, name )
        `)
        .eq('id', offerId)
        .single();
      if (error) throw error;
      return data as unknown as OfferDetailRow;
    },
    enabled: !!offerId,
  });

  const { data: versions = [], isLoading: isLoadingVersions, refetch: refetchVersions } = useQuery({
    queryKey: ['offer-versions', offerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_versions')
        .select('*')
        .eq('offer_id', offerId as string)
        .order('version_number', { ascending: false });
      if (error) throw error;
      return data as OfferVersionRow[];
    },
    enabled: !!offerId,
  });

  // Seleziona di default la versione corrente dell'offerta, o l'ultima
  // creata se current_version_id non è (ancora) valorizzato.
  useEffect(() => {
    if (!offer || versions.length === 0) return;
    setSelectedVersionId((prev) => {
      if (prev && versions.some((v) => v.id === prev)) return prev;
      if (offer.current_version_id && versions.some((v) => v.id === offer.current_version_id)) {
        return offer.current_version_id;
      }
      return versions[0].id;
    });
  }, [offer, versions]);

  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? null;

  const { data: lines = [], refetch: refetchLines } = useQuery({
    queryKey: ['offer-lines', selectedVersionId],
    queryFn: async () => {
      if (!selectedVersionId) return [];
      const { data, error } = await supabase
        .from('offer_lines')
        .select('*')
        .eq('offer_version_id', selectedVersionId)
        .order('display_order');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedVersionId,
  });

  // Catalogo prodotti condiviso (stessa fonte usata da Impostazioni > Prodotti):
  // non filtrato per utente creatore, coerente con la RLS "approved users can
  // manage products" oggi in vigore.
  const { data: availableProducts = [] } = useQuery({
    queryKey: ['products-catalog'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    setEditingLines(lines);
  }, [lines]);

  useEffect(() => {
    if (selectedVersion) {
      setOfferedTotalValue(Number(selectedVersion.offered_total) || 0);
    }
  }, [selectedVersion?.id, selectedVersion?.offered_total]);

  const listTotal = useMemo(
    () => editingLines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unit_list_price), 0),
    [editingLines]
  );
  const effectiveDiscountPct = listTotal > 0 ? ((listTotal - offeredTotalValue) / listTotal) * 100 : 0;

  const canManage = hasPermission(userRole, 'canEditQuotes');
  const isBozza = selectedVersion?.status === 'bozza';
  const canEditContent = canManage && isBozza;

  const resetAddLineForm = () => {
    setSelectedProductId('');
    setLineQuantity(1);
    setLineUnitPrice(0);
    setLineDiscount(0);
  };

  const updateLine = (
    id: string,
    field: 'description' | 'revenue_category' | 'quantity' | 'unit_list_price' | 'discount_percentage' | 'vat_rate',
    value: string | number
  ) => {
    setEditingLines((prev) => prev.map((line) => {
      if (line.id !== id) return line;
      const updated = { ...line, [field]: value };
      if (field === 'quantity' || field === 'unit_list_price' || field === 'discount_percentage') {
        const qty = Number(updated.quantity);
        const price = Number(updated.unit_list_price);
        const discount = Number(updated.discount_percentage);
        updated.line_total = Math.round(qty * price * (1 - discount / 100) * 100) / 100;
      }
      return updated;
    }));
  };

  const removeLine = async (id: string) => {
    if (!confirm('Sei sicuro di voler rimuovere questa riga?')) return;
    const { error } = await supabase.from('offer_lines').delete().eq('id', id);
    if (error) {
      console.error('Error removing offer line:', error);
      toast({ title: 'Errore', description: 'Errore durante la rimozione della riga.', variant: 'destructive' });
      return;
    }
    setEditingLines((prev) => prev.filter((l) => l.id !== id));
    toast({ title: 'Riga rimossa', description: 'La riga è stata rimossa dall\'offerta.' });
  };

  const handleAddLine = async () => {
    if (!selectedVersionId || !selectedProductId) return;
    const product = availableProducts.find((p) => p.id === selectedProductId);
    if (!product) return;

    const maxOrder = editingLines.reduce((max, l) => Math.max(max, l.display_order), 0);
    const lineTotal = Math.round(lineQuantity * lineUnitPrice * (1 - lineDiscount / 100) * 100) / 100;

    try {
      const { data, error } = await supabase
        .from('offer_lines')
        .insert({
          offer_version_id: selectedVersionId,
          product_id: product.id,
          description: product.name,
          revenue_category: product.revenue_category,
          quantity: lineQuantity,
          unit_list_price: lineUnitPrice,
          discount_percentage: lineDiscount,
          vat_rate: product.vat_rate,
          line_total: lineTotal,
          display_order: maxOrder + 1,
        })
        .select()
        .single();
      if (error) throw error;

      setEditingLines((prev) => [...prev, data]);
      setShowAddLineDialog(false);
      resetAddLineForm();
      toast({ title: 'Riga aggiunta', description: 'Il prodotto è stato aggiunto all\'offerta.' });
    } catch (error) {
      console.error('Error adding offer line:', error);
      toast({ title: 'Errore', description: 'Errore durante l\'aggiunta della riga.', variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    if (!selectedVersionId) return;
    setIsSaving(true);
    try {
      for (const line of editingLines) {
        const { error } = await supabase
          .from('offer_lines')
          .update({
            description: line.description,
            revenue_category: line.revenue_category,
            quantity: line.quantity,
            unit_list_price: line.unit_list_price,
            discount_percentage: line.discount_percentage,
            vat_rate: line.vat_rate,
            line_total: line.line_total,
          })
          .eq('id', line.id);
        if (error) throw error;
      }

      const { error: versionError } = await supabase
        .from('offer_versions')
        .update({
          list_total: Math.round(listTotal * 100) / 100,
          offered_total: Math.round(offeredTotalValue * 100) / 100,
        })
        .eq('id', selectedVersionId);
      if (versionError) throw versionError;

      toast({ title: 'Modifiche salvate', description: 'La composizione dell\'offerta è stata aggiornata.' });
      refetchLines();
      refetchVersions();
    } catch (error) {
      console.error('Error saving offer:', error);
      toast({ title: 'Errore', description: 'Errore durante il salvataggio delle modifiche.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingOffer || isLoadingVersions) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Offerta non trovata</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container stack-lg">
      <Button variant="ghost" size="sm" onClick={() => navigate('/offers')}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Torna alle offerte
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="data-label">Offerta</p>
              <p className="text-2xl font-bold">{offer.number}/{offer.year}</p>
              <p className="text-sm text-muted-foreground">
                {offer.clients?.name || '-'}
                {offer.projects?.name && ` · Progetto: ${offer.projects.name}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {versions.length > 1 ? (
                <Select value={selectedVersionId ?? undefined} onValueChange={setSelectedVersionId}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        Versione {v.version_number}{v.id === offer.current_version_id ? ' (corrente)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : versions[0] ? (
                <span className="text-sm text-muted-foreground">Versione {versions[0].version_number}</span>
              ) : null}
              {selectedVersion && (
                <OfferStatusSelector
                  offerVersionId={selectedVersion.id}
                  currentStatus={selectedVersion.status}
                  onStatusChange={refetchVersions}
                  readOnly={!canManage}
                />
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {selectedVersion && !isBozza && (
        <Alert>
          <AlertDescription>
            Questa versione è in stato "{offerStatusConfig[selectedVersion.status].label}": righe, totali e le tranche del piano di pagamento non sono più modificabili (la maturazione delle tranche resta registrabile). Per applicare modifiche al contenuto serve una nuova versione.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Composizione offerta</CardTitle>
            {canEditContent && (
              <Button variant="outline" size="sm" onClick={() => setShowAddLineDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Aggiungi riga
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editingLines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nessuna riga in questa offerta</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Categoria di ricavo</TableHead>
                  <TableHead className="text-right">Quantità</TableHead>
                  <TableHead className="text-right">Prezzo unit. (listino)</TableHead>
                  <TableHead className="text-right">Sconto %</TableHead>
                  <TableHead className="text-right">IVA %</TableHead>
                  <TableHead className="text-right">Totale riga</TableHead>
                  {canEditContent && <TableHead className="w-[50px]"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {editingLines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">
                      {canEditContent ? (
                        <Input
                          value={line.description}
                          onChange={(e) => updateLine(line.id, 'description', e.target.value)}
                          className="min-w-[180px]"
                        />
                      ) : line.description}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {canEditContent ? (
                        <Input
                          value={line.revenue_category || ''}
                          onChange={(e) => updateLine(line.id, 'revenue_category', e.target.value)}
                          className="min-w-[150px]"
                        />
                      ) : (line.revenue_category || '-')}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEditContent ? (
                        <Input
                          type="number"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.id, 'quantity', Number(e.target.value))}
                          className="w-20 text-right"
                          min="0.01"
                          step="0.01"
                        />
                      ) : line.quantity}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEditContent ? (
                        <Input
                          type="number"
                          value={line.unit_list_price}
                          onChange={(e) => updateLine(line.id, 'unit_list_price', Number(e.target.value))}
                          className="w-24 text-right"
                          min="0"
                          step="0.01"
                        />
                      ) : `€${Number(line.unit_list_price).toFixed(2)}`}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEditContent ? (
                        <Input
                          type="number"
                          value={line.discount_percentage}
                          onChange={(e) => updateLine(line.id, 'discount_percentage', Number(e.target.value))}
                          className="w-20 text-right"
                          min="0"
                          max="100"
                          step="0.01"
                        />
                      ) : `${Number(line.discount_percentage).toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEditContent ? (
                        <Select value={String(line.vat_rate)} onValueChange={(v) => updateLine(line.id, 'vat_rate', Number(v))}>
                          <SelectTrigger className="w-20 ml-auto"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="22">22%</SelectItem>
                            <SelectItem value="10">10%</SelectItem>
                            <SelectItem value="4">4%</SelectItem>
                            <SelectItem value="0">0%</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : `${Number(line.vat_rate).toFixed(0)}%`}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      €{Number(line.line_total).toFixed(2)}
                    </TableCell>
                    {canEditContent && (
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => removeLine(line.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riepilogo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Totale di listino</span>
            <span className="font-medium">€{listTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Totale offerto</span>
            {canEditContent ? (
              <Input
                type="number"
                value={offeredTotalValue}
                onChange={(e) => setOfferedTotalValue(Number(e.target.value))}
                className="w-32 text-right"
                min="0"
                step="0.01"
              />
            ) : (
              <span className="font-medium">€{offeredTotalValue.toFixed(2)}</span>
            )}
          </div>
          <div className="border-t pt-2 mt-2 flex justify-between text-lg font-bold">
            <span>Sconto effettivo</span>
            <span>{effectiveDiscountPct.toFixed(1)}%</span>
          </div>
          {canEditContent && (
            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Salvataggio...' : 'Salva modifiche'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedVersion && (
        <OfferPaymentPlanSection
          offerVersionId={selectedVersion.id}
          offeredTotal={offeredTotalValue}
          billingMode={selectedVersion.billing_mode}
          canManage={canManage}
          isBozza={isBozza}
          onBillingModeChange={refetchVersions}
        />
      )}

      {versions.some((v) => v.status !== 'bozza') && (
        <OfferPublicLinkPanel
          offerId={offer.id}
          offerReference={`${offer.year}/${offer.number}`}
          clientEmail={offer.clients?.email ?? null}
          versions={versions}
          canManage={canManage}
          // create_offer_public_link (e l'invio, che la richiama se manca un
          // link) richiedono la versione CORRENTE inviata: "fuori dalla
          // bozza" non basta più da quando current_version_id si muove solo
          // all'invio (in_approvazione non lo imposta ancora).
          hasSentVersion={versions.some((v) => v.id === offer.current_version_id && v.status !== 'bozza')}
        />
      )}

      <Dialog open={showAddLineDialog} onOpenChange={(open) => { setShowAddLineDialog(open); if (!open) resetAddLineForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aggiungi riga</DialogTitle>
            <DialogDescription>Seleziona un prodotto dal listino e specifica quantità, prezzo e sconto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Prodotto</Label>
              <Select
                value={selectedProductId}
                onValueChange={(value) => {
                  setSelectedProductId(value);
                  const product = availableProducts.find((p) => p.id === value);
                  if (product) setLineUnitPrice(Number(product.net_price));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Seleziona prodotto" /></SelectTrigger>
                <SelectContent>
                  {availableProducts.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                      {product.product_nature && ` (${productNatureLabels[product.product_nature] || product.product_nature})`}
                      {' · '}€{Number(product.net_price).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Quantità</Label>
                <Input type="number" value={lineQuantity} onChange={(e) => setLineQuantity(Number(e.target.value))} min="0.01" step="0.01" />
              </div>
              <div className="space-y-2">
                <Label>Prezzo unitario (€)</Label>
                <Input type="number" value={lineUnitPrice} onChange={(e) => setLineUnitPrice(Number(e.target.value))} min="0" step="0.01" />
              </div>
              <div className="space-y-2">
                <Label>Sconto riga (%)</Label>
                <Input type="number" value={lineDiscount} onChange={(e) => setLineDiscount(Number(e.target.value))} min="0" max="100" step="0.01" />
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Totale riga: €{(lineQuantity * lineUnitPrice * (1 - lineDiscount / 100)).toFixed(2)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLineDialog(false)}>Annulla</Button>
            <Button onClick={handleAddLine} disabled={!selectedProductId}>Aggiungi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OfferDetail;
