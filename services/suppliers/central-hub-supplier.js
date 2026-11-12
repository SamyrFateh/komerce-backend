/**
 * @komerce-arch
 * @role          central-hub-supplier-identity
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        database_executor, optional_supplier_id
 * @outputs       canonical_supplier_reference
 * @depends       database, migrations/403_central_hub_supplier_catalog_link.sql
 * @used-by       services/suppliers/catalog-import-orchestrator.js, services/catalog-candidate-product-service.js
 * @db-read       suppliers
 * @db-write      suppliers
 * @db-txn        caller_owned
 * @doctrine      provider_identity_is_not_execution_mode, central_hub_is_internal_procurement_owner
 * @impact-areas  catalog, sourcing, purchasing
 * @version       2026-11
 */
'use strict';

const CENTRAL_HUB = Object.freeze({
  systemKey: 'central_hub',
  name: 'Fournisseur central Hub',
  platform: 'local',
  ownerScope: 'hub',
});

function invalidSupplier(message, code = 'CATALOG_SUPPLIER_INVALID', status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function ensureCentralHubSupplier(q) {
  const inserted = await q.query(
    `INSERT INTO suppliers (name, platform, auto_order, is_active, owner_scope, notes, system_key)
     VALUES ($1, 'local', FALSE, TRUE, 'hub', $2, $3)
     ON CONFLICT (system_key) WHERE system_key IS NOT NULL DO NOTHING
     RETURNING id, name, platform, owner_scope, system_key, auto_order, is_active, deleted_at`,
    [CENTRAL_HUB.name,
      'Entité système de coordination des achats manuels. Pas un vendeur tiers, un provider ni une capacité API.',
      CENTRAL_HUB.systemKey]
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await q.query(
    `SELECT id, name, platform, owner_scope, system_key, auto_order, is_active, deleted_at
       FROM suppliers WHERE system_key = $1`,
    [CENTRAL_HUB.systemKey]
  );
  const row = existing.rows[0];
  if (!row || row.name !== CENTRAL_HUB.name || row.platform !== CENTRAL_HUB.platform
      || row.owner_scope !== CENTRAL_HUB.ownerScope || row.auto_order !== false
      || row.is_active !== true || row.deleted_at != null) {
    throw invalidSupplier('L’identité Fournisseur central Hub est absente ou invalide.',
      'CENTRAL_HUB_SUPPLIER_INVALID', 500);
  }
  return row;
}

async function resolveCatalogSupplier(q, { supplierId = null, supplierName = null } = {}) {
  const id = String(supplierId || '').trim();
  const name = String(supplierName || '').trim();

  if (id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw invalidSupplier('Identifiant fournisseur invalide.');
    }
    const result = await q.query(
      `SELECT id, name, platform, owner_scope, system_key, auto_order, is_active, deleted_at
         FROM suppliers WHERE id = $1::uuid`,
      [id]
    );
    const row = result.rows[0];
    if (!row || !row.is_active || row.deleted_at != null) {
      throw invalidSupplier('Le fournisseur sélectionné est introuvable ou inactif.');
    }
    if (row.system_key === CENTRAL_HUB.systemKey
        && (row.name !== CENTRAL_HUB.name || row.platform !== CENTRAL_HUB.platform
          || row.owner_scope !== CENTRAL_HUB.ownerScope || row.auto_order !== false)) {
      throw invalidSupplier('L’identité Fournisseur central Hub est invalide.', 'CENTRAL_HUB_SUPPLIER_INVALID', 500);
    }
    return row;
  }

  if (!name) return ensureCentralHubSupplier(q);

  const result = await q.query(
    `SELECT id, name, platform, owner_scope, system_key, auto_order, is_active, deleted_at
       FROM suppliers
      WHERE lower(btrim(name)) = lower(btrim($1))
        AND is_active = TRUE AND deleted_at IS NULL
      ORDER BY id
      LIMIT 2`,
    [name]
  );
  if (result.rows.length === 1) return result.rows[0];
  if (result.rows.length > 1) {
    throw invalidSupplier('Plusieurs fournisseurs portent ce nom : sélectionnez une fiche fournisseur.',
      'CATALOG_SUPPLIER_ID_REQUIRED');
  }
  throw invalidSupplier('Ce fournisseur n’est pas enregistré. Créez sa fiche avant de lui rattacher un produit.',
    'CATALOG_SUPPLIER_NOT_REGISTERED');
}

module.exports = { CENTRAL_HUB, ensureCentralHubSupplier, resolveCatalogSupplier };
