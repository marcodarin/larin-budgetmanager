import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Plus, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { hasPermission } from '@/lib/permissions';
import { OfferStatusSelector, offerStatusConfig } from '@/components/OfferStatusSelector';
import { CreateOfferDialog } from '@/components/CreateOfferDialog';
import { TableNameCell } from '@/components/ui/table-name-cell';
import { Constants, type Database } from '@/integrations/supabase/types';

type OfferStatus = Database['public']['Enums']['offer_status'];
type UserRole = 'admin' | 'account' | 'finance' | 'team_leader' | 'coordinator' | 'member' | 'external';

type OfferListRow = {
  id: string;
  year: number;
  number: number;
  created_at: string;
  clients: { id: string; name: string } | null;
  current_version: { id: string; status: OfferStatus; offered_total: number } | null;
};

const Offers = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useEffect(() => {
    const fetchUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
      setUserRole(roleData?.role as UserRole | null);
    };
    fetchUserRole();
  }, []);

  const {
    data: offers = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['offers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offers')
        .select(`
          id, year, number, created_at,
          clients ( id, name ),
          current_version:offer_versions!offers_current_version_id_fkey ( id, status, offered_total )
        `)
        .order('year', { ascending: false })
        .order('number', { ascending: false })
        .returns<OfferListRow[]>();
      if (error) throw error;
      return data;
    },
  });

  const uniqueClients = useMemo(() => {
    const names = offers.filter((o) => o.clients?.name).map((o) => o.clients!.name);
    return [...new Set(names)].sort();
  }, [offers]);

  const filteredOffers = useMemo(() => {
    let filtered = offers;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((offer) =>
        `${offer.number}`.includes(term) ||
        `${offer.number}/${offer.year}`.includes(term) ||
        offer.clients?.name?.toLowerCase().includes(term)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((offer) => offer.current_version?.status === statusFilter);
    }

    if (clientFilter !== 'all') {
      filtered = filtered.filter((offer) => offer.clients?.name === clientFilter);
    }

    return filtered;
  }, [offers, searchTerm, statusFilter, clientFilter]);

  const canCreate = hasPermission(userRole, 'canCreateQuotes');
  const canEditStatus = hasPermission(userRole, 'canEditQuotes');

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container stack-lg">
      <div className="page-header-with-actions">
        <h1 className="page-title">Offerte</h1>
        {canCreate && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nuova offerta
          </Button>
        )}
      </div>

      <Card variant="static">
        <CardHeader variant="compact">
          <div className="flex items-center justify-between mb-4">
            <p className="data-label">
              Totale: {filteredOffers.length} {filteredOffers.length === 1 ? 'offerta' : 'offerte'}
              {searchTerm && ` (${offers.length} totali)`}
            </p>
          </div>
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca per numero o cliente..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtra per stato" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti gli stati</SelectItem>
                {Constants.public.Enums.offer_status.map((status) => (
                  <SelectItem key={status} value={status}>
                    {offerStatusConfig[status].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtra per cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i clienti</SelectItem>
                {uniqueClients.map((client) => (
                  <SelectItem key={client} value={client}>
                    {client}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent variant="table">
          {filteredOffers.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchTerm || statusFilter !== 'all' || clientFilter !== 'all'
                  ? 'Nessuna offerta trovata con i criteri di ricerca.'
                  : 'Nessuna offerta creata ancora.'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N° Offerta</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="text-right">Totale offerto</TableHead>
                    <TableHead>Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOffers.map((offer) => (
                    <TableRow key={offer.id}>
                      <TableCell className="font-medium">
                        <TableNameCell
                          name={`${offer.number}/${offer.year}`}
                          href={`/offers/${offer.id}`}
                          onClick={() => navigate(`/offers/${offer.id}`)}
                        />
                      </TableCell>
                      <TableCell>{offer.clients?.name || '-'}</TableCell>
                      <TableCell>
                        {offer.current_version ? (
                          <OfferStatusSelector
                            offerVersionId={offer.current_version.id}
                            currentStatus={offer.current_version.status}
                            onStatusChange={refetch}
                            readOnly={!canEditStatus}
                          />
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {offer.current_version
                          ? `€${Number(offer.current_version.offered_total).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {format(new Date(offer.created_at), 'dd/MM/yy', { locale: it })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateOfferDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={(offerId) => navigate(`/offers/${offerId}`)}
      />
    </div>
  );
};

export default Offers;
