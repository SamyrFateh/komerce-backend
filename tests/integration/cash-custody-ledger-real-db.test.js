'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * Feature propriétaire : payments (grand livre de garde cash, migration 287, PR 3).
 * Preuve PostgreSQL réelle des invariants J1–J8 : remises partielles/groupées, refus du
 * double comptage (service ET SQL brut), concurrence, conservation, immutabilité,
 * append-only, Market (J6), résurrection d'une remise contestée, non-régression #2424/#2425.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('CASH CUSTODY LEDGER — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const deposits = require('../../services/cash-deposit-service');
  const { checkCashRemittanceUnproven } = require('../../services/radar-alerts/cash-reconciliation-signals');

  const tag = crypto.randomBytes(4).toString('hex');
  const q = (sql, p) => db.query(sql, p);
  const ids = { m1: null, m2: null, r1: null, r2: null, agent: null, agent2: null, admin: null, collections: [], orders: [] };

  async function newMarket(code) {
    const { rows: [m] } = await q(
      `INSERT INTO markets(code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,'KMF',0,true,'ACTIVE') RETURNING id`,
      [code.slice(0, 8).toUpperCase(), `Marché ${code}`]
    );
    return m.id;
  }
  async function newRelais(marketId) {
    const { rows: [r] } = await q(`INSERT INTO relais(name,phone,address,market_id) VALUES ($1,'+2370000000','Adresse test',$2) RETURNING id`, [`Relais ${tag}`, marketId]);
    return r.id;
  }
  async function newUser(role, relaisId = null) {
    const { rows: [u] } = await q(
      `INSERT INTO users(full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`T ${role} ${tag}`, `${role}.${tag}.${crypto.randomBytes(3).toString('hex')}@ledger.test`, `+2370${Math.floor(Math.random() * 9e7 + 1e7)}`, role, relaisId]
    );
    return u.id;
  }
  async function addCollection(agent, relais, market, amount, days) {
    const { rows: [o] } = await q(
      `INSERT INTO orders(reference,relais_id,total_kmf,payment_mode,market_id,status) VALUES ($1,$2,$3,'cash_relais',$4,'collected') RETURNING id`,
      [`LED-${tag}-${crypto.randomBytes(3).toString('hex')}`, relais, amount, market]
    );
    ids.orders.push(o.id);
    const { rows: [c] } = await q(
      `INSERT INTO cash_collections(order_id,amount_kmf,collected_by,relais_id,confirmed_at) VALUES ($1,$2,$3,$4,NOW()-($5*INTERVAL '1 day')) RETURNING id`,
      [o.id, amount, agent, relais, days]
    );
    ids.collections.push(c.id);
    return c.id;
  }
  const deposit = (agentId, amount, extra = {}) => deposits.createDeposit({ agentId, payload: {
    amount_kmf: amount, deposit_method: 'bank', period_start: '2026-01-01', period_end: '2026-12-31', ...extra,
  } });
  const lines = async depositId => (await q(
    `SELECT a.collection_id, a.amount_kmf::int AS kmf, a.allocation_basis, a.allocation_source
       FROM cash_deposit_allocations a JOIN cash_collections cc ON cc.id = a.collection_id
      WHERE a.deposit_id = $1 ORDER BY cc.confirmed_at`, [depositId])).rows;
  const liveOn = async collectionId => Number((await q(
    `SELECT COALESCE(SUM(a.amount_kmf),0) AS s FROM cash_deposit_allocations a JOIN cash_deposits d ON d.id=a.deposit_id
      WHERE a.collection_id=$1 AND d.status IN ('pending','verified')`, [collectionId])).rows[0].s);
  const uncovered = async agent => (await q(
    `WITH ${deposits.UNCOVERED_COLLECTIONS_CTE}
     SELECT COALESCE(SUM(uncovered_kmf),0)::int AS kmf, COUNT(*)::int AS n FROM uncovered WHERE collected_by = $1`, [agent])).rows[0];
  const sqlFails = async (sql, params, re) => {
    await expect(q(sql, params)).rejects.toThrow(re);
  };

  beforeAll(async () => {
    ids.m1 = await newMarket(`L1${tag}`);
    ids.m2 = await newMarket(`L2${tag}`);
    ids.r1 = await newRelais(ids.m1);
    ids.r2 = await newRelais(ids.m2);
    ids.agent = await newUser('agent_relais', ids.r1);
    ids.agent2 = await newUser('agent_relais', ids.r2);
    ids.admin = await newUser('admin');
  });

  afterAll(async () => {
    try {
      await q('ALTER TABLE cash_deposit_allocations DISABLE TRIGGER trg_prevent_cash_alloc_delete');
      await q('ALTER TABLE cash_deposits DISABLE TRIGGER trg_prevent_cash_deposits_delete');
      try {
        const agents = [ids.agent, ids.agent2, ids.admin, ...(ids.extra || [])];
        await q('DELETE FROM cash_deposit_allocations WHERE deposit_id IN (SELECT id FROM cash_deposits WHERE agent_id = ANY($1::uuid[]))', [agents]);
        await q('DELETE FROM cash_deposits WHERE agent_id = ANY($1::uuid[])', [agents]);
      } finally {
        await q('ALTER TABLE cash_deposits ENABLE TRIGGER trg_prevent_cash_deposits_delete');
        await q('ALTER TABLE cash_deposit_allocations ENABLE TRIGGER trg_prevent_cash_alloc_delete');
      }
      await q('DELETE FROM cash_collections WHERE id = ANY($1::uuid[])', [ids.collections]);
      await q('DELETE FROM orders WHERE id = ANY($1::uuid[])', [ids.orders]);
      await q('DELETE FROM market_delegation_audit WHERE actor_user_id = $1', [ids.admin]);
      await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ids.agent, ids.agent2, ids.admin, ...(ids.extra || [])]]);
      await q('DELETE FROM relais WHERE id = ANY($1::uuid[])', [[ids.r1, ids.r2]]);
      await q('DELETE FROM markets WHERE id = ANY($1::uuid[])', [[ids.m1, ids.m2]]);
    } finally {
      await db.end?.();
    }
  });

  describe('grand livre de garde cash (real DB)', () => {
    let c1; let c2; let c3;

    it('Market de la remise dérivé par la base (J6), jamais fourni librement', async () => {
      c1 = await addCollection(ids.agent, ids.r1, ids.m1, 50000, 10);
      c2 = await addCollection(ids.agent, ids.r1, ids.m1, 50000, 9);
      c3 = await addCollection(ids.agent, ids.r1, ids.m1, 50000, 8);
      const d = await deposit(ids.agent, 1000);
      expect(d.market_id).toBe(ids.m1);
      expect(d.market_id_source).toBe('DERIVED_RELAIS');
      expect(d.movement_kind).toBe('LEGACY');
      await sqlFails(
        `INSERT INTO cash_deposits(agent_id,amount_kmf,deposit_method,period_start,period_end,market_id) VALUES ($1,5,'bank','2026-01-01','2026-01-02',$2)`,
        [ids.agent, ids.m2], /incohérent avec le Market/
      );
    });

    it('remise partielle puis groupée : FIFO reconstruit, Σ ≤ encaissement, surplus jamais alloué', async () => {
      const a = await deposit(ids.agent, 70000, { reference: `P1-${tag}` });          // c1 50 000 + c2 20 000 (1 000 déjà pris sur c1 par le test précédent)
      const la = await lines(a.id);
      expect(la.reduce((s, l) => s + l.kmf, 0)).toBe(70000);
      expect(la.every(l => l.allocation_basis === 'RECONSTRUCTED' && l.allocation_source === 'SERVER_FIFO')).toBe(true);
      const b = await deposit(ids.agent, 500000, { reference: `P2-${tag}` });         // groupée avec écart : le surplus n'est PAS alloué
      const lb = await lines(b.id);
      expect(lb.reduce((s, l) => s + l.kmf, 0)).toBe(150000 - 1000 - 70000);
      expect(lb.reduce((s, l) => s + l.kmf, 0)).toBeLessThan(500000);
      for (const c of [c1, c2, c3]) expect(await liveOn(c)).toBeLessThanOrEqual(50000);
      expect(await liveOn(c1) + await liveOn(c2) + await liveOn(c3)).toBe(150000);   // conservation stricte
    });

    it('double allocation refusée en SQL brut (J1/J2) et en dehors du service', async () => {
      const spare = await deposit(ids.agent, 10);                                     // tout est déjà couvert : 0 ligne
      expect(await lines(spare.id)).toEqual([]);
      await sqlFails(
        `INSERT INTO cash_deposit_allocations(deposit_id,collection_id,market_id,amount_kmf,allocation_source) VALUES ($1,$2,$3,10,'SERVER_FIFO')`,
        [spare.id, c3, ids.m1], /double comptage/
      );
      const { rows: [{ id: first }] } = await q(`SELECT id FROM cash_deposits WHERE agent_id=$1 AND reference=$2`, [ids.agent, `P1-${tag}`]);
      await sqlFails(
        `INSERT INTO cash_deposit_allocations(deposit_id,collection_id,market_id,amount_kmf,allocation_source)
         SELECT deposit_id,collection_id,market_id,amount_kmf,'SERVER_FIFO' FROM cash_deposit_allocations WHERE deposit_id=$1 LIMIT 1`,
        [first], /duplicate key|unique/i
      );
    });

    it('Σ allocations d\'une remise ≤ son montant (J2)', async () => {
      const agent = await newUser('agent_relais', ids.r1);
      const col = await addCollection(agent, ids.r1, ids.m1, 10000, 3);
      const { rows: [d] } = await q(`INSERT INTO cash_deposits(agent_id,amount_kmf,deposit_method,period_start,period_end) VALUES ($1,4000,'bank','2026-01-01','2026-01-02') RETURNING id`, [agent]);
      await sqlFails(
        `INSERT INTO cash_deposit_allocations(deposit_id,collection_id,market_id,amount_kmf,allocation_source) VALUES ($1,$2,$3,4001,'SERVER_FIFO')`,
        [d.id, col, ids.m1], /remise/
      );
      ids.extra = [...(ids.extra || []), agent];
    });

    it('J6 : jamais d\'allocation inter-Market ni inter-agent', async () => {
      const col2 = await addCollection(ids.agent2, ids.r2, ids.m2, 20000, 5);
      const d = await deposit(ids.agent, 5, { reference: `X1-${tag}` });
      await sqlFails(
        `INSERT INTO cash_deposit_allocations(deposit_id,collection_id,market_id,amount_kmf,allocation_source) VALUES ($1,$2,$3,5,'SERVER_FIFO')`,
        [d.id, col2, ids.m1], /Market incohérent/
      );
      const d2 = await deposit(ids.agent2, 20000, { reference: `X2-${tag}` });
      expect((await lines(d2.id)).map(l => l.collection_id)).toEqual([col2]);        // Market 2 alloue dans Market 2 seulement
      const colSame = await addCollection(ids.agent2, ids.r2, ids.m2, 1000, 1);
      await sqlFails(
        `INSERT INTO cash_deposit_allocations(deposit_id,collection_id,market_id,amount_kmf,allocation_source) VALUES ($1,$2,$3,5,'SERVER_FIFO')`,
        [d.id, colSame, ids.m2], /Market incohérent|n'appartient pas/
      );
    });

    it('concurrence : deux remises simultanées de l\'agent ne sur-couvrent jamais un encaissement', async () => {
      const agent = await newUser('agent_relais', ids.r1);
      ids.extra = [...(ids.extra || []), agent];
      const cc = await addCollection(agent, ids.r1, ids.m1, 100000, 2);
      const mk = () => q(`INSERT INTO cash_deposits(agent_id,amount_kmf,deposit_method,period_start,period_end) VALUES ($1,100000,'bank','2026-01-01','2026-01-02') RETURNING id`, [agent]).then(r => r.rows[0].id);
      const [d1, d2] = [await mk(), await mk()];
      await Promise.all([
        q('SELECT cash_allocate_fifo($1,$2)', [d1, 'SERVER_FIFO']),
        q('SELECT cash_allocate_fifo($1,$2)', [d2, 'SERVER_FIFO']),
      ]);
      expect(await liveOn(cc)).toBe(100000);                                          // un seul a pris la place
      // SQL brut concurrent (sans verrou applicatif) : le trigger sérialise et refuse le second
      const cc2 = await addCollection(agent, ids.r1, ids.m1, 100000, 1);
      const [d3, d4] = [await mk(), await mk()];
      const ins = d => q(`INSERT INTO cash_deposit_allocations(deposit_id,collection_id,market_id,amount_kmf,allocation_source) VALUES ($1,$2,$3,100000,'SERVER_FIFO')`, [d, cc2, ids.m1]);
      const settled = await Promise.allSettled([ins(d3), ins(d4)]);
      expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter(s => s.status === 'rejected')).toHaveLength(1);
      expect(await liveOn(cc2)).toBe(100000);
    });

    it('J3/J4 : montant et agent immuables, remises et allocations non supprimables, allocations append-only', async () => {
      const { rows: [d] } = await q(`SELECT id FROM cash_deposits WHERE agent_id=$1 AND reference=$2`, [ids.agent, `P1-${tag}`]);
      await sqlFails(`UPDATE cash_deposits SET amount_kmf = 1 WHERE id=$1`, [d.id], /immuables/);
      await sqlFails(`UPDATE cash_deposits SET agent_id = $2 WHERE id=$1`, [d.id, ids.agent2], /immuables/);
      await sqlFails(`UPDATE cash_deposits SET declared_currency = 'XAF' WHERE id=$1`, [d.id], /immuables|snapshot/);
      await sqlFails(`UPDATE cash_deposits SET market_id = $2 WHERE id=$1`, [d.id, ids.m2], /immuables/);
      await sqlFails(`DELETE FROM cash_deposits WHERE id=$1`, [d.id], /append-only/);
      await sqlFails(`DELETE FROM cash_deposit_allocations WHERE deposit_id=$1`, [d.id], /append-only/);
      await sqlFails(`UPDATE cash_deposit_allocations SET amount_kmf = 1 WHERE deposit_id=$1`, [d.id], /append-only/);
      await sqlFails(`UPDATE cash_deposits SET movement_kind='FINAL' WHERE id=$1`, [d.id], /immuables/);
      await sqlFails(`INSERT INTO cash_deposits(agent_id,amount_kmf,deposit_method,period_start,period_end,movement_kind) VALUES ($1,5,'bank','2026-01-01','2026-01-02','TRANSFER')`, [ids.agent], /pr3_only_legacy/);
    });

    it('J5 : statut jamais ramené à pending ; réactivation d\'une remise contestée revérifie le double comptage', async () => {
      const agent = await newUser('agent_relais', ids.r1);
      ids.extra = [...(ids.extra || []), agent];
      const col = await addCollection(agent, ids.r1, ids.m1, 30000, 1);
      const a = await deposit(agent, 30000, { reference: `R1-${tag}` });
      expect(await liveOn(col)).toBe(30000);
      await deposits.disputeDeposit({ depositId: a.id, verifierId: ids.admin, reason: 'preuve manquante' });
      expect(await liveOn(col)).toBe(0);                                              // contestée : réservation libérée
      const b = await deposit(agent, 30000, { reference: `R2-${tag}` });              // prend la place
      expect(await liveOn(col)).toBe(30000);
      await expect(deposits.verifyDeposit({ depositId: a.id, verifierId: ids.admin, notes: 'finalement ok' }))
        .rejects.toThrow(/double comptage/);                                          // pas de résurrection qui double-compte
      await sqlFails(`UPDATE cash_deposits SET status='pending' WHERE id=$1`, [a.id], /retour à pending/);
      const { rows: [{ status }] } = await q('SELECT status FROM cash_deposits WHERE id=$1', [a.id]);
      expect(status).toBe('disputed');
      await deposits.disputeDeposit({ depositId: b.id, verifierId: ids.admin, reason: 'libère' });
      await deposits.verifyDeposit({ depositId: a.id, verifierId: ids.admin, notes: 'ok maintenant' });   // place libre : autorisé
      expect(await liveOn(col)).toBe(30000);
    });

    it('#2425/#2424 : seule une remise VÉRIFIÉE couvre ; correction centrale retire la couverture ; alerte provisoire explicite', async () => {
      const agent = await newUser('agent_relais', ids.r1);
      ids.extra = [...(ids.extra || []), agent];
      await addCollection(agent, ids.r1, ids.m1, 60000, 4);
      await addCollection(agent, ids.r1, ids.m1, 40000, 3);
      const d = await deposit(agent, 70000, { reference: `V1-${tag}` });
      expect(await uncovered(agent)).toEqual({ kmf: 100000, n: 2 });                  // pending réserve mais ne couvre pas
      await deposits.verifyDeposit({ depositId: d.id, verifierId: ids.admin, notes: 'reçu' });
      expect(await uncovered(agent)).toEqual({ kmf: 30000, n: 1 });                   // 60 000 + 10 000 couverts, reliquat 30 000 exact
      const alert = await checkCashRemittanceUnproven(db);
      expect(alert).toMatchObject({ code: 'CASH_REMITTANCE_UNPROVEN', level: 'signal' });
      expect(alert.value_kmf).toBeGreaterThanOrEqual(70000);
      await deposits.disputeDeposit({ depositId: d.id, verifierId: ids.admin, reason: 'preuve invalide', correction: true, central: true });
      expect(await uncovered(agent)).toEqual({ kmf: 100000, n: 2 });
    });

    it('backfill historique idempotent : rejouer ne crée aucune ligne et ne double-compte rien', async () => {
      const before = Number((await q('SELECT count(*) AS n FROM cash_deposit_allocations')).rows[0].n);
      const created = Number((await q('SELECT cash_ledger_backfill_legacy() AS n')).rows[0].n);
      const after = Number((await q('SELECT count(*) AS n FROM cash_deposit_allocations')).rows[0].n);
      expect(created).toBe(0);
      expect(after).toBe(before);
      const { rows: [{ n }] } = await q(`
        SELECT count(*)::int AS n FROM (
          SELECT a.collection_id FROM cash_deposit_allocations a
            JOIN cash_deposits d ON d.id = a.deposit_id JOIN cash_collections cc ON cc.id = a.collection_id
           WHERE d.status IN ('pending','verified') GROUP BY a.collection_id, cc.amount_kmf
          HAVING SUM(a.amount_kmf) > cc.amount_kmf) x`);
      expect(n).toBe(0);
    });

    it('backfill de remises historiques artificielles : reconstruit (jamais confirmé), vivantes d\'abord, contestée sur le reste, surplus non alloué', async () => {
      const agent = await newUser('agent_relais', ids.r1);
      ids.extra = [...(ids.extra || []), agent];
      const k1 = await addCollection(agent, ids.r1, ids.m1, 50000, 9);
      const k2 = await addCollection(agent, ids.r1, ids.m1, 50000, 8);
      // remises « d'avant 287 » : market_id_source NULL (le trigger de dérivation est neutralisé le temps de l'insertion)
      await q('ALTER TABLE cash_deposits DISABLE TRIGGER trg_cash_deposits_derive_market');
      let dis; let ver; let pen;
      try {
        const ins = async (amt, status, days) => (await q(
          `INSERT INTO cash_deposits(agent_id,amount_kmf,deposit_method,period_start,period_end,status,deposited_at)
           VALUES ($1,$2,'bank','2026-01-01','2026-01-02',$3,NOW()-($4*INTERVAL '1 day')) RETURNING id`, [agent, amt, status, days])).rows[0].id;
        dis = await ins(80000, 'disputed', 7);   // la plus ancienne, mais contestée : passe APRÈS les vivantes
        ver = await ins(60000, 'verified', 5);
        pen = await ins(30000, 'pending', 4);
      } finally {
        await q('ALTER TABLE cash_deposits ENABLE TRIGGER trg_cash_deposits_derive_market');
      }
      const created = Number((await q('SELECT cash_ledger_backfill_legacy() AS n')).rows[0].n);
      expect(created).toBeGreaterThan(0);
      const sum = async id => (await lines(id)).reduce((t, l) => t + l.kmf, 0);
      expect(await sum(ver)).toBe(60000);
      expect(await sum(pen)).toBe(30000);
      expect(await sum(dis)).toBe(10000);                 // 100 000 − 90 000 vivants : jamais sur-alloué
      expect((await lines(ver)).every(l => l.allocation_basis === 'RECONSTRUCTED' && l.allocation_source === 'LEGACY_BACKFILL')).toBe(true);
      expect(await liveOn(k1) + await liveOn(k2)).toBe(90000);
      // LEGACY vérifié ≠ agent déchargé : couverture provisoire uniquement (alerte explicite), reliquat visible
      expect(await uncovered(agent)).toEqual({ kmf: 40000, n: 1 });
      expect(Number((await q('SELECT cash_ledger_backfill_legacy() AS n')).rows[0].n)).toBe(0);
    });

    it('fail-closed : rejouer le fichier de migration dans une transaction échoue sans aucune écriture (rollback complet)', async () => {
      const sql = require('fs').readFileSync(require('path').join(__dirname, '../../migrations/287_cash_custody_ledger.sql'), 'utf8');
      const client = await db.getClient();
      try {
        const before = Number((await q('SELECT count(*) AS n FROM cash_deposit_allocations')).rows[0].n);
        await client.query('BEGIN');
        await expect(client.query(sql)).rejects.toThrow(/287 precondition/);
        await client.query('ROLLBACK');
        expect(Number((await q('SELECT count(*) AS n FROM cash_deposit_allocations')).rows[0].n)).toBe(before);
      } finally {
        client.release();
      }
    });

    it('agent sans relais : remise sans Market, aucune allocation, jamais bloquée', async () => {
      const d = await deposit(ids.admin, 1234, { reference: `ADM-${tag}` });
      expect(d.market_id).toBeNull();
      expect(d.market_id_source).toBe('NONE');
      expect(await lines(d.id)).toEqual([]);
    });
  });

}
