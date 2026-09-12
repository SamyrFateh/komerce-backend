/**
 * @komerce-arch
 * @role          cash-confirmation-control-service
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        locked order, authenticated cash actor, confirmation source
 * @outputs       approved cash execution or pending second approval
 * @depends       db.js, market_cash_control_policies
 * @used-by       services/payment-cash-confirm.js, services/cash-operations.js, services/confirm-pickup-cash-payment.js
 * @db-read       market_operating_assignments, market_cash_control_policies, cash_confirmation_controls
 * @db-write      cash_confirmation_controls
 * @db-txn        caller-owned, order_row_must_be_locked
 * @doctrine      cash_truth_requires_shared_guard, dual_approval_is_distinct_actor, in_flight_policy_never_silently_weakened
 * @impact-areas  payment, cash, relay, market-delegation
 * @version       2026-09
 */
'use strict';

function requireClient(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('cash-confirmation-control-service: dbClient.query requis');
  }
  return client;
}

function controlError(code, message, status = 409) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

async function resolveCurrentPolicy(client, marketId) {
  const db = requireClient(client);
  const { rows } = await db.query(
    `SELECT a.id AS assignment_id,
            COALESCE(p.cash_enabled, TRUE) AS cash_enabled,
            COALESCE(p.confirmation_mode, 'SINGLE') AS confirmation_mode,
            CASE WHEN p.id IS NULL THEN 'DEFAULT' ELSE 'MARKET_POLICY' END AS source
       FROM market_operating_assignments a
       LEFT JOIN market_cash_control_policies p ON p.assignment_id = a.id
      WHERE a.market_id=$1::uuid
        AND a.status='ACTIVE'
      LIMIT 1`,
    [marketId]
  );

  if (!rows[0]) {
    return {
      assignment_id: null,
      cash_enabled: true,
      confirmation_mode: 'SINGLE',
      source: 'CENTRAL_FLOOR_ONLY',
    };
  }
  return rows[0];
}

function validateContext(order, actor, source) {
  if (!order?.id) throw controlError('CASH_ORDER_CONTEXT_MISSING', 'Commande cash introuvable.', 404);
  if (!order.market_id) {
    throw controlError('CASH_MARKET_CONTEXT_MISSING', 'Market ID absent de la vérité commande.', 409);
  }
  if (!order.relais_id) {
    throw controlError('CASH_RELAIS_CONTEXT_MISSING', 'Relais absent de la vérité commande.', 409);
  }
  if (!actor?.id) throw controlError('CASH_ACTOR_REQUIRED', 'Acteur cash requis.', 401);
  if (!source || !String(source).trim()) throw new TypeError('cash confirmation source requis');
}

async function getControlForUpdate(client, orderId) {
  const { rows } = await client.query(
    `SELECT *
       FROM cash_confirmation_controls
      WHERE order_id=$1::uuid
      LIMIT 1
      FOR UPDATE`,
    [orderId]
  );
  return rows[0] || null;
}

/**
 * Doit être appelé après verrouillage FOR UPDATE de la commande dans la même transaction.
 * - SINGLE : crée immédiatement un contrôle APPROVED.
 * - DUAL_ALWAYS : premier acteur crée PENDING_SECOND et la transaction peut être commit sans paiement.
 *                  un second acteur distinct transforme le contrôle en APPROVED.
 * - cash_enabled=false bloque tout nouveau passage, y compris une approbation en attente.
 */
async function prepareCashConfirmation({ dbClient, order, actor, source }) {
  const client = requireClient(dbClient);
  validateContext(order, actor, source);

  const policy = await resolveCurrentPolicy(client, order.market_id);
  if (!policy.cash_enabled) {
    return {
      allowed: false,
      blocked: true,
      status: 409,
      code: 'CASH_DISABLED_BY_MARKET_POLICY',
      message: 'Les encaissements cash sont suspendus par la politique du partenaire pays.',
      policy,
    };
  }

  const existing = await getControlForUpdate(client, order.id);
  if (existing) {
    if (existing.state === 'CONFIRMED') {
      return {
        allowed: false,
        blocked: true,
        status: 409,
        code: 'CASH_CONFIRMATION_ALREADY_CONFIRMED',
        message: 'Cet encaissement cash a déjà été confirmé.',
        control: existing,
        policy,
      };
    }
    if (existing.state === 'CANCELLED') {
      return {
        allowed: false,
        blocked: true,
        status: 409,
        code: 'CASH_CONFIRMATION_CANCELLED',
        message: 'Ce contrôle cash a été annulé et doit être traité par une procédure distincte.',
        control: existing,
        policy,
      };
    }
    if (existing.state === 'APPROVED') {
      // Un APPROVED persistant hors de la transaction d'encaissement signale une incohérence.
      // On ne ré-exécute jamais silencieusement une vérité financière.
      return {
        allowed: false,
        blocked: true,
        status: 409,
        code: 'CASH_CONFIRMATION_APPROVED_INCONSISTENT',
        message: 'Contrôle cash déjà approuvé sans finalisation ; vérification requise.',
        control: existing,
        policy,
      };
    }
    if (existing.state === 'PENDING_SECOND') {
      if (String(existing.first_actor_user_id) === String(actor.id)) {
        return {
          allowed: false,
          pending_second: true,
          same_actor: true,
          status: 202,
          code: 'CASH_SECOND_ACTOR_REQUIRED',
          message: 'Une seconde personne habilitée doit confirmer cet encaissement.',
          control: existing,
          policy,
        };
      }

      const { rows } = await client.query(
        `UPDATE cash_confirmation_controls
            SET second_actor_user_id=$2::uuid,
                second_source=$3,
                second_at=NOW(),
                state='APPROVED',
                updated_at=NOW()
          WHERE id=$1::uuid
            AND state='PENDING_SECOND'
          RETURNING *`,
        [existing.id, actor.id, String(source)]
      );
      return {
        allowed: true,
        approved: true,
        second_approval: true,
        control: rows[0],
        policy,
      };
    }
  }

  const requiredApprovals = policy.confirmation_mode === 'DUAL_ALWAYS' ? 2 : 1;
  const state = requiredApprovals === 2 ? 'PENDING_SECOND' : 'APPROVED';
  const { rows } = await client.query(
    `INSERT INTO cash_confirmation_controls
      (order_id, market_id, relais_id, policy_assignment_id, required_approvals,
       state, first_actor_user_id, first_source)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8)
     RETURNING *`,
    [
      order.id,
      order.market_id,
      order.relais_id,
      policy.assignment_id,
      requiredApprovals,
      state,
      actor.id,
      String(source),
    ]
  );

  if (requiredApprovals === 2) {
    return {
      allowed: false,
      pending_second: true,
      same_actor: false,
      status: 202,
      code: 'CASH_SECOND_ACTOR_REQUIRED',
      message: 'Première validation enregistrée. Une seconde personne habilitée doit confirmer.',
      control: rows[0],
      policy,
    };
  }

  return {
    allowed: true,
    approved: true,
    second_approval: false,
    control: rows[0],
    policy,
  };
}

async function finalizeCashConfirmation({ dbClient, orderId }) {
  const client = requireClient(dbClient);
  const { rows } = await client.query(
    `UPDATE cash_confirmation_controls
        SET state='CONFIRMED',
            confirmed_at=NOW(),
            updated_at=NOW()
      WHERE order_id=$1::uuid
        AND state='APPROVED'
      RETURNING *`,
    [orderId]
  );
  if (!rows[0]) {
    throw controlError(
      'CASH_CONFIRMATION_NOT_APPROVED',
      'Le paiement cash ne peut pas être finalisé sans contrôle approuvé.',
      409
    );
  }
  return rows[0];
}

module.exports = {
  resolveCurrentPolicy,
  prepareCashConfirmation,
  finalizeCashConfirmation,
};
