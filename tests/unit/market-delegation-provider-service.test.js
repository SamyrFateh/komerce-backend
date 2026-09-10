'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const network = require('../../services/market-delegation-provider-service');

function executor() {
  return { query: jest.fn() };
}

function mockAuthz(db, { marketId = 'mkt-cm', marketCode = 'CM', assignmentId = 'a-cm', membershipId = 'm1', capabilities = ['provider.manage'] } = {}) {
  db.query
    .mockResolvedValueOnce({ rows: [{ market_id: marketId, market_code: marketCode, market_name: 'Cameroun', currency: 'XAF', assignment_id: assignmentId, assignment_status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: [{ id: membershipId, assignment_id: assignmentId, user_id: 'u1', status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: capabilities.map(capability => ({ capability })) })
    .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
}

describe('market-delegation provider service — capabilities et audit', () => {
  test('création réussie appelle providers-service avec le marché résolu serveur et audite NETWORK_PROVIDER_CREATED', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockImplementationOnce(async (sql) => {
      expect(sql).toMatch(/SELECT id FROM markets/);
      return { rows: [{ id: 'mkt-cm' }] };
    });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO providers/);
      expect(params[2]).toBe('mkt-cm');
      return { rows: [{ id: 'p1', market_id: 'mkt-cm', status: 'pending' }] };
    });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO market_delegation_audit/);
      expect(params[4]).toBe('NETWORK_PROVIDER_CREATED');
      return { rows: [] };
    });

    const provider = await network.createProvider(db, {
      marketCode: 'CM', actorUserId: 'u1', name: 'Atelier Y', phone: '+237600000000',
    });
    expect(provider.id).toBe('p1');
    expect(provider.status).toBe('pending');
  });

  test('capability absente → 403, aucune écriture tentée', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: [] });
    await expect(network.createProvider(db, {
      marketCode: 'CM', actorUserId: 'u1', name: 'X', phone: '1',
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  test('CM ne peut jamais modifier un provider appartenant à CG (404, pas de fuite d’existence)', async () => {
    const db = executor();
    mockAuthz(db, { marketId: 'mkt-cm' });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'p-cg', market_id: 'mkt-cg', name: 'CG Provider' }] });
    await expect(network.updateProvider(db, {
      marketCode: 'CM', providerId: 'p-cg', actorUserId: 'u1', patch: { name: 'Hijack' },
    })).rejects.toMatchObject({ code: 'NETWORK_PROVIDER_NOT_FOUND', status: 404 });
  });

  test('suspension borne le write au market_id et audite NETWORK_PROVIDER_SUSPENDED', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'p1', market_id: 'mkt-cm', status: 'active' }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/UPDATE providers/);
      expect(sql).toMatch(/market_id = \$2/);
      expect(params).toEqual(['p1', 'mkt-cm', 'suspended']);
      return { rows: [{ id: 'p1', market_id: 'mkt-cm', status: 'suspended' }] };
    });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO market_delegation_audit/);
      expect(params[4]).toBe('NETWORK_PROVIDER_SUSPENDED');
      return { rows: [] };
    });

    const provider = await network.setProviderStatus(db, { marketCode: 'CM', providerId: 'p1', actorUserId: 'u1', status: 'suspended' });
    expect(provider.status).toBe('suspended');
  });

  test('réactivation après suspension est market-scopée et auditée', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'p1', market_id: 'mkt-cm', status: 'suspended' }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'p1', market_id: 'mkt-cm', status: 'active' }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(params[4]).toBe('NETWORK_PROVIDER_ACTIVATED');
      return { rows: [] };
    });
    const provider = await network.setProviderStatus(db, { marketCode: 'CM', providerId: 'p1', actorUserId: 'u1', status: 'active' });
    expect(provider.status).toBe('active');
  });

  test('statut identique est idempotent — aucun audit dupliqué', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [{ id: 'p1', market_id: 'mkt-cm', status: 'suspended' }] });
    const provider = await network.setProviderStatus(db, { marketCode: 'CM', providerId: 'p1', actorUserId: 'u1', status: 'suspended' });
    expect(provider.status).toBe('suspended');
    expect(db.query).toHaveBeenCalledTimes(5);
  });

  test('provider introuvable lors d’un changement de statut renvoie 404', async () => {
    const db = executor();
    mockAuthz(db);
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(network.setProviderStatus(db, {
      marketCode: 'CM', providerId: 'ghost', actorUserId: 'u1', status: 'active',
    })).rejects.toMatchObject({ code: 'NETWORK_PROVIDER_NOT_FOUND', status: 404 });
  });

  test('aucune promotion de users.role — le service ne référence jamais cette colonne', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'market-delegation-provider-service.js'), 'utf8');
    expect(source).not.toMatch(/users\.role/);
    expect(source).not.toMatch(/UPDATE users/i);
  });
});
