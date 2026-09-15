/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeHubAuthority, parseSetClauseColumns, extractTableColumnTargets } = require('../../scripts/lib/hub-authority');

/**
 * Construit un repo temporaire minimal avec un seul fichier source
 * @domain logistics référencé par le graphe, contenant `src`. Suit le même
 * pattern que tests/unit/arch-drift-pending-migration.test.js.
 */
function buildFixtureRepo(src, { domain = 'logistics', file = 'services/fixture.js' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'komerce-hub-authority-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(path.join(root, file))), { recursive: true });

  const absFile = path.join(root, file);
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, src);

  fs.writeFileSync(
    path.join(root, 'docs', 'komerce-arch-header-graph.json'),
    JSON.stringify({
      nodes: [{ type: 'file', file, domain, dbRead: [], dbWrite: [] }],
    })
  );

  return root;
}

describe('Hub Authority Gate (F4) — F4-A table-level forbidden writes', () => {
  test('NEGATIVE FIXTURE — logistics écrit purchase_orders → FAIL', () => {
    const root = buildFixtureRepo(`
      'use strict';
      async function corrigerAllocation(db, id) {
        await db.query('UPDATE purchase_orders SET quantity = $1 WHERE id = $2', [1, id]);
      }
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations).toEqual([
      expect.objectContaining({ type: 'TABLE_LEVEL_FORBIDDEN', table: 'purchase_orders', domain: 'logistics' }),
    ]);
  });

  test('logistics écrit product_skus → FAIL', () => {
    const root = buildFixtureRepo(`
      await db.query('UPDATE product_skus SET stock = $1 WHERE id = $2', [5, id]);
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations.some((v) => v.type === 'TABLE_LEVEL_FORBIDDEN' && v.table === 'product_skus')).toBe(true);
  });

  test('logistics écrit une table qui lui appartient (parcels) → PASS', () => {
    const root = buildFixtureRepo(`
      await db.query('UPDATE parcels SET status = $1 WHERE id = $2', ['sealed', id]);
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations).toEqual([]);
  });

  test('un fichier @domain orders écrivant purchase_orders ne déclenche rien (hors périmètre du gate)', () => {
    const root = buildFixtureRepo(
      `await db.query('UPDATE purchase_orders SET quantity = $1 WHERE id = $2', [1, id]);`,
      { domain: 'purchasing' }
    );
    const { violations } = analyzeHubAuthority(root);
    expect(violations).toEqual([]);
  });
});

describe('Hub Authority Gate (F4) — F4-B protected columns on orders', () => {
  test('NEGATIVE FIXTURE — UPDATE orders SET market_id (forme simple) → FAIL', () => {
    const root = buildFixtureRepo(`
      await db.query(\`UPDATE orders SET market_id = $1 WHERE id = $2\`, [marketId, orderId]);
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations).toEqual([
      expect.objectContaining({ type: 'PROTECTED_COLUMN', table: 'orders', column: 'market_id' }),
    ]);
  });

  test('UPDATE orders o SET market_id (avec alias) → FAIL', () => {
    const root = buildFixtureRepo(`
      await db.query(\`UPDATE orders o SET market_id = $1 WHERE o.id = $2\`, [marketId, orderId]);
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations.some((v) => v.type === 'PROTECTED_COLUMN' && v.column === 'market_id')).toBe(true);
  });

  test('UPDATE orders multi-ligne, market_id noyée parmi d\'autres colonnes → FAIL', () => {
    const root = buildFixtureRepo(`
      await db.query(\`
        UPDATE orders
        SET
          status = $1,
          market_id = $2,
          updated_at = NOW()
        WHERE id = $3
      \`, [status, marketId, orderId]);
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations.some((v) => v.type === 'PROTECTED_COLUMN' && v.column === 'market_id')).toBe(true);
  });

  test('INSERT INTO orders (..., market_id, ...) → FAIL', () => {
    const root = buildFixtureRepo(`
      await db.query(\`
        INSERT INTO orders (id, reference, market_id, relais_id, total_kmf)
        VALUES ($1, $2, $3, $4, $5)
      \`, [id, ref, marketId, relaisId, total]);
    `);
    const { violations } = analyzeHubAuthority(root);
    const cols = violations.filter((v) => v.type === 'PROTECTED_COLUMN').map((v) => v.column).sort();
    expect(cols).toEqual(['market_id', 'relais_id']);
  });

  test('NEGATIVE FIXTURE — orders.relais_id direct write (arbitré protégé, aucune dette existante) → FAIL', () => {
    const root = buildFixtureRepo(`
      await db.query(\`UPDATE orders SET relais_id = $1 WHERE id = $2\`, [newRelaisId, orderId]);
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations).toEqual([
      expect.objectContaining({ type: 'PROTECTED_COLUMN', table: 'orders', column: 'relais_id' }),
    ]);
  });

  test('UPDATE orders sur colonne non protégée (ex. pattern pickup_secret) → PASS', () => {
    const root = buildFixtureRepo(`
      await db.query(\`UPDATE orders SET pickup_secret_revealed_at = NOW() WHERE id = $1\`, [orderId]);
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations).toEqual([]);
  });

  test('appel à une boundary orders (order-mutation-service) sans SQL brut dans le fichier logistics → PASS', () => {
    const root = buildFixtureRepo(`
      const { setComputedStatus } = require('./order-mutation-service');
      async function refresh(db, orderId) {
        await setComputedStatus(db, { orderId, computedStatus: 'in_transit' });
      }
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations).toEqual([]);
  });
});

describe('Hub Authority Gate (F4) — fail-closed on unparseable protected-table writes', () => {
  test('NEGATIVE FIXTURE — colonne dynamique via interpolation JS → FAIL (fail-closed, pas "aucune colonne trouvée")', () => {
    const root = buildFixtureRepo(`
      await db.query(\`UPDATE orders SET \${dynamicColumn} = $1 WHERE id = $2\`, [value, orderId]);
    `);
    const { violations } = analyzeHubAuthority(root);
    expect(violations).toEqual([
      expect.objectContaining({ type: 'UNPARSEABLE_PROTECTED_TABLE_WRITE', table: 'orders' }),
    ]);
  });
});

describe('extractTableColumnTargets — unit-level parser checks', () => {
  test('parseSetClauseColumns respecte la profondeur des parenthèses (COALESCE)', () => {
    const cols = parseSetClauseColumns('paypal_capture_id = COALESCE(paypal_capture_id, $1), payer_email = $2');
    expect(cols).toEqual(['paypal_capture_id', 'payer_email']);
  });

  test('parseSetClauseColumns retourne null si un segment est illisible', () => {
    const cols = parseSetClauseColumns('status = $1, ${dyn} = $2');
    expect(cols).toBeNull();
  });

  test('extractTableColumnTargets ignore les tables non ciblées', () => {
    const targets = extractTableColumnTargets('UPDATE parcels SET status = $1 WHERE id = $2', 'orders');
    expect(targets).toEqual([]);
  });
});
