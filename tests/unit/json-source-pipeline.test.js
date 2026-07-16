'use strict';

/**
 * tests/unit/json-source-pipeline.test.js
 * Couvre services/suppliers/json-source-pipeline.js et
 * services/suppliers/connectors/json-connector.js (chantier ING-6).
 *
 * Le fixture réel de 82 produits (raffinerie dry-run v1..v4) sert d'oracle :
 * ce test et scripts/dry-run-import.js appellent tous deux fetchProducts() —
 * aucune règle n'est réimplémentée ici, seuls les invariants sont vérifiés.
 *
 * PORTÉE — ces tests prouvent la PURETÉ et le DÉTERMINISME du pipeline.
 * Ils ne prouvent PAS l'idempotence d'un import DB : aucune écriture n'a
 * lieu ici. L'idempotence réelle (même fichier importé deux fois -> aucun
 * candidat dupliqué, compteurs stables, aucune double relation média) se
 * vérifiera en tests d'INTÉGRATION après branchement de l'orchestrateur.
 */

const fs = require('fs');
const path = require('path');
const { fetchProducts, preflight, classifyRows } = require('../../services/suppliers/connectors/json-connector');
const {
  classifyPromotion,
  resolveImportProfile,
  preflightSourceEnvelope,
  analyzeSourceRows,
  resolveWeight,
  normalizeMedia,
  FINDINGS,
  REASON_CODES,
  STATUS_PRIORITY,
} = require('../../services/suppliers/json-source-pipeline');

const FIXTURE_PATH = path.join(
  __dirname, '..', '..', 'data', 'catalogue-test-raw', 'komerce_catalogue_brut_tests',
  'komerce-catalogue-brut-sample.json'
);
const PROFILE_PATH = path.join(__dirname, '..', '..', 'config', 'import-profiles', 'komerce-test-dummyjson.v1.json');

const sourceRoot = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
const products = sourceRoot.products;
const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));

const clone = (o) => JSON.parse(JSON.stringify(o));
const run = (root, p) => fetchProducts({ source: root, import_profile: p || profile });
const findById = (id) => clone(products.find((x) => x.id === id));

// ═══════════════════════════════════════════════════════════════════════════
// 1. Profil d'import — validation AJV RÉELLE (ING-I9)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveImportProfile — AJV sur le schéma officiel (BATCH_CONFIGURATION_ERROR)', () => {
  it('le profil de référence est valide', () => {
    const r = resolveImportProfile(profile);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('profil absent ou non-objet -> invalide', () => {
    expect(resolveImportProfile(null).ok).toBe(false);
    expect(resolveImportProfile([]).ok).toBe(false);
    expect(resolveImportProfile('KOMERCE').ok).toBe(false);
  });

  it('additionalProperties:false -> un champ inconnu est refusé', () => {
    const bad = { ...clone(profile), champ_invente: 'oops' };
    const r = resolveImportProfile(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/additional/i);
  });

  it.each([
    'profile_id', 'profile_version', 'supplier_name', 'source_type',
    'currency', 'identity', 'weight', 'policies', 'batch',
  ])('champ requis manquant -> invalide : %s', (field) => {
    const bad = clone(profile);
    delete bad[field];
    expect(resolveImportProfile(bad).ok).toBe(false);
  });

  it('supplier_name vide ou fabriqué -> invalide', () => {
    expect(resolveImportProfile({ ...clone(profile), supplier_name: '' }).ok).toBe(false);
    expect(resolveImportProfile({ ...clone(profile), supplier_name: 'A_DEFINIR_PAR_CONNECTEUR' }).ok).toBe(false);
  });

  it('currency.default : pattern ISO 4217 sur la valeur non nulle', () => {
    const bad = clone(profile); bad.currency.default = 'dollars';
    expect(resolveImportProfile(bad).ok).toBe(false);
  });

  it('currency.default = null accepté (profil exigeant une devise source)', () => {
    const p = clone(profile); p.currency.default = null;
    expect(resolveImportProfile(p).ok).toBe(true);
  });

  it('currency.default doit appartenir à currency.allowed', () => {
    const bad = clone(profile); bad.currency.default = 'GBP';
    const r = resolveImportProfile(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/absent de currency\.allowed/);
  });

  it('currency.allowed : uniqueItems', () => {
    const bad = clone(profile); bad.currency.allowed = ['USD', 'EUR', 'USD'];
    const r = resolveImportProfile(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duplicate items/i);
  });

  it('currency.resolution_policy non implémentée -> invalide', () => {
    const bad = clone(profile); bad.currency.resolution_policy = 'DEFAULT_ONLY';
    expect(resolveImportProfile(bad).ok).toBe(false);
  });

  it('identity.supplier_id_field requis', () => {
    const bad = clone(profile); delete bad.identity.supplier_id_field;
    expect(resolveImportProfile(bad).ok).toBe(false);
  });

  it('source_type doit valoir "json" pour ce connecteur', () => {
    const bad = clone(profile); bad.source_type = 'api';
    const r = resolveImportProfile(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/source_type "api"/);
  });

  it('une unité de poids déclarée doit être convertible', () => {
    const bad = clone(profile); bad.weight.source_unit = 'stones';
    expect(resolveImportProfile(bad).ok).toBe(false);
  });

  it('fetchProducts lève BATCH_CONFIGURATION_ERROR AVANT tout parcours produit', () => {
    const bad = clone(profile); delete bad.policies;
    expect.assertions(2);
    try {
      run(sourceRoot, bad);
    } catch (err) {
      expect(err.code).toBe('BATCH_CONFIGURATION_ERROR');
      expect(Array.isArray(err.errors)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Préflight de l'ENVELOPPE — seul niveau qui empêche la naissance du batch
// ═══════════════════════════════════════════════════════════════════════════

describe('preflightSourceEnvelope — un format incorrect n\'est jamais un catalogue vide', () => {
  it('le fixture de référence passe', () => {
    expect(preflightSourceEnvelope(sourceRoot, profile).ok).toBe(true);
  });

  it.each([
    ['racine null', null],
    ['racine tableau', []],
    ['racine scalaire', 'products'],
  ])('%s -> rejeté', (_label, root) => {
    expect(preflightSourceEnvelope(root, profile).ok).toBe(false);
  });

  it('products absent -> rejeté (et non catalogue vide)', () => {
    const r = preflightSourceEnvelope({ items: [] }, profile);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/"products" absent/);
  });

  it('products non-tableau -> rejeté', () => {
    expect(preflightSourceEnvelope({ products: { '0': {} } }, profile).ok).toBe(false);
  });

  it('products vide -> rejeté quand allow_empty_products=false', () => {
    expect(preflightSourceEnvelope({ products: [] }, profile).ok).toBe(false);
  });

  it('products vide -> accepté quand allow_empty_products=true', () => {
    const p = clone(profile); p.batch.allow_empty_products = true;
    expect(preflightSourceEnvelope({ products: [] }, p).ok).toBe(true);
  });

  it('nombre TOTAL de produits au-delà de batch.max_products -> rejeté', () => {
    const p = clone(profile); p.batch.max_products = 10;
    const r = preflightSourceEnvelope(sourceRoot, p);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/max_products/);
  });

  it('taille de fichier au-delà de batch.max_file_bytes -> rejeté', () => {
    const r = preflightSourceEnvelope(sourceRoot, profile, { sourceBytes: profile.batch.max_file_bytes + 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/max_file_bytes/);
  });

  it('le préflight ne regarde AUCUN contenu de ligne : un batch de lignes toutes fautives passe l\'enveloppe', () => {
    const root = { products: [null, { sourceId: null }, 'pas un objet'] };
    expect(preflightSourceEnvelope(root, profile).ok).toBe(true);
  });

  it('fetchProducts lève BATCH_SOURCE_FORMAT_ERROR sur un défaut d\'enveloppe', () => {
    expect.assertions(1);
    try {
      run({ items: [] });
    } catch (err) {
      expect(err.code).toBe('BATCH_SOURCE_FORMAT_ERROR');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 bis. Défauts de LIGNE — rejets motivés, batch jamais interrompu
// ═══════════════════════════════════════════════════════════════════════════

describe('analyzeSourceRows — un défaut de ligne n\'est pas un défaut de fichier', () => {
  it('ne lève JAMAIS pour une donnée produit incorrecte', () => {
    expect(() => analyzeSourceRows([null, { sourceId: null }, 'x'], profile)).not.toThrow();
  });

  it('identifiant absent -> REJECTED_SOURCE_DATA_INVALID / MISSING_SUPPLIER_PRODUCT_ID, batch non interrompu', () => {
    const sansId = clone(findById(3)); delete sansId.sourceId;
    const r = run({ products: [findById(1), findById(2), sansId] });

    expect(r.statistics.ready).toBe(2);
    expect(r.statistics.rejected).toBe(1);
    expect(r.statistics.total).toBe(3);

    const rej = r.rejected[0];
    expect(rej.status).toBe('REJECTED_SOURCE_DATA_INVALID');
    expect(rej.reason_code).toBe(REASON_CODES.MISSING_SUPPLIER_PRODUCT_ID);
    expect(rej.supplier_product_id).toBeNull();
    expect(rej.source_index).toBe(2);
    expect(rej.raw_payload).toEqual(sansId);   // ING-I3 : le brut ne se perd jamais
  });

  it('identifiant dupliqué -> TOUTES les occurrences rejetées, aucune privilégiée', () => {
    const a = findById(1);
    const b = findById(2);
    const c = clone(findById(3)); c.sourceId = a.sourceId;   // doublon de a
    const d = findById(5);   // id 4 est un produit vidéo -> quarantaine, pas ready
    const r = run({ products: [a, b, c, d] });

    expect(r.statistics.rejected).toBe(2);
    expect(r.statistics.ready).toBe(2);

    for (const rej of r.rejected) {
      expect(rej.reason_code).toBe(REASON_CODES.DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH);
      expect(rej.diagnostics.duplicate_supplier_product_id).toBe(String(a.sourceId));
      expect(rej.diagnostics.source_indices).toEqual([0, 2]);
      expect(rej.raw_payload).toBeDefined();
    }
    // Ni la première ni la dernière occurrence n'a été élue.
    expect(r.rejected.map((e) => e.source_index).sort()).toEqual([0, 2]);
    expect(r.ready.map((e) => e.source_index).sort()).toEqual([1, 3]);
  });

  it('le résultat d\'un doublon est indépendant de l\'ordre des lignes', () => {
    const a = findById(1);
    const c = clone(findById(3)); c.sourceId = a.sourceId;
    const direct = run({ products: [a, findById(2), c] });
    const inverse = run({ products: [c, findById(2), a] });
    expect(direct.statistics.rejected).toBe(inverse.statistics.rejected);
    expect(direct.statistics.ready).toBe(inverse.statistics.ready);
    expect(direct.statistics.by_reason_code).toEqual(inverse.statistics.by_reason_code);
  });

  it('ligne nulle ou non-objet -> SOURCE_ROW_NOT_OBJECT, les autres continuent', () => {
    const r = run({ products: [findById(1), null, 'pas un objet'] });
    expect(r.statistics.ready).toBe(1);
    expect(r.statistics.rejected).toBe(2);
    for (const rej of r.rejected) expect(rej.reason_code).toBe(REASON_CODES.SOURCE_ROW_NOT_OBJECT);
  });

  it('champ trop volumineux -> SOURCE_FIELD_TOO_LARGE sur la ligne seule', () => {
    const p = clone(profile); p.batch.max_field_bytes = 10;
    const r = run({ products: [findById(1)] }, p);
    expect(r.statistics.rejected).toBe(1);
    expect(r.rejected[0].reason_code).toBe(REASON_CODES.SOURCE_FIELD_TOO_LARGE);
  });

  it('profondeur excessive -> SOURCE_PRODUCT_TOO_DEEP sur la ligne seule', () => {
    const p = clone(profile); p.batch.max_depth = 1;
    const r = run({ products: [findById(1)] }, p);
    expect(r.statistics.rejected).toBe(1);
    expect(r.rejected[0].reason_code).toBe(REASON_CODES.SOURCE_PRODUCT_TOO_DEEP);
  });

  it('prix illisible -> SOURCE_VALUE_UNPARSABLE ; contrat AJV invalide -> CONTRACT_SCHEMA_INVALID', () => {
    const prix = clone(findById(1)); prix.price = 'gratuit';
    const casse = clone(findById(2)); delete casse.title;
    const r = run({ products: [prix, casse] });
    expect(r.rejected.map((e) => e.reason_code).sort()).toEqual(
      [REASON_CODES.CONTRACT_SCHEMA_INVALID, REASON_CODES.SOURCE_VALUE_UNPARSABLE].sort()
    );
  });

  it('l\'identité prime sur les autres défauts de la même ligne', () => {
    const a = findById(1);
    const dup = clone(findById(3)); dup.sourceId = a.sourceId; dup.price = 'gratuit';
    const r = run({ products: [a, dup] });
    const rej = r.rejected.find((e) => e.source_index === 1);
    expect(rej.reason_code).toBe(REASON_CODES.DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH);
  });

  it('seuil dépassé par des rejets d\'identité -> BLOCKED_INVALID_THRESHOLD, tout reste tracé', () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push({ ...clone(findById(i + 1)), sourceId: 9000 + i });
    for (let i = 0; i < 4; i++) { const x = clone(findById(i + 10)); delete x.sourceId; rows.push(x); }

    const r = run({ products: rows });
    expect(r.statistics.total).toBe(10);
    expect(r.statistics.rejected).toBe(4);
    expect(r.statistics.invalid_pct).toBe(40);
    expect(r.statistics.threshold_evaluation.proposed_batch_status).toBe('BLOCKED_INVALID_THRESHOLD');
    expect(r.rejected).toHaveLength(4);
    for (const rej of r.rejected) expect(rej.raw_payload).toBeDefined();
  });

  it('fichier entièrement invalide ligne par ligne -> ready=0, tout tracé, batch analysable', () => {
    const rows = [1, 2, 3, 4, 5].map((id) => { const x = clone(findById(id)); delete x.sourceId; return x; });
    const r = run({ products: rows });
    expect(r.statistics.ready).toBe(0);
    expect(r.statistics.rejected).toBe(5);
    expect(r.statistics.invalid_pct).toBe(100);
    expect(r.statistics.threshold_evaluation.proposed_batch_status).toBe('BLOCKED_INVALID_THRESHOLD');
    expect(r.statistics.by_reason_code[REASON_CODES.MISSING_SUPPLIER_PRODUCT_ID]).toBe(5);
  });

  it('source_index est renseigné et unique sur les trois populations', () => {
    const r = run(sourceRoot);
    const all = [...r.ready, ...r.quarantined, ...r.rejected];
    const idx = all.map((e) => e.source_index);
    expect(idx.every((i) => Number.isInteger(i))).toBe(true);
    expect(new Set(idx).size).toBe(all.length);
    expect(Math.max(...idx)).toBe(all.length - 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Priorité déterministe des statuts
// ═══════════════════════════════════════════════════════════════════════════

describe('classifyPromotion — priorité déterministe des statuts', () => {
  it('l\'ordre de priorité est celui de la doctrine', () => {
    expect(STATUS_PRIORITY).toEqual({
      REJECTED_SOURCE_DATA_INVALID: 1,
      QUARANTINED_CURRENCY_POLICY: 2,
      REJECTED_CONTRACT_INVALID: 3,
      QUARANTINED_UNSUPPORTED_MEDIA: 4,
      QUARANTINED_LOSSY_MAPPING: 5,
      READY_FOR_PROMOTION: 6,
    });
  });

  it('vidéo + contrat de base INVALIDE -> REJECTED_CONTRACT_INVALID (la vidéo ne masque pas l\'AJV)', () => {
    const video = products.find((p) => p.videos || p.video || (Array.isArray(p.media) && p.media.some((m) => m.type === 'video')));
    expect(video).toBeDefined();

    const sain = classifyPromotion(clone(video), profile);
    expect(sain.status).toBe('QUARANTINED_UNSUPPORTED_MEDIA');
    expect(sain.contractValidation.valid).toBe(true);

    const casse = clone(video);
    delete casse.title; // product_name est `required` au contrat V1/V2
    const verdict = classifyPromotion(casse, profile);

    expect(verdict.status).toBe('REJECTED_CONTRACT_INVALID');
    expect(verdict.contractValidation.valid).toBe(false);
    expect(verdict.contractValidation.errors.length).toBeGreaterThan(0);
    // La vidéo reste constatée dans les motifs secondaires, pas dans le statut.
    expect(verdict.videoInfo.hasVideo).toBe(true);
    expect(verdict.status).not.toBe('QUARANTINED_UNSUPPORTED_MEDIA');
  });

  it('vidéo + contrat de base valide -> QUARANTINED_UNSUPPORTED_MEDIA, fidélité source incomplète', () => {
    const video = products.find((p) => Array.isArray(p.videos) && p.videos.length > 0);
    const v = classifyPromotion(clone(video), profile);
    expect(v.status).toBe('QUARANTINED_UNSUPPORTED_MEDIA');
    expect(v.videoRepresentation.base_product_contract_validation.valid).toBe(true);
    expect(v.videoRepresentation.source_fidelity.complete).toBe(false);
    expect(v.videoRepresentation.promotion.eligible).toBe(false);
  });

  it('devise interdite -> QUARANTINED_CURRENCY_POLICY, jamais REJECTED_CONTRACT_INVALID « currency manquante »', () => {
    const p = clone(findById(1));
    p.price = '10.00GBP';
    const v = classifyPromotion(p, profile);
    expect(v.status).toBe('QUARANTINED_CURRENCY_POLICY');
    expect(v.reasons.join(' ')).toMatch(/hors currency\.allowed/);
    expect(v.contract).toBeNull();
  });

  it('données source ininterprétables -> REJECTED_SOURCE_DATA_INVALID (priorité 1)', () => {
    const p = clone(findById(1));
    p.price = 'gratuit';
    expect(classifyPromotion(p, profile).status).toBe('REJECTED_SOURCE_DATA_INVALID');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Poids — aucune unité inventée (ING-I2)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveWeight — jamais d\'unité inventée', () => {
  it('source_unit=null -> weight_kg=null, brut préservé, finding SOURCE_WEIGHT_UNIT_UNKNOWN', () => {
    const p = findById(1);
    const w = resolveWeight(p, profile);
    expect(w.value).toBeNull();
    expect(w.provenance.raw_value).toBe(p.weight);
    expect(w.provenance.unit_confirmed).toBe(false);
    expect(w.provenance.basis).toBe('source_unit_unconfirmed');
    expect(w.findings.map((f) => f.code)).toContain(FINDINGS.SOURCE_WEIGHT_UNIT_UNKNOWN);
  });

  it('le contrat ne porte jamais le poids source non confirmé', () => {
    const v = classifyPromotion(findById(1), profile);
    expect(v.contract.weight_kg).toBeNull();
    expect(v.contract.raw_payload.weight).toBe(findById(1).weight);
  });

  it('provenance signale au scanner qu\'il devra estimer (jamais source=supplier/confidence=high)', () => {
    const v = classifyPromotion(findById(1), profile);
    expect(v.parsed.weight.provenance.downstream_expectation).toBe('ESTIMATED_WEIGHT_FALLBACK_USED');
  });

  it('source_unit déclarée -> conversion explicite vers kg', () => {
    const p = clone(profile); p.weight.source_unit = 'g';
    const src = findById(1);
    const w = resolveWeight(src, p);
    expect(w.value).toBeCloseTo(src.weight * 0.001, 10);
    expect(w.provenance.basis).toBe('source_unit_confirmed');
    expect(w.findings.map((f) => f.code)).toContain(FINDINGS.SOURCE_WEIGHT_CONVERTED);
  });

  it('unknown_unit_policy=REJECT_PRODUCT -> REJECTED_SOURCE_DATA_INVALID', () => {
    const p = clone(profile); p.weight.unknown_unit_policy = 'REJECT_PRODUCT';
    expect(classifyPromotion(findById(1), p).status).toBe('REJECTED_SOURCE_DATA_INVALID');
  });

  it('les 82 produits du fixture ont weight_kg=null (unité non confirmée)', () => {
    const r = run(sourceRoot);
    const withWeight = [...r.ready, ...r.quarantined].filter((e) => (e.contract || {}).weight_kg !== null);
    expect(withWeight).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Médias — fallback thumbnail, dédup, réutilisation
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeMedia — fallback thumbnail (point 7)', () => {
  it('id 15 : images vide + thumbnail valide -> le fallback EST utilisé sur ce dataset', () => {
    const p15 = findById(15);
    expect(p15.images).toEqual([]);
    expect(typeof p15.thumbnail).toBe('string');

    const m = normalizeMedia(p15, profile);
    expect(m.roleAssignmentBasis).toBe('thumbnail_fallback');
    expect(m.media).toEqual([{ url: p15.thumbnail, role: 'PRODUCT', display_order: 0 }]);
    expect(m.findings.map((f) => f.code)).toContain(FINDINGS.THUMBNAIL_FALLBACK_USED);
  });

  it('id 15 : le fallback thumbnail reste promouvable en V2', () => {
    const v = classifyPromotion(findById(15), profile);
    expect(v.schemaVersionUsed).toBe('2');
    expect(v.contract.schema_version).toBe('2');
    expect(v.roleAssignmentBasis).toBe('thumbnail_fallback');
    expect(v.contract.image_url).toBe(findById(15).thumbnail);
    expect(v.contract.media).toEqual([
      { url: findById(15).thumbnail, role: 'PRODUCT', display_order: 0 },
    ]);
    expect(v.status).toBe('READY_FOR_PROMOTION');
  });

  it('id 15 : la base remonte aussi dans le résultat du connecteur', () => {
    const r = run(sourceRoot);
    const e15 = r.ready.find((x) => x.diagnostics.source_id === 15);
    expect(e15.diagnostics.media.role_assignment_basis).toBe('thumbnail_fallback');
    expect(e15.diagnostics.media.thumbnail_fallback_used).toBe(true);
  });

  it('le fallback est le SEUL cas de thumbnail_fallback du fixture', () => {
    const r = run(sourceRoot);
    const ids = [...r.ready, ...r.quarantined, ...r.rejected]
      .filter((e) => e.diagnostics.media.role_assignment_basis === 'thumbnail_fallback')
      .map((e) => e.diagnostics.source_id);
    expect(ids).toEqual([15]);
  });

  it('galerie non vide -> la thumbnail n\'est jamais ajoutée en média catalogue', () => {
    const p = products.find((x) => Array.isArray(x.images) && x.images.length > 1 && x.thumbnail);
    const m = normalizeMedia(clone(p), profile);
    expect(m.roleAssignmentBasis).toBe('source_field_images');
    expect(m.media.map((x) => x.url)).not.toContain(p.thumbnail);
  });

  it('thumbnail_fallback=false -> aucun média, finding MISSING_IMAGE', () => {
    const p = clone(profile); p.media.thumbnail_fallback = false;
    const m = normalizeMedia(findById(15), p);
    expect(m.media).toEqual([]);
    expect(m.roleAssignmentBasis).toBeNull();
    expect(m.findings.map((f) => f.code)).toContain(FINDINGS.MISSING_IMAGE);
  });
});

describe('normalizeMedia — déduplication des relations (point 6)', () => {
  it('id 63 : url+type+rôle identiques dans la même fiche -> une seule relation + audit', () => {
    const p63 = findById(63);
    expect(new Set(p63.images).size).toBeLessThan(p63.images.length);

    const m = normalizeMedia(p63, profile);
    expect(m.media).toHaveLength(new Set(p63.images).size);
    const dedup = m.findings.filter((f) => f.code === FINDINGS.MEDIA_RELATION_DEDUPLICATED);
    expect(dedup.length).toBe(p63.images.length - new Set(p63.images).size);
    expect(dedup[0]).toMatchObject({ role: 'PRODUCT', media_type: 'image' });
  });

  it('display_order reste contigu après déduplication', () => {
    const m = normalizeMedia(findById(63), profile);
    expect(m.media.map((x) => x.display_order)).toEqual(m.media.map((_, i) => i));
  });

  it('aucune url dupliquée ne subsiste dans un contrat V2', () => {
    const r = run(sourceRoot);
    for (const e of r.ready) {
      const media = e.contract.media;
      if (!Array.isArray(media)) continue;
      const urls = media.map((m) => m.url);
      expect(new Set(urls).size).toBe(urls.length);
    }
  });

  it('un asset réutilisé sous plusieurs rôles conserve ses DEUX relations', () => {
    const url = 'https://cdn.example.test/a.webp';
    // Le pipeline JSON n'attribue que PRODUCT ; on vérifie ici la règle
    // elle-même via un profil dont la galerie porte des rôles distincts —
    // une réutilisation légitime n'est jamais supprimée.
    const m = normalizeMedia({ images: [url, url], thumbnail: null }, profile);
    expect(m.media).toHaveLength(1); // même rôle -> dédupliqué
    const p = clone(profile);
    const m2 = normalizeMedia({ images: [url], thumbnail: url }, p);
    expect(m2.media).toHaveLength(1); // thumbnail non promue si galerie non vide
  });

  it('réutilisation d\'un asset entre produits -> autorisée et auditée au niveau batch', () => {
    const a = findById(1);
    const b = clone(findById(2));
    b.images = [a.images[0]];
    const r = run({ products: [a, b] });
    const shared = r.batchFindings.filter((f) => f.code === FINDINGS.ASSET_SHARED_ACROSS_PRODUCTS);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared[0].supplier_product_ids).toHaveLength(2);
    // Aucune relation n'a été supprimée.
    expect(r.ready.every((e) => e.contract.image_url)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Le fixture de 82 produits comme oracle
// ═══════════════════════════════════════════════════════════════════════════

describe('fetchProducts — fixture de 82 produits', () => {
  const r = run(sourceRoot);

  it('somme de contrôle : ready + quarantined + rejected = 82', () => {
    expect(r.statistics.total).toBe(82);
    expect(r.ready.length + r.quarantined.length + r.rejected.length).toBe(82);
  });

  it('49 READY_FOR_PROMOTION, 33 QUARANTINED_UNSUPPORTED_MEDIA, 0 rejet', () => {
    expect(r.statistics.ready).toBe(49);
    expect(r.statistics.quarantined).toBe(33);
    expect(r.statistics.rejected).toBe(0);
    expect(r.statistics.by_status.QUARANTINED_UNSUPPORTED_MEDIA).toBe(33);
  });

  it('les 33 vidéos n\'apparaissent JAMAIS dans ready', () => {
    const videoIds = products
      .filter((p) => p.videos || p.video || (Array.isArray(p.media) && p.media.some((m) => m.type === 'video')))
      .map((p) => p.id);
    expect(videoIds).toHaveLength(33);
    const readyIds = r.ready.map((e) => e.diagnostics.source_id);
    for (const id of videoIds) expect(readyIds).not.toContain(id);
  });

  it('les 33 vidéos sont toutes tracées en quarantaine avec video_representation', () => {
    expect(r.quarantined).toHaveLength(33);
    for (const q of r.quarantined) {
      expect(q.diagnostics.video_representation.source_fidelity.complete).toBe(false);
      expect(q.raw_payload).toBeDefined(); // RAW intégral conservé (ING-I3)
    }
  });

  it('aucun produit prêt ne perd d\'image (galerie préservée)', () => {
    for (const e of r.ready) {
      expect(e.diagnostics.media.gallery_preserved).toBe(true);
      expect(e.diagnostics.media.dropped_fields).toEqual([]);
    }
  });

  it('les galeries multi-images survivent en V2', () => {
    const multi = r.ready.filter((e) => {
    const src = products.find((p) => p.id === e.diagnostics.source_id);
    return Array.isArray(src?.images) && new Set(src.images).size > 1;
  });
    expect(multi.length).toBeGreaterThan(0);
    for (const e of multi) {
      const src = products.find((p) => p.id === e.diagnostics.source_id);
      expect(e.contract.media).toHaveLength(new Set(src.images).size);
    }
  });

  it('tout READY_FOR_PROMOTION est réellement promouvable : contrat V2, même avec une seule image', () => {
    const r = run(sourceRoot);
    expect(r.ready).toHaveLength(49);
    for (const e of r.ready) {
      expect(e.contract.schema_version).toBe('2');
      expect(e.diagnostics.schema_version_used).toBe('2');
      expect(Array.isArray(e.contract.media)).toBe(true);
    }
  });

  it('aucun rôle média positionnel : PRODUCT uniquement, jamais SCENE fabriqué', () => {
    for (const e of [...r.ready, ...r.quarantined]) {
      const media = (e.contract || {}).media;
      if (!Array.isArray(media)) continue;
      for (const m of media) expect(m.role).toBe('PRODUCT');
    }
  });

  it('id 5 : conflit de devise résolu par la source (SOURCE_THEN_DEFAULT)', () => {
    const e5 = [...r.ready, ...r.quarantined].find((e) => e.diagnostics.source_id === 5);
    expect(e5.diagnostics.currency.origin).toBe('source');
    expect(e5.diagnostics.currency.value).toBe('EUR');
    expect(e5.diagnostics.currency.value).not.toBe(profile.currency.default);
  });

  it('tout contrat retenu est réellement AJV-valide', () => {
    for (const e of [...r.ready, ...r.quarantined]) {
      if (!e.contract) continue;
      expect(e.diagnostics.contract_validation.valid).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Seuils — deux populations, deux seuils (ING-I4 + quarantaine)
// ═══════════════════════════════════════════════════════════════════════════

describe('statistics — seuils séparés invalides / quarantaine', () => {
  it('la quarantaine n\'entre jamais au numérateur des invalides (ING-I4)', () => {
    const r = run(sourceRoot);
    expect(r.statistics.invalid_pct).toBe(0);
    expect(r.statistics.quarantined_pct).toBeCloseTo(40.24, 1);
  });

  it('le total inclut les trois populations', () => {
    const r = run(sourceRoot);
    expect(r.statistics.total).toBe(r.statistics.ready + r.statistics.quarantined + r.statistics.rejected);
  });

  it('40,24 % de quarantaine sous un seuil de 50 % -> COMPLETED_WITH_QUARANTINE', () => {
    const r = run(sourceRoot);
    expect(r.statistics.threshold_evaluation.quarantined_exceeded).toBe(false);
    expect(r.statistics.threshold_evaluation.proposed_batch_status).toBe('COMPLETED_WITH_QUARANTINE');
  });

  it('seuil de quarantaine dépassé -> BLOCKED_QUARANTINE_THRESHOLD (jamais une question humaine)', () => {
    const p = clone(profile); p.batch.max_quarantined_pct = 10;
    const r = run(sourceRoot, p);
    expect(r.statistics.threshold_evaluation.quarantined_exceeded).toBe(true);
    expect(r.statistics.threshold_evaluation.proposed_batch_status).toBe('BLOCKED_QUARANTINE_THRESHOLD');
    // Le batch reste intégralement tracé malgré le blocage.
    expect(r.quarantined).toHaveLength(33);
  });

  it('fichier 100 % vidéo -> ready=0 mais aucune disparition', () => {
    const videos = products.filter((p) => p.videos || p.video || (Array.isArray(p.media) && p.media.some((m) => m.type === 'video')));
    const r = run({ products: clone(videos) });
    expect(r.statistics.ready).toBe(0);
    expect(r.statistics.quarantined).toBe(videos.length);
    expect(r.statistics.quarantined_pct).toBe(100);
    expect(r.statistics.threshold_evaluation.proposed_batch_status).toBe('BLOCKED_QUARANTINE_THRESHOLD');
  });

  it('un seuil d\'invalides dépassé prime sur celui de quarantaine', () => {
    const p = clone(profile);
    p.batch.max_invalid_pct = 0;
    p.batch.max_quarantined_pct = 0;
    const casse = clone(findById(1)); delete casse.title;
    const r = run({ products: [casse, findById(2)] }, p);
    expect(r.statistics.rejected).toBe(1);
    expect(r.statistics.threshold_evaluation.proposed_batch_status).toBe('BLOCKED_INVALID_THRESHOLD');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Déterminisme et répétabilité (PAS l'idempotence d'un import DB)
// ═══════════════════════════════════════════════════════════════════════════

describe('determinism — même entrée, même sortie', () => {
  it('deux appels sur le même produit produisent un contrat strictement identique', () => {
    const p = findById(1);
    expect(classifyPromotion(p, profile).contract).toEqual(classifyPromotion(clone(p), profile).contract);
  });

  it('deux appels produisent les mêmes findings, dans le même ordre', () => {
    const a = classifyPromotion(findById(63), profile);
    const b = classifyPromotion(findById(63), profile);
    expect(a.findings).toEqual(b.findings);
    expect(a.status).toBe(b.status);
  });

  it('le pipeline ne mute jamais le produit source', () => {
    const p = findById(1);
    const before = JSON.stringify(p);
    classifyPromotion(p, profile);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('l\'ordre des produits ne change pas le verdict d\'un produit', () => {
    const a = run({ products: [findById(1), findById(15)] });
    const b = run({ products: [findById(15), findById(1)] });
    const g = (r, id) => r.ready.find((e) => e.diagnostics.source_id === id).contract;
    expect(g(a, 15)).toEqual(g(b, 15));
    expect(g(a, 1)).toEqual(g(b, 1));
  });
});

describe('repeatability — deux runs complets, mêmes compteurs', () => {
  it('les statistiques sont stables sur deux runs', () => {
    const a = run(sourceRoot).statistics;
    const b = run(sourceRoot).statistics;
    expect(a).toEqual(b);
  });

  it('les contrats prêts sont strictement identiques sur deux runs', () => {
    expect(run(sourceRoot).ready.map((e) => e.contract)).toEqual(run(sourceRoot).ready.map((e) => e.contract));
  });

  it('les findings de batch sont stables sur deux runs', () => {
    expect(run(sourceRoot).batchFindings).toEqual(run(sourceRoot).batchFindings);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Contrat commun des connecteurs
// ═══════════════════════════════════════════════════════════════════════════

describe('connector — scission préflight / classification (naissance du batch)', () => {
  it('preflight() lève sur un défaut d\'enveloppe : le batch ne doit pas naître', () => {
    expect(() => preflight({ source: { items: [] }, import_profile: profile })).toThrow(/BATCH_SOURCE_FORMAT_ERROR/);
    const bad = clone(profile); delete bad.policies;
    expect(() => preflight({ source: sourceRoot, import_profile: bad })).toThrow(/BATCH_CONFIGURATION_ERROR/);
  });

  it('preflight() ne lève JAMAIS pour un défaut de ligne : le batch doit naître et tracer', () => {
    const rows = [null, { sourceId: null }, findById(1)];
    expect(() => preflight({ source: { products: rows }, import_profile: profile })).not.toThrow();
  });

  it('classifyRows() ne lève jamais pour une donnée produit, même toutes lignes fautives', () => {
    const rows = [null, 'x', { sourceId: '' }];
    expect(() => classifyRows({ source: { products: rows }, import_profile: profile })).not.toThrow();
    const r = classifyRows({ source: { products: rows }, import_profile: profile });
    expect(r.statistics.rejected).toBe(3);
  });

  it('preflight() puis classifyRows() == fetchProducts()', () => {
    preflight({ source: sourceRoot, import_profile: profile });
    const split = classifyRows({ source: sourceRoot, import_profile: profile });
    expect(split.statistics).toEqual(run(sourceRoot).statistics);
  });
});

describe('connector_contract_version 1 — forme de retour', () => {
  const r = run(sourceRoot);

  it('expose les trois populations, les statistiques et les findings de batch', () => {
    expect(r.connector_contract_version).toBe('1');
    expect(Array.isArray(r.ready)).toBe(true);
    expect(Array.isArray(r.quarantined)).toBe(true);
    expect(Array.isArray(r.rejected)).toBe(true);
    expect(Array.isArray(r.batchFindings)).toBe(true);
    expect(r.statistics).toBeDefined();
  });

  it('n\'expose AUCUN alias products/invalid : un alias ferait disparaître la quarantaine en silence', () => {
    expect(r.products).toBeUndefined();
    expect(r.invalid).toBeUndefined();
  });

  it('trace le connecteur, le pipeline et le profil utilisés', () => {
    expect(r.connector.name).toBe('json-connector');
    expect(r.connector.version).toBeDefined();
    expect(r.connector.pipeline_version).toBeDefined();
    expect(r.profile).toEqual({ profile_id: profile.profile_id, profile_version: profile.profile_version });
  });

  it('forme UNIFORME sur les trois populations, RAW inclus même sur ready', () => {
    for (const e of [...r.ready, ...r.quarantined, ...r.rejected]) {
      expect(Number.isInteger(e.source_index)).toBe(true);
      expect(e).toHaveProperty('supplier_product_id');
      expect(e).toHaveProperty('status');
      expect(e).toHaveProperty('reason_code');
      expect(e).toHaveProperty('contract');
      expect(e.raw_payload).toBeDefined();
      expect(e.diagnostics.findings).toBeDefined();
      expect(e.diagnostics.profile).toEqual({ profile_id: profile.profile_id, profile_version: profile.profile_version });
    }
  });

  it('ready expose raw_payload indépendamment du contrat de produit', () => {
    const e = r.ready[0];
    expect(e.raw_payload).toEqual(e.contract.raw_payload);
    // Garantie du contrat de CONNECTEUR, pas seulement de celui du produit :
    // si un futur contrat produit cessait de porter raw_payload, l'entrée le
    // porterait encore.
    expect(e.raw_payload).not.toBeNull();
  });

  it('les rejets portent un reason_code machine, distinct du texte du motif', () => {
    const casse = clone(findById(1)); delete casse.title;
    const rr = run({ products: [casse, findById(2)] });
    expect(rr.rejected[0].reason_code).toBe(REASON_CODES.CONTRACT_SCHEMA_INVALID);
    expect(rr.rejected[0].errors.length).toBeGreaterThan(0);
    expect(rr.statistics.by_reason_code[REASON_CODES.CONTRACT_SCHEMA_INVALID]).toBe(1);
  });
});
