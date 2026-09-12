'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/suppliers/connectors/aliexpress-connected-connector', () => ({
  managedRuntimeEnv: jest.fn(),
  invokeTop: jest.fn(),
  fetchProducts: jest.fn(),
}));
jest.mock('../../services/suppliers/connectors/aliexpress-connector', () => ({
  invokeTop: jest.fn(),
  fetchProducts: jest.fn(),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: jest.fn() }));
jest.mock('../../services/suppliers/catalog-sync-checkpoint', () => ({
  getCheckpoint: jest.fn(),
  ensureCheckpoint: jest.fn(),
  markComplete: jest.fn(),
  recordPageSuccess: jest.fn(),
  recordError: jest.fn(),
  summarize: jest.fn(),
}));

const {
  TOPUP_ID,
  TOPUP_QUERIES,
  logicalTopupPage,
  topupCheckpointCategoryId,
  topupSourceFilename,
  canResumeCompletedCheckpoint,
  discoverySegment,
} = require('../../scripts/aliexpress-500-catalog-topup');

describe('aliexpress-500-catalog-topup', () => {
  test('le plan de top-up reste diversifié et commence par les shortfalls live', () => {
    expect(TOPUP_ID).toBe('topup-diversified-v1');
    expect(TOPUP_QUERIES.length).toBeGreaterThanOrEqual(18);
    expect(new Set(TOPUP_QUERIES.map((row) => row.keyword)).size).toBe(TOPUP_QUERIES.length);
    expect(TOPUP_QUERIES.slice(0, 9).map((row) => row.category))
      .toEqual(expect.arrayContaining(['Créations personnelles', 'Auto']));
    expect(new Set(TOPUP_QUERIES.map((row) => row.category)).size).toBeGreaterThanOrEqual(6);
  });

  test('alterne les familles de top-up avant de paginer une même requête', () => {
    const queries = [
      { keyword: 'gift', category: 'Créations', subcategory: 'Cadeau' },
      { keyword: 'car accessories', category: 'Auto', subcategory: 'Accessoires' },
      { keyword: 'phone accessories', category: 'Tech', subcategory: 'Phones' },
    ];

    expect(logicalTopupPage(1, queries)).toMatchObject({ keyword: 'gift', queryIndex: 0, queryPage: 1 });
    expect(logicalTopupPage(2, queries)).toMatchObject({ keyword: 'car accessories', queryIndex: 1, queryPage: 1 });
    expect(logicalTopupPage(3, queries)).toMatchObject({ keyword: 'phone accessories', queryIndex: 2, queryPage: 1 });
    expect(logicalTopupPage(4, queries)).toMatchObject({ keyword: 'gift', queryIndex: 0, queryPage: 2 });
  });

  test('la reprise possède un checkpoint et une source déterministes distincts du plan primaire', () => {
    expect(topupCheckpointCategoryId()).toBe('text:topup-diversified-v1');
    expect(topupSourceFilename('sync-v1', 7))
      .toBe('aliexpress-pool/sync-v1/topup-diversified-v1/page-0007.json');
  });

  test('un checkpoint completed peut reprendre uniquement si la profondeur a été augmentée', () => {
    expect(canResumeCompletedCheckpoint({ completed: true, next_page: 101 }, 200)).toBe(true);
    expect(canResumeCompletedCheckpoint({ completed: true, next_page: 101 }, 100)).toBe(false);
    expect(canResumeCompletedCheckpoint({ completed: false, next_page: 101 }, 200)).toBe(false);
  });

  test('la page logique 101 reprend exactement sur la page fournisseur 6 avec 20 requêtes', () => {
    expect(TOPUP_QUERIES).toHaveLength(20);
    expect(logicalTopupPage(101)).toMatchObject({ queryIndex: 0, queryPage: 6 });
    expect(logicalTopupPage(120)).toMatchObject({ queryIndex: 19, queryPage: 6 });
    expect(logicalTopupPage(121)).toMatchObject({ queryIndex: 0, queryPage: 7 });
  });

  test('la provenance du top-up conserve la famille commerciale de la requête', () => {
    expect(discoverySegment({ category: 'Auto', subcategory: 'Moto' })).toEqual({
      id: 'topup-diversified-v1',
      category: 'Auto',
      subcategory: 'Moto',
    });
  });
});
