'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  prepareCashConfirmation,
  finalizeCashConfirmation,
} = require('../../services/cash-confirmation-control-service');

function executor(results) {
  const queue = [...results];
  return {
    query: jest.fn(async () => {
      if (!queue.length) throw new Error('unexpected query');
      return queue.shift();
    }),
  };
}

const ORDER = Object.freeze({
  id: '11111111-1111-1111-1111-111111111111',
  market_id: '22222222-2222-2222-2222-222222222222',
  relais_id: '33333333-3333-3333-3333-333333333333',
});
const ACTOR_A = Object.freeze({ id: '44444444-4444-4444-4444-444444444444', role: 'agent_relais' });
const ACTOR_B = Object.freeze({ id: '55555555-5555-5555-5555-555555555555', role: 'agent_relais' });

function policy(mode = 'SINGLE', enabled = true) {
  return {
    rows: [{
      assignment_id: '66666666-6666-6666-6666-666666666666',
      cash_enabled: enabled,
      confirmation_mode: mode,
      source: 'MARKET_POLICY',
    }],
  };
}

describe('cash-confirmation-control-service', () => {
  test('SINGLE crée une approbation immédiatement exécutable', async () => {
    const db = executor([
      policy('SINGLE'),
      { rows: [] },
      { rows: [{ id: 'ctrl-1', state: 'APPROVED', required_approvals: 1, first_actor_user_id: ACTOR_A.id }] },
    ]);

    const result = await prepareCashConfirmation({
      dbClient: db, order: ORDER, actor: ACTOR_A, source: 'unit',
    });

    expect(result.allowed).toBe(true);
    expect(result.control.required_approvals).toBe(1);
    expect(db.query.mock.calls[2][0]).toContain('INSERT INTO cash_confirmation_controls');
  });

  test('DUAL_ALWAYS enregistre seulement le premier visa et exige un autre acteur', async () => {
    const db = executor([
      policy('DUAL_ALWAYS'),
      { rows: [] },
      { rows: [{ id: 'ctrl-2', state: 'PENDING_SECOND', required_approvals: 2, first_actor_user_id: ACTOR_A.id }] },
    ]);

    const result = await prepareCashConfirmation({
      dbClient: db, order: ORDER, actor: ACTOR_A, source: 'cash_collect',
    });

    expect(result).toMatchObject({
      allowed: false,
      pending_second: true,
      same_actor: false,
      status: 202,
      code: 'CASH_SECOND_ACTOR_REQUIRED',
    });
  });

  test('le même acteur ne peut pas fournir le second visa', async () => {
    const pending = {
      id: 'ctrl-3',
      order_id: ORDER.id,
      state: 'PENDING_SECOND',
      required_approvals: 2,
      first_actor_user_id: ACTOR_A.id,
    };
    const db = executor([
      policy('DUAL_ALWAYS'),
      { rows: [pending] },
    ]);

    const result = await prepareCashConfirmation({
      dbClient: db, order: ORDER, actor: ACTOR_A, source: 'payments_cash_confirm',
    });

    expect(result).toMatchObject({ allowed: false, pending_second: true, same_actor: true });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('un contrôle DUAL en cours reste DUAL même si la politique courante repasse SINGLE', async () => {
    const pending = {
      id: '77777777-7777-7777-7777-777777777777',
      order_id: ORDER.id,
      state: 'PENDING_SECOND',
      required_approvals: 2,
      first_actor_user_id: ACTOR_A.id,
    };
    const approved = {
      ...pending,
      state: 'APPROVED',
      second_actor_user_id: ACTOR_B.id,
      second_source: 'pickup_pay_cash',
      second_at: new Date().toISOString(),
    };
    const db = executor([
      policy('SINGLE'),
      { rows: [pending] },
      { rows: [approved] },
    ]);

    const result = await prepareCashConfirmation({
      dbClient: db, order: ORDER, actor: ACTOR_B, source: 'pickup_pay_cash',
    });

    expect(result).toMatchObject({ allowed: true, approved: true, second_approval: true });
    expect(result.control.required_approvals).toBe(2);
    expect(result.control.second_actor_user_id).toBe(ACTOR_B.id);
  });

  test('cash_enabled=false bloque avant toute création de vérité de contrôle', async () => {
    const db = executor([policy('SINGLE', false)]);
    const result = await prepareCashConfirmation({
      dbClient: db, order: ORDER, actor: ACTOR_A, source: 'unit',
    });

    expect(result).toMatchObject({
      allowed: false,
      blocked: true,
      code: 'CASH_DISABLED_BY_MARKET_POLICY',
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('finalize ne confirme qu’un contrôle APPROVED', async () => {
    const db = executor([{ rows: [{ order_id: ORDER.id, state: 'CONFIRMED', required_approvals: 2 }] }]);
    const result = await finalizeCashConfirmation({ dbClient: db, orderId: ORDER.id });
    expect(result.state).toBe('CONFIRMED');
    expect(db.query.mock.calls[0][0]).toContain("AND state='APPROVED'");
  });

  test('finalize échoue fort si aucun contrôle APPROVED n’existe', async () => {
    const db = executor([{ rows: [] }]);
    await expect(finalizeCashConfirmation({ dbClient: db, orderId: ORDER.id }))
      .rejects.toMatchObject({ code: 'CASH_CONFIRMATION_NOT_APPROVED', status: 409 });
  });

  test('le contrôle ne contient aucun montant fourni par le client', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/cash-confirmation-control-service.js'),
      'utf8'
    );
    expect(source).not.toMatch(/amount_kmf|amount_minor|payment_total_amount/);
  });

  test('la migration impose aussi la séparation des acteurs et les approbations en DB', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../migrations/199_cash_confirmation_control.sql'),
      'utf8'
    );
    expect(source).toContain('second_actor_user_id <> first_actor_user_id');
    expect(source).toMatch(/state = 'CONFIRMED'[\s\S]*required_approvals = 2 AND second_actor_user_id IS NOT NULL/);
    expect(source).toContain('UNIQUE REFERENCES orders(id)');
  });
});
