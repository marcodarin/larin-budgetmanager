import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Paperclip, Plus, Trash2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/utils';
import {
  friendlyTenderError,
  tenderOutcomeConfig,
  tenderOutcomeLabels,
  type OfferAttachmentRow,
  type TenderOutcome,
  type TenderPipelineRow,
} from './types';

interface TenderDetail {
  id: string;
  tender_subject: string | null;
  tender_reference: string | null;
  tender_submission_deadline: string | null;
  tender_estimated_value: number | null;
  tender_outcome: TenderOutcome | null;
  tender_outcome_note: string | null;
}

interface TenderDetailDialogProps {
  tender: TenderPipelineRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onChanged: () => void;
}

const isValidHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

export const TenderDetailDialog = ({ tender, open, onOpenChange, canManage, onChanged }: TenderDetailDialogProps) => {
  const queryClient = useQueryClient();
  const offerId = tender?.offer_id ?? null;

  const [subject, setSubject] = useState('');
  const [reference, setReference] = useState('');
  const [deadline, setDeadline] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [outcome, setOutcome] = useState<TenderOutcome>('in_corso');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [showAddAttachment, setShowAddAttachment] = useState(false);
  const [attachmentTitle, setAttachmentTitle] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentKind, setAttachmentKind] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');
  const [isSavingAttachment, setIsSavingAttachment] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);

  const { data: detail } = useQuery({
    queryKey: ['tender-detail', offerId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('offers')
        .select('id, tender_subject, tender_reference, tender_submission_deadline, tender_estimated_value, tender_outcome, tender_outcome_note')
        .eq('id', offerId)
        .single();
      if (error) throw error;
      return data as TenderDetail;
    },
    enabled: open && !!offerId,
  });

  const { data: attachments = [], refetch: refetchAttachments } = useQuery({
    queryKey: ['tender-attachments', offerId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)('offer_attachments')
        .select('*')
        .eq('offer_id', offerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as OfferAttachmentRow[];
    },
    enabled: open && !!offerId,
  });

  useEffect(() => {
    if (!detail) return;
    setSubject(detail.tender_subject ?? '');
    setReference(detail.tender_reference ?? '');
    setDeadline(detail.tender_submission_deadline ?? '');
    setEstimatedValue(detail.tender_estimated_value != null ? String(detail.tender_estimated_value) : '');
    setOutcome(detail.tender_outcome ?? 'in_corso');
    setOutcomeNote(detail.tender_outcome_note ?? '');
  }, [detail]);

  useEffect(() => {
    if (open) {
      setShowAddAttachment(false);
      setAttachmentTitle('');
      setAttachmentUrl('');
      setAttachmentKind('');
      setAttachmentNote('');
    }
  }, [open]);

  if (!tender) return null;

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tender-detail', offerId] });
    queryClient.invalidateQueries({ queryKey: ['tenders-list'] });
    onChanged();
  };

  const handleSave = async () => {
    if (!subject.trim()) {
      toast.error('L\'oggetto della gara è obbligatorio.');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await (supabase.from as any)('offers')
        .update({
          tender_subject: subject.trim(),
          tender_reference: reference.trim() || null,
          tender_submission_deadline: deadline || null,
          tender_estimated_value: estimatedValue ? parseFloat(estimatedValue) : null,
          tender_outcome: outcome,
          tender_outcome_note: outcomeNote.trim() || null,
        })
        .eq('id', offerId);
      if (error) throw error;

      toast.success('Gara aggiornata.');
      refreshAll();
    } catch (error) {
      console.error('Error updating tender:', error);
      const message = error instanceof Error
        ? friendlyTenderError({ code: (error as { code?: string }).code, message: error.message })
        : 'Errore durante il salvataggio.';
      toast.error('Salvataggio non riuscito', { description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddAttachment = async () => {
    if (!attachmentTitle.trim()) {
      toast.error('Il titolo dell\'allegato è obbligatorio.');
      return;
    }
    if (!isValidHttpUrl(attachmentUrl)) {
      toast.error('Il link deve essere un indirizzo http o https (es. un link a Google Drive).');
      return;
    }

    setIsSavingAttachment(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase.from as any)('offer_attachments').insert({
        offer_id: offerId,
        title: attachmentTitle.trim(),
        external_url: attachmentUrl.trim(),
        kind: attachmentKind.trim() || null,
        note: attachmentNote.trim() || null,
        added_by: user?.id ?? null,
      });
      if (error) throw error;

      toast.success('Allegato aggiunto.');
      setShowAddAttachment(false);
      setAttachmentTitle('');
      setAttachmentUrl('');
      setAttachmentKind('');
      setAttachmentNote('');
      refetchAttachments();
      refreshAll();
    } catch (error) {
      console.error('Error adding attachment:', error);
      toast.error('Aggiunta non riuscita', { description: error instanceof Error ? error.message : 'Errore imprevisto.' });
    } finally {
      setIsSavingAttachment(false);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    setDeletingAttachmentId(id);
    try {
      const { error } = await (supabase.from as any)('offer_attachments').delete().eq('id', id);
      if (error) throw error;
      toast.success('Allegato rimosso.');
      refetchAttachments();
      refreshAll();
    } catch (error) {
      console.error('Error deleting attachment:', error);
      toast.error('Rimozione non riuscita', { description: error instanceof Error ? error.message : 'Errore imprevisto.' });
    } finally {
      setDeletingAttachmentId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tender.number}/{tender.year}
            <Badge variant={tenderOutcomeConfig[tender.tender_outcome].variant}>
              {tenderOutcomeConfig[tender.tender_outcome].label}
            </Badge>
          </DialogTitle>
          <DialogDescription>{tender.client_name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tender-detail-subject">Oggetto della gara *</Label>
            <Input
              id="tender-detail-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tender-detail-reference">Riferimento</Label>
              <Input id="tender-detail-reference" value={reference} onChange={(e) => setReference(e.target.value)} disabled={!canManage} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tender-detail-deadline">Scadenza presentazione</Label>
              <Input
                id="tender-detail-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                disabled={!canManage}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tender-detail-value">Valore stimato (€)</Label>
              <Input
                id="tender-detail-value"
                type="number"
                min="0"
                step="0.01"
                value={estimatedValue}
                onChange={(e) => setEstimatedValue(e.target.value)}
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label>Esito</Label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as TenderOutcome)} disabled={!canManage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(tenderOutcomeLabels) as TenderOutcome[]).map((o) => (
                    <SelectItem key={o} value={o}>{tenderOutcomeLabels[o]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tender-detail-outcome-note">Nota sull'esito</Label>
            <Textarea
              id="tender-detail-outcome-note"
              rows={2}
              value={outcomeNote}
              onChange={(e) => setOutcomeNote(e.target.value)}
              placeholder="Facoltativa"
              disabled={!canManage}
            />
          </div>
          {tender.offered_total != null && (
            <p className="helper-text">
              Offerta economica collegata: {formatCurrency(Number(tender.offered_total))} ({tender.stato_versione}).
            </p>
          )}

          {canManage && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Salvataggio...' : 'Salva modifiche'}</Button>
            </div>
          )}

          <div className="section-divider space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="label-text flex items-center gap-2"><Paperclip className="h-4 w-4" /> Allegati</h4>
              {canManage && !showAddAttachment && (
                <Button size="sm" variant="outline" onClick={() => setShowAddAttachment(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Aggiungi
                </Button>
              )}
            </div>

            {showAddAttachment && (
              <div className="rounded-md border p-3 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="attachment-title">Titolo *</Label>
                  <Input id="attachment-title" value={attachmentTitle} onChange={(e) => setAttachmentTitle(e.target.value)} placeholder="Es. Offerta tecnica firmata" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="attachment-url">Link *</Label>
                  <Input id="attachment-url" value={attachmentUrl} onChange={(e) => setAttachmentUrl(e.target.value)} placeholder="https://drive.google.com/..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="attachment-kind">Tipo</Label>
                    <Input id="attachment-kind" value={attachmentKind} onChange={(e) => setAttachmentKind(e.target.value)} placeholder="Es. offerta tecnica" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="attachment-note">Nota</Label>
                    <Input id="attachment-note" value={attachmentNote} onChange={(e) => setAttachmentNote(e.target.value)} placeholder="Facoltativa" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowAddAttachment(false)} disabled={isSavingAttachment}>Annulla</Button>
                  <Button size="sm" onClick={handleAddAttachment} disabled={isSavingAttachment}>
                    {isSavingAttachment ? 'Salvataggio...' : 'Salva allegato'}
                  </Button>
                </div>
              </div>
            )}

            {attachments.length === 0 ? (
              <p className="empty-state-text text-sm">Nessun allegato collegato.</p>
            ) : (
              <ul className="space-y-2">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-md border p-2 gap-2">
                    <div className="min-w-0">
                      <a
                        href={a.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline font-medium truncate"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" /> {a.title}
                      </a>
                      <p className="helper-text truncate">
                        {a.kind && <span>{a.kind}</span>}
                        {a.kind && a.note && ' · '}
                        {a.note}
                      </p>
                    </div>
                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteAttachment(a.id)}
                        disabled={deletingAttachmentId === a.id}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
