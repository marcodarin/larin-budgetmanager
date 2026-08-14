import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Cloud, CheckCircle2, XCircle, RefreshCw, Trash2, Loader2, Link2, Unlink, RotateCw, AlertTriangle, PackageSearch } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';

interface Subscription {
  id: string;
  sink: string;
  types: string[];
  status: string;
}

interface ProductSyncSkip {
  code: string;
  name: string;
  reason: string;
}

interface ProductSyncResult {
  totalInFic: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: ProductSyncSkip[];
}

// Ruoli abilitati a lanciare la sincronizzazione del listino: gli stessi che
// fic-adapter accetta lato server (vedi serve() in supabase/functions/fic-adapter).
// Tenerli allineati qui evita di mostrare un pulsante che poi darebbe 403.
const PRODUCT_SYNC_ROLES = ['admin', 'account', 'finance'];

export const FattureInCloudIntegration = () => {
  const queryClient = useQueryClient();

  // Handle OAuth callback URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('fic_connected') === 'true') {
      toast.success('Account Fatture in Cloud collegato con successo!');
      window.history.replaceState({}, '', window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ['fic-connection'] });
      queryClient.invalidateQueries({ queryKey: ['fic-subscriptions'] });
    }
    const ficError = urlParams.get('fic_error');
    if (ficError) {
      const errorMessages: Record<string, string> = {
        access_denied: "Autorizzazione negata. L'utente ha rifiutato il consenso.",
        authorization_failed: 'Collegamento non riuscito. Riprova.',
      };
      toast.error(errorMessages[ficError] || `Errore collegamento: ${ficError}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [queryClient]);

  // Ruolo dell'utente corrente, per mostrare il pulsante di sync listino solo
  // a chi il backend accetterebbe comunque (vedi PRODUCT_SYNC_ROLES sopra).
  const { data: currentUserRole } = useQuery({
    queryKey: ['current-user-role-fic'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
      return data?.role ?? null;
    },
  });
  const canSyncProducts = PRODUCT_SYNC_ROLES.includes(currentUserRole ?? '');

  // Check connection status
  const { data: connectionData, isLoading: isCheckingConnection } = useQuery({
    queryKey: ['fic-connection'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fatture-in-cloud-oauth', {
        body: { action: 'check-connection' },
      });
      if (error) throw error;
      return data as { connected: boolean; companyName?: string };
    },
    retry: false,
  });

  // Check subscriptions (only when connected)
  const { data: subscriptionsData, isLoading: isLoadingSubscriptions, refetch } = useQuery({
    queryKey: ['fic-subscriptions'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fatture-in-cloud-register-webhook', {
        body: { action: 'check' },
      });
      if (error) throw error;
      return data;
    },
    enabled: connectionData?.connected === true,
    retry: false,
  });

  // Compute the URL where FIC should redirect the user back AFTER auth.
  // We must avoid landing inside the Lovable preview iframe, because
  // secure.fattureincloud.it sets X-Frame-Options: DENY and the login page
  // would be blocked ("Connessione negata da secure.fattureincloud.it").
  const getCallbackAppUrl = () => {
    try {
      const topOrigin = window.top?.location.origin;
      if (topOrigin && topOrigin === window.location.origin) {
        return window.location.origin + window.location.pathname;
      }
    } catch {
      // cross-origin top access denied → we're inside an iframe
    }
    // Fallback: published production URL
    return 'https://budget.larin.it/settings';
  };

  // Connect
  const connectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('fatture-in-cloud-oauth', {
        body: { action: 'get-auth-url', appUrl: getCallbackAppUrl() },
      });
      if (error) throw error;
      return data as { authUrl: string };
    },
    onSuccess: (data) => {
      // Open in a new top-level tab to bypass iframe X-Frame-Options block
      const w = window.open(data.authUrl, '_blank', 'noopener,noreferrer');
      if (!w) {
        // Popup blocked → try to navigate the top frame, fallback to current
        try {
          if (window.top) window.top.location.href = data.authUrl;
          else window.location.href = data.authUrl;
        } catch {
          window.location.href = data.authUrl;
        }
        toast.info('Se la finestra non si apre, consenti i popup e riprova.');
      } else {
        toast.info('Completa l\'autorizzazione nella nuova scheda, poi torna qui e clicca Aggiorna.');
      }
    },
    onError: (error: Error) => { toast.error(`Errore: ${error.message}`); },
  });

  // Disconnect
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('fatture-in-cloud-oauth', {
        body: { action: 'disconnect' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fic-connection'] });
      queryClient.invalidateQueries({ queryKey: ['fic-subscriptions'] });
      toast.success('Account scollegato');
    },
    onError: (error: Error) => { toast.error(`Errore: ${error.message}`); },
  });

  // Register webhook
  const registerMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('fatture-in-cloud-register-webhook', {
        body: { action: 'register' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fic-subscriptions'] });
      toast.success('Webhook registrato! I fornitori verranno sincronizzati automaticamente.');
    },
    onError: (error: Error) => { toast.error(`Errore: ${error.message}`); },
  });

  // Delete subscription
  const deleteMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke('fatture-in-cloud-register-webhook', {
        body: { action: 'delete', subscriptionId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fic-subscriptions'] });
      toast.success('Webhook rimosso');
    },
    onError: (error: Error) => { toast.error(`Errore: ${error.message}`); },
  });

  // Retry verification handshake for an existing subscription
  const verifyMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data, error } = await supabase.functions.invoke('fatture-in-cloud-register-webhook', {
        body: { action: 'verify', subscriptionId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Nuovo tentativo di verifica avviato. Attendi qualche secondo e clicca Aggiorna.');
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['fic-subscriptions'] });
      }, 3000);
    },
    onError: (error: Error) => { toast.error(`Errore: ${error.message}`); },
  });

  // Last sync info
  const { data: lastSyncSetting } = useQuery({
    queryKey: ['app-settings', 'fic_suppliers_last_sync'],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'fic_suppliers_last_sync')
        .maybeSingle();
      return data?.setting_value as { at?: string; created?: number; updated?: number; deleted?: number } | null;
    },
    enabled: connectionData?.connected === true,
  });

  // Manual sync now
  const syncNowMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('fatture-in-cloud-register-webhook', {
        body: { action: 'sync-all' },
      });
      if (error) throw error;
      return data as { created: number; updated: number; deleted: number; total: number; errors: string[] };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['app-settings', 'fic_suppliers_last_sync'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(`Sync completata: +${data.created} nuovi, ${data.updated} aggiornati, ${data.deleted} eliminati`);
      if (data.errors?.length) toast.warning(`${data.errors.length} errori durante il sync`);
    },
    onError: (error: Error) => { toast.error(`Errore sync: ${error.message}`); },
  });

  // Import/aggiornamento del listino prodotti da FiC (fic-adapter, operazione
  // syncProductCatalog). Ripetibile: un rilancio senza modifiche nel listino
  // FiC riporta tutto in "invariati", non ricrea nulla.
  const syncProductsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('fic-adapter', {
        body: { operation: 'syncProductCatalog', params: {} },
      });
      if (error) {
        let serverMessage: string | undefined;
        if (error instanceof FunctionsHttpError) {
          try {
            const body = await error.context.json();
            serverMessage = body?.error?.message;
          } catch {
            // risposta non json: si usa il messaggio generico sotto
          }
        }
        throw new Error(serverMessage || error.message || 'Sincronizzazione listino non riuscita');
      }
      return (data as { data: ProductSyncResult }).data;
    },
    onSuccess: (result) => {
      toast.success(
        `Listino sincronizzato: ${result.created} creati, ${result.updated} aggiornati, ${result.unchanged} invariati`,
      );
      if (result.skipped.length > 0) {
        toast.warning(`${result.skipped.length} prodotti saltati: vedi il dettaglio qui sotto`);
      }
    },
    onError: (error: Error) => { toast.error(`Errore sincronizzazione listino: ${error.message}`); },
  });

  const isConnected = connectionData?.connected === true;
  const subscriptions: Subscription[] = subscriptionsData?.subscriptions || [];
  const hasSupplierWebhook = subscriptions.some((sub) => sub.types?.some((t) => t.includes('suppliers')));
  const isLoading = isCheckingConnection || isLoadingSubscriptions;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-primary" />
          Integrazione Fatture in Cloud
        </CardTitle>
        <CardDescription>
          Sincronizza fornitori e invia preventivi a Fatture in Cloud
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            Collega il tuo account Fatture in Cloud per sincronizzare automaticamente
            i fornitori e inviare preventivi direttamente dalla piattaforma.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verifica stato integrazione...
          </div>
        ) : (
          <>
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <span className="font-medium">Account:</span>
              {isConnected ? (
                <Badge variant="default" className="bg-green-600">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Collegato{connectionData?.companyName ? ` (${connectionData.companyName})` : ''}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <XCircle className="h-3 w-3 mr-1" />
                  Non collegato
                </Badge>
              )}
            </div>

            {/* Webhook Status */}
            {isConnected && (
              <div className="flex items-center gap-2">
                <span className="font-medium">Sincronizzazione:</span>
                {hasSupplierWebhook ? (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Attiva
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <XCircle className="h-3 w-3 mr-1" />
                    Non attiva
                  </Badge>
                )}
              </div>
            )}

            {/* Active webhooks */}
            {subscriptions.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Webhook attivi:</p>
                {subscriptions.map((sub) => {
                  const verified = (sub.status || '').toLowerCase() === 'verified' || (sub.status || '').toLowerCase() === 'active';
                  return (
                    <div key={sub.id} className="flex items-center justify-between p-2 bg-muted rounded-md text-sm">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{sub.id}</span>
                          {verified ? (
                            <Badge variant="default" className="bg-green-600 text-xs">verified</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {sub.status || 'not verified'}
                            </Badge>
                          )}
                        </div>
                        <div className="text-muted-foreground text-xs">{sub.types?.join(', ')}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!verified && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => verifyMutation.mutate(sub.id)}
                            disabled={verifyMutation.isPending}
                          >
                            {verifyMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <RotateCw className="h-4 w-4 mr-1" />
                            )}
                            Riprova verifica
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(sub.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {subscriptions.some((s) => {
                  const st = (s.status || '').toLowerCase();
                  return st !== 'verified' && st !== 'active';
                }) && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Uno o più webhook non sono verificati. Clicca "Riprova verifica" per richiedere a Fatture in Cloud
                      un nuovo handshake (max 5 tentativi, uno ogni 10 minuti). In alternativa elimina la subscription
                      e ri-attiva la sincronizzazione.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Last sync info */}
            {isConnected && lastSyncSetting?.at && (
              <div className="text-xs text-muted-foreground">
                Ultima sincronizzazione manuale: {formatDistanceToNow(new Date(lastSyncSetting.at), { addSuffix: true, locale: it })}
                {' '}— +{lastSyncSetting.created ?? 0} nuovi, {lastSyncSetting.updated ?? 0} aggiornati, {lastSyncSetting.deleted ?? 0} eliminati
              </div>
            )}

            {/* Listino prodotti: indipendente dallo stato del collegamento OAuth
                sopra, con il token manuale l'import funziona anche a account
                "Non collegato" (quel badge riflette solo fic_oauth_tokens). */}
            {canSyncProducts && (
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-medium">Listino prodotti</p>
                    <p className="text-xs text-muted-foreground">
                      Importa o aggiorna in TimeTrap i prodotti del listino di Fatture in Cloud
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncProductsMutation.mutate()}
                    disabled={syncProductsMutation.isPending}
                  >
                    {syncProductsMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sincronizzazione...</>
                    ) : (
                      <><PackageSearch className="h-4 w-4 mr-2" />Sincronizza listino prodotti</>
                    )}
                  </Button>
                </div>

                {syncProductsMutation.data && (
                  <div className="text-sm space-y-1 bg-muted rounded-md p-3">
                    <p>
                      {syncProductsMutation.data.totalInFic} prodotti nel listino FiC:{' '}
                      <span className="font-medium">{syncProductsMutation.data.created} creati</span>,{' '}
                      <span className="font-medium">{syncProductsMutation.data.updated} aggiornati</span>,{' '}
                      <span className="font-medium">{syncProductsMutation.data.unchanged} invariati</span>
                    </p>
                    {syncProductsMutation.data.skipped.length > 0 && (
                      <div className="text-xs text-destructive space-y-0.5">
                        <p className="font-medium">{syncProductsMutation.data.skipped.length} saltati:</p>
                        {syncProductsMutation.data.skipped.map((s, i) => (
                          <p key={i}>{s.code} ({s.name}): {s.reason}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {!isConnected ? (
                <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
                  {connectMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Collegamento...</>
                  ) : (
                    <><Link2 className="h-4 w-4 mr-2" />Collega account Fatture in Cloud</>
                  )}
                </Button>
              ) : (
                <>
                  {!hasSupplierWebhook && (
                    <Button onClick={() => registerMutation.mutate()} disabled={registerMutation.isPending}>
                      {registerMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Attivazione...</>
                      ) : (
                        <><Cloud className="h-4 w-4 mr-2" />Attiva sincronizzazione</>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => syncNowMutation.mutate()}
                    disabled={syncNowMutation.isPending}
                  >
                    {syncNowMutation.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sincronizzazione...</>
                    ) : (
                      <><RotateCw className="h-4 w-4 mr-2" />Sincronizza fornitori ora</>
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}>
                    <Unlink className="h-4 w-4 mr-2" />
                    Scollega account
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['fic-connection'] });
                  refetch();
                }}
                disabled={isLoading}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Aggiorna
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
