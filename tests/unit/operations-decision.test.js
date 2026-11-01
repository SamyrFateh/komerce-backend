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
    // Aucun bloc secondaire : la chaîne est l'unique surface de supervision.
    expect(SRC.split("data-dashboard-role', 'secondary").length - 1).toBe(0);
    expect(SRC).not.toContain("cardSection(doc, 'File d’exécution'");
    expect(SRC).not.toContain("cardSection(doc, 'Approfondir'");
    expect(SRC).not.toContain("cardSection(doc, 'Colis en retard critique'");
  });
});

test('le Hero Operations porte le kicker OPÉRATIONS (= libellé du menu, UX-06)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain("'OPÉRATIONS'");
  expect(src).not.toContain('KOMERCE · ADMIN CANONICAL');
});

test('le helper des retards critiques affiche le seuil serveur (thresholds.shipped_late_days)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain('payload.thresholds.shipped_late_days');
});

test('le titre du Hero Operations n’est plus doublé (« Tour de contrôle » vit dans Piloter)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain("'kmc-dashboard-title', 'Où en sont les commandes ?')");
  expect(src).not.toContain('Opérations — Tour de contrôle');
});

test('Operations ne duplique plus de files d’attente sous la chaîne (supervision unique)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  ['Cash à confirmer', 'À commander', 'En attente de réception Hub', 'Préparer le colis', 'orders-pending-cash', 'orders-to-order', 'orders-ready-for-parcel'].forEach(label => {
    expect(src).not.toContain(label);
  });
  expect(src).toContain('kmc-control-panel-close');
});

test('les signaux d’Opérations mènent à l’Action Center (« Traiter ») et plus à des ancres mortes', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/operations-decision.js'), 'utf8');
  expect(src).toContain("'/admin/action-center?severity=critical'");
  expect(src).toContain("'/admin/action-center?severity=warning'");
  ['#operations-signals', '#operations-delays', '#operations-kpis'].forEach(anchor => expect(src).not.toContain(anchor));
  // Les lignes de la chaîne ouvrent Order 360 avec le retour vers Opérations.
  expect(src).toContain("contextualHref(`/admin/orders/${encodeURIComponent(order.order_reference)}`, '/admin/operations', 'Retour aux opérations')");
});

test('une chaîne sans commandes ni alertes se replie sans attribuer un état de santé positif', () => {
  expect(SRC).toContain('columns.some(column => column.orders.length > 0)');
  expect(SRC).toContain('columns.some(column => column.alerts.length > 0)');
  expect(SRC).toContain("isEmpty ? 'kmc-control-chain is-empty' : 'kmc-control-chain is-active'");
  expect(SRC).toContain('Aucune commande dans la chaîne pour le périmètre sélectionné.');
});


test('les six phases ne reprennent que les positions serveur et ne fabriquent aucun statut de remise', () => {
  const view = require('../../public/dashboards/canonical/js/operations-decision');
  const one = (reference) => ({ order_reference: reference, health: 'UNKNOWN' });
  const model = {
    control_chain: {
      stages: ['ORDER', 'PURCHASING', 'SUPPLIER', 'HUB_RECEIVING',
        'HUB_CONTROL', 'FORWARDER', 'TRANSPORT', 'CUSTOMS', 'RELAY']
        .map(key => ({ key, label: key })),
      by_stage: {
        ORDER: [one('A'), one('B')], PURCHASING: [one('C')], SUPPLIER: [one('D')],
        HUB_RECEIVING: [one('E')], HUB_CONTROL: [], FORWARDER: [],
        TRANSPORT: [one('F')], CUSTOMS: [one('G')], RELAY: [one('H')],
      },
    },
  };
  const base = {
    OPERATIONS_SCHEMA: {},
    visibleDrillSchema: (_schema, user) => ({ drill: user.role === 'admin' ? [
      { id: 'operations-workspace', href: '/admin/workspaces/operations' },
      { id: 'shipping-customs-workspace', href: '/admin/workspaces/shipping-customs' },
    ] : [
      { id: 'operations-workspace', href: '/admin/workspaces/operations' },
    ] }),
  };
  const admin = view.projectProcessPhases(model, { role: 'admin' }, base);
  expect(admin.map(p => p.label)).toEqual([
    'Commande', 'Achat fournisseur', 'Réception Hub',
    'Transport / Douane', 'Relais', 'Remise client',
  ]);
  expect(admin.map(p => p.helper)).toEqual([
    '2 commandes positionnées', '2 commandes positionnées',
    '1 commande positionnée', '2 commandes positionnées',
    '1 commande positionnée', 'Non projetée ici · voir Order 360',
  ]);
  expect(admin.map(p => p.tone)).toEqual(Array(6).fill('neutral'));
  expect(admin[1].href).toContain('/admin/workspaces/purchasing');
  expect(admin[2].href).toContain('/admin/workspaces/operations');
  expect(admin[3].href).toContain('/admin/workspaces/shipping-customs');
  expect(admin[5].href).toBeUndefined();
  expect(admin[5].observed).toBe(false);

  const marketOperator = view.projectProcessPhases(model, { role: 'market_operator' }, base);
  expect(marketOperator[1].href).toBe('?stage=PURCHASING');
  expect(marketOperator[3].href).toBe('?stage=CUSTOMS');
  expect(marketOperator[2].href).toContain('/admin/workspaces/operations');
});

test('données incomplètes : aucune fausse position zéro ni phase valide sans la chaîne', () => {
  const view = require('../../public/dashboards/canonical/js/operations-decision');
  const base = { OPERATIONS_SCHEMA:{}, visibleDrillSchema:()=>({drill:[]}) };
  expect(view.projectProcessPhases({}, {role:'admin'}, base)).toEqual([]);
  const subset = view.projectProcessPhases({
    control_chain: {
      stages:[{key:'ORDER',label:'Commande'}],
      by_stage:{ORDER:[{order_reference:'R1'}]},
    },
  }, {role:'admin'}, base);
  expect(subset[0].helper).toBe('1 commande positionnée');
  expect(subset[1].helper).toBe('Position indisponible');
  expect(subset[1].href).toBeUndefined();
  expect(subset[5].helper).toContain('Non projetée');
});

test('Opérations : le filtre stage est lu depuis l’URL, conserve marché et période, et ignore une valeur inconnue', () => {
  jest.resetModules();
  globalThis.location = { pathname: '/admin/operations', search: '?market=CM&period=90&stage=CUSTOMS' };
  try {
    const mod = require('../../public/dashboards/canonical/js/operations-decision.js');
    expect(mod.stageFilterKey()).toBe('CUSTOMS');
    expect(mod.stageHref('HUB')).toBe('/admin/operations?market=CM&period=90&stage=HUB');
    expect(mod.stageHref(null)).toBe('/admin/operations?market=CM&period=90');
    globalThis.location.search = '?stage=HANDOFF';
    expect(mod.stageFilterKey()).toBeNull();
    globalThis.location.search = '?stage=nimporte';
    expect(mod.stageFilterKey()).toBeNull();
  } finally {
    delete globalThis.location;
  }
});
