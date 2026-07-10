/**
 * @e2e   auth.setup.js
 * @brief Authentification E2E — génère une session Playwright (storageState)
 *        UNE SEULE FOIS pour tous les tests du projet "authenticated", au lieu
 *        de refaire un flow OTP complet dans chaque test.
 *
 * Prérequis (à fournir via variables d'environnement, JAMAIS en dur) :
 *   TEST_ACCOUNT_PHONE  — numéro d'un compte de test dédié (PAS un compte réel)
 *   TEST_ACCOUNT_OTP    — code OTP pour ce compte de test
 *
 * ⚠️ Le compte de test doit être un compte réservé aux tests (staging ou
 * environnement de test explicitement isolé), jamais un compte personnel de
 * production. Le code OTP d'un compte réel envoyé par SMS ne peut pas être
 * lu automatiquement par Playwright : soit le backend expose un OTP fixe
 * pour ce compte de test (contrôlé côté serveur, ex. staging), soit un
 * endpoint de test dédié permet de le récupérer. Ce point est à valider avec
 * l'équipe backend — ce script échoue explicitement s'il ne peut pas
 * s'authentifier plutôt que de continuer sans session.
 *
 * Ce setup ne doit JAMAIS tourner contre la production publique avec un
 * compte réel : réserver ce projet à staging ou à un compte de test dédié.
 *
 * Sélecteurs basés sur js/b-identity.js (gate OTP) — à ajuster si l'UI change :
 *   step "phone" → input téléphone + CTA envoi
 *   step "otp"   → 6 cases .k-id-otp-box + #k-id-otp-cta
 * Le succès se matérialise par la pose du cookie httpOnly `kmrc_jwt` par le
 * backend (voir js/b-identity.js), qu'on ne peut pas lire depuis le JS client
 * mais dont la présence peut être vérifiée via `context.cookies()`.
 */
'use strict';
const { test: setup, expect } = require('@playwright/test');
const path = require('path');

const authFile = path.join(__dirname, '..', '..', 'playwright', '.auth', 'user.json');

const TEST_ACCOUNT_PHONE = process.env.TEST_ACCOUNT_PHONE;
const TEST_ACCOUNT_OTP = process.env.TEST_ACCOUNT_OTP;

setup('authentifie le compte de test et sauvegarde la session', async ({ page, baseURL }) => {
  setup.skip(
    !TEST_ACCOUNT_PHONE || !TEST_ACCOUNT_OTP,
    'TEST_ACCOUNT_PHONE / TEST_ACCOUNT_OTP non fournis — projet "authenticated" ignoré. ' +
      'Voir la doc en tête de ce fichier pour configurer un compte de test dédié.'
  );

  await page.goto(baseURL);

  // Ouvre le gate d'identité (déclenché par une action nécessitant une session,
  // ex. onglet wallet — adapter le trigger réel si l'UI a changé).
  await page.locator('[data-tab="wallet"]').first().click();

  // ── Étape téléphone ──────────────────────────────────────────────────────
  await page.waitForSelector('#k-id-step-phone', { state: 'visible', timeout: 10_000 });
  await page.locator('#k-id-step-phone input[type="tel"], #k-id-step-phone input').first().fill(TEST_ACCOUNT_PHONE);
  await page.locator('#k-id-step-phone button[type="submit"], #k-id-step-phone .k-id-btn').first().click();

  // ── Étape OTP ─────────────────────────────────────────────────────────────
  await page.waitForSelector('#k-id-step-otp', { state: 'visible', timeout: 10_000 });
  const otpBoxes = page.locator('.k-id-otp-box');
  const digits = TEST_ACCOUNT_OTP.split('');
  for (let i = 0; i < digits.length; i += 1) {
    await otpBoxes.nth(i).fill(digits[i]);
  }
  await page.locator('#k-id-otp-cta').click();

  // ── Vérifie que la session est bien posée avant de sauvegarder ──────────
  await expect
    .poll(
      async () => {
        const cookies = await page.context().cookies();
        return cookies.some((c) => c.name === 'kmrc_jwt');
      },
      { message: 'le cookie de session kmrc_jwt doit être posé après OTP', timeout: 10_000 }
    )
    .toBe(true);

  await page.context().storageState({ path: authFile });
});
