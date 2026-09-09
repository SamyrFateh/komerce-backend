'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const network = require('../../services/market-delegation-network-service');

const ROOT = path.join(__dirname, '..', '..');

function executor() {
  return { query: jest.fn() };
}

// Séquence exacte des requêtes internes à resolveAuthorization :
// 1) marché + assignment actif, 2) membership active, 3) capabilities du membre,
// 4) vérification que la capability est dans le ceiling actif.
function mockAuthz(db, { marketId = 'mkt-cm', marketCode = 'CM', assignmentId = 'a-cm', membershipId = 'm1', capabilities = ['network.read'] } = {}) {
  db.query
    .mockResolvedValueOnce({ rows: [{ market_id: marketId, market_code: marketCode, market_name: 'Cameroun', currency: 'XAF', assignment_id: assignmentId, assignment_status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: [{ id: membershipId, assignment_id: assignmentId, user_id: 'u1', status: 'ACTIVE' }] })
    .mockResolvedValueOnce({ rows: capabilities.map(capability => ({ capability })) })
    .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
}

describe('market-delegation network service — capabilities et audit', () => {
  test('création réussie insère le relais scopé au marché résolu et audite NETWORK_RELAIS_CREATED', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: ['network.create'] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO relais/);
      expect(params[0]).toBe('mkt-cm'); // market_id résolu serveur, jamais fourni par le client
      return { rows: [{ id: 'r1', market_id: 'mkt-cm', name: params[1], agent_name: params[2], phone: params[3], address: params[4], zone: null, hours: null, island: null, island_code: null, is_active: true, latitude: null, longitude: null, photo_url: null, created_at: '2026-09-09T00:00:00Z' }] };
    });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO market_delegation_audit/);
      expect(params[4]).toBe('NETWORK_RELAIS_CREATED');
      return { rows: [] };
    });

    const relais = await network.createRelais(db, {
      marketCode: 'CM', actorUserId: 'u1',
      name: 'Relais Douala Centre', agentName: 'Jean K.', phone: '+237600000000', address: 'Rue X, Douala',
    });

    expect(relais.id).toBe('r1');
    expect(relais.is_active).toBe(true);
  });

  test('capability absente → 403, aucune écriture tentée', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: ['network.read'] }); // pas network.create

    await expect(network.createRelais(db, {
      marketCode: 'CM', actorUserId: 'u1', name: 'X', agentName: 'Y', phone: '1', address: 'Z',
    })).rejects.toMatchObject({ code: 'MARKET_CAPABILITY_REQUIRED', status: 403 });

    expect(db.query).toHaveBeenCalledTimes(3); // jamais atteint le check ceiling ni l'INSERT
  });

  test('création sans donnée obligatoire échoue proprement (400), pas de crash', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: ['network.create'] });

    await expect(network.createRelais(db, {
      marketCode: 'CM', actorUserId: 'u1', name: '', agentName: 'Y', phone: '1', address: 'Z',
    })).rejects.toMatchObject({ code: 'NETWORK_FIELD_REQUIRED', status: 400 });
  });

  test('latitude fournie sans longitude est rejetée (paire GPS obligatoire)', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: ['network.create'] });

    await expect(network.createRelais(db, {
      marketCode: 'CM', actorUserId: 'u1', name: 'X', agentName: 'Y', phone: '1', address: 'Z', latitude: 4.05,
    })).rejects.toMatchObject({ code: 'NETWORK_GPS_PAIR_REQUIRED' });
  });

  test('CM ne peut jamais modifier un relais appartenant à CG (404, pas de fuite d’existence)', async () => {
    const db = executor();
    mockAuthz(db, { marketId: 'mkt-cm', marketCode: 'CM', capabilities: ['network.update'] });
    // getOwnedRelais : le relais existe mais appartient à un autre marché
    db.query.mockResolvedValueOnce({ rows: [{ id: 'r-cg', market_id: 'mkt-cg', name: 'Relais CG' }] });

    await expect(network.updateRelais(db, {
      marketCode: 'CM', relaisId: 'r-cg', actorUserId: 'u1', patch: { name: 'Hijack' },
    })).rejects.toMatchObject({ code: 'NETWORK_RELAIS_NOT_FOUND', status: 404 });
  });

  test('suspension bascule is_active=false, jamais un DELETE, et audite NETWORK_RELAIS_SUSPENDED', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: ['network.suspend'] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'r1', market_id: 'mkt-cm', is_active: true }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/UPDATE relais SET is_active=\$2/);
      expect(sql).not.toMatch(/DELETE/i);
      expect(params[1]).toBe(false);
      return { rows: [{ id: 'r1', market_id: 'mkt-cm', is_active: false }] };
    });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(params[4]).toBe('NETWORK_RELAIS_SUSPENDED');
      return { rows: [] };
    });

    const relais = await network.setRelaisActive(db, { marketCode: 'CM', relaisId: 'r1', actorUserId: 'u1', active: false });
    expect(relais.is_active).toBe(false);
  });

  test('réactivation après suspension restaure is_active=true et audite NETWORK_RELAIS_ACTIVATED', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: ['network.update'] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'r1', market_id: 'mkt-cm', is_active: false }] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'r1', market_id: 'mkt-cm', is_active: true }] });
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(params[4]).toBe('NETWORK_RELAIS_ACTIVATED');
      return { rows: [] };
    });

    const relais = await network.setRelaisActive(db, { marketCode: 'CM', relaisId: 'r1', actorUserId: 'u1', active: true });
    expect(relais.is_active).toBe(true);
  });

  test('suspendre un relais déjà suspendu est idempotent — aucun audit dupliqué', async () => {
    const db = executor();
    mockAuthz(db, { capabilities: ['network.suspend'] });
    db.query.mockResolvedValueOnce({ rows: [{ id: 'r1', market_id: 'mkt-cm', is_active: false }] });

    const relais = await network.setRelaisActive(db, { marketCode: 'CM', relaisId: 'r1', actorUserId: 'u1', active: false });
    expect(relais.is_active).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(5); // authz(4) + lecture, pas d'UPDATE ni d'audit
  });

  test('aucune promotion de users.role — le service ne référence jamais cette colonne', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-network-service.js'), 'utf8');
    expect(source).not.toMatch(/users\.role/);
    expect(source).not.toMatch(/UPDATE users/i);
  });

  test('aucun hard-delete implicite dans le service réseau', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-network-service.js'), 'utf8');
    expect(source).not.toMatch(/DELETE FROM relais/i);
  });

  test('aucune valeur géographique Comores codée en dur (pas de défaut Anjouan silencieux)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'market-delegation-network-service.js'), 'utf8');
    expect(source).not.toMatch(/Anjouan/);
    const migration = fs.readFileSync(path.join(ROOT, 'migrations', '198_market_delegation_relais_island_nullable.sql'), 'utf8');
    expect(migration).toMatch(/DROP DEFAULT/);
    expect(migration).toMatch(/DROP NOT NULL/);
  });
});
