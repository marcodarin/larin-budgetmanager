/**
 * Gare: offerte con origine tender (blocco B8). A colpo d'occhio: le scadenze
 * di presentazione che arrivano (evidenziando scaduto e imminente), l'esito,
 * e gli allegati esterni. Si crea senza righe e senza prezzo (AD-10).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { hasPermission } from '@/lib/permissions';
import { TendersTable } from '@/components/tenders/TendersTable';
import { CreateTenderDialog } from '@/components/tenders/CreateTenderDialog';
import { TenderDetailDialog } from '@/components/tenders/TenderDetailDialog';
import type { TenderPipelineRow } from '@/components/tenders/types';

type UserRole = 'admin' | 'account' | 'finance' | 'team_leader' | 'coordinator' | 'member' | 'external';

const Tenders = () => {
  const queryClient = useQueryClient();
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedTender, setSelectedTender] = useState<TenderPipelineRow | null>(null);

  useEffect(() => {
    const fetchUserRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
      setUserRole(roleData?.role as UserRole | null);
    };
    fetchUserRole();
  }, []);

  // Stessa policy di "chi gestisce le offerte" (admin, account, finance):
  // una gara è un'offerta con origine imposta, non un dominio a parte.
  const canManage = hasPermission(userRole, 'canCreateQuotes');

  // tender_pipeline non è ancora nei tipi generati: vedi la nota in
  // components/tenders/types.ts.
  const {
    data: tenders = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['tenders-list'],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('tender_pipeline').select('*');
      if (error) throw error;
      return data as TenderPipelineRow[];
    },
  });

  const inCorso = tenders.filter((t) => t.tender_outcome === 'in_corso');
  const inScadenza7gg = inCorso.filter((t) => t.giorni_alla_scadenza != null && t.giorni_alla_scadenza >= 0 && t.giorni_alla_scadenza <= 7);
  const scadute = inCorso.filter((t) => t.giorni_alla_scadenza != null && t.giorni_alla_scadenza < 0);
  const valoreInCorso = inCorso.reduce((acc, t) => acc + Number(t.tender_estimated_value ?? 0), 0);

  return (
    <div className="page-container stack-lg">
      <div className="page-header-with-actions">
        <div>
          <h1 className="page-title">Gare</h1>
          <p className="page-subtitle">Scadenze di presentazione, esito e allegati.</p>
        </div>
        {canManage && (
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nuova gara
          </Button>
        )}
      </div>

      <div className="grid-stats">
        <div className="stat-card">
          <div className="stat-value">{inCorso.length}</div>
          <div className="stat-label">Gare in corso</div>
        </div>
        <div className="stat-card">
          <div className={inScadenza7gg.length > 0 ? 'stat-value text-amber-600 dark:text-amber-400' : 'stat-value'}>
            {inScadenza7gg.length}
          </div>
          <div className="stat-label">In scadenza entro 7 giorni</div>
        </div>
        <div className="stat-card">
          <div className={scadute.length > 0 ? 'stat-value text-destructive' : 'stat-value'}>{scadute.length}</div>
          <div className="stat-label">Scadute senza esito</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatCurrency(valoreInCorso)}</div>
          <div className="stat-label">Valore stimato in corso</div>
        </div>
      </div>

      <Card variant="static">
        <CardHeader variant="compact">
          <CardTitle className="text-lg">Tutte le gare</CardTitle>
          <CardDescription>
            Una gara persa per una scadenza dimenticata è il solo modo di perderla senza nemmeno provarci.
          </CardDescription>
        </CardHeader>
        <CardContent variant="table">
          <TendersTable rows={tenders} isLoading={isLoading} onRowClick={setSelectedTender} />
        </CardContent>
      </Card>

      <CreateTenderDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={() => refetch()}
      />

      <TenderDetailDialog
        tender={selectedTender}
        open={!!selectedTender}
        onOpenChange={(open) => { if (!open) setSelectedTender(null); }}
        canManage={canManage}
        onChanged={() => {
          refetch();
          queryClient.invalidateQueries({ queryKey: ['tenders-list'] });
        }}
      />
    </div>
  );
};

export default Tenders;
