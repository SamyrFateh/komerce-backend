/**
 * shell.js — Cœur du spike. Monte le shell A (pager) OU B (vertical) selon ?shell=.
 *
 * PRINCIPE : le contenu (cartes, catégories, discovery, merch) est rendu par des
 * fonctions COMMUNES aux deux shells. Seuls le conteneur de scroll, la navigation
 * catégorie et la synchronisation "catégorie active" diffèrent. C'est exactement
 * la frontière que le rechallenge veut isoler : shell/navigation/scroll, rien d'autre.
 *
 * Le cycle modale et panier est STRICTEMENT partagé — pour prouver que le retour
 * PDP et l'ouverture panier ne dépendent pas du shell.
 */
'use strict';

import {
  CATEGORIES, PRODUCTS_BY_CATEGORY, DISCOVERY_CARDS, MERCH_BLOCK, formatPrice,
} from './data.js';

// ── Instrumentation (métriques live du HUD) ──────────────────────────────

const metrics = {
  scrollOwners: new Set(),     // combien d'éléments scrollent réellement
  syncMechanisms: 0,           // mécanismes de synchronisation installés
  modalCatalogSpecials: 0,     // traitements spéciaux au cycle modale
  structuralClasses: new Set(),// classes structurelles nécessaires au shell
};

function hud(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

// ── Rendu de contenu COMMUN (identique A et B) ───────────────────────────

function productCardHTML(p) {
  return `
    <article class="s-card" data-product="${p.id}" role="listitem">
      <div class="s-card-media"></div>
      <div class="s-card-body">
        <div class="s-card-name">${p.name}</div>
        <div class="s-card-price">${formatPrice(p.price)}</div>
      </div>
    </article>`;
}

function discoveryCardHTML(c) {
  const provider = c.provider_name
    ? `<div class="s-disco-provider">${c.provider_name}${c.zone ? ' · ' + c.zone : ''}</div>` : '';
  const price = c.price != null ? `<div class="s-card-price">${formatPrice(c.price)}</div>` : '';
  return `
    <article class="s-card s-disco" data-kind="${c.kind}" role="listitem">
      <div class="s-card-media"></div>
      <div class="s-card-body">
        <span class="s-disco-badge">${c.subtitle}</span>
        <div class="s-card-name">${c.title}</div>
        ${price}${provider}
        <button class="s-disco-cta" data-kind="${c.kind}">${c.cta_label}</button>
      </div>
    </article>`;
}

function discoveryBlockHTML() {
  return `
    <section class="s-block s-discovery" aria-label="Près de vous">
      <h2 class="s-block-title">Près de vous <span>· Comores</span></h2>
      <div class="s-disco-rail" role="list">
        ${DISCOVERY_CARDS.map(discoveryCardHTML).join('')}
      </div>
    </section>`;
}

function merchBlockHTML() {
  return `
    <section class="s-block s-merch" aria-label="${MERCH_BLOCK.title}">
      <h2 class="s-block-title">${MERCH_BLOCK.title}</h2>
      <div class="s-merch-row">
        ${MERCH_BLOCK.blocks.map(b => `
          <div class="s-merch-tile">
            <div class="s-merch-tile-label">${b.label}</div>
            <div class="s-merch-tile-hint">${b.hint}</div>
          </div>`).join('')}
      </div>
    </section>`;
}

function categoryGridHTML(catId) {
  const products = PRODUCTS_BY_CATEGORY[catId] || [];
  return products.map(productCardHTML).join('');
}

function categoryChipsHTML(activeId) {
  return CATEGORIES.map(c => `
    <button class="s-chip ${c.id === activeId ? 'is-active' : ''}" data-cat="${c.id}">
      ${c.label}
    </button>`).join('');
}

// ── SHELL A — Pager Temu (reproduction fidèle simplifiée) ────────────────
//
// Reproduit les mécanismes structurels du vrai pager :
// - cage position:fixed
// - une page par catégorie, scroll vertical interne
// - swipe horizontal pleine page (scroll-snap-x)
// - sync chip active au scroll horizontal
// - le scroll owner est la cage, PAS le document

function mountPagerShell(root) {
  metrics.structuralClasses.add('s-pager-cage');
  metrics.structuralClasses.add('s-pager-track');
  metrics.structuralClasses.add('s-pager-page');
  metrics.structuralClasses.add('s-pager-page-scroll');

  root.innerHTML = `
    <div class="s-hero">Komerce — Hero</div>
    <div class="s-cats-sticky">
      <div class="s-chips" id="s-chips">${categoryChipsHTML('tout')}</div>
    </div>
    <div class="s-pager-cage" id="s-pager-cage">
      <div class="s-pager-track" id="s-pager-track">
        ${CATEGORIES.map((c, idx) => `
          <div class="s-pager-page" data-page="${c.id}">
            <div class="s-pager-page-scroll" data-page-scroll="${c.id}">
              ${idx === 0 ? discoveryBlockHTML() + merchBlockHTML() : ''}
              <div class="s-grid">${categoryGridHTML(c.id)}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  const cage = document.getElementById('s-pager-cage');
  const track = document.getElementById('s-pager-track');
  const chips = document.getElementById('s-chips');

  // MÉCANISME 1 — le scroll owner est la cage horizontale (scroll-snap-x)
  // + chaque page a son propre scroll vertical → DEUX types de scroll owner.
  metrics.scrollOwners.add('pager-cage-horizontal');
  metrics.syncMechanisms++;

  // MÉCANISME 2 — sync chip active au scroll horizontal du track
  let syncRaf = 0;
  track.addEventListener('scroll', () => {
    if (syncRaf) return;
    syncRaf = requestAnimationFrame(() => {
      syncRaf = 0;
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      const cat = CATEGORIES[idx];
      if (cat) {
        setActiveChip(chips, cat.id);
        hud('spike-cat', cat.label);
      }
    });
  }, { passive: true });
  metrics.syncMechanisms++;

  // MÉCANISME 3 — chaque page scroll vertical enregistre son propre owner
  root.querySelectorAll('[data-page-scroll]').forEach(pageScroll => {
    metrics.scrollOwners.add('pager-page-vertical');
    pageScroll.addEventListener('scroll', () => {
      // Le scroll vertical d'une page ne remonte PAS au document — c'est le
      // cœur de la friction : la position est locale à chaque page.
      hud('spike-memo', Math.round(pageScroll.scrollTop) + 'px (page ' + pageScroll.dataset.pageScroll + ')');
    }, { passive: true });
  });

  // Navigation catégorie = scroll horizontal de la cage (swipe pleine page)
  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    const idx = CATEGORIES.findIndex(c => c.id === btn.dataset.cat);
    if (idx < 0) return;
    track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' });
  });

  // MÉCANISME 4 — restauration position au retour modale : il faut mémoriser
  // QUELLE page ET le scrollTop LOCAL de cette page. Traitement spécial.
  metrics.modalCatalogSpecials++;
  window._spikeRestore = () => {
    const active = getActivePageScroll(track);
    if (active) {
      const saved = active._savedTop || 0;
      active.scrollTop = saved;
    }
  };
  window._spikeSave = () => {
    const active = getActivePageScroll(track);
    if (active) active._savedTop = active.scrollTop;
  };

  hud('spike-owner', 'cage fixed (2 types)');
  hud('spike-shell-name', 'A · Pager Temu');
  document.body.classList.add('shell-pager');

  return { name: 'pager' };
}

function getActivePageScroll(track) {
  const idx = Math.round(track.scrollLeft / track.clientWidth);
  const pages = track.querySelectorAll('[data-page-scroll]');
  return pages[idx] || pages[0];
}

// ── SHELL B — Vertical natif ─────────────────────────────────────────────
//
// UN seul scroll owner : le document.
// - rail catégories sticky (CSS position:sticky, pas de cage)
// - catégories = sections successives avec ancres
// - tap chip → scrollIntoView(offset header/rail)
// - swipe possible SUR LE RAIL catégories (scroll-x du rail seulement)
// - IntersectionObserver → chip active au scroll manuel
// - Discovery + merch = simples sections dans le flux, aucun montage spécial

function mountVerticalShell(root) {
  metrics.structuralClasses.add('s-v-cats-sticky');
  metrics.structuralClasses.add('s-v-section');

  root.innerHTML = `
    <div class="s-hero">Komerce — Hero</div>
    <div class="s-v-cats-sticky" id="s-v-cats">
      <div class="s-chips s-chips-scroll" id="s-chips">${categoryChipsHTML('tout')}</div>
    </div>
    <main class="s-v-flow" id="s-v-flow">
      ${discoveryBlockHTML()}
      ${merchBlockHTML()}
      ${CATEGORIES.map(c => `
        <section class="s-v-section" id="cat-${c.id}" data-cat-section="${c.id}"
                 aria-label="${c.label}">
          <h2 class="s-v-section-title">${c.label}</h2>
          <div class="s-grid">${categoryGridHTML(c.id)}</div>
        </section>`).join('')}
    </main>`;

  const chips = document.getElementById('s-chips');
  const rail = document.getElementById('s-v-cats');

  // MÉCANISME 1 (le seul) — IntersectionObserver synchronise la chip active.
  // Aucun scroll owner spécial : c'est le document qui scrolle.
  metrics.scrollOwners.add('document');
  metrics.syncMechanisms++;

  const railH = 96; // hauteur header + rail sticky (offset de scroll)
  const observer = new IntersectionObserver((entries) => {
    // La section la plus haute encore visible sous le rail = catégorie active
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) {
      const catId = visible[0].target.dataset.catSection;
      const cat = CATEGORIES.find(c => c.id === catId);
      if (cat) {
        setActiveChip(chips, cat.id);
        hud('spike-cat', cat.label);
      }
    }
  }, { rootMargin: `-${railH}px 0px -60% 0px`, threshold: 0 });

  root.querySelectorAll('[data-cat-section]').forEach(s => observer.observe(s));

  // Navigation catégorie = scrollIntoView avec offset sous le rail sticky.
  // Le swipe reste possible SUR LE RAIL (scroll-x natif du rail), pas pleine page.
  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    const target = document.getElementById('cat-' + btn.dataset.cat);
    if (!target) return;
    const y = target.getBoundingClientRect().top + window.scrollY - railH;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  });

  // Restauration position au retour modale : window.scrollY natif. AUCUN
  // traitement spécial, aucun style inline, aucune page à retrouver.
  window._spikeSave = () => { window._spikeSavedY = window.scrollY; };
  window._spikeRestore = () => { window.scrollTo({ top: window._spikeSavedY || 0 }); };
  // Pas d'incrément modalCatalogSpecials : c'est le comportement standard.

  window.addEventListener('scroll', () => {
    hud('spike-memo', Math.round(window.scrollY) + 'px (document)');
  }, { passive: true });

  hud('spike-owner', 'document (1 seul)');
  hud('spike-shell-name', 'B · Vertical natif');
  document.body.classList.add('shell-vertical');

  return { name: 'vertical' };
}

// ── Utilitaires partagés ─────────────────────────────────────────────────

function setActiveChip(chips, catId) {
  chips.querySelectorAll('.s-chip').forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.cat === catId);
  });
  // Amener la chip active dans la vue du rail (commun aux deux shells)
  const active = chips.querySelector('.s-chip.is-active');
  if (active && active.scrollIntoView) {
    active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
}

// ── Cycle modale + panier PARTAGÉ (identique A et B) ─────────────────────
//
// Prouve que retour PDP et ouverture panier ne dépendent pas du shell.

function installSharedModalAndCart(root) {
  const modal = document.getElementById('spike-modal');
  const cart = document.getElementById('spike-cart');

  // Clic carte produit → ouvrir modale (mémorise la position via _spikeSave)
  root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-product]');
    if (card && !e.target.closest('button')) {
      const id = card.dataset.product;
      const product = findProduct(id);
      if (product) openModal(product);
      return;
    }
    // CTA discovery (Acheter/Commander/Demander) — action directe, pas de modale
    const cta = e.target.closest('.s-disco-cta');
    if (cta) {
      openCart(); // le CTA "Acheter" ajoute au panier (mock)
      return;
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-close')) closeModal();
  });
  modal.querySelector('.spike-modal-cta').addEventListener('click', () => {
    closeModal();
    openCart();
  });
  cart.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-cart-close')) closeCart();
  });

  function openModal(product) {
    if (window._spikeSave) window._spikeSave();      // mémorise position AVANT
    modal.querySelector('.spike-modal-title').textContent = product.name;
    modal.querySelector('.spike-modal-price').textContent = formatPrice(product.price);
    modal.querySelector('.spike-modal-desc').textContent =
      `Description du produit ${product.name}. Livraison, variantes, etc.`;
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (window._spikeRestore) window._spikeRestore(); // restaure position APRÈS
  }
  function openCart() {
    cart.hidden = false;
    document.body.classList.add('cart-open');
  }
  function closeCart() {
    cart.hidden = true;
    document.body.classList.remove('cart-open');
  }
}

function findProduct(id) {
  for (const list of Object.values(PRODUCTS_BY_CATEGORY)) {
    const found = list.find(p => p.id === id);
    if (found) return found;
  }
  return null;
}

// ── Bootstrap ────────────────────────────────────────────────────────────

function currentShell() {
  const params = new URLSearchParams(location.search);
  const s = params.get('shell');
  return s === 'pager' ? 'pager' : 'vertical'; // défaut : vertical
}

function boot() {
  const root = document.getElementById('spike-root');
  const shell = currentShell();

  if (shell === 'pager') {
    mountPagerShell(root);
  } else {
    mountVerticalShell(root);
  }

  installSharedModalAndCart(root);

  // Publier les métriques (récupérées par metrics.js pour le rapport)
  window.__SPIKE_METRICS__ = {
    shell,
    scrollOwners: metrics.scrollOwners.size,
    scrollOwnerLabels: [...metrics.scrollOwners],
    syncMechanisms: metrics.syncMechanisms,
    modalCatalogSpecials: metrics.modalCatalogSpecials,
    structuralClasses: metrics.structuralClasses.size,
    structuralClassLabels: [...metrics.structuralClasses],
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
