/**
 * @komerce-arch
 * @role          canonical-live-cockpit-kit
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        view_definitions
 * @outputs       exclusive_view_cockpit_navigation
 * @depends       none
 * @used-by       public/dashboards/canonical/js/hub-live.js, public/dashboards/canonical/js/relay-live.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      exclusive_views, single_parent_navigation, read_only_live_cockpit
 * @impact-areas  admin-dashboard, hub, relais
 * @version       2026-10-live-kit-v1
 */
'use strict';

// Moteur commun des cockpits Live Hub / Relais : une vue = une question, un parent évident,
// historique navigateur fidèle, relecture périodique. Lecture seule : aucune action métier ici.
(function initKomerceLiveKit(global) {
  const POLL_MS = 10000;
  // Au-delà de 3 intervalles sans lecture réussie, l'écran se déclare périmé.
  const STALE_AFTER_MS = POLL_MS * 3;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function fmtKmf(value) {
    return `${Math.round(num(value)).toLocaleString('fr-FR')} KMF`;
  }

  // Âge lisible d'un objet : « 5 h », « 2 j 3 h ».
  function ageLabel(hours) {
    const h = Math.max(0, Math.round(num(hours)));
    if (h < 48) return `${h} h`;
    const d = Math.floor(h / 24);
    return `${d} j${h % 24 ? ` ${h % 24} h` : ''}`;
  }

  function queryString(params) {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') q.set(key, String(value));
    });
    const text = q.toString();
    return text ? `?${text}` : '';
  }

  async function api(path) {
    const res = await global.fetch(path, { method:'GET', credentials:'include', headers:{ Accept:'application/json' } });
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    if (!res.ok) {
      const error = new Error(body?.error || `HTTP ${res.status}`);
      error.code = body?.code || null;
      throw error;
    }
    return body;
  }

  // Éléments de présentation partagés (mêmes classes que le cockpit Sourcing).
  function flowTrack(steps) {
    const first = steps.findIndex(step => step.state === 'running');
    return `<div class="kir-run-flow-track lk-flow-track">${steps.map((step, index) => {
      const marker = step.state === 'attention' ? '!' : String(index + 1);
      const cls = `kir-run-flow-step is-${step.state}${index === first ? ' is-current' : ''}`;
      const body = `<span class="kir-run-flow-marker">${marker}</span><div><strong>${esc(step.label)}</strong><small>${esc(step.count)}</small></div>`;
      return step.href
        ? `<a class="${cls}" href="${step.href}" data-cockpit-nav>${body}</a>`
        : `<div class="${cls}">${body}</div>`;
    }).join('')}</div>`;
  }

  function tiles(label, items) {
    return `<section class="kir-run-truth" aria-label="${esc(label)}">
      <div class="kir-run-truth-head"><span class="kir-section-kicker">${esc(label)}</span></div>
      <div class="kir-run-truth-grid is-four lk-tiles-grid">${items.map(item => {
        const body = `<span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(item.sub || '')}</small>`;
        return item.href
          ? `<a class="${item.cls || ''}" href="${item.href}" data-cockpit-nav aria-label="${esc(item.label)} — ouvrir le détail">${body}</a>`
          : `<div class="${item.cls || ''}">${body}</div>`;
      }).join('')}</div>
    </section>`;
  }

  function table(columns, rows, { empty = 'Rien à afficher.' } = {}) {
    if (!rows.length) return `<div class="kir-empty">${esc(empty)}</div>`;
    return `<div class="lk-table-wrap"><table class="kir-table lk-table">
      <thead><tr>${columns.map(col => `<th>${esc(col)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  }

  function pager(page, pages, hrefFor) {
    if (!pages || pages <= 1) return '';
    return `<nav class="kir-passage-pagination" aria-label="Pagination">
      ${page > 1 ? `<a href="${hrefFor(page - 1)}" data-cockpit-nav>← Plus récents</a>` : '<span></span>'}
      <span>Page ${page} / ${pages}</span>
      ${page < pages ? `<a href="${hrefFor(page + 1)}" data-cockpit-nav>Plus anciens →</a>` : '<span></span>'}
    </nav>`;
  }

  function createCockpit(config) {
    const { basePath, domainLabel, tabs, views, defaultView } = config;
    let mountedRoot = null;
    let timer = null;
    let epoch = 0;
    let last = null;
    let lastOkAt = 0;
    // Écouteurs de la fenêtre / du document : un seul jeu actif, retiré avant chaque nouveau montage
    // (sinon chaque navigation SPA ajoutait des relectures supplémentaires — LIVE-01).
    let detach = [];

    function release() {
      detach.forEach(fn => { try { fn(); } catch (_) { /* écouteur déjà retiré */ } });
      detach = [];
      if (timer) clearInterval(timer);
      timer = null;
    }

    function listen(target, type, handler) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, handler);
      detach.push(() => target.removeEventListener?.(type, handler));
    }

    function parseSearch(search) {
      const q = new URLSearchParams(search || '');
      const p = {};
      q.forEach((value, key) => { p[key] = value; });
      p.view = views[p.view] ? p.view : defaultView;
      return p;
    }

    const currentParams = () => parseSearch(global.location?.search);
    const urlFor = (view, extra = {}) => `${basePath}${queryString({ view:view === defaultView ? '' : view, ...extra })}`;

    function domainNav(activeTab) {
      return `<nav class="kir-domain-nav" aria-label="Domaine ${esc(domainLabel)}"><strong>${esc(domainLabel)}</strong>
        ${tabs.map(tab => `<a class="${tab.key === activeTab ? 'is-active' : ''}" href="${tab.href}" data-cockpit-nav ${tab.key === activeTab ? 'aria-current="page"' : ''}>${esc(tab.label)}</a>`).join('')}
      </nav>`;
    }

    function breadcrumb(crumbs) {
      return `<nav class="kir-breadcrumb" aria-label="Fil d’Ariane">${crumbs.map(crumb =>
        crumb.href ? `<a href="${crumb.href}" data-cockpit-nav>${esc(crumb.label)}</a>`
          : crumb.plain ? `<span class="kir-crumb-domain">${esc(crumb.label)}</span>`
            : `<span aria-current="page">${esc(crumb.label)}</span>`
      ).join('<i aria-hidden="true">›</i>')}</nav>`;
    }

    // Rendu pur (testable) : l'état de la page est entièrement dans l'URL et les données chargées.
    function renderHtml(search, data) {
      const p = parseSearch(search);
      const view = views[p.view];
      const out = view.render(p, data, { urlFor });
      const nav = view.nav ? view.nav(p, data, { urlFor }) : { crumbs:[], back:null };
      const head = out.hero || `<div class="kir-drill-head"><div>
          ${breadcrumb(nav.crumbs)}
          ${nav.back ? `<a href="${nav.back.href}" data-cockpit-nav class="kir-back">${esc(nav.back.label)}</a>` : ''}
          <h2>${esc(out.title)}</h2>
          ${out.copy ? `<p>${esc(out.copy)}</p>` : ''}
        </div></div>`;
      return `<section class="kir-page">${domainNav(view.tab(p))}<main class="kir-main">${head}${out.body}</main></section>`;
    }

    // Coque noire appliquée dès le montage : un écran de chargement ou d'erreur ne doit jamais
    // s'afficher sur le fond clair par défaut.
    function applyShell(root) {
      root.className = 'kmc-import-runtime kmc-domain-cockpit';
      root.setAttribute?.('data-cockpit-pattern', 'v1');
      root.setAttribute?.('data-cockpit-language', 'live-ops');
    }

    function render(root, search, data) {
      applyShell(root);
      root.innerHTML = renderHtml(search, data);
    }

    async function refresh() {
      if (!mountedRoot || !global.document.contains(mountedRoot) || global.location.pathname !== basePath) {
        release();
        return;
      }
      const token = ++epoch;
      const p = currentParams();
      const key = JSON.stringify(p);
      try {
        const data = await views[p.view].load(p, api);
        if (token !== epoch) return;
        last = { key, data };
        lastOkAt = Date.now();
        mountedRoot.removeAttribute?.('data-live-stale');
        render(mountedRoot, global.location.search, data);
      } catch (error) {
        if (token !== epoch) return;
        const message = `<div class="kir-error">Cockpit indisponible · ${esc(error.message)}</div>`;
        // Une relecture qui échoue garde la vue affichée si c'est la même ; jamais l'écran d'une autre vue.
        if (last && last.key === key) {
          render(mountedRoot, global.location.search, last.data);
          // Données figées : l'écran le dit (état périmé) au lieu de paraître « live ».
          if (Date.now() - lastOkAt > STALE_AFTER_MS) mountedRoot.setAttribute?.('data-live-stale', 'true');
          mountedRoot.querySelector?.('.kir-main')?.insertAdjacentHTML('afterbegin', message.replace('indisponible', 'actualisation impossible'));
        } else {
          mountedRoot.innerHTML = `<section class="kir-page">${domainNav(views[p.view].tab(p))}<main class="kir-main">${message}</main></section>`;
        }
      }
    }

    function onClick(event) {
      const link = event.target?.closest?.('[data-cockpit-nav]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = link.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      global.history.pushState({}, '', href);
      refresh();
    }

    async function mount(options = {}) {
      if (!options.root) throw new Error('live_cockpit_root_missing');
      mountedRoot = options.root;
      applyShell(mountedRoot);
      last = null;
      lastOkAt = 0;
      epoch += 1;
      release();
      mountedRoot.innerHTML = `<section class="kir-page"><div class="kir-empty">Chargement…</div></section>`;
      listen(mountedRoot, 'click', onClick);
      listen(global, 'popstate', () => refresh());
      listen(global, 'focus', () => refresh());
      listen(global.document, 'visibilitychange', () => {
        if (global.document.visibilityState === 'visible') refresh();
      });
      await refresh();
      // Onglet masqué : aucune relecture (elle reprend à la visibilité, ci-dessus).
      timer = setInterval(() => {
        if (global.document?.visibilityState === 'hidden') return;
        refresh();
      }, POLL_MS);
    }

    return Object.freeze({ mount, renderHtml, urlFor, parseSearch });
  }

  global.KomerceLiveKit = Object.freeze({
    createCockpit, esc, num, fmtDate, fmtKmf, ageLabel, queryString, flowTrack, tiles, table, pager,
  });
})(typeof window !== 'undefined' ? window : globalThis);
