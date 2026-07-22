'use strict';
/**
 * scripts/gate-smoke-boutique.cjs
 *
 * Gate de fumée fonctionnel — boutique Komerce.
 * Mesure « ça marche pour l'utilisateur », pas la conformité structurelle.
 * Voir EXEC-gate-smoke-boutique-sonnet.md pour la règle cardinale et le §6
 * (les 5 familles de parcours). Ce fichier livre S1 : squelette + Parcours 1
 * (catalogue) & Parcours 2 (PDP), réutilisés depuis le driver T-030 assaini
 * (scripts/lib/t030-capture.cjs) — zéro `force: true`, contexte neuf par
 * cas, routes installées avant navigation.
 *
 * Étapes suivantes (non couvertes ici, voir doc EXEC) :
 *   S2 — Parcours 3 (ajout panier)
 *   S3 — Parcours 4 & 5 (panier partagé + checkout côté boutique)
 *   S4 — wiring CI + budget
 *
 * Hors périmètre explicite (voir §4 OUT du doc EXEC) : correctness backend
 * des totaux/stocks, gate anti-échec-silencieux global, correction de bugs.
 */

const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const driver = require('./lib/t030-capture.cjs');

const PORT = process.env.GATE_SMOKE_PORT || 4173;
const BASE_URL = process.env.T030_BASE_URL || `http://127.0.0.1:${PORT}/boutique/`;
const SERVE_ROOT = path.resolve(__dirname, '..', '..'); // public/
const ARTIFACTS_DIR = path.resolve(__dirname, '..', '..', '..', '.agent', 'evidence', 'GATE-SMOKE-BOUTIQUE');

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

// ── Serveur statique ─────────────────────────────────────────────────────
// Même principe que playwright.config.js (webServer): `npx serve` sur la
// racine public/, pour que les chemins absolus /boutique/..., /images/...
// résolvent. Géré ici (pas via `playwright test`) car ce runner est un
// script autonome, au même titre que le driver T-030 dont il hérite.

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) return reject(new Error(`serveur non prêt après ${timeoutMs} ms (${url})`));
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

function resolveServeScript() {
  const pkgPath = require.resolve('serve/package.json');
  const pkg = require(pkgPath);
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.serve;
  return path.join(path.dirname(pkgPath), binRel);
}

async function startServer() {
  if (process.env.GATE_SMOKE_NO_SERVER) return null; // réutilise un serveur déjà lancé (dev local)
  // On lance `node <serve/build/main.js> ...` directement (process.execPath),
  // au lieu de `npx serve`. npx passe par un .cmd sous Windows, ce qui force
  // shell:true — et spawn(shell:true) plante par intermittence avec EINVAL
  // sur certaines installations Windows/Node (bug connu côté Node, pas côté
  // ce script). En invoquant le binaire node directement, on n'a plus besoin
  // de shell du tout, sur aucun OS.
  const serveScript = resolveServeScript();
  const child = spawn(process.execPath, [serveScript, SERVE_ROOT, '-l', String(PORT), '--no-clipboard'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await waitForServer(BASE_URL, 15_000);
  return child;
}

function stopServer(child) {
  if (!child) return;
  child.kill();
}

// ── Parcours 1 — Catalogue (6 viewports) ────────────────────────────────
// Assertion : #k-grid contient ≥ 1 carte réelle (pas l'état vide "bientôt
// disponible"), sur chaque viewport.

async function runParcours1(browser, log) {
  const results = [];
  for (const [vpName, w, h] of driver.VIEWPORTS) {
    const label = `catalogue-${vpName}`;
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await context.newPage();
    const pageLog = [];
    page.on('console', (m) => pageLog.push(`[console:${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => pageLog.push(`[pageerror] ${e.message}`));
    let ok = false;
    let detail = null;
    try {
      await driver.installApi(page, null, pageLog);
      const listResponsePromise = page
        .waitForResponse((r) => new URL(r.url()).pathname === '/api/products')
        .catch(() => null);
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await listResponsePromise;

      const cardCount = await page.locator('#k-grid .k-card, #k-grid .k-promo-card').count();
      const realCardCount = await page.locator('#k-grid .k-card[data-id], #k-grid .k-promo-card[data-id]').count();
      detail = { cardCount, realCardCount };
      ok = realCardCount >= 1;
      if (!ok) {
        fs.writeFileSync(
          path.join(ARTIFACTS_DIR, `fail-${label}.log`),
          `${JSON.stringify(detail)}\n${pageLog.join('\n')}`,
        );
        await page.screenshot({ path: path.join(ARTIFACTS_DIR, `fail-${label}.png`) });
      }
    } catch (error) {
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, `fail-${label}.log`),
        `${pageLog.join('\n')}\n[exception] ${error.stack}`,
      );
      detail = { error: error.message };
    } finally {
      await context.close();
    }
    log.push(`[parcours1] ${label} → ${ok ? 'OK' : 'ÉCHEC'} ${JSON.stringify(detail)}`);
    results.push({ parcours: 1, case: label, ok, detail });
  }
  return results;
}

// ── Parcours 2 — PDP (6 viewports × 6 états) ────────────────────────────
// Réutilise directement installApi/openPdp/snapshotState/validateSnapshot
// du driver assaini (matrice T-030, sans force).

async function runParcours2(browser, log) {
  const results = [];
  for (const [vpName, w, h] of driver.VIEWPORTS) {
    for (const state of driver.STATES) {
      const label = `pdp-${vpName}-${state}`;
      const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const pageLog = [];
      page.on('console', (m) => pageLog.push(`[console:${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => pageLog.push(`[pageerror] ${e.message}`));
      page.on('requestfailed', (r) => pageLog.push(`[reqfail] ${r.url()}`));
      let ok = false;
      let snapshot = null;
      try {
        const loadingControl = state === 'LOADING' ? driver.createLoadingControl() : null;
        await driver.installApi(page, state, pageLog, loadingControl);
        const openPromise = driver.openPdp(page, state);
        openPromise.catch(() => {}); // évite un unhandled rejection si le garde LOADING rejette avant que openPromise soit awaited
        if (loadingControl) {
          await driver.withTimeout(loadingControl.requested.promise, 10_000, 'requête /detail LOADING absente');
        }
        await openPromise;
        snapshot = await driver.snapshotState(page, vpName, state);
        ok = driver.validateSnapshot(state, snapshot);
        if (loadingControl) {
          loadingControl.release.resolve();
          await driver.withTimeout(loadingControl.completed.promise, 5_000, 'libération /detail LOADING incomplète');
        }
        if (!ok) {
          fs.writeFileSync(
            path.join(ARTIFACTS_DIR, `fail-${label}.log`),
            `${JSON.stringify(snapshot)}\n${pageLog.join('\n')}`,
          );
          await page.screenshot({ path: path.join(ARTIFACTS_DIR, `fail-${label}.png`) });
        }
      } catch (error) {
        fs.writeFileSync(
          path.join(ARTIFACTS_DIR, `fail-${label}.log`),
          `${pageLog.join('\n')}\n[exception] ${error.stack}`,
        );
        snapshot = { error: error.message };
      } finally {
        await context.close();
      }
      log.push(`[parcours2] ${label} → ${ok ? 'OK' : 'ÉCHEC'}`);
      results.push({ parcours: 2, case: label, ok, detail: snapshot });
    }
  }
  return results;
}

async function main() {
  const log = [];
  fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const serverProcess = await startServer();
  const browser = await chromium.launch();
  let allResults = [];
  try {
    const p1 = await runParcours1(browser, log);
    const p2 = await runParcours2(browser, log);
    allResults = [...p1, ...p2];
  } finally {
    await browser.close();
    stopServer(serverProcess);
  }

  const failed = allResults.filter((r) => !r.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    total: allResults.length,
    ok: allResults.length - failed.length,
    failed: failed.length,
    parcours: {
      1: { total: allResults.filter((r) => r.parcours === 1).length, failed: failed.filter((r) => r.parcours === 1).length },
      2: { total: allResults.filter((r) => r.parcours === 2).length, failed: failed.filter((r) => r.parcours === 2).length },
    },
    failedCases: failed.map((r) => r.case),
  };
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'log.txt'), log.join('\n') + '\n');

  console.log(`GATE-SMOKE-BOUTIQUE : ${report.ok}/${report.total} — Parcours 1 (catalogue): ${report.parcours[1].total - report.parcours[1].failed}/${report.parcours[1].total}, Parcours 2 (PDP): ${report.parcours[2].total - report.parcours[2].failed}/${report.parcours[2].total}`);
  if (failed.length > 0) {
    console.error(`ÉCHEC — ${failed.length} cas en échec : ${report.failedCases.join(', ')}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[gate-smoke-boutique] échec fatal :', error);
    process.exitCode = 1;
  });
}

module.exports = { main, runParcours1, runParcours2, BASE_URL, ARTIFACTS_DIR };
