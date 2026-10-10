'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/dashboard-metrics/control-tower', () => ({ getColisEnTransit: jest.fn() }));

const db = require('../../db');
const { getColisEnTransit } = require('../../services/dashboard-metrics/control-tower');
const logistics = require('../../services/dashboard-metrics/logistics');

describe('dashboard-metrics/logistics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getCmdsAujourdhui retourne le compteur et le delta vs hier', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ value: '12' }] })
      .mockResolvedValueOnce({ rows: [{ value: '8' }] });

    const result = await logistics.getCmdsAujourdhui();

    expect(result).toMatchObject({ key: 'cmds_aujourdhui', label: "Commandes aujourd'hui", value: 12, unit: 'count' });
    expect(result.delta).toMatchObject({ value: 50, direction: 'up', vs_period: 'hier' });
  });

  it('getPaiementsEnAttente applique les filtres et drilldown Canonical', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '5' }] });

    const result = await logistics.getPaiementsEnAttente({ relais_id: 'r1' });

    expect(result).toMatchObject({ key: 'paiements_en_attente', value: 5, drill_to: '/admin/operations' });
    // Exclusion alignée sur services/dashboard-orders.js#getPendingCash — même
    // définition métier partout où "paiements en attente" est affiché (une
    // seule source de vérité par KPI, cf. principe affiché sur Pilotage).
    expect(db.query.mock.calls[0][0]).toContain("o.status NOT IN ('cancelled', 'collected', 'refunded')");
    expect(db.query.mock.calls[0][1]).toEqual(['r1']);
  });

  it('getColisPreparation compte les colis en preparation', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '3' }] });

    await expect(logistics.getColisPreparation({ island: 'Anjouan' })).resolves.toMatchObject({ key: 'colis_preparation', value: 3 });
    expect(db.query.mock.calls[0][1]).toEqual(['Anjouan']);
  });

  it('getColisTransit delegue au control tower pour conserver INV-3', async () => {
    const kpi = { key: 'colis_transit', value: 4 };
    getColisEnTransit.mockResolvedValueOnce(kpi);

    await expect(logistics.getColisTransit({ status: 'available' })).resolves.toBe(kpi);
    expect(getColisEnTransit).toHaveBeenCalledWith({ status: 'available' });
  });

  it('getDisponiblesRelais retourne le drilldown Canonical disponible', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '9' }] });

    const result = await logistics.getDisponiblesRelais();

    expect(result).toMatchObject({ key: 'disponibles_relais', value: 9, drill_to: '/admin/operations#operations-control-chain' });
  });

  it('getRetardsCritiques ajoute un warning si retard present', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '2' }] });

    const result = await logistics.getRetardsCritiques();

    expect(result).toMatchObject({ key: 'retards_critiques', value: 2 });
    expect(result.data_quality.warning).toBe('2 colis en retard de plus de 14 jours');
  });

  it('getTauxCollecteRelais retourne null sans colis disponibles ou collectes', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ collected: '0', available_or_collected: '0' }] });

    const result = await logistics.getTauxCollecteRelais();

    expect(result).toMatchObject({ key: 'taux_collecte_relais', value: null, unit: '%' });
    expect(result.data_quality).toMatchObject({ completeness: 'provisional', items_total: 0, items_with_data: 0 });
  });

  it('getTauxCollecteRelais calcule collected / available_or_collected', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ collected: '3', available_or_collected: '4' }] });

    const result = await logistics.getTauxCollecteRelais();

    expect(result.value).toBe(75);
    expect(result.data_quality.completeness).toBe('complete');
  });
});

test('le seuil des retards critiques vient de LATE_THRESHOLDS (une seule source)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'services/dashboard-metrics/logistics.js'), 'utf8');
  expect(src).toContain('LATE_THRESHOLDS.shipped_late_days');
  expect(src).not.toContain("INTERVAL '14 days'");
});
