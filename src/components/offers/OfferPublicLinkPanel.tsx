import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Copy, Download, ExternalLink, Link2, RefreshCw, Send, ShieldOff } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

type OfferPublicLinkRow = Database['public']['Tables']['offer_public_links']['Row'];
type OfferPublicLinkAccessRow = Database['public']['Tables']['offer_public_link_accesses']['Row'];
type OfferSignatureRow = Database['public']['Tables']['offer_signatures']['Row'];
type OfferVersionDocumentRow = Database['public']['Tables']['offer_version_documents']['Row'];

const accessOutcomeConfig: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  ok: { label: 'Aperta', variant: 'green' },
  revocato: { label: 'Link già revocato', variant: 'gray' },
  scaduto: { label: 'Link scaduto', variant: 'yellow' },
  non_trovato: { label: 'Link non riconosciuto', variant: 'destructive' },
};

const decisionConfig: Record<'accettata' | 'rifiutata', { label: string; variant: BadgeProps['variant'] }> = {
  accettata: { label: 'Accettata', variant: 'green' },
  rifiutata: { label: 'Rifiutata', variant: 'destructive' },
};

const formatDateTime = (value: string) => format(new Date(value), "d MMM yyyy 'alle' HH:mm", { locale: it });

interface OfferPublicLinkPanelProps {
  offerId: string;
  offerReference: string;
  clientEmail: string | null;
  versions: { id: string; version_number: number }[];
  canManage: boolean;
  hasSentVersion: boolean;
}

export const OfferPublicLinkPanel = ({
  offerId,
  offerReference,
  clientEmail,
  versions,
  canManage,
  hasSentVersion,
}: OfferPublicLinkPanelProps) => {
  const queryClient = useQueryClient();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'regenerate'>('create');
  const [expiryDaysInput, setExpiryDaysInput] = useState('30');
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [sendTo, setSendTo] = useState(clientEmail ?? '');
  const [sendMessage, setSendMessage] = useState('');

  const versionIds = useMemo(() => versions.map((v) => v.id), [versions]);
  const versionNumberById = useMemo(() => {
    const map = new Map<string, number>();
    versions.forEach((v) => map.set(v.id, v.version_number));
    return map;
  }, [versions]);

  // Tutti i link mai creati per l'offerta (non solo quello attivo): un link
  // rigenerato smette di funzionare, ma le sue aperture restano nella storia
  // e vanno mostrate comunque (vedi query "offer-public-link-accesses").
  const { data: links = [], isLoading: isLoadingLinks } = useQuery({
    queryKey: ['offer-public-links', offerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_public_links')
        .select('*')
        .eq('offer_id', offerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as OfferPublicLinkRow[];
    },
    enabled: !!offerId,
  });

  const activeLink = links.find((l) => !l.revoked_at) ?? null;
  const linkIds = useMemo(() => links.map((l) => l.id), [links]);

  const { data: accesses = [], isLoading: isLoadingAccesses } = useQuery({
    queryKey: ['offer-public-link-accesses', offerId, linkIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_public_link_accesses')
        .select('*')
        .in('public_link_id', linkIds)
        .order('accessed_at', { ascending: false });
      if (error) throw error;
      return data as OfferPublicLinkAccessRow[];
    },
    enabled: linkIds.length > 0,
  });

  const { data: signatures = [] } = useQuery({
    queryKey: ['offer-signatures', offerId, versionIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_signatures')
        .select('*')
        .in('offer_version_id', versionIds)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as OfferSignatureRow[];
    },
    enabled: versionIds.length > 0,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['offer-version-documents', offerId, versionIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_version_documents')
        .select('*')
        .in('offer_version_id', versionIds);
      if (error) throw error;
      return data as OfferVersionDocumentRow[];
    },
    enabled: versionIds.length > 0,
  });

  const invalidateLinkQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['offer-public-links', offerId] });
    queryClient.invalidateQueries({ queryKey: ['offer-public-link-accesses', offerId] });
  };

  const createLinkMutation = useMutation({
    mutationFn: async (expiresInDays: number | null) => {
      const { data, error } = await supabase.rpc('create_offer_public_link', {
        _offer_id: offerId,
        _expires_in_days: expiresInDays ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateLinkQueries();
      toast.success(dialogMode === 'create' ? 'Link generato' : 'Link rigenerato');
      setCreateDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error('Impossibile generare il link', { description: error.message });
    },
  });

  const revokeLinkMutation = useMutation({
    mutationFn: async (publicLinkId: string) => {
      const { error } = await supabase.rpc('revoke_offer_public_link', { _public_link_id: publicLinkId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateLinkQueries();
      toast.success('Link revocato');
      setRevokeDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error('Impossibile revocare il link', { description: error.message });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async ({ to, message }: { to: string; message: string }) => {
      const { data, error } = await supabase.functions.invoke('offer-send-to-client', {
        body: {
          offer_id: offerId,
          to: to.trim() || undefined,
          message: message.trim() || undefined,
        },
      });
      if (error) {
        let serverMessage: string | undefined;
        if (error instanceof FunctionsHttpError) {
          try {
            const body = await error.context.json();
            serverMessage = body?.error;
          } catch {
            // risposta non json: si usa il messaggio generico sotto
          }
        }
        throw new Error(serverMessage || error.message || 'Invio non riuscito');
      }
      return data as { ok: boolean; sent_to: string; link_url: string };
    },
    onSuccess: (data) => {
      toast.success('Offerta inviata', { description: `Email inviata a ${data.sent_to}.` });
      setSendMessage('');
      invalidateLinkQueries();
    },
    onError: (error: Error) => {
      toast.error('Invio non riuscito', { description: error.message });
    },
  });

  const publicUrl = activeLink ? `${window.location.origin}/offerta/${activeLink.token}` : null;

  const handleCopy = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    toast.success('Link copiato negli appunti');
  };

  const handleDownload = async (path: string) => {
    const { data, error } = await supabase.storage.from('offer-documents').createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      toast.error('Impossibile generare il link di download', { description: error?.message });
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const openCreateDialog = (mode: 'create' | 'regenerate') => {
    setDialogMode(mode);
    setExpiryDaysInput('30');
    setCreateDialogOpen(true);
  };

  const submitCreateDialog = () => {
    const trimmed = expiryDaysInput.trim();
    const days = trimmed === '' ? null : Number(trimmed);
    createLinkMutation.mutate(days);
  };

  const okAccesses = accesses.filter((a) => a.outcome === 'ok');
  const rejectedAccesses = accesses.filter((a) => a.outcome !== 'ok');
  // accesses è ordinato per accessed_at desc: il primo elemento è l'apertura
  // più recente, l'ultimo è la più vecchia.
  const firstOpenedAt = okAccesses.length > 0 ? okAccesses[okAccesses.length - 1].accessed_at : null;
  const lastOpenedAt = okAccesses.length > 0 ? okAccesses[0].accessed_at : null;

  const documentsWithPdf = documents.filter((d) => d.pdf_path);

  return (
    <div className="stack-lg">
      {!hasSentVersion && (
        <Alert>
          <AlertDescription>
            Questa offerta non ha ancora una versione inviata: invia una versione prima di generare il link pubblico
            o di scrivere al cliente.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Link pubblico</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingLinks ? (
            <p className="text-sm text-muted-foreground">Caricamento...</p>
          ) : !activeLink ? (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <p className="text-sm text-muted-foreground">Nessun link attivo per questa offerta.</p>
              {canManage && (
                <Button onClick={() => openCreateDialog('create')} disabled={!hasSentVersion}>
                  <Link2 className="h-4 w-4 mr-2" />
                  Genera link
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input readOnly value={publicUrl ?? ''} className="font-mono text-sm" />
                <Button variant="outline" size="icon" onClick={handleCopy} title="Copia link">
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" asChild title="Apri in una nuova scheda">
                  <a href={publicUrl ?? '#'} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Creato il {formatDateTime(activeLink.created_at)}
                {activeLink.expires_at ? ` · Scade il ${formatDateTime(activeLink.expires_at)}` : ' · Non scade'}
              </p>
              {activeLink.sent_count > 0 && (
                <p className="text-xs text-muted-foreground">
                  Inviato {activeLink.sent_count} volt{activeLink.sent_count === 1 ? 'a' : 'e'}
                  {activeLink.last_sent_at && <>, l'ultima il {formatDateTime(activeLink.last_sent_at)}</>}
                  {activeLink.last_sent_to && <> a {activeLink.last_sent_to}</>}.
                </p>
              )}
              {canManage && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openCreateDialog('regenerate')}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Rigenera
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRevokeDialogOpen(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <ShieldOff className="h-4 w-4 mr-2" />
                    Revoca
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invio al cliente</CardTitle>
          <CardDescription>Manda al cliente il link per aprire, valutare e firmare l'offerta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!clientEmail && (
            <Alert>
              <AlertDescription>
                Il cliente non ha un indirizzo email in anagrafica: inseriscine uno qui sotto per inviare l'offerta.
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="offer-send-to">Indirizzo email</Label>
            <Input
              id="offer-send-to"
              type="email"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              placeholder="cliente@azienda.it"
              disabled={!canManage}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="offer-send-message">Messaggio (opzionale)</Label>
            <Textarea
              id="offer-send-message"
              value={sendMessage}
              onChange={(e) => setSendMessage(e.target.value)}
              placeholder="Un messaggio da aggiungere all'email, oltre al link"
              rows={3}
              disabled={!canManage}
            />
          </div>
          {canManage && (
            <div className="flex justify-end">
              <Button
                onClick={() => sendMutation.mutate({ to: sendTo, message: sendMessage })}
                disabled={sendMutation.isPending || !sendTo.trim() || !hasSentVersion}
              >
                <Send className="h-4 w-4 mr-2" />
                {sendMutation.isPending ? 'Invio...' : 'Invia al cliente'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stato del link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="data-label mb-1">Aperture del cliente</p>
            {isLoadingAccesses ? (
              <p className="text-sm text-muted-foreground">Caricamento...</p>
            ) : okAccesses.length === 0 ? (
              <p className="text-sm text-muted-foreground">Il cliente non ha ancora aperto il link.</p>
            ) : (
              <p className="text-sm">
                Aperta {okAccesses.length} volt{okAccesses.length === 1 ? 'a' : 'e'}. Prima apertura il{' '}
                {formatDateTime(firstOpenedAt as string)}
                {okAccesses.length > 1 && <>, l'ultima il {formatDateTime(lastOpenedAt as string)}</>}.
              </p>
            )}
          </div>

          {rejectedAccesses.length > 0 && (
            <div>
              <p className="data-label mb-1">Tentativi respinti</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Esito</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rejectedAccesses.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm">{formatDateTime(a.accessed_at)}</TableCell>
                      <TableCell>
                        <Badge variant={accessOutcomeConfig[a.outcome]?.variant ?? 'gray'}>
                          {accessOutcomeConfig[a.outcome]?.label ?? a.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{String(a.client_ip ?? '-')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div>
            <p className="data-label mb-1">Decisione del cliente</p>
            {signatures.length === 0 ? (
              <p className="text-sm text-muted-foreground">Il cliente non ha ancora accettato né rifiutato.</p>
            ) : (
              <div className="space-y-3">
                {signatures.map((s) => (
                  <div key={s.id} className="rounded-md border p-3 flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={decisionConfig[s.decision].variant}>{decisionConfig[s.decision].label}</Badge>
                        <span className="text-sm text-muted-foreground">
                          versione {versionNumberById.get(s.offer_version_id) ?? '-'}
                        </span>
                      </div>
                      <p className="text-sm">
                        <strong>{s.signer_name}</strong>
                        {s.signer_role ? ` · ${s.signer_role}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(s.created_at)} · IP {s.client_ip}
                      </p>
                      {s.decision === 'rifiutata' && s.reject_reason && (
                        <p className="text-sm text-muted-foreground italic">"{s.reject_reason}"</p>
                      )}
                    </div>
                    {s.signed_pdf_path && (
                      <Button variant="outline" size="sm" onClick={() => handleDownload(s.signed_pdf_path as string)}>
                        <Download className="h-4 w-4 mr-2" />
                        PDF firmato
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {documentsWithPdf.length > 0 && (
            <div>
              <p className="data-label mb-1">Documenti archiviati</p>
              <div className="space-y-2">
                {documentsWithPdf.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">
                      Versione {versionNumberById.get(d.offer_version_id) ?? '-'}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => handleDownload(d.pdf_path as string)}>
                      <Download className="h-4 w-4 mr-2" />
                      Scarica PDF
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode === 'create' ? 'Genera link pubblico' : 'Rigenera link pubblico'}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'create'
                ? `Crea un link pubblico per l'offerta ${offerReference}, da condividere con il cliente.`
                : 'Il link attuale smetterà di funzionare: chi lo ha ricevuto dovrà usare quello nuovo.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="expiry-days">Scadenza (giorni)</Label>
            <Input
              id="expiry-days"
              type="number"
              min={1}
              value={expiryDaysInput}
              onChange={(e) => setExpiryDaysInput(e.target.value)}
              placeholder="Nessuna scadenza"
            />
            <p className="text-xs text-muted-foreground">Lascia vuoto per un link che non scade.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Annulla
            </Button>
            <Button onClick={submitCreateDialog} disabled={createLinkMutation.isPending}>
              {createLinkMutation.isPending
                ? 'Generazione...'
                : dialogMode === 'create'
                ? 'Genera link'
                : 'Rigenera link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revocare il link?</AlertDialogTitle>
            <AlertDialogDescription>
              Se il cliente ha già ricevuto questo link, da questo momento non funzionerà più: si troverà davanti a
              una porta chiusa. Genera un nuovo link se deve continuare ad accedere all'offerta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => activeLink && revokeLinkMutation.mutate(activeLink.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoca
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
