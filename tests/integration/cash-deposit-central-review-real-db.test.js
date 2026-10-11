'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * Feature propriétaire : payments (cash-deposit-service, autorité unique de mutation).
 * Preuve PostgreSQL réelle : la revue centrale d'un dépôt ne peut ni s'auto-valider,
 * ni écraser silencieusement une validation, et toute correction est auditée avec
 * le validateur précédent conservé. La faculté de correction exceptionnelle du siège
 * (verified → disputed, correction=true + motif) reste disponible.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('CASH DEPOSIT CENTRAL REVIEW — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const crypto = require('crypto');
  const db = require('../../db');
  const service = require('../../services/cash-deposit-service');

  const tag = crypto.randomBytes(4).toString('hex');
  const ids = { market: null, relais: null, agent: null, admin1: null, admin2: null, deposits: [] };
  const q = (sql, p) => db.query(sql, p);

  async function newUser(role, relaisId = null) {
    const { rows: [u] } = await q(
      `INSERT INTO users(full_name,email,phone,role,relais_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`T ${role} ${tag}`, `${role}.${tag}.${crypto.randomBytes(3).toString('hex')}@cashreview.test`, `+2370${Math.floor(Math.random() * 9e7 + 1e7)}`, role, relaisId]
    );
    return u.id;
  }
  async function newDeposit(agentId, amount = 150000) {
    const dep = await service.createDeposit({ agentId, payload: {
      amount_kmf: amount, deposit_method: 'bank', period_start: '2026-10-01', period_end: '2026-10-07',
    } });
    ids.deposits.push(dep.id);
    return dep;
  }
  const row = async id => (await q('SELECT * FROM cash_deposits WHERE id=$1', [id])).rows[0];
  const auditRows = async id => (await q(
    `SELECT * FROM market_delegation_audit WHERE action LIKE 'CASH_DEPOSIT_CENTRAL_%' AND payload_before->>'deposit_ref' = (SELECT deposit_ref FROM cash_deposits WHERE id=$1) ORDER BY occurred_at, id`, [id]
  )).rows;

  beforeAll(async () => {
    const { rows: [m] } = await q(`INSERT INTO markets(code,name,currency,minor_unit,is_active,lifecycle_status) VALUES ($1,$2,'KMF',0,true,'ACTIVE') RETURNING id`, [`CR${tag}`.slice(0, 8).toUpperCase(), `Marché ${tag}`]);
    ids.market = m.id;
    const { rows: [r] } = await q(`INSERT INTO relais(name,phone,address,market_id) VALUES ($1,'+2370000000','Adresse test',$2) RETURNING id`, [`Relais ${tag}`, m.id]);
    ids.relais = r.id;
    ids.agent = await newUser('agent_relais', r.id);
    ids.admin1 = await newUser('admin');
    ids.admin2 = await newUser('admin');
  });

  afterAll(async () => {
    try {
      for (const id of ids.deposits) {
        await q(`DELETE FROM market_delegation_audit WHERE payload_before->>'deposit_ref' = (SELECT deposit_ref FROM cash_deposits WHERE id=$1)`, [id]);
      }
      // Grand livre append-only (migration 287) : nettoyage de fixtures uniquement, triggers rétablis aussitôt.
      await q('ALTER TABLE cash_deposit_allocations DISABLE TRIGGER trg_prevent_cash_alloc_delete');
      await q('ALTER TABLE cash_deposits DISABLE TRIGGER trg_prevent_cash_deposits_delete');
      try {
        await q('DELETE FROM cash_deposit_allocations WHERE deposit_id IN (SELECT id FROM cash_deposits WHERE agent_id = ANY($1::uuid[]))', [[ids.agent, ids.admin1, ids.admin2]]);
        await q('DELETE FROM cash_deposits WHERE agent_id = ANY($1::uuid[])', [[ids.agent, ids.admin1, ids.admin2]]);
      } finally {
        await q('ALTER TABLE cash_deposits ENABLE TRIGGER trg_prevent_cash_deposits_delete');
        await q('ALTER TABLE cash_deposit_allocations ENABLE TRIGGER trg_prevent_cash_alloc_delete');
      }
      await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ids.agent, ids.admin1, ids.admin2]]);
      await q('DELETE FROM relais WHERE id=$1', [ids.relais]);
      await q('DELETE FROM markets WHERE id=$1', [ids.market]);
    } finally {
      await db.end?.();
    }
  });

  describe('CASH central review — real DB', () => {
    it('vérification centrale : statut, validateur et audit (marché dérivé du relais)', async () => {
      const dep = await newDeposit(ids.agent);
      const out = await service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin1, notes: 'relevé OK', central: true });
      expect(out.status).toBe('verified');
      const a = await auditRows(dep.id);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ action: 'CASH_DEPOSIT_CENTRAL_VERIFIED', actor_user_id: ids.admin1, market_id: ids.market });
    });

    it('auto-revue interdite : le déclarant admin ne peut ni vérifier ni contester son dépôt', async () => {
      const dep = await newDeposit(ids.admin1, 9000);
      await expect(service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin1, central: true }))
        .rejects.toMatchObject({ code: 'deposit_self_review_forbidden', status: 403 });
      await expect(service.disputeDeposit({ depositId: dep.id, verifierId: ids.admin1, reason: 'x', central: true }))
        .rejects.toMatchObject({ code: 'deposit_self_review_forbidden' });
      expect((await row(dep.id)).status).toBe('pending');
      expect(await auditRows(dep.id)).toHaveLength(0);
    });

    it('aucun écrasement silencieux : re-vérifier un dépôt vérifié → 409, validateur inchangé', async () => {
      const dep = await newDeposit(ids.agent);
      await service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin1, central: true });
      await expect(service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin2, central: true }))
        .rejects.toMatchObject({ code: 'deposit_transition_forbidden', status: 409 });
      const after = await row(dep.id);
      expect(after.verified_by).toBe(ids.admin1);
      expect(after.status).toBe('verified');
    });

    it('contester un dépôt vérifié sans correction explicite → 409, rien ne change', async () => {
      const dep = await newDeposit(ids.agent);
      await service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin1, notes: 'ok', central: true });
      await expect(service.disputeDeposit({ depositId: dep.id, verifierId: ids.admin2, reason: 'doute', central: true }))
        .rejects.toMatchObject({ code: 'deposit_correction_required', status: 409 });
      const after = await row(dep.id);
      expect(after).toMatchObject({ status: 'verified', verified_by: ids.admin1, notes: 'ok' });
    });

    it('correction exceptionnelle du siège : possible, motif obligatoire, historique auditable complet', async () => {
      const dep = await newDeposit(ids.agent);
      await service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin1, notes: 'ok', central: true });
      await expect(service.disputeDeposit({ depositId: dep.id, verifierId: ids.admin2, reason: '', correction: true, central: true }))
        .rejects.toMatchObject({ code: 'deposit_dispute_reason_required' });
      const out = await service.disputeDeposit({ depositId: dep.id, verifierId: ids.admin2, reason: 'relevé bancaire non conforme', correction: true, central: true });
      expect(out.status).toBe('disputed');
      const a = await auditRows(dep.id);
      expect(a.map(x => x.action)).toEqual(['CASH_DEPOSIT_CENTRAL_VERIFIED', 'CASH_DEPOSIT_CENTRAL_CORRECTED']);
      expect(a[1].payload_before).toMatchObject({ status: 'verified', verified_by: ids.admin1, previous_notes: 'ok' });
      expect(a[1].payload_after).toMatchObject({ status: 'disputed', note: 'relevé bancaire non conforme' });
      expect(a[1].actor_user_id).toBe(ids.admin2);
    });

    it('un dépôt contesté peut être vérifié ensuite (levée de litige) ; double contestation refusée', async () => {
      const dep = await newDeposit(ids.agent);
      await service.disputeDeposit({ depositId: dep.id, verifierId: ids.admin1, reason: 'écart', central: true });
      await expect(service.disputeDeposit({ depositId: dep.id, verifierId: ids.admin2, reason: 'autre', central: true }))
        .rejects.toMatchObject({ code: 'deposit_transition_forbidden', status: 409 });
      expect((await row(dep.id)).notes).toBe('écart');
      const out = await service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin2, notes: 'levé', central: true });
      expect(out.status).toBe('verified');
    });

    it('concurrence : deux revues simultanées, une seule gagne, jamais deux validateurs', async () => {
      const dep = await newDeposit(ids.agent);
      const res = await Promise.allSettled([
        service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin1, central: true }),
        service.verifyDeposit({ depositId: dep.id, verifierId: ids.admin2, central: true }),
      ]);
      expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(res.filter(r => r.status === 'rejected')[0].reason).toMatchObject({ status: 409 });
      expect(await auditRows(dep.id)).toHaveLength(1);
    });

    it('échec d audit = rollback : la mutation n est pas persistée sans trace', async () => {
      const dep = await newDeposit(ids.agent);
      await expect(service.verifyDeposit({ depositId: dep.id, verifierId: '00000000-0000-0000-0000-00000000dead', central: true })).rejects.toThrow();
      expect((await row(dep.id)).status).toBe('pending');
    });
  });
}
