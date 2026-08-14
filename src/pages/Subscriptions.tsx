/**
 * Abbonamenti e canoni ricorrenti (blocco B7). Risponde a tre domande: quanto
 * vale il ricorrente (con la quota a rischio nei prossimi novanta giorni),
 * quali rinnovi stanno arrivando ed entro quando va data la disdetta, e cosa
 * contiene ogni abbonamento (canone corrente, storia, periodi).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { Plus, RefreshCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SubscriptionsTable } from '@/components/subscriptions/SubscriptionsTable';
import { CreateSubscriptionDialog } from '@/components/subscriptions/CreateSubscriptionDialog';
import { SubscriptionDetailDialog } from '@/components/subscriptions/SubscriptionDetailDialog';
import { periodicityLabels, type RecurringValueSummaryRow, type SubscriptionListRow, type SubscriptionRenewalRow } from '@/components/subscriptions/types';

type UserRole = 'admin' | 'account' | 'finance' | 'team_leader' | 'coordinator' | 'member' | 'external';

const Subscriptions = () => {
  const queryClient = useQueryClient();
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionListRow | null>(null);

  useEffect(() => {
    const fetchUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
      setUserRole(roleData?.role as UserRole | null);
    };
    fetchUserRole();
  }, []);

  // Gli abbonamenti li scrivono i ruoli commerciali (can_manage_subscriptions
  // lato database: admin, account, finance), la lettura è aperta a ogni utente
  // approvato.
  const canManage = userRole === 'admin' || userRole === 'account' || userRole === 'finance';

  // Tabelle e viste degli abbonamenti non sono ancora nei tipi generati
  // (src/integrations/supabase/types.ts): vedi la nota nel rapporto di
  // consegna e in components/subscriptions/types.ts.
  const { data: summary, isLoading: isLoadingSummary } = useQuery({
    queryKey: ['recurring-value-summary'],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('recurring_value_summary').select('*').single();
      if (error) throw error;
      return data as RecurringValueSummaryRow;
    },
  });

  const { data: renewals = [], isLoading: isLoadingRenewals } = useQuery({
    queryKey: ['subscription-renewals'],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('subscription_renewals').select('*');
      if (error) throw error;
      return (data as SubscriptionRenewalRow[]).sort((a, b) => {
        if (!a.notice_deadline) return 1;
        if (!b.notice_deadline) return -1;
        return a.notice_deadline.localeCompare(b.notice_deadline);
      });
    },
  });

  const {
    data: subscriptions = [],
    isLoading: isLoadingSubscriptions,
    refetch: refetchSubscriptions,
  } = useQuery({
    queryKey: ['subscriptions-list'],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('subscriptions')
        .select('*, clients ( id, name ), subscription_amounts ( * )')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as SubscriptionListRow[];
    },
  });

  const refreshEverything = () => {
    refetchSubscriptions();
    queryClient.invalidateQueries({ queryKey: ['recurring-value-summary'] });
    queryClient.invalidateQueries({ queryKey: ['subscription-renewals'] });
  };

  // Tiene allineata l'intestazione del dettaglio aperto (stato, disdetta) con
  // l'elenco appena riaggiornato, senza dover richiudere e riaprire il dialog.
  useEffect(() => {
    if (!selectedSubscription) return;
    const updated = subscriptions.find((s) => s.id === selectedSubscription.id);
    if (updated && updated !== selectedSubscription) setSelectedSubscription(updated);
  }, [subscriptions]);

  const isLoading = isLoadingSummary || isLoadingRenewals || isLoadingSubscriptions;

  return (
    <div className="page-container stack-lg">
      <div className="page-header-with-actions">
        <div>
          <h1 className="page-title">Abbonamenti</h1>
          <p className="page-subtitle">Canoni ricorrenti: rinnovi, disdette e valore del ricorrente.</p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nuovo abbonamento
          </Button>
        )}
      </div>

      <div className="grid-stats">
        <div className="stat-card">
          <div className="stat-value">{summary ? formatCurrency(Number(summary.ricorrente_mensile)) : '-'}</div>
          <div className="stat-label">Ricorrente mensile</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary ? formatCurrency(Number(summary.ricorrente_annuo)) : '-'}</div>
          <div className="stat-label">Ricorrente annuo</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary?.abbonamenti_attivi ?? '-'}</div>
          <div className="stat-label">Abbonamenti attivi</div>
        </div>
        <div className="stat-card">
          <div className={cn('stat-value', Number(summary?.mensile_a_rischio_90_giorni ?? 0) > 0 && 'text-amber-600 dark:text-amber-400')}>
            {summary ? formatCurrency(Number(summary.mensile_a_rischio_90_giorni)) : '-'}
          </div>
          <div className="stat-label">A rischio nei prossimi 90 giorni</div>
        </div>
      </div>

      <Card variant="static">
        <CardHeader variant="compact">
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" /> Rinnovi in avvicinamento
          </CardTitle>
          <CardDescription>
            Entro quando va data la disdetta: l'informazione conta solo prima che scada.
          </CardDescription>
        </CardHeader>
        <CardContent variant="table">
          {renewals.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-text">Nessun rinnovo in vista nei prossimi quattro mesi.</p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Periodicità</TableHead>
                    <TableHead className="text-right">Canone</TableHead>
                    <TableHead>Fine impegno</TableHead>
                    <TableHead>Disdetta entro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renewals.map((r) => {
                    const daysToDeadline = r.notice_deadline
                      ? differenceInCalendarDays(parseISO(r.notice_deadline), new Date())
                      : null;
                    const overdue = daysToDeadline !== null && daysToDeadline < 0;
                    const urgent = daysToDeadline !== null && daysToDeadline >= 0 && daysToDeadline <= 30;
                    return (
                      <TableRow key={r.subscription_id}>
                        <TableCell className="font-medium">{r.client_name}</TableCell>
                        <TableCell className="max-w-[220px] truncate" title={r.description}>{r.description}</TableCell>
                        <TableCell>{periodicityLabels[r.periodicity]}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {r.canone_corrente != null ? formatCurrency(Number(r.canone_corrente)) : '-'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.end_date ? format(parseISO(r.end_date), 'dd/MM/yyyy') : '-'}
                          {!r.auto_renew && <span className="helper-text block">non si rinnova</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.notice_deadline ? (
                            <span
                              className={cn(
                                'text-sm font-medium',
                                overdue && 'text-destructive font-semibold',
                                urgent && 'text-amber-600 dark:text-amber-400'
                              )}
                            >
                              {format(parseISO(r.notice_deadline), 'dd/MM/yyyy')}
                              {overdue && ' · scaduto, rinnovo automatico'}
                              {urgent && ' · urgente'}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">nessun preavviso configurato</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card variant="static">
        <CardHeader variant="compact">
          <CardTitle className="text-lg">Tutti gli abbonamenti</CardTitle>
          <CardDescription>Clicca una riga per vedere canone, storia e periodi.</CardDescription>
        </CardHeader>
        <CardContent variant="table">
          <SubscriptionsTable
            rows={subscriptions}
            isLoading={isLoading}
            onRowClick={setSelectedSubscription}
          />
        </CardContent>
      </Card>

      <CreateSubscriptionDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={refreshEverything}
      />

      <SubscriptionDetailDialog
        subscription={selectedSubscription}
        open={!!selectedSubscription}
        onOpenChange={(open) => { if (!open) setSelectedSubscription(null); }}
        canManage={canManage}
        onChanged={refreshEverything}
      />
    </div>
  );
};

export default Subscriptions;
