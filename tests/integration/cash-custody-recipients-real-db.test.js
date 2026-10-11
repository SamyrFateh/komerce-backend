'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * Feature propriétaire : payments (garde des espèces, PR 4a, migration 288).
 * PostgreSQL réel : habilitation à recevoir (capability + plafond), destinations finales
 * activées par deux acteurs distincts, délai de garde borné, séparation des Markets,
 * comptes de paiement électroniques jamais modifiés.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('CASH CUSTODY RECIPIENTS — REAL_DB — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const custody = require('../../services/cash-custody-service');
  const { updateMarketCashPolicy } = require('../../services/market-cash-control-policy-service');
  const { createMarketDelegationFixture, uuid, tag } = require('../helpers/marketDelegationE2EKit');

  let fx;
  let secondManager;
  let paymentAccountA;
  let paymentAccountB;
  const q = (sql, p) => db.query(sql, p);

  async function newManager(assignment, grantedBy) {
    const userId = uuid();
    await q(`INSERT INTO users(id,full_name,email,phone,role) VALUES ($1,$2,$3,$4,'client')`,
      [userId, `Second ${tag('mgr')}`, `second.${userId}@custody.test`, `+2370${Math.floor(Math.random() * 9e7 + 1e7)}`]);
    fx.cleanup.track('users', 'id', userId);
    const membershipId = uuid();
    await q(`INSERT INTO assignment_memberships(id,assignment_id,user_id,status,granted_by) VALUES ($1,$2,$3,'ACTIVE',$4)`,
      [membershipId, assignment.id, userId, grantedBy]);
    fx.cleanup.track('assignment_memberships', 'id', membershipId);
    for (const capability of ['finance.read', 'cash_control.policy.manage']) {
      const id = uuid();
      await q(`INSERT INTO membership_capabilities(id,membership_id,capability,granted_by) VALUES ($1,$2,$3,$4)`, [id, membershipId, capability, grantedBy]);
      fx.cleanup.track('membership_capabilities', 'id', id);
    }
    return { userId, membershipId };
  }

  async function paymentAccount(marketId, userId) {
    const id = uuid();
    await q(`INSERT INTO market_payment_accounts(id,market_id,provider,currency,account_holder,legal_seller,refund_bearer,created_by)
             VALUES ($1,$2,'orange_money','XAF','Titulaire Test','Vendeur Test','MARKET',$3)`, [id, marketId, userId]);
    fx.cleanup.track('market_payment_accounts', 'id', id);
    return id;
  }

  const grantReceive = async (membershipId, limit, grantedBy) => {
    const id = uuid();
    await q(`INSERT INTO membership_capabilities(id,membership_id,capability,granted_by,limit_amount) VALUES ($1,$2,'cash.custody.receive',$3,$4)`,
      [id, membershipId, grantedBy, limit]);
    fx.cleanup.track('membership_capabilities', 'id', id);
    return id;
  };

  beforeAll(async () => {
    fx = await createMarketDelegationFixture(db);
    // Les EXECUTION n'entrent pas dans le ceiling du fixture : on reproduit ce que fait la migration 288
    // sur les assignments actifs (rendre la capability accordable, sans l'accorder à personne).
    for (const assignment of [fx.assignmentA, fx.assignmentB]) {
      const ceilingId = uuid();
      await q(`INSERT INTO assignment_capability_ceiling(id,assignment_id,capability,granted_by) VALUES ($1,$2,'cash.custody.receive',$3)`,
        [ceilingId, assignment.id, fx.central.id]);
      fx.cleanup.track('assignment_capability_ceiling', 'id', ceilingId);
    }
    secondManager = await newManager(fx.assignmentA, fx.central.id);
    fx.cleanup.trackSql(
      'DELETE FROM market_delegation_audit WHERE market_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])',
      [[fx.marketA.id, fx.marketB.id], [fx.managerA.id, fx.managerB.id, fx.viewerA.id, fx.central.id, secondManager.userId]]
    );
    paymentAccountA = await paymentAccount(fx.marketA.id, fx.central.id);
    paymentAccountB = await paymentAccount(fx.marketB.id, fx.central.id);
  });

  afterAll(async () => {
    try {
      await q('ALTER TABLE market_cash_destinations DISABLE TRIGGER trg_prevent_market_cash_destinations_delete');
      try {
        await q('DELETE FROM market_cash_destinations WHERE market_id = ANY($1::uuid[])', [[fx.marketA.id, fx.marketB.id]]);
        await fx.cleanup.run();
      } finally {
        await q('ALTER TABLE market_cash_destinations ENABLE TRIGGER trg_prevent_market_cash_destinations_delete');
      }
    } finally {
      await db.end?.();
    }
  });

  describe('habilitation à recevoir (capability + plafond)', () => {
    it('la capability est dans le registre, LIVE, à montant, et accordable sous le ceiling du Market', async () => {
      const { rows: [row] } = await q(`SELECT status, amount_bearing, effect FROM capability_registry WHERE capability='cash.custody.receive'`);
      expect(row).toEqual({ status: 'LIVE', amount_bearing: true, effect: 'ACT' });
      const { rows: tpl } = await q(`SELECT 1 FROM ceiling_template_capabilities c JOIN ceiling_templates t ON t.id=c.template_id AND t.is_current WHERE c.capability='cash.custody.receive'`);
      expect(tpl).toHaveLength(1);
    });

    it('personne n\'est destinataire par défaut ; un agent sans habilitation est refusé', async () => {
      expect(await custody.listRecipients(db, fx.marketA.id)).toEqual([]);
      await expect(custody.assertAuthorizedRecipient(db, { marketId: fx.marketA.id, userId: fx.outsider.id }))
        .rejects.toMatchObject({ code: 'custody_recipient_not_authorized', status: 403 });
    });

    it('un plafond au-dessus de la limite centrale est ramené à la limite ; sans plafond = défaut central', async () => {
      const limits = await custody.centralLimits();
      // Le membre viewerA reçoit la capability (le ceiling du Market la rend accordable) avec un plafond excessif.
      const grantId = await grantReceive(fx.viewerAMembership.id, limits.max_holding_kmf * 10, fx.central.id);
      let list = await custody.listRecipients(db, fx.marketA.id);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ user_id: fx.viewerA.id, holding_limit_kmf: limits.max_holding_kmf });
      await q(`UPDATE membership_capabilities SET limit_amount = 250000 WHERE id=$1`, [grantId]);
      list = await custody.listRecipients(db, fx.marketA.id);
      expect(list[0].holding_limit_kmf).toBe(250000);
      await q(`UPDATE membership_capabilities SET limit_amount = NULL WHERE id=$1`, [grantId]);
      expect((await custody.listRecipients(db, fx.marketA.id))[0].holding_limit_kmf).toBe(limits.default_holding_kmf);
      expect(await custody.assertAuthorizedRecipient(db, { marketId: fx.marketA.id, userId: fx.viewerA.id })).toMatchObject({ user_id: fx.viewerA.id });
    });

    it('séparation des Markets : un habilité du Market A n\'est pas destinataire dans le Market B', async () => {
      await expect(custody.assertAuthorizedRecipient(db, { marketId: fx.marketB.id, userId: fx.viewerA.id }))
        .rejects.toMatchObject({ code: 'custody_recipient_not_authorized' });
      expect(await custody.listRecipients(db, fx.marketB.id)).toEqual([]);
    });

    it('une habilitation révoquée ne compte plus', async () => {
      await q(`UPDATE membership_capabilities SET revoked_at = NOW(), revoked_by = $2 WHERE membership_id=$1 AND capability='cash.custody.receive'`, [fx.viewerAMembership.id, fx.central.id]);
      expect(await custody.listRecipients(db, fx.marketA.id)).toEqual([]);
    });
  });

  describe('destinations finales (banque, Mobile Money)', () => {
    let dest;
    const call = (verb, userId, extra = {}) => custody.transitionDestination(db, {
      userId, marketCode: fx.marketA.code, destinationId: dest.id, verb, ...extra,
    });

    it('proposition par un gestionnaire habilité ; un simple lecteur ne peut pas proposer', async () => {
      await expect(custody.proposeDestination(db, { userId: fx.viewerA.id, marketCode: fx.marketA.code, payload: { kind: 'BANK', label: 'X', account_ref: 'IBAN …1234' } }))
        .rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED' });
      dest = await custody.proposeDestination(db, {
        userId: fx.managerA.id, marketCode: fx.marketA.code,
        payload: { kind: 'BANK', label: 'Banque centrale Market A', account_ref: 'IBAN …9876', currency: 'XAF' },
      });
      expect(dest.status).toBe('PROPOSED');
      await expect(custody.assertActiveDestination(db, { marketId: fx.marketA.id, destinationId: dest.id }))
        .rejects.toMatchObject({ code: 'custody_destination_not_active' });
    });

    it('le proposant ne peut pas activer (deux acteurs distincts), ni en SQL brut', async () => {
      await expect(call('activate', fx.managerA.id)).rejects.toMatchObject({ code: 'custody_destination_two_actors_required', status: 403 });
      await expect(q(`UPDATE market_cash_destinations SET status='ACTIVE', activated_by=proposed_by, activated_at=NOW() WHERE id=$1`, [dest.id]))
        .rejects.toThrow(/two_actors/);
    });

    it('un second acteur distinct active ; le Market B ne peut ni la voir ni l\'activer', async () => {
      await expect(custody.transitionDestination(db, { userId: fx.managerB.id, marketCode: fx.marketB.code, destinationId: dest.id, verb: 'activate' }))
        .rejects.toMatchObject({ code: 'custody_destination_not_found', status: 404 });
      const active = await call('activate', secondManager.userId);
      expect(active).toMatchObject({ status: 'ACTIVE', activated_by: secondManager.userId });
      expect(await custody.assertActiveDestination(db, { marketId: fx.marketA.id, destinationId: dest.id })).toMatchObject({ kind: 'BANK' });
      await expect(custody.assertActiveDestination(db, { marketId: fx.marketB.id, destinationId: dest.id }))
        .rejects.toMatchObject({ code: 'custody_destination_not_active' });
      expect(await custody.listDestinations(db, fx.marketB.id)).toEqual([]);
    });

    it('suspension motivée ; réactivation par un acteur distinct du proposant ; clôture terminale ; jamais de suppression', async () => {
      await expect(call('suspend', secondManager.userId)).rejects.toMatchObject({ code: 'custody_destination_reason_required' });
      expect(await call('suspend', secondManager.userId, { reason: 'doute sur le compte' })).toMatchObject({ status: 'SUSPENDED' });
      await expect(custody.assertActiveDestination(db, { marketId: fx.marketA.id, destinationId: dest.id }))
        .rejects.toMatchObject({ code: 'custody_destination_not_active' });
      expect(await call('activate', secondManager.userId)).toMatchObject({ status: 'ACTIVE' });
      expect(await call('close', secondManager.userId, { reason: 'compte fermé' })).toMatchObject({ status: 'CLOSED' });
      await expect(call('activate', secondManager.userId)).rejects.toMatchObject({ code: 'custody_destination_transition_forbidden', status: 409 });
      await expect(q('DELETE FROM market_cash_destinations WHERE id=$1', [dest.id])).rejects.toThrow(/append-only/);
      await expect(call('explode', secondManager.userId)).rejects.toMatchObject({ code: 'custody_destination_action_invalid' });
    });

    it('champs d\'origine immuables ; doublon vivant refusé ; entrées invalides refusées', async () => {
      const d = await custody.proposeDestination(db, {
        userId: fx.managerA.id, marketCode: fx.marketA.code,
        payload: { kind: 'MOBILE_MONEY', label: 'Mobile Money Market A', account_ref: 'Orange …4455', currency: 'XAF', payment_account_id: paymentAccountA },
      });
      await expect(q(`UPDATE market_cash_destinations SET account_ref='autre' WHERE id=$1`, [d.id])).rejects.toThrow(/immuables/);
      await expect(q(`UPDATE market_cash_destinations SET market_id=$2 WHERE id=$1`, [d.id, fx.marketB.id])).rejects.toThrow(/immuables/);
      await expect(custody.proposeDestination(db, { userId: fx.managerA.id, marketCode: fx.marketA.code, payload: { kind: 'MOBILE_MONEY', label: 'Doublon', account_ref: 'Orange …4455', currency: 'XAF' } }))
        .rejects.toMatchObject({ code: 'custody_destination_exists', status: 409 });
      await expect(custody.proposeDestination(db, { userId: fx.managerA.id, marketCode: fx.marketA.code, payload: { kind: 'CASH', label: 'Cash libre', account_ref: 'xyz' } }))
        .rejects.toMatchObject({ code: 'custody_destination_kind_invalid' });
      await expect(custody.proposeDestination(db, { userId: fx.managerA.id, marketCode: fx.marketA.code, payload: { kind: 'BANK', label: 'x', account_ref: 'sk_live_secret' } }))
        .rejects.toMatchObject({ code: 'custody_destination_field_invalid' });
      // un statut ACTIVE ne s'insère jamais directement
      await expect(q(`INSERT INTO market_cash_destinations(market_id,kind,label,currency,account_ref,status,proposed_by,activated_by,activated_at)
                      VALUES ($1,'BANK','Direct','XAF','IBAN …0001','ACTIVE',$2,$3,NOW())`, [fx.marketA.id, fx.managerA.id, secondManager.userId]))
        .rejects.toThrow(/PROPOSED/);
    });

    it('comptes de paiement électroniques : référence autorisée seulement dans le même Market ; compte jamais modifié', async () => {
      const before = (await q('SELECT status, updated_at, verified_at FROM market_payment_accounts WHERE id=$1', [paymentAccountA])).rows[0];
      await expect(custody.proposeDestination(db, {
        userId: fx.managerA.id, marketCode: fx.marketA.code,
        payload: { kind: 'MOBILE_MONEY', label: 'Compte du Market B', account_ref: 'Orange …7788', currency: 'XAF', payment_account_id: paymentAccountB },
      })).rejects.toMatchObject({ code: 'custody_destination_field_invalid' });
      const after = (await q('SELECT status, updated_at, verified_at FROM market_payment_accounts WHERE id=$1', [paymentAccountA])).rows[0];
      expect(after).toEqual(before);
    });
  });

  describe('délai de garde par Market, sous limite centrale', () => {
    const put = payload => updateMarketCashPolicy(db, { userId: fx.managerA.id, marketCode: fx.marketA.code, payload });

    it('défaut central, puis délai du Market, jamais au-dessus de la limite centrale', async () => {
      const limits = await custody.centralLimits();
      expect((await custody.snapshot(db, fx.marketA.id)).limits.market_max_days).toBe(limits.default_days);
      const res = await put({ cash_enabled: true, confirmation_mode: 'SINGLE', custody_max_days: 10 });
      expect(res.policy.custody_max_days).toBe(10);
      expect((await custody.snapshot(db, fx.marketA.id)).limits.market_max_days).toBe(10);
      await expect(put({ cash_enabled: true, confirmation_mode: 'SINGLE', custody_max_days: limits.max_days + 1 }))
        .rejects.toMatchObject({ code: 'CASH_POLICY_CUSTODY_DAYS_ABOVE_CENTRAL', status: 422 });
      await expect(put({ cash_enabled: true, confirmation_mode: 'SINGLE', custody_max_days: 0 }))
        .rejects.toMatchObject({ code: 'CASH_POLICY_CUSTODY_DAYS_INVALID' });
      // champ absent = inchangé ; null = retour au défaut central
      expect((await put({ cash_enabled: true, confirmation_mode: 'DUAL_ALWAYS' })).policy.custody_max_days).toBe(10);
      expect((await put({ cash_enabled: true, confirmation_mode: 'DUAL_ALWAYS', custody_max_days: null })).policy.custody_max_days).toBeNull();
      expect((await custody.snapshot(db, fx.marketA.id)).limits.market_max_days).toBe(limits.default_days);
    });

    it('le Market B n\'hérite pas du délai du Market A', async () => {
      await put({ cash_enabled: true, confirmation_mode: 'SINGLE', custody_max_days: 3 });
      const limits = await custody.centralLimits();
      expect((await custody.snapshot(db, fx.marketB.id)).limits.market_max_days).toBe(limits.default_days);
    });
  });

  describe('lecture Finance (readCustody)', () => {
    it('un lecteur voit habilités, destinations et limites de son Market, pas de gestion', async () => {
      const view = await custody.readCustody(db, { userId: fx.viewerA.id, marketCode: fx.marketA.code });
      expect(view.can_manage).toBe(false);
      expect(view.destinations.every(d => d.id)).toBe(true);
      expect(view.limits.max_holding_kmf).toBeGreaterThan(0);
      const mgr = await custody.readCustody(db, { userId: fx.managerA.id, marketCode: fx.marketA.code });
      expect(mgr.can_manage).toBe(true);
      await expect(custody.readCustody(db, { userId: fx.outsider.id, marketCode: fx.marketA.code }))
        .rejects.toMatchObject({ code: 'MARKET_MEMBERSHIP_REQUIRED' });
    });
  });
}
