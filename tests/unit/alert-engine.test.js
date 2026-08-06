'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/alert-engine.test.js
 *
 * Tests dédiés de services/alert-engine.js (Lot C, AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md).
 *
 * L'audit listait ce fichier à 0 %, mais un test existant
 * (tests/notifications/whatsapp-meta-alert-engine.test.js) couvre déjà
 * runAll() en isolation (mock des 5 checks). Ce fichier ferme le reste :
 * les 5 fonctions de détection elles-mêmes (requêtes + calcul de sévérité
 * + mapping alerte), _createAlertIfNew (déduplication + insertion),
 * getActiveAlerts (filtres dynamiques) et acknowledgeAlert.
 *
 * Pour les 5 checks, _createAlertIfNew est spy-mocké : on vérifie qu'il
 * est appelé avec les bons arguments (type, parcelId, orderId, severity,
 * description, metadata) sans re-tester la déduplication/insertion à
 * chaque fois — celle-ci est testée une fois pour toutes dans son propre
 * describe block.
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const db = require('../../db');
const AlertEngine = require('../../services/alert-engine');

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('checkStuckParcels', () => {
  it('aucune ligne → []', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await AlertEngine.checkStuckParcels();
    expect(result).toEqual([]);
  });

  it('interroge avec le seuil STUCK_DAYS=7', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await AlertEngine.checkStuckParcels();
    expect(db.query.mock.calls[0][1]).toEqual([7]);
  });

  it('severité critical si days > 21', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', status: 'in_transit', order_id: 'o1', days_since_activity: '25.4' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    const result = await AlertEngine.checkStuckParcels();
    expect(spy).toHaveBeenCalledWith('stuck_parcel', 'p1', 'o1', 'critical',
      expect.stringContaining('REF1'), { days_stuck: 25, parcel_status: 'in_transit' });
    expect(result).toEqual([{ id: 'inc1' }]);
  });

  it('severité high si 14 < days <= 21', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', status: 'available', order_id: 'o1', days_since_activity: '18' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkStuckParcels();
    expect(spy.mock.calls[0][3]).toBe('high');
  });

  it('severité medium si days <= 14', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', status: 'available', order_id: 'o1', days_since_activity: '8' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkStuckParcels();
    expect(spy.mock.calls[0][3]).toBe('medium');
  });

  it('filtre les alertes déjà existantes (_createAlertIfNew → null)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'p1', reference: 'REF1', status: 'available', order_id: 'o1', days_since_activity: '8' },
        { id: 'p2', reference: 'REF2', status: 'available', order_id: 'o2', days_since_activity: '9' },
      ],
    });
    jest.spyOn(AlertEngine, '_createAlertIfNew')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'inc2' });
    const result = await AlertEngine.checkStuckParcels();
    expect(result).toEqual([{ id: 'inc2' }]);
  });
});

describe('checkWeightMismatches', () => {
  it('interroge avec le seuil WEIGHT_TOLERANCE_PCT=20', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await AlertEngine.checkWeightMismatches();
    expect(db.query.mock.calls[0][1]).toEqual([20]);
  });

  it('severité high si diff_pct > 50', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', order_id: 'o1', expected_weight_kg: 10, actual_weight_kg: 16, diff_pct: '60' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkWeightMismatches();
    expect(spy).toHaveBeenCalledWith('content_mismatch', 'p1', 'o1', 'high',
      expect.stringContaining('REF1'), { expected: 10, actual: 16, diff_pct: 60 });
  });

  it('severité medium si diff_pct <= 50', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', order_id: 'o1', expected_weight_kg: 10, actual_weight_kg: 12, diff_pct: '20' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkWeightMismatches();
    expect(spy.mock.calls[0][3]).toBe('medium');
  });

  it('aucune ligne → []', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await AlertEngine.checkWeightMismatches();
    expect(result).toEqual([]);
  });
});

describe('checkSLABreaches', () => {
  it('interroge avec le seuil TRANSIT_MAX_DAYS=21', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await AlertEngine.checkSLABreaches();
    expect(db.query.mock.calls[0][1]).toEqual([21]);
  });

  it('severité critical si days > 35', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', order_id: 'o1', status: 'in_transit', days_in_transit: '40' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkSLABreaches();
    expect(spy.mock.calls[0][3]).toBe('critical');
    expect(spy.mock.calls[0][5]).toEqual({ days_in_transit: 40, sla_days: 21 });
  });

  it('severité high si 28 < days <= 35', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', order_id: 'o1', status: 'in_transit', days_in_transit: '30' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkSLABreaches();
    expect(spy.mock.calls[0][3]).toBe('high');
  });

  it('severité medium si days <= 28', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', order_id: 'o1', status: 'shipped', days_in_transit: '22' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkSLABreaches();
    expect(spy.mock.calls[0][3]).toBe('medium');
  });
});

describe('checkUnverifiedParcels', () => {
  it('interroge avec le seuil UNVERIFIED_HOURS=48', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await AlertEngine.checkUnverifiedParcels();
    expect(db.query.mock.calls[0][1]).toEqual([48]);
  });

  it('severité toujours medium, type scan_anomaly', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', order_id: 'o1', hours_since_arrival: '72' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkUnverifiedParcels();
    expect(spy).toHaveBeenCalledWith('scan_anomaly', 'p1', 'o1', 'medium',
      expect.stringContaining('REF1'), { hours_at_relais: 72 });
  });

  it('aucune ligne → []', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await AlertEngine.checkUnverifiedParcels();
    expect(result).toEqual([]);
  });
});

describe('checkCashPending', () => {
  it('interroge avec le seuil CASH_PENDING_HOURS=72', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await AlertEngine.checkCashPending();
    expect(db.query.mock.calls[0][1]).toEqual([72]);
  });

  it('severité toujours high, type payment_issue, montant formaté', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p1', reference: 'REF1', order_id: 'o1', order_ref: 'ORD1', total_kmf: 150000, hours_available: '80' }],
    });
    const spy = jest.spyOn(AlertEngine, '_createAlertIfNew').mockResolvedValueOnce({ id: 'inc1' });
    await AlertEngine.checkCashPending();
    expect(spy).toHaveBeenCalledWith('payment_issue', 'p1', 'o1', 'high',
      expect.stringContaining('150'), { hours_pending: 80, amount_kmf: 150000 });
  });
});

describe('_createAlertIfNew', () => {
  it('incident déjà ouvert pour ce colis+type → retourne null, pas d\'INSERT', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'existing-inc' }] });
    const result = await AlertEngine._createAlertIfNew('stuck_parcel', 'p1', 'o1', 'high', 'desc', { a: 1 });
    expect(result).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('aucun incident existant → INSERT exécuté, incident retourné', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-inc', type: 'stuck_parcel' }] });
    const result = await AlertEngine._createAlertIfNew('stuck_parcel', 'p1', 'o1', 'high', 'desc', { a: 1 });
    expect(result).toEqual({ id: 'new-inc', type: 'stuck_parcel' });
    expect(db.query).toHaveBeenCalledTimes(2);
    const [, insertParams] = db.query.mock.calls[1];
    expect(insertParams).toEqual(['p1', 'o1', 'stuck_parcel', 'high', 'desc', JSON.stringify({ a: 1 })]);
  });

  it('metadata absente → JSON.stringify({})', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'new-inc' }] });
    await AlertEngine._createAlertIfNew('stuck_parcel', 'p1', 'o1', 'high', 'desc', undefined);
    const [, insertParams] = db.query.mock.calls[1];
    expect(insertParams[5]).toBe('{}');
  });
});

describe('getActiveAlerts', () => {
  it('sans filtres : condition unique status, params vides', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await AlertEngine.getActiveAlerts();
    expect(result).toEqual([]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/i\.type = \$/);
    expect(sql).not.toMatch(/i\.severity = \$/);
    expect(params).toEqual([]);
  });

  it('filtre type seul', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await AlertEngine.getActiveAlerts({ type: 'stuck_parcel' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/i\.type = \$1/);
    expect(params).toEqual(['stuck_parcel']);
  });

  it('filtre severity seul', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await AlertEngine.getActiveAlerts({ severity: 'critical' });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/i\.severity = \$1/);
    expect(params).toEqual(['critical']);
  });

  it('type + severity combinés : indices $1/$2 dans l\'ordre', async () => {
    const rows = [{ id: 'inc1' }];
    db.query.mockResolvedValueOnce({ rows });
    const result = await AlertEngine.getActiveAlerts({ type: 'delay', severity: 'high' });
    expect(result).toEqual(rows);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/i\.type = \$1/);
    expect(sql).toMatch(/i\.severity = \$2/);
    expect(params).toEqual(['delay', 'high']);
  });
});

describe('acknowledgeAlert', () => {
  it('acknowledgedBy fourni → transmis tel quel', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inc1', status: 'investigating' }] });
    const result = await AlertEngine.acknowledgeAlert('inc1', 'Fatima');
    expect(result).toEqual({ id: 'inc1', status: 'investigating' });
    expect(db.query.mock.calls[0][1]).toEqual(['inc1', 'Fatima']);
  });

  it('acknowledgedBy absent → fallback "admin"', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'inc1' }] });
    await AlertEngine.acknowledgeAlert('inc1');
    expect(db.query.mock.calls[0][1]).toEqual(['inc1', 'admin']);
  });

  it('aucune alerte ouverte correspondante → undefined', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await AlertEngine.acknowledgeAlert('inc-nope');
    expect(result).toBeUndefined();
  });
});
