'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * Feature propriétaire : payments (couverture cash canonique, UNCOVERED_COLLECTIONS_CTE).
 * Preuve PostgreSQL réelle de l'absence de faux vert : seul un dépôt VÉRIFIÉ couvre des
 * encaissements, par conservation de montants. Un dépôt de 1 KMF contesté (ou 150 000 KMF
 * seulement pending) face à 150 000 KMF encaissés ne ferme ni l'alerte, ni l'écart.
 * Depuis la migration 287 la couverture passe par le grand livre d'allocations (par encaissement,
 * reconstruit FIFO donc provisoire) ; une validation interne n'est pas une confirmation bancaire.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('CASH COVERAGE NO FALSE GREEN — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const deposits = require('../../services/cash-deposit-service');
  const { GENERATORS } = require('../../services/signal-service');
  const { checkCashNotDeposited } = require('../../services/radar-alerts/cash-reconciliation-signals');
  const workspace = require('../../services/finance-accounting-workspace');

  const tag = crypto.randomBytes(4).toString('hex');
  const q = (sql, p) => db.query(sql, p);
  const ids = { market: null, relais: null, agent: null, admin: null, collections: [], orders: [] };
  let marketRow;

  async function newUser(role, relaisId = null) {
    const { rows: [u] } = await q(
      `INSERT INTO users(full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`T ${role} ${tag}`, `${role}.${tag}.${crypto.randomBytes(3).toString('hex')}@cashcov.test`, `+2370${Math.floor(Math.random() * 9e7 + 1e7)}`, role, relaisId]
    );
    return u.id;
  }
  async function addCollection(ref, days) {
    const { rows: [o] } = await q(
      `INSERT INTO orders(reference,relais_id,total_kmf,payment_mode,market_id,status) VALUES ($1,$2,50000,'cash_relais',$3,'collected') RETURNING id`,
      [`COV-${tag}-${ref}`, ids.relais, ids.market]
    );
    ids.orders.push(o.id);
    const { rows: [c] } = await q(
      `INSERT INTO cash_collections(order_id,amount_kmf,collected_by,relais_id,confirmed_at) VALUES ($1,50000,$2,$3,NOW()-($4*INTERVAL '1 day')) RETURNING id`,
      [o.id, ids.agent, ids.relais, days]
    );
    ids.collections.push(c.id);
  }
  const deposit = async (amount, extra = {}) => {
    const { rows: [d] } = await q(
      `INSERT INTO cash_deposits(agent_id,amount_kmf,deposit_method,period_start,period_end,reference) VALUES ($1,$2,$3,'2026-01-01','2026-12-31',$4) RETURNING *`,
      [ids.agent, amount, extra.deposit_method || 'bank', extra.reference || null]);
    await q(`SELECT cash_allocate_fifo($1,'SERVER_FIFO')`, [d.id]);
    return d;
  };
  const uncovered = async () => (await q(
    `WITH ${deposits.UNCOVERED_COLLECTIONS_CTE}
     SELECT COALESCE(SUM(uncovered_kmf),0)::int AS kmf, COUNT(*)::int AS n FROM uncovered WHERE collected_by = $1`, [ids.agent]
  )).rows[0];
  const radar = async () => Number((await checkCashNotDeposited(db, 120))?.value_kmf || 0);
  const openSignals = async () => (await q(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM((meta->>'amount_kmf')::numeric),0)::int AS kmf FROM signals
      WHERE signal_type='cash_expiring' AND status='open' AND entity_id = ANY($1::text[])`, [ids.collections.map(String)]
  )).rows[0];
  const wsGap = async () => (await workspace.buildWorkspace({ market: marketRow, from: '2026-01-01', to: '2026-12-31', hours: 48 })).reconciliation;

  beforeAll(async () => {
    const { rows: [m] } = await q(
      `INSERT INTO markets(code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,'KMF',0,true,'ACTIVE') RETURNING id, code, name, currency`,
      [`CV${tag}`.slice(0, 8).toUpperCase(), `Marché ${tag}`]
    );
    ids.market = m.id; marketRow = m;
    const { rows: [r] } = await q(`INSERT INTO relais(name,phone,address,market_id) VALUES ($1,'+2370000000','Adresse test',$2) RETURNING id`, [`Relais ${tag}`, m.id]);
    ids.relais = r.id;
    ids.agent = await newUser('agent_relais', r.id);
    ids.admin = await newUser('admin');
    await addCollection('A', 10); await addCollection('B', 9); await addCollection('C', 8);   // 150 000 KMF encaissés
  });

  afterAll(async () => {
    try {
      await q('DELETE FROM signals WHERE entity_id = ANY($1::text[])', [ids.collections.map(String)]);
      // Grand livre append-only (migration 287) : nettoyage de fixtures uniquement, triggers rétablis aussitôt.
      await q('ALTER TABLE cash_deposit_allocations DISABLE TRIGGER trg_prevent_cash_alloc_delete');
      await q('ALTER TABLE cash_deposits DISABLE TRIGGER trg_prevent_cash_deposits_delete');
      try {
        await q('DELETE FROM cash_deposit_allocations WHERE deposit_id IN (SELECT id FROM cash_deposits WHERE agent_id = ANY($1::uuid[]))', [[ids.agent]]);
        await q('DELETE FROM cash_deposits WHERE agent_id = ANY($1::uuid[])', [[ids.agent]]);
      } finally {
        await q('ALTER TABLE cash_deposits ENABLE TRIGGER trg_prevent_cash_deposits_delete');
        await q('ALTER TABLE cash_deposit_allocations ENABLE TRIGGER trg_prevent_cash_alloc_delete');
      }
      await q('DELETE FROM cash_collections WHERE id = ANY($1::uuid[])', [ids.collections]);
      await q('DELETE FROM orders WHERE id = ANY($1::uuid[])', [ids.orders]);
      await q('DELETE FROM market_delegation_audit WHERE actor_user_id = $1', [ids.admin]);
      await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ids.agent, ids.admin]]);
      await q('DELETE FROM relais WHERE id=$1', [ids.relais]);
      await q('DELETE FROM markets WHERE id=$1', [ids.market]);
    } finally {
      await db.end?.();
    }
  });

  describe('CASH coverage — pas de faux vert (real DB, autorité canonique 289)', () => {
    it('sans remise : 150 000 KMF non couverts, alerte radar, 3 signaux, détenus 150 000', async () => {
      const radarBefore = await radar();
      await GENERATORS.cash_expiring();
      expect(await uncovered()).toEqual({ kmf: 150000, n: 3 });
      expect(await openSignals()).toEqual({ n: 3, kmf: 150000 });
      expect(radarBefore).toBeGreaterThanOrEqual(150000);
      const ws = await wsGap();
      expect(ws).toMatchObject({ collected_kmf: 150000, held_kmf: 150000, closed_kmf: 0, transferred_kmf: 0 });
    });

    it('remise historique CONTESTÉE de 1 KMF : rien n\'est couvert', async () => {
      const radarBefore = await radar();
      const d = await deposit(1, { reference: `DSP-${tag}` });
      await deposits.disputeDeposit({ depositId: d.id, verifierId: ids.admin, reason: 'montant incohérent' });
      await GENERATORS.cash_expiring();
      expect(await uncovered()).toEqual({ kmf: 150000, n: 3 });
      expect(await openSignals()).toEqual({ n: 3, kmf: 150000 });
      expect(await radar()).toBe(radarBefore);
      expect((await wsGap()).held_kmf).toBe(150000);
    });

    it('remise historique pending de 150 000 : visible, JAMAIS comme couverte ni rapprochée', async () => {
      const radarBefore = await radar();
      await deposit(150000, { deposit_method: 'mobile_money', reference: `OM-${tag}` });
      await GENERATORS.cash_expiring();
      expect(await uncovered()).toEqual({ kmf: 150000, n: 3 });
      expect(await radar()).toBe(radarBefore);
      const ws = await wsGap();
      expect(ws.held_kmf).toBe(150000);
      expect(ws.closed_kmf).toBe(0);
    });

    it('remise historique VÉRIFIÉE de 150 000 : « à régulariser », ne couvre toujours rien (aucun faux vert)', async () => {
      const { rows: [transit] } = await q(`SELECT id FROM cash_deposits WHERE agent_id=$1 AND reference=$2`, [ids.agent, `OM-${tag}`]);
      await deposits.verifyDeposit({ depositId: transit.id, verifierId: ids.admin, notes: 'relevé reçu' });
      await GENERATORS.cash_expiring();
      expect(await uncovered()).toEqual({ kmf: 150000, n: 3 });
      expect(await openSignals()).toEqual({ n: 3, kmf: 150000 });
      const ws = await wsGap();
      expect(ws).toMatchObject({ held_kmf: 150000, closed_kmf: 0 });
      const { rows: [legacy] } = await q(
        `SELECT COUNT(*)::int AS n FROM cash_deposits WHERE agent_id=$1 AND movement_kind='LEGACY' AND status='verified'`, [ids.agent]);
      expect(legacy.n).toBe(1);
    });

    it('correction centrale (verified → disputed) : aucun effet sur la couverture, déjà nulle', async () => {
      const { rows: [v] } = await q(`SELECT id FROM cash_deposits WHERE agent_id=$1 AND reference=$2`, [ids.agent, `OM-${tag}`]);
      await deposits.disputeDeposit({ depositId: v.id, verifierId: ids.admin, reason: 'preuve invalide', correction: true, central: true });
      expect(await uncovered()).toEqual({ kmf: 150000, n: 3 });
    });
  });
}
