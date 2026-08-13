-- =============================================================================
-- Immutabilità del contenuto di una versione già uscita
-- =============================================================================
-- La migration precedente protegge lo stato e il registro eventi, ma lascia
-- modificabili righe e totali di una versione già inviata. Senza questo vincolo
-- il versioning è una finzione: si potrebbe alterare ciò che il cliente ha già
-- ricevuto (o firmato) senza che ne resti traccia, e il documento archiviato
-- smetterebbe di corrispondere a quello che ha visto.
--
-- Regola: il contenuto si modifica SOLO finché la versione è in bozza. Dopo,
-- si crea una versione nuova. Nessuna eccezione per ruolo: un amministratore
-- che corregge in silenzio è esattamente il caso che questo vincolo esclude.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Contenuto della versione (totali, condizioni, validità)
-- -----------------------------------------------------------------------------
-- Nota: lo stato è già protetto dalla guardia esistente, e viene escluso da
-- questo controllo perché la transizione di stato è proprio ciò che deve
-- restare possibile su una versione non più in bozza.
create or replace function public.guard_offer_version_content_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'bozza' then
      raise exception 'Non si elimina una versione già uscita (stato %): crearne una nuova.', old.status
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'bozza' then
    return new;
  end if;

  -- Su una versione non più in bozza si tollera solo il cambio di stato
  -- (gestito dalla sua guardia) e l'aggiornamento tecnico di updated_at.
  if new.list_total     is distinct from old.list_total
     or new.offered_total is distinct from old.offered_total
     or new.payment_terms is distinct from old.payment_terms
     or new.valid_until   is distinct from old.valid_until
     or new.offer_id      is distinct from old.offer_id
     or new.version_number is distinct from old.version_number then
    raise exception 'Il contenuto di una versione già uscita (stato %) non è modificabile: crearne una nuova.', old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_offer_versions_content_immutable on public.offer_versions;
create trigger trg_offer_versions_content_immutable
  before update or delete on public.offer_versions
  for each row execute function public.guard_offer_version_content_immutable();

-- -----------------------------------------------------------------------------
-- 2) Righe della versione
-- -----------------------------------------------------------------------------
-- Vale per inserimento, modifica ed eliminazione: aggiungere una riga a
-- un'offerta già inviata è la stessa alterazione del modificarne una.
create or replace function public.guard_offer_lines_immutable()
returns trigger
language plpgsql
as $$
declare
  v_status public.offer_status;
  v_version_id uuid;
begin
  v_version_id := coalesce(new.offer_version_id, old.offer_version_id);
  select status into v_status from public.offer_versions where id = v_version_id;

  -- Versione già sparita (cancellazione a cascata di una bozza): niente da difendere.
  if v_status is null then
    return coalesce(new, old);
  end if;

  if v_status <> 'bozza' then
    raise exception 'Le righe di una versione già uscita (stato %) non sono modificabili: crearne una nuova.', v_status
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_offer_lines_immutable on public.offer_lines;
create trigger trg_offer_lines_immutable
  before insert or update or delete on public.offer_lines
  for each row execute function public.guard_offer_lines_immutable();

comment on function public.guard_offer_version_content_immutable() is
  'Impedisce di alterare il contenuto di una versione non più in bozza: dopo l''invio si crea una versione nuova.';
comment on function public.guard_offer_lines_immutable() is
  'Stessa regola sulle righe: nessun inserimento, modifica o eliminazione su una versione già uscita.';
