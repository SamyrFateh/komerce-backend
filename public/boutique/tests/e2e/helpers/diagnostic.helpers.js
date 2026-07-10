/**
 * helpers/diagnostic.helpers.js
 * @brief Outils de diagnostic pour trier les échecs E2E :
 *        bug fonctionnel réel vs test mal adapté.
 *
 * Chaque helper capture du contexte AVANT de planter, pour que le rapport
 * d'échec contienne assez d'info pour trancher sans re-lancer en debug.
 */
'use strict';
const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ── Snapshot DOM : capture l'état réel de l'élément au moment du check ──

/**
 * Vérifie qu'un sélecteur existe et capture un diagnostic si absent.
 * Retourne { found: boolean, diagnostic: string }
 *
 * Usage dans un test :
 *   const diag = await expectAttached(page, '#k-search-dropdown.open', 'dropdown recherche');
 *   if (!diag.found) test.info().annotations.push({ type: 'triage', description: diag.diagnostic });
 */
async function expectAttached(page, selector, label) {
  const count = await page.locator(selector).count();
  if (count > 0) return { found: true, diagnostic: '' };

  // Pas trouvé — capturer le contexte pour triage
  const diagnostic = await page.evaluate((sel) => {
    const parts = sel.split(/(?=[.#\[])/); // découpe '#foo.bar[attr]'
    const id = parts.find(p => p.startsWith('#'))?.slice(1);
    const cls = parts.filter(p => p.startsWith('.')).map(p => p.slice(1));

    const lines = [];

    // L'élément de base existe-t-il ?
    if (id) {
      const el = document.getElementById(id);
      if (!el) {
        lines.push(`❌ #${id} ABSENT du DOM`);
        // Chercher des IDs proches
        const all = [...document.querySelectorAll('[id]')].map(e => e.id);
        const similar = all.filter(i => i.includes(id.replace('k-', '')) || id.includes(i.replace('k-', '')));
        if (similar.length) lines.push(`   IDs proches : ${similar.slice(0, 5).join(', ')}`);
      } else {
        lines.push(`✓ #${id} existe`);
        lines.push(`   classes: ${el.className}`);
        lines.push(`   visible: ${el.offsetParent !== null}`);
        lines.push(`   size: ${el.offsetWidth}×${el.offsetHeight}`);
        lines.push(`   textContent (50c): "${(el.textContent || '').slice(0, 50).trim()}"`);
        if (cls.length) {
          cls.forEach(c => {
            lines.push(`   .${c}: ${el.classList.contains(c) ? '✓ présente' : '❌ ABSENTE'}`);
          });
        }
      }
    }

    // Contexte général
    lines.push(`   URL: ${location.href}`);
    lines.push(`   viewport: ${window.innerWidth}×${window.innerHeight}`);
    lines.push(`   body classes: ${document.body.className || '(aucune)'}`);

    return lines.join('\n');
  }, selector);

  return { found: false, diagnostic: `[${label}] Sélecteur "${selector}" introuvable\n${diagnostic}` };
}

/**
 * Attend un sélecteur avec diagnostic enrichi en cas de timeout.
 * Remplace page.waitForSelector() dans les cas où on veut trier.
 */
async function waitForSelectorWithDiag(page, selector, label, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return { ok: true, diagnostic: '' };
  } catch (err) {
    const diag = await expectAttached(page, selector, label);
    const screenshot = await page.screenshot({ type: 'png' }).catch(() => null);

    return {
      ok: false,
      diagnostic: [
        `⏱️ Timeout (${timeout}ms) sur "${selector}"`,
        diag.diagnostic,
        err.message.split('\n')[0],
      ].join('\n'),
      screenshot,
    };
  }
}

/**
 * Capture un snapshot complet de la page pour un rapport de triage.
 * Utile en beforeEach/afterEach pour les specs instables.
 */
async function capturePageState(page) {
  return page.evaluate(() => {
    const state = {};

    // URL et viewport
    state.url = location.href;
    state.viewport = `${window.innerWidth}×${window.innerHeight}`;

    // Vues actives (quelle vue est affichée ?)
    state.bodyClasses = document.body.className;
    const activeTab = document.querySelector('.k-bnav-item.active, .k-header-nav-btn.active');
    state.activeTab = activeTab?.dataset.tab || '(aucun)';

    // Éléments clés : visibilité
    const checks = [
      '#k-grid', '#k-modal-overlay', '#k-cart-drawer',
      '#k-order-modal', '#k-group-view', '#k-toast',
      '#k-search-dropdown', '#k-side-cart',
    ];
    state.elements = {};
    checks.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) { state.elements[sel] = 'ABSENT'; return; }
      state.elements[sel] = {
        visible: el.offsetParent !== null || el.classList.contains('open'),
        classes: el.className.split(' ').filter(c => c).slice(0, 8).join(' '),
        size: `${el.offsetWidth}×${el.offsetHeight}`,
      };
    });

    // Erreurs JS en mémoire (si window.__e2eErrors est branché)
    state.jsErrors = window.__e2eErrors || [];

    // Requêtes API en cours / échouées
    state.pendingFetches = performance.getEntriesByType('resource')
      .filter(r => r.name.includes('/api/') && r.responseEnd === 0)
      .map(r => r.name)
      .slice(0, 5);

    return state;
  });
}

/**
 * Collecte les erreurs réseau (4xx/5xx) pendant un test.
 * Usage :
 *   const monitor = startNetworkMonitor(page);
 *   // ... actions du test ...
 *   const failures = monitor.getFailures();
 */
function startNetworkMonitor(page) {
  const failures = [];
  const pending = new Map();

  const onRequest = (req) => {
    if (req.url().includes('/api/')) {
      pending.set(req.url(), Date.now());
    }
  };
  const onResponse = (resp) => {
    pending.delete(resp.url());
    if (resp.status() >= 400 && resp.url().includes('/api/')) {
      failures.push({ url: resp.url(), status: resp.status() });
    }
  };
  const onFailed = (req) => {
    pending.delete(req.url());
    if (req.url().includes('/api/')) {
      failures.push({ url: req.url(), status: 'FAILED', error: req.failure()?.errorText });
    }
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);

  return {
    getFailures: () => [...failures],
    getPending: () => [...pending.entries()].map(([url, t]) => ({ url, waitingMs: Date.now() - t })),
    stop: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onFailed);
    },
  };
}

// ── Rapport de triage : écrit un fichier .md par test échoué ────────────

/**
 * Génère un rapport de triage dans test-results/triage/
 * Appeler dans le afterEach d'un test instable.
 */
async function writeTriageReport(page, testInfo) {
  if (testInfo.status === 'passed') return;

  const dir = path.join('test-results', 'triage');
  fs.mkdirSync(dir, { recursive: true });

  const state = await capturePageState(page).catch(() => ({ error: 'capture failed' }));
  const slug = testInfo.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60);
  const file = path.join(dir, `${slug}_${testInfo.project.name.replace(/\s/g, '_')}.md`);

  const lines = [
    `# Triage — ${testInfo.title}`,
    `**Projet :** ${testInfo.project.name}`,
    `**Statut :** ${testInfo.status}`,
    `**Durée :** ${testInfo.duration}ms`,
    `**Erreur :** ${testInfo.error?.message?.split('\n')[0] || '(aucune)'}`,
    '',
    '## État de la page au moment de l\'échec',
    '```json',
    JSON.stringify(state, null, 2),
    '```',
    '',
    '## Diagnostic',
    '',
    '### C\'est un BUG RÉEL si :',
    '- Un élément attendu est ABSENT du DOM (pas juste caché)',
    '- Une requête API retourne 4xx/5xx',
    '- Le texte affiché est incorrect (pas un problème de timing)',
    '- Le bug se reproduit en navigation manuelle',
    '',
    '### C\'est un TEST MAL ADAPTÉ si :',
    '- L\'élément existe mais n\'a pas la classe attendue (sélecteur trop précis)',
    '- Timeout sur un élément qui apparaît plus tard (timing trop court)',
    '- L\'état terminal est différent mais valide (ex: gate auth au lieu de contenu)',
    '- Le test passe sur Chrome mais échoue sur Safari (comportement navigateur légitime)',
    '- Le viewport ne correspond pas au sélecteur scopé (mobile vs desktop)',
  ];

  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
}

module.exports = {
  expectAttached,
  waitForSelectorWithDiag,
  capturePageState,
  startNetworkMonitor,
  writeTriageReport,
};
