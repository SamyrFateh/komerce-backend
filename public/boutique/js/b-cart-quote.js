/**
 * @komerce-arch
 * @role          boutique-cart-quote-dialog
 * @domain        boutique
 * @layer         ui-component
 * @criticality   medium
 * @inputs        personal_cart, current_display_market
 * @outputs       canonical_quote_preview, ephemeral_pdf_share_save
 * @depends       b-store.js, b-utils.js, b-bus.js
 * @doctrine      public_quote_without_identity_or_relay, serveur_source_du_prix
 * @impact-areas  boutique, checkout
 * @version       2026-11
 */
'use strict';

import { state } from './b-store.js';
import { bus } from './b-bus.js';
import { fmt } from './b-utils.js';

const PDF_PATH = '/api/orders/quote-pdf';
const PREVIEW_PATH = PDF_PATH;
const AXIS_LABELS = Object.freeze({
  cj_color: 'Couleur', color: 'Couleur', couleur: 'Couleur',
  cj_size: 'Taille', size: 'Taille', taille: 'Taille',
});
let installed = false;

function currentMarketCode() {
  return String(
    document.body?.dataset.marketCode ||
    window.KomerceMarket?.getPreviewOverride?.() ||
    window.KomerceMarket?.get?.()?.code ||
    ''
  ).toUpperCase();
}

export function cartQuotePayload(items, marketCode) {
  const lines = (Array.isArray(items) ? items : []).map(item => ({
    product_id: String(item.product?.id ?? item.product_id ?? item.id ?? ''),
    quantity: Number(item.qty ?? item.quantity),
    variant_combo: item.variant_combo || null,
    requested_transport_rail: item.requested_transport_rail ?? null,
  }));
  const market = String(marketCode || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(market) || !lines.length || lines.length > 30 ||
      lines.some(item => !item.product_id || !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1)) return null;
  return { items: lines, market_code: market };
}

function cartSignature() {
  return JSON.stringify((state.cart || []).map(item => [
    String(item.product?.id ?? item.product_id ?? item.id ?? ''),
    Number(item.qty ?? item.quantity),
    item.variant_combo || null,
    item.requested_transport_rail ?? null,
  ]));
}

export function quoteVariantLabel(combo) {
  if (!combo || typeof combo !== 'object' || Array.isArray(combo)) return '';
  return Object.entries(combo).map(([key, value]) =>
    (AXIS_LABELS[String(key).toLowerCase()] || key) + ' : ' + value
  ).join(' · ');
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
      !Number.isFinite(Number(quote.total_kmf)) ||
      Number(quote.transport_price_kmf) !== 0) {
    throw new Error('Devis serveur incomplet : aucun PDF ne peut être généré.');
  }
  container.replaceChildren();

  const meta = document.createElement('div');
  meta.className = 'k-quote-meta';
  const market = document.createElement('span');
  market.textContent = 'Marché : ' + String(quote.market_code || '—');
  const date = document.createElement('span');
  date.textContent = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris',
  });
  meta.append(market, date);
  container.appendChild(meta);

  const heading = document.createElement('p');
  heading.className = 'k-quote-section-title';
  heading.textContent = 'Articles de ton panier';
  container.appendChild(heading);

  const rows = document.createElement('div');
  rows.className = 'k-quote-lines';
  quote.items.forEach(item => {
    const line = document.createElement('div');
    line.className = 'k-quote-line';
    const product = document.createElement('div');
    product.className = 'k-quote-product';
    const name = document.createElement('strong');
    name.className = 'k-quote-product-name';
    name.textContent = String(item.product_name || 'Produit');
    product.appendChild(name);

    const variant = quoteVariantLabel(item.variant_combo);
    if (variant) {
      const attrs = document.createElement('span');
      attrs.className = 'k-quote-variant';
      attrs.textContent = variant;
      product.appendChild(attrs);
    }
    const detail = document.createElement('span');
    detail.className = 'k-quote-line-detail';
    detail.textContent = String(Number(item.quantity)) + ' × ' +
      fmt(Number(item.unit_price_kmf), 'KMF');
    product.appendChild(detail);

    const amount = document.createElement('strong');
    amount.className = 'k-quote-line-amount';
    amount.textContent = fmt(Number(item.line_total_kmf), 'KMF');
    line.append(product, amount);
    rows.appendChild(line);
  });
  container.appendChild(rows);

  const total = document.createElement('div');
  total.className = 'k-quote-total';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Total estimatif';
  const totalValue = document.createElement('strong');
  totalValue.textContent = fmt(Number(quote.total_kmf), 'KMF');
  total.append(totalLabel, totalValue);
  container.appendChild(total);

  const shipping = document.createElement('p');
  shipping.className = 'k-quote-shipping';
  shipping.textContent = '✓  Livraison maritime incluse';
  container.appendChild(shipping);
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

async function loadPreview(payload) {
  const response = await fetch(PREVIEW_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Devis indisponible.');
  return data;
}

async function loadPdf(payload) {
  const response = await fetch(PDF_PATH, {
    method: 'POST',
    credentials: 'same-origin',
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
  const buttons = [
    document.getElementById('k-cart-quote'),
    document.getElementById('k-sc-quote'),
  ].filter(Boolean);
  if (!buttons.length) return;

  const sync = () => {
    const enabled = state.cartSurface === 'personal' && state.cart.length > 0;
    buttons.forEach(btn => { btn.disabled = !enabled; });
  };
  bus.on('cart:update', sync);
  bus.on('side-cart:render', sync);
  sync();

  async function openQuote(origin) {
    if (!state.cart?.length || state.cartSurface !== 'personal' ||
        document.getElementById('k-quote-dialog')) return;

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.id = 'k-quote-dialog';
    dialog.className = 'k-quote-dialog';
    dialog.setAttribute('aria-labelledby', 'k-quote-title');
    dialog.innerHTML = `
      <section class="k-quote-panel">
        <div class="k-quote-header">
          <div class="k-quote-header-brand">
            <img class="k-quote-logo" src="/images/Logo_Komerce.png" alt="Komerce" width="142" height="44">
            <div class="k-quote-header-copy">
              <h2 id="k-quote-title">Devis estimatif</h2>
              <p>Ton panier, sans passer commande.</p>
            </div>
          </div>
          <button type="button" class="k-quote-close" aria-label="Fermer">×</button>
        </div>
        <div class="k-quote-body">
          <p id="k-quote-status" role="status" aria-live="polite">Calcul du devis…</p>
          <div id="k-quote-result" hidden>
            <div id="k-quote-preview"></div>
            <p class="k-quote-disclaimer">Document informatif, sans engagement : ni commande ni facture. Prix et stock revérifiés à la confirmation.</p>
            <div class="k-quote-actions">
              <button type="button" data-quote-action="share">Partager</button>
              <button type="button" data-quote-action="save">Enregistrer PDF</button>
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
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled])')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.querySelector('.k-quote-close').addEventListener('click', close);
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    document.addEventListener('keydown', onKeydown);
    document.body.classList.add('k-quote-open');

    const status = dialog.querySelector('#k-quote-status');
    const result = dialog.querySelector('#k-quote-result');
    const preview = dialog.querySelector('#k-quote-preview');
    let locked = null;
    let cachedPdf = null;
    let processing = false;
    const startingSignature = cartSignature();
    const startingMarket = currentMarketCode();
    const validCart = () => state.cartSurface === 'personal' &&
      state.cart.length > 0 && cartSignature() === startingSignature &&
      currentMarketCode() === startingMarket;
    const invalidate = () => {
      if (validCart()) return;
      locked = null;
      cachedPdf = null;
      result.hidden = true;
      status.textContent = 'Ton panier a changé. Ferme cette fenêtre pour actualiser le devis.';
    };
    bus.on('cart:update', invalidate);
    dialog.querySelector('.k-quote-close').focus();

    dialog.querySelectorAll('[data-quote-action]').forEach(button => {
      button.addEventListener('click', async () => {
        if (processing || !locked || !cachedPdf || !validCart()) return invalidate();
        processing = true;
        const action = button.dataset.quoteAction;
        status.textContent = '';
        try {
          const pdf = cachedPdf;
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
              // Partage natif indisponible : téléchargement du PDF comme repli.
              savePdf(pdf);
            }
          } else {
            savePdf(pdf);
          }
          // Un partage validé ou un téléchargement lancé termine le devis.
          // Une annulation AbortError et toute erreur gardent la fenêtre ouverte.
          close();
        } catch (error) {
          status.textContent = error?.message || 'Téléchargement impossible.';
        } finally {
          processing = false;
        }
      });
    });

    // Un clic = aperçu. Aucune étape « Préparer », aucun relais ni OTP.
    const payload = cartQuotePayload(state.cart, startingMarket);
    if (!payload) {
      status.textContent = 'Panier ou marché invalide. Actualise la boutique.';
      return;
    }
    try {
      const quote = await loadPreview(payload);
      if (!dialog.isConnected || !validCart()) return invalidate();
      renderQuotePreview(preview, quote);
      // Charger avant le geste de partage natif, qui requiert l'activation utilisateur.
      cachedPdf = await loadPdf({ ...payload, expected_total_kmf: quote.total_kmf });
      if (!dialog.isConnected || !validCart()) return invalidate();
      locked = payload;
      result.hidden = false;
      status.textContent = '';
    } catch (error) {
      status.textContent = error?.message || 'Devis indisponible. Ferme puis rouvre cette fenêtre.';
    }
  }

  buttons.forEach(button => button.addEventListener('click', () => openQuote(button)));
}
