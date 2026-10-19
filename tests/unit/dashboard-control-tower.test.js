'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const control = require('../../services/dashboard-metrics/control-tower');

describe('dashboard-metrics/control-tower', () => {
  test('CA payé est libellé comme cohorte de commandes payées, pas comme cash receipt', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '150000', items_total: '12' }] });
    const kpi = await control.getCAEncaisse({});
    expect(kpi).toMatchObject({
      key: 'ca_encaisse',
      label: 'CA commandes payées',
      value: 150000,
      unit: 'KMF',
    });
  });


  beforeEach(() => jest.clearAllMocks());

  it('getCAEncaisse retourne le CA et le delta periode precedente', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ value: '100000', items_total: '4' }] })
      .mockResolvedValueOnce({ rows: [{ value: '50000' }] });

    const result = await control.getCAEncaisse({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' });

    expect(result).toMatchObject({ key: 'ca_encaisse', value: 100000, unit: 'KMF', drill_to: '/admin/costing' });
    expect(result.delta).toMatchObject({ value: 100, direction: 'up', is_comparable: true });
    expect(result.data_quality.items_total).toBe(4);
  });

  it('getCmdsCreees compte, calcule le delta et drill vers Operations', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ value: '10' }] })
      .mockResolvedValueOnce({ rows: [{ value: '20' }] });

    const result = await control.getCmdsCreees({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-11T00:00:00.000Z' });

    expect(result).toMatchObject({ key: 'cmds_creees', value: 10, drill_to: '/admin/operations' });
    expect(result.delta).toMatchObject({ value: -50, direction: 'down' });
  });

  it('getProduitsActifsVendus compte les produits distincts vendus sur commandes payées et drill vers le catalogue', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ value: '8' }] })
      .mockResolvedValueOnce({ rows: [{ value: '5' }] });

    const result = await control.getProduitsActifsVendus({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-11T00:00:00.000Z' });

    expect(result).toMatchObject({ key: 'produits_actifs_vendus', value: 8, unit: 'count', drill_to: '/admin/workspaces/catalog' });
    expect(result.delta).toMatchObject({ value: 60, direction: 'up' });
    expect(String(db.query.mock.calls[0][0])).toMatch(/COUNT\(DISTINCT oi\.product_id\)/);
    expect(String(db.query.mock.calls[0][0])).toMatch(/payment_status = 'paid'/);
    expect(String(db.query.mock.calls[0][0])).toMatch(/status NOT IN \('cancelled', 'refunded'\)/);
  });

  it('getCmdsActives utilise la liste canonique des statuts actifs et drill vers Operations', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '7' }] });

    const result = await control.getCmdsActives({ island: 'Anjouan' });

    expect(result).toMatchObject({ key: 'cmds_actives', value: 7, unit: 'count', drill_to: '/admin/operations#operations-control-chain' });
    expect(db.query.mock.calls[0][1][0]).toBe('Anjouan');
    expect(db.query.mock.calls[0][1][1]).toEqual(expect.arrayContaining(['confirmed', 'available']));
  });

  it('getColisEnTransit compte les colis transit et drill vers Operations', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '3' }] });

    const result = await control.getColisEnTransit();

    expect(result).toMatchObject({ key: 'colis_transit', value: 3, drill_to: '/admin/operations#operations-control-chain' });
    expect(db.query.mock.calls[0][1][0]).toEqual(expect.arrayContaining(['shipped', 'in_transit', 'arrived']));
  });

  it('getAlertesCritiques applique les filtres et drill vers Action Center', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '11' }] });

    const result = await control.getAlertesCritiques({});

    expect(result).toMatchObject({ key: 'alertes_critiques', value: 11, drill_to: '/admin/action-center?severity=critical,urgent' });
    expect(result.data_quality.warning).toBe('Beaucoup de signaux non resolus');
    expect(db.query.mock.calls[0][0]).toContain("s.status IN ('open', 'acknowledged')");
    expect(db.query.mock.calls[0][0]).toContain('s.market_id IS NULL');
    expect(db.query.mock.calls[0][1]).toEqual([]);
  });

  it('getPointsAttention compte les signaux warning et drill vers Action Center', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '4' }] });

    const result = await control.getPointsAttention({ market_id: 'm-1' });

    expect(result).toMatchObject({ key: 'points_attention', value: 4, drill_to: '/admin/action-center?severity=warning' });
    expect(db.query.mock.calls[0][0]).toContain("s.severity = 'warning'");
    expect(db.query.mock.calls[0][0]).toContain('s.market_id = $1::uuid');
    expect(db.query.mock.calls[0][1]).toEqual(['m-1']);
  });

  it('getCmdsBloquees (S4) : source canonique alertes/incidents, jamais le texte de orders.notes', async () => {
    db.query.mockResolvedValueOnce({ rows: [
      { reason: 'paid_but_stock_blocked', n: 2, total: 3 },
      { reason: 'quantity_mismatch', n: 1, total: 3 },
    ] });

    const result = await control.getCmdsBloquees();

    expect(result).toMatchObject({ key: 'cmds_bloquees', value: 3, drill_to: '/admin/operations#operations-control-chain' });
    expect(result.breakdown).toEqual([
      { reason: 'paid_but_stock_blocked', label: 'payée sans stock', count: 2 },
      { reason: 'quantity_mismatch', label: 'écart de quantité', count: 1 },
    ]);
    expect(result.data_quality.warning).toBe('3 commande(s) payée(s) bloquée(s) — motifs : payée sans stock : 2 · écart de quantité : 1 (une commande peut en cumuler plusieurs)');
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/ILIKE|o\.notes/);
    expect(sql).toMatch(/FROM incidents i/);
    expect(sql).toMatch(/JOIN alerts a/);
    expect(sql).toMatch(/a\.resolved_at IS NULL/);
    expect(params[params.length - 1]).toEqual(['blocked', 'quantity_mismatch', 'hub_purchase_identity_conflict', 'hub_purchase_quantity_conflict']);
  });

  it('getCmdsBloquees (S4) : aucun blocage → 0 sans avertissement', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await control.getCmdsBloquees();
    expect(result.value).toBe(0);
    expect(result.breakdown).toEqual([]);
    expect(result.data_quality.warning).toBeNull();
  });

  it('getTauxCompletudeScans retourne null et provisional sans colis', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items_total: '0', items_with_data: '0' }] });

    const result = await control.getTauxCompletudeScans();

    expect(result).toMatchObject({ key: 'taux_completude_scans', value: null, unit: '%' });
    expect(result.data_quality.completeness).toBe('provisional');
  });

  it('getTauxCompletudeCouts calcule le ratio actual/total et garde le drill Costing tant que Finance est incomplet', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items_total: '10', items_with_data: '4' }] });

    const result = await control.getTauxCompletudeCouts({ status: 'available' });

    expect(result).toMatchObject({ key: 'taux_completude_couts', value: 40, unit: '%', drill_to: '/admin/finance#finance-incomplete-costs' });
    expect(result.data_quality.completeness).toBe('partial');
    expect(result.data_quality.warning).toBe('Beaucoup de commandes sans coût consolidé');
    expect(db.query.mock.calls[0][1][0]).toBe('available');
    const sql = String(db.query.mock.calls[0][0]);
    expect(db.query.mock.calls[0][1]).toEqual(['available']);
    expect(sql).toContain('is_actual = TRUE');
    expect(sql).toContain("SELECT 'payment'::text");
    expect(sql).toContain("os.status::text = 'collected'"); // marge finale prête : notion distincte
    expect(sql).not.toContain('fixed_overhead');
    expect(sql).toContain('< 1'); // commandes sans coût encore attendu exclues du dénominateur
  });
});
