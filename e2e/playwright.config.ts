import { defineConfig, devices } from '@playwright/test';

/**
 * Configurazione a sé per i test end to end di questo cantiere.
 *
 * Il `playwright.config.ts` nella radice importa `lovable-agent-playwright-config`,
 * che non è tra le dipendenze installate: usarlo fallirebbe prima ancora di
 * partire. Questa configurazione non lo tocca e non lo sostituisce, si lancia
 * esplicitamente:
 *
 *   export E2E_SERVICE_ROLE_KEY=$(security find-generic-password -s supabase-staging-service_role -a "$USER" -w)
 *   npx playwright test -c e2e/playwright.config.ts
 *
 * I test girano contro lo staging (le variabili di `.env.local` puntano lì) e
 * usano la porta 5180 per non litigare con un `npm run dev` già aperto.
 */
const PORT = Number(process.env.E2E_PORT ?? 5180);

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'telefono', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
