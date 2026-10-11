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
    verifyDeposit: (...args) => mockVerifyDeposit(...args),
    disputeDeposit: (...args) => mockDisputeDeposit(...args),
  };
});

const mockCustodySnapshot = jest.fn();
jest.mock('../../services/cash-custody-service', () => ({ snapshot: (...args) => mockCustodySnapshot(...args) }));
beforeEach(() => {
  mockCustodySnapshot.mockReset();
  mockCustodySnapshot.mockResolvedValue({ limits: { market_max_days: 7, max_holding_kmf: 5000000 }, recipients: [], destinations: [] });
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

test('buildWorkspace applique market_id à toutes les sources cash et factures', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ expected_kmf: '10000', expected_count: 1 }] })
    .mockResolvedValueOnce({ rows: [{ collected_kmf: '8000', collection_count: 1 }] })
    .mockResolvedValueOnce({ rows: [{ deposited_kmf: '5000', verified_kmf: '5000', pending_kmf: '0', disputed_kmf: '0', deposit_count: 1 }] })
    .mockResolvedValueOnce({ rows: [{ covered_kmf: '5000', reserved_kmf: '0' }] })
    .mockResolvedValueOnce({ rows: [{ order_ref: 'CMD-1', amount_kmf: 8000 }] })
    .mockResolvedValueOnce({ rows: [{ deposit_ref: 'KDP-000001', status: 'verified', amount_kmf: 5000 }] })
    .mockResolvedValueOnce({ rows: [{ order_ref: 'CMD-2', total_kmf: 2000 }] })
    .mockResolvedValueOnce({ rows: [{ invoice_number: 'KOM-INV-2026-000001', order_ref: 'CMD-1' }] });

  const payload = await workspace.buildWorkspace({ market, from: '2026-08-20', to: '2026-08-26', hours: 48 });

  expect(payload.scope).toEqual({ code: 'CM', name: 'Comores', currency: 'KMF' });
  expect(mockCustodySnapshot).toHaveBeenCalledWith(db, 'market-cm-id');
  expect(payload.custody).toMatchObject({ recipients: [], destinations: [] });
  expect(payload.summary.expected_kmf).toBe(10000);
  expect(payload.summary.uncollected_kmf).toBe(2000);
  expect(payload.reconciliation.gap_collection_kmf).toBe(2000);
  expect(payload.reconciliation.gap_deposit_kmf).toBe(3000);
  expect(payload.reconciliation).toMatchObject({ ledger_covered_provisional_kmf: 5000, ledger_uncovered_kmf: 3000, ledger_coverage_basis: 'RECONSTRUCTED_PROVISIONAL' });

  const sql = db.query.mock.calls.map(call => String(call[0])).join('\n');
  expect(sql).toContain('o.market_id = $1');
  expect(sql).toContain('r.market_id = $1');
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
  expect(result).toEqual({ deposit_ref: 'KDP-000001', amount_kmf: 5000, status: 'pending' });
  expect(mockCreateDeposit).toHaveBeenCalledWith({ agentId: 'agent-1', payload });
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
  expect(src).toContain("'Devise du montant (KMF ou XAF)'");
  expect(src).toContain('declared_amount: Number(amount)');
  expect(src).toContain('declared_currency: currency');
  expect(src).not.toContain('amount_kmf');
});

test('rapprochement : un dépôt pending ou contesté ne ferme jamais l\'écart (collecté − vérifié)', async () => {
  db.query
    .mockResolvedValueOnce({ rows: [{ expected_kmf: '150000', expected_count: 3 }] })
    .mockResolvedValueOnce({ rows: [{ collected_kmf: '150000', collection_count: 3 }] })
    .mockResolvedValueOnce({ rows: [{ deposited_kmf: '150001', verified_kmf: '0', pending_kmf: '150000', disputed_kmf: '1', deposit_count: 2 }] })
    .mockResolvedValueOnce({ rows: [{ covered_kmf: '0', reserved_kmf: '150000' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const payload = await workspace.buildWorkspace({ market, from: '2026-08-20', to: '2026-08-26', hours: 48 });

  expect(payload.reconciliation.deposited_kmf).toBe(150001);
  expect(payload.reconciliation.verified_kmf).toBe(0);
  expect(payload.reconciliation.gap_deposit_kmf).toBe(150000);
  // grand livre : réservé en transit (pending) ≠ couvert ; l'écart ne se ferme pas
  expect(payload.reconciliation).toMatchObject({ ledger_covered_provisional_kmf: 0, ledger_reserved_pending_kmf: 150000, ledger_uncovered_kmf: 150000 });
});

test('UI : colonne « Déclaré (tous statuts) » + « Vérifié », rapprochement présenté comme provisoire', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/finance-accounting-workspace.js'), 'utf8');
  expect(src).toContain("label: 'Déclaré (tous statuts)'");
  expect(src).toContain("label: 'Vérifié'");
  expect(src).toContain('Rapprochement cash (provisoire)');
  expect(src).toMatch(/reconstruite \(FIFO\), sans réception finale prouvée ni confirmation bancaire/);
  expect(src).not.toContain('non vérifié)');
});
