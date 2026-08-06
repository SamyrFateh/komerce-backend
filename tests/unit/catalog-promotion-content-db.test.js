'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/catalog-promotion-content-db.test.js
 *
 * Couvre les fonctions d'écriture DB du Lot Content dans services/catalog-promotion.js :
 * _promoteContentProfile, _promoteContentSections, _promoteContentAttributes.
 *
 * Le mapping pur (contract -> rows) est couvert par
 * tests/unit/catalog-promotion-content.test.js. Ici on vérifie exclusivement la
 * séquence de requêtes émises et la doctrine d'écriture (docs/doctrine/DOCTRINE_CATALOGUE.md §5) :
 *   ✅ création initiale (INSERT ... ON CONFLICT DO UPDATE, aucun override préexistant)
 *   ✅ préservation d'un override manuel existant (source='MANUAL' -> aucune ligne renvoyée)
 *   ✅ désactivation des sections/attributs disparus du replay, jamais une suppression
 *   ✅ pas de duplication de requête par section/attribut au-delà du nécessaire
 */

const { makeClient } = require('../integration/test-harness/mock-db');
const {
  _promoteContentProfile: promoteContentProfile,
  _promoteContentSections: promoteContentSections,
  _promoteContentAttributes: promoteContentAttributes,
} = require('../../services/catalog-promotion');

describe('catalog-promotion — _promoteContentProfile (Lot Content)', () => {
  it('création/mise à jour : ON CONFLICT DO UPDATE renvoie une ligne -> profile "upserted"', async () => {
    const client = makeClient([{ rows: [{ id: 'content-profile-1' }] }]);
    const updated = await promoteContentProfile(client, 'prod-1', {
      brand: 'Nike', short_description: 'Une robe', source: 'SUPPLIER', enrichment_version: null, reviewed: false,
    });

    expect(updated).toBe(true);
    expect(client.calls[0].sql).toMatch(/INSERT INTO product_content_profile/);
    expect(client.calls[0].sql).toMatch(/WHERE product_content_profile\.source <> 'MANUAL'/);
    expect(client.calls[0].params).toEqual(['prod-1', 'Nike', 'Une robe', 'SUPPLIER', null, false]);
  });

  it('override manuel préexistant : la clause WHERE source <> MANUAL empêche le DO UPDATE -> aucune ligne renvoyée', async () => {
    const client = makeClient([{ rows: [] }]); // ligne existante source='MANUAL' -> DO UPDATE ne s'applique pas, RETURNING vide
    const updated = await promoteContentProfile(client, 'prod-1', {
      brand: 'Nike', short_description: null, source: 'SUPPLIER', enrichment_version: null, reviewed: false,
    });
    expect(updated).toBe(false);
  });
});

describe('catalog-promotion — _promoteContentSections (Lot Content)', () => {
  it('aucune section -> uniquement la requête de désactivation (portée vide), 0 upsert', async () => {
    const client = makeClient([{ rows: [], rowCount: 0 }]);
    const result = await promoteContentSections(client, 'prod-1', []);

    expect(result).toEqual({ upserted: 0, deactivated: 0 });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].sql).toMatch(/UPDATE product_content_sections/);
    expect(client.calls[0].sql).toMatch(/source <> 'MANUAL'/);
  });

  it('une section : 1 upsert + 1 désactivation, jamais de duplication de requête', async () => {
    const client = makeClient([
      { rows: [], rowCount: 1 }, // upsert section
      { rows: [], rowCount: 0 }, // désactivation (portée vide car la seule section est conservée)
    ]);
    const sectionRow = {
      section_key: 'guide-taille', title: 'Guide des tailles', section_type: 'KEY_VALUE',
      content_json: { rows: [] }, display_order: 0, source: 'SUPPLIER',
    };
    const result = await promoteContentSections(client, 'prod-1', [sectionRow]);

    expect(result).toEqual({ upserted: 1, deactivated: 0 });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].sql).toMatch(/INSERT INTO product_content_sections/);
    expect(client.calls[0].sql).toMatch(/ON CONFLICT \(product_id, section_key\) DO UPDATE/);
    expect(client.calls[0].params).toEqual([
      'prod-1', 'guide-taille', 'Guide des tailles', 'KEY_VALUE', JSON.stringify({ rows: [] }), 0, 'SUPPLIER',
    ]);
    expect(client.calls[1].sql).toMatch(/UPDATE product_content_sections/);
    expect(client.calls[1].params).toEqual(['prod-1', ['guide-taille']]);
  });

  it('section disparue du replay -> désactivée (rowCount > 0), jamais supprimée (aucun DELETE émis)', async () => {
    const client = makeClient([{ rows: [], rowCount: 1 }]); // désactivation touche 1 ligne
    const result = await promoteContentSections(client, 'prod-1', []); // replay sans aucune section

    expect(result).toEqual({ upserted: 0, deactivated: 1 });
    expect(client.calls.some((c) => /DELETE/.test(c.sql))).toBe(false);
  });

  it('plusieurs sections : une requête upsert par section, dans l\'ordre, puis une seule désactivation groupée', async () => {
    const client = makeClient([
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ]);
    const rows = [
      { section_key: 'a', title: null, section_type: 'TEXT', content_json: 'A', display_order: 0, source: 'SUPPLIER' },
      { section_key: 'b', title: null, section_type: 'TEXT', content_json: 'B', display_order: 1, source: 'SUPPLIER' },
    ];
    await promoteContentSections(client, 'prod-1', rows);

    expect(client.calls).toHaveLength(3);
    expect(client.calls[2].params).toEqual(['prod-1', ['a', 'b']]);
  });
});

describe('catalog-promotion — _promoteContentAttributes (Lot Content)', () => {
  it('aucun attribut -> uniquement la désactivation (portée vide), 0 upsert', async () => {
    const client = makeClient([{ rows: [], rowCount: 0 }]);
    const result = await promoteContentAttributes(client, 'prod-1', []);

    expect(result).toEqual({ upserted: 0, deactivated: 0 });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].sql).toMatch(/UPDATE product_attributes/);
  });

  it('un attribut : 1 upsert (triplet kind/group_key/attribute_key) + 1 désactivation', async () => {
    const client = makeClient([
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ]);
    const attrRow = {
      kind: 'SPECIFICATION', group_key: 'dimensions', attribute_key: 'poids',
      label: 'Poids', value_text: '500', unit: 'g', display_order: 0, source: 'SUPPLIER',
    };
    const result = await promoteContentAttributes(client, 'prod-1', [attrRow]);

    expect(result).toEqual({ upserted: 1, deactivated: 0 });
    expect(client.calls[0].sql).toMatch(/INSERT INTO product_attributes/);
    expect(client.calls[0].sql).toMatch(/ON CONFLICT \(product_id, kind, group_key, attribute_key\) DO UPDATE/);
    expect(client.calls[0].params).toEqual(['prod-1', 'SPECIFICATION', 'dimensions', 'poids', 'Poids', '500', 'g', 0, 'SUPPLIER']);
    expect(client.calls[1].sql).toMatch(/UPDATE product_attributes/);
    expect(client.calls[1].params).toEqual(['prod-1', ['SPECIFICATION'], ['dimensions'], ['poids']]);
  });

  it('attribut disparu du replay -> désactivé (rowCount > 0), jamais supprimé', async () => {
    const client = makeClient([{ rows: [], rowCount: 1 }]);
    const result = await promoteContentAttributes(client, 'prod-1', []);

    expect(result).toEqual({ upserted: 0, deactivated: 1 });
    expect(client.calls.some((c) => /DELETE/.test(c.sql))).toBe(false);
  });

  it('override manuel préexistant sur un attribut : la clause WHERE source <> MANUAL protège la ligne (upsert silencieux, aucune erreur)', async () => {
    // Le DO UPDATE ne s'applique simplement pas côté DB (WHERE bloque) — le mock ne
    // matérialise pas cette différence (l'appelant ne lit pas RETURNING ici), mais la
    // requête émise porte bien la clause de garde, seule vérité auditable côté JS.
    const client = makeClient([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    const attrRow = {
      kind: 'SPECIFICATION', group_key: 'dimensions', attribute_key: 'poids',
      label: 'Poids', value_text: '500', unit: 'g', display_order: 0, source: 'SUPPLIER',
    };
    await promoteContentAttributes(client, 'prod-1', [attrRow]);
    expect(client.calls[0].sql).toMatch(/source <> 'MANUAL'/);
  });
});
