'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
const mockAudit = jest.fn();
jest.mock('../../services/market-delegation-service', () => ({ audit: (...args) => mockAudit(...args) }));

const mockCreateDeposit = jest.fn();
const mockTxClient = { query: jest.fn() };
const mockVerifyDeposit = jest.fn();
const mockDisputeDeposit = jest.fn();

jest.mock('../../services/cash-deposit-service', () => {
  class CashDepositError extends Error {
    constructor(code, message, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    CashDepositError,
    createDeposit: (...args) => mockCreateDeposit(...args),
    withTransaction: async (_db, work) => work(mockTxClient),
    verifyDeposit: (...args) => mockVerifyDeposit(...args),
    disputeDeposit: (...args) => mockDisputeDeposit(...args),
  };
});

const mockCustodySnapshot = jest.fn();
const mockHoldings = jest.fn();
const mockTransferRows = jest.fn();
const mockLegacy = jest.fn();
const mockCustodyActions = {
  recordReceipt: jest.fn(), recordControl: jest.fn(), reverseReceipt: jest.fn(), decideLoss: jest.fn(), reverseLoss: jest.fn(),
};
jest.mock('../../services/cash-custody-service', () => {
  class CashCustodyError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
  }
  return {
    CashCustodyError,
    mapDbError: jest.fn(error => error),
    snapshot: (...args) => mockCustodySnapshot(...args),
    holdings: (...args) => mockHoldings(...args),
    transferRows: (...args) => mockTransferRows(...args),
    legacyToRegularize: (...args) => mockLegacy(...args),
    recordReceipt: (...args) => mockCustodyActions.recordReceipt(...args),
    recordControl: (...args) => mockCustodyActions.recordControl(...args),
    reverseReceipt: (...args) => mockCustodyActions.reverseReceipt(...args),
    decideLoss: (...args) => mockCustodyActions.decideLoss(...args),
    reverseLoss: (...args) => mockCustodyActions.reverseLoss(...args),
  };
});
beforeEach(() => {
  mockCustodySnapshot.mockReset();
  mockCustodySnapshot.mockResolvedValue({ limits: { market_max_days: 7, max_holding_kmf: 5000000 }, recipients: [], destinations: [] });
  mockHoldings.mockReset().mockResolvedValue([]);
  mockTransferRows.mockReset().mockResolvedValue([]);
  mockLegacy.mockReset().mockResolvedValue([]);
});

const db = require('../../db');
const workspace = require('../../services/finance-accounting-workspace');

const market = { id: 'market-cm-id', code: 'CM', name: 'Comores', currency: 'KMF' };

// Client transactionnel simulé : la première requête hors BEGIN/COMMIT/ROLLBACK lit le dépôt (FOR UPDATE).
function txClient(depositRow, { failCommit = false } = {}) {
  const calls = [];
  const client = {
    calls,
    release: jest.fn(),
    query: jest.fn(async sql => {
      calls.push(String(sql).trim().split(/\s+/)[0]);
      if (/FROM cash_deposits cd/.test(sql)) return { rows: depositRow ? [depositRow] : [] };
      if (failCommit && /^COMMIT/.test(String(sql))) throw new Error('commit failed');
      return { rows: [] };
    }),
  };
  db.getClient.mockResolvedValue(client);
  return client;
}
const pendingDeposit = (extra = {}) => ({ id: 'deposit-uuid-secret', deposit_ref: 'KDP-000001', status: 'pending', agent_id: 'agent-1', notes: 'billet 1', amount_kmf: '5000.00', ...extra });

beforeEach(() => {
  jest.clearAllMocks();
});

test('normalizeFilters borne le seuil et fournit des dates sûres', () => {
  expect(workspace.normalizeFilters({ from: '2026-08-01', to: '2026-08-26', hours: 9999 })).toEqual({
    from: '2026-08-01', to: '2026-08-26', hours: 720,
  });
});

test('buildWorkspace applique market_id à toutes les sources cash et factures, rapprochement depuis l\'autorité canonique', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ expected_kmf: '10000', expected_count: 1 }] })
    .mockResolvedValueOnce({ rows: [{ collected_kmf: '8000', collection_count: 1 }] })
    .mockResolvedValueOnce({ rows: [{ transferred_kmf: '5000', closed_kmf: '3000', lost_kmf: '500' }] })
    .mockResolvedValueOnce({ rows: [{ held_kmf: '4500', awaiting_kmf: '1000' }] })
    .mockResolvedValueOnce({ rows: [{ order_ref: 'CMD-1', amount_kmf: 8000 }] })
    .mockResolvedValueOnce({ rows: [{ deposit_ref: 'KDP-000001', status: 'verified', amount_kmf: 5000 }] })
    .mockResolvedValueOnce({ rows: [{ order_ref: 'CMD-2', total_kmf: 2000 }] })
    .mockResolvedValueOnce({ rows: [{ invoice_number: 'KOM-INV-2026-000001', order_ref: 'CMD-1' }] });
  mockHoldings.mockResolvedValue([{ holder_id: 'u1', balance_kmf: 4500 }]);
  mockTransferRows.mockResolvedValue([{ state: 'DECLARED' }, { state: 'TO_CONTROL' }, { state: 'CLOSED' }]);
  mockLegacy.mockResolvedValue([{ remaining_kmf: 2000 }, { remaining_kmf: 500 }]);

  const payload = await workspace.buildWorkspace({ market, from: '2026-08-20', to: '2026-08-26', hours: 48 });

  expect(payload.scope).toEqual({ code: 'CM', name: 'Comores', currency: 'KMF' });
  expect(mockCustodySnapshot).toHaveBeenCalledWith(db, 'market-cm-id');
  expect(mockHoldings).toHaveBeenCalledWith(db, 'market-cm-id');
  expect(payload.custody).toMatchObject({ recipients: [], destinations: [], holders: [{ holder_id: 'u1' }], legacy_to_regularize: [{ remaining_kmf: 2000 }, { remaining_kmf: 500 }] });
  expect(payload.summary).toMatchObject({
    expected_kmf: 10000, uncollected_kmf: 2000, held_kmf: 4500, closed_kmf: 3000,
    transfers_to_act: 2, legacy_to_regularize: 2, legacy_to_regularize_kmf: 2500,
  });
  expect(payload.summary).not.toHaveProperty('verified_kmf');
  expect(payload.reconciliation).toMatchObject({
    gap_collection_kmf: 2000, transferred_kmf: 5000, closed_kmf: 3000, lost_kmf: 500, held_kmf: 4500, awaiting_reply_kmf: 1000,
    // collecté − clôturé − perte décidée : ni « vérifié » ni transfert intermédiaire ne ferment l'écart
    gap_closure_kmf: 4500,
  });
  expect(payload.reconciliation).not.toHaveProperty('ledger_coverage_basis');

  const sql = db.query.mock.calls.map(call => String(call[0])).join('\n');
  expect(sql).toContain('o.market_id = $1');
  expect(sql).toContain('r.market_id = $1');
  expect(sql).toContain('FROM cash_custody_movements');
  expect(sql).toContain("cd.movement_kind = 'LEGACY'");
  expect(sql).toContain('JOIN orders o ON o.id = i.order_id');
  expect(db.query.mock.calls.every(call => call[1][0] === 'market-cm-id')).toBe(true);
});

test('déclaration refusée si acteur non rattaché à un relais du marché', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.createDeposit({
    amount_kmf: 5000,
    deposit_method: 'bank',
    period_start: '2026-08-20',
    period_end: '2026-08-26',
  }, market, { id: 'agent-x', role: 'agent_relais' })).rejects.toMatchObject({
    code: 'deposit_actor_market_mismatch', status: 403,
  });
  expect(mockCreateDeposit).not.toHaveBeenCalled();
});

test('déclaration délègue au service paiement avec acteur serveur', async () => {
  db.query.mockResolvedValueOnce({ rows: [{ user_id: 'agent-1', relais_id: 'rel-1', relais_name: 'Relais 1' }] });
  mockCreateDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', amount_kmf: 5000, status: 'pending' });
  const payload = { amount_kmf: 5000, deposit_method: 'bank', period_start: '2026-08-20', period_end: '2026-08-26' };
  const result = await workspace.createDeposit(payload, market, { id: 'agent-1', role: 'agent_relais' });
  expect(result).toEqual({ deposit_ref: 'KDP-000001', kind: undefined, amount_kmf: 5000, status: 'pending' });
  expect(mockCreateDeposit).toHaveBeenCalledWith({ agentId: 'agent-1', marketId: 'market-cm-id', payload });
});

test('verify : transaction unique — verrou du dépôt du marché, mutation, audit sur le même client, puis COMMIT', async () => {
  const client = txClient(pendingDeposit());
  mockVerifyDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'verified', verified_at: '2026-08-26T12:00:00Z' });

  const result = await workspace.verifyDeposit('KDP-000001', { notes: 'OK' }, market, { id: 'manager-1', role: 'market_operator' });

  expect(result).toEqual({ deposit_ref: 'KDP-000001', status: 'verified', verified_at: '2026-08-26T12:00:00Z' });
  expect(mockVerifyDeposit).toHaveBeenCalledWith({ depositId: 'deposit-uuid-secret', verifierId: 'manager-1', notes: 'OK', dbClient: client });
  expect(client.calls).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
  expect(client.query.mock.calls[1][0]).toMatch(/FOR UPDATE OF cd/);
  expect(client.query.mock.calls[1][1]).toEqual(['KDP-000001', 'market-cm-id']);
  expect(mockAudit).toHaveBeenCalledWith(client, expect.objectContaining({
    actorUserId: 'manager-1',
    marketId: 'market-cm-id',
    capability: 'finance.act',
    action: 'CASH_DEPOSIT_VERIFIED',
    before: { deposit_ref: 'KDP-000001', status: 'pending', amount_kmf: '5000.00', previous_notes: 'billet 1' },
    after: { deposit_ref: 'KDP-000001', status: 'verified', note: 'OK' },
  }));
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('dispute : motif tracé dans l’audit, ancienne note conservée dans le « avant »', async () => {
  const client = txClient(pendingDeposit());
  mockDisputeDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'disputed', verified_at: '2026-08-26T12:00:00Z' });

  await workspace.disputeDeposit('KDP-000001', { reason: 'écart de 500' }, market, { id: 'manager-1' });

  expect(mockDisputeDeposit).toHaveBeenCalledWith({ depositId: 'deposit-uuid-secret', verifierId: 'manager-1', reason: 'écart de 500', dbClient: client });
  expect(mockAudit).toHaveBeenCalledWith(client, expect.objectContaining({
    action: 'CASH_DEPOSIT_DISPUTED',
    before: expect.objectContaining({ previous_notes: 'billet 1' }),
    after: { deposit_ref: 'KDP-000001', status: 'disputed', note: 'écart de 500' },
  }));
});

test('deposit_ref existant hors marché est invisible : aucune mutation, rollback', async () => {
  const client = txClient(null);
  await expect(workspace.verifyDeposit('KDP-000001', {}, market, { id: 'manager-1' })).rejects.toMatchObject({
    code: 'deposit_not_found', status: 404,
  });
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
  expect(client.calls).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('référence invalide : refus avant toute mutation', async () => {
  txClient(pendingDeposit());
  await expect(workspace.verifyDeposit('XYZ', {}, market, { id: 'manager-1' })).rejects.toMatchObject({ code: 'deposit_reference_invalid', status: 400 });
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
});

test('le déposant ne peut ni valider ni contester son propre dépôt', async () => {
  for (const [name, call] of [
    ['verify', () => workspace.verifyDeposit('KDP-000001', {}, market, { id: 'agent-1' })],
    ['dispute', () => workspace.disputeDeposit('KDP-000001', { reason: 'x' }, market, { id: 'agent-1' })],
  ]) {
    const client = txClient(pendingDeposit());
    await expect(call()).rejects.toMatchObject({ code: 'deposit_self_review_forbidden', status: 403 });
    expect(client.calls).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
    expect(name).toBeTruthy();
  }
  expect(mockVerifyDeposit).not.toHaveBeenCalled();
  expect(mockDisputeDeposit).not.toHaveBeenCalled();
  expect(mockAudit).not.toHaveBeenCalled();
});

test.each([
  ['pending', 'verify', true], ['pending', 'dispute', true], ['disputed', 'verify', true],
  ['disputed', 'dispute', false], ['verified', 'verify', false], ['verified', 'dispute', false],
])('transition depuis %s via %s : autorisée=%s', async (status, action, allowed) => {
  txClient(pendingDeposit({ status }));
  mockVerifyDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'verified' });
  mockDisputeDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'disputed' });
  const run = action === 'verify'
    ? workspace.verifyDeposit('KDP-000001', {}, market, { id: 'manager-1' })
    : workspace.disputeDeposit('KDP-000001', { reason: 'motif' }, market, { id: 'manager-1' });
  if (allowed) {
    await expect(run).resolves.toMatchObject({ deposit_ref: 'KDP-000001' });
  } else {
    await expect(run).rejects.toMatchObject({ code: 'deposit_transition_forbidden', status: 409 });
    expect(mockVerifyDeposit).not.toHaveBeenCalled();
    expect(mockDisputeDeposit).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  }
});

test('échec de la mutation, de l’audit ou du COMMIT : rollback, jamais de verdict sans trace', async () => {
  const boom = new Error('audit down');
  let client = txClient(pendingDeposit());
  mockVerifyDeposit.mockResolvedValue({ deposit_ref: 'KDP-000001', status: 'verified' });
  mockAudit.mockRejectedValueOnce(boom);
  await expect(workspace.verifyDeposit('KDP-000001', {}, market, { id: 'manager-1' })).rejects.toBe(boom);
  expect(client.calls).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);

  client = txClient(pendingDeposit(), { failCommit: true });
  await expect(workspace.verifyDeposit('KDP-000001', {}, market, { id: 'manager-1' })).rejects.toThrow('commit failed');
  expect(client.calls).toContain('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('erreur métier du service paiement (motif manquant) traduite et annulée', async () => {
  const { CashDepositError } = require('../../services/cash-deposit-service');
  const client = txClient(pendingDeposit());
  mockDisputeDeposit.mockRejectedValue(new CashDepositError('deposit_dispute_reason_required', 'Raison requise', 400));
  await expect(workspace.disputeDeposit('KDP-000001', {}, market, { id: 'manager-1' })).rejects.toMatchObject({
    name: 'FinanceAccountingWorkspaceError', code: 'deposit_dispute_reason_required', status: 400,
  });
  expect(client.calls).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
  expect(mockAudit).not.toHaveBeenCalled();
});


test('UI essentielle place les filtres dans la section Période (hors Hero) et retire les historiques par défaut', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname,'..','..','public','dashboards','canonical','js','finance-accounting-workspace.js'),
    'utf8'
  );
  expect(source).toContain("data-workspace-kind', 'accounting");
  expect(source).not.toContain('header.appendChild(filterControls(doc, payload, context))');
  expect(source).toContain('.appendChild(filterControls(doc, payload, context))');
  const start = source.indexOf('function renderPayload');
  const render = source.slice(start, source.indexOf('async function mount', start));
  expect(render).not.toContain('renderFilters(rootNode');
  expect(render).not.toContain('renderCollections(rootNode');
  expect(render).not.toContain('renderInvoices(rootNode');
});

test('UI : les gestes Vérifier / Contester sont offerts à admin et market_operator, Contester seulement sur un dépôt en attente', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'finance-accounting-workspace.js'),
    'utf8'
  );
  expect(source).toContain("context.user.role === 'admin' || context.user.role === 'market_operator'");
  expect(source).toContain("if (row.status !== 'verified') {\n          const verify");
  expect(source).toContain("if (row.status === 'pending') {\n          const dispute");
  expect(source).not.toContain("if (row.status !== 'disputed') {\n          const dispute");
});

test('UI relais : déclaration en devise + montant d\'origine, jamais un KMF saisi à la main', () => {
  const fs = require('fs');
  const path = require('path');
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'finance-accounting-workspace.js'), 'utf8');
  const start = ui.indexOf('function renderDepositCreation');
  const src = ui.slice(start, ui.indexOf('function renderDeposits', start));
  expect(src).toContain("'Devise du montant'");
  expect(src).toContain('declared_amount: Number(amount)');
  expect(src).toContain('declared_currency: currency');
  expect(src).not.toContain('amount_kmf');
});

test('rapprochement : une remise annoncée, acceptée en intermédiaire ou « vérifiée » à l\'ancienne ne ferme jamais l\'écart', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ expected_kmf: '150000', expected_count: 3 }] })
    .mockResolvedValueOnce({ rows: [{ collected_kmf: '150000', collection_count: 3 }] })
    .mockResolvedValueOnce({ rows: [{ transferred_kmf: '100000', closed_kmf: '0', lost_kmf: '0' }] })
    .mockResolvedValueOnce({ rows: [{ held_kmf: '150000', awaiting_kmf: '50000' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const payload = await workspace.buildWorkspace({ market, from: '2026-08-20', to: '2026-08-26', hours: 48 });

  expect(payload.reconciliation.transferred_kmf).toBe(100000);
  expect(payload.reconciliation.closed_kmf).toBe(0);
  expect(payload.reconciliation.gap_closure_kmf).toBe(150000);
  expect(payload.reconciliation.awaiting_reply_kmf).toBe(50000);
});

test('UI : rapprochement canonique (transféré / clôturé / perte / détenu), plus de « vérifié » ni de couverture provisoire', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-accounting-workspace.js'), 'utf8');
  expect(src).toContain("label: 'Transféré (accepté)'");
  expect(src).toContain("label: 'Clôturé'");
  expect(src).toContain("label: 'Perte décidée'");
  expect(src).toContain("label: 'Écart (collecté − clôturé − perte)'");
  expect(src).not.toContain('Rapprochement cash (provisoire)');
  expect(src).not.toContain('verified_kmf');
  expect(src).toContain('Une déclaration ne transfère rien ; aucun transfert intermédiaire ne clôture.');
});

test('UI : actions de garde — réception par le destinataire, preuve finale par un tiers, contrôle jamais par remettant ou receveur, perte centrale', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-accounting-workspace.js'), 'utf8');
  expect(src).toContain("row.state === 'DECLARED' && String(row.recipient_user_id) === String(user.id)");
  expect(src).toContain("row.state === 'AWAITING_PROOF' && String(row.remitter_id) !== String(user.id)");
  expect(src).toContain("String(row.remitter_id) !== String(user.id) && String(row.received_by) !== String(user.id)");
  expect(src).toContain("context.user.role === 'admin' && (custody.holders || []).length");
  expect(src).toContain('custody/losses');
});

describe('actions de garde (réception, contrôle, contre-écriture, pertes)', () => {
  const actor = { id: 'u-actor', role: 'market_operator' };

  test('chaque action s\'exécute dans une transaction, Market serveur, acteur de session, rien d\'autre du client', async () => {
    mockCustodyActions.recordReceipt.mockResolvedValue({ state: 'ACCEPTED' });
    await expect(workspace.receiveTransfer('KDP-1', { outcome: 'received', received_amount: 500, proof_ref: 'R', market_id: 'evil' }, market, actor)).resolves.toEqual({ state: 'ACCEPTED' });
    expect(mockCustodyActions.recordReceipt).toHaveBeenCalledWith(mockTxClient, {
      actorId: 'u-actor', marketId: 'market-cm-id', depositRef: 'KDP-1', outcome: 'received', receivedAmount: 500,
      proofRef: 'R', proofUrl: undefined, reason: undefined,
    });
    mockCustodyActions.recordControl.mockResolvedValue({ state: 'CLOSED' });
    await workspace.controlFinal('KDP-2', { controlled_kmf: 300, reason: 'ok' }, market, actor);
    expect(mockCustodyActions.recordControl).toHaveBeenCalledWith(mockTxClient, { actorId: 'u-actor', marketId: 'market-cm-id', depositRef: 'KDP-2', controlledKmf: 300, reason: 'ok' });
    mockCustodyActions.reverseReceipt.mockResolvedValue({ reversal_id: 'r' });
    await workspace.reverseReceipt('KDP-3', { receipt_id: 'rc', amount_kmf: 10, reason: 'erreur' }, market, actor);
    expect(mockCustodyActions.reverseReceipt).toHaveBeenCalledWith(mockTxClient, { actorId: 'u-actor', marketId: 'market-cm-id', depositRef: 'KDP-3', receiptId: 'rc', amountKmf: 10, reason: 'erreur' });
    mockCustodyActions.decideLoss.mockResolvedValue({ loss_id: 'l' });
    await workspace.decideLoss({ holder_id: 'h', amount_kmf: 5, reason: 'motif détaillé', deposit_ref: 'KDP-4' }, market, actor);
    expect(mockCustodyActions.decideLoss).toHaveBeenCalledWith(mockTxClient, { actorId: 'u-actor', marketId: 'market-cm-id', holderId: 'h', amountKmf: 5, reason: 'motif détaillé', depositRef: 'KDP-4' });
    mockCustodyActions.reverseLoss.mockResolvedValue({ reversal_id: 'lr' });
    await workspace.reverseLoss('loss-1', { amount_kmf: 5, reason: 'retrouvé' }, market, actor);
    expect(mockCustodyActions.reverseLoss).toHaveBeenCalledWith(mockTxClient, { actorId: 'u-actor', marketId: 'market-cm-id', lossId: 'loss-1', amountKmf: 5, reason: 'retrouvé' });
  });

  test('erreur métier de garde traduite en erreur d\'espace de travail ; erreur inconnue conservée', async () => {
    const { CashCustodyError } = require('../../services/cash-custody-service');
    mockCustodyActions.recordControl.mockRejectedValueOnce(new CashCustodyError('custody_rule_violation', 'acteur non indépendant', 409));
    await expect(workspace.controlFinal('KDP-2', {}, market, actor)).rejects.toMatchObject({ name: 'FinanceAccountingWorkspaceError', code: 'custody_rule_violation', status: 409 });
    const boom = new Error('db down');
    mockCustodyActions.recordReceipt.mockRejectedValueOnce(boom);
    await expect(workspace.receiveTransfer('KDP-1', {}, market, actor)).rejects.toBe(boom);
    const { mapDbError } = require('../../services/cash-custody-service');
    mapDbError.mockImplementationOnce(() => new CashCustodyError('custody_insufficient_holding', 'solde négatif interdit', 409));
    mockCustodyActions.recordReceipt.mockRejectedValueOnce(new Error('raw'));
    await expect(workspace.receiveTransfer('KDP-1', {}, market, actor)).rejects.toMatchObject({ code: 'custody_insufficient_holding', status: 409 });
  });

  test('un relais exige son rattachement au Market ; une personne habilitée non-relais passe par la capability de la route', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(workspace.createDeposit({ recipient_user_id: 'r' }, market, { id: 'x', role: 'agent_relais' })).rejects.toMatchObject({ code: 'deposit_actor_market_mismatch' });
    mockCreateDeposit.mockResolvedValueOnce({ deposit_ref: 'KDP-9', movement_kind: 'FINAL', amount_kmf: 10, status: 'pending' });
    await expect(workspace.createDeposit({ destination_id: 'd' }, market, { id: 'mgr', role: 'market_operator' }))
      .resolves.toEqual({ deposit_ref: 'KDP-9', kind: 'FINAL', amount_kmf: 10, status: 'pending' });
    const { CashDepositError } = require('../../services/cash-deposit-service');
    mockCreateDeposit.mockRejectedValueOnce(new CashDepositError('deposit_target_required', 'Cible requise', 422));
    await expect(workspace.createDeposit({}, market, { id: 'mgr', role: 'market_operator' })).rejects.toMatchObject({ code: 'deposit_target_required', status: 422 });
  });
});

test('UI : runAction définie et utilisée par toutes les actions ; Garde des espèces = un conteneur par tableau', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-accounting-workspace.js'), 'utf8');
  expect(src).toMatch(/async function runAction\(context, button, options\)/);
  const custody = src.slice(src.indexOf('function renderCustody'), src.indexOf('function renderUncollected'));
  // DataTable.render vide son conteneur : rendre plusieurs tableaux dans le même `slot` n'en laisserait qu'un.
  expect(custody).not.toContain('DataTable.render(slot');
  expect((custody.match(/DataTable\.render\(part\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
});
