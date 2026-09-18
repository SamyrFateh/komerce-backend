'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/purchase-order-confirmation-boundary.test.js
 *
 * GAP-5 — Execution Evidence Boundary. Confirme qu'une PO n'est jamais
 * marquée `confirmed` sans évidence provider réconciliée pour un provider
 * à réconciliation prouvée (aujourd'hui : Allegro seul) — et que le
 * comportement legacy (confiance non vérifiée) reste strictement
 * inchangé pour tout autre provider.
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/order-mutation-service', () => ({ setSupplierSnapshot: jest.fn() }));

const db = require('../../db');
const providerAuthority = require('../../services/suppliers/provider-authority');
const adapterContract = require('../../services/suppliers/supplier-fulfillment-adapter-contract');
const allegroAdapter = require('../../services/suppliers/allegro-fulfillment-adapter');
const { COMMITMENT_VERDICT, verifyProviderEvidenceForConfirmation } = require('../../services/suppliers/purchase-order-confirmation-boundary');
const { confirmPurchaseOrder } = require('../../services/purchasing-admin-service');

const checkoutId = '29738e61-7f6a-11e8-ac45-09db60ede9d6';
const identity = { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '123' } };

function readyPayload(overrides = {}) {
  return {
    id: checkoutId,
    status: 'READY_FOR_PROCESSING',
    revision: '819b5836',
    lineItems: [{
      id: 'line-1',
      offer: { id: '123', name: 'Sandbox product' },
      quantity: 1,
      price: { amount: '10.00', currency: 'PLN' },
      boughtAt: '2026-09-16T10:00:00.000Z',
    }],
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// provider-authority.js — reconciliationRequirement
// ═════════════════════════════════════════════════════════════════════════════

describe('provider-authority — reconciliationRequirement', () => {
  test('allegro → REQUIRED (réconciliation réelle, prouvée par le Golden)', () => {
    expect(providerAuthority.reconciliationRequirement('allegro')).toBe(providerAuthority.PREFLIGHT_REQUIREMENT.REQUIRED);
  });

  test.each(['aliexpress', 'noon', 'amazon_uae', 'local', 'whatsapp'])(
    '%s → NOT_REQUIRED (aucun mécanisme de réconciliation construit à ce jour)',
    (provider) => {
      expect(providerAuthority.reconciliationRequirement(provider)).toBe(providerAuthority.PREFLIGHT_REQUIREMENT.NOT_REQUIRED);
    }
  );

  test('provider inconnu → UNKNOWN (fail-closed)', () => {
    expect(providerAuthority.reconciliationRequirement('totally_unknown')).toBe(providerAuthority.PREFLIGHT_REQUIREMENT.UNKNOWN);
  });

  test('reconciliationRequirement et remotePreflightRequirement sont deux axes indépendants', () => {
    // aliexpress a un preflight REQUIRED mais une réconciliation NOT_REQUIRED —
    // preuve que ce ne sont pas la même capability sous un autre nom.
    expect(providerAuthority.remotePreflightRequirement('aliexpress')).toBe(providerAuthority.PREFLIGHT_REQUIREMENT.REQUIRED);
    expect(providerAuthority.reconciliationRequirement('aliexpress')).toBe(providerAuthority.PREFLIGHT_REQUIREMENT.NOT_REQUIRED);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// supplier-fulfillment-adapter-contract.js — validateReconciliationAdapter
// ═════════════════════════════════════════════════════════════════════════════

describe('adapter-contract — validateReconciliationAdapter', () => {
  test('adapter complet avec reconcile() → ok', () => {
    const out = adapterContract.validateReconciliationAdapter('allegro', allegroAdapter);
    expect(out.ok).toBe(true);
    expect(out.adapter).toBe(allegroAdapter);
  });

  test('adapter sans reconcile() → rejeté explicitement', () => {
    const incomplete = { provider: 'x', evaluate: async () => ({}) };
    const out = adapterContract.validateReconciliationAdapter('x', incomplete);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/reconcile/);
  });

  test('adapter absent → rejeté (pas un crash)', () => {
    const out = adapterContract.validateReconciliationAdapter('allegro', undefined);
    expect(out.ok).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// allegro-fulfillment-adapter.js — reconcile()
// ═════════════════════════════════════════════════════════════════════════════

describe('allegro-fulfillment-adapter — reconcile()', () => {
  test('évidence valide → commitment_verdict committed, le cœur ne voit jamais READY_FOR_PROCESSING', async () => {
    const client = { getSellerOrder: jest.fn(async () => readyPayload()) };
    const out = await allegroAdapter.reconcile({
      externalRef: checkoutId,
      identity,
      supplierUnitRef: '123',
      supplierSku: 'allegro-sandbox:123',
      quantity: 1,
      context: { allegroSandboxClient: client },
    });
    expect(out).toMatchObject({
      provider: 'allegro',
      external_ref: checkoutId,
      commitment_verdict: 'committed',
    });
    expect(out.evidence.provider_status).toBe('READY_FOR_PROCESSING');
    // Le verdict lui-même ne porte jamais le statut natif brut.
    expect(out.commitment_verdict).not.toBe('READY_FOR_PROCESSING');
  });

  test('statut natif non prêt (BOUGHT) → commitment_verdict rejected, jamais une exception qui remonte', async () => {
    const client = { getSellerOrder: jest.fn(async () => readyPayload({ status: 'BOUGHT' })) };
    const out = await allegroAdapter.reconcile({
      externalRef: checkoutId, identity, supplierUnitRef: '123', supplierSku: 'allegro-sandbox:123',
      quantity: 1, context: { allegroSandboxClient: client },
    });
    expect(out.commitment_verdict).toBe('rejected');
    expect(out.evidence.reason).toMatch(/ALLEGRO_RECONCILIATION_NOT_READY/);
  });

  test('mismatch identité/offre → rejected, pas de throw', async () => {
    const client = { getSellerOrder: jest.fn(async () => readyPayload()) };
    const out = await allegroAdapter.reconcile({
      externalRef: checkoutId,
      identity: { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '999' } },
      supplierUnitRef: '999', supplierSku: 'allegro-sandbox:999',
      quantity: 1, context: { allegroSandboxClient: client },
    });
    expect(out.commitment_verdict).toBe('rejected');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// purchase-order-confirmation-boundary.js — verifyProviderEvidenceForConfirmation
// ═════════════════════════════════════════════════════════════════════════════

describe('purchase-order-confirmation-boundary — verifyProviderEvidenceForConfirmation', () => {
  test('sans identité (PO legacy) → required:false, comportement historique préservé', async () => {
    const out = await verifyProviderEvidenceForConfirmation({ identity: null, externalRef: 'ANYTHING' });
    expect(out).toEqual({ required: false, provider: null });
  });

  test('provider sans réconciliation prouvée (aliexpress) → required:false', async () => {
    const out = await verifyProviderEvidenceForConfirmation({
      identity: { provider: 'aliexpress', version: 1, payload: {} },
      externalRef: 'ANYTHING',
    });
    expect(out).toEqual({ required: false, provider: 'aliexpress' });
  });

  test('allegro + adapter absent du registry → required:true, rejected, jamais un crash', async () => {
    const out = await verifyProviderEvidenceForConfirmation({
      identity, externalRef: checkoutId, adapters: {},
    });
    expect(out.required).toBe(true);
    expect(out.commitment_verdict).toBe(COMMITMENT_VERDICT.REJECTED);
    expect(out.evidence.reason).toBe('RECONCILIATION_ADAPTER_UNAVAILABLE');
  });

  test('allegro sans externalRef fourni → required:true, rejected explicite (pas d\'adapter appelé)', async () => {
    const reconcileSpy = jest.fn();
    const out = await verifyProviderEvidenceForConfirmation({
      identity, externalRef: null, adapters: { allegro: { ...allegroAdapter, reconcile: reconcileSpy } },
    });
    expect(out.commitment_verdict).toBe(COMMITMENT_VERDICT.REJECTED);
    expect(out.evidence.reason).toBe('EXTERNAL_REF_REQUIRED');
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  test('allegro + evidence réconciliée committed → required:true, verdict transmis tel quel', async () => {
    const client = { getSellerOrder: jest.fn(async () => readyPayload()) };
    const out = await verifyProviderEvidenceForConfirmation({
      identity, externalRef: checkoutId, supplierUnitRef: '123', supplierSku: 'allegro-sandbox:123',
      quantity: 1, adapters: { allegro: allegroAdapter }, context: { allegroSandboxClient: client },
    });
    expect(out.required).toBe(true);
    expect(out.commitment_verdict).toBe(COMMITMENT_VERDICT.COMMITTED);
    expect(out.external_ref).toBe(checkoutId);
  });

  test('provider inconnu de provider-authority → required:true, rejected (fail-closed sur UNKNOWN)', async () => {
    const out = await verifyProviderEvidenceForConfirmation({
      identity: { provider: 'totally_unknown', version: 1, payload: {} }, externalRef: 'X',
    });
    expect(out.commitment_verdict).toBe(COMMITMENT_VERDICT.REJECTED);
    expect(out.evidence.reason).toBe('RECONCILIATION_REQUIREMENT_UNKNOWN');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// purchasing-admin-service.js — confirmPurchaseOrder, provider allegro
// ═════════════════════════════════════════════════════════════════════════════

function makeDbQueue(results) {
  const queue = [...results];
  return jest.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('No mock query result queued');
    return next;
  });
}

describe('confirmPurchaseOrder — provider allegro (réconciliation requise)', () => {
  test('évidence committed → PO confirmée avec la external_ref vérifiée, jamais la valeur brute non vérifiée', async () => {
    const client = { getSellerOrder: jest.fn(async () => readyPayload()) };
    db.query = makeDbQueue([
      { rows: [{
        id: 'po-uuid', status: 'notified',
        supplier_order_identity: identity, supplier_unit_ref: '123',
        supplier_sku: 'allegro-sandbox:123', qty: 1,
      }] }, // SELECT PO
      { rows: [{ id: 'po-uuid', order_id: 'order-uuid', supplier_id: 'sup-uuid', status: 'confirmed', supplier_order_id: checkoutId }] }, // UPDATE
      { rows: [{ name: 'Allegro' }] }, // SELECT supplier name
      { rows: [] }, // UPDATE orders supplier_name
    ]);

    const result = await confirmPurchaseOrder(
      'po-uuid', 'order-uuid',
      { supplier_order_id: checkoutId },
      { context: { allegroSandboxClient: client } }
    );

    expect(result.success).toBe(true);
    expect(client.getSellerOrder).toHaveBeenCalledWith(checkoutId);
    // Le paramètre $1 de l'UPDATE doit être la external_ref réconciliée
    // (identique ici car le provider valide déjà leur égalité), pas la
    // valeur brute non vérifiée passée en entrée — les deux coïncident
    // par construction dans ce cas, la distinction est prouvée par le
    // test suivant (rejet).
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE purchase_orders'),
      expect.arrayContaining([checkoutId])
    );
  });

  test('évidence rejetée → throw 409, la PO reste NON confirmée (aucun UPDATE tenté)', async () => {
    // Client mocké renvoyant une évidence RÉELLE mais dont l'id de checkout
    // ne correspond pas à la référence fournie — prouve un rejet de la
    // LOGIQUE de réconciliation, pas un garde-fou d'environnement
    // incident (ex. sandbox désactivé) qui rejetterait pour une tout
    // autre raison.
    const client = { getSellerOrder: jest.fn(async () => readyPayload({ id: 'a-different-checkout-id' })) };
    db.query = makeDbQueue([
      { rows: [{
        id: 'po-uuid', status: 'notified',
        supplier_order_identity: identity, supplier_unit_ref: '123',
        supplier_sku: 'allegro-sandbox:123', qty: 1,
      }] }, // SELECT PO — aucune autre query ne doit être consommée
    ]);

    await expect(confirmPurchaseOrder(
      'po-uuid', 'order-uuid',
      { supplier_order_id: checkoutId },
      { context: { allegroSandboxClient: client } }
    )).rejects.toMatchObject({ status: 409 });
  });

  test('évidence rejetée : aucun appel UPDATE n\'est fait (fail-closed avant écriture)', async () => {
    const client = { getSellerOrder: jest.fn(async () => readyPayload({ id: 'a-different-checkout-id' })) };
    const queries = [];
    db.query = jest.fn(async (sql) => {
      queries.push(sql);
      if (queries.length === 1) {
        return { rows: [{
          id: 'po-uuid', status: 'notified',
          supplier_order_identity: identity, supplier_unit_ref: '123',
          supplier_sku: 'allegro-sandbox:123', qty: 1,
        }] };
      }
      throw new Error('UPDATE ne devrait jamais être atteint après un rejet de réconciliation');
    });

    await expect(confirmPurchaseOrder(
      'po-uuid', 'order-uuid',
      { supplier_order_id: checkoutId },
      { context: { allegroSandboxClient: client } }
    )).rejects.toMatchObject({ status: 409 });
    expect(queries).toHaveLength(1);
  });
});

describe('confirmPurchaseOrder — non-régression : provider sans réconciliation prouvée', () => {
  test('PO sans supplier_order_identity (legacy) → comportement historique exact, aucun appel réconciliation', async () => {
    db.query = makeDbQueue([
      { rows: [{ id: 'po-uuid', status: 'pending' }] }, // SELECT (pas d'identity dans le mock — cas legacy réel)
      { rows: [{ id: 'po-uuid', order_id: 'order-uuid', supplier_id: 'sup-uuid', status: 'confirmed', supplier_order_id: 'SUP-123' }] },
      { rows: [{ name: 'Noon Wholesale' }] },
      { rows: [] },
    ]);

    const result = await confirmPurchaseOrder('po-uuid', 'order-uuid', { supplier_order_id: 'SUP-123' });
    expect(result.success).toBe(true);
    expect(result.purchase_order.status).toBe('confirmed');
  });
});
