/**
 * helpers/business.helpers.js — Helpers backend pour flux E2E business complets
 *
 * Ces helpers vérifient l'état côté serveur APRÈS une action côté UI.
 * Ils complètent api.helpers.js avec des vérifications spécifiques aux
 * scénarios F05–F31 de l'inventaire E2E_BUSINESS_FLOWS_INVENTORY.
 *
 * Tous les helpers READ-ONLY (GET) sont safe en production.
 * Les helpers [DESTRUCTIF] sont marqués explicitement.
 */
'use strict';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000/boutique/';
const API_BASE = BASE_URL.replace('/boutique/', '');

// ─── F07 — Stock ─────────────────────────────────────────────────────────────

/**
 * Récupère le stock d'un produit via GET /api/products/:id (public, pas d'auth).
 * Le champ `stock` est dans PUBLIC_PRODUCT_FIELDS (voir catalog-public-view.js).
 * Retourne { stock: number|null, name: string } ou null si 404.
 */
async function getProductStock(page, productId) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/products/${args.pid}`, args.base).href
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return { stock: data.stock ?? null, name: data.name || '' };
    } catch { return null; }
  }, { pid: productId, base: API_BASE });
}

// ─── F05 — Facture publique ──────────────────────────────────────────────────

/**
 * Récupère une facture publique via GET /api/invoices/public/:token (sans auth).
 * Retourne { status: number, contentType: string, hasContent: boolean }.
 */
async function fetchPublicInvoice(page, token) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/invoices/public/${args.token}`, args.base).href
      );
      const ct = resp.headers.get('content-type') || '';
      const body = await resp.text();
      return {
        status: resp.status,
        contentType: ct,
        hasContent: body.length > 0,
        isHtml: ct.includes('text/html'),
        isJson: ct.includes('application/json'),
      };
    } catch (e) { return { status: 0, contentType: '', hasContent: false, error: e.message }; }
  }, { token, base: API_BASE });
}

// ─── F06 — Historique commande ───────────────────────────────────────────────

/**
 * Récupère l'historique des transitions d'une commande via
 * GET /api/orders/:id/history (authentifié).
 * Retourne un tableau [{ status, note, created_at }] ou [].
 */
async function getOrderHistory(page, orderId) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/orders/${args.id}/history`, args.base).href,
        { credentials: 'include' }
      );
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.history || data || [];
    } catch { return []; }
  }, { id: orderId, base: API_BASE });
}

// ─── F31 — Tracking public ──────────────────────────────────────────────────

/**
 * Récupère le détail d'une commande par référence via
 * GET /api/orders/:ref (public, softAuthenticate).
 * Retourne l'objet commande ou null.
 */
async function getOrderByRef(page, ref) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/orders/${args.ref}`, args.base).href,
        { credentials: 'include' }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.order || data;
    } catch { return null; }
  }, { ref, base: API_BASE });
}

/**
 * Récupère le tracking public via GET /api/tracking/:token (sans auth).
 * Retourne { status: number, data: object|null }.
 */
async function fetchPublicTracking(page, token) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/tracking/${args.token}`, args.base).href
      );
      if (!resp.ok) return { status: resp.status, data: null };
      const data = await resp.json();
      return { status: resp.status, data };
    } catch { return { status: 0, data: null }; }
  }, { token, base: API_BASE });
}

// ─── F21 — Panier partagé participant ────────────────────────────────────────

/**
 * Rejoint un panier partagé en tant que participant via la page publique.
 * Le participant charge /boutique/?shared=:token (ou l'URL de partage)
 * et le code frontal (b-group-view.js) affiche la vue participant.
 * Retourne l'URL de la page de partage telle que le frontend la construit.
 */
function getSharePageUrl(token) {
  return `${BASE_URL}?shared=${token}`;
}

/**
 * Contribue un article au panier partagé via POST /api/shared-carts/:id/items
 * (authentifié). [DESTRUCTIF — staging uniquement]
 */
async function contributeToSharedCart(page, cartId, item) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(
        new URL(`/api/shared-carts/${args.cartId}/items`, args.base).href,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(args.item),
        }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return { ok: false, status: resp.status, error: err.error || err.message };
      }
      const data = await resp.json();
      return { ok: true, data };
    } catch (e) { return { ok: false, error: e.message }; }
  }, { cartId, item, base: API_BASE });
}

module.exports = {
  getProductStock,
  fetchPublicInvoice,
  getOrderHistory,
  getOrderByRef,
  fetchPublicTracking,
  getSharePageUrl,
  contributeToSharedCart,
};
