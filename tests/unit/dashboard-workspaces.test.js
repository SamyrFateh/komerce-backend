'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const workspaces = require('../../services/dashboard-metrics/workspaces');

describe('dashboard-metrics/workspaces', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getWorkspacesActifs applique from/to et drilldown', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '6' }] });

    const result = await workspaces.getWorkspacesActifs({ from: '2026-06-01', to: '2026-06-30' });

    expect(result).toMatchObject({ key: 'workspaces_actifs', value: 6, drill_to: '/admin/event-workspaces?status=active' });
    expect(db.query.mock.calls[0][1]).toEqual(['2026-06-01', '2026-06-30']);
  });

  it('getSessionsOuvertes compte les sessions open non expirees', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '2' }] });

    await expect(workspaces.getSessionsOuvertes()).resolves.toMatchObject({ key: 'sessions_ouvertes', value: 2 });
  });

  it('getTauxCompletion retourne provisional sans session', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items_with_data: '0', items_total: '0' }] });

    const result = await workspaces.getTauxCompletion();

    expect(result).toMatchObject({ key: 'taux_completion', value: null, unit: '%' });
    expect(result.data_quality.completeness).toBe('provisional');
  });

  it('getTauxCompletion calcule orders crees / sessions lancees', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ items_with_data: '3', items_total: '4' }] });

    const result = await workspaces.getTauxCompletion();

    expect(result.value).toBe(75);
    expect(result.data_quality).toMatchObject({ items_total: 4, items_with_data: 3, completeness: 'complete' });
  });

  it('getMontantTotalEvenements somme les paniers workspace', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '25000' }] });

    await expect(workspaces.getMontantTotalEvenements()).resolves.toMatchObject({ key: 'montant_total_evenements', value: 25000, unit: 'KMF' });
  });

  it('getSessionsSansCommande ajoute un warning si sessions terminees sans commande', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '1' }] });

    const result = await workspaces.getSessionsSansCommande();

    expect(result).toMatchObject({ key: 'sessions_sans_commande', value: 1 });
    expect(result.data_quality.warning).toBe('Sessions a relancer eventuellement');
  });

  it('getCmdsCreeesWorkspace utilise les filtres orders et drilldown', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '4' }] });

    const result = await workspaces.getCmdsCreeesWorkspace({ relais_id: 'r1' });

    expect(result).toMatchObject({ key: 'cmds_creees_workspace', value: 4, drill_to: '/admin/orders-logistics?origin=workspace' });
    expect(db.query.mock.calls[0][1]).toEqual(['r1']);
  });

  it('getPanierMoyEvenement retourne provisional sans workspace', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '0', items_total: '0' }] });

    const result = await workspaces.getPanierMoyEvenement();

    expect(result).toMatchObject({ key: 'panier_moy_evenement', value: 0, unit: 'KMF' });
    expect(result.data_quality.completeness).toBe('provisional');
  });

  it('getParticipantsMoy calcule la moyenne avec deux decimales', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ value: '2.345', items_total: '3' }] });

    const result = await workspaces.getParticipantsMoy();

    expect(result).toMatchObject({ key: 'participants_moy', value: 2.35, unit: 'count' });
    expect(result.data_quality.completeness).toBe('complete');
  });

  it('getParticipantsMoy degrade proprement si donnees indisponibles', async () => {
    db.query.mockRejectedValueOnce(new Error('missing relation'));

    const result = await workspaces.getParticipantsMoy();

    expect(result).toMatchObject({ key: 'participants_moy', value: null, unit: 'count' });
    expect(result.data_quality.completeness).toBe('provisional');
    expect(result.data_quality.warning).toContain('missing relation');
  });
});
