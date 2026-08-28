from pathlib import Path


def replace_once(path, before, after):
    p = Path(path)
    src = p.read_text()
    count = src.count(before)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one occurrence, got {count}: {before}")
    p.write_text(src.replace(before, after, 1))


# Direct DB access headers only.
replace_once(
    'services/shipping-customs-workspace.js',
    ' * @db-write      customs_shipments.market_id',
    ' * @db-write      customs_shipments',
)
replace_once(
    'routes/local-stock.js',
    ' * @db-read       local_stock, local_stock_allocations (via le service)',
    ' * @db-read       none',
)
replace_once(
    'services/order-display-snapshot.js',
    ' * @db-read       markets (via utils/currency.js)',
    ' * @db-read       none',
)
replace_once(
    'routes/providers-services.js',
    ' * @db-read       services, physical_offers, providers (via le service)',
    ' * @db-read       none',
)
replace_once(
    'routes/auth-passkey.js',
    ' * @db-read       webauthn_credentials, webauthn_challenges, users (via services)\n * @db-write      webauthn_credentials, webauthn_challenges (via services)',
    ' * @db-read       users\n * @db-write      none',
)

# Exact SQL under-declarations exposed after drift became clean.
replace_once(
    'middleware/require-market-scope.js',
    ' * @used-by       routes admin scoping un market_id (branchement futur, hors M2)\n * @doctrine',
    ' * @used-by       routes admin scoping un market_id (branchement futur, hors M2)\n * @db-read       operator_market_scopes\n * @db-write      none\n * @db-txn        none\n * @doctrine',
)
replace_once(
    'routes/admin/orders.js',
    ' * @db-read       order_items, orders, products, recipients, relais, users',
    ' * @db-read       markets, order_items, orders, products, recipients, relais, users',
)
replace_once(
    'server.js',
    ' * @db-read      none',
    ' * @db-read      currency_parities',
)
replace_once(
    'services/dashboard-metrics/_helpers.js',
    ' * @db-read       (none)',
    ' * @db-read       cash_collections, orders, parcels',
)
replace_once(
    'services/operations-workspace.js',
    ' * @db-read       orders, order_items, parcels, parcel_items, relais, users, inventory_items',
    ' * @db-read       orders, order_items, parcels, parcel_items, products, relais, users, inventory_items',
)
replace_once(
    'services/shipping-customs-workspace.js',
    ' * @db-read       orders, parcels, users, relais, scan_events, customs_shipments, customs_shipment_parcels',
    ' * @db-read       orders, parcels, parcel_items, users, relais, scan_events, customs_shipments, customs_shipment_parcels',
)

# Support schema-qualified CREATE TABLE public.foo in local migration detection.
replace_once(
    'scripts/lib/arch-drift-core.js',
    '`create\\\\s+(table|view)\\\\s+(if\\\\s+not\\\\s+exists\\\\s+)?"?${token}"?\\\\b`,',
    '`create\\\\s+(table|view)\\\\s+(if\\\\s+not\\\\s+exists\\\\s+)?(?:"?public"?\\\\.)?"?${token}"?\\\\b`,',
)

# Migration-backed non-live header tables are deployment intent, not fiction debt.
core_path = Path('scripts/lib/arch-drift-core.js')
core = core_path.read_text()
before = """  const fictionTokens = new Set(fiction.map(f => f.token));
  const fictionUnlisted = fiction.filter(f => !f.allowed);
  // Meme diagnostic que les fantomes, cote header cette fois : une fiction
  // hors liste correspond-elle a une migration locale pas encore en live ?
  const fictionMigrationHints = new Map();
  for (const f of fictionUnlisted) {
    const hit = findLocalMigrationFor(f.token, root);
    if (hit) fictionMigrationHints.set(f.token, hit);
  }"""
after = """  const fictionTokens = new Set(fiction.map(f => f.token));
  // Une reference header vers une table creee par une migration locale mais
  // absente du dump live est une intention de deploiement (Mode B), pas une
  // fiction a masquer dans une allowlist. Elle reste visible dans le rapport
  // et schema-refresh alerte si le deploy tarde.
  const fictionMigrationHints = new Map();
  const fictionPendingMigration = [];
  const fictionUnlisted = [];
  for (const f of fiction.filter(f => !f.allowed)) {
    const hit = findLocalMigrationFor(f.token, root);
    if (hit) {
      fictionMigrationHints.set(f.token, hit);
      fictionPendingMigration.push(f);
    } else {
      fictionUnlisted.push(f);
    }
  }"""
if core.count(before) != 1:
    raise RuntimeError('arch-drift-core classification block mismatch')
core = core.replace(before, after, 1)
old_export = '    fiction, fictionTokens, fictionUnlisted, fictionMigrationHints, allowlistResolved,'
new_export = '    fiction, fictionTokens, fictionUnlisted, fictionPendingMigration, fictionMigrationHints, allowlistResolved,'
if core.count(old_export) != 1:
    raise RuntimeError('arch-drift-core export marker mismatch')
core_path.write_text(core.replace(old_export, new_export, 1))

# Drift report: show migration intent separately and keep blocking fiction honest.
gate_path = Path('scripts/arch-schema-drift-check.js')
gate = gate_path.read_text()
replacements = [
    (
        '  const { fiction, fictionUnlisted, fictionMigrationHints, allowlistResolved, ghosts, ghostMigrationHints, undocumented } = a;',
        '  const { fiction, fictionUnlisted, fictionPendingMigration, fictionMigrationHints, allowlistResolved, ghosts, ghostMigrationHints, undocumented } = a;',
    ),
    (
        '  console.log(`Fiction (figee/connue)  : ${fiction.length - fictionUnlisted.length}`);\n  console.log(`Fantomes SCHEMA.md      : ${ghosts.length}`);',
        '  console.log(`Fiction (figee/connue)  : ${fiction.length - fictionUnlisted.length - fictionPendingMigration.length}`);\n  console.log(`Intention migration     : ${fictionPendingMigration.length}`);\n  console.log(`Fantomes SCHEMA.md      : ${ghosts.length}`);',
    ),
    (
        """  if (fiction.length) {
    console.log('--- FICTION (header -> table inexistante en base) ---');
    for (const f of fiction) {""",
        """  if (fictionPendingMigration.length) {
    console.log('--- INTENTIONS MIGRATION (header -> objet pas encore live, non bloquant) ---');
    for (const f of fictionPendingMigration) {
      console.log(`  [PENDING] ${f.token}`);
      console.log(`            <- ${f.files.slice(0, 6).join(', ')}${f.files.length > 6 ? ', ...' : ''}`);
      console.log(`            migration : ${fictionMigrationHints.get(f.token)}`);
    }
    console.log('');
  }

  const blockingFiction = fiction.filter(f => f.allowed || fictionUnlisted.some(u => u.token === f.token));
  if (blockingFiction.length) {
    console.log('--- FICTION (header -> table inexistante en base) ---');
    for (const f of blockingFiction) {""",
    ),
]
for before_text, after_text in replacements:
    if gate.count(before_text) != 1:
        raise RuntimeError(f'arch-schema-drift-check marker mismatch: {before_text[:60]}')
    gate = gate.replace(before_text, after_text, 1)
gate_path.write_text(gate)

# Reconcile reports pending migrations as information, never as manual allowlist debt.
rec_path = Path('scripts/arch-reconcile.js')
rec = rec_path.read_text()
marker = '  const stillManual = [];\n'
if rec.count(marker) != 1:
    raise RuntimeError('arch-reconcile marker mismatch')
rec_path.write_text(
    rec.replace(
        marker,
        marker
        + "  if (a.fictionPendingMigration && a.fictionPendingMigration.length) {\n"
        + "    console.log(`ℹ️  Intentions migration non live : ${a.fictionPendingMigration.map(f => f.token).join(', ')}`);\n"
        + "  }\n",
        1,
    )
)

# SCHEMA.md = current Railway truth. 154-157 stay schema-pending until observed live.
schema_path = Path('docs/SCHEMA.md')
md = schema_path.read_text()
md = md.replace(
    '| Tables | 105 | Vérifié sur le dump live Railway. |',
    '| Tables | 112 | Vérifié sur le dump live Railway. |',
    1,
)

catalog_anchor = '| `catalog_field_overrides` | Retouches manuelles par champ, réappliquées après chaque re-raffinage (doctrine catalogue §5 — rejouabilité). UNIQUE(product_id, field_name) : dernier override par champ gagne. Le CRUD admin édite cette table, jamais la fiche générée. FK `products` ON DELETE CASCADE. Migration 098, confirmée live. |'
if '| `catalog_global_access_grants` |' not in md:
    if catalog_anchor not in md:
        raise RuntimeError('catalog anchor missing')
    md = md.replace(
        catalog_anchor,
        catalog_anchor
        + '\n| `catalog_global_access_grants` | Grants explicites autorisant les surfaces Catalogue globales ; vérité d’autorisation résolue côté serveur. Vérifiée live Railway. |',
        1,
    )

if '| `operator_market_scopes` |' not in md:
    market_section = """### 4.12 bis — Marchés, autorisations globales et Passkeys (6 tables)

| Table | Rôle |
|---|---|
| `markets` | Référentiel canonique des marchés/pays opérés par Komerce. Vérifiée live Railway. |
| `operator_market_scopes` | Périmètres marché autorisés par opérateur ; frontière serveur des accès market-scoped. Vérifiée live Railway. |
| `currency_parities` | Parités de devise par marché utilisées par la Currency Boundary. Vérifiée live Railway. |
| `dashboard_global_access_grants` | Grants explicites pour les surfaces Dashboard globales ; aucune élévation globale implicite. Vérifiée live Railway. |
| `webauthn_credentials` | Credentials Passkey/WebAuthn persistés pour l’authentification et leur révocation. Vérifiée live Railway. |
| `webauthn_challenges` | Challenges WebAuthn éphémères persistés pour garantir single-use et séparation des cérémonies. Vérifiée live Railway. |

"""
    anchor = '### 4.13 Monitoring et alertes (10 tables)'
    if anchor not in md:
        raise RuntimeError('4.13 anchor missing')
    md = md.replace(anchor, market_section + anchor, 1)

start = md.find('### 4.14 Discovery locale — stock Komerce local & offres tierces')
end = md.find('\n---\n\n## 5. Vues critiques', start)
if start < 0 or end < 0:
    raise RuntimeError('4.14 boundaries missing')
pending_section = """### 4.14 Discovery locale — stock Komerce local & offres tierces (Vague 2)

> **État Railway** : migrations 154–157 présentes dans le repo mais pas encore observées dans le dump live. Les objets restent volontairement en `schema-pending` jusqu’à confirmation Railway ; le code shadow ne transforme jamais cette intention en vérité live.

| Table | Rôle |
|---|---|

<!-- schema-pending
object: local_stock
kind: table
migration: 154
section: ### 4.14 Discovery locale — stock Komerce local & offres tierces (Vague 2)
role: Stock physique vendable détenu par Komerce par marché et localisation ; distinct du stock import/SKU et de l’inventaire de transit. Migration 157 ajoute commercial_exposure et le cycle d’allocation.
-->
<!-- schema-pending
object: providers
kind: table
migration: 155
section: ### 4.14 Discovery locale — stock Komerce local & offres tierces (Vague 2)
role: Tiers local payable portant l’exécution d’un service ou d’une offre physique ; identité distincte de users.
-->
<!-- schema-pending
object: services
kind: table
migration: 155
section: ### 4.14 Discovery locale — stock Komerce local & offres tierces (Vague 2)
role: Prestations de travail proposées par un provider ; exposition commerciale désactivée par défaut.
-->
<!-- schema-pending
object: inquiries
kind: table
migration: 155
section: ### 4.14 Discovery locale — stock Komerce local & offres tierces (Vague 2)
role: Demandes adressées à un provider, sans réservation de ressource ; migration 156 ajoute la cible physical_offer.
-->
<!-- schema-pending
object: physical_offers
kind: table
migration: 156
section: ### 4.14 Discovery locale — stock Komerce local & offres tierces (Vague 2)
role: Produits physiques proposés par un tiers local, séparés des prestations de service.
-->
<!-- schema-pending
object: local_stock_allocations
kind: table
migration: 157
section: ### 4.14 Discovery locale — stock Komerce local & offres tierces (Vague 2)
role: Engagements de commandes sur local_stock avant paiement, avec cycle allocate/consume/release anti-survente.
-->
"""
schema_path.write_text(md[:start] + pending_section + md[end:])
