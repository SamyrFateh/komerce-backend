'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { refusalMessage, isActionable } = require('../../public/dashboards/canonical/js/unsold-workspace');

describe('unsold-workspace (F3)', () => {
  test('409 scan affiche le refus F3 explicite', () => {
    const m = refusalMessage(409, { code: 'UNSOLD_NO_SHOW_NOT_CERTIFIED' });
    expect(m).toMatch(/409/);
    expect(m).toMatch(/colis payé/);
  });
  test('404 mentionne la commande payée', () => {
    expect(refusalMessage(404, {})).toMatch(/commande payée/);
  });
  test('aucune action sur commande payée ni invendu résolu', () => {
    expect(isActionable({ status: 'available' })).toBe(true);
    expect(isActionable({ status: 'available', payment_status: 'paid' })).toBe(false);
    expect(isActionable({ status: 'destroyed' })).toBe(false);
    expect(isActionable(null)).toBe(false);
  });
});

test('le rendu des invendus marché est strictement lecture seule',()=>{
  const source=require('fs').readFileSync(require('path').resolve(__dirname,'../../public/dashboards/canonical/js/unsold-workspace.js'),'utf8');
  expect(source).toContain('if (readOnly)');
  expect(source).toContain("const prefix='/api/unsold'");
  expect(source).toContain('scan.hidden=market');
  expect(source).toContain('root.querySelector');
});
test('le tableau Invendus marché garde le shell cohérent et une largeur adaptée',()=>{
  const fs=require('fs');
  const path=require('path');
  const source=fs.readFileSync(path.resolve(__dirname,'../../public/dashboards/canonical/js/unsold-workspace.js'),'utf8');
  const html=fs.readFileSync(path.resolve(__dirname,'../../public/dashboards/canonical/unsold.html'),'utf8');
  expect(source).toContain("root.classList.remove('canonical-boot')");
  expect(source).toContain("root.classList.add('unsold-workspace')");
  expect(source).toContain("readOnly ? 'Valeur indicative' : 'Valeur liquidation'");
  expect(html).toContain('navigation-policy-v4.js?v=261126-canon-market-nav-5');
  expect(html).toContain('width: min(calc(100% - 48px), 1180px)');
});
