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

const WAVE1_TERMS = [
  'gift', 'wedding dress', 'mug', 'photo frame', 'car accessories',
  'motorcycle', 'car light', 'brake', 'oil filter', 'phone accessories',
  'wireless earbuds', 'smartwatch accessories', 'kitchen gadget', 'home storage',
  'home decor', 'beauty tools', 'women accessories', 'men accessories',
  'kids toys', 'hand tools',
];

describe('aliexpress-500-catalog-topup', () => {
  test('la vague 2 change réellement de vocabulaire et reste diversifiée', () => {
    expect(TOPUP_ID).toBe('topup-diversified-v2');
    expect(TOPUP_QUERIES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(TOPUP_QUERIES.map((row) => row.keyword)).size).toBe(TOPUP_QUERIES.length);
    expect(TOPUP_QUERIES.filter((row) => WAVE1_TERMS.includes(row.keyword))).toHaveLength(0);
    expect(new Set(TOPUP_QUERIES.map((row) => row.category)).size).toBeGreaterThanOrEqual(6);
    expect(TOPUP_QUERIES.slice(0, 10).map((row) => row.category))
      .toEqual(expect.arrayContaining(['Créations personnelles', 'Auto']));
  });

  test('alterne les familles de top-up avant de paginer une même requête', () => {
    const queries = [
      { keyword: 'car charger', category: 'Auto', subcategory: 'Accessoires' },
      { keyword: 'phone case', category: 'Tech', subcategory: 'Phones' },
      { keyword: 'storage box', category: 'Maison', subcategory: 'Confort' },
    ];

    expect(logicalTopupPage(1, queries)).toMatchObject({ keyword: 'car charger', queryIndex: 0, queryPage: 1 });
    expect(logicalTopupPage(2, queries)).toMatchObject({ keyword: 'phone case', queryIndex: 1, queryPage: 1 });
    expect(logicalTopupPage(3, queries)).toMatchObject({ keyword: 'storage box', queryIndex: 2, queryPage: 1 });
    expect(logicalTopupPage(4, queries)).toMatchObject({ keyword: 'car charger', queryIndex: 0, queryPage: 2 });
  });

  test('la vague 2 possède un checkpoint et une source distincts des vagues précédentes', () => {
    expect(topupCheckpointCategoryId()).toBe('text:topup-diversified-v2');
    expect(topupSourceFilename('sync-v1', 7))
      .toBe('aliexpress-pool/sync-v1/topup-diversified-v2/page-0007.json');
  });

  test('un checkpoint completed peut reprendre uniquement si la profondeur a été augmentée', () => {
    expect(canResumeCompletedCheckpoint({ completed: true, next_page: 101 }, 200)).toBe(true);
    expect(canResumeCompletedCheckpoint({ completed: true, next_page: 101 }, 100)).toBe(false);
    expect(canResumeCompletedCheckpoint({ completed: false, next_page: 101 }, 200)).toBe(false);
  });

  test('le round-robin passe à queryPage 2 après une vague complète', () => {
    const width = TOPUP_QUERIES.length;
    expect(logicalTopupPage(width)).toMatchObject({ queryIndex: width - 1, queryPage: 1 });
    expect(logicalTopupPage(width + 1)).toMatchObject({ queryIndex: 0, queryPage: 2 });
  });

  test('la provenance du top-up conserve la famille commerciale de la requête', () => {
    expect(discoverySegment({ category: 'Auto', subcategory: 'Accessoires' })).toEqual({
      id: 'topup-diversified-v2',
      category: 'Auto',
      subcategory: 'Accessoires',
    });
  });
});
