'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/parcel-api-v2-helpers.test.js
 *
 * Tests du module routes/parcel-api-v2/helpers.js.
 *
 * OBSERVATION (pas un bug, signalé pour mémoire) : `transitionOrderStatus`
 * est importée en tête de fichier (services/order-status-machine) mais
 * n'est jamais utilisée dans ce module — import mort. Non corrigé ici
 * (hors périmètre D3 = coverage), à signaler si nettoyage souhaité.
 *
 * Couverture :
 *   cached/setCache/clearCache : TTL 30s (via Date.now mocké), miss, clear
 *   stripPickupCodeDeep : array, objet imbriqué, primitive, null, clé filtrée
 *   getAgentRelaisId : agent trouvé/absent, relais_id null
 *   parcelBelongsToRelais : trouvé / non trouvé
 *   sendScopedRelayKpis : agrégation par île, île "Inconnu" (null)
 *   relayAgentScopeMiddleware : tous les branchements (rôle, relais manquant,
 *     wrapping res.json, /kpis, chemins interdits, '/', match regex path,
 *     autorisé/non autorisé, catch)
 *   reconcileParcel : les 5 checks + statuts globaux blocked/warning/ok
 *   computeParcelAlerts : SLA preparation/in_transit/available (warning vs
 *     critical), hoursSince(undefined)=Infinity, open_incidents
 *   checkScanSequence : vide, événement inconnu ignoré, séquence
 *     décroissante, croissante
 */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockDbQuery(...a) }));
jest.mock('../../services/order-status-machine', () => ({ transitionOrderStatus: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const helpers = require('../../routes/parcel-api-v2/helpers');
const {
  cached, setCache, clearCache,
  stripPickupCodeDeep, getAgentRelaisId, parcelBelongsToRelais,
  sendScopedRelayKpis, relayAgentScopeMiddleware,
  reconcileParcel, computeParcelAlerts, checkScanSequence,
} = helpers;

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

// ═══════════════════════════════════════════════════════════════════════
describe('cache (cached/setCache/clearCache)', () => {
  it('setCache puis cached renvoie la donnée dans le TTL', () => {
    setCache('k1', { foo: 'bar' });
    expect(cached('k1')).toEqual({ foo: 'bar' });
  });

  it('cached renvoie null si la clé est absente', () => {
    expect(cached('inexistant')).toBeNull();
  });

  it('cached renvoie null si le TTL (30s) est dépassé', () => {
    const realNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;

    setCache('k2', 'data');
    now += 30_001;

    expect(cached('k2')).toBeNull();

    Date.now = realNow;
  });

  it('clearCache vide toutes les entrées', () => {
    setCache('a', 1);
    setCache('b', 2);
    clearCache();
    expect(cached('a')).toBeNull();
    expect(cached('b')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('stripPickupCodeDeep', () => {
  it('primitive (non objet) renvoyée telle quelle', () => {
    expect(stripPickupCodeDeep(42)).toBe(42);
    expect(stripPickupCodeDeep('str')).toBe('str');
  });

  it('null renvoyé tel quel', () => {
    expect(stripPickupCodeDeep(null)).toBeNull();
  });

  it('tableau : applique récursivement à chaque élément', () => {
    const result = stripPickupCodeDeep([{ pickup_code: '1234', a: 1 }, { b: 2 }]);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('objet : retire pickup_code, garde le reste, récursif sur les objets imbriqués', () => {
    const result = stripPickupCodeDeep({
      pickup_code: 'SECRET',
      ref: 'P-1',
      nested: { pickup_code: 'SECRET2', label: 'x' },
    });
    expect(result).toEqual({ ref: 'P-1', nested: { label: 'x' } });
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('getAgentRelaisId', () => {
  it('agent trouvé avec relais_id -> renvoie relais_id', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] });
    expect(await getAgentRelaisId('user-1')).toBe('relais-1');
  });

  it('agent introuvable -> null', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getAgentRelaisId('user-1')).toBeNull();
  });

  it('agent trouvé mais relais_id null -> null', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: null }] });
    expect(await getAgentRelaisId('user-1')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('parcelBelongsToRelais', () => {
  it('colis trouvé pour le relais -> true', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    expect(await parcelBelongsToRelais('CLK-1', 'relais-1')).toBe(true);
  });

  it('colis non trouvé -> false', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    expect(await parcelBelongsToRelais('CLK-1', 'relais-1')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('sendScopedRelayKpis', () => {
  it('agrège les KPI et groupe par île, "Inconnu" si île null, plusieurs statuts pour la même île', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ total: 10, draft: 1, preparation: 2, shipped: 3, in_transit: 1, available: 2, collected: 1, cancelled: 0, active: 9 }] })
      .mockResolvedValueOnce({ rows: [
        { island: 'Ngazidja', status: 'shipped', count: 2 },
        { island: 'Ngazidja', status: 'in_transit', count: 1 }, // même île, 2e statut -> branche islands[island] déjà défini
        { island: null, status: 'draft', count: 1 },
      ] });

    const req = { agentRelaisId: 'relais-1' };
    const res = { json: jest.fn() };

    await sendScopedRelayKpis(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      parcels: expect.objectContaining({
        total: 10,
        by_island: {
          Ngazidja: { shipped: 2, in_transit: 1 },
          Inconnu: { draft: 1 },
        },
      }),
      scope: 'agent_relais',
    }));
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('relayAgentScopeMiddleware', () => {
  function makeReqRes({ user, method = 'GET', path = '/' }) {
    const req = { user, method, path };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    return { req, res, next };
  }

  it('rôle différent de agent_relais -> next() immédiat', async () => {
    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'admin' } });
    await relayAgentScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('req.user absent (optional chaining) -> next() immédiat', async () => {
    const { req, res, next } = makeReqRes({ user: undefined });
    await relayAgentScopeMiddleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('agent_relais sans relais_id configuré -> 403', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: null }] });
    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'agent_relais' } });

    await relayAgentScopeMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Configuration agent incomplète') }));
    expect(next).not.toHaveBeenCalled();
  });

  it('GET /kpis -> délègue à sendScopedRelayKpis et wrappe res.json', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] }) // getAgentRelaisId
      .mockResolvedValueOnce({ rows: [{ total: 0, draft: 0, preparation: 0, shipped: 0, in_transit: 0, available: 0, collected: 0, cancelled: 0, active: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'agent_relais' }, path: '/kpis' });
    const jsonMock = res.json;

    await relayAgentScopeMiddleware(req, res, next);

    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ scope: 'agent_relais' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('GET sur un chemin statique interdit (/alerts, /critical, /reconciliation) -> 403', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] });
    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'agent_relais' }, path: '/critical' });
    const jsonMock = res.json;

    await relayAgentScopeMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ scope: 'agent_relais' }));
  });

  it('GET / -> next() (liste, pas de vérif par colis)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] });
    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'agent_relais' }, path: '/' });

    await relayAgentScopeMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('chemin avec référence colis, autorisé -> next()', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] }) // getAgentRelaisId
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // parcelBelongsToRelais -> true

    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'agent_relais' }, method: 'PATCH', path: '/CLK-2026-001' });

    await relayAgentScopeMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('chemin avec référence colis, non autorisé -> 403', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] })
      .mockResolvedValueOnce({ rows: [] }); // parcelBelongsToRelais -> false

    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'agent_relais' }, method: 'PATCH', path: '/CLK-not-mine' });
    const jsonMock = res.json;

    await relayAgentScopeMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('autre relais') }));
    expect(next).not.toHaveBeenCalled();
  });

  it('res.json est bien wrappé et strip pickup_code sur la réponse finale', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] });
    const originalJson = jest.fn();
    const req = { user: { id: 'u1', role: 'agent_relais' }, method: 'GET', path: '/' };
    const res = { json: originalJson };
    const next = jest.fn();

    await relayAgentScopeMiddleware(req, res, next);

    // res.json a été remplacé par un wrapper
    res.json({ pickup_code: 'SECRET', ref: 'P-1' });
    expect(originalJson).toHaveBeenCalledWith({ ref: 'P-1' });
  });

  it('chemin ne matchant pas la regex (chaîne vide) -> pas de vérif colis, next()', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ relais_id: 'relais-1' }] });
    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'agent_relais' }, method: 'POST', path: '' });

    await relayAgentScopeMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('exception interne -> catch -> next(err)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('db down'));
    const { req, res, next } = makeReqRes({ user: { id: 'u1', role: 'agent_relais' } });

    await relayAgentScopeMiddleware(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('reconcileParcel', () => {
  it('parcel sans clients -> aucun check content/status/payment déclenché, statut ok', () => {
    const result = reconcileParcel({ status: 'shipped' });
    expect(result).toEqual({
      status: 'ok',
      checks: { content_match: true, status_sync: true, payment_sync: true, scan_sequence_ok: true, delivery_ready: true },
      issues: [],
    });
  });

  it('content_match : quantités attendues != items_count -> warning', () => {
    const parcel = {
      status: 'shipped',
      items_count: 5,
      clients: [{ orders: [{ items: [{ quantity: 2 }, { quantity: 1 }] }] }],
    };
    const result = reconcileParcel(parcel);
    expect(result.checks.content_match).toBe(false);
    expect(result.status).toBe('warning');
  });

  it('content_match : items sans quantity -> défaut 1 par item, orders/items manquants -> [] par défaut', () => {
    const parcel = {
      status: 'shipped',
      items_count: 2,
      clients: [{ orders: [{ items: [{}, {}] }] }, {}],
    };
    const result = reconcileParcel(parcel);
    expect(result.checks.content_match).toBe(true); // 2 attendus == 2 réels
  });

  it('content_match ignoré si expectedItems=0 ou actualItems=0', () => {
    const parcel = { status: 'shipped', items_count: 0, clients: [{ orders: [{ items: [{ quantity: 3 }] }] }] };
    const result = reconcileParcel(parcel);
    expect(result.checks.content_match).toBe(true);
  });

  it('status_sync : commande différente du statut colis (hors preparation/draft) -> warning', () => {
    const parcel = { status: 'shipped', clients: [{ orders: [{ status: 'delivered', reference: 'CMD-1' }] }] };
    const result = reconcileParcel(parcel);
    expect(result.checks.status_sync).toBe(false);
    expect(result.issues[0].message).toContain('CMD-1');
  });

  it('status_sync : ignoré si parcel.status est preparation ou draft, même si commande différente', () => {
    const p1 = reconcileParcel({ status: 'preparation', clients: [{ orders: [{ status: 'paid' }] }] });
    const p2 = reconcileParcel({ status: 'draft', clients: [{ orders: [{ status: 'paid' }] }] });
    expect(p1.checks.status_sync).toBe(true);
    expect(p2.checks.status_sync).toBe(true);
  });

  it('scan_sequence : séquence décroissante -> scan_sequence_ok=false, high, break après premier écart', () => {
    const parcel = { status: 'shipped', scans: [{ event_type: 'shipped' }, { event_type: 'preparation' }, { event_type: 'collected' }] };
    const result = reconcileParcel(parcel);
    expect(result.checks.scan_sequence_ok).toBe(false);
    expect(result.issues.some(i => i.severity === 'high')).toBe(true);
    expect(result.status).toBe('blocked');
  });

  it('scan_sequence : événement inconnu (?? -1) ignoré, ne casse pas la séquence', () => {
    const parcel = { status: 'shipped', scans: [{ event_type: 'preparation' }, { event_type: 'unknown_evt' }, { event_type: 'shipped' }] };
    const result = reconcileParcel(parcel);
    expect(result.checks.scan_sequence_ok).toBe(true);
  });

  it('scan_sequence : scans absents ou vides -> check non exécuté (reste true)', () => {
    expect(reconcileParcel({ status: 'shipped', scans: [] }).checks.scan_sequence_ok).toBe(true);
    expect(reconcileParcel({ status: 'shipped' }).checks.scan_sequence_ok).toBe(true);
  });

  it('payment_sync : cash_relais non payé -> critical, statut blocked', () => {
    const parcel = { status: 'shipped', clients: [{ orders: [{ status: 'shipped', payment_mode: 'cash_relais', payment_status: 'pending', reference: 'CMD-2' }] }] };
    const result = reconcileParcel(parcel);
    expect(result.checks.payment_sync).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.issues.find(i => i.check === 'payment_sync').severity).toBe('critical');
  });

  it('payment_sync : cash_relais payé -> ok ; autre mode de paiement -> ignoré', () => {
    const parcel = {
      status: 'shipped',
      clients: [
        { orders: [{ payment_mode: 'cash_relais', payment_status: 'paid' }] },
        { orders: [{ payment_mode: 'stripe_eur', payment_status: 'pending' }] },
      ],
    };
    const result = reconcileParcel(parcel);
    expect(result.checks.payment_sync).toBe(true);
  });

  it('delivery_ready : status available avec incident ouvert critique -> false, blocked', () => {
    const parcel = { status: 'available', incidents: [{ status: 'open', severity: 'critical' }] };
    const result = reconcileParcel(parcel);
    expect(result.checks.delivery_ready).toBe(false);
    expect(result.status).toBe('blocked');
  });

  it('delivery_ready : status available sans incident critique ouvert -> true', () => {
    const parcel = { status: 'available', incidents: [{ status: 'resolved', severity: 'critical' }, { status: 'open', severity: 'low' }] };
    expect(reconcileParcel(parcel).checks.delivery_ready).toBe(true);
  });

  it('delivery_ready non évalué si status != available', () => {
    expect(reconcileParcel({ status: 'shipped', incidents: [{ status: 'open', severity: 'critical' }] }).checks.delivery_ready).toBe(true);
  });

  it('uniquement des warnings (pas de blocking) -> statut warning', () => {
    const parcel = { status: 'shipped', clients: [{ orders: [{ status: 'delivered', reference: 'CMD-3' }] }] };
    expect(reconcileParcel(parcel).status).toBe('warning');
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('computeParcelAlerts', () => {
  const NOW = new Date('2026-07-01T12:00:00Z');
  let realDate;

  beforeEach(() => {
    realDate = global.Date;
    global.Date = class extends realDate {
      constructor(...args) {
        if (args.length === 0) return new realDate(NOW);
        return new realDate(...args);
      }
    };
  });

  afterEach(() => {
    global.Date = realDate;
  });

  it('preparation dans les temps -> pas d\'alerte', () => {
    const created = new Date(NOW.getTime() - 10 * 3_600_000).toISOString();
    expect(computeParcelAlerts({ status: 'preparation', created_at: created })).toEqual([]);
  });

  it('preparation dépasse le SLA (48h) -> alerte warning', () => {
    const created = new Date(NOW.getTime() - 50 * 3_600_000).toISOString();
    const alerts = computeParcelAlerts({ status: 'preparation', created_at: created, reference: 'P-1' });
    expect(alerts).toEqual([expect.objectContaining({ type: 'stuck_preparation', severity: 'warning', parcel_ref: 'P-1' })]);
  });

  it('created_at absent -> hoursSince=Infinity -> toujours en alerte', () => {
    const alerts = computeParcelAlerts({ status: 'preparation' });
    expect(alerts[0].type).toBe('stuck_preparation');
  });

  it('in_transit dépasse le SLA (120h) -> alerte critical, utilise shipped_at', () => {
    const shipped = new Date(NOW.getTime() - 130 * 3_600_000).toISOString();
    const alerts = computeParcelAlerts({ status: 'in_transit', shipped_at: shipped, reference: 'P-2' });
    expect(alerts).toEqual([expect.objectContaining({ type: 'sla_breach_transit', severity: 'critical' })]);
  });

  it('in_transit : shipped_at absent -> fallback in_transit_at', () => {
    const inTransit = new Date(NOW.getTime() - 130 * 3_600_000).toISOString();
    const alerts = computeParcelAlerts({ status: 'in_transit', in_transit_at: inTransit });
    expect(alerts[0].type).toBe('sla_breach_transit');
  });

  it('in_transit dans les temps -> pas d\'alerte', () => {
    const shipped = new Date(NOW.getTime() - 10 * 3_600_000).toISOString();
    expect(computeParcelAlerts({ status: 'in_transit', shipped_at: shipped })).toEqual([]);
  });

  it('available dépasse le seuil critique (168h) -> uncollected_critical', () => {
    const available = new Date(NOW.getTime() - 200 * 3_600_000).toISOString();
    const alerts = computeParcelAlerts({ status: 'available', available_at: available });
    expect(alerts[0].type).toBe('uncollected_critical');
    expect(alerts[0].severity).toBe('critical');
  });

  it('available dépasse le seuil warning (72h) mais pas critique -> uncollected_warning', () => {
    const available = new Date(NOW.getTime() - 100 * 3_600_000).toISOString();
    const alerts = computeParcelAlerts({ status: 'available', available_at: available });
    expect(alerts[0].type).toBe('uncollected_warning');
    expect(alerts[0].severity).toBe('warning');
  });

  it('available dans les temps -> pas d\'alerte', () => {
    const available = new Date(NOW.getTime() - 10 * 3_600_000).toISOString();
    expect(computeParcelAlerts({ status: 'available', available_at: available })).toEqual([]);
  });

  it('statut hors preparation/in_transit/available -> pas d\'alerte SLA', () => {
    expect(computeParcelAlerts({ status: 'collected' })).toEqual([]);
  });

  it('open_incidents > 0 avec critical_incidents > 0 -> alerte critical avec mention "dont critique(s)"', () => {
    const alerts = computeParcelAlerts({ status: 'collected', open_incidents: 2, critical_incidents: 1, reference: 'P-3' });
    expect(alerts).toEqual([expect.objectContaining({ type: 'open_incident', severity: 'critical' })]);
    expect(alerts[0].message).toContain('dont critique(s)');
  });

  it('open_incidents > 0 sans critical_incidents -> alerte warning, pas de mention critique', () => {
    const alerts = computeParcelAlerts({ status: 'collected', open_incidents: 1, critical_incidents: 0 });
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].message).not.toContain('dont critique(s)');
  });

  it('open_incidents=0 -> pas d\'alerte incident', () => {
    expect(computeParcelAlerts({ status: 'collected', open_incidents: 0 })).toEqual([]);
  });

  it('cumule alerte SLA + alerte incident sur le même colis', () => {
    const created = new Date(NOW.getTime() - 50 * 3_600_000).toISOString();
    const alerts = computeParcelAlerts({ status: 'preparation', created_at: created, open_incidents: 1 });
    expect(alerts).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('checkScanSequence', () => {
  it('séquence null/undefined/vide -> true', () => {
    expect(checkScanSequence(null)).toBe(true);
    expect(checkScanSequence(undefined)).toBe(true);
    expect(checkScanSequence([])).toBe(true);
  });

  it('séquence croissante -> true', () => {
    expect(checkScanSequence(['preparation', 'shipped', 'in_transit', 'available', 'collected'])).toBe(true);
  });

  it('séquence décroissante -> false', () => {
    expect(checkScanSequence(['shipped', 'preparation'])).toBe(false);
  });

  it('événement inconnu (idx=-1 via ??) ignoré, n\'affecte pas "last"', () => {
    expect(checkScanSequence(['preparation', 'unknown', 'shipped'])).toBe(true);
  });

  it('même événement répété (idx === last) -> true (pas de régression)', () => {
    expect(checkScanSequence(['shipped', 'shipped'])).toBe(true);
  });
});
