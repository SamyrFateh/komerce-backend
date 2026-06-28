'use strict';

/**
 * Tests de caractérisation — services/dashboard-metrics.js (Lot C3)
 *
 * Objectif : verrouiller le comportement actuel de chaque export AVANT
 * tout découpage. Pattern : mock db.query → réponse minimale au format
 * réel des colonnes SQL → vérifier la forme du KPI retourné.
 *
 * Important : les noms de colonnes mockés ci-dessous ont été vérifiés
 * contre le SQL réel de chaque getter (pas devinés) — ex. items_total /
 * items_with_data pour les ratios, margin_kmf / revenue_kmf pour les
 * marges en un seul aller DB (pas plusieurs requêtes séquentielles).
 *
 * Ces tests ne valident PAS la logique SQL elle-même — ils s'assurent
 * que l'interface publique (clé, unité, structure data_quality, nombre
 * d'appels db.query) reste stable après extraction des fichiers.
 *
 * Groupes :
 *   1. Helpers purs (buildFiltersClause, buildPreviousPeriod, computeDelta, makeKpi)
 *   2. Tour de contrôle (8 KPIs)
 *   3. Costing (8 KPIs)
 *   4. Logistics (7 KPIs, dont 1 alias)
 *   5. Workspaces collectifs (8 KPIs)
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');

const {
  buildFiltersClause, buildPreviousPeriod, computeDelta, makeKpi,
  ACTIVE_ORDER_STATUSES, TRANSIT_PARCEL_STATUSES,
  getCAEncaisse, getCmdsCreees, getCmdsActives, getColisEnTransit,
  getAlertesCritiques, getCmdsBloquees, getTauxCompletudeScans, getTauxCompletudeCouts,
  getCAVendu, getCoutEstime, getCoutReel,
  getMargeEstimee, getMargeVariableReelle, getMargeConsolidee,
  getCmdsCoutIncompletCount, getCmdsCoutIncompletIds, getCoutMoyParCmd,
  getCmdsAujourdhui, getPaiementsEnAttente, getColisPreparation,
  getColisTransit, getDisponiblesRelais, getRetardsCritiques, getTauxCollecteRelais,
  getWorkspacesActifs, getSessionsOuvertes, getTauxCompletion,
  getMontantTotalEvenements, getSessionsSansCommande, getCmdsCreeesWorkspace,
  getPanierMoyEvenement, getParticipantsMoy,
} = require('../../services/dashboard-metrics');

// ─── Helpers de mock ────────────────────────────────────────────────────
function mockQuery(rows) {
  db.query.mockResolvedValueOnce({ rows });
}
function mockQuerySeq(...rowsArray) {
  rowsArray.forEach((rows) => db.query.mockResolvedValueOnce({ rows }));
}

// ─── Shape KPI attendue ─────────────────────────────────────────────────
function expectKpi(kpi, { key, unit }) {
  expect(kpi).toMatchObject({
    key,
    unit,
    data_quality: expect.objectContaining({ completeness: expect.any(String) }),
  });
  expect(kpi).toHaveProperty('value');
  expect(kpi).toHaveProperty('delta');
  expect(kpi).toHaveProperty('drill_to');
}

beforeEach(() => {
  db.query.mockReset();
});

// ══════════════════════════════════════════════════════════════════════
// 1. HELPERS PURS
// ══════════════════════════════════════════════════════════════════════

describe('buildFiltersClause', () => {
  it('retourne where=1=1 sans filtres', () => {
    const { where, params } = buildFiltersClause({});
    expect(where).toContain('1=1');
    expect(params).toEqual([]);
  });

  it('ajoute filtre from/to en paramètres positionnels', () => {
    const { where, params } = buildFiltersClause({ from: '2026-01-01', to: '2026-01-31' });
    expect(where).toContain('$1');
    expect(where).toContain('$2');
    expect(params).toEqual(['2026-01-01', '2026-01-31']);
  });

  it('ajoute filtre island sur destination_island', () => {
    const { where, params } = buildFiltersClause({ island: 'grande_comore' });
    expect(where).toContain('destination_island');
    expect(params).toContain('grande_comore');
  });
});

describe('buildPreviousPeriod', () => {
  it('retourne null sans from+to', () => {
    expect(buildPreviousPeriod({})).toBeNull();
  });

  it('retourne une période antérieure de même durée avec from+to', () => {
    const prev = buildPreviousPeriod({ from: '2026-01-01', to: '2026-01-31' });
    expect(prev).not.toBeNull();
    expect(prev).toHaveProperty('from');
    expect(prev).toHaveProperty('to');
  });

  it('retourne null si to <= from', () => {
    expect(buildPreviousPeriod({ from: '2026-01-31', to: '2026-01-01' })).toBeNull();
  });
});

describe('computeDelta', () => {
  it('retourne is_comparable=false (pas null) si valeur précédente est 0', () => {
    const d = computeDelta(100, 0, 'p');
    expect(d).toEqual({ value: null, unit: '%', direction: 'flat', vs_period: 'p', is_comparable: false });
  });

  it('calcule un delta positif', () => {
    const d = computeDelta(120, 100, 'p');
    expect(d.direction).toBe('up');
    expect(d.is_comparable).toBe(true);
    expect(d.value).toBeCloseTo(20);
  });

  it('calcule un delta négatif (value signée, pas une magnitude)', () => {
    const d = computeDelta(80, 100, 'p');
    expect(d.direction).toBe('down');
    expect(d.value).toBeCloseTo(-20);
  });
});

describe('makeKpi', () => {
  it('retourne la structure complète avec defaults', () => {
    const k = makeKpi('test', 'Test', 42, 'KMF');
    expect(k).toEqual({
      key: 'test', label: 'Test', value: 42, unit: 'KMF',
      delta: null,
      data_quality: { completeness: 'complete', items_total: null, items_with_data: null, warning: null },
      drill_to: null,
    });
  });
});

describe('CONSTANTES', () => {
  it('ACTIVE_ORDER_STATUSES contient confirmed et shipped, pas pending', () => {
    expect(ACTIVE_ORDER_STATUSES).toContain('confirmed');
    expect(ACTIVE_ORDER_STATUSES).toContain('shipped');
    expect(ACTIVE_ORDER_STATUSES).not.toContain('pending');
  });
  it('TRANSIT_PARCEL_STATUSES contient in_transit', () => {
    expect(TRANSIT_PARCEL_STATUSES).toContain('in_transit');
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. TOUR DE CONTROLE
// ══════════════════════════════════════════════════════════════════════

describe('getCAEncaisse', () => {
  it('retourne ca_encaisse en KMF, sans requête delta si pas de from/to', async () => {
    mockQuery([{ value: '150000', items_total: '12' }]);
    const k = await getCAEncaisse({});
    expectKpi(k, { key: 'ca_encaisse', unit: 'KMF' });
    expect(k.value).toBe(150000);
    expect(k.delta).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('déclenche une 2e requête (delta) si from+to fournis', async () => {
    mockQuerySeq([{ value: '150000', items_total: '12' }], [{ value: '100000' }]);
    const k = await getCAEncaisse({ from: '2026-06-01', to: '2026-06-28' });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(k.delta).not.toBeNull();
    expect(k.delta.is_comparable).toBe(true);
  });
});

describe('getCmdsCreees', () => {
  it('retourne un KPI cmds_creees en unit=count', async () => {
    mockQuery([{ value: 5 }]);
    const k = await getCmdsCreees({});
    expectKpi(k, { key: 'cmds_creees', unit: 'count' });
    expect(k.value).toBe(5);
  });
});

describe('getCmdsActives', () => {
  it('retourne un KPI cmds_actives en unit=count, une seule requête', async () => {
    mockQuery([{ value: 3 }]);
    const k = await getCmdsActives({});
    expectKpi(k, { key: 'cmds_actives', unit: 'count' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('getColisEnTransit', () => {
  it('retourne un KPI clé colis_transit (pas colis_en_transit), unit=count', async () => {
    mockQuery([{ value: 7 }]);
    const k = await getColisEnTransit({});
    expectKpi(k, { key: 'colis_transit', unit: 'count' });
  });
});

describe('getAlertesCritiques', () => {
  it('retourne un KPI alertes_critiques en unit=count', async () => {
    mockQuery([{ value: 2 }]);
    const k = await getAlertesCritiques({});
    expectKpi(k, { key: 'alertes_critiques', unit: 'count' });
  });

  it('pose un warning si value > 10', async () => {
    mockQuery([{ value: 11 }]);
    const k = await getAlertesCritiques({});
    expect(k.data_quality.warning).not.toBeNull();
  });
});

describe('getCmdsBloquees', () => {
  it('retourne un KPI cmds_bloquees en unit=count', async () => {
    mockQuery([{ value: 1 }]);
    const k = await getCmdsBloquees({});
    expectKpi(k, { key: 'cmds_bloquees', unit: 'count' });
  });
});

describe('getTauxCompletudeScans', () => {
  it('retourne un KPI taux_completude_scans en %, colonnes items_total/items_with_data', async () => {
    mockQuery([{ items_total: 10, items_with_data: 8 }]);
    const k = await getTauxCompletudeScans({});
    expectKpi(k, { key: 'taux_completude_scans', unit: '%' });
    expect(k.value).toBe(80);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('value=null et completeness=provisional si items_total=0', async () => {
    mockQuery([{ items_total: 0, items_with_data: 0 }]);
    const k = await getTauxCompletudeScans({});
    expect(k.value).toBeNull();
    expect(k.data_quality.completeness).toBe('provisional');
  });
});

describe('getTauxCompletudeCouts', () => {
  it('retourne un KPI taux_completude_couts en %, colonnes items_total/items_with_data', async () => {
    mockQuery([{ items_total: 10, items_with_data: 7 }]);
    const k = await getTauxCompletudeCouts({});
    expectKpi(k, { key: 'taux_completude_couts', unit: '%' });
    expect(k.value).toBe(70);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. COSTING
// ══════════════════════════════════════════════════════════════════════

describe('getCAVendu', () => {
  it('délègue à getCAEncaisse — clé ca_vendu, label CA vendu, même valeur', async () => {
    mockQuery([{ value: '200000', items_total: '9' }]);
    const k = await getCAVendu({});
    expectKpi(k, { key: 'ca_vendu', unit: 'KMF' });
    expect(k.label).toBe('CA vendu');
    expect(k.value).toBe(200000);
  });
});

describe('getCoutEstime', () => {
  it('retourne un KPI cout_estime en KMF — colonnes value/items_with_data/items_total', async () => {
    mockQuery([{ value: '50000', items_with_data: 8, items_total: 10 }]);
    const k = await getCoutEstime({});
    expectKpi(k, { key: 'cout_estime', unit: 'KMF' });
    expect(k.value).toBe(50000);
    expect(k.data_quality.completeness).toBe('partial');
  });
});

describe('getCoutReel', () => {
  it('retourne un KPI cout_reel en KMF — colonnes value/items_with_data/items_total', async () => {
    mockQuery([{ value: '45000', items_with_data: 6, items_total: 10 }]);
    const k = await getCoutReel({});
    expectKpi(k, { key: 'cout_reel', unit: 'KMF' });
    expect(k.value).toBe(45000);
  });

  it('completeness=provisional si items_total=0', async () => {
    mockQuery([{ value: '0', items_with_data: 0, items_total: 0 }]);
    const k = await getCoutReel({});
    expect(k.data_quality.completeness).toBe('provisional');
  });
});

describe('getMargeEstimee', () => {
  it('une seule requête (CTE order_aggs) — colonnes margin_kmf/revenue_kmf/items_with_data/items_total', async () => {
    mockQuery([{ margin_kmf: '155000', revenue_kmf: '200000', items_with_data: 5, items_total: 5 }]);
    const k = await getMargeEstimee({});
    expectKpi(k, { key: 'marge_estimee', unit: 'KMF' });
    expect(k.value).toBe(155000);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('getMargeVariableReelle', () => {
  it('une seule requête — colonnes margin_kmf/revenue_kmf/items_with_data/items_total', async () => {
    mockQuery([{ margin_kmf: '150000', revenue_kmf: '200000', items_with_data: 5, items_total: 5 }]);
    const k = await getMargeVariableReelle({});
    expectKpi(k, { key: 'marge_variable_reelle', unit: 'KMF' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('getMargeConsolidee', () => {
  it('une seule requête — colonnes margin_kmf/revenue_kmf/items_with_data/items_total', async () => {
    mockQuery([{ margin_kmf: '145000', revenue_kmf: '200000', items_with_data: 5, items_total: 5 }]);
    const k = await getMargeConsolidee({});
    expectKpi(k, { key: 'marge_consolidee', unit: 'KMF' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('getCmdsCoutIncompletCount', () => {
  it('retourne un KPI clé cmds_cout_incomplet (pas _count), unit=count', async () => {
    mockQuery([{ value: 3 }]);
    const k = await getCmdsCoutIncompletCount({});
    expectKpi(k, { key: 'cmds_cout_incomplet', unit: 'count' });
  });
});

describe('getCmdsCoutIncompletIds', () => {
  it('retourne directement r.rows (pas un KPI)', async () => {
    mockQuery([{ order_id: 'a' }, { order_id: 'b' }]);
    const result = await getCmdsCoutIncompletIds({});
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
  });
});

describe('getCoutMoyParCmd', () => {
  it('retourne un KPI cout_moy_par_cmd en KMF — colonnes value/items_total', async () => {
    mockQuery([{ value: '5000', items_total: 12 }]);
    const k = await getCoutMoyParCmd({});
    expectKpi(k, { key: 'cout_moy_par_cmd', unit: 'KMF' });
    expect(k.value).toBe(5000);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. LOGISTICS
// ══════════════════════════════════════════════════════════════════════

describe('getCmdsAujourdhui', () => {
  it('fait toujours 2 requêtes (aujourd\'hui + hier), clé cmds_aujourdhui', async () => {
    mockQuerySeq([{ value: 4 }], [{ value: 2 }]);
    const k = await getCmdsAujourdhui({});
    expectKpi(k, { key: 'cmds_aujourdhui', unit: 'count' });
    expect(k.value).toBe(4);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(k.delta).not.toBeNull();
  });
});

describe('getPaiementsEnAttente', () => {
  it('retourne un KPI paiements_en_attente en unit=count', async () => {
    mockQuery([{ value: 2 }]);
    const k = await getPaiementsEnAttente({});
    expectKpi(k, { key: 'paiements_en_attente', unit: 'count' });
  });
});

describe('getColisPreparation', () => {
  it('retourne un KPI colis_preparation en unit=count', async () => {
    mockQuery([{ value: 6 }]);
    const k = await getColisPreparation({});
    expectKpi(k, { key: 'colis_preparation', unit: 'count' });
  });
});

describe('getColisTransit', () => {
  it('délègue à getColisEnTransit — même clé colis_transit', async () => {
    mockQuery([{ value: 3 }]);
    const k = await getColisTransit({});
    expectKpi(k, { key: 'colis_transit', unit: 'count' });
  });
});

describe('getDisponiblesRelais', () => {
  it('retourne un KPI disponibles_relais en unit=count', async () => {
    mockQuery([{ value: 5 }]);
    const k = await getDisponiblesRelais({});
    expectKpi(k, { key: 'disponibles_relais', unit: 'count' });
  });
});

describe('getRetardsCritiques', () => {
  it('retourne un KPI retards_critiques en unit=count', async () => {
    mockQuery([{ value: 1 }]);
    const k = await getRetardsCritiques({});
    expectKpi(k, { key: 'retards_critiques', unit: 'count' });
  });
});

describe('getTauxCollecteRelais', () => {
  it('retourne un KPI taux_collecte_relais en %, colonnes collected/available_or_collected', async () => {
    mockQuery([{ collected: 7, available_or_collected: 10 }]);
    const k = await getTauxCollecteRelais({});
    expectKpi(k, { key: 'taux_collecte_relais', unit: '%' });
    expect(k.value).toBe(70);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. WORKSPACES COLLECTIFS
// ══════════════════════════════════════════════════════════════════════

describe('getWorkspacesActifs', () => {
  it('retourne un KPI workspaces_actifs en unit=count', async () => {
    mockQuery([{ value: 2 }]);
    const k = await getWorkspacesActifs({});
    expectKpi(k, { key: 'workspaces_actifs', unit: 'count' });
  });
});

describe('getSessionsOuvertes', () => {
  it('retourne un KPI sessions_ouvertes en unit=count, ignore les filtres', async () => {
    mockQuery([{ value: 3 }]);
    const k = await getSessionsOuvertes({ from: '2026-01-01' });
    expectKpi(k, { key: 'sessions_ouvertes', unit: 'count' });
    expect(db.query).toHaveBeenCalledWith(expect.any(String));
  });
});

describe('getTauxCompletion', () => {
  it('retourne un KPI taux_completion en %, colonnes items_with_data/items_total', async () => {
    mockQuery([{ items_with_data: 7, items_total: 10 }]);
    const k = await getTauxCompletion({});
    expectKpi(k, { key: 'taux_completion', unit: '%' });
    expect(k.value).toBe(70);
  });
});

describe('getMontantTotalEvenements', () => {
  it('retourne un KPI montant_total_evenements en KMF', async () => {
    mockQuery([{ value: '30000' }]);
    const k = await getMontantTotalEvenements({});
    expectKpi(k, { key: 'montant_total_evenements', unit: 'KMF' });
  });
});

describe('getSessionsSansCommande', () => {
  it('retourne un KPI sessions_sans_commande en unit=count', async () => {
    mockQuery([{ value: 1 }]);
    const k = await getSessionsSansCommande({});
    expectKpi(k, { key: 'sessions_sans_commande', unit: 'count' });
  });
});

describe('getCmdsCreeesWorkspace', () => {
  it('retourne un KPI cmds_creees_workspace en unit=count', async () => {
    mockQuery([{ value: 4 }]);
    const k = await getCmdsCreeesWorkspace({});
    expectKpi(k, { key: 'cmds_creees_workspace', unit: 'count' });
  });
});

describe('getPanierMoyEvenement', () => {
  it('retourne un KPI panier_moy_evenement en KMF, colonnes value/items_total', async () => {
    mockQuery([{ value: '5000', items_total: 4 }]);
    const k = await getPanierMoyEvenement({});
    expectKpi(k, { key: 'panier_moy_evenement', unit: 'KMF' });
    expect(k.value).toBe(5000);
  });
});

describe('getParticipantsMoy', () => {
  it('retourne un KPI participants_moy en unit=count, colonnes value/items_total', async () => {
    mockQuery([{ value: '5.50', items_total: 4 }]);
    const k = await getParticipantsMoy({});
    expectKpi(k, { key: 'participants_moy', unit: 'count' });
    expect(k.value).toBe(5.5);
  });

  it('fallback provisional si la requête échoue (table/colonne absente)', async () => {
    db.query.mockRejectedValueOnce(new Error('column cwc.contributor_email does not exist'));
    const k = await getParticipantsMoy({});
    expect(k.value).toBeNull();
    expect(k.data_quality.completeness).toBe('provisional');
    expect(k.data_quality.warning).toMatch(/Donnees indisponibles/);
  });
});
