/**
 * @komerce-arch-lite
 * @role hub-v1-business-film-config
 * @domain dashboard
 * @layer test-config
 * @owner backend-core
 * @purpose Config du film métier Hub V1 (Chromium 1440x900, séquentiel, staging officiel uniquement ; répétition locale explicitement opt-in).
 * @impact-areas dashboard, hub, staging-only
 */
'use strict';
const { defineConfig } = require('@playwright/test');
const STAGING = 'https://komerce-backend-production.up.railway.app';
const rehearsal = process.env.E2E_FILM_REHEARSAL === '1';
const baseURL = process.env.E2E_STAGING_BASE_URL || STAGING;
const origin = new URL(baseURL).origin;
if (origin !== STAGING && !(rehearsal && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
  throw new Error('FILM_TARGET_REFUSED: staging officiel (ou localhost avec E2E_FILM_REHEARSAL=1)');
}
module.exports = defineConfig({
  testDir: './tests/staging-canonical',
  testMatch: 'hub-v1-business-film.spec.js',
  outputDir: 'test-results/hub-v1-film/raw',
  timeout: 1800000, retries: 0, workers: 1, fullyParallel: false,
  reporter: [['line'], ['json', { outputFile: 'test-results/hub-v1-film/playwright.json' }]],
  projects: [{ name: 'film-desktop', use: { viewport: { width: 1440, height: 900 } } }],
  // video/trace volontairement coupés ici : la spec les démarre APRÈS login, dans un contexte neuf.
  use: { baseURL, browserName: 'chromium', headless: process.env.E2E_FILM_HEADED !== '1', video: 'off', trace: 'off', screenshot: 'off', actionTimeout: 15000, navigationTimeout: 30000 },
});
