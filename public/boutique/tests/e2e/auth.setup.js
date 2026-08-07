/**
 * @e2e   auth.setup.js
 * @brief Authentification E2E — génère une session Playwright (storageState)
 *        UNE SEULE FOIS pour tous les tests du projet "authenticated", au lieu
 *        de refaire un flow OTP complet dans chaque test.
 *
 * Prérequis (à fournir via variables d'environnement, JAMAIS en dur) :
 *   TEST_ACCOUNT_PHONE  — chiffres LOCAUX uniquement, SANS indicatif pays
 *                         (le sélecteur pays est +269/Comores par défaut,
 *                         qui exige exactement 7 chiffres — voir b-phone.js
 *                         PHONE_COUNTRIES). Ex. valide : "3211234".
 *                         ⚠️ Ne PAS mettre "+269..." ni un numéro à 9 chiffres :
 *                         sync() dans makeIntlPhoneInput() tronque silencieusement
 *                         à 7 chiffres au lieu de rejeter, ce qui produit un E.164
 *                         corrompu (indicatif dupliqué) sans erreur visible.
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

  // Garde-fou : le pays par défaut de la modale identité est +269 (Comores,
  // 7 chiffres locaux exacts — voir PHONE_COUNTRIES dans b-phone.js). sync()
  // y tronque silencieusement tout excédent au lieu de rejeter, donc un
  // TEST_ACCOUNT_PHONE mal formé produit un E.164 corrompu sans erreur visible.
  // On échoue ici, tout de suite, avec un message clair.
  if (/^\+/.test(TEST_ACCOUNT_PHONE) || !/^\d{7}$/.test(TEST_ACCOUNT_PHONE)) {
    throw new Error(
      `TEST_ACCOUNT_PHONE="${TEST_ACCOUNT_PHONE}" invalide : attendu 7 chiffres locaux ` +
        'SANS indicatif pays (ex. "3211234"), le sélecteur pays étant fixé à +269 par défaut.'
    );
  }

  await page.goto(baseURL);

  // Ouvre le gate d'identité : l'onglet "komerce" (ex-"wallet", consolidé sous
  // le bouton "Mon Komerce" — data-tab="komerce") ouvre désormais DIRECTEMENT
  // la modale d'identité ("Accéder à Mon Komerce") quand non authentifié — il
  // n'y a plus d'étape intermédiaire "vue wallet + bouton #k-wlt-auth-btn"
  // (celle-ci a été retirée de js/b-komerce.js / js/b-wallet.js). Vérifié en
  // observant le DOM réel : le clic sur l'onglet fait apparaître directement
  // le dialog #k-id-step-phone.
  await page.locator('[data-tab="komerce"]').first().click();

  // ── Étape téléphone ──────────────────────────────────────────────────────
  // Le formulaire a 3 champs distincts (voir b-identity.js:437-452, ordre DOM
  // exact) : prénom (#k-id-name) → nom (#k-id-lastname) → WhatsApp (#k-id-phone,
  // dans son groupe avec le select pays #k-id-phone-country). requestCode()
  // bloque avec une erreur si prénom/nom sont vides — les 3 doivent être remplis,
  // pas seulement le téléphone. Ciblage par id exact, jamais de sélecteur combiné
  // "A, B" + .first() : un tel sélecteur retourne l'union dans l'ordre du DOM et
  // peut silencieusement matcher le mauvais champ (vécu : ça remplissait le
  // prénom avec le numéro de téléphone).
  await page.waitForSelector('#k-id-step-phone', { state: 'visible', timeout: 10_000 });
  await page.locator('#k-id-name').fill(process.env.TEST_ACCOUNT_FIRSTNAME || 'Test');
  await page.locator('#k-id-lastname').fill(process.env.TEST_ACCOUNT_LASTNAME || 'E2E');
  await page.locator('#k-id-phone').fill(TEST_ACCOUNT_PHONE);
  await page.locator('#k-id-phone-cta').click();

  // Course entre succès (étape OTP visible) et échec (message d'erreur affiché
  // dans #k-id-err-phone par requestCode()) — pour remonter la vraie cause
  // plutôt qu'un TimeoutError générique si la requête échoue côté backend.
  const otpStep = page.locator('#k-id-step-otp');
  const errWatch = page
    .waitForFunction(
      () => (document.getElementById('k-id-err-phone')?.textContent || '').trim().length > 0,
      { timeout: 10_000 }
    )
    .then(async () => {
      const msg = await page.locator('#k-id-err-phone').textContent();
      throw new Error(`requestCode() a échoué : "${msg}"`);
    });
  errWatch.catch(() => {}); // évite un unhandled rejection si c'est otpStep qui gagne la course
  await Promise.race([otpStep.waitFor({ state: 'visible', timeout: 10_000 }), errWatch]);

  // ── Étape OTP ─────────────────────────────────────────────────────────────
  const otpBoxes = page.locator('.k-id-otp-box');
  const digits = TEST_ACCOUNT_OTP.split('');

  await expect(otpBoxes).toHaveCount(6);

  // enterOtpStep() programme encore un focus sur la première case à +50 ms.
  // Attendre sa fin évite qu'il vole le focus pendant la saisie Playwright.
  await page.waitForTimeout(150);

  // Chaque case est ciblée explicitement et vérifiée avant de continuer.
  // La dernière saisie déclenche automatiquement verifyCode().
  for (let i = 0; i < digits.length - 1; i += 1) {
    const box = otpBoxes.nth(i);
    await box.fill(digits[i]);
    await expect(box).toHaveValue(digits[i]);
  }

  await otpBoxes.nth(digits.length - 1).fill(digits.at(-1));
  // La 6e case déclenche verifyCode() automatiquement via son handler 'input'
  // (voir b-identity.js:292,313 — otpCta.click() interne dès que les 6 chiffres
  // sont saisis). NE PAS recliquer #k-id-otp-cta ici : à ce stade il est déjà
  // disabled ("Vérification…") et, en cas de succès, détaché du DOM à la
  // fermeture de la modale — un second .click() reste bloqué en retry jusqu'au
  // timeout du test (vécu : 60s, "element was detached from the DOM").

  // ── Vérifie que la session est bien posée avant de sauvegarder ──────────
  // Si verifyCode() échoue (code refusé côté backend), la modale reste ouverte
  // avec #k-id-err-otp rempli au lieu de poser le cookie — on le détecte pour
  // remonter le vrai message plutôt qu'un timeout générique sur le cookie.
  const otpErrWatch = page
    .waitForFunction(
      () => (document.getElementById('k-id-err-otp')?.textContent || '').trim().length > 0,
      { timeout: 10_000 }
    )
    .then(async () => {
      const msg = await page.locator('#k-id-err-otp').textContent();
      throw new Error(`verifyCode() a échoué : "${msg}"`);
    });
  otpErrWatch.catch(() => {}); // évite un unhandled rejection si le cookie arrive avant

  await Promise.race([
    expect
      .poll(
        async () => {
          const cookies = await page.context().cookies();
          return cookies.some((c) => c.name === 'kmrc_jwt');
        },
        { message: 'le cookie de session kmrc_jwt doit être posé après OTP', timeout: 10_000 }
      )
      .toBe(true),
    otpErrWatch,
  ]);

  await page.context().storageState({ path: authFile });
});
