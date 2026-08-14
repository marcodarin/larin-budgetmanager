import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableNameCell } from '@/components/ui/table-name-cell';
import { InvoiceQueueTable, type InvoiceQueueRowWithRef } from '@/components/invoices/InvoiceQueueTable';
import type { Database } from '@/integrations/supabase/types';

type InvoiceQueueRow = Database['public']['Tables']['invoice_queue']['Row'];
type OfferBillingSummaryRow = Database['public']['Views']['offer_billing_summary']['Row'];
type UserRole = 'admin' | 'account' | 'finance' | 'team_leader' | 'coordinator' | 'member' | 'external';

const InvoiceQueue = () => {
  const navigate = useNavigate();
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const fetchUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
      setUserRole(roleData?.role as UserRole | null);
    };
    fetchUserRole();
  }, []);

  // Le RPC di emissione/annullamento/incasso controllano esplicitamente
  // "finance o admin": "account" non è incluso nonostante altrove nell'app sia
  // trattato come equivalente ad admin, quindi qui non si può riusare quel
  // raggruppamento e va replicato lo stesso controllo lato UI.
  const canManageInvoices = userRole === 'admin' || userRole === 'finance';

  const { data: invoiceRows = [], isLoading: isLoadingInvoices } = useQuery({
    queryKey: ['invoice-queue'],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoice_queue').select('*');
      if (error) throw error;
      return data as InvoiceQueueRow[];
    },
  });

  const offerIds = useMemo(() => [...new Set(invoiceRows.map((r) => r.offer_id))], [invoiceRows]);

  const { data: offerRefs = [] } = useQuery({
    queryKey: ['invoice-queue-offer-refs', offerIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select('id, year, number, clients ( name )')
        .in('id', offerIds)
        .returns<{ id: string; year: number; number: number; clients: { name: string } | null }[]>();
      if (error) throw error;
      return data;
    },
    enabled: offerIds.length > 0,
  });

  const rowsWithRef: InvoiceQueueRowWithRef[] = useMemo(() => {
    const refById = new Map(
      offerRefs.map((o) => [o.id, { year: o.year, number: o.number, clientName: o.clients?.name ?? null }])
    );
    return invoiceRows.map((r) => {
      const ref = refById.get(r.offer_id);
      return {
        ...r,
        offer_year: ref?.year ?? null,
        offer_number: ref?.number ?? null,
        client_name: ref?.clientName ?? null,
      };
    });
  }, [invoiceRows, offerRefs]);

  const { data: billingSummary = [], isLoading: isLoadingBilling } = useQuery({
    queryKey: ['offer-billing-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_billing_summary')
        .select('*')
        .order('residuo', { ascending: false });
      if (error) throw error;
      return data as OfferBillingSummaryRow[];
    },
  });

  const previste = rowsWithRef.filter((r) => r.status === 'prevista');
  const previsteCount = previste.length;
  const previsteSum = previste.reduce((acc, r) => acc + Number(r.amount), 0);

  const today = new Date();
  const dueSoonCount = previste.filter(
    (r) => r.due_date && differenceInCalendarDays(parseISO(r.due_date), today) <= 7
  ).length;

  const residuoTotale = billingSummary.reduce((acc, r) => acc + Number(r.residuo ?? 0), 0);

  return (
    <div className="page-container stack-lg">
      <div className="page-header-with-actions">
        <div>
          <h1 className="page-title">Fatture da emettere</h1>
          <p className="page-subtitle">
            Coda di fatturazione delle offerte accettate: emissione verso Fatture in Cloud e stato dell'incasso.
          </p>
        </div>
      </div>

      <div className="grid-stats">
        <div className="stat-card">
          <div className="stat-value">{previsteCount}</div>
          <div className="stat-label">Fatture da emettere</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(previsteSum)}</div>
          <div className="stat-label">Totale da emettere</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{dueSoonCount}</div>
          <div className="stat-label">Scadute o in scadenza (7 giorni)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(residuoTotale)}</div>
          <div className="stat-label">Residuo su offerte accettate</div>
        </div>
      </div>

      <InvoiceQueueTable rows={rowsWithRef} isLoading={isLoadingInvoices} canManage={canManageInvoices} />

      <Card variant="static">
        <CardHeader variant="compact">
          <CardTitle className="text-lg">Residuo per offerta</CardTitle>
          <CardDescription>Quanto resta da fatturare su ogni offerta accettata.</CardDescription>
        </CardHeader>
        <CardContent variant="table">
          {isLoadingBilling ? (
            <div className="animate-pulse h-32 bg-muted rounded m-4" />
          ) : billingSummary.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-text">Nessuna offerta accettata ancora.</p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Offerta</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Valore</TableHead>
                    <TableHead className="text-right">Fatturato</TableHead>
                    <TableHead className="text-right">Incassato</TableHead>
                    <TableHead className="text-right">Residuo</TableHead>
                    <TableHead className="text-right">Fatture previste</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billingSummary.map((o) => (
                    <TableRow key={o.offer_id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        <TableNameCell
                          name={`${o.number}/${o.year}`}
                          href={`/offers/${o.offer_id}`}
                          onClick={() => o.offer_id && navigate(`/offers/${o.offer_id}`)}
                        />
                      </TableCell>
                      <TableCell>{o.client_name ?? '-'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCurrency(Number(o.valore ?? 0))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCurrency(Number(o.fatturato ?? 0))}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCurrency(Number(o.incassato ?? 0))}</TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap">
                        {formatCurrency(Number(o.residuo ?? 0))}
                      </TableCell>
                      <TableCell className="text-right">{o.fatture_previste}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default InvoiceQueue;
