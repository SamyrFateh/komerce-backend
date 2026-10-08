/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const { createDecisionPrimitives } = require('../../public/dashboards/canonical/js/decision-primitives');
const guard = require('../../scripts/css-tokens-guard');


function makeDoc() {
  const doc = {
    createElement(tag) {
      const node = {
        ownerDocument: doc, tagName: String(tag).toUpperCase(), children: [], attributes: {}, className: '', textContent: '',
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren() { this.children = []; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
      };
      return node;
    },
  };
  return doc;
}

const UI = createDecisionPrimitives(makeDoc());
const box = () => makeDoc().createElement('div');
const flat = node => [node, ...node.children.flatMap(flat)];
const texts = node => flat(node).map(n => n.textContent).filter(Boolean);

describe('HealthBadge — 4 états', () => {
  test.each([
    ['GREEN', 'is-green', 'Sain'],
    ['ORANGE', 'is-orange', 'À surveiller'],
    ['RED', 'is-red', 'Bloqué'],
    ['UNKNOWN', 'is-unknown', 'Non observé'],
  ])('%s → %s avec libellé et icône (jamais la couleur seule)', (health, cls, label) => {
    const badge = UI.HealthBadge.render(box(), { health, cause: 'c', owner: 'o', href: '/x' });
    expect(badge.className).toContain(cls);
    expect(texts(badge)).toContain(label);
    expect(flat(badge).some(n => n.className === 'kmc-health-icon' && n.textContent)).toBe(true);
  });

  test.each([undefined, null, '', 'banana', 'green ok', 0])('UNKNOWN n’est jamais GREEN (entrée %p)', value => {
    const badge = UI.HealthBadge.render(box(), { health: value });
    expect(badge.className).toContain('is-unknown');
    expect(badge.className).not.toContain('is-green');
    expect(badge.attributes['data-health']).toBe('UNKNOWN');
    expect(texts(badge)).toContain('Non observé');
  });

  test('ORANGE/RED affichent cause et propriétaire ; un propriétaire absent est signalé', () => {
    const withOwner = UI.HealthBadge.render(box(), { health: 'RED', cause: 'Paiement bloqué', owner: 'Finance', href: '/admin/finance' });
    expect(texts(withOwner)).toEqual(expect.arrayContaining(['Paiement bloqué', 'Finance']));
    const anchor = flat(withOwner).find(n => n.tagName === 'A');
    expect(anchor.attributes.href).toBe('/admin/finance');
    const without = UI.HealthBadge.render(box(), { health: 'ORANGE', cause: 'x' });
    expect(texts(without)).toContain('Propriétaire non défini');
  });

  test('GREEN n’affiche ni cause ni propriétaire', () => {
    const badge = UI.HealthBadge.render(box(), { health: 'GREEN', cause: 'x', owner: 'y' });
    expect(texts(badge)).not.toContain('x');
    expect(texts(badge)).not.toContain('y');
  });
});

describe('CauseList', () => {
  test('affiche jusqu’à 3 causes puis le reste est compté', () => {
    const list = UI.CauseList.render(box(), { exceptions: [1, 2, 3, 4, 5].map(i => ({ health: 'RED', cause: `c${i}` })) });
    expect(flat(list).filter(n => n.className.startsWith('kmc-cause ')).length).toBe(3);
    expect(texts(list)).toContain('+ 2 autre(s)');
    expect(list.attributes['data-cause-count']).toBe('5');
  });
});

describe('FreshnessStamp', () => {
  const now = '2026-10-08T12:00:00Z';
  test('jamais observé → libellé explicite, pas de vide', () => {
    const node = UI.FreshnessStamp.render(box(), { observedAt: null });
    expect(node.textContent).toBe('Jamais observé');
    expect(node.attributes['data-fresh']).toBe('unknown');
  });
  test('le seuil est reçu, jamais redéfini : sans seuil ni booléen, aucun jugement', () => {
    const node = UI.FreshnessStamp.render(box(), { observedAt: '2026-10-08T08:00:00Z', now });
    expect(node.attributes['data-fresh']).toBe('unjudged');
  });
  test('seuil fourni → périmé', () => {
    const node = UI.FreshnessStamp.render(box(), { observedAt: '2026-10-08T11:00:00Z', now, staleAfterMinutes: 30 });
    expect(node.attributes['data-fresh']).toBe('stale');
    expect(node.textContent).toContain('périmé');
  });
  test('booléen serveur prioritaire', () => {
    expect(UI.FreshnessStamp.render(box(), { observedAt: '2026-10-08T11:59:00Z', now, stale: true }).attributes['data-fresh']).toBe('stale');
    expect(UI.FreshnessStamp.render(box(), { observedAt: '2026-10-08T11:59:00Z', now, stale: false }).attributes['data-fresh']).toBe('fresh');
  });
});

describe('DenseTable / Skeleton / DisabledControl', () => {
  test('colonnes numériques à droite, libellés mobiles, cellule vide = tiret', () => {
    const table = UI.DenseTable.render(box(), { columns: [{ key: 'a', label: 'A' }, { key: 'n', label: 'N', numeric: true }], rows: [{ a: 'x', n: 5 }, { a: '', n: null }] });
    const cells = flat(table).filter(n => n.tagName === 'TD');
    expect(cells[1].className).toBe('is-numeric');
    expect(cells[1].attributes['data-label']).toBe('N');
    expect(cells[2].textContent).toBe('—');
  });
  test('squelette : forme connue, jamais vide', () => {
    expect(UI.Skeleton.render(box(), { shape: 'table' }).attributes['data-skeleton']).toBe('table');
    expect(UI.Skeleton.render(box(), { shape: 'zzz' }).attributes['data-skeleton']).toBe('line');
  });
  test('actionable=false ne rend AUCUN bouton, seulement la raison', () => {
    const container = box();
    UI.DisabledControl.render(container, { actionable: false, reason: 'Réservé à Finance' });
    expect(flat(container).some(n => n.tagName === 'BUTTON')).toBe(false);
    expect(texts(container)).toContain('Réservé à Finance');
    const live = box();
    UI.DisabledControl.render(live, { label: 'Valider' });
    expect(flat(live).some(n => n.tagName === 'BUTTON')).toBe(true);
  });
});

describe('css-tokens-guard', () => {
  test('aucun nouveau !important, tokens de santé uniquement dans tokens.css', () => {
    expect(guard.check().errors).toEqual([]);
  });
  test('détecte une hausse de !important', () => {
    const { important } = guard.measure();
    const first = Object.keys(important)[0];
    const lowered = { important: { ...important, [first]: important[first] - 1 } };
    expect(guard.check(lowered).errors.length).toBe(1);
  });
});
