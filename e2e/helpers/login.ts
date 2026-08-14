import type { Page } from '@playwright/test';

/** Password condivisa da tutti gli utenti di staging usati nei test. */
export const PASSWORD_STAGING = 'Cambiami123!';

/** Accede con un utente di staging attraverso il vero form di login. */
export async function login(page: Page, email: string, password: string = PASSWORD_STAGING) {
  await page.goto('/auth');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Accedi con email' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15_000 });
  await chiudiTourDiBenvenuto(page);
}

/**
 * Il tour di benvenuto di TimeTrap compare sopra tutto al primo accesso di un
 * utente e intercetta i click: senza chiuderlo, qualunque test che apra un
 * dialog resta in attesa di un elemento che esiste ma non è raggiungibile, e
 * l'errore che si legge parla del selettore sbagliato. Va chiuso qui, una volta,
 * invece che in ogni test.
 */
export async function chiudiTourDiBenvenuto(page: Page) {
  const salta = page.getByRole('button', { name: /salta tour/i });
  try {
    await salta.waitFor({ state: 'visible', timeout: 4000 });
    await salta.click();
    await salta.waitFor({ state: 'detached', timeout: 4000 });
  } catch {
    // Il tour non è comparso: è già stato chiuso in una sessione precedente
    // (lo stato è sul profilo dell'utente), e non c'è niente da fare.
  }
}
