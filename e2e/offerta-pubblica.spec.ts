import { test, expect, type Page } from '@playwright/test';
import { creaOffertaInviata, serviceClient, statoVersione, type OffertaDiProva } from './helpers/offerta-di-prova';

/**
 * Il percorso che decide se questo cantiere serve a qualcosa: un cliente riceve
 * un link, apre, legge, firma. Gira contro lo staging vero, con la edge
 * function deployata, non contro risposte finte: le uniche risposte simulate
 * sono quelle degli stati che sui dati veri non si riescono a produrre a
 * comando (il documento cambiato sotto le mani di chi sta firmando).
 */

const db = serviceClient();

/** Disegna un tratto sul canvas di firma, come farebbe un dito. */
async function firma(page: Page) {
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();
}

async function compila(page: Page, nome = 'Chiara Ferretti', ruolo = 'Amministratore delegato') {
  await page.getByLabel('Nome e cognome *').fill(nome);
  await page.getByLabel('Ruolo').fill(ruolo);
  await page.getByLabel('Email').fill('chiara.ferretti@example.com');
  await page.getByRole('checkbox').check();
}

test.describe('la pagina che il cliente apre', () => {
  test('mostra il documento e i suoi numeri', async ({ page }) => {
    const offerta = await creaOffertaInviata(db);
    await page.goto(`/offerta/${offerta.token}`);

    await expect(page.getByRole('heading', { name: `Offerta ${offerta.reference}` })).toBeVisible();
    await expect(page.getByText('Aurora Manifatture Srl').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Analisi strategica e piano di comunicazione').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('12.250,00 €').filter({ visible: true }).first()).toBeVisible();

    // Il piano di pagamento si legge come una frase, non come un record.
    await expect(page.getByText(/40% alla firma, pagamento a 30 giorni data documento/)).toBeVisible();
    await expect(page.getByText(/30% alla consegna/)).toBeVisible();

    // Le condizioni allegate sono solo quelle pertinenti ai prodotti offerti.
    await expect(page.getByText(/Le presenti condizioni valgono per tutte le attività/)).toBeVisible();
  });

  test('la prima apertura porta la versione a vista', async ({ page }) => {
    const offerta = await creaOffertaInviata(db);
    expect(await statoVersione(db, offerta.versionId)).toBe('inviata');

    await page.goto(`/offerta/${offerta.token}`);
    await expect(page.getByRole('heading', { name: `Offerta ${offerta.reference}` })).toBeVisible();

    expect(await statoVersione(db, offerta.versionId)).toBe('vista');
  });

  test('non si accetta senza nome, spunta e firma', async ({ page }) => {
    const offerta = await creaOffertaInviata(db);
    await page.goto(`/offerta/${offerta.token}`);

    const accetta = page.getByRole('button', { name: 'Accetta e firma' });
    await expect(accetta).toBeDisabled();

    await page.getByLabel('Nome e cognome *').fill('Chiara Ferretti');
    await expect(accetta).toBeDisabled();

    await page.getByRole('checkbox').check();
    await expect(accetta).toBeDisabled();

    await firma(page);
    await expect(accetta).toBeEnabled();

    // Cancellando la firma il pulsante deve tornare indietro: firmare, ripensarci
    // e accettare comunque produrrebbe un'accettazione senza tratto.
    await page.getByRole('button', { name: 'Cancella firma' }).click();
    await expect(accetta).toBeDisabled();
  });

  test('il cliente firma e riceve il documento firmato', async ({ page }) => {
    const offerta = await creaOffertaInviata(db);
    await page.goto(`/offerta/${offerta.token}`);

    await compila(page);
    await firma(page);
    await page.getByRole('button', { name: 'Accetta e firma' }).click();

    await expect(page.getByText('Offerta accettata e firmata').first()).toBeVisible({ timeout: 30_000 });

    expect(await statoVersione(db, offerta.versionId)).toBe('accettata');

    const { data: firmaSalvata } = await db
      .from('offer_signatures')
      .select('signer_name, signer_role, decision, document_hash, signature_image_path, signed_pdf_path')
      .eq('offer_version_id', offerta.versionId)
      .single();

    expect(firmaSalvata?.decision).toBe('accettata');
    expect(firmaSalvata?.signer_name).toBe('Chiara Ferretti');
    expect(firmaSalvata?.signer_role).toBe('Amministratore delegato');
    // L'hash registrato è quello del documento congelato: è ciò che dimostra
    // cosa è stato firmato, e deve coincidere, non somigliare.
    expect(firmaSalvata?.document_hash).toBe(offerta.documentHash);
    expect(firmaSalvata?.signature_image_path).toBeTruthy();
    expect(firmaSalvata?.signed_pdf_path).toBeTruthy();
  });

  test('riaprendo il link dopo la firma non si firma una seconda volta', async ({ page }) => {
    const offerta = await creaOffertaInviata(db);
    await page.goto(`/offerta/${offerta.token}`);
    await compila(page);
    await firma(page);
    await page.getByRole('button', { name: 'Accetta e firma' }).click();
    await expect(page.getByText('Offerta accettata e firmata').first()).toBeVisible({ timeout: 30_000 });

    await page.goto(`/offerta/${offerta.token}`);
    await expect(page.getByRole('heading', { name: `Offerta ${offerta.reference}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accetta e firma' })).toHaveCount(0);
    // Non si limita a dire che non si può firmare: dice chi ha firmato e quando,
    // che è la cosa che il cliente vuole sapere quando riapre il link.
    await expect(page.getByText('Offerta accettata e firmata').first()).toBeVisible();
    await expect(page.getByText(/Chiara Ferretti/)).toBeVisible();
  });

  test('un link revocato lo dice al cliente', async ({ page }) => {
    const offerta = await creaOffertaInviata(db);
    // La RPC di revoca vuole un utente autenticato (verifica can_manage_offer);
    // qui parliamo col service role, che un utente non ce l'ha, quindi si revoca
    // direttamente. La RPC resta provata dai test SQL, dove l'utente c'è.
    const { error: erroreRevoca } = await db
      .from('offer_public_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token', offerta.token);
    expect(erroreRevoca).toBeNull();

    await page.goto(`/offerta/${offerta.token}`);
    await expect(page.getByText('Link non più attivo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accetta e firma' })).toHaveCount(0);
  });

  test('un link inventato non rivela nulla', async ({ page }) => {
    await page.goto('/offerta/questo-token-non-esiste-e-non-deve-dire-niente-di-utile');
    await expect(page.getByText(/non valido|non esiste|non trovat/i).first()).toBeVisible();
    // Nessun riferimento a offerte, clienti o dettagli interni nella pagina.
    await expect(page.locator('body')).not.toContainText('Aurora Manifatture');
  });

  test('se il documento cambia mentre il cliente firma, la firma non passa', async ({ page }) => {
    const offerta = await creaOffertaInviata(db);
    await page.goto(`/offerta/${offerta.token}`);
    await compila(page);
    await firma(page);

    // Il conflitto vero (una revisione inviata mentre la pagina è aperta) non è
    // riproducibile a comando senza sporcare l'offerta: si simula la risposta
    // che il database produce davvero in quel caso, verificata nei test SQL.
    await page.route('**/functions/v1/offer-public', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Il documento è cambiato da quando è stato aperto: ricaricare la pagina prima di firmare' }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'Accetta e firma' }).click();
    await expect(page.getByText(/aggiornata nel frattempo/i).first()).toBeVisible({ timeout: 15_000 });

    // E soprattutto: nel database non deve esserci nessuna firma.
    const { count } = await db
      .from('offer_signatures')
      .select('id', { count: 'exact', head: true })
      .eq('offer_version_id', offerta.versionId);
    expect(count ?? 0).toBe(0);
  });
});

test.describe('il caso del prezzo unico omnicomprensivo', () => {
  test('non espone i prezzi di riga quando non sommano al totale', async ({ page }) => {
    const offerta: OffertaDiProva = await creaOffertaInviata(db, { varianteSenzaPrezziDiRiga: true });
    await page.goto(`/offerta/${offerta.token}`);

    await expect(page.getByRole('heading', { name: `Offerta ${offerta.reference}` })).toBeVisible();
    await expect(page.getByText('11.500,00 €').filter({ visible: true }).first()).toBeVisible();
    // I prezzi delle singole voci sono una scelta commerciale che qui non si fa.
    await expect(page.getByText('6.750,00 €')).toHaveCount(0);
    await expect(page.getByText('3.500,00 €')).toHaveCount(0);
  });
});
