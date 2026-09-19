'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * tests/unit/catalog-workspace-live-composer.test.js
 *
 * Feature propriétaire : catalog
 *
 * Contexte : services/catalog-workspace-live-composer.js (criticality
 * high) n'avait aucun test — pas même le test unit qui le mockait
 * entièrement dans admin-catalog-workspace-route.test.js (le composeur
 * lui-même n'était donc jamais réellement exécuté). C'est la couche de
 * composition qui fusionne la projection catalogue admin
 * (catalog-workspace.js) et la projection sourcing en flux live
 * (catalog-live-flow.js) — doctrine
 * catalog_composes_live_sourcing_projection_without_stealing_sourcing_
 * mutation_authority : ce module ne doit QUE lire et fusionner, jamais
 * muter, jamais appeler les fonctions d'écriture de sourcing.
 *
 * Invariants prouvés (les deux dépendances sont mockées — c'est
 * précisément la logique de COMPOSITION propre à ce fichier qui est
 * sous test, pas la logique interne de catalog-workspace.js ou
 * catalog-live-flow.js, déjà couvertes ailleurs) :
 *   1. buildWorkspace() appelle les deux projections EN PARALLÈLE
 *      (Promise.all), pas séquentiellement — les deux sont invoquées
 *      avant que l'une n'ait besoin d'attendre l'autre.
 *   2. Le résultat fusionne les champs du catalogue admin, ajoute `live`
 *      (la projection sourcing complète) et promeut `live.business` au
 *      niveau racine sous `business` — sans écraser un champ du
 *      catalogue de même nom si aucun ne collisionne.
 *   3. query.live_limit est transmis tel quel à buildProjection sous
 *      incomingLimit — pas de valeur par défaut inventée ici (déléguée
 *      à catalog-live-flow.js).
 *   4. Toutes les autres fonctions de catalog-workspace.js (createProduct,
 *      updateProduct, approveCandidate, etc.) sont re-exportées TELLES
 *      QUELLES — la composition ne les enveloppe ni ne les altère.
 *   5. Si l'une des deux projections échoue, l'erreur remonte (pas de
 *      silence sur une moitié de la fusion).
 */

jest.mock('../../services/catalog-workspace', () => ({
  buildWorkspace: jest.fn(),
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  approveCandidate: jest.fn(),
  CatalogWorkspaceError: class CatalogWorkspaceError extends Error {},
}));
jest.mock('../../services/catalog-live-flow', () => ({
  buildProjection: jest.fn(),
}));

const catalogWorkspace = require('../../services/catalog-workspace');
const liveFlow = require('../../services/catalog-live-flow');
const composer = require('../../services/catalog-workspace-live-composer');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildWorkspace — composition catalogue admin + flux live sourcing', () => {
  it('appelle les deux projections en parallèle (Promise.all), pas séquentiellement', async () => {
    const order = [];
    catalogWorkspace.buildWorkspace.mockImplementation(async () => {
      order.push('catalog-start');
      await new Promise(r => setTimeout(r, 10));
      order.push('catalog-end');
      return { products: [] };
    });
    liveFlow.buildProjection.mockImplementation(async () => {
      order.push('live-start');
      return { business: {} };
    });

    await composer.buildWorkspace({});

    // Les deux démarrent avant que le premier ne finisse — preuve de
    // parallélisme, pas d'attente séquentielle.
    expect(order[0]).toBe('catalog-start');
    expect(order[1]).toBe('live-start');
    expect(order[2]).toBe('catalog-end');
  });

  it('fusionne catalogue + live, et promeut live.business au niveau racine sous `business`', async () => {
    catalogWorkspace.buildWorkspace.mockResolvedValue({ products: ['p1', 'p2'], total: 2 });
    liveFlow.buildProjection.mockResolvedValue({ incoming: ['sku-1'], business: { pipeline_health: 'ok' } });

    const result = await composer.buildWorkspace({});

    expect(result).toEqual({
      products: ['p1', 'p2'],
      total: 2,
      live: { incoming: ['sku-1'], business: { pipeline_health: 'ok' } },
      business: { pipeline_health: 'ok' },
    });
  });

  it('transmet query.live_limit tel quel à buildProjection sous incomingLimit, sans valeur par défaut inventée', async () => {
    catalogWorkspace.buildWorkspace.mockResolvedValue({});
    liveFlow.buildProjection.mockResolvedValue({ business: {} });

    await composer.buildWorkspace({ live_limit: 42 });
    expect(liveFlow.buildProjection).toHaveBeenCalledWith({ incomingLimit: 42 });

    await composer.buildWorkspace({});
    expect(liveFlow.buildProjection).toHaveBeenCalledWith({ incomingLimit: undefined });
  });

  it('transmet le query complet à catalogWorkspace.buildWorkspace sans le filtrer', async () => {
    catalogWorkspace.buildWorkspace.mockResolvedValue({});
    liveFlow.buildProjection.mockResolvedValue({ business: {} });

    const query = { status: 'active', page: 2, live_limit: 10 };
    await composer.buildWorkspace(query);
    expect(catalogWorkspace.buildWorkspace).toHaveBeenCalledWith(query);
  });

  it('propage une erreur si la projection catalogue échoue — pas de silence, pas de résultat partiel', async () => {
    catalogWorkspace.buildWorkspace.mockRejectedValue(new Error('catalog query failed'));
    liveFlow.buildProjection.mockResolvedValue({ business: {} });

    await expect(composer.buildWorkspace({})).rejects.toThrow('catalog query failed');
  });

  it('propage une erreur si la projection live sourcing échoue', async () => {
    catalogWorkspace.buildWorkspace.mockResolvedValue({ products: [] });
    liveFlow.buildProjection.mockRejectedValue(new Error('live flow query failed'));

    await expect(composer.buildWorkspace({})).rejects.toThrow('live flow query failed');
  });
});

describe('re-export — la composition ne modifie pas la surface de catalog-workspace.js', () => {
  it('re-exporte createProduct, updateProduct, approveCandidate et CatalogWorkspaceError tels quels', () => {
    expect(composer.createProduct).toBe(catalogWorkspace.createProduct);
    expect(composer.updateProduct).toBe(catalogWorkspace.updateProduct);
    expect(composer.approveCandidate).toBe(catalogWorkspace.approveCandidate);
    expect(composer.CatalogWorkspaceError).toBe(catalogWorkspace.CatalogWorkspaceError);
  });

  it('son propre buildWorkspace REMPLACE celui de catalog-workspace.js (pas un simple pass-through)', () => {
    expect(composer.buildWorkspace).not.toBe(catalogWorkspace.buildWorkspace);
  });
});
