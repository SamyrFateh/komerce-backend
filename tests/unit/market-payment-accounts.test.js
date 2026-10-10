'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../services/market-delegation-team-service', () => ({ resolveAuthorization: jest.fn() }));
const { resolveAuthorization } = require('../../services/market-delegation-team-service');
const svc = require('../../services/market-payment-account-service');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const migration = read('migrations/285_market_payment_accounts.sql');
const centralRoute = read('routes/admin-market-payment-accounts.js');
const marketRoute = read('routes/market-delegation-payment-accounts.js');
const serviceSource = read('services/market-payment-account-service.js');

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const base = {
  actorUserId: 'u1', marketCode: 'cm', provider: 'orange_money', currency: 'xaf', accountHolder: 'Yves SARL',
  legalSeller: 'Yves SARL', refundBearer: 'market', credentialsRef: 'vault/markets/cm/orange',
};

function executor({ account = null, market = { id: 'm-cm', code: 'CM' }, updateError = null, rows = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM markets WHERE code/.test(sql)) return { rows: market ? [market] : [] };
      if (/INSERT INTO market_payment_accounts/.test(sql)) return { rows: [{ id: ACCOUNT, status: 'DRAFT' }] };
      if (/FROM market_payment_accounts WHERE id/.test(sql)) return { rows: account ? [account] : [] };
      if (/UPDATE market_payment_accounts/.test(sql)) { if (updateError) throw updateError; return { rows: [] }; }
      if (/FROM market_payment_accounts a/.test(sql)) return { rows };
      return { rows: [] };
    },
  };
}
const accountRow = (status, extra = {}) => ({ id: ACCOUNT, market_id: 'm-cm', provider: 'orange_money', currency: 'XAF', status, credentials_ref: 'vault/x', legal_basis_ref: 'contrat-2026-01', ...extra });

beforeEach(() => resolveAuthorization.mockReset());

describe('création d’un compte de paiement de Market (D4a)', () => {
  test('crée en DRAFT, normalise prestataire/devise, sépare les quatre rôles et audite sans la référence de coffre', async () => {
    const db = executor();
    const result = await svc.createPaymentAccount(db, { ...base, marketOperatorEntity: 'Yves Opérations', legalBasisRef: 'contrat-2026-01' });
    expect(result).toMatchObject({ account_id: ACCOUNT, market_code: 'CM', status: 'DRAFT' });
    const insert = db.calls.find(c => /INSERT INTO market_payment_accounts/.test(c.sql));
    expect(insert.params).toEqual(expect.arrayContaining(['orange_money', 'XAF', 'MARKET', 'Yves Opérations']));
    const audit = db.calls.find(c => /market_delegation_audit/.test(c.sql));
    expect(JSON.stringify(audit.params)).toContain('MARKET_PAYMENT_ACCOUNT_CREATED');
    expect(JSON.stringify(audit.params)).not.toContain('vault/markets');
  });

  test.each([
    ['clé Stripe secrète', { credentialsRef: 'sk_live_abcdef123456' }],
    ['clé secrète webhook', { credentialsRef: 'whsec_abcdef123456' }],
    ['référence non conforme', { credentialsRef: 'Ma Clé!' }],
  ])('refuse un secret dans credentials_ref : %s', async (_label, patch) => {
    await expect(svc.createPaymentAccount(executor(), { ...base, ...patch })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_SECRET_REJECTED', status: 400 });
  });

  test('refuse un secret dans external_account_id, un porteur de remboursement inconnu et des champs manquants', async () => {
    await expect(svc.createPaymentAccount(executor(), { ...base, externalAccountId: 'rk_live_zzzzzz' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_SECRET_REJECTED' });
    await expect(svc.createPaymentAccount(executor(), { ...base, refundBearer: 'NOBODY' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_FIELD_INVALID' });
    await expect(svc.createPaymentAccount(executor(), { ...base, accountHolder: '' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_FIELD_REQUIRED' });
    await expect(svc.createPaymentAccount(executor(), { ...base, provider: 'Bad Provider' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_FIELD_INVALID' });
    await expect(svc.createPaymentAccount(executor(), { ...base, currency: 'EURO' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_FIELD_INVALID' });
  });

  test('marché inconnu : 404 ; code invalide : 400 ; exécuteur invalide : TypeError', async () => {
    await expect(svc.createPaymentAccount(executor({ market: null }), base)).rejects.toMatchObject({ code: 'MARKET_NOT_FOUND', status: 404 });
    await expect(svc.createPaymentAccount(executor(), { ...base, marketCode: '!!' })).rejects.toMatchObject({ code: 'MARKET_CODE_INVALID', status: 400 });
    await expect(svc.createPaymentAccount(null, base)).rejects.toThrow(TypeError);
  });

  test('provider ouvert : un prestataire hors liste historique est accepté (Stripe Connect n’est qu’un adaptateur)', async () => {
    await expect(svc.createPaymentAccount(executor(), { ...base, provider: 'stripe', adapter: 'stripe_connect', currency: 'EUR' })).resolves.toMatchObject({ status: 'DRAFT' });
  });
});

describe('cycle de vie du compte', () => {
  test('DRAFT → ACTIVE exige référence de coffre et base juridique ; vérification tracée', async () => {
    await expect(svc.setPaymentAccountStatus(executor({ account: accountRow('DRAFT', { legal_basis_ref: null }) }), { actorUserId: 'u1', accountId: ACCOUNT, targetStatus: 'ACTIVE' }))
      .rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_INCOMPLETE', status: 409 });
    const db = executor({ account: accountRow('DRAFT') });
    await expect(svc.setPaymentAccountStatus(db, { actorUserId: 'u1', accountId: ACCOUNT, targetStatus: 'active' })).resolves.toMatchObject({ changed: true, status: 'ACTIVE', previous_status: 'DRAFT' });
    expect(db.calls.find(c => /UPDATE market_payment_accounts/.test(c.sql)).sql).toMatch(/verified_by/);
    expect(JSON.stringify(db.calls.find(c => /market_delegation_audit/.test(c.sql)).params)).toContain('MARKET_PAYMENT_ACCOUNT_STATUS_CHANGED');
  });

  test('un second compte actif pour le même marché/prestataire/devise → 409 ; transitions interdites ; idempotence ; introuvable', async () => {
    const dup = Object.assign(new Error('dup'), { code: '23505' });
    await expect(svc.setPaymentAccountStatus(executor({ account: accountRow('SUSPENDED'), updateError: dup }), { accountId: ACCOUNT, targetStatus: 'ACTIVE' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_ACTIVE_EXISTS', status: 409 });
    await expect(svc.setPaymentAccountStatus(executor({ account: accountRow('CLOSED') }), { accountId: ACCOUNT, targetStatus: 'ACTIVE' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_TRANSITION_FORBIDDEN', status: 409 });
    await expect(svc.setPaymentAccountStatus(executor({ account: accountRow('DRAFT') }), { accountId: ACCOUNT, targetStatus: 'SUSPENDED' })).rejects.toMatchObject({ status: 409 });
    const same = executor({ account: accountRow('ACTIVE') });
    await expect(svc.setPaymentAccountStatus(same, { accountId: ACCOUNT, targetStatus: 'ACTIVE' })).resolves.toMatchObject({ changed: false });
    expect(same.calls.some(c => /UPDATE market_payment_accounts/.test(c.sql))).toBe(false);
    await expect(svc.setPaymentAccountStatus(executor(), { accountId: ACCOUNT, targetStatus: 'CLOSED' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_NOT_FOUND', status: 404 });
    await expect(svc.setPaymentAccountStatus(executor(), { accountId: ACCOUNT, targetStatus: 'DRAFT' })).rejects.toMatchObject({ code: 'PAYMENT_ACCOUNT_STATUS_INVALID' });
  });

  test('suspendre puis fermer sont autorisés ; CLOSED est terminal', () => {
    expect(svc.TRANSITIONS.ACTIVE).toEqual(['SUSPENDED', 'CLOSED']);
    expect(svc.TRANSITIONS.CLOSED).toBeUndefined();
  });
});

describe('lectures', () => {
  test('vue centrale : inclut la référence de coffre', async () => {
    const db = executor({ rows: [{ id: ACCOUNT, credentials_ref: 'vault/x' }] });
    const view = await svc.listPaymentAccounts(db, { marketCode: 'cm' });
    expect(view.market_code).toBe('CM');
    expect(db.calls.find(c => /FROM market_payment_accounts a/.test(c.sql)).sql).toMatch(/a\.credentials_ref/);
  });

  test('vue Market : finance.read, marché du mandat, jamais la référence de coffre ni le vérificateur', async () => {
    resolveAuthorization.mockResolvedValue({ market_id: 'm-cm', market_code: 'CM' });
    const db = executor({ rows: [{ id: ACCOUNT }] });
    const view = await svc.listMarketPaymentAccounts(db, { marketCode: 'cm', actorUserId: 'u1' });
    expect(resolveAuthorization).toHaveBeenCalledWith(db, { userId: 'u1', marketCode: 'cm', requiredCapability: 'finance.read' });
    const sql = db.calls.find(c => /FROM market_payment_accounts a/.test(c.sql));
    expect(sql.params[0]).toBe('m-cm');
    const marketSelect = sql.sql.split('FROM')[0];
    expect(marketSelect).not.toMatch(/credentials_ref|verified_by/);
    expect(view.read_only).toBe(true);
  });

  test('refus d’autorisation : aucune requête de données', async () => {
    resolveAuthorization.mockRejectedValue(Object.assign(new Error('refus'), { status: 403, code: 'FORBIDDEN' }));
    const db = executor();
    await expect(svc.listMarketPaymentAccounts(db, { marketCode: 'CM', actorUserId: 'u1' })).rejects.toMatchObject({ status: 403 });
    expect(db.calls).toHaveLength(0);
  });
});

describe('garde-fous structurels', () => {
  test('migration : aucun secret stocké, ACTIVE exige preuves, un seul compte actif par marché/prestataire/devise', () => {
    expect(migration).toMatch(/credentials_ref !~\* '\(\^\|\[\^a-z\]\)\(sk\|rk\|pk\|whsec\)_'/);
    expect(migration).toMatch(/market_payment_accounts_active_complete_chk/);
    expect(migration).toMatch(/uniq_market_payment_accounts_active[\s\S]*WHERE status = 'ACTIVE'/);
    expect(migration).toMatch(/refund_bearer\s+text NOT NULL CHECK \(refund_bearer IN \('MARKET', 'PLATFORM'\)\)/);
    expect(migration.replace(/ON DELETE RESTRICT/g, '')).not.toMatch(/\b(DROP|DELETE|UPDATE|ALTER)\b/i);
  });

  test('route centrale : admin déclaré, écritures transactionnelles, aucun SQL direct ; route Market : GET seul', () => {
    expect(centralRoute).toMatch(/const centralAdmin = \[authenticate, requireRole\(\['admin'\]\)\]/);
    expect((centralRoute.match(/\.\.\.centralAdmin/g) || []).length).toBe(3);
    expect(centralRoute).toMatch(/withTransaction/);
    expect(centralRoute).not.toMatch(/db\.query/);
    expect(marketRoute).toMatch(/router\.get\('\/markets\/:marketCode\/payment-accounts', authenticate/);
    expect(marketRoute).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(marketRoute).not.toMatch(/req\.(body|query)\.(market_id|marketId)/);
  });

  test('le service n’écrit jamais de secret ni ne touche aux paiements existants', () => {
    const code = serviceSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/process\.env|STRIPE_|PAYPAL_/);
    expect(code).not.toMatch(/market_payment_providers|\bDELETE\b/);
  });
});
