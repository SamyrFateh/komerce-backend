/**
 * @komerce-arch
 * @role          boutique-cart-quote-dialog
 * @domain        boutique
 * @layer         ui-component
 * @criticality   medium
 * @inputs        personal_cart, explicit_relay, verified_client_identity
 * @outputs       canonical_quote_preview, ephemeral_pdf_share_save_print
 * @depends       b-store.js, b-utils.js, b-identity.js, b-bus.js
 * @doctrine      devis_sans_commande_ni_paiement, serveur_source_du_prix
 * @impact-areas  boutique, checkout
 * @version       2026-11
 */
'use strict';

import { state } from './b-store.js';
import { bus } from './b-bus.js';
import { apiGet, apiPost, fmt } from './b-utils.js';
import { requireIdentity } from './b-identity.js';

const PDF_PATH = '/api/orders/quote-pdf';
let installed = false;

export function cartQuotePayload(items, relaisId) {
  const lines = (Array.isArray(items) ? items : []).map(item => ({
    product_id: String(item.product?.id ?? item.product_id ?? item.id ?? ''),
    quantity: Number(item.qty ?? item.quantity),
    confection_type: 'aucun',
    variant_combo: item.variant_combo || null,
    requested_transport_rail: item.requested_transport_rail ?? null,
  }));
  if (!relaisId || !lines.length || lines.some(item => !item.product_id ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1)) return null;
  return { items: lines, relais_id: String(relaisId), payment_mode: 'cash_relais' };
}

function cartSignature() {
  return JSON.stringify((state.cart || []).map(item => [
    String(item.product?.id ?? item.product_id ?? item.id ?? ''),
    Number(item.qty),
    item.variant_combo || null,
    item.requested_transport_rail ?? null,
  ]));
}

function addRow(parent, name, amount, bold = false) {
  const row = document.createElement('div');
  row.className = 'k-quote-row' + (bold ? ' is-total' : '');
  const key = document.createElement('span');
  key.textContent = name;
  const value = document.createElement('strong');
  value.textContent = amount;
  row.append(key, value);
  parent.appendChild(row);
}

export function renderQuotePreview(container, quote) {
  if (!quote || !Array.isArray(quote.items) || !quote.items.length ||
      !Number.isFinite(Number(quote.total_kmf))) {
    throw new Error('Devis serveur incomplet : aucun PDF ne peut être généré.');
  }
  container.replaceChildren();
  const location = document.createElement('p');
  location.className = 'k-quote-location';
  location.textContent = 'Point relais : ' + String(quote.relais_name || '—');
  container.appendChild(location);

  const rows = document.createElement('div');
  rows.className = 'k-quote-lines';
  quote.items.forEach(item => {
    const variant = item.variant_combo && typeof item.variant_combo === 'object'
      ? Object.entries(item.variant_combo).map(([k, v]) => k + ' : ' + v).join(' · ')
      : '';
    const name = String(item.product_name || 'Produit') +
      (variant ? ' · ' + variant : '') +
      '  (' + Number(item.quantity) + ' × ' + fmt(Number(item.unit_price_kmf), 'KMF') + ')';
    addRow(rows, name, fmt(Number(item.line_total_kmf), 'KMF'));
  });
  container.appendChild(rows);
  const totals = document.createElement('div');
  totals.className = 'k-quote-totals';
  addRow(totals, 'Articles', fmt(Number(quote.items_total_kmf), 'KMF'));
  addRow(totals, 'Livraison au relais', fmt(Number(quote.transport_price_kmf), 'KMF'));
  if (Number(quote.discount_kmf) > 0) {
    addRow(totals, 'Remise', '−' + fmt(Number(quote.discount_kmf), 'KMF'));
  }
  addRow(totals, 'Total estimatif', fmt(Number(quote.total_kmf), 'KMF'), true);
  container.appendChild(totals);
}

function savePdf(blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'Komerce-devis-estimatif.pdf';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function loadPdf(payload) {
  // Auth cookie httpOnly — jamais d'URL PDF publique ni de fichier stocké.
  const response = await fetch(PDF_PATH, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Impossible de préparer le PDF.');
  }
  const blob = await response.blob();
  if (blob.type !== 'application/pdf' || !blob.size) {
    throw new Error('Réponse PDF indisponible.');
  }
  return blob;
}

export function setupCartQuote() {
  if (installed) return;
  installed = true;
  const mobile = document.getElementById('k-cart-quote');
  const desktop = document.getElementById('k-sc-quote');
  const buttons = [mobile, desktop].filter(Boolean);
  if (!buttons.length) return;

  const sync = () => {
    const enabled = state.cartSurface === 'personal' && state.cart.length > 0;
    buttons.forEach(btn => { btn.disabled = !enabled; });
  };
  bus.on('cart:update', sync);
  bus.on('side-cart:render', sync);
  sync();

  async function openQuote(origin) {
    if (!state.cart?.length || state.cartSurface !== 'personal') return;
    if (document.getElementById('k-quote-dialog')) return;

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.id = 'k-quote-dialog';
    dialog.className = 'k-quote-dialog';
    dialog.setAttribute('aria-labelledby', 'k-quote-title');
    dialog.innerHTML = `
      <section class="k-quote-panel">
      <div class="k-quote-header">
        <div>
          <h2 id="k-quote-title">Fais-moi un devis</h2>
          <p>À partir de ton panier, sans passer commande.</p>
        </div>
        <button type="button" class="k-quote-close" aria-label="Fermer">×</button>
      </div>
      <div class="k-quote-body">
        <label for="k-quote-relais">Point relais de livraison</label>
        <select id="k-quote-relais" required><option value="">Chargement des relais…</option></select>
        <p class="k-quote-hint">Le relais détermine le transport. Une vérification de ton compte peut être demandée pour obtenir le prix exact.</p>
        <button type="button" class="k-quote-calculate">Préparer mon devis</button>
        <p id="k-quote-status" role="status" aria-live="polite"></p>
        <div id="k-quote-result" hidden>
          <div id="k-quote-preview"></div>
          <p class="k-quote-disclaimer">Devis estimatif, sans engagement : ni commande, ni facture. Prix et stock revérifiés à la confirmation.</p>
          <div class="k-quote-actions">
            <button type="button" data-quote-action="share">Partager</button>
            <button type="button" data-quote-action="save">Enregistrer PDF</button>
            <button type="button" data-quote-action="print">Imprimer</button>
          </div>
        </div>
      </div>
      </section>`;
    document.body.appendChild(dialog);
    const close = () => {
      if (!dialog.isConnected) return;
      bus.off('cart:update', invalidate);
      document.removeEventListener('keydown', onKeydown);
      document.body.classList.remove('k-quote-open');
      dialog.remove();
      origin?.focus?.();
    };
    const onKeydown = event => {
      if (document.querySelector('.k-id-overlay')) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), select:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.querySelector('.k-quote-close').addEventListener('click', close);
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    document.addEventListener('keydown', onKeydown);
    document.body.classList.add('k-quote-open');

    const select = dialog.querySelector('#k-quote-relais');
    const calculate = dialog.querySelector('.k-quote-calculate');
    const status = dialog.querySelector('#k-quote-status');
    const result = dialog.querySelector('#k-quote-result');
    const preview = dialog.querySelector('#k-quote-preview');
    let locked = null;
    let processing = false;
    const startingSignature = cartSignature();
    const validCart = () => state.cartSurface === 'personal' &&
      state.cart.length > 0 && cartSignature() === startingSignature;
    const invalidate = () => {
      if (validCart()) return;
      locked = null;
      result.hidden = true;
      calculate.disabled = true;
      status.textContent = 'Ton panier a changé. Ferme cette fenêtre et recommence le devis.';
    };
    bus.on('cart:update', invalidate);
    dialog.querySelector('.k-quote-close').focus();
    try {
      const market = new URLSearchParams(window.location.search).get('market');
      const query = market && /^[A-Za-z]{2}$/.test(market)
        ? '?market=' + encodeURIComponent(market.toUpperCase()) : '';
      const data = await apiGet('/api/relais/public' + query, { retries: 0 });
      if (!dialog.isConnected) return;
      const relays = Array.isArray(data) ? data : (data?.relais || []);
      select.replaceChildren();
      const first = document.createElement('option');
      first.value = '';
      first.textContent = relays.length ? 'Choisir mon relais' : 'Aucun relais disponible';
      select.appendChild(first);
      for (const relay of relays) {
        const option = document.createElement('option');
        option.value = String(relay.id);
        option.textContent = [relay.name, relay.island || relay.zone, relay.market_code].filter(Boolean).join(' · ');
        select.appendChild(option);
      }
      select.disabled = !relays.length;
      calculate.disabled = !relays.length;
    } catch (error) {
      if (!dialog.isConnected) return;
      select.replaceChildren();
      status.textContent = 'Impossible de charger les relais : ' + (error.message || 'réessaie.');
      calculate.disabled = true;
    }

    select.addEventListener('change', () => {
      locked = null;
      result.hidden = true;
      status.textContent = '';
    });
    calculate.addEventListener('click', async () => {
      if (processing || !validCart()) return invalidate();
      const payload = cartQuotePayload(state.cart, select.value);
      if (!payload) { status.textContent = 'Choisis un relais pour calculer le devis.'; return; }
      processing = true;
      calculate.disabled = true;
      status.textContent = 'Vérification du devis…';
      try {
        const identity = await requireIdentity({
          reason: 'obtenir un devis basé sur le panier',
          title: 'Vérifier mon compte pour le devis',
          returnFocusTo: calculate,
        });
        if (!identity || !dialog.isConnected) {
          status.textContent = 'La vérification est nécessaire pour obtenir le devis serveur.';
          return;
        }
        if (!validCart()) return invalidate();
        const quote = await apiPost('/api/orders/preview', payload, { retries: 0 });
        if (!dialog.isConnected || !validCart()) return invalidate();
        renderQuotePreview(preview, quote);
        locked = payload;
        result.hidden = false;
        status.textContent = 'Devis prêt : vous pouvez le partager, enregistrer ou imprimer.';
      } catch (error) {
        locked = null;
        result.hidden = true;
        status.textContent = error?.message || 'Devis indisponible. Réessaie.';
      } finally {
        processing = false;
        if (dialog.isConnected && validCart()) calculate.disabled = false;
      }
    });

    dialog.querySelectorAll('[data-quote-action]').forEach(button => {
      button.addEventListener('click', async () => {
        if (processing || !locked || !validCart()) return invalidate();
        const action = button.dataset.quoteAction;
        // Ouvrir l'onglet PDF dès le geste humain, avant le fetch asynchrone.
        const tab = action === 'print' ? window.open('', '_blank') : null;
        if (tab) {
          tab.opener = null;
          tab.document.body.textContent = 'Préparation du devis PDF…';
        }
        processing = true;
        status.textContent = 'Préparation du PDF…';
        try {
          const pdf = await loadPdf(locked);
          if (!validCart()) { tab?.close(); return invalidate(); }
          if (action === 'share') {
            const file = typeof File === 'function'
              ? new File([pdf], 'Komerce-devis-estimatif.pdf', { type: 'application/pdf' })
              : null;
            if (file && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
              try { await navigator.share({ title: 'Devis Komerce', files: [file] }); }
              catch (error) {
                if (error?.name === 'AbortError') return;
                savePdf(pdf);
              }
            } else {
              savePdf(pdf);
              status.textContent = 'PDF enregistré : partage-le depuis ton téléphone.';
              return;
            }
          } else if (action === 'print') {
            if (tab && !tab.closed) {
              const url = URL.createObjectURL(pdf);
              tab.location.href = url;
              window.setTimeout(() => URL.revokeObjectURL(url), 120000);
            } else {
              savePdf(pdf);
              status.textContent = 'PDF enregistré : ouvre-le pour l’imprimer.';
              return;
            }
          } else {
            savePdf(pdf);
          }
          status.textContent = 'Devis PDF prêt.';
        } catch (error) {
          tab?.close();
          status.textContent = error?.message || 'Téléchargement impossible.';
        } finally {
          processing = false;
        }
      });
    });
  }
  buttons.forEach(button => button.addEventListener('click', () => openQuote(button)));
}
