'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { deleteOrderCascade } = require('../../routes/admin/delete-order-cascade');

describe('admin/delete-order-cascade', () => {
  function makeClient(failingQueries = new Set()) {
    const calls = [];
    return {
      calls,
      query: jest.fn((sql, params) => {
        calls.push(sql);
        if (failingQueries.has(sql.split(' ')[0] + ':' + sql)) {
          return Promise.reject(new Error('simulated failure: ' + sql));
        }
        return Promise.resolve({ rows: [] });
      }),
    };
  }

  it("supprime les dependances enfants puis la commande, dans l'ordre attendu", async () => {
    const client = makeClient();
    await deleteOrderCascade(client, 'order-123');

    const deleteCalls = client.calls.filter((sql) => /DELETE FROM|UPDATE sms_log/.test(sql));
    expect(deleteCalls[0]).toContain('FROM scans');
    expect(deleteCalls[1]).toContain('FROM order_status_history');
    expect(deleteCalls[2]).toContain('FROM ceremony_order_items');
    expect(deleteCalls[3]).toContain('FROM disputes');
    expect(deleteCalls[4]).toContain('UPDATE sms_log');
    expect(deleteCalls[5]).toContain('FROM order_items');
    // La commande elle-meme est supprimee en dernier
    expect(client.calls[client.calls.length - 1]).toContain('DELETE FROM orders WHERE id = $1');
  });

  it('utilise un SAVEPOINT distinct par operation enfant', async () => {
    const client = makeClient();
    await deleteOrderCascade(client, 'order-123');

    const savepoints = client.calls.filter((sql) => sql.startsWith('SAVEPOINT'));
    expect(savepoints).toHaveLength(6);
    expect(new Set(savepoints).size).toBe(6); // tous distincts
  });

  it("survit a une table enfant absente (ROLLBACK TO SAVEPOINT) et continue jusqu'a DELETE orders", async () => {
    const client = {
      query: jest.fn(),
    };
    let callIndex = 0;
    client.query.mockImplementation((sql) => {
      callIndex += 1;
      // La premiere operation enfant (DELETE FROM scans) echoue : table absente
      if (sql.includes('DELETE FROM scans')) {
        return Promise.reject(new Error('relation "scans" does not exist'));
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(deleteOrderCascade(client, 'order-456')).resolves.toBeUndefined();

    const sqlCalls = client.query.mock.calls.map((c) => c[0]);
    expect(sqlCalls).toEqual(
      expect.arrayContaining(['ROLLBACK TO SAVEPOINT sp_del_0'])
    );
    // Le DELETE final sur orders est tout de meme execute malgre l'echec enfant
    expect(sqlCalls[sqlCalls.length - 1]).toContain('DELETE FROM orders WHERE id = $1');
  });

  it("passe l'id en parametre lie ($1) sur chaque requete, jamais interpole", async () => {
    const client = makeClient();
    await deleteOrderCascade(client, 'order-789');

    client.query.mock.calls.forEach(([sql, params]) => {
      if (params) {
        expect(params).toEqual(['order-789']);
        expect(sql).not.toContain('order-789');
      }
    });
  });
});
