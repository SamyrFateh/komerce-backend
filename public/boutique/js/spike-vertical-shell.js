/**
 * @komerce-arch-lite
 * @role          catalog-spike-vertical-shell
 * @domain        catalog
 * @layer         ui-infrastructure
 * @owner         public/boutique/js/spike-vertical-shell.js
 * @purpose       SPIKE Phase 2 (branche isolee, jamais merge) — shell vertical mobile derriere ?shell=vertical, no-op par defaut.
 * @impact-areas  mobile-navigation, scroll-ownership, category-navigation
 * @version       2026-09
 */
/**
 * spike-vertical-shell.js — PHASE 2 spike instrumentation.
 *
 * ⚠️ SPIKE — branche isolée, jamais mergé dans main.
 *
 * Ce module N'A AUCUN EFFET tant que le flag `?shell=vertical` n'est pas présent.
 * Comportement Boutique par défaut STRICTEMENT inchangé (pager Temu).
 *
 * Rôle :
 *  1. isVerticalShell() — lit le flag d'URL, source unique de vérité du spike.
 *  2. Un IntersectionObserver + rail sticky pour la navigation catégorie en
 *     mode vertical (le pager n'étant pas monté, il faut synchroniser la chip
 *     active au scroll document).
 *  3. Instrumentation live : scroll owner, window.scrollY, catégorie active,
 *     containers overflow/fixed, dérive de position autour des modales.
 *
 * Ce module ne duplique AUCUNE logique métier : il consomme les mêmes sections
 * .k-cat-section[data-cat] déjà rendues par render-home-sections.js, et le même
 * rail de chips #k-cats déjà rendu par la Boutique. Il ne fait que : ne pas
 * monter le pager (via le hook flag dans b-catalog) + observer + naviguer.
 */
'use strict';

// ── Flag — source unique ─────────────────────────────────────────────────

export function isVerticalShell() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('shell') === 'vertical';
  } catch {
    return false;
  }
}

// ── Instrumentation (HUD spike, optionnel) ───────────────────────────────

const spikeState = {
  lastScrollBeforeModal: null,
  driftPx: null,
};

function countOverflowContainers() {
  let n = 0;
  document.querySelectorAll('*').forEach(el => {
    const s = getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) n++;
  });
  return n;
}

function countFixedContainers() {
  let n = 0;
  document.querySelectorAll('*').forEach(el => {
    if (getComputedStyle(el).position === 'fixed') n++;
  });
  return n;
}

export function spikeSnapshot() {
  return {
    shell: isVerticalShell() ? 'vertical' : 'pager',
    scrollOwner: document.getElementById('k-page-scroll')?.classList.contains('k-pager-active')
      ? 'k-page-scroll (cage)' : 'window/document',
    scrollY: Math.round(window.scrollY),
    pageScrollTop: Math.round(document.getElementById('k-page-scroll')?.scrollTop || 0),
    overflowContainers: countOverflowContainers(),
    fixedContainers: countFixedContainers(),
    driftPx: spikeState.driftPx,
  };
}

export function spikeMarkBeforeModal() {
  spikeState.lastScrollBeforeModal = window.scrollY;
}

export function spikeMeasureAfterModal() {
  if (spikeState.lastScrollBeforeModal == null) return null;
  spikeState.driftPx = Math.round(window.scrollY - spikeState.lastScrollBeforeModal);
  return spikeState.driftPx;
}

let _hudInstalled = false;
function installHud() {
  if (_hudInstalled) return;
  _hudInstalled = true;
  const hud = document.createElement('div');
  hud.id = 'spike-vertical-hud';
  hud.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:99999',
    'background:#111', 'color:#7fd88f', 'font:11px system-ui', 'padding:3px 8px',
    'display:flex', 'gap:12px', 'flex-wrap:wrap', 'pointer-events:none',
  ].join(';');
  document.body.appendChild(hud);
  function refresh() {
    const s = spikeSnapshot();
    hud.innerHTML =
      `shell:<b>${s.shell}</b>` +
      ` owner:<b>${s.scrollOwner}</b>` +
      ` Y:<b>${s.scrollY}</b>` +
      ` overflow:<b>${s.overflowContainers}</b>` +
      ` fixed:<b>${s.fixedContainers}</b>` +
      ` cat:<b id="spike-cat-live">—</b>` +
      (s.driftPx != null ? ` drift:<b>${s.driftPx}px</b>` : '');
    requestAnimationFrame(refresh);
  }
  refresh();
}

// ── Navigation catégorie verticale (rail sticky + IntersectionObserver) ──

let _observer = null;
const RAIL_OFFSET = 100; // header + rail sticky approximatif

function activeChipSync(catId) {
  const cats = document.getElementById('k-cats');
  if (!cats) return;
  cats.querySelectorAll('[data-cat]').forEach(chip => {
    chip.classList.toggle('is-active', chip.dataset.cat === catId);
  });
  const live = document.getElementById('spike-cat-live');
  if (live) live.textContent = catId;
}

export function installVerticalNavigation() {
  if (!isVerticalShell()) return;

  // Observer : la section la plus haute encore sous le rail = catégorie active.
  // rootMargin haut = -RAIL_OFFSET pour compenser le rail sticky ; bas = -55%
  // pour éviter l'oscillation quand deux sections sont visibles.
  if (_observer) _observer.disconnect();
  _observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) {
      const cat = visible[0].target.getAttribute('data-cat');
      if (cat) activeChipSync(cat);
    }
  }, { rootMargin: `-${RAIL_OFFSET}px 0px -55% 0px`, threshold: 0 });

  document.querySelectorAll('.k-cat-section[data-cat]').forEach(s => _observer.observe(s));

  // Tap chip → scrollIntoView de la section avec offset sous le rail sticky.
  const cats = document.getElementById('k-cats');
  if (cats && !cats._spikeNavBound) {
    cats._spikeNavBound = true;
    cats.addEventListener('click', (e) => {
      if (!isVerticalShell()) return;
      const chip = e.target.closest('[data-cat]');
      if (!chip) return;
      const section = document.querySelector(`.k-cat-section[data-cat="${chip.dataset.cat}"]`);
      if (!section) return;
      // Empêcher le handler pager par défaut : en vertical on scrolle le document.
      e.stopPropagation();
      const y = section.getBoundingClientRect().top + window.scrollY - RAIL_OFFSET;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }, true); // capture : passe avant le handler catégorie standard
  }
}

// ── Bootstrap spike ──────────────────────────────────────────────────────

function injectSpikeCss() {
  if (document.getElementById('spike-vertical-css')) return;
  const link = document.createElement('link');
  link.id = 'spike-vertical-css';
  link.rel = 'stylesheet';
  link.href = '/boutique/css/spike-vertical-shell.css';
  document.head.appendChild(link);
}

export function initVerticalShellSpike(bus) {
  if (!isVerticalShell()) {
    // Contrat body-class : l'état du shell doit être réversible, notamment
    // après navigation/bfcache ou retour vers l'URL sans le flag de spike.
    document.body?.classList.remove('spike-shell-vertical');
    return;
  }
  injectSpikeCss();
  document.body.classList.add('spike-shell-vertical');
  installHud();

  // Instrumentation de dérive PDP — branchée sur les events modal EXISTANTS.
  // Aucune modification de b-modal-core.js : on observe, on ne modifie pas.
  if (bus && typeof bus.on === 'function') {
    bus.on('modal:opened', () => spikeMarkBeforeModal());
    bus.on('modal:closed', () => {
      // Laisser le modal restaurer la position (scrollToPosition natif window),
      // puis mesurer la dérive au frame suivant.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const drift = spikeMeasureAfterModal();
        if (drift !== null) {
          console.log('[spike] PDP return drift:', drift, 'px (0 = exact)');
        }
      }));
    });
  }
  // La navigation est (ré)installée après chaque rendu du catalogue via le hook.
}
