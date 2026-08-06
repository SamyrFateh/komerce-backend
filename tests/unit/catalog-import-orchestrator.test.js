'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Tests unitaires — services/suppliers/catalog-import-orchestrator.js (Lot B1)
 *
 * Ce fichier n'avait AUCUN test avant extraction (zéro filet sur l'ancien
 * routes/sourcing-scanner.js). Ces tests verrouillent le comportement
 * iso-comportement de POST /catalogs/import déplacé ici :
 *
 *   - validation supplier_name / source_type
 *   - dispatch connecteur (erreur connecteur, aucun produit)
 *   - DSC-E1 : upsert idempotent (création vs mise à jour)
 *   - DSC-E2 : verrou des champs marqués 'manual', journalisation de l'événement
 *   - DSC-E3 : archivage full-snapshot des candidats disparus
 *   - erreurs par-produit n'interrompent pas le batch (results.errors)
 */

jest.mock('../../db');
jest.mock('../../services/supplier-catalog-scanner');
jest.mock('../../services/pricing-engine');
jest.mock('../../services/catalog-eligibility');

const db = require('../../db');
const scanner = require('../../services/supplier-catalog-scanner');
const pricingEngine = require('../../services/pricing-engine');
const eligibility = require('../../services/catalog-eligibility');

const { importCatalog } = require('../../services/suppliers/catalog-import-orchestrator');

const CONFIG = { finance: { aed_to_kmf: 110 } };

function makeNormalized(overrides = {}) {
  return {
    komerce_category: 'hygiene',
    estimated_weight_kg: 0.3,
    estimated_volume_m3: 0.001,
    purchase_price_kmf: 3500,
    target_margin_pct: 35,
    data_sources: {},
    ...overrides,
  };
}

function makeScan(overrides = {}) {
  return {
    scan_result: { score: 0.8 },
    sourcing_decision: 'accept',
    reason: 'ok',
    recommended_action: 'import',
    confidence: 0.9,
    ...overrides,
  };
}

describe('importCatalog', () => {
  beforeEach(() => {
    pricingEngine.loadGlobalConfig.mockResolvedValue(CONFIG);
    require('../../utils/rules').invalidateCache();
  });

  // ── Validation ──────────────────────────────────────────────────────────

  test('rejette un supplier_name vide', async () => {
    const result = await importCatalog({ supplier_name: '  ', source_type: 'manual' }, 1, jest.fn());
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/supplier_name requis/);
  });

  test('rejette un source_type inconnu', async () => {
    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'ftp' }, 1, jest.fn());
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/source_type doit être/);
  });

  test('relaie l\'erreur du connecteur en 400', async () => {
    const dispatch = jest.fn().mockRejectedValue(new Error('CSV invalide'));
    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'csv' }, 1, dispatch);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('CSV invalide');
  });

  test('rejette si le connecteur ne retourne aucun produit', async () => {
    const dispatch = jest.fn().mockResolvedValue({ products: [], invalid: [{ row: 1, error: 'champ manquant' }] });
    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'csv' }, 1, dispatch);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Aucun produit valide/);
    expect(result.body.invalid).toEqual([{ row: 1, error: 'champ manquant' }]);
  });

  // ── ING-2 : seuil fichier malade (ING-I4) ────────────────────────────────

  test('fichier malade (>30% invalides, défaut) → import refusé en bloc, aucune écriture DB', async () => {
    const dispatch = jest.fn().mockResolvedValue({
      products: [{ product_name: 'Bon' }],
      invalid: [
        { errors: ['devise absente — colonne currency requise'] },
        { errors: ['devise absente — colonne currency requise'] },
        { errors: ['purchase_price non numérique : "abc"'] },
      ],
      unmapped_columns: ['couleur'],
    });
    db.query.mockImplementation(() => Promise.resolve({ rows: [] }));

    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'csv' }, 1, dispatch);

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/fichier malade/);
    expect(result.body.total).toBe(4);
    expect(result.body.accepted).toBe(1);
    expect(result.body.rejected).toBe(3);
    expect(result.body.reject_reasons).toEqual({
      'devise absente — colonne currency requise': 2,
      'purchase_price non numérique : "abc"': 1,
    });
    expect(result.body.unmapped_columns).toEqual(['couleur']);
    // Fichier malade → refus AVANT toute écriture (pas d'INSERT import)
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO supplier_catalog_imports'), expect.anything());
  });

  test('sous le seuil (< 30% invalides) → import continue normalement', async () => {
    const product = { supplier_product_id: 'sku-1', product_name: 'Savon' };
    const dispatch = jest.fn().mockResolvedValue({
      products: [product],
      invalid: [],
      unmapped_columns: [],
    });
    db.query.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) return Promise.resolve({ rows: [{ id: 'import-1' }] });
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        return Promise.resolve({ rows: [{ id: 'cand-1', data_sources: {}, was_updated: false }] });
      }
      return Promise.resolve({ rows: [] });
    });
    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'manual' }, 1, dispatch);
    expect(result.status).toBe(200);
  });

  test('réponse finale enrichie : accepted/rejected/reject_reasons/unmapped_columns (ligne de synthèse fondateur)', async () => {
    const product = { supplier_product_id: 'sku-1', product_name: 'Savon' };
    const dispatch = jest.fn().mockResolvedValue({
      products: [product],
      invalid: [{ errors: ['devise absente'] }],
      unmapped_columns: ['couleur_preferee'],
    });
    // Seuil forcé haut pour ne pas déclencher le refus en bloc et observer
    // la synthèse finale de la réponse 200.
    db.query.mockImplementation((sql) => {
      if (sql.includes('SELECT key, value FROM business_rules')) {
        return Promise.resolve({ rows: [{ key: 'CATALOG_IMPORT_MAX_INVALID_PCT', value: { value: 90 } }] });
      }
      if (sql.includes('INSERT INTO supplier_catalog_imports')) return Promise.resolve({ rows: [{ id: 'import-9' }] });
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        return Promise.resolve({ rows: [{ id: 'cand-9', data_sources: {}, was_updated: false }] });
      }
      return Promise.resolve({ rows: [] });
    });
    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'csv' }, 1, dispatch);

    expect(result.status).toBe(200);
    expect(result.body.accepted).toBe(1);
    expect(result.body.rejected).toBe(1);
    expect(result.body.reject_reasons).toEqual({ 'devise absente': 1 });
    expect(result.body.unmapped_columns).toEqual(['couleur_preferee']);
  });

  // ── DSC-E1 : upsert idempotent ──────────────────────────────────────────

  test('crée un import puis un candidat (was_updated=false)', async () => {
    const product = { supplier_product_id: 'sku-1', product_name: 'Savon' };
    const dispatch = jest.fn().mockResolvedValue({ products: [product] });

    db.query.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) {
        return Promise.resolve({ rows: [{ id: 'import-1' }] });
      }
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        return Promise.resolve({ rows: [{ id: 'cand-1', data_sources: {}, was_updated: false }] });
      }
      return Promise.resolve({ rows: [] });
    });

    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'manual' }, 'user-1', dispatch);

    expect(result.status).toBe(200);
    expect(result.body.import_id).toBe('import-1');
    expect(result.body.created).toBe(1);
    expect(result.body.updated).toBe(0);
    expect(result.body.errors).toEqual([]);
  });

  test('ré-import idempotent : was_updated=true incrémente updated, pas created', async () => {
    const product = { supplier_product_id: 'sku-1', product_name: 'Savon' };
    const dispatch = jest.fn().mockResolvedValue({ products: [product] });

    db.query.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) {
        return Promise.resolve({ rows: [{ id: 'import-2' }] });
      }
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        return Promise.resolve({ rows: [{ id: 'cand-1', data_sources: {}, was_updated: true }] });
      }
      // INSERT INTO sourcing_candidate_events (journalisation DSC-E2)
      return Promise.resolve({ rows: [] });
    });

    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'manual' }, 'user-1', dispatch);

    expect(result.body.created).toBe(0);
    expect(result.body.updated).toBe(1);
  });

  // ── ING-5 (verrou 4, doctrine ING-I3) : le brut ne se perd jamais ────────

  test('persiste product.raw_payload dans l\'INSERT sourcing_candidates', async () => {
    const product = {
      supplier_product_id: 'sku-1',
      product_name: 'Savon',
      raw_payload: { product_name: 'Savon', hazmat_class: 'none', prix: '5000' },
    };
    const dispatch = jest.fn().mockResolvedValue({ products: [product] });

    let insertParams;
    db.query.mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) {
        return Promise.resolve({ rows: [{ id: 'import-7' }] });
      }
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        insertParams = params;
        return Promise.resolve({ rows: [{ id: 'cand-1', data_sources: {}, was_updated: false }] });
      }
      return Promise.resolve({ rows: [] });
    });

    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    await importCatalog({ supplier_name: 'Acme', source_type: 'manual' }, 'user-1', dispatch);

    expect(insertParams).toContain(JSON.stringify(product.raw_payload));
  });

  test('raw_payload absent du produit → NULL, pas d\'exception', async () => {
    const product = { supplier_product_id: 'sku-2', product_name: 'Sans brut' };
    const dispatch = jest.fn().mockResolvedValue({ products: [product] });

    let insertParams;
    db.query.mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) {
        return Promise.resolve({ rows: [{ id: 'import-8' }] });
      }
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        insertParams = params;
        return Promise.resolve({ rows: [{ id: 'cand-2', data_sources: {}, was_updated: false }] });
      }
      return Promise.resolve({ rows: [] });
    });

    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'manual' }, 'user-1', dispatch);

    expect(result.status).toBe(200);
    expect(insertParams).toContain(null);
  });

  // ── DSC-E2 : verrou champs manuels ──────────────────────────────────────

  test('journalise les champs verrouillés "manual" lors d\'un ré-import', async () => {
    const product = { supplier_product_id: 'sku-1', product_name: 'Savon' };
    const dispatch = jest.fn().mockResolvedValue({ products: [product] });

    const eventInserts = [];
    db.query.mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) {
        return Promise.resolve({ rows: [{ id: 'import-3' }] });
      }
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        return Promise.resolve({
          rows: [{ id: 'cand-1', data_sources: { purchase_price: 'manual' }, was_updated: true }],
        });
      }
      if (sql.includes('INSERT INTO sourcing_candidate_events')) {
        eventInserts.push(params);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    await importCatalog({ supplier_name: 'Acme', source_type: 'manual' }, 'user-1', dispatch);

    expect(eventInserts).toHaveLength(1);
    const [, changesJson, notes] = eventInserts[0];
    expect(JSON.parse(changesJson).locked_manual_fields).toEqual(['purchase_price']);
    expect(notes).toMatch(/purchase_price/);
  });

  // ── Résilience par-produit ───────────────────────────────────────────────

  test('une erreur sur un produit n\'interrompt pas le batch', async () => {
    const products = [
      { supplier_product_id: 'sku-ok', product_name: 'OK' },
      { supplier_product_id: 'sku-bad', product_name: 'BAD' },
    ];
    const dispatch = jest.fn().mockResolvedValue({ products });

    db.query.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) {
        return Promise.resolve({ rows: [{ id: 'import-4' }] });
      }
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        return Promise.resolve({ rows: [{ id: 'cand-ok', data_sources: {}, was_updated: false }] });
      }
      return Promise.resolve({ rows: [] });
    });

    scanner.normalizeCandidate.mockImplementation((product) => {
      if (product.supplier_product_id === 'sku-bad') {
        return Promise.reject(new Error('normalisation impossible'));
      }
      return Promise.resolve(makeNormalized());
    });
    scanner.scanCandidate.mockResolvedValue(makeScan());

    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'manual' }, 'user-1', dispatch);

    expect(result.body.created).toBe(1);
    expect(result.body.errors).toEqual([{ product_name: 'BAD', error: 'normalisation impossible' }]);
  });

  // ── DSC-E3 : archivage full-snapshot ─────────────────────────────────────

  test('is_full_snapshot=true archive les candidats absents du lot', async () => {
    const product = { supplier_product_id: 'sku-present', product_name: 'Présent' };
    const dispatch = jest.fn().mockResolvedValue({ products: [product] });

    db.query.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) {
        return Promise.resolve({ rows: [{ id: 'import-5' }] });
      }
      if (sql.includes('INSERT INTO sourcing_candidates') && sql.includes('ON CONFLICT')) {
        return Promise.resolve({ rows: [{ id: 'cand-present', data_sources: {}, was_updated: false }] });
      }
      if (sql.startsWith('\n      UPDATE sourcing_candidates') || sql.includes('UPDATE sourcing_candidates')) {
        return Promise.resolve({
          rows: [{ id: 'cand-absent', supplier_product_id: 'sku-absent', state: 'scanned' }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    const result = await importCatalog(
      { supplier_name: 'Acme', source_type: 'manual', is_full_snapshot: true },
      'user-1',
      dispatch
    );

    expect(result.body.archived).toBe(1);
  });

  test('is_full_snapshot absent ou false : pas d\'archivage', async () => {
    const product = { supplier_product_id: 'sku-1', product_name: 'Savon' };
    const dispatch = jest.fn().mockResolvedValue({ products: [product] });

    db.query.mockImplementation((sql) => {
      if (sql.includes('INSERT INTO supplier_catalog_imports')) {
        return Promise.resolve({ rows: [{ id: 'import-6' }] });
      }
      if (sql.includes('INSERT INTO sourcing_candidates')) {
        return Promise.resolve({ rows: [{ id: 'cand-1', data_sources: {}, was_updated: false }] });
      }
      return Promise.resolve({ rows: [] });
    });

    scanner.normalizeCandidate.mockResolvedValue(makeNormalized());
    scanner.scanCandidate.mockResolvedValue(makeScan());

    const result = await importCatalog({ supplier_name: 'Acme', source_type: 'manual' }, 'user-1', dispatch);

    expect(result.body.archived).toBe(0);
    // Aucun UPDATE sourcing_candidates ne doit avoir été appelé
    const updateCalls = db.query.mock.calls.filter(([sql]) => sql.includes('UPDATE sourcing_candidates'));
    expect(updateCalls).toHaveLength(0);
  });
});
