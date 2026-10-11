'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * Feature propriétaire : payments (garde des espèces, PR 4b, migration 289).
 * PostgreSQL réel : déclaration ≠ transfert, acceptation totale/partielle/refus, montant
 * annoncé ≠ reçu (devise et taux figés), plafond du receveur, solde jamais négatif (y compris
 * en concurrence), réception finale prouvée + contrôle indépendant seul clôturant, remises
 * historiques « à régulariser », pertes centrales, contre-écritures, immutabilité, séparation
 * des Markets, et contre-recette métier de bout en bout.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('CASH CUSTODY TRANSFERS — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const deposits = require('../../services/cash-deposit-service');
  const custody = require('../../services/cash-custody-service');
  const signals = require('../../services/radar-alerts/cash-reconciliation-signals');
  const { createMarketDelegationFixture, uuid } = require('../helpers/marketDelegationE2EKit');

  const tag = crypto.randomBytes(4).toString('hex');
  const q = (sql, p) => db.query(sql, p);
  let fx;
  let relaisA;
  let agent;
  let agentB;
  let relaisB;
  let bank;
  let bankB;
  const collections = [];
  const extraAgents = [];
  const orders = [];

  const rnd = () => crypto.randomBytes(3).toString('hex');

  async function newRelais(marketId) {
    const { rows: [r] } = await q(`INSERT INTO relais(name,phone,address,market_id) VALUES ($1,'+2370000000','Adresse test',$2) RETURNING id`, [`Relais ${tag}${rnd()}`, marketId]);
    return r.id;
  }
  async function newAgent(relaisId) {
    const { rows: [u] } = await q(
      `INSERT INTO users(full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,'agent_relais',$4) RETURNING id`,
      [`Agent ${tag}${rnd()}`, `agent.${tag}.${rnd()}@transfers.test`, `+2370${Math.floor(Math.random() * 9e7 + 1e7)}`, relaisId]
    );
    return u.id;
  }
  async function collect(agentId, relaisId, marketId, amount, daysAgo) {
    const { rows: [o] } = await q(
      `INSERT INTO orders(reference,relais_id,total_kmf,payment_mode,market_id,status) VALUES ($1,$2,$3,'cash_relais',$4,'collected') RETURNING id`,
      [`TRF-${tag}-${rnd()}`, relaisId, amount, marketId]
    );
    orders.push(o.id);
    const { rows: [c] } = await q(
      `INSERT INTO cash_collections(order_id,amount_kmf,collected_by,relais_id,confirmed_at) VALUES ($1,$2,$3,$4,NOW()-($5*INTERVAL '1 day')) RETURNING id`,
      [o.id, amount, agentId, relaisId, daysAgo]
    );
    collections.push(c.id);
    return c.id;
  }
  async function activeDestination(marketId, currency, proposer, activator, ref) {
    const { rows: [d] } = await q(
      `INSERT INTO market_cash_destinations(market_id,kind,label,currency,account_ref,proposed_by) VALUES ($1,'BANK',$2,$3,$4,$5) RETURNING id`,
      [marketId, `Banque ${tag}`, currency, ref, proposer]
    );
    await q(`UPDATE market_cash_destinations SET status='ACTIVE', activated_by=$2, activated_at=NOW() WHERE id=$1`, [d.id, activator]);
    return d.id;
  }
  const grant = async (membershipId, capability, limit = null) => {
    const id = uuid();
    await q(`INSERT INTO membership_capabilities(id,membership_id,capability,granted_by,limit_amount) VALUES ($1,$2,$3,$4,$5)`,
      [id, membershipId, capability, fx.central.id, limit]);
    fx.cleanup.track('membership_capabilities', 'id', id);
    return id;
  };

  const A = () => fx.marketA.id;
  const hold = (userId, marketId = A()) => custody.holdingOf(db, userId, marketId);
  const declare = (from, target, amount, extra = {}) => deposits.createDeposit({
    agentId: from, marketId: A(),
    payload: { ...target, declared_amount: amount, declared_currency: 'KMF', ...extra },
  });
  const toPerson = userId => ({ recipient_user_id: userId });
  const toBank = () => ({ destination_id: bank });
  const receive = (actor, ref, extra = {}) => custody.recordReceipt(db, {
    actorId: actor, marketId: A(), depositRef: ref, outcome: 'received', ...extra,
  });
  const refuse = (actor, ref, reason = 'Montant non conforme') => custody.recordReceipt(db, {
    actorId: actor, marketId: A(), depositRef: ref, outcome: 'refused', reason,
  });
  const control = (actor, ref, extra = {}) => custody.recordControl(db, { actorId: actor, marketId: A(), depositRef: ref, ...extra });
  const uncovered = async userId => (await q(
    `WITH ${deposits.UNCOVERED_COLLECTIONS_CTE}
     SELECT COALESCE(SUM(uncovered_kmf),0)::int AS kmf FROM uncovered WHERE collected_by = $1`, [userId])).rows[0].kmf;
  const sqlFails = async (sql, params, re) => { await expect(q(sql, params)).rejects.toThrow(re); };
  async function legacyVerified(agentId, marketId, amount) {
    const { rows: [d] } = await q(
      `INSERT INTO cash_deposits(agent_id,amount_kmf,deposit_method,period_start,period_end) VALUES ($1,$2,'bank','2026-01-01','2026-01-31') RETURNING id, deposit_ref`,
      [agentId, amount]);
    await q(`UPDATE cash_deposits SET status='verified', verified_by=$2, verified_at=NOW() WHERE id=$1`, [d.id, fx.central.id]);
    return d;
  }

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    relaisA = await newRelais(A());
    relaisB = await newRelais(fx.marketB.id);
    agent = await newAgent(relaisA);
    agentB = await newAgent(relaisB);
    // managerA : habilité (tous les LIVE du kit) ; viewerA : second habilité + contrôleur indépendant.
    await grant(fx.viewerAMembership.id, 'cash.custody.receive');
    bank = await activeDestination(A(), 'XAF', fx.managerA.id, fx.viewerA.id, `IBAN …${rnd()}`);
    bankB = await activeDestination(fx.marketB.id, 'XAF', fx.managerB.id, fx.central.id, `IBAN …${rnd()}`);
    // Nécessaire aux destinations en XAF : la banque A est en XAF, les remises finales sont déclarées en XAF.
    fx.cleanup.trackSql(
      'DELETE FROM market_delegation_audit WHERE market_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])',
      [[A(), fx.marketB.id], [agent, agentB, fx.managerA.id, fx.managerB.id, fx.viewerA.id, fx.central.id]]
    );
  });

  afterAll(async () => {
    const toggle = async (table, trigger, on) => q(`ALTER TABLE ${table} ${on ? 'ENABLE' : 'DISABLE'} TRIGGER ${trigger}`);
    const guards = [
      ['cash_custody_receipts', 'trg_prevent_cash_custody_receipts_delete'],
      ['cash_custody_losses', 'trg_prevent_cash_custody_losses_delete'],
      ['cash_deposit_allocations', 'trg_prevent_cash_alloc_delete'],
      ['cash_deposits', 'trg_prevent_cash_deposits_delete'],
      ['market_cash_destinations', 'trg_prevent_market_cash_destinations_delete'],
    ];
    try {
      for (const [t, g] of guards) await toggle(t, g, false);
      const users = [agent, agentB, ...extraAgents, fx.managerA.id, fx.managerB.id, fx.viewerA.id, fx.central.id];
      await q('DELETE FROM cash_custody_receipts WHERE deposit_id IN (SELECT id FROM cash_deposits WHERE agent_id = ANY($1::uuid[]) OR market_id = ANY($2::uuid[]))', [users, [A(), fx.marketB.id]]);
      await q('DELETE FROM cash_custody_losses WHERE market_id = ANY($1::uuid[])', [[A(), fx.marketB.id]]);
      await q('DELETE FROM cash_deposit_allocations WHERE deposit_id IN (SELECT id FROM cash_deposits WHERE agent_id = ANY($1::uuid[]))', [[agent, agentB, ...extraAgents]]);
      await q('DELETE FROM cash_deposits WHERE regularizes_deposit_id IS NOT NULL AND (market_id = ANY($1::uuid[]) OR agent_id = ANY($2::uuid[]))', [[A(), fx.marketB.id], [agent, agentB, ...extraAgents]]);
      await q('DELETE FROM cash_deposits WHERE agent_id = ANY($1::uuid[]) OR market_id = ANY($2::uuid[])', [[agent, agentB, ...extraAgents, fx.managerA.id, fx.managerB.id, fx.viewerA.id], [A(), fx.marketB.id]]);
      await q('DELETE FROM market_cash_destinations WHERE market_id = ANY($1::uuid[])', [[A(), fx.marketB.id]]);
      await q('DELETE FROM cash_collections WHERE id = ANY($1::uuid[])', [collections]);
      await q('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orders]);
      await q('DELETE FROM market_delegation_audit WHERE actor_user_id = ANY($1::uuid[])', [[agent, agentB, ...extraAgents]]);
      await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [[agent, agentB, ...extraAgents]]);
      await q('DELETE FROM relais WHERE id = ANY($1::uuid[])', [[relaisA, relaisB]]);
      await fx.cleanup.run();
    } finally {
      for (const [t, g] of guards) await toggle(t, g, true).catch(() => {});
      await db.end?.();
    }
  });

  describe('déclaration ≠ transfert ; acceptation totale, partielle, refus', () => {
    let first; let second;

    it('l\'agent détient ses encaissements ; une déclaration ne bouge aucun solde ni ne couvre quoi que ce soit', async () => {
      await collect(agent, relaisA, A(), 60000, 10);
      await collect(agent, relaisA, A(), 40000, 3);
      expect(await hold(agent)).toBe(100000);
      first = await declare(agent, toPerson(fx.managerA.id), 50000);
      expect(first).toMatchObject({ movement_kind: 'TRANSFER', status: 'pending', market_id: A() });
      expect(await hold(agent)).toBe(100000);
      expect(await hold(fx.managerA.id)).toBe(0);
      expect(await uncovered(agent)).toBe(100000);
    });

    it('la cible doit être une personne habilitée du Market OU une destination finale ACTIVE — jamais ajoutée librement', async () => {
      await expect(declare(agent, {}, 100)).rejects.toMatchObject({ code: 'deposit_target_required' });
      await expect(declare(agent, { recipient_user_id: fx.outsider.id }, 100)).rejects.toMatchObject({ code: 'custody_recipient_not_authorized' });
      await expect(declare(agent, { recipient_user_id: fx.managerB.id }, 100)).rejects.toMatchObject({ code: 'custody_recipient_not_authorized' });
      await expect(declare(agent, { recipient_user_id: agent }, 100)).rejects.toMatchObject({ code: expect.stringMatching(/custody_recipient_not_authorized|custody_rule_violation/) });
      await expect(declare(agent, { destination_id: bankB }, 100, {})).rejects.toMatchObject({ code: 'custody_destination_not_active' });
      await expect(declare(agent, { recipient_user_id: fx.managerA.id, destination_id: bank }, 100)).rejects.toMatchObject({ code: 'deposit_target_required' });
      await expect(declare(agent, toPerson(fx.managerA.id), 150000)).rejects.toMatchObject({ code: 'deposit_exceeds_holding' });
    });

    it('seul le destinataire désigné répond ; l\'acceptation transfère la responsabilité du seul montant accepté', async () => {
      await expect(receive(fx.viewerA.id, first.deposit_ref, { receivedAmount: 50000 })).rejects.toMatchObject({ code: 'custody_rule_violation' });
      await expect(receive(agent, first.deposit_ref, { receivedAmount: 50000 })).rejects.toMatchObject({ code: 'custody_recipient_not_authorized' });
      const done = await receive(fx.managerA.id, first.deposit_ref, { receivedAmount: 50000 });
      expect(done).toMatchObject({ state: 'ACCEPTED', received_kmf: 50000, discrepancy_kmf: 0 });
      expect(await hold(agent)).toBe(50000);
      expect(await hold(fx.managerA.id)).toBe(50000);
      expect((await q('SELECT status FROM cash_deposits WHERE id=$1', [first.id])).rows[0].status).toBe('verified');
      // Plus ancien encaissement (60 000) déchargé de 50 000 ; reste 10 000 + 40 000 non remis.
      expect(await uncovered(agent)).toBe(50000);
      await expect(receive(fx.managerA.id, first.deposit_ref, { receivedAmount: 50000 })).rejects.toBeTruthy();
    });

    it('réception partielle : annoncé ≠ reçu, l\'écart reste sous la responsabilité du remettant', async () => {
      second = await declare(agent, toPerson(fx.managerA.id), 30000);
      await expect(receive(fx.managerA.id, second.deposit_ref, { receivedAmount: 31000 })).rejects.toMatchObject({ code: 'custody_rule_violation' });
      const done = await receive(fx.managerA.id, second.deposit_ref, { receivedAmount: 25000 });
      expect(done).toMatchObject({ state: 'ACCEPTED_PARTIAL', received_kmf: 25000, discrepancy_kmf: 5000 });
      expect(await hold(agent)).toBe(25000);
      expect(await hold(fx.managerA.id)).toBe(75000);
      const row = (await custody.transferRows(db, A())).find(r => r.deposit_ref === second.deposit_ref);
      expect(row).toMatchObject({ amount_kmf: 30000, received_net_kmf: 25000, discrepancy_kmf: 5000, state: 'ACCEPTED_PARTIAL' });
    });

    it('refus motivé : rien ne bouge, la remise est contestée ; réponse unique', async () => {
      const third = await declare(agent, toPerson(fx.managerA.id), 10000);
      await expect(custody.recordReceipt(db, { actorId: fx.managerA.id, marketId: A(), depositRef: third.deposit_ref, outcome: 'refused' }))
        .rejects.toBeTruthy();
      await refuse(fx.managerA.id, third.deposit_ref, 'Billets non reçus');
      expect(await hold(agent)).toBe(25000);
      expect(await hold(fx.managerA.id)).toBe(75000);
      expect((await q('SELECT status FROM cash_deposits WHERE id=$1', [third.id])).rows[0].status).toBe('disputed');
      await expect(receive(fx.managerA.id, third.deposit_ref, { receivedAmount: 10000 })).rejects.toBeTruthy();
    });

    it('le Market d\'une autre équipe ne voit ni ne traite cette remise', async () => {
      await expect(custody.recordReceipt(db, { actorId: fx.managerB.id, marketId: fx.marketB.id, depositRef: first.deposit_ref, outcome: 'received', receivedAmount: 1 }))
        .rejects.toMatchObject({ code: 'custody_deposit_not_found' });
    });
  });

  describe('plafond du receveur, solde jamais négatif, concurrence', () => {
    it('le plafond de détention du receveur bloque l\'acceptation AVANT tout transfert de responsabilité', async () => {
      await q(`UPDATE membership_capabilities SET limit_amount = 20000 WHERE membership_id=$1 AND capability='cash.custody.receive' AND revoked_at IS NULL`, [fx.viewerAMembership.id]);
      const d = await declare(agent, toPerson(fx.viewerA.id), 25000);
      await expect(receive(fx.viewerA.id, d.deposit_ref, { receivedAmount: 25000 })).rejects.toMatchObject({ code: 'custody_holding_ceiling_exceeded' });
      expect(await hold(agent)).toBe(25000);
      expect(await hold(fx.viewerA.id)).toBe(0);
      const partial = await receive(fx.viewerA.id, d.deposit_ref, { receivedAmount: 20000 });
      expect(partial).toMatchObject({ state: 'ACCEPTED_PARTIAL', discrepancy_kmf: 5000 });
      await q(`UPDATE membership_capabilities SET limit_amount = NULL WHERE membership_id=$1 AND capability='cash.custody.receive' AND revoked_at IS NULL`, [fx.viewerAMembership.id]);
      // viewerA remet ses 20 000 à managerA pour la suite.
      const back = await declare(fx.viewerA.id, toPerson(fx.managerA.id), 20000);
      expect(back.market_id_source).toBe('DERIVED_MEMBERSHIP');
      await receive(fx.managerA.id, back.deposit_ref, { receivedAmount: 20000 });
      expect(await hold(fx.viewerA.id)).toBe(0);
      expect(await hold(fx.managerA.id)).toBe(95000);
      expect(await hold(agent)).toBe(5000);
    });

    it('deux acceptations concurrentes qui dépasseraient la garde : une seule passe, jamais de solde négatif', async () => {
      // managerA détient 95 000 : deux remises de 60 000 vers deux destinataires.
      const [d1, d2] = await Promise.all([
        declare(fx.managerA.id, toPerson(fx.viewerA.id), 60000),
        declare(fx.managerA.id, toPerson(fx.viewerA.id), 60000),
      ]);
      const results = await Promise.allSettled([
        receive(fx.viewerA.id, d1.deposit_ref, { receivedAmount: 60000 }),
        receive(fx.viewerA.id, d2.deposit_ref, { receivedAmount: 60000 }),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find(r => r.status === 'rejected').reason;
      expect(failure).toMatchObject({ code: 'custody_insufficient_holding' });
      expect(await hold(fx.managerA.id)).toBe(35000);
      expect(await hold(fx.viewerA.id)).toBe(60000);
      const { rows } = await q(`SELECT COUNT(*)::int AS n FROM (SELECT holder_id, market_id FROM cash_custody_movements GROUP BY 1,2 HAVING SUM(delta_kmf) < 0) x`);
      expect(rows[0].n).toBe(0);
      // Retour : viewerA remet à managerA (état propre pour la suite).
      const back = await declare(fx.viewerA.id, toPerson(fx.managerA.id), 60000);
      await receive(fx.managerA.id, back.deposit_ref, { receivedAmount: 60000 });
      expect(await hold(fx.managerA.id)).toBe(95000);
    });

    it('SQL brut : réception hors destinataire, montant reçu > annoncé et solde négatif sont refusés par la base', async () => {
      const d = await declare(agent, toPerson(fx.managerA.id), 1000);
      await sqlFails(`INSERT INTO cash_custody_receipts(deposit_id,market_id,kind,actor_id,amount_kmf,received_amount) VALUES ($1,$2,'RECEIVED',$3,1000,1000)`,
        [d.id, A(), fx.viewerA.id], /seul le destinataire désigné/);
      await sqlFails(`INSERT INTO cash_custody_receipts(deposit_id,market_id,kind,actor_id,amount_kmf,received_amount) VALUES ($1,$2,'RECEIVED',$3,2000,2000)`,
        [d.id, A(), fx.managerA.id], /reçu \(2000\.00\) > annoncé/);
      await sqlFails(`INSERT INTO cash_custody_receipts(deposit_id,market_id,kind,actor_id,received_amount,received_currency) VALUES ($1,$2,'RECEIVED',$3,1000,'EUR')`,
        [d.id, A(), fx.managerA.id], /devise figée/);
      await refuse(fx.managerA.id, d.deposit_ref);
    });
  });

  describe('devise et taux figés', () => {
    it('montant annoncé en XAF : taux figé à la déclaration, reçu converti au même taux (jamais recalculé)', async () => {
      const d = await declare(agent, toPerson(fx.managerA.id), 4000, { declared_currency: 'XAF' });
      expect(d).toMatchObject({ declared_currency: 'XAF' });
      expect(Number(d.fx_rate_to_kmf)).toBe(0.75);
      expect(Number(d.amount_kmf)).toBe(3000);
      const done = await receive(fx.managerA.id, d.deposit_ref, { receivedAmount: 3600 });
      expect(done).toMatchObject({ received_currency: 'XAF', received_kmf: 2700, discrepancy_kmf: 300 });
      const { rows: [r] } = await q(`SELECT received_amount::float AS ra, received_currency, fx_rate_to_kmf::float AS fx FROM cash_custody_receipts WHERE deposit_id=$1`, [d.id]);
      expect(r).toEqual({ ra: 3600, received_currency: 'XAF', fx: 0.75 });
      expect(await hold(agent)).toBe(5000 - 2700);
    });
  });

  describe('réception finale prouvée + contrôle indépendant : seule clôture', () => {
    let fin;

    it('la déclaration finale ne décharge pas ; la preuve est obligatoire et jamais par le remettant', async () => {
      fin = await declare(fx.managerA.id, toBank(), 40000, { declared_currency: 'XAF', declared_amount: 40000 });
      expect(fin).toMatchObject({ movement_kind: 'FINAL', status: 'pending', destination_id: bank });
      const amountKmf = Number(fin.amount_kmf);
      expect(amountKmf).toBe(30000);
      await expect(receive(fx.managerA.id, fin.deposit_ref, { receivedAmount: 40000, proofRef: 'BORD-1' })).rejects.toMatchObject({ code: 'custody_rule_violation' });
      await expect(receive(fx.viewerA.id, fin.deposit_ref, { receivedAmount: 40000 })).rejects.toMatchObject({ code: 'custody_rule_violation' });
      await expect(receive(fx.outsider.id, fin.deposit_ref, { receivedAmount: 40000, proofRef: 'BORD-1' })).rejects.toMatchObject({ code: 'custody_rule_violation' });
    });

    it('réception finale prouvée = « à contrôler » : le détenteur reste responsable, aucun faux vert', async () => {
      const before = await hold(fx.managerA.id);
      const done = await receive(fx.viewerA.id, fin.deposit_ref, { receivedAmount: 40000, proofRef: `BORD-${tag}` });
      expect(done.state).toBe('TO_CONTROL');
      expect(await hold(fx.managerA.id)).toBe(before);
      const row = (await custody.transferRows(db, A())).find(r => r.deposit_ref === fin.deposit_ref);
      expect(row).toMatchObject({ state: 'TO_CONTROL', controlled_net_kmf: null });
      expect((await q('SELECT status FROM cash_deposits WHERE id=$1', [fin.id])).rows[0].status).toBe('pending');
    });

    it('le contrôle exige un acteur distinct du remettant ET du receveur', async () => {
      await expect(control(fx.managerA.id, fin.deposit_ref)).rejects.toMatchObject({ code: 'custody_rule_violation' });
      await expect(control(fx.viewerA.id, fin.deposit_ref)).rejects.toMatchObject({ code: 'custody_rule_violation' });
      await expect(control(fx.central.id, fin.deposit_ref, { controlledKmf: 40000 })).rejects.toMatchObject({ code: 'custody_rule_violation' }); // > reçu net (30 000 KMF)
    });

    it('contrôle indépendant : clôture du seul montant contrôlé, solde déchargé, état CLOSED', async () => {
      const before = await hold(fx.managerA.id);
      const done = await control(fx.central.id, fin.deposit_ref, { controlledKmf: 30000 });
      expect(done).toMatchObject({ state: 'CLOSED', controlled_kmf: 30000 });
      expect(await hold(fx.managerA.id)).toBe(before - 30000);
      expect((await q('SELECT status FROM cash_deposits WHERE id=$1', [fin.id])).rows[0].status).toBe('verified');
      await expect(control(fx.central.id, fin.deposit_ref)).rejects.toMatchObject({ code: 'custody_already_resolved' });
    });

    it('contre-écriture centrale du contrôle : la responsabilité revient, rien n\'est supprimé', async () => {
      const { rows: [ctl] } = await q(`SELECT id FROM cash_custody_receipts WHERE deposit_id=$1 AND kind='CONTROL'`, [fin.id]);
      const before = await hold(fx.managerA.id);
      await expect(custody.reverseReceipt(db, { actorId: fx.central.id, marketId: A(), depositRef: fin.deposit_ref, receiptId: ctl.id, amountKmf: 40000, reason: 'Erreur de saisie' }))
        .rejects.toMatchObject({ code: 'custody_rule_violation' });
      await expect(custody.reverseReceipt(db, { actorId: fx.central.id, marketId: A(), depositRef: fin.deposit_ref, receiptId: ctl.id, amountKmf: 30000, reason: '' }))
        .rejects.toBeTruthy();
      await custody.reverseReceipt(db, { actorId: fx.central.id, marketId: A(), depositRef: fin.deposit_ref, receiptId: ctl.id, amountKmf: 30000, reason: 'Contrôle réalisé sur un mauvais relevé' });
      expect(await hold(fx.managerA.id)).toBe(before + 30000);
      const { rows } = await q(`SELECT kind FROM cash_custody_receipts WHERE deposit_id=$1 ORDER BY created_at, id`, [fin.id]);
      expect(rows.map(r => r.kind)).toEqual(['RECEIVED', 'CONTROL', 'REVERSAL']);
    });

    it('contrôle partiel : seul le contrôlé clôt, le reste demeure détenu', async () => {
      const f2 = await declare(fx.managerA.id, toBank(), 4000, { declared_currency: 'XAF' });
      await receive(fx.viewerA.id, f2.deposit_ref, { receivedAmount: 4000, proofRef: `BORD2-${tag}` });
      const before = await hold(fx.managerA.id);
      const done = await control(fx.central.id, f2.deposit_ref, { controlledKmf: 2000 });
      expect(done.state).toBe('CLOSED');
      expect(await hold(fx.managerA.id)).toBe(before - 2000);
    });

    it('contrôle négatif (0) : motif obligatoire, rien n\'est clôturé', async () => {
      const f3 = await declare(fx.managerA.id, toBank(), 400, { declared_currency: 'XAF' });
      await receive(fx.viewerA.id, f3.deposit_ref, { receivedAmount: 400, proofRef: `BORD3-${tag}` });
      const before = await hold(fx.managerA.id);
      await expect(control(fx.central.id, f3.deposit_ref, { controlledKmf: 0 })).rejects.toBeTruthy();
      const done = await control(fx.central.id, f3.deposit_ref, { controlledKmf: 0, reason: 'Relevé illisible' });
      expect(done.state).toBe('CONTROL_REJECTED');
      expect(await hold(fx.managerA.id)).toBe(before);
    });
  });

  describe('pertes : décision centrale motivée, distincte des montants reçus', () => {
    it('perte bornée par la garde, motivée, décideur distinct ; contre-écriture et trace d\'audit', async () => {
      const before = await hold(fx.managerA.id);
      await expect(custody.decideLoss(db, { actorId: fx.central.id, marketId: A(), holderId: fx.managerA.id, amountKmf: before + 1, reason: 'Vol constaté, plainte déposée' }))
        .rejects.toMatchObject({ code: 'custody_insufficient_holding' });
      await expect(custody.decideLoss(db, { actorId: fx.central.id, marketId: A(), holderId: fx.managerA.id, amountKmf: 100, reason: 'court' }))
        .rejects.toMatchObject({ code: 'custody_loss_invalid' });
      await expect(custody.decideLoss(db, { actorId: fx.managerA.id, marketId: A(), holderId: fx.managerA.id, amountKmf: 100, reason: 'Auto-décision interdite' }))
        .rejects.toMatchObject({ code: 'custody_loss_invalid' });
      const loss = await custody.decideLoss(db, { actorId: fx.central.id, marketId: A(), holderId: fx.managerA.id, amountKmf: 1000, reason: 'Billet détérioré non remboursable (PV n°42)' });
      expect(await hold(fx.managerA.id)).toBe(before - 1000);
      await expect(custody.reverseLoss(db, { actorId: fx.central.id, marketId: A(), lossId: loss.loss_id, amountKmf: 2000, reason: 'Trop de contre-écriture' }))
        .rejects.toMatchObject({ code: 'custody_rule_violation' });
      await custody.reverseLoss(db, { actorId: fx.central.id, marketId: A(), lossId: loss.loss_id, amountKmf: 1000, reason: 'Billet finalement retrouvé' });
      expect(await hold(fx.managerA.id)).toBe(before);
      const { rows } = await q(`SELECT action FROM market_delegation_audit WHERE market_id=$1 AND action LIKE 'CASH_LOSS%' ORDER BY occurred_at, id`, [A()]);
      expect(rows.map(r => r.action)).toEqual(['CASH_LOSS_DECIDED', 'CASH_LOSS_REVERSED']);
    });
  });

  describe('immutabilité, append-only, aucune revue parallèle', () => {
    it('faits append-only ; cible et montants d\'une remise immuables ; statut non-LEGACY non modifiable à la main', async () => {
      await sqlFails(`UPDATE cash_custody_receipts SET amount_kmf = 1`, [], /append-only/);
      await sqlFails(`DELETE FROM cash_custody_receipts`, [], /append-only/);
      await sqlFails(`UPDATE cash_custody_losses SET amount_kmf = 1`, [], /append-only/);
      await sqlFails(`DELETE FROM cash_custody_losses`, [], /append-only/);
      const { rows: [d] } = await q(`SELECT id FROM cash_deposits WHERE movement_kind='TRANSFER' AND status='pending' LIMIT 1`).then(r => ({ rows: r.rows.length ? r.rows : [{ id: null }] }));
      const fresh = d.id ? { id: d.id } : await declare(agent, toPerson(fx.managerA.id), 100);
      await sqlFails(`UPDATE cash_deposits SET recipient_user_id = $2 WHERE id = $1`, [fresh.id, fx.managerB.id], /immuables/);
      await sqlFails(`UPDATE cash_deposits SET status = 'verified' WHERE id = $1`, [fresh.id], /découle des seules réceptions/);
      await expect(deposits.verifyDeposit({ depositId: fresh.id, verifierId: fx.central.id, central: true })).rejects.toMatchObject({ code: 'deposit_review_legacy_only' });
      await expect(deposits.disputeDeposit({ depositId: fresh.id, verifierId: fx.central.id, reason: 'x', central: true })).rejects.toMatchObject({ code: 'deposit_review_legacy_only' });
    });
  });

  describe('remises historiques vérifiées : à régulariser, jamais clôturées automatiquement', () => {
    let legacy;
    it('une remise historique vérifiée ne décharge pas l\'agent et reste listée à régulariser (aucun faux vert)', async () => {
      const before = { hold: await hold(agent), unc: await uncovered(agent) };
      legacy = await legacyVerified(agent, A(), 2000);
      expect(await hold(agent)).toBe(before.hold);
      expect(await uncovered(agent)).toBe(before.unc);
      const list = await custody.legacyToRegularize(db, A());
      expect(list.find(r => r.deposit_ref === legacy.deposit_ref)).toMatchObject({ remaining_kmf: 2000, agent_id: agent });
      const alert = await signals.checkCashLegacyToRegularize(db);
      expect(alert).toMatchObject({ code: 'CASH_LEGACY_TO_REGULARIZE' });
      expect(alert.value_kmf).toBeGreaterThanOrEqual(2000);
    });

    it('la régularisation passe par un transfert accepté : Σ ≤ remise historique, même agent et Market', async () => {
      await expect(declare(agent, toPerson(fx.managerA.id), 2100, { regularizes_deposit_ref: legacy.deposit_ref })).rejects.toMatchObject({ code: 'custody_rule_violation' });
      const r1 = await declare(agent, toPerson(fx.managerA.id), 1500, { regularizes_deposit_ref: legacy.deposit_ref });
      await expect(declare(agent, toPerson(fx.managerA.id), 600, { regularizes_deposit_ref: legacy.deposit_ref })).rejects.toMatchObject({ code: 'custody_rule_violation' });
      // Déclarée seulement : rien n'est régularisé tant que le destinataire n'a pas accepté.
      expect((await custody.legacyToRegularize(db, A())).find(r => r.deposit_ref === legacy.deposit_ref).remaining_kmf).toBe(2000);
      await receive(fx.managerA.id, r1.deposit_ref, { receivedAmount: 1500 });
      expect((await custody.legacyToRegularize(db, A())).find(r => r.deposit_ref === legacy.deposit_ref).remaining_kmf).toBe(500);
      expect((await q('SELECT status FROM cash_deposits WHERE id=$1', [legacy.id])).rows[0].status).toBe('verified');
      await expect(declare(agent, toPerson(fx.managerA.id), 100, { regularizes_deposit_ref: 'DEP-INCONNU' })).rejects.toMatchObject({ code: 'deposit_regularizes_not_found' });
    });
  });

  describe('séparation des Markets', () => {
    it('un agent du Market B ne peut remettre ni à un habilité de A ni vers une destination de A', async () => {
      await collect(agentB, relaisB, fx.marketB.id, 5000, 2);
      await expect(deposits.createDeposit({ agentId: agentB, marketId: fx.marketB.id, payload: { ...toPerson(fx.managerA.id), declared_amount: 100, declared_currency: 'KMF' } }))
        .rejects.toMatchObject({ code: 'custody_recipient_not_authorized' });
      await expect(deposits.createDeposit({ agentId: agentB, marketId: fx.marketB.id, payload: { destination_id: bank, declared_amount: 100, declared_currency: 'XAF' } }))
        .rejects.toMatchObject({ code: 'custody_destination_not_active' });
      // Le Market envoyé par un client pour un agent relais ne l'emporte pas sur son relais.
      await expect(deposits.createDeposit({ agentId: agentB, marketId: A(), payload: { ...toPerson(fx.managerA.id), declared_amount: 100, declared_currency: 'KMF' } }))
        .rejects.toBeTruthy();
      expect(await hold(agentB, fx.marketB.id)).toBe(5000);
    });
  });

  describe('signaux : plafond et délai de garde', () => {
    it('un détenteur hors délai ou hors plafond est signalé avec depuis quand et combien', async () => {
      await collect(agentB, relaisB, fx.marketB.id, 9000, 20);
      const rows = await custody.overdueHoldings(db);
      const holder = rows.find(r => r.market_id === fx.marketB.id && r.holder_id === agentB);
      expect(holder).toBeTruthy();
      expect(holder).toMatchObject({ balance_kmf: 14000, overdue: true, over_ceiling: false });
      expect(Date.now() - new Date(holder.since).getTime()).toBeGreaterThan(19 * 86400000);
      const alert = await signals.checkCashCustodyLimits(db);
      expect(alert).toMatchObject({ code: 'CASH_CUSTODY_LIMIT_EXCEEDED', level: 'critical' });
    });
  });

  describe('contre-recette métier : espèces → remises partielles → transferts → réception finale → clôture ou écart', () => {
    it('conservation stricte de bout en bout, qui détient quoi à chaque étape', async () => {
      const marketB = fx.marketB.id;
      const b = { agent: await newAgent(relaisB) };
      extraAgents.push(b.agent);
      await collect(b.agent, relaisB, marketB, 80000, 6);
      await collect(b.agent, relaisB, marketB, 20000, 1);
      const convey = (from, target, amount, extra = {}) => deposits.createDeposit({
        agentId: from, marketId: marketB, payload: { ...target, declared_amount: amount, declared_currency: 'KMF', ...extra },
      });
      const rec = (actor, ref, extra) => custody.recordReceipt(db, { actorId: actor, marketId: marketB, depositRef: ref, outcome: 'received', ...extra });
      // managerB (habilité du Market B) reçoit en deux remises partielles ; une est contestée par écart.
      const t1 = await convey(b.agent, toPerson(fx.managerB.id), 60000);
      await rec(fx.managerB.id, t1.deposit_ref, { receivedAmount: 60000 });
      const t2 = await convey(b.agent, toPerson(fx.managerB.id), 40000);
      await rec(fx.managerB.id, t2.deposit_ref, { receivedAmount: 35000 }); // écart 5 000 reste chez l'agent
      const heldB = userId => custody.holdingOf(db, userId, marketB);
      expect(await heldB(b.agent)).toBe(5000);
      expect(await heldB(fx.managerB.id)).toBe(95000);
      // Destination finale B (déjà ACTIVE, proposée par managerB, activée par la centrale) en XAF.
      const f = await convey(fx.managerB.id, { destination_id: bankB }, 95000 / 0.75, { declared_currency: 'XAF' });
      expect(Number(f.amount_kmf)).toBe(95000);
      // Réception finale prouvée par un autre habilité du Market B : on en habilite un (centrale ≠ remettant ≠ receveur).
      const { rows: [mem] } = await q(`SELECT id FROM assignment_memberships WHERE assignment_id=$1 AND user_id=$2`, [fx.assignmentB.id, fx.managerB.id]);
      expect(mem).toBeTruthy();
      const receiver = await newAgent(null);
      fx.cleanup.trackSql('DELETE FROM users WHERE id = $1', [receiver]);
      fx.cleanup.trackSql('DELETE FROM market_delegation_audit WHERE actor_user_id = $1', [receiver]);
      const memId = uuid();
      await q(`INSERT INTO assignment_memberships(id,assignment_id,user_id,status,granted_by) VALUES ($1,$2,$3,'ACTIVE',$4)`, [memId, fx.assignmentB.id, receiver, fx.central.id]);
      fx.cleanup.trackSql('DELETE FROM assignment_memberships WHERE id=$1', [memId]);
      await grant(memId, 'cash.custody.receive');
      const done = await rec(receiver, f.deposit_ref, { receivedAmount: 95000 / 0.75, proofRef: `RELEVE-${tag}` });
      expect(done.state).toBe('TO_CONTROL');
      expect(await heldB(fx.managerB.id)).toBe(95000);
      const closed = await custody.recordControl(db, { actorId: fx.central.id, marketId: marketB, depositRef: f.deposit_ref });
      expect(closed).toMatchObject({ state: 'CLOSED', controlled_kmf: 95000 });
      expect(await heldB(fx.managerB.id)).toBe(0);
      // Écart de 5 000 chez l'agent : décision centrale de perte (motivée) — distincte des reçus.
      await custody.decideLoss(db, { actorId: fx.central.id, marketId: marketB, holderId: b.agent, amountKmf: 5000, reason: 'Écart constaté à la remise du 2e versement (PV signé)' });
      expect(await heldB(b.agent)).toBe(0);
      // Conservation : Σ encaissements = Σ détenu + clôturé + perdu ; aucun solde négatif.
      const { rows: [c] } = await q(`
        SELECT COALESCE(SUM(delta_kmf) FILTER (WHERE source='COLLECTION'),0)::int AS collected,
               COALESCE(SUM(delta_kmf) FILTER (WHERE source IN ('COLLECTION','TRANSFER_OUT','TRANSFER_IN','FINAL_CLOSURE','LOSS')),0)::int AS held,
               COALESCE(-SUM(delta_kmf) FILTER (WHERE source='FINAL_CLOSURE'),0)::int AS closed,
               COALESCE(-SUM(delta_kmf) FILTER (WHERE source='LOSS'),0)::int AS lost
          FROM cash_custody_movements WHERE market_id = $1 AND holder_id = ANY($2::uuid[])`, [marketB, [b.agent, fx.managerB.id, receiver]]);
      expect(c).toEqual({ collected: 100000, held: 0, closed: 95000, lost: 5000 });
      expect(await uncovered(b.agent)).toBe(0);
    });
  });
}
