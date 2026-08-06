'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * P3b — propriété des contrats bus de la modale (réconciliation 2026-07-27, §4.3).
 *
 * Couvre le défaut réel trouvé dans busStatus() : lisait `os.owner`
 * (ownershipStatus[name], qui n'a que {level, msg}) au lieu de
 * `m.ownership[name].owner` — le rapport affichait donc systématiquement
 * "propriétaire: undefined" pour tout événement 🟢 sain.
 *
 * Deux niveaux de test :
 *   1. rendu — busStatus() ne doit plus jamais produire "propriétaire: undefined" ;
 *   2. négatif — chaque cas de ownershipStatus (owner absent, producteur non
 *      autorisé, payload divergent, consommateur non déclaré) doit produire
 *      le message attendu, sans passer par la branche verte.
 *
 * Une passe d'intégration fait tourner le générateur réel sur le dépôt et
 * vérifie que les anomalies hors scope documentées dans la note de
 * réconciliation (sidebar:built, modal:product-changed) restent visibles —
 * pas masquées par une baseline.
 */

const { busStatus, build } = require('../../scripts/gen-boutique-360');

describe('P3b — busStatus() rendu du propriétaire (régression "propriétaire: undefined")', () => {
  test('événement sain : affiche le vrai propriétaire depuis m.ownership, pas depuis ownershipStatus', () => {
    const m = {
      ownershipStatus: { 'modal:opened': { level: 'green', msg: 'propriété saine' } },
      ownership: { 'modal:opened': { owner: 'modal-product' } },
      diagnostics: { orphanEmit: [], orphanListen: [], undeclared: [] },
    };
    const rendered = busStatus('modal:opened', m);
    expect(rendered).toBe('🟢 sain (propriétaire: modal-product)');
    expect(rendered).not.toMatch(/undefined/);
  });

  test('jamais "propriétaire: undefined", même si m.ownership est incomplet pour ce nom', () => {
    const m = {
      ownershipStatus: { 'x:evt': { level: 'green', msg: 'propriété saine' } },
      ownership: {}, // entrée manquante — cas dégénéré
      diagnostics: { orphanEmit: [], orphanListen: [], undeclared: [] },
    };
    const rendered = busStatus('x:evt', m);
    expect(rendered).not.toContain('propriétaire: undefined');
  });
});

describe('P3b — ownershipStatus : cas négatifs (rendu busStatus par niveau)', () => {
  const baseDiag = { orphanEmit: [], orphanListen: [], undeclared: [] };

  test('propriétaire canonique absent → rouge, message explicite', () => {
    const m = {
      ownershipStatus: { 'evt:a': { level: 'red', msg: 'propriétaire canonique absent' } },
      ownership: { 'evt:a': { owner: null } },
      diagnostics: baseDiag,
    };
    expect(busStatus('evt:a', m)).toBe('🔴 propriétaire canonique absent');
  });

  test('second producteur (producteur non autorisé) → rouge, liste le producteur en trop', () => {
    const m = {
      ownershipStatus: { 'evt:b': { level: 'red', msg: 'producteur non autorisé : b-intrus' } },
      ownership: { 'evt:b': { owner: 'modal-product', producerUnauthorized: ['b-intrus'] } },
      diagnostics: baseDiag,
    };
    expect(busStatus('evt:b', m)).toBe('🔴 producteur non autorisé : b-intrus');
  });

  test('payload divergent → rouge, message d\'arité', () => {
    const m = {
      ownershipStatus: { 'evt:c': { level: 'red', msg: 'payload divergent (arité attendue: value) chez b-x' } },
      ownership: { 'evt:c': { owner: 'modal-product' } },
      diagnostics: baseDiag,
    };
    expect(busStatus('evt:c', m)).toBe('🔴 payload divergent (arité attendue: value) chez b-x');
  });

  test('consommateur non déclaré → orange, pas rouge', () => {
    const m = {
      ownershipStatus: { 'evt:d': { level: 'orange', msg: 'consommateur non déclaré : b-y' } },
      ownership: { 'evt:d': { owner: 'modal-product' } },
      diagnostics: baseDiag,
    };
    expect(busStatus('evt:d', m)).toBe('🟠 consommateur non déclaré : b-y');
  });
});

describe('P3b — intégration sur le dépôt réel : rendu et anomalies hors scope', () => {
  let model;
  let md;

  beforeAll(() => {
    model = build();
    md = require('../../scripts/gen-boutique-360').renderMd(model);
  });

  test('aucune ligne "propriétaire: undefined" dans le rapport généré', () => {
    expect(md).not.toContain('propriétaire: undefined');
  });

  test('les événements 🟢 sains affichent tous un propriétaire non-undefined', () => {
    for (const [name, status] of Object.entries(model.ownershipStatus)) {
      if (status.level !== 'green') continue;
      const owner = model.ownership[name] && model.ownership[name].owner;
      expect(owner).toBeTruthy();
    }
  });

  test('anomalies hors scope documentées restent visibles (non masquées par baseline) : sidebar:built, modal:product-changed', () => {
    expect(md).toMatch(/sidebar:built/);
    expect(md).toMatch(/modal:product-changed/);
  });
});
