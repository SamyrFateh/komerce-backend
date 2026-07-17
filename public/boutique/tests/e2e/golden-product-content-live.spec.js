/**
 * @e2e   golden-product-content-live.spec.js
 * @feature catalog, modal-product
 * @brief Preuve de LIVRAISON du contenu enrichi : le Golden Product servi par
 *        l'environnement réel expose-t-il un `content` peuplé ?
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 * Neuf tests couvrent aujourd'hui le contenu enrichi (mappers purs, séquence
 * SQL, couture de service, view-model, schéma AJV, layout galerie). Tous sont
 * verts. Aucun ne touche l'environnement réel :
 *
 *   tests/integration/golden-product-content-e2e.test.js  → jest.mock('../../db')
 *   tests/unit/catalog-promotion-content*.test.js         → mappers purs
 *   tests/unit/product-detail-content-schema.test.js      → schéma (content vide = valide)
 *   tests/e2e/modal-mdm9-gallery-layout.spec.js           → données injectées
 *
 * Conséquence : la migration 111 peut ne PAS être déployée, `content` peut être
 * intégralement vide en production, et les neuf tests restent verts. Le contrat
 * étant ADDITIF et le fallback renvoyant `{brand:null, highlights:[], ...}`,
 * l'absence de contenu est indiscernable d'un contenu absent — par conception.
 *
 * Ce spec ferme ce trou, et lui seul. Il ne teste ni le mapping, ni le rendu :
 * il teste que la donnée EST LÀ, servie par l'environnement ciblé.
 *
 * ── CE QU'IL PROUVE ───────────────────────────────────────────────────────
 *   migration 111 déployée + raffinerie exécutée sur le Golden Product
 *     → GET /api/products/:golden/detail expose un content conforme au
 *       contrat promis par tests/fixtures/catalog/golden-elite-pro.js
 *
 * ── ÉTAT ATTENDU AUJOURD'HUI ──────────────────────────────────────────────
 * ROUGE. Vérifié le 17/07/2026 sur komerce-backend-production.up.railway.app :
 * le Golden Product est servi avec inventory_model=SKU et 5 sellable_units
 * corrects (le seed a tourné), mais content = {brand:null, highlights:[], ...}
 * (la migration 111 n'a pas tourné).
 *
 * Ce rouge est le signal. Il verdira quand la migration sera déployée, et il
 * rougira de nouveau si la raffinerie régresse. C'est le seul test du dépôt
 * qui puisse le dire.
 *
 * ── DOCTRINE ──────────────────────────────────────────────────────────────
 * Aucun skip dépendant des données. Une précondition manquante = FAIL.
 * Si le Golden Product est absent de l'environnement, c'est un FAIL et non un
 * skip : un environnement sans Golden Product ne peut prouver aucun contenu.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { BASE_URL, IS_REMOTE } = require('./helpers/boutique.helpers');
const golden = require('../../../../tests/fixtures/catalog/golden-elite-pro');

const GOLDEN_ID = golden.PRODUCT_ID;
const EXPECTED = golden.contentContract();

/**
 * Récupère le contrat détail du Golden Product depuis l'environnement ciblé.
 * Passe par page.request : même origine que le navigateur, cookies inclus,
 * aucune dépendance à un client HTTP tiers.
 */
async function fetchGoldenDetail(request) {
  const url = new URL(`../api/products/${GOLDEN_ID}/detail`, BASE_URL).toString();
  const response = await request.get(url);
  return { status: response.status(), body: response.ok() ? await response.json() : null, url };
}

test.describe('E-CONTENT-LIVE — Livraison du contenu enrichi (Golden Product)', () => {
  // Ce spec n'a de sens que contre un backend réel. En mode LOCAL (statique,
  // sans backend) il n'y a aucune donnée à prouver : skip STRUCTUREL et non
  // dépendant des données, donc légitime.
  test.skip(!IS_REMOTE, 'BASE_URL requis — ce spec prouve une livraison, pas un rendu');

  test('E-CONTENT-LIVE-1 — le Golden Product est servi et expose un content peuplé', async ({ request }) => {
    const { status, body, url } = await fetchGoldenDetail(request);

    // Précondition dure : sans Golden Product, aucune preuve de contenu n'est
    // possible. FAIL explicite plutôt que skip silencieux.
    expect(status, `Golden Product introuvable sur ${url} — seed non joué ?`).toBe(200);
    expect(body, 'contrat détail vide').not.toBeNull();

    const content = body.content;
    expect(content, 'le contrat product_detail_v1 doit exposer la clé content').toBeTruthy();

    // ── Le cœur : content peuplé, pas seulement présent ──────────────────
    expect(
      content.brand,
      'content.brand est null — migration 111 non déployée, ou raffinerie non exécutée sur le Golden Product'
    ).toBe(EXPECTED.brand);

    expect(content.short_description, 'content.short_description est vide').toBe(EXPECTED.short_description);

    expect(
      content.highlights.length,
      `content.highlights est vide (attendu ${EXPECTED.highlights.length}) — le fallback content vide est actif`
    ).toBe(EXPECTED.highlights.length);

    expect(content.specifications.length, 'content.specifications est vide').toBe(EXPECTED.specifications.length);
    expect(content.sections.length, 'content.sections est vide').toBe(EXPECTED.sections.length);
  });

  test('E-CONTENT-LIVE-2 — la provenance atteste un enrichissement réel, pas le fallback', async ({ request }) => {
    const { body } = await fetchGoldenDetail(request);
    expect(body, 'contrat détail vide').not.toBeNull();

    const provenance = body.content && body.content.provenance;
    expect(provenance, 'content.provenance absent du contrat').toBeTruthy();

    // provenance est le témoin le plus honnête du fallback : le service le
    // renvoie à {source:'SUPPLIER', enrichment_version:null, reviewed:false}
    // quand aucune ligne product_content_profile n'existe.
    expect(
      provenance.enrichment_version,
      'enrichment_version=null → aucune ligne product_content_profile : le contenu vient du fallback, pas de la raffinerie'
    ).not.toBeNull();
  });

  test('E-CONTENT-LIVE-3 — le contrat SKU du Golden Product reste intact (non-régression)', async ({ request }) => {
    const { body } = await fetchGoldenDetail(request);
    expect(body, 'contrat détail vide').not.toBeNull();

    // Garde-fou : le lot CONTENT est additif. Il ne doit rien retirer au
    // contrat SKU déjà clos (PDC-8). Ce test est vert aujourd'hui et doit le
    // rester — s'il rougit, l'additivité est cassée.
    expect(body.contract_version).toBe('1');
    expect(body.inventory_model).toBe('SKU');
    expect(body.option_axes.map((axis) => axis.key)).toEqual(['Couleur', 'Taille']);
    expect(body.sellable_units.length).toBe(Object.keys(golden.SKU_IDS).length);

    const available = body.sellable_units.filter(
      (unit) => unit.stock_status === 'AVAILABLE' && Number(unit.available_quantity) > 0
    );
    expect(available.length, 'le Golden Product doit exposer au moins une unité vendable').toBeGreaterThan(0);
  });
});
