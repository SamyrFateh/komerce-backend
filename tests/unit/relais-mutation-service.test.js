'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const relaisMutation = require('../../services/relais-mutation-service');

function executor() {
  return { query: jest.fn() };
}

describe('relais-mutation-service (logistics write boundary)', () => {
  test('createRelais insère et retourne le relais scopé au marché fourni par l’appelant', async () => {
    const db = executor();
    db.query.mockImplementationOnce(async (sql, params) => {
      expect(sql).toMatch(/INSERT INTO relais/);
      expect(params[0]).toBe('mkt-cm');
      return { rows: [{ id: 'r1', market_id: 'mkt-cm', is_active: true }] };
    });

    const relais = await relaisMutation.createRelais(db, {
      marketId: 'mkt-cm', name: 'Relais X', agentName: 'A', phone: '1', address: 'Adresse',
    });
    expect(relais.id).toBe('r1');
  });

  test('champ requis manquant échoue avant toute requête SQL', async () => {
    const db = executor();
    await expect(relaisMutation.createRelais(db, {
      marketId: 'mkt-cm', name: '', agentName: 'A', phone: '1', address: 'Adresse',
    })).rejects.toMatchObject({ code: 'NETWORK_FIELD_REQUIRED' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('getOwnedRelais renvoie 404 — jamais 403 — pour un relais d’un autre marché', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'r1', market_id: 'mkt-cg' }] });
    await expect(relaisMutation.getOwnedRelais(db, { marketId: 'mkt-cm', relaisId: 'r1' }))
      .rejects.toMatchObject({ code: 'NETWORK_RELAIS_NOT_FOUND', status: 404 });
  });

  test('setRelaisActive ne fait jamais de DELETE et est idempotent', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'r1', market_id: 'mkt-cm', is_active: false }] });
    const result = await relaisMutation.setRelaisActive(db, { marketId: 'mkt-cm', relaisId: 'r1', active: false });
    expect(result.changed).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1); // lecture seule, aucun UPDATE émis
  });

  test('le module n’émet jamais de DELETE FROM relais et n’injecte aucune géographie par défaut', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'relais-mutation-service.js'), 'utf8');
    expect(source).not.toMatch(/DELETE FROM relais/i);
    expect(source).not.toMatch(/Anjouan/);
  });
});
