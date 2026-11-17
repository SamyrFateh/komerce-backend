'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { recordIntake } = require('../../services/relay-product-return-intake-service');

const UUID = '11111111-1111-4111-8111-111111111111';
const actor = { id: UUID, role: 'agent_relais', relais_id: UUID };

function fakeDb() {
  const queries = [];
  const client = {
    query: async (sql) => { queries.push(String(sql)); return { rows: [undefined] }; },
    release() {},
  };
  return { queries, db: { getClient: async () => client } };
}

async function lookupSql(env) {
  const previous = process.env.KOMERCE_ENV;
  process.env.KOMERCE_ENV = env;
  const { queries, db } = fakeDb();
  try {
    await recordIntake({
      actor, requestId: UUID, condition: 'sealed', zone: 'A',
      observation: 'Reprise constatee au comptoir', db,
    }).catch(() => {});
  } finally {
    if (previous === undefined) delete process.env.KOMERCE_ENV; else process.env.KOMERCE_ENV = previous;
  }
  return queries.find((q) => q.includes('FROM disputes d'));
}

describe('relay-product-return-intake-service : portée recette', () => {
  test('staging : commandes de recette acceptées', async () => {
    const sql = await lookupSql('staging');
    expect(sql).toContain('o.simulation_scope IS NOT NULL');
  });
  test('production : exclusion stricte conservée', async () => {
    const sql = await lookupSql('production');
    expect(sql).toContain('o.simulation_scope IS NULL');
    expect(sql).not.toContain('IS NOT NULL');
  });
});
