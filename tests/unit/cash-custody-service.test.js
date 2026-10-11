'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockResolve = jest.fn();
const mockAudit = jest.fn();
jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: (...a) => mockResolve(...a),
  audit: (...a) => mockAudit(...a),
}));
const mockRule = jest.fn();
jest.mock('../../utils/rules', () => ({ getRuleNumber: (...a) => mockRule(...a) }));

const service = require('../../services/cash-custody-service');

const authz = { market_id: 'm1', assignment_id: 'a1', membership_id: 'mb1', currency: 'KMF', capabilities: ['finance.read', 'cash_control.policy.manage'] };
const fakeDb = (...results) => {
  const query = jest.fn();
  results.forEach(r => (r instanceof Error ? query.mockRejectedValueOnce(r) : query.mockResolvedValueOnce(r)));
  return { query };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResolve.mockResolvedValue(authz);
  mockRule.mockImplementation(async (_k, d) => d);
});

test('limites centrales : défauts, surcharge business_rules, défaut jamais au-dessus du plafond central', async () => {
  expect(await service.centralLimits()).toEqual({ max_holding_kmf: 5000000, default_holding_kmf: 1000000, max_days: 30, default_days: 7 });
  mockRule.mockImplementation(async k => ({ CASH_CUSTODY_MAX_HOLDING_KMF: 100, CASH_CUSTODY_DEFAULT_HOLDING_KMF: 500, CASH_CUSTODY_MAX_DAYS: 2, CASH_CUSTODY_DEFAULT_DAYS: 9 }[k]));
  expect(await service.centralLimits()).toEqual({ max_holding_kmf: 100, default_holding_kmf: 100, max_days: 2, default_days: 2 });
});

test('bornage du délai et du plafond de détention', () => {
  const limits = { max_holding_kmf: 100, default_holding_kmf: 40, max_days: 10, default_days: 5 };
  expect(service.boundDays(null, limits)).toBe(5);
  expect(service.boundDays(3, limits)).toBe(3);
  expect(service.boundDays(99, limits)).toBe(10);
  expect(service.boundHolding(null, limits)).toBe(40);
  expect(service.boundHolding('70.5', limits)).toBe(70.5);
  expect(service.boundHolding(1e9, limits)).toBe(100);
});

test('listRecipients / assertAuthorizedRecipient : habilité accepté, autre refusé', async () => {
  const row = { membership_id: 'mb', user_id: 'u1', full_name: 'Ali', role: 'client', limit_amount: '250000', granted_at: 't' };
  const list = await service.listRecipients(fakeDb({ rows: [row] }), 'm1');
  expect(list[0]).toMatchObject({ user_id: 'u1', holding_limit_kmf: 250000 });
  await expect(service.assertAuthorizedRecipient(fakeDb({ rows: [row] }), { marketId: 'm1', userId: 'u1' })).resolves.toMatchObject({ user_id: 'u1' });
  await expect(service.assertAuthorizedRecipient(fakeDb({ rows: [row] }), { marketId: 'm1', userId: 'u2' }))
    .rejects.toMatchObject({ code: 'custody_recipient_not_authorized', status: 403 });
});

test('assertActiveDestination : seule une destination ACTIVE du Market est acceptée', async () => {
  await expect(service.assertActiveDestination(fakeDb({ rows: [{ id: 'd', status: 'ACTIVE' }] }), { marketId: 'm1', destinationId: 'd' })).resolves.toMatchObject({ id: 'd' });
  await expect(service.assertActiveDestination(fakeDb({ rows: [{ id: 'd', status: 'PROPOSED' }] }), { marketId: 'm1', destinationId: 'd' })).rejects.toMatchObject({ status: 409 });
  await expect(service.assertActiveDestination(fakeDb({ rows: [] }), { marketId: 'm1', destinationId: 'd' })).rejects.toMatchObject({ code: 'custody_destination_not_active' });
});

test('délai de garde du Market : valeur configurée bornée, sinon défaut', async () => {
  const limits = { max_days: 10, default_days: 5 };
  expect(await service.marketCustodyDays(fakeDb({ rows: [{ custody_max_days: 30 }] }), 'm1', limits)).toBe(10);
  expect(await service.marketCustodyDays(fakeDb({ rows: [] }), 'm1', limits)).toBe(5);
});

test('readCustody exige finance.read et expose can_manage', async () => {
  const db = fakeDb({ rows: [] }, { rows: [] }, { rows: [] });
  const view = await service.readCustody(db, { userId: 'u', marketCode: 'KM' });
  expect(mockResolve).toHaveBeenCalledWith(db, { userId: 'u', marketCode: 'KM', requiredCapability: 'finance.read' });
  expect(view).toMatchObject({ can_manage: true, recipients: [], destinations: [] });
});

describe('proposeDestination', () => {
  const base = { kind: 'bank', label: 'Banque', account_ref: 'IBAN …1234' };
  test('succès : audité, devise du Market par défaut', async () => {
    const db = fakeDb({ rows: [{ id: 'd1', status: 'PROPOSED' }] });
    const res = await service.proposeDestination(db, { userId: 'u', marketCode: 'KM', payload: base });
    expect(res.id).toBe('d1');
    expect(db.query.mock.calls[0][1]).toEqual(['m1', 'BANK', 'Banque', 'KMF', 'IBAN …1234', null, 'u']);
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_DESTINATION_PROPOSED', marketId: 'm1' }));
  });
  test('refus : type, devise, champs, doublon, contrainte, erreur inconnue', async () => {
    const run = (payload, db = fakeDb({ rows: [] })) => service.proposeDestination(db, { userId: 'u', marketCode: 'KM', payload });
    await expect(run({ ...base, kind: 'CASH' })).rejects.toMatchObject({ code: 'custody_destination_kind_invalid' });
    await expect(run({ ...base, currency: 'euro' })).rejects.toMatchObject({ code: 'custody_destination_field_invalid' });
    await expect(run({ ...base, label: 'x' })).rejects.toMatchObject({ code: 'custody_destination_field_invalid' });
    await expect(run(base, fakeDb(Object.assign(new Error('dup'), { code: '23505' })))).rejects.toMatchObject({ code: 'custody_destination_exists', status: 409 });
    await expect(run(base, fakeDb(Object.assign(new Error('chk'), { code: '23514' })))).rejects.toMatchObject({ status: 422 });
    await expect(run(base, fakeDb(new Error('boom')))).rejects.toThrow('boom');
  });
});

describe('transitionDestination', () => {
  const row = (status, proposedBy = 'p') => ({ rows: [{ id: 'd', status, proposed_by: proposedBy }] });
  const run = (db, verb, extra = {}) => service.transitionDestination(db, { userId: 'u', marketCode: 'KM', destinationId: 'd', verb, ...extra });
  test('activation par un autre que le proposant, auditée', async () => {
    const db = fakeDb(row('PROPOSED'), { rows: [{ id: 'd', status: 'ACTIVE' }] });
    expect(await run(db, 'activate')).toMatchObject({ status: 'ACTIVE' });
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_DESTINATION_ACTIVATED', before: { status: 'PROPOSED' } }));
  });
  test('refus : verbe inconnu, introuvable, transition, même acteur, motif manquant', async () => {
    await expect(run(fakeDb(), 'x')).rejects.toMatchObject({ code: 'custody_destination_action_invalid' });
    await expect(run(fakeDb({ rows: [] }), 'activate')).rejects.toMatchObject({ status: 404 });
    await expect(run(fakeDb(row('CLOSED')), 'activate')).rejects.toMatchObject({ code: 'custody_destination_transition_forbidden' });
    await expect(run(fakeDb(row('PROPOSED', 'u')), 'activate')).rejects.toMatchObject({ code: 'custody_destination_two_actors_required', status: 403 });
    await expect(run(fakeDb(row('ACTIVE')), 'suspend')).rejects.toMatchObject({ code: 'custody_destination_reason_required' });
    await expect(run(fakeDb(row('ACTIVE')), 'close', { reason: 'ab' })).rejects.toMatchObject({ code: 'custody_destination_reason_required' });
  });
  test('suspension et clôture motivées', async () => {
    const db = fakeDb(row('ACTIVE'), { rows: [{ id: 'd', status: 'SUSPENDED' }] });
    expect(await run(db, 'suspend', { reason: 'doute' })).toMatchObject({ status: 'SUSPENDED' });
    expect(db.query.mock.calls[1][1]).toEqual(['d', 'SUSPENDED', 'u', 'doute']);
  });
});

// ─── PR 4b : soldes, réceptions, contrôle, pertes ──────────────────────────
// Base scriptée par motif SQL (ordre indépendant) ; chaque valeur peut être une erreur.
const routedDb = (routes, fallback = { rows: [] }) => ({
  query: jest.fn(async (sql, params) => {
    const sqlText = String(sql);
    for (const [pattern, result] of routes) {
      if (pattern.test(sqlText)) {
        const value = typeof result === 'function' ? result(params, sqlText) : result;
        if (value instanceof Error) throw value;
        return value;
      }
    }
    return fallback;
  }),
});
const lockRoute = [/FROM cash_deposits\s+WHERE deposit_ref/, { rows: [{ id: 'dep', deposit_ref: 'KDP-1', movement_kind: 'TRANSFER', agent_id: 'ag', recipient_user_id: 'rc', amount_kmf: '1000.00' }] }];
const receiptRow = { id: 'rcp', kind: 'RECEIVED', amount_kmf: '800.00', received_amount: '800', received_currency: 'KMF', fx_rate_to_kmf: '1', created_at: 't' };
const insertRoute = [/INSERT INTO cash_custody_receipts/, { rows: [receiptRow] }];
const recipientsRoute = (limit = '5000') => [/FROM market_operating_assignments a/, { rows: [{ membership_id: 'mb', user_id: 'rc', full_name: 'Rec', role: 'client', limit_amount: limit, granted_at: 't' }] }];

test('mapDbError : invariants SQL → erreurs métier ; le reste est conservé', () => {
  const same = new service.CashCustodyError('x', 'y');
  expect(service.mapDbError(same)).toBe(same);
  expect(service.mapDbError(Object.assign(new Error('cash_custody: solde négatif interdit pour u'), { code: '23514' })))
    .toMatchObject({ code: 'custody_insufficient_holding', status: 409, message: 'solde négatif interdit pour u' });
  expect(service.mapDbError(Object.assign(new Error('cash_custody_receipts: seul le destinataire'), { code: '23514' })))
    .toMatchObject({ code: 'custody_rule_violation' });
  expect(service.mapDbError(Object.assign(new Error('cash_deposits: statut'), { code: '23001' }))).toMatchObject({ code: 'custody_rule_violation' });
  expect(service.mapDbError(Object.assign(new Error('dup'), { code: '23505' }))).toMatchObject({ code: 'custody_already_resolved' });
  const other = new Error('boom');
  expect(service.mapDbError(other)).toBe(other);
  const foreign = Object.assign(new Error('autre: x'), { code: '23514' });
  expect(service.mapDbError(foreign)).toBe(foreign);
  expect(service.mapDbError(undefined)).toBeUndefined();
});

test('holdingOf : solde canonique par détenteur et Market', async () => {
  const db = routedDb([[/FROM cash_custody_movements/, { rows: [{ balance: '42500.50' }] }]]);
  expect(await service.holdingOf(db, 'u', 'm1')).toBe(42500.5);
  expect(db.query.mock.calls[0][1]).toEqual(['u', 'm1']);
});

test('holdings : qui détient quoi, depuis quand (FIFO), plafond, délai, dépassements', async () => {
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  const fresh = new Date(Date.now() - 1 * 86400000).toISOString();
  const db = routedDb([
    [/WITH m AS/, { rows: [
      { holder_id: 'rc', full_name: 'Rec', role: 'client', balance_kmf: '9000', since: fresh },
      { holder_id: 'ag', full_name: 'Agent', role: 'agent_relais', balance_kmf: '300', since: old },
      { holder_id: 'zz', full_name: 'Sans date', role: 'client', balance_kmf: '10', since: null },
    ] }],
    [/custody_max_days FROM market_cash_control_policies/, { rows: [{ custody_max_days: 3 }] }],
    recipientsRoute('5000'),
  ]);
  const rows = await service.holdings(db, 'm1');
  expect(rows[0]).toMatchObject({ holder_id: 'rc', balance_kmf: 9000, ceiling_kmf: 5000, habilitated: true, over_ceiling: true, overdue: false, max_days: 3 });
  expect(rows[1]).toMatchObject({ holder_id: 'ag', ceiling_kmf: 1000000, habilitated: false, over_ceiling: false, overdue: true });
  expect(rows[1].held_days).toBeGreaterThanOrEqual(19);
  expect(rows[2]).toMatchObject({ held_days: 0, overdue: false });
});

test('overdueHoldings : uniquement hors plafond ou hors délai, tous Markets', async () => {
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  const db = routedDb([
    [/SELECT DISTINCT market_id/, { rows: [{ id: 'm1' }, { id: 'm2' }] }],
    [/WITH m AS/, (params) => ({ rows: params[0] === 'm1' ? [{ holder_id: 'ag', full_name: 'A', role: 'r', balance_kmf: '50', since: old }] : [{ holder_id: 'ok', full_name: 'B', role: 'r', balance_kmf: '5', since: new Date().toISOString() }] })],
  ]);
  const rows = await service.overdueHoldings(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ market_id: 'm1', holder_id: 'ag', overdue: true });
});

test('legacyToRegularize : reste à régulariser, nul exclu, montants numériques', async () => {
  const db = routedDb([[/movement_kind = 'LEGACY' AND d\.status = 'verified'/, { rows: [
    { deposit_ref: 'K1', amount_kmf: '1000', remaining_kmf: '400' },
    { deposit_ref: 'K2', amount_kmf: '500', remaining_kmf: '0' },
  ] }]]);
  expect(await service.legacyToRegularize(db, 'm1')).toEqual([{ deposit_ref: 'K1', amount_kmf: 1000, remaining_kmf: 400 }]);
});

test('custodyState : état métier dérivé des seuls faits', () => {
  const s = row => service.custodyState(row);
  expect(s({ refusal_reason: 'non' })).toBe('REFUSED');
  expect(s({ movement_kind: 'TRANSFER' })).toBe('DECLARED');
  expect(s({ movement_kind: 'TRANSFER', received_id: 'r', received_net_kmf: 100, amount_kmf: 100 })).toBe('ACCEPTED');
  expect(s({ movement_kind: 'TRANSFER', received_id: 'r', received_net_kmf: 90, amount_kmf: 100 })).toBe('ACCEPTED_PARTIAL');
  expect(s({ movement_kind: 'FINAL' })).toBe('AWAITING_PROOF');
  expect(s({ movement_kind: 'FINAL', received_id: 'r' })).toBe('TO_CONTROL');
  expect(s({ movement_kind: 'FINAL', received_id: 'r', control_id: 'c', controlled_net_kmf: 50 })).toBe('CLOSED');
  expect(s({ movement_kind: 'FINAL', received_id: 'r', control_id: 'c', controlled_net_kmf: 0 })).toBe('CONTROL_REJECTED');
});

test('transferRows : annoncé, reçu net, écart et état', async () => {
  const db = routedDb([[/FROM cash_deposits d\s+JOIN users ua/, { rows: [
    { deposit_ref: 'K1', movement_kind: 'TRANSFER', amount_kmf: '1000', received_id: 'r', received_net_kmf: '900' },
    { deposit_ref: 'K2', movement_kind: 'TRANSFER', amount_kmf: '500', received_id: null },
    { deposit_ref: 'K3', movement_kind: 'FINAL', amount_kmf: '300', received_id: 'r', received_net_kmf: '300', control_id: 'c', controlled_net_kmf: '300' },
  ] }]]);
  const rows = await service.transferRows(db, 'm1');
  expect(rows[0]).toMatchObject({ received_net_kmf: 900, discrepancy_kmf: 100, state: 'ACCEPTED_PARTIAL', controlled_net_kmf: null });
  expect(rows[1]).toMatchObject({ received_net_kmf: null, discrepancy_kmf: null, state: 'DECLARED' });
  expect(rows[2]).toMatchObject({ controlled_net_kmf: 300, state: 'CLOSED' });
  expect(db.query.mock.calls[0][1]).toEqual(['m1', 200]);
});

describe('recordReceipt', () => {
  const base = { actorId: 'rc', marketId: 'm1', depositRef: 'KDP-1' };

  test('remise inconnue, historique ou hors Market : 404 ; issue inconnue ou montant invalide : 400', async () => {
    await expect(service.recordReceipt(routedDb([]), { ...base, outcome: 'received', receivedAmount: 1 })).rejects.toMatchObject({ code: 'custody_deposit_not_found', status: 404 });
    await expect(service.recordReceipt(routedDb([[lockRoute[0], { rows: [{ id: 'd', movement_kind: 'LEGACY' }] }]]), { ...base, outcome: 'received', receivedAmount: 1 }))
      .rejects.toMatchObject({ code: 'custody_deposit_not_found' });
    await expect(service.recordReceipt(routedDb([lockRoute]), { ...base, outcome: 'maybe' })).rejects.toMatchObject({ code: 'custody_outcome_invalid' });
    await expect(service.recordReceipt(routedDb([lockRoute]), { ...base, outcome: 'received', receivedAmount: 0 })).rejects.toMatchObject({ code: 'custody_received_amount_invalid' });
  });

  test('refus motivé : fait REFUSED + audit, aucune responsabilité transférée', async () => {
    const db = routedDb([lockRoute, [lockRoute[0], lockRoute[1]], [/INSERT INTO cash_custody_receipts/, { rows: [{ id: 'rf', kind: 'REFUSED' }] }]]);
    const res = await service.recordReceipt(db, { ...base, outcome: 'refused', reason: 'Billets non reçus' });
    expect(res).toEqual({ deposit_ref: 'KDP-1', state: 'REFUSED', receipt_id: 'rf' });
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_TRANSFER_REFUSED', marketId: 'm1', after: { deposit_ref: 'KDP-1', reason: 'Billets non reçus' } }));
  });

  test('transfert accepté : plafond du receveur vérifié AVANT le transfert, écart calculé, audit des montants figés', async () => {
    const db = routedDb([
      lockRoute, recipientsRoute('5000'),
      [/SELECT CASE WHEN \$2::numeric = declared_amount/, { rows: [{ nominal: '800' }] }],
      [/SELECT COALESCE\(SUM\(delta_kmf\), 0\)::numeric AS balance/, { rows: [{ balance: '1000' }] }],
      insertRoute,
    ]);
    const res = await service.recordReceipt(db, { ...base, outcome: 'received', receivedAmount: 800, proofRef: 'R-1' });
    expect(res).toMatchObject({ state: 'ACCEPTED_PARTIAL', received_kmf: 800, discrepancy_kmf: 200, received_currency: 'KMF' });
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_TRANSFER_RECEIVED', capability: 'cash.custody.receive',
      after: expect.objectContaining({ received_kmf: '800.00', announced_kmf: '1000.00', discrepancy_kmf: 200, proof_ref: 'R-1' }) }));
    const complete = routedDb([lockRoute, recipientsRoute('5000'), [/SELECT CASE WHEN/, { rows: [{ nominal: '1000' }] }], [/COALESCE\(SUM\(delta_kmf\)/, { rows: [{ balance: '0' }] }],
      [insertRoute[0], { rows: [{ ...receiptRow, amount_kmf: '1000.00' }] }]]);
    expect((await service.recordReceipt(complete, { ...base, outcome: 'received', receivedAmount: 1000 }))).toMatchObject({ state: 'ACCEPTED', discrepancy_kmf: 0 });
  });

  test('plafond dépassé ou destinataire non habilité : refus avant tout fait', async () => {
    const over = routedDb([lockRoute, recipientsRoute('1500'), [/SELECT CASE WHEN/, { rows: [{ nominal: '1000' }] }], [/COALESCE\(SUM\(delta_kmf\)/, { rows: [{ balance: '1000' }] }], insertRoute]);
    await expect(service.recordReceipt(over, { ...base, outcome: 'received', receivedAmount: 1000 })).rejects.toMatchObject({ code: 'custody_holding_ceiling_exceeded', status: 409 });
    expect(over.query.mock.calls.some(c => /INSERT INTO cash_custody_receipts/.test(String(c[0])))).toBe(false);
    const stranger = routedDb([lockRoute, [/FROM market_operating_assignments a/, { rows: [] }]]);
    await expect(service.recordReceipt(stranger, { ...base, outcome: 'received', receivedAmount: 10 })).rejects.toMatchObject({ code: 'custody_recipient_not_authorized', status: 403 });
  });

  test('réception finale : preuve transmise, état « à contrôler », aucun contrôle de plafond', async () => {
    const final = [/FROM cash_deposits\s+WHERE deposit_ref/, { rows: [{ id: 'dep', deposit_ref: 'KDP-F', movement_kind: 'FINAL', agent_id: 'ag', recipient_user_id: null, amount_kmf: '800.00' }] }];
    const db = routedDb([final, insertRoute]);
    const res = await service.recordReceipt(db, { ...base, depositRef: 'KDP-F', actorId: 'third', outcome: 'received', receivedAmount: 800, proofRef: 'BORD-1', proofUrl: 'u' });
    expect(res).toMatchObject({ state: 'TO_CONTROL', discrepancy_kmf: 0 });
    expect(db.query.mock.calls.find(c => /INSERT INTO cash_custody_receipts/.test(String(c[0])))[1].slice(6, 8)).toEqual(['BORD-1', 'u']);
  });

  test('violation d\'invariant SQL traduite (acteur, devise, solde)', async () => {
    const db = routedDb([lockRoute, recipientsRoute(), [/SELECT CASE WHEN/, { rows: [{ nominal: '10' }] }], [/COALESCE\(SUM\(delta_kmf\)/, { rows: [{ balance: '0' }] }],
      [/INSERT INTO cash_custody_receipts/, Object.assign(new Error('cash_custody_receipts: seul le destinataire désigné reçoit ou refuse'), { code: '23514' })]]);
    await expect(service.recordReceipt(db, { ...base, outcome: 'received', receivedAmount: 10 })).rejects.toMatchObject({ code: 'custody_rule_violation', status: 409 });
  });
});

describe('recordControl', () => {
  const base = { actorId: 'third', marketId: 'm1', depositRef: 'KDP-F' };
  const finalLock = [/FROM cash_deposits\s+WHERE deposit_ref/, { rows: [{ id: 'dep', deposit_ref: 'KDP-F', movement_kind: 'FINAL', agent_id: 'ag', amount_kmf: '800.00' }] }];
  const netRoute = [/AS net\s+FROM cash_custody_receipts rc/, { rows: [{ net: '800' }] }];

  test('rien à contrôler ; montant invalide', async () => {
    await expect(service.recordControl(routedDb([finalLock]), base)).rejects.toMatchObject({ code: 'custody_nothing_to_control', status: 409 });
    await expect(service.recordControl(routedDb([finalLock, netRoute]), { ...base, controlledKmf: -1 })).rejects.toMatchObject({ code: 'custody_controlled_amount_invalid' });
    await expect(service.recordControl(routedDb([finalLock, netRoute]), { ...base, controlledKmf: 'abc' })).rejects.toMatchObject({ code: 'custody_controlled_amount_invalid' });
  });

  test('contrôle total par défaut = clôture ; audit avec le reçu net', async () => {
    const db = routedDb([finalLock, netRoute, [/INSERT INTO cash_custody_receipts/, { rows: [{ id: 'ct', kind: 'CONTROL' }] }]]);
    expect(await service.recordControl(db, base)).toEqual({ deposit_ref: 'KDP-F', state: 'CLOSED', control_id: 'ct', controlled_kmf: 800 });
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_FINAL_CONTROLLED', capability: 'finance.act', after: expect.objectContaining({ controlled_kmf: 800, received_net_kmf: 800 }) }));
  });

  test('contrôle négatif (0) : rien de clôturé', async () => {
    const db = routedDb([finalLock, netRoute, [/INSERT INTO cash_custody_receipts/, { rows: [{ id: 'ct' }] }]]);
    expect(await service.recordControl(db, { ...base, controlledKmf: 0, reason: 'illisible' })).toMatchObject({ state: 'CONTROL_REJECTED', controlled_kmf: 0 });
  });
});

describe('contre-écritures et pertes', () => {
  test('reverseReceipt : montant requis, fait REVERSAL motivé, audit', async () => {
    const lock = [/FROM cash_deposits\s+WHERE deposit_ref/, { rows: [{ id: 'dep', movement_kind: 'FINAL' }] }];
    const params = { actorId: 'c', marketId: 'm1', depositRef: 'KDP-F', receiptId: 'rcp', amountKmf: 50, reason: 'erreur de saisie' };
    await expect(service.reverseReceipt(routedDb([lock]), { ...params, amountKmf: 0 })).rejects.toMatchObject({ code: 'custody_reversal_amount_invalid' });
    const db = routedDb([lock, [/INSERT INTO cash_custody_receipts/, { rows: [{ id: 'rv' }] }]]);
    expect(await service.reverseReceipt(db, params)).toEqual({ deposit_ref: 'KDP-F', reversal_id: 'rv', amount_kmf: 50 });
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_RECEIPT_REVERSED' }));
  });

  test('decideLoss : montant, remise liée optionnelle, motif/décideur refusés par la base, solde insuffisant', async () => {
    const params = { actorId: 'c', marketId: 'm1', holderId: 'h', amountKmf: 100, reason: ' Vol constaté (PV n°1) ' };
    await expect(service.decideLoss(routedDb([]), { ...params, amountKmf: 0 })).rejects.toMatchObject({ code: 'custody_loss_amount_invalid' });
    const ok = routedDb([[/INSERT INTO cash_custody_losses/, { rows: [{ id: 'l1', kind: 'LOSS' }] }]]);
    expect(await service.decideLoss(ok, params)).toEqual({ loss_id: 'l1', holder_id: 'h', amount_kmf: 100 });
    expect(ok.query.mock.calls[0][1][4]).toBe('Vol constaté (PV n°1)');
    expect(mockAudit).toHaveBeenCalledWith(ok, expect.objectContaining({ action: 'CASH_LOSS_DECIDED' }));
    const withDeposit = routedDb([lockRoute, [/INSERT INTO cash_custody_losses/, { rows: [{ id: 'l2' }] }]]);
    await service.decideLoss(withDeposit, { ...params, depositRef: 'KDP-1' });
    expect(withDeposit.query.mock.calls[1][1][6]).toBe('dep');
    const bad = routedDb([[/INSERT INTO cash_custody_losses/, Object.assign(new Error('violates check'), { code: '23514', constraint: 'cash_custody_losses_reason_chk' })]]);
    await expect(service.decideLoss(bad, params)).rejects.toMatchObject({ code: 'custody_loss_invalid', status: 422 });
    const neg = routedDb([[/INSERT INTO cash_custody_losses/, Object.assign(new Error('cash_custody: solde négatif interdit pour h'), { code: '23514' })]]);
    await expect(service.decideLoss(neg, params)).rejects.toMatchObject({ code: 'custody_insufficient_holding' });
    const noReason = routedDb([[/INSERT INTO cash_custody_losses/, { rows: [{ id: 'l3' }] }]]);
    await service.decideLoss(noReason, { ...params, reason: undefined });
    expect(noReason.query.mock.calls[0][1][4]).toBe('');
  });

  test('reverseLoss : perte introuvable, montant invalide, contre-écriture motivée et auditée', async () => {
    const params = { actorId: 'c', marketId: 'm1', lossId: 'l1', amountKmf: 40, reason: 'Billet retrouvé' };
    await expect(service.reverseLoss(routedDb([]), params)).rejects.toMatchObject({ code: 'custody_loss_not_found', status: 404 });
    const loss = [/FROM cash_custody_losses WHERE id/, { rows: [{ holder_id: 'h' }] }];
    await expect(service.reverseLoss(routedDb([loss]), { ...params, amountKmf: 0 })).rejects.toMatchObject({ code: 'custody_loss_amount_invalid' });
    const db = routedDb([loss, [/INSERT INTO cash_custody_losses/, { rows: [{ id: 'lr' }] }]]);
    expect(await service.reverseLoss(db, params)).toEqual({ reversal_id: 'lr', amount_kmf: 40 });
    expect(db.query.mock.calls[1][1].slice(0, 3)).toEqual(['m1', 'h', 'LOSS_REVERSAL']);
    expect(mockAudit).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CASH_LOSS_REVERSED' }));
    const noReason = routedDb([loss, [/INSERT INTO cash_custody_losses/, { rows: [{ id: 'lr2' }] }]]);
    await service.reverseLoss(noReason, { ...params, reason: undefined });
    expect(noReason.query.mock.calls[1][1][4]).toBe('');
  });
});
