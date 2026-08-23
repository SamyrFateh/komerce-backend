/**
 * @test-kind e2e-helper
 * @test-runner playwright
 * @test-requires webapp
 *
 * Provisionnement wallet pour les E2E mutants staging.
 *
 * Doctrine : ne jamais fabriquer ni injecter un JWT admin ad hoc. Le helper
 * ouvre un contexte navigateur admin isolé, s'authentifie via le parcours
 * canonique POST /api/auth/login (session AUTH-8), exécute le crédit via
 * l'API métier existante, puis logout/révoque la session admin.
 */
'use strict';

const { verifySession, verifyWalletBalance } = require('./api.helpers');
const { assertRemoteMutantTargetSafe } = require('./environment.helpers');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/boutique/';
const API_BASE = BASE_URL.replace('/boutique/', '');

async function provisionTestWalletViaAdmin(page, targetBalance = 50_000) {
  await assertRemoteMutantTargetSafe();

  const currentWallet = await verifyWalletBalance(page);
  if (!currentWallet) {
    throw new Error('[wallet-provision] wallet client inaccessible — session E2E inactive ?');
  }
  if (currentWallet.balance >= targetBalance) return currentWallet;

  const clientSession = await verifySession(page);
  const userId = clientSession?.user?.id;
  if (!clientSession?.authenticated || !userId) {
    throw new Error('[wallet-provision] utilisateur E2E authentifié requis');
  }

  const adminEmail = process.env.TEST_ADMIN_EMAIL || 'admin@komerce.km';
  const adminPassword = process.env.TEST_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      '[wallet-provision] TEST_ADMIN_PASSWORD absent — fournir le mot de passe ' +
      'du compte admin staging (TEST_ADMIN_EMAIL optionnel, défaut admin@komerce.km).'
    );
  }

  const browser = page.context().browser();
  if (!browser) throw new Error('[wallet-provision] browser Playwright indisponible');

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  try {
    await adminPage.goto(BASE_URL);

    const login = await adminPage.evaluate(async (args) => {
      try {
        const response = await fetch(new URL('/api/auth/login', args.base).href, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: args.email, password: args.password }),
        });
        const body = await response.json().catch(() => ({}));
        return {
          ok: response.ok,
          status: response.status,
          role: body.user?.role || null,
          error: body.error || null,
        };
      } catch (err) {
        return { ok: false, status: 0, role: null, error: err.message };
      }
    }, { base: API_BASE, email: adminEmail, password: adminPassword });

    if (!login.ok) {
      throw new Error(
        `[wallet-provision] login admin staging refusé (${login.status}) : ${login.error || 'erreur inconnue'}`
      );
    }
    if (login.role !== 'admin') {
      throw new Error(
        `[wallet-provision] compte ${adminEmail} authentifié mais rôle '${login.role}', admin requis`
      );
    }

    const creditAmount = targetBalance - currentWallet.balance;
    const credit = await adminPage.evaluate(async (args) => {
      try {
        const response = await fetch(new URL('/api/wallet/admin/credit', args.base).href, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: args.userId,
            amount_kmf: args.amount,
            reason: 'e2e-wallet-provision',
            note: 'Provisionnement déterministe Playwright staging',
          }),
        });
        const body = await response.json().catch(() => ({}));
        return {
          ok: response.ok,
          status: response.status,
          error: body.error || null,
        };
      } catch (err) {
        return { ok: false, status: 0, error: err.message };
      }
    }, { base: API_BASE, userId, amount: creditAmount });

    if (!credit.ok) {
      throw new Error(
        `[wallet-provision] crédit admin refusé (${credit.status}) : ${credit.error || 'erreur inconnue'}`
      );
    }
  } finally {
    await adminPage.evaluate(async (base) => {
      try {
        await fetch(new URL('/api/auth/logout', base).href, {
          method: 'POST',
          credentials: 'include',
        });
      } catch (_) {}
    }, API_BASE).catch(() => {});
    await adminContext.close();
  }

  const wallet = await verifyWalletBalance(page);
  if (!wallet || wallet.balance < targetBalance) {
    throw new Error(
      `[wallet-provision] solde après crédit insuffisant : ${wallet?.balance ?? 'null'} < ${targetBalance} KMF`
    );
  }
  return wallet;
}

module.exports = { provisionTestWalletViaAdmin };
