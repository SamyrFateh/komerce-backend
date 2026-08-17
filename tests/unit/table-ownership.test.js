'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

// Validation du marqueur `~` (écriture technique sans autorité lifecycle,
// cf. doctrine WRITER-NOT-OWNER 2026-08) avant de l'utiliser davantage sur
// les 15 dettes restantes. Le système ne doit JAMAIS ignorer une ligne `~`
// (aucune information factuelle perdue) mais ne doit jamais non plus la
// compter comme concurrent de l'owner déjà résolu.

const { parseDbTables, resolveTableOwnership } = require('../../scripts/lib/table-ownership.js');

function manifest(name, tables, opts = {}) {
  return { name, db: { tables }, classification: opts.classification };
}

describe('table-ownership — marqueurs ! (lifecycle owner) et ~ (technical writer)', () => {
  test("scénario du brief : orders = owner '!', platform-ops = technical writer '~'", () => {
    const manifests = [
      manifest('orders', ['orders: RW!']),
      manifest('platform-ops', ['orders: RW~']),
    ];
    const { tableOwnership, warns } = resolveTableOwnership(manifests);

    // lifecycleOwner = orders
    expect(tableOwnership.orders.lifecycleOwner).toBe('orders');
    expect(tableOwnership.orders.resolution).toBe('declared-table-owner');

    // platform-ops reste observable comme technical writer — aucune
    // information factuelle perdue : il apparaît toujours dans `writers`.
    const platformOpsWriter = tableOwnership.orders.writers.find(w => w.feature === 'platform-ops');
    expect(platformOpsWriter).toBeDefined();
    expect(platformOpsWriter.technical).toBe(true);

    // platform-ops NE participe PAS au calcul WRITER-NOT-OWNER.
    const debtsOnOrders = warns.filter(w => w.type === 'WRITER-NOT-OWNER' && w.ref === 'orders');
    expect(debtsOnOrders).toHaveLength(0);
  });

  test('un vrai second écrivain métier (sans ~) déclenche bien WRITER-NOT-OWNER, même aux côtés d\'un writer technique', () => {
    // Cas C du brief : ne pas laisser le marqueur ~ sur un writer masquer un
    // AUTRE writer réellement métier sur la même table.
    const manifests = [
      manifest('orders', ['orders: RW!']),
      manifest('platform-ops', ['orders: RW~']),
      manifest('logistics', ['orders: RW']),
    ];
    const { tableOwnership, warns } = resolveTableOwnership(manifests);
    expect(tableOwnership.orders.lifecycleOwner).toBe('orders');
    const debtsOnOrders = warns.filter(w => w.type === 'WRITER-NOT-OWNER' && w.ref === 'orders');
    expect(debtsOnOrders).toHaveLength(1);
    expect(debtsOnOrders[0].msg).toContain('logistics');
    expect(debtsOnOrders[0].msg).not.toContain('platform-ops');
  });

  test('deux owners déclarés "!" en conflit sur la même table -> WRITER-NOT-OWNER (déclaration fautive)', () => {
    const manifests = [
      manifest('catalog', ['products: RW!']),
      manifest('sourcing', ['products: RW!']),
    ];
    const { tableOwnership, warns } = resolveTableOwnership(manifests);
    expect(tableOwnership.products.resolution).toBe('conflicting-declared-owner');
    expect(tableOwnership.products.lifecycleOwner).toBeNull();
    const debts = warns.filter(w => w.type === 'WRITER-NOT-OWNER' && w.ref === 'products');
    expect(debts).toHaveLength(1);
  });

  test('un seul écrivain, aucun marqueur -> single-writer, aucune dette', () => {
    const manifests = [manifest('shared-cart', ['cart_shares: RW'])];
    const { tableOwnership, warns } = resolveTableOwnership(manifests);
    expect(tableOwnership.cart_shares.lifecycleOwner).toBe('shared-cart');
    expect(tableOwnership.cart_shares.resolution).toBe('single-writer');
    expect(warns.filter(w => w.ref === 'cart_shares')).toHaveLength(0);
  });

  test('entrée db.tables illisible -> DB-TABLES-ENTRY-UNPARSED, pas silencieusement ignorée', () => {
    const manifests = [manifest('orders', ['orders WITHOUT COLON'])];
    const { warns } = resolveTableOwnership(manifests);
    expect(warns).toEqual([
      { type: 'DB-TABLES-ENTRY-UNPARSED', ref: 'orders', msg: expect.stringContaining('orders WITHOUT COLON') },
    ]);
  });

  test('parseDbTables reconnaît R / W / RW et les suffixes ! / ~', () => {
    const m = manifest('x', ['a: R', 'b: W!', 'c: RW~', 'd: RW']);
    const parsed = parseDbTables(m);
    expect(parsed).toEqual([
      { table: 'a', mode: 'R', declaredOwner: false, technical: false },
      { table: 'b', mode: 'W', declaredOwner: true, technical: false },
      { table: 'c', mode: 'RW', declaredOwner: false, technical: true },
      { table: 'd', mode: 'RW', declaredOwner: false, technical: false },
    ]);
  });
});
