/**
 * helpers/api.helpers.js — Vérification backend pour flux E2E complets
 *
 * Ces helpers permettent aux tests de VÉRIFIER l'état côté serveur après
 * une action côté UI. Ils utilisent page.evaluate() pour faire des appels
 * API depuis le contexte du navigateur (avec les cookies de session).
 *
 * Convention :
 *   - Les helpers READ-ONLY (GET) sont toujours safe.
 *   - Les helpers WRITE (POST/DELETE) sont marqués [DESTRUCTIF] et ne doivent
 *     tourner que contre staging, jamais contre la production.
 */
'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/boutique/';

/**
 * Vérifie qu'un produit a bien été ajouté au panier côté client (localStorage).
 */
async function verifyCartContains(page, productId) {
  return page.evaluate((pid) => {
    try {
      const raw = localStorage.getItem('kmrc_cart') || '[]';
      const cart = JSON.parse(raw);
      return cart.some(item => String(item.id) === String(pid) || String(item.pid) === String(pid));
    } catch { return false; }
  }, productId);
}

/**
 * Récupère le panier côté client.
 */
async function getClientCart(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('kmrc_cart') || '[]');
    } catch { return []; }
  });
}

/**
 * Vérifie la session utilisateur côté backend (GET /api/auth/me).
 * Retourne { authenticated: boolean, user?: {...} }
 *
 * Note : l'endpoint est /api/auth/me, pas /api/me (voir js/komerce-api.js,
 * ligne ~235 : `const user = await request('/api/auth/me')`). La réponse est
 * l'objet user directement, pas { user: {...} }.
 */
async function verifySession(page) {
  return page.evaluate(async (base) => {
    try {
      const resp = await fetch(new URL('/api/auth/me', base).href, { credentials: 'include' });
      if (resp.status === 401) return { authenticated: false };
      const data = await resp.json();
      return { authenticated: true, user: data.user || data };
    } catch { return { authenticated: false }; }
  }, BASE_URL.replace('/boutique/', ''));
}

/**
 * Vérifie le solde wallet côté backend (GET /api/wallet).
 * Retourne { balance: number } ou null si non authentifié.
 */
async function verifyWalletBalance(page) {
  return page.evaluate(async (base) => {
    try {
      const resp = await fetch(new URL('/api/wallet', base).href, { credentials: 'include' });
      if (!resp.ok) return null;
      const data = await resp.json();
      return { balance: data.balance ?? data.balance_kmf ?? 0 };
    } catch { return null; }
  }, BASE_URL.replace('/boutique/', ''));
}

/**
 * Récupère les commandes récentes côté backend (GET /api/orders).
 * Retourne un tableau de commandes ou [] si non authentifié.
 */
async function getRecentOrders(page) {
  return page.evaluate(async (base) => {
    try {
      const resp = await fetch(new URL('/api/orders', base).href, { credentials: 'include' });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.orders || data || [];
    } catch { return []; }
  }, BASE_URL.replace('/boutique/', ''));
}

/**
 * Vérifie qu'un panier partagé existe côté backend (GET /api/shared-carts/public/:token).
 * Retourne { exists: boolean, cart?: {...} }
 */
async function verifySharedCart(page, token) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/shared-carts/public/${args.token}`, args.base).href,
        { credentials: 'include' }
      );
      if (!resp.ok) return { exists: false };
      const data = await resp.json();
      return { exists: true, cart: data.cart };
    } catch { return { exists: false }; }
  }, { token, base: BASE_URL.replace('/boutique/', '') });
}

/**
 * Lit le token du panier groupe créé côté client, posé en sessionStorage
 * par b-share-cart.js::applyCartToState() (clé 'kmrc_share'). C'est la
 * seule trace fiable du token côté client — il n'y a aucun élément DOM
 * affichant le lien de partage (celui-ci part directement en clipboard/WhatsApp).
 */
async function getClientShareToken(page) {
  return page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('kmrc_share');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s.token || null;
    } catch { return null; }
  });
}

/**
 * Lit id + token du panier groupe côté client (même source que
 * getClientShareToken, mais avec l'id nécessaire pour l'annulation
 * backend — POST /:id/cancel prend l'id, pas le token public).
 */
async function getClientShareState(page) {
  return page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('kmrc_share');
      if (!raw) return null;
      const s = JSON.parse(raw);
      return { id: s.id || null, token: s.token || null };
    } catch { return null; }
  });
}

/**
 * [DESTRUCTIF, mais no-op financier tant qu'aucune contribution 'paid'
 * n'existe] Annule un panier groupe via POST /api/shared-carts/:id/cancel.
 * Autorisé depuis open/closed/awaiting_choice (voir
 * services/cancel-shared-cart-with-refunds.js côté backend).
 * Retourne true si l'annulation a réussi (ou si le panier n'existait déjà
 * plus — 400 "introuvable" traité comme un succès de nettoyage).
 */
async function cancelSharedCart(page, id) {
  if (!id) return false;
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(new URL(`/api/shared-carts/${args.id}/cancel`, args.base).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'e2e-cleanup' }),
      });
      return resp.ok || resp.status === 400;
    } catch { return false; }
  }, { id, base: BASE_URL.replace('/boutique/', '') });
}

/**
 * Vérifie qu'une commande existe bien côté backend (GET /api/orders/:ref).
 * :ref accepte l'UUID (order.id) ou la référence humaine (order.reference) —
 * voir routes/orders/detail.js, softAuthenticate donc safe avec la session
 * du compte de test.
 * Retourne { exists: boolean, order?: {...}, items?: [...] }
 */
async function verifyOrder(page, ref) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(new URL(`/api/orders/${args.ref}`, args.base).href, { credentials: 'include' });
      if (!resp.ok) return { exists: false };
      const data = await resp.json();
      return { exists: true, order: data.order || data, items: data.items || [] };
    } catch { return { exists: false }; }
  }, { ref, base: BASE_URL.replace('/boutique/', '') });
}

/**
 * [DESTRUCTIF, mais no-op financier pour une commande cash 'pending' —
 * voir routes/orders/cancel.js : le remboursement ne s'exécute que si
 * payment_status === 'paid'] Annule une commande via POST /api/orders/:id/cancel.
 * À utiliser en cleanup après un F01 réel (ALLOW_ORDER_SUBMIT=true).
 * Retourne true si l'annulation a réussi (ou si la commande n'existait déjà
 * plus / était déjà dans un état terminal — traité comme un succès de nettoyage).
 */
async function cancelOrder(page, id, reason = 'e2e-cleanup') {
  if (!id) return false;
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(new URL(`/api/orders/${args.id}/cancel`, args.base).href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: args.reason }),
      });
      return resp.ok || resp.status === 422 || resp.status === 404;
    } catch { return false; }
  }, { id, reason, base: BASE_URL.replace('/boutique/', '') });
}

/**
 * Vérifie côté backend si le compte de test a déjà un panier groupe actif
 * (GET /api/shared-carts/mine) et l'annule le cas échéant. À appeler en
 * beforeEach ET en afterEach de tout test F20 : beforeEach couvre le cas
 * d'un run précédent interrompu avant son propre cleanup (crash, Ctrl+C),
 * afterEach couvre le cas nominal. Sans ça, F20 n'est PAS idempotent —
 * voir b-share-cart.js::install() qui restaure l'état actif au chargement
 * de page et fait bifurquer startShareFlow() vers promptActiveCartChoice()
 * au lieu de promptInit() dès qu'un panier 'open' traîne côté backend.
 */
async function cancelAnyActiveSharedCart(page) {
  return page.evaluate(async (base) => {
    try {
      const resp = await fetch(new URL('/api/shared-carts/mine', base).href, { credentials: 'include' });
      if (!resp.ok) return false;
      const data = await resp.json().catch(() => ({}));
      const carts = data.carts || [];
      const ACTIVE = new Set(['open', 'closed', 'awaiting_choice']);
      const active = carts.filter(c => ACTIVE.has(c.status));
      let allOk = true;
      for (const cart of active) {
        try {
          const r = await fetch(new URL(`/api/shared-carts/${cart.id}/cancel`, base).href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ reason: 'e2e-cleanup-preexisting' }),
          });
          if (!r.ok && r.status !== 400) allOk = false;
        } catch { allOk = false; }
      }
      return allOk;
    } catch { return false; }
  }, BASE_URL.replace('/boutique/', ''));
}

/**
 * Intercepte les requêtes API sortantes et capture les payloads.
 * Utile pour vérifier ce que le frontend envoie au backend.
 *
 * Usage :
 *   const spy = await spyOnApi(page, '/api/orders', 'POST');
 *   // ... actions UI ...
 *   const calls = spy.calls();
 */
async function spyOnApi(page, pathPattern, method = 'POST') {
  const calls = [];
  await page.route(`**${pathPattern}*`, async (route, request) => {
    if (request.method() === method) {
      let body = null;
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
      calls.push({
        url: request.url(),
        method: request.method(),
        body,
        timestamp: Date.now(),
      });
    }
    await route.continue();
  });
  return {
    calls: () => [...calls],
    lastCall: () => calls[calls.length - 1] || null,
    waitForCall: (timeout = 10_000) => new Promise((resolve, reject) => {
      if (calls.length > 0) { resolve(calls[calls.length - 1]); return; }
      const interval = setInterval(() => {
        if (calls.length > 0) { clearInterval(interval); resolve(calls[calls.length - 1]); }
      }, 200);
      setTimeout(() => { clearInterval(interval); reject(new Error('spyOnApi: no call intercepted')); }, timeout);
    }),
  };
}

module.exports = {
  verifyCartContains,
  getClientCart,
  verifySession,
  verifyWalletBalance,
  getRecentOrders,
  verifyOrder,
  cancelOrder,
  verifySharedCart,
  getClientShareToken,
  getClientShareState,
  cancelSharedCart,
  cancelAnyActiveSharedCart,
  spyOnApi,
  // R5 — provisionnement et gardes fail-closed
  provisionTestWallet,
  requireOrders,
  assertNotProdIfMutant,
};

// ── R5 — Helpers de provisionnement (dé-conditionnement des skips) ───────────

/**
 * [R5] Crédite le wallet du compte de test via POST /api/wallet/admin/credit.
 * Nécessite TEST_ADMIN_TOKEN dans l'environnement (JWT admin pré-généré pour
 * le compte de test staging). Si absent → throw (ne skipe pas).
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} targetBalance  Solde cible en KMF (défaut : 50 000)
 * @returns {Promise<{balance: number}>}
 */
async function provisionTestWallet(page, targetBalance = 50_000) {
  const adminToken = process.env.TEST_ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error(
      '[R5] provisionTestWallet: TEST_ADMIN_TOKEN absent — ' +
      'configurer un JWT admin staging pour le compte de test. ' +
      'Ce test ne peut pas être skippé.'
    );
  }
  const apiBase = (process.env.BASE_URL || 'http://localhost:3000/boutique/').replace('/boutique/', '');
  const currentWallet = await verifyWalletBalance(page);
  if (!currentWallet) {
    throw new Error('[R5] provisionTestWallet: wallet client inaccessible avant provisionnement.');
  }
  if (currentWallet.balance >= targetBalance) {
    return currentWallet;
  }
  const creditAmount = targetBalance - currentWallet.balance;
  // Récupérer le userId du compte de test depuis la session
  const userId = await page.evaluate(async (base) => {
    try {
      const r = await fetch(new URL('/api/auth/me', base).href, { credentials: 'include' });
      if (!r.ok) return null;
      const d = await r.json();
      return (d.user || d)?.id || null;
    } catch { return null; }
  }, apiBase);
  if (!userId) {
    throw new Error('[R5] provisionTestWallet: impossible de récupérer userId (session inactive ?)');
  }
  // Créditer via l'API admin
  const result = await page.evaluate(async (args) => {
    try {
      const r = await fetch(new URL('/api/wallet/admin/credit', args.base).href, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${args.token}`,
        },
        body: JSON.stringify({
          user_id: args.userId,
          amount_kmf: args.amount,
          reason: 'e2e-r5-provision',
          idempotency_key: `r5-provision-${args.userId}-${Date.now()}`,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.status }));
        return { ok: false, error: err.error || r.status };
      }
      const d = await r.json();
      return { ok: true, balance: d.wallet?.balance ?? d.balance ?? null };
    } catch (e) { return { ok: false, error: e.message }; }
  }, { base: apiBase, token: adminToken, userId, amount: creditAmount });

  if (!result.ok) {
    throw new Error(`[R5] provisionTestWallet échoué : ${result.error}`);
  }
  // Relire le solde réel pour confirmation
  const wallet = await verifyWalletBalance(page);
  if (!wallet || wallet.balance < targetBalance) {
    throw new Error(
      `[R5] Solde insuffisant après provisionnement : ${wallet?.balance ?? 'null'} KMF < ${targetBalance} KMF`
    );
  }
  return wallet;
}

/**
 * [R5] Vérifie qu'au moins une commande existe pour le compte de test.
 * Lève une erreur (ne skipe pas) si aucune commande n'est trouvée.
 * Pour F06 (order-history) : données en lecture seule, pas de création.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array>} Liste de commandes (au moins 1)
 */
async function requireOrders(page) {
  const orders = await getRecentOrders(page);
  if (orders.length === 0) {
    throw new Error(
      '[R5] requireOrders: aucune commande sur le compte de test. ' +
      'F06 est READ-ONLY — il faut qu\'au moins une commande existe. ' +
      'Lancer F01/F02 d\'abord ou utiliser un compte de test pré-alimenté.'
    );
  }
  return orders;
}

/**
 * [R5] Garde fail-closed : lève une erreur si BASE_URL pointe vers la
 * production et que le flag ALLOW_MUTANTS_ON_PROD est absent.
 * À appeler dans beforeAll des specs mutantes (cancel-refund, stress-business,
 * wallet-payment, wallet-lifecycle).
 */
function assertNotProdIfMutant() {
  const base = process.env.BASE_URL || '';
  const PROD_HOSTS = ['komerce.co'];
  const isProd = PROD_HOSTS.some(h => base.includes(h));
  if (isProd && !process.env.ALLOW_MUTANTS_ON_PROD) {
    throw new Error(
      `[R5][FAIL-CLOSED] Test mutant refusé sur URL de production "${base}". ` +
      'Utiliser un environnement staging. Pour forcer (dangereux) : ALLOW_MUTANTS_ON_PROD=1.'
    );
  }
}

// (exports consolidés dans module.exports ci-dessus)
