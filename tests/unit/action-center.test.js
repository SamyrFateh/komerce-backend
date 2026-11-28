'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const actionCenter = require('../../public/dashboards/canonical/js/action-center');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Canonical Action Center — presentation contract', () => {
  test('le choix marché de la vue groupe ouvre uniquement un endpoint marché autorisé',async()=>{
    const context={access:{mode:'global',allowedMarkets:['CM','CG']}};
    const scope=await actionCenter.resolveRuntimeScope({adminContext:context,location:{href:'https://komerce.co/admin/action-center?market=CM&severity=critical'}});
    expect(scope).toMatchObject({mode:'market',marketCode:'CM',loadEndpoint:'/api/admin/action-center/market/CM?severity=critical'});
    expect(actionCenter.selectedMarketCode(context,{href:'https://komerce.co/admin/action-center?market=DJ'})).toBeNull();
    expect(actionCenter.selectedMarketCode(context,{href:'https://komerce.co/admin/action-center'})).toBeNull();
  });
  test('pagination et famille sont portées par le serveur et restaurées depuis le retour',()=>{
    const loc={href:'https://komerce.co/admin/action-center?market=CM&family=ops&offset=100'};
    expect(actionCenter.readListContext(loc)).toEqual({domain:'ops',offset:100});
    expect(actionCenter.listEndpoint('/api/admin/action-center/market/CM?severity=critical','ops',100,'market')).toBe('/api/admin/action-center/market/CM?severity=critical&family=ops&offset=100');
    expect(actionCenter.listEndpoint('/api/agent/action-center','ops',100,'agent')).toBe('/api/agent/action-center?offset=100');
  });
  test('un refresh remplace le handler précédent : une seule mutation au clic',()=>{
    const root={addEventListener:jest.fn(),removeEventListener:jest.fn()};
    actionCenter.bind(root,{});
    const old=root.__actionCenterClickHandler;
    actionCenter.bind(root,{});
    expect(root.removeEventListener).toHaveBeenCalledWith('click',old);
    expect(root.__actionCenterClickHandler).not.toBe(old);
    expect(root.addEventListener).toHaveBeenLastCalledWith('click',root.__actionCenterClickHandler);
  });
  test('conserve la classification métier reçue du serveur sans recalcul', () => {
    expect(actionCenter.severityLabel('urgent')).toBe('Urgent');
    expect(actionCenter.severityLabel('critical')).toBe('Critique');
    expect(actionCenter.severityLabel('warning')).toBe('Attention');
    expect(actionCenter.severityLabel('info')).toBe('Info');
  });

  test('les métriques restent une projection directe du summary serveur', () => {
    expect(actionCenter.metricItems({ urgent: 2, warning: 1, info: 3, total_active: 6 }))
      .toEqual([
        { key: 'urgent', label: 'Critiques', value: 2, tone: 'critical' },
        { key: 'warning', label: 'Avertissements', value: 1, tone: 'warning' },
        { key: 'total', label: 'Total à traiter', value: 6, tone: 'neutral' },
      ]);
  });

  test('la carte signal expose des hooks visuels fondés uniquement sur row.severity', () => {
    const source = read('public/dashboards/canonical/js/action-center.js');
    expect(source).toContain('kmc-action-signal');
    expect(source).toContain('card.dataset.severity = severity');
    expect(source).toMatch(/\['urgent', 'critical', 'warning', 'info'\]\.includes/);
    expect(source).not.toMatch(/severity\s*[<>]=?\s*\d/);
  });
});

test('les liens Traiter / Voir vers fiches 360 et PO passent par le retour contextuel de l’Action Center', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/action-center.js'), 'utf8');
  expect(src).toContain('work.href = withReturn(row.work_item.href,row.signal_ref);');
  expect(src).toContain('link.href = withReturn(row.entity.href,row.signal_ref);');
  expect(src).toContain("'Retour à À traiter'");
});

test('retour : ouvre le groupe de la référence et restaure le dossier sans exécuter de mutation',()=>{
  const group={open:false};
  const card={closest:jest.fn(()=>group),scrollIntoView:jest.fn()};
  const root={querySelector:jest.fn(()=>card)};
  expect(actionCenter.restoreSignal(root,{hash:'#signal-KSG-000123'})).toBe(true);
  expect(root.querySelector).toHaveBeenCalledWith('#signal-KSG-000123');
  expect(group.open).toBe(true);
  expect(card.scrollIntoView).toHaveBeenCalled();
  root.querySelector.mockClear();
  expect(actionCenter.restoreSignal(root,{hash:'#invalid'})).toBe(false);
  expect(root.querySelector).not.toHaveBeenCalled();
});

test('D3 — « Résolu » exige une note de preuve et les types auto-fermés l’annoncent', () => {
  const source = read('public/dashboards/canonical/js/action-center.js');
  expect(source).toContain('Preuve de résolution (obligatoire)');
  expect(source).toContain('{ note }');
  expect(source).toContain('Se ferme automatiquement quand la cause disparaît.');
});

test('action-center — le refresh distant conserve les filtres et protège les droits', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../public/dashboards/canonical/js/action-center.js'), 'utf8');
  expect(src).toContain('KomerceDashboardFreshness?.watch?.({');
  expect(src).toContain('isBusy: workspaceBusy');
  expect(src).toContain('background:true');
  expect(src).toContain('data-dashboard-stale');
  expect(src).toContain('error.status === 401 || error.status === 403');
  expect(src).toContain('Accès expiré ou non autorisé. Rechargez votre session.');
});
