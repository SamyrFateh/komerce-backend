'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs');
const path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','..','public','dashboards','canonical','js','operations-decision.js'),'utf8');

describe('operations-decision visual hierarchy contract',()=>{
  test('keeps Operations to Hero → health recap → primary chain only',()=>{
    expect(SRC).toContain("data-dashboard-hierarchy', 'hero-attention-primary-secondary");
    const renderStart=SRC.indexOf('function render(rootNode');
    const renderSource=SRC.slice(renderStart);
    const hero=renderSource.indexOf('dashboard.appendChild(header)');
    const attention=renderSource.indexOf('dashboard.appendChild(renderControlHealthSummary');
    const primary=renderSource.indexOf('dashboard.appendChild(chain.section)');
    expect(renderStart).toBeGreaterThanOrEqual(0);
    expect(hero).toBeGreaterThanOrEqual(0);
    expect(attention).toBeGreaterThan(hero);
    expect(primary).toBeGreaterThan(attention);
    // Seul bloc secondaire admis : les files d'action commandes, rendues APRÈS la chaîne.
    expect(SRC.split("data-dashboard-role', 'secondary").length - 1).toBe(1);
    expect(renderSource.indexOf("data-dashboard-role', 'secondary")).toBeGreaterThan(primary);
    expect(SRC).not.toContain("cardSection(doc, 'File d’exécution'");
    expect(SRC).not.toContain("cardSection(doc, 'Approfondir'");
    expect(SRC).not.toContain("cardSection(doc, 'Colis en retard critique'");
  });
});

test('le Hero Operations porte le kicker LOGISTIQUE (canon visuel)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain("'LOGISTIQUE'");
  expect(src).not.toContain('KOMERCE · ADMIN CANONICAL');
});

test('le helper des retards critiques affiche le seuil serveur (thresholds.shipped_late_days)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain('payload.thresholds.shipped_late_days');
});

test('le titre du Hero Operations n’est plus doublé (« Tour de contrôle » vit dans Piloter)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain("'kmc-dashboard-title', 'Opérations')");
  expect(src).not.toContain('Opérations — Tour de contrôle');
});

test('Operations affiche les files Cash à confirmer et Colis à créer (ex-écran Commandes), avec retour vers Opérations', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain("'Cash à confirmer'");
  expect(src).toContain("'Colis à créer'");
  expect(src).toContain("'orders-pending-cash'");
  expect(src).toContain("'orders-ready-for-parcel'");
  expect(src).toContain("'/admin/operations', 'Retour aux opérations'");

  const mod = require('../../public/dashboards/canonical/js/operations-decision.js');
  const base = { formatNumber: (v) => String(v) };
  const items = mod.workQueueItems([{ reference: 'CMD-1', status: 'pending', payment_mode: 'cash', total_kmf: 1500 }, { id: 'x' }], base);
  expect(items[0]).toMatchObject({ title: 'CMD-1', helper: 'pending · cash · 1500 KMF', actionLabel: 'Ouvrir →' });
  expect(items[0].href).toContain('/admin/orders/CMD-1');
  expect(items[1].href).toBeUndefined();
  expect(mod.workQueueItems(undefined, base)).toEqual([]);
});

