'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));

jest.mock('../../utils/parcels', () => ({
  computeOrderStatus: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const pool = require('../../db');
const { computeOrderStatus } = require('../../utils/parcels');
const {
  reconcileOrder,
  reconcileParcel,
  reconcileAll,
  getReconciliationStats,
} = require('../../services/reconciliation-service');

function makeOrder(overrides = {}) {
  return { id: 'order-001', reference: 'CMD-001', status: 'shipped', payment_status: 'paid', ...overrides };
}

function makeParcel(overrides = {}) {
  return { id: 'parcel-001', order_id: 'order-001', reference: 'COLIS-001', status: 'shipped', created_at: new Date().toISOString(), ...overrides };
}

function makeOrderItem(overrides = {}) {
  return { id: 'oi-001', order_id: 'order-001', product_id: 'product-001', qty_ordered: 1, quantity: 1, ...overrides };
}

function makeParcelItem(overrides = {}) {
  return {
    id: 'pi-001', parcel_id: 'parcel-001', order_item_id: 'oi-001', qty_allocated: 1,
    qty_packed: 1, qty_shipped: 1, qty_received: 0, qty_collected: 0,
    ...overrides,
  };
}

describe('reconciliation-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    computeOrderStatus.mockReset();
  });

  describe('reconcileOrder', () => {
    it('retourne ok=true quand allocations, scans et statut commande sont coherents', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem()] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem()] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result).toEqual(expect.objectContaining({
        ok: true,
        order_id: 'order-001',
        order_ref: 'CMD-001',
        total_checks: 6,
        issues_found: 0,
        issues: [],
      }));
      expect(computeOrderStatus).toHaveBeenCalledWith([expect.objectContaining({ id: 'parcel-001' })]);
      expectTransactionCommitted(client);
    });

    it('cree un incident si une allocation depasse la quantite commandee', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem({ qty_ordered: 1, quantity: 1 })] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 2, qty_packed: 1, qty_shipped: 1 })] },
        { rows: [] },
        { rows: [{ id: 'incident-001' }] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.ok).toBe(false);
      expect(result.issues_found).toBe(1);
      expect(result.issues[0]).toEqual(expect.objectContaining({ type: 'over_allocation', severity: 'high' }));
      expect(client.calls.some(c => String(c.sql).includes('INSERT INTO incidents'))).toBe(true);
      expectTransactionCommitted(client);
    });

    it('retourne ok=false, error si la commande est introuvable', async () => {
      const client = makeClient([{ rows: [] }]);
      pool.connect.mockResolvedValue(client);

      const result = await reconcileOrder('order-missing');

      expect(result).toEqual({ ok: false, error: 'Commande introuvable', issues: [] });
    });

    it('detecte une rupture de chaine de quantites (quantity_chain_break)', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [] }, // pas d'order_items → CHECK1/6 sans effet
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 1, qty_packed: 2 })] }, // packed > allocated
        { rows: [] },              // existing (dedup)
        { rows: [{ id: 'inc-1' }] }, // insert
        { rows: [{ event_type: 'shipped', created_at: now }] }, // CHECK3 lastScan
        { rows: [{ last_at: now }] }, // CHECK5 lastActivity
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.ok).toBe(false);
      expect(result.issues.some(i => i.type === 'quantity_chain_break')).toBe(true);
    });

    it('detecte un statut colis incoherent avec le dernier scan (status_scan_mismatch)', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem({ qty_ordered: 1, quantity: 1 })] },
        { rows: [makeParcel({ status: 'preparation', created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 1 })] },
        { rows: [{ event_type: 'shipped', created_at: now }] }, // scan dit 'shipped' mais parcel.status='preparation'
        { rows: [] },               // existing
        { rows: [{ id: 'inc-2' }] }, // insert
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped'); // aligné sur order.status → pas de drift parasite

      const result = await reconcileOrder('order-001');

      expect(result.issues.some(i => i.type === 'status_scan_mismatch')).toBe(true);
    });

    it('ignore le check status_scan_mismatch si aucun scan applique trouve', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem({ qty_ordered: 1, quantity: 1 })] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 1 })] },
        { rows: [] },  // pas de lastScan
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.issues.some(i => i.type === 'status_scan_mismatch')).toBe(false);
    });

    it('detecte un drift de statut commande vs colis (order_status_drift)', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder({ status: 'shipped' })] },
        { rows: [makeOrderItem({ qty_ordered: 1, quantity: 1 })] },
        { rows: [makeParcel({ status: 'shipped', created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 1 })] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [] },                // existing
        { rows: [{ id: 'inc-3' }] }, // insert
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('delivered'); // différent du statut commande

      const result = await reconcileOrder('order-001');

      const drift = result.issues.find(i => i.type === 'order_status_drift');
      expect(drift).toBeDefined();
      expect(drift.details.current_status).toBe('shipped');
      expect(drift.details.computed_status).toBe('delivered');
      expect(drift.auto_corrected).toBe(false);
      expect(drift.logged_only).toBe(true);
    });

    it('detecte un colis bloque depuis >=7 jours (stale_parcel, severity medium)', async () => {
      const oldDate = new Date(Date.now() - 8 * 86400000).toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [] },
        { rows: [makeParcel({ created_at: oldDate })] },
        { rows: [] },
        { rows: [] },                     // lastScan
        { rows: [{ last_at: oldDate }] }, // lastActivity ancienne
        { rows: [] },                     // existing
        { rows: [{ id: 'inc-4' }] },      // insert
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      const stale = result.issues.find(i => i.type === 'stale_parcel');
      expect(stale).toBeDefined();
      expect(stale.severity).toBe('medium');
    });

    it('escalade en severity high si colis bloque depuis >=14 jours', async () => {
      const oldDate = new Date(Date.now() - 15 * 86400000).toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [] },
        { rows: [makeParcel({ created_at: oldDate })] },
        { rows: [] },
        { rows: [] },
        { rows: [{ last_at: oldDate }] },
        { rows: [] },
        { rows: [{ id: 'inc-5' }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      const stale = result.issues.find(i => i.type === 'stale_parcel');
      expect(stale.severity).toBe('high');
    });

    it('ignore le check stale_parcel pour les colis collected/cancelled', async () => {
      const oldDate = new Date(Date.now() - 30 * 86400000).toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [] },
        { rows: [makeParcel({ status: 'collected', created_at: oldDate })] },
        { rows: [] },
        { rows: [] }, // CHECK3 lastScan
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.issues.some(i => i.type === 'stale_parcel')).toBe(false);
    });

    it('detecte un article non alloue a aucun colis (unallocated_item)', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem({ qty_ordered: 1, quantity: 1 })] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [] }, // aucun parcel_item → allocated=0, parcels.length>0
        { rows: [] }, // lastScan
        { rows: [{ last_at: now }] },
        { rows: [] },               // existing
        { rows: [{ id: 'inc-6' }] }, // insert
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.issues.some(i => i.type === 'unallocated_item')).toBe(true);
    });

    it('detecte une allocation partielle sans creer d\'incident (partial_allocation)', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem({ qty_ordered: 3, quantity: 3 })] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 1 })] },
        { rows: [] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      const partial = result.issues.find(i => i.type === 'partial_allocation');
      expect(partial).toBeDefined();
      expect(partial.details.remaining).toBe(2);
      // Pas d'incident créé pour une allocation partielle → aucun INSERT INTO incidents
      expect(client.calls.some(c => String(c.sql).includes('INSERT INTO incidents'))).toBe(false);
    });

    it('ne recree pas un incident si un incident ouvert identique existe deja (dedup)', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem({ qty_ordered: 1, quantity: 1 })] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 2 })] }, // over-allocation
        { rows: [{ id: 'incident-existant' }] }, // existing → pas d'INSERT
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.issues_found).toBe(1);
      expect(client.calls.some(c => String(c.sql).includes('INSERT INTO incidents'))).toBe(false);
    });

    it('rollback et propage l\'erreur si une requete echoue', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { error: new Error('db connection lost') },
      ]);
      pool.connect.mockResolvedValue(client);

      await expect(reconcileOrder('order-001')).rejects.toThrow('db connection lost');
      expectTransactionRolledBack(client);
    });

    it('ne charge pas les parcel_items si la commande n\'a aucun colis actif', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [] },
        { rows: [] }, // aucun colis → parcelIds.length===0, pas de requete parcel_items
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue(null); // pas de statut calculable

      const result = await reconcileOrder('order-001');

      expect(result.ok).toBe(true);
      expect(client.calls).toHaveLength(5); // BEGIN + order + orderItems + parcels + COMMIT (pas de parcel_items)
    });

    it('applique les valeurs de repli qty_ordered→quantity→1 quand qty_ordered est absent', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [
          makeOrderItem({ id: 'oi-A', qty_ordered: 0, quantity: 5 }),
          makeOrderItem({ id: 'oi-B', qty_ordered: 0, quantity: 0 }),
        ] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [] }, // aucune allocation
        { rows: [] },                // CHECK3 lastScan
        { rows: [{ last_at: now }] }, // CHECK5 lastActivity
        { rows: [] }, { rows: [{ id: 'inc-A' }] }, // CHECK6 oi-A: existing, insert
        { rows: [] }, { rows: [{ id: 'inc-B' }] }, // CHECK6 oi-B: existing, insert
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      const unallocA = result.issues.find(i => i.order_item_id === 'oi-A');
      const unallocB = result.issues.find(i => i.order_item_id === 'oi-B');
      expect(unallocA.details.ordered).toBe(5);  // repli sur quantity
      expect(unallocB.details.ordered).toBe(1);  // repli final sur 1
    });

    it('applique les valeurs de repli a 0 pour les champs de quantite manquants du parcel_item', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem({ qty_ordered: 2, quantity: 2 })] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [{ id: 'pi-bare', parcel_id: 'parcel-001', order_item_id: 'oi-001' }] }, // aucun champ qty_*
        { rows: [] },                // lastScan
        { rows: [{ last_at: now }] },// lastActivity
        { rows: [] }, { rows: [{ id: 'inc-C' }] }, // unallocated_item (allocated=0)
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.issues.some(i => i.type === 'unallocated_item')).toBe(true);
      expect(result.issues.some(i => i.type === 'quantity_chain_break')).toBe(false);
    });

    it('utilise parcel.created_at en repli si aucune activite de scan n\'est trouvee', async () => {
      const recentDate = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [] },
        { rows: [makeParcel({ created_at: recentDate })] },
        { rows: [] },
        { rows: [] }, // lastScan
        { rows: [] }, // lastActivity sans last_at → repli sur parcel.created_at (recent, pas de stale)
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.issues.some(i => i.type === 'stale_parcel')).toBe(false);
    });

    it('ignore le mismatch si le type de scan est inconnu (getExpectedStatuses → null)', async () => {
      const now = new Date().toISOString();
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [] },
        { rows: [{ event_type: 'evenement_inconnu', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileOrder('order-001');

      expect(result.issues.some(i => i.type === 'status_scan_mismatch')).toBe(false);
    });
  });

  describe('reconcileParcel', () => {
    it('retourne une erreur claire si le colis est introuvable', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(reconcileParcel('parcel-missing')).resolves.toEqual({ ok: false, error: 'Colis introuvable' });
    });

    it('retourne un message si le colis n\'a pas de commande associee', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'parcel-orphan', order_id: null }] });

      const result = await reconcileParcel('parcel-orphan');

      expect(result).toEqual({ ok: true, issues: [], message: 'Colis sans commande' });
    });

    it('delegue a reconcileOrder quand le colis appartient a une commande', async () => {
      const now = new Date().toISOString();
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'parcel-001', order_id: 'order-001' }] });
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [makeOrderItem()] },
        { rows: [makeParcel({ created_at: now })] },
        { rows: [makeParcelItem()] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileParcel('parcel-001');

      expect(result.ok).toBe(true);
      expect(result.order_id).toBe('order-001');
      expectTransactionCommitted(client);
    });
  });

  describe('reconcileAll', () => {
    it('traite toutes les commandes eligibles en batch', async () => {
      const now = new Date().toISOString();
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'order-001' }, { id: 'order-002' }] });
      computeOrderStatus.mockReturnValue('shipped');

      const client1 = makeClient([
        { rows: [makeOrder({ id: 'order-001', reference: 'CMD-001' })] },
        { rows: [makeOrderItem({ order_id: 'order-001' })] },
        { rows: [makeParcel({ order_id: 'order-001', created_at: now })] },
        { rows: [makeParcelItem()] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      const client2 = makeClient([
        { rows: [makeOrder({ id: 'order-002', reference: 'CMD-002' })] },
        { rows: [makeOrderItem({ id: 'oi-002', order_id: 'order-002' })] },
        { rows: [makeParcel({ id: 'parcel-002', order_id: 'order-002', created_at: now })] },
        { rows: [makeParcelItem({ id: 'pi-002', parcel_id: 'parcel-002', order_item_id: 'oi-002' })] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValueOnce(client1).mockResolvedValueOnce(client2);

      const result = await reconcileAll({ limit: 2 });

      expect(result.total).toBe(2);
      expect(result.ok).toBe(2);
      expect(result.issues).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.details).toHaveLength(2);
    });

    it('comptabilise une erreur sans interrompre le batch si une commande echoue', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'order-001' }, { id: 'order-002' }] });

      pool.connect
        .mockRejectedValueOnce(new Error('connexion echouee'))
        .mockResolvedValueOnce(makeClient([
          { rows: [makeOrder({ id: 'order-002', reference: 'CMD-002' })] },
          { rows: [] },
          { rows: [makeParcel({ id: 'parcel-002', order_id: 'order-002', created_at: new Date().toISOString() })] },
          { rows: [] },
          { rows: [] },
          { rows: [{ last_at: new Date().toISOString() }] },
        ]));
      computeOrderStatus.mockReturnValue('shipped');

      const result = await reconcileAll({ limit: 2 });

      expect(result.total).toBe(2);
      expect(result.errors).toBe(1);
      expect(result.ok).toBe(1);
      expect(result.details[0]).toEqual(expect.objectContaining({ order_id: 'order-001', ok: false, error: 'connexion echouee' }));
    });

    it('applique les options par defaut (limit=100, onlyActive=true) quand appelee sans argument', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await reconcileAll();

      expect(result.total).toBe(0);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("NOT IN ('collected', 'cancelled', 'refunded')"), [100]);
    });

    it('inclut les commandes non-actives quand onlyActive=false', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await reconcileAll({ onlyActive: false, limit: 5 });

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).not.toContain('NOT IN');
      expect(params).toEqual([5]);
    });

    it('comptabilise une commande avec issues (result.ok=false) sans l\'ajouter au compteur ok', async () => {
      const now = new Date().toISOString();
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'order-001' }] });
      computeOrderStatus.mockReturnValue('shipped');

      const client = makeClient([
        { rows: [makeOrder({ id: 'order-001', reference: 'CMD-001' })] },
        { rows: [makeOrderItem({ qty_ordered: 1, quantity: 1 })] },
        { rows: [makeParcel({ order_id: 'order-001', created_at: now })] },
        { rows: [makeParcelItem({ qty_allocated: 2 })] }, // over-allocation → ok:false
        { rows: [] }, { rows: [{ id: 'inc-batch' }] },
        { rows: [{ event_type: 'shipped', created_at: now }] },
        { rows: [{ last_at: now }] },
      ]);
      pool.connect.mockResolvedValue(client);

      const result = await reconcileAll({ limit: 1 });

      expect(result.total).toBe(1);
      expect(result.ok).toBe(0);
      expect(result.issues).toBe(1);
    });
  });

  describe('getReconciliationStats', () => {
    it('retourne les compteurs avec stale_parcels', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ open_incidents: '2', critical_incidents: '1', high_incidents: '0' }] })
        .mockResolvedValueOnce({ rows: [{ stale_parcels: '3' }] });

      const result = await getReconciliationStats();

      expect(result).toEqual(expect.objectContaining({
        open_incidents: '2',
        critical_incidents: '1',
        high_incidents: '0',
        stale_parcels: '3',
      }));
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('retombe sur stale_parcels=0 si la requete stale ne retourne aucune ligne', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ open_incidents: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await getReconciliationStats();

      expect(result.stale_parcels).toBe(0);
    });
  });
});
