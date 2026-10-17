'use strict';

/**
 * tests/unit/canonical-margin-writer.test.js
 * A8 — écrivain canonique unique, désactivé par défaut.
 */

const mockQuery = jest.fn();
const mockShadow = jest.fn();
let mockRules = {};
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
jest.mock('../../utils/rules', () => ({ getRuleNumber: async (k, d) => (k in mockRules ? mockRules[k] : d) }));
jest.mock('../../services/cost-allocation/real-margin-shadow', () => ({ computeOrderRealMarginShadow: (...a) => mockShadow(...a) }));

const w = require('../../services/cost-allocation/canonical-margin-writer');

const shadow = (completeness, pct, legacy = {}) => ({
  completeness,
  margin: { shadow_pct: pct },
  legacy: { sourcing_blocked: false, margin_real_pct: null, ...legacy },
  delta_pct_points: null,
});

beforeEach(() => { mockQuery.mockReset(); mockShadow.mockReset(); mockRules = {}; });

describe('planCanonicalMargin (pure)', () => {
  it('final → marge shadow ; alerte < 10 %', () => {
    expect(w.planCanonicalMargin(shadow('final', 25.5))).toMatchObject({ margin_real_pct: 25.5, margin_alert: false, sourcing_blocked: false });
    expect(w.planCanonicalMargin(shadow('final', 4))).toMatchObject({ margin_real_pct: 4, margin_alert: true });
  });
  it('incomplete / not_applicable → NULL, jamais 0, pas d\'alerte', () => {
    for (const c of ['incomplete', 'not_applicable']) {
      expect(w.planCanonicalMargin(shadow(c, null))).toMatchObject({ margin_real_pct: null, margin_alert: false });
    }
    // même si un pct existait par erreur, un coût attendu inconnu ne produit jamais de marge
    expect(w.planCanonicalMargin(shadow('incomplete', 12)).margin_real_pct).toBeNull();
  });
  it('provisional : NULL par défaut, valeur seulement si opt-in explicite', () => {
    expect(w.planCanonicalMargin(shadow('provisional', 18)).margin_real_pct).toBeNull();
    expect(w.planCanonicalMargin(shadow('provisional', 18), {}, { writeProvisional: true }).margin_real_pct).toBe(18);
  });
  it('marge 0 exacte reste 0 (pas confondue avec inconnu)', () => {
    const p = w.planCanonicalMargin(shadow('final', 0));
    expect(p.margin_real_pct).toBe(0);
    expect(p.margin_alert).toBe(true);
  });
  it('sourcing_blocked : jamais posé, seulement levé', () => {
    expect(w.planCanonicalMargin(shadow('final', -5), { sourcing_blocked: false }).sourcing_blocked).toBe(false);
    expect(w.planCanonicalMargin(shadow('final', -5), { sourcing_blocked: true }).sourcing_blocked).toBe(true);
    expect(w.planCanonicalMargin(shadow('final', 3), { sourcing_blocked: true }).sourcing_blocked).toBe(false);
    expect(w.planCanonicalMargin(shadow('incomplete', null), { sourcing_blocked: true }).sourcing_blocked).toBe(false);
  });
});

describe('applyCanonicalMargin', () => {
  it('désactivé par défaut : aucun calcul, aucune écriture', async () => {
    const r = await w.applyCanonicalMargin('o1');
    expect(r).toEqual({ enabled: false, wrote: false, order_id: 'o1' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockShadow).not.toHaveBeenCalled();
    mockRules = { CANONICAL_MARGIN_WRITER_ENABLED: 0 };
    expect((await w.applyCanonicalMargin('o1')).wrote).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('activé : un seul UPDATE ciblé sur 3 colonnes (idempotent via IS DISTINCT FROM)', async () => {
    mockRules = { CANONICAL_MARGIN_WRITER_ENABLED: 1 };
    mockShadow.mockResolvedValue(shadow('final', 30));
    mockQuery.mockResolvedValue({ rowCount: 1 });
    const r = await w.applyCanonicalMargin('o1');
    expect(r.wrote).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/SET margin_real_pct = \$2, margin_alert = \$3, sourcing_blocked = \$4/);
    expect(sql).toMatch(/IS DISTINCT FROM/);
    expect(sql).not.toMatch(/cost_real_kmf|updated_at|cost_closed_at/);
    expect(params).toEqual(['o1', 30, false, false]);
    mockQuery.mockResolvedValue({ rowCount: 0 });
    expect((await w.applyCanonicalMargin('o1')).wrote).toBe(false);
  });

  it('utilise le client transactionnel fourni', async () => {
    mockRules = { CANONICAL_MARGIN_WRITER_ENABLED: 1 };
    mockShadow.mockResolvedValue(shadow('final', 30));
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
    await w.applyCanonicalMargin('o1', { client });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('commande introuvable → aucune écriture', async () => {
    mockRules = { CANONICAL_MARGIN_WRITER_ENABLED: 1 };
    mockShadow.mockResolvedValue(null);
    expect(await w.applyCanonicalMargin('x')).toMatchObject({ wrote: false, reason: 'order_not_found' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('preview : jamais d\'écriture, même activé', async () => {
    mockRules = { CANONICAL_MARGIN_WRITER_ENABLED: 1 };
    mockShadow.mockResolvedValue(shadow('final', 12, { margin_real_pct: 40 }));
    const p = await w.previewCanonicalMargin('o1');
    expect(p.plan.margin_real_pct).toBe(12);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
