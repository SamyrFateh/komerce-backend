'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const {
  CLIENT_TITLE_MAX_LENGTH,
  CLIENT_DESCRIPTION_MIN_LENGTH,
  auditProductStockChange,
  validatePublicationUpdate,
} = require('../../services/product-publication-guard');

describe('product-publication-guard', () => {
  it('validatePublicationUpdate laisse passer si le produit reste non publie', () => {
    expect(validatePublicationUpdate({ before: { is_active: false, is_available: false }, patch: {} })).toEqual({ ok: true });
  });

  it('autorise un brouillon Catalogue sans prix tant qu’il reste inactif et indisponible', () => {
    expect(validatePublicationUpdate({
      before: {
        name: 'Brouillon',
        category: 'Maison',
        price_kmf: null,
        stock: 0,
        is_active: false,
        is_available: false,
        lifecycle_status: 'candidate',
      },
      patch: {},
    })).toEqual({ ok: true });
  });

  it('bloque l’activation d’un brouillon sans prix : le prix appartient au gate de publication', () => {
    expect(validatePublicationUpdate({
      before: {
        name: 'Brouillon prêt',
        description: 'Description suffisamment longue pour que seul le prix bloque la publication.',
        category: 'Maison',
        price_kmf: null,
        stock: 1,
        is_active: false,
        is_available: false,
        lifecycle_status: 'candidate',
        content_source: 'manual',
        source_locale: 'fr',
      },
      patch: { is_active: true },
      context: { catalogMediaCount: 1 },
    })).toMatchObject({ ok: false, code: 'invalid_price' });
  });

  it('admet le prix GLOBAL différé uniquement pour un brouillon fournisseur correctement certifié par le caller', () => {
    const before = {
      name: 'Chargeur universel',
      description: 'Chargeur USB-C de voyage compatible avec plusieurs appareils récents.',
      category: 'tech',
      price_kmf: null,
      stock: 12,
      is_active: false,
      is_available: false,
      lifecycle_status: 'candidate',
      content_source: 'manual',
      source_locale: 'fr',
    };
    const options = {
      before,
      patch: { is_active: true, is_available: true },
      context: { catalogMediaCount: 1, allowDeferredLocalPrice: true },
    };
    expect(validatePublicationUpdate(options)).toEqual({ ok: true });
    expect(validatePublicationUpdate({ ...options,
      context: { catalogMediaCount: 1 },
    })).toMatchObject({ ok: false, code: 'invalid_price' });
    expect(validatePublicationUpdate({ ...options,
      before: { ...before, price_kmf: 0 },
    })).toMatchObject({ ok: false, code: 'invalid_price' });
    expect(validatePublicationUpdate({ ...options,
      before: { ...before, price_kmf: -20 },
    })).toMatchObject({ ok: false, code: 'invalid_price' });
    expect(validatePublicationUpdate({ ...options,
      patch: { ...options.patch, price_kmf: 0 },
    })).toMatchObject({ ok: false, code: 'invalid_price' });
  });

  it('validatePublicationUpdate bloque publication sans nom, categorie, prix ou stock valide', () => {
    const base = { name: 'Riz', category: 'food', price_kmf: 1000, stock: 1, is_active: false, is_available: false };

    expect(validatePublicationUpdate({ before: base, patch: { is_active: true, name: '' } })).toMatchObject({ ok: false, code: 'missing_name' });
    expect(validatePublicationUpdate({ before: base, patch: { is_active: true, category: '' } })).toMatchObject({ ok: false, code: 'missing_category' });
    expect(validatePublicationUpdate({ before: base, patch: { is_active: true, price_kmf: 0 } })).toMatchObject({ ok: false, code: 'invalid_price' });
    expect(validatePublicationUpdate({ before: base, patch: { is_active: true, stock: -1 } })).toMatchObject({ ok: false, code: 'invalid_stock' });
  });

  it('refuse une source étrangère brute à la première activation', () => {
    const before = {
      name: 'Gift box product',
      category: 'Créations personnelles',
      price_kmf: 15000,
      stock: 4,
      is_active: false,
      is_available: false,
      content_source: 'connector_raw',
      source_locale: 'en',
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true } }))
      .toMatchObject({ ok: false, code: 'enrichment_required' });
  });

  it('accepte la même source après enrichissement français', () => {
    const before = {
      name: 'Coffret cadeau artistique',
      category: 'Créations personnelles',
      price_kmf: 15000,
      stock: 4,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
      description: 'Coffret cadeau artistique fait main, idéal pour toutes les occasions.',
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true } })).toEqual({ ok: true });
  });

  it('C3 : une fiche d’origine étrangère marquée manual mais restée en anglais est refusée', () => {
    const before = {
      name: 'Wireless headphones with microphone',
      category: 'Audio',
      price_kmf: 15000,
      stock: 4,
      is_active: false,
      is_available: false,
      content_source: 'manual',
      source_locale: 'en',
      name_source: 'Wireless headphones with microphone',
      description: 'Bluetooth wireless headphones for daily use with the best sound and the battery for all day long.',
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true } }))
      .toMatchObject({ ok: false, code: 'french_not_detected' });
  });

  it('C3 : la même fiche correctement rédigée en français passe le gate de langue', () => {
    const before = {
      name: 'Casque audio sans fil avec micro',
      category: 'Audio',
      price_kmf: 15000,
      stock: 4,
      is_active: false,
      is_available: false,
      content_source: 'manual',
      source_locale: 'en',
      name_source: 'Wireless headphones with microphone',
      description: 'Casque audio Bluetooth sans fil pour un usage quotidien, avec un très bon son et une batterie qui tient toute la journée.',
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true }, context: { catalogMediaCount: 1 } }))
      .toEqual({ ok: true });
  });

  it('refuse un titre client trop long ou ressemblant à des métadonnées source', () => {
    const base = {
      category: 'Créations personnelles',
      price_kmf: 15000,
      stock: 4,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
    };
    expect(validatePublicationUpdate({
      before: { ...base, name: 'x'.repeat(CLIENT_TITLE_MAX_LENGTH + 1) },
      patch: { is_active: true },
    })).toMatchObject({ ok: false, code: 'title_too_long' });

    expect(validatePublicationUpdate({
      before: { ...base, name: 'HK LCSD HKHM SS2 coffret cadeau' },
      patch: { is_active: true },
    })).toMatchObject({ ok: false, code: 'title_source_noise' });

    expect(validatePublicationUpdate({
      before: { ...base, name: 'File:gift-box.jpg' },
      patch: { is_active: true },
    })).toMatchObject({ ok: false, code: 'title_source_noise' });
  });

  // ── Gate description ─────────────────────────────────────────────

  it('refuse première activation sans description', () => {
    const before = {
      name: 'Câble USB-C rapide',
      category: 'Tech',
      price_kmf: 5000,
      stock: 10,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
      description: null,
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true } }))
      .toMatchObject({ ok: false, code: 'description_required' });
  });

  it('refuse première activation avec description trop courte', () => {
    const before = {
      name: 'Câble USB-C rapide',
      category: 'Tech',
      price_kmf: 5000,
      stock: 10,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
      description: 'Trop court',
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true } }))
      .toMatchObject({ ok: false, code: 'description_required' });
  });

  it('accepte première activation avec description substantielle', () => {
    const before = {
      name: 'Câble USB-C rapide',
      category: 'Tech',
      price_kmf: 5000,
      stock: 10,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
      description: 'Câble USB-C charge rapide 120W, compatible avec tous les appareils récents.',
    };
    expect(validatePublicationUpdate({ before, patch: { is_active: true } }))
      .toEqual({ ok: true });
  });

  it('le seuil description est exactement CLIENT_DESCRIPTION_MIN_LENGTH', () => {
    const before = {
      name: 'Câble USB-C',
      category: 'Tech',
      price_kmf: 5000,
      stock: 10,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
    };
    expect(validatePublicationUpdate({
      before: { ...before, description: 'x'.repeat(CLIENT_DESCRIPTION_MIN_LENGTH) },
      patch: { is_active: true },
    })).toEqual({ ok: true });
    expect(validatePublicationUpdate({
      before: { ...before, description: 'x'.repeat(CLIENT_DESCRIPTION_MIN_LENGTH - 1) },
      patch: { is_active: true },
    })).toMatchObject({ ok: false, code: 'description_required' });
  });

  // ── Gate média ──────────────────────────────────────────────────

  it('refuse première activation quand context.catalogMediaCount = 0', () => {
    const before = {
      name: 'Câble USB-C rapide',
      category: 'Tech',
      price_kmf: 5000,
      stock: 10,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
      description: 'Câble USB-C charge rapide 120W, compatible avec tous les appareils récents.',
    };
    expect(validatePublicationUpdate({
      before,
      patch: { is_active: true },
      context: { catalogMediaCount: 0 },
    })).toMatchObject({ ok: false, code: 'media_required' });
  });

  it('accepte première activation quand context.catalogMediaCount >= 1', () => {
    const before = {
      name: 'Câble USB-C rapide',
      category: 'Tech',
      price_kmf: 5000,
      stock: 10,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
      description: 'Câble USB-C charge rapide 120W, compatible avec tous les appareils récents.',
    };
    expect(validatePublicationUpdate({
      before,
      patch: { is_active: true },
      context: { catalogMediaCount: 3 },
    })).toEqual({ ok: true });
  });

  it('ne bloque pas sur le média quand context absent (appels legacy)', () => {
    const before = {
      name: 'Câble USB-C rapide',
      category: 'Tech',
      price_kmf: 5000,
      stock: 10,
      is_active: false,
      is_available: false,
      content_source: 'ai_enriched',
      source_locale: 'en',
      description: 'Câble USB-C charge rapide 120W, compatible avec tous les appareils récents.',
    };
    expect(validatePublicationUpdate({
      before,
      patch: { is_active: true },
    })).toEqual({ ok: true });
  });

  it('le gate média ne s\'applique pas aux mises à jour d\'un produit déjà actif', () => {
    const before = {
      name: 'Câble USB-C rapide',
      category: 'Tech',
      price_kmf: 5000,
      stock: 10,
      is_active: true,
      is_available: true,
      content_source: 'ai_enriched',
      source_locale: 'en',
      description: 'Description existante suffisante pour le test.',
    };
    expect(validatePublicationUpdate({
      before,
      patch: { stock: 5 },
      context: { catalogMediaCount: 0 },
    })).toEqual({ ok: true });
  });

  // ── Produit déjà actif ──────────────────────────────────────────

  it('ne réapplique pas les invariants de première activation aux mises à jour d’un produit déjà actif', () => {
    const before = {
      name: 'Titre historique extrêmement long qui reste toléré pendant une simple mise à jour de stock du produit déjà publié',
      category: 'Maison',
      price_kmf: 10000,
      stock: 2,
      is_active: true,
      is_available: true,
      content_source: 'connector_raw',
      source_locale: 'en',
    };
    expect(validatePublicationUpdate({ before, patch: { stock: 3 } })).toEqual({ ok: true });
  });

  it('validatePublicationUpdate accepte publication avec stock null et prix strictement positif', () => {
    expect(validatePublicationUpdate({
      before: { name: 'Riz', category: 'food', price_kmf: 1000, stock: null, is_active: false, is_available: false },
      patch: { is_available: true },
    })).toEqual({ ok: true });
  });

  it('auditProductStockChange skip missing id et stock inchange', async () => {
    const q = { query: jest.fn() };

    await expect(auditProductStockChange(q, { oldStock: 1, newStock: 2 })).resolves.toEqual({ skipped: true, reason: 'missing_product_id' });
    await expect(auditProductStockChange(q, { productId: 'prod-001', oldStock: 1, newStock: 1 })).resolves.toEqual({ skipped: true, reason: 'unchanged' });
    expect(q.query).not.toHaveBeenCalled();
  });

  it('auditProductStockChange insere une alerte avec delta', async () => {
    const q = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'alert-1' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    await expect(auditProductStockChange(q, { productId: 'prod-001', oldStock: 1, newStock: 4, actor: 'admin', source: 'test', note: 'ok' }))
      .resolves.toEqual({ inserted: true, alert_id: 'alert-1' });
    expect(q.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO alerts'),
      expect.arrayContaining(['product_stock_audit', 'product', 'prod-001', 'low'])
    );
  });

  it('auditProductStockChange ne bloque pas si alert insert echoue', async () => {
    const q = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockRejectedValueOnce(new Error('alerts_down'))
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    };

    await expect(auditProductStockChange(q, { productId: 'prod-001', oldStock: 1, newStock: 4 }))
      .resolves.toEqual({ skipped: true, reason: 'alerts_down' });
  });
});


describe('P0 mandatory customer image — source identity and sale guard',()=>{
  const {requiresBuyerImage}=require('../../services/catalog-customer-asset-requirement');
  const required=[
    'Custom Mug 11oz Christmas Photo Gift - Must Upload The Image',
    'Custom Photo Blanket Personalized Fleece Throw | 350gFlannel | Same-Day Shipping | Perfect Gift for Family & Friends 30"X40”',
    'Custom Photo Blanket Personalized Fleece Throw | 350gFlannel | Same-Day Shipping | Perfect Gift for Family & Friends 60”X80”',
    'Custom Photo Blanket Personalized Fleece Throw | 350gFlannel | Same-Day Shipping | Perfect Gift for Family & Friends 40"X50”',
    'Custom Photo Blanket Personalized Fleece Throw | 350gFlannel | Same-Day Shipping | Perfect Gift for Family & Friends 50"X60”'
  ];
  const base={name:'Couverture confortable',description:'Fiche produit française descriptive suffisamment longue.',
    category:'Maison',price_kmf:12000,stock:3,is_active:false,is_available:false,
    content_source:'manual',source_locale:'fr',lifecycle_status:'candidate'};
  test.each(required)('blocks explicit image requirement with no order-item upload: %s',name_source=>{
    expect(requiresBuyerImage(name_source)).toBe(true);
    expect(validatePublicationUpdate({before:{...base,name_source},
      patch:{is_active:true,is_available:true},context:{catalogMediaCount:1}}))
      .toMatchObject({ok:false,code:'buyer_image_checkout_not_supported'});
    expect(validatePublicationUpdate({before:{...base,name_source},patch:{is_available:true}}))
      .toMatchObject({ok:false,code:'buyer_image_checkout_not_supported'});
    expect(validatePublicationUpdate({before:{...base,name_source},patch:{}})).toEqual({ok:true});
  });
  test.each([
    'Cute Dinosaur Ring Love Gift Personalized',
    'Stainless Steel Bracelet Gift Personalized',
    'Personalized Wine Glass Gift Decoration Mug',
    'Unique Wall Hook Personalized Home Gift',
    '24 Pack Straight Sublimation Tumblers Blank',
    'Photo Pattern Fleece Blanket',
    'Mug with Landscape Photo Design',
    'Heat Press Machine With Blank Mugs'
  ])('does not invent an image requirement from personalization alone: %s',name_source=>{
    expect(requiresBuyerImage(name_source)).toBe(false);
    expect(validatePublicationUpdate({before:{...base,name_source},
      patch:{is_active:true},context:{catalogMediaCount:1}})).toEqual({ok:true});
  });
  test('does not lose requirement after French title enrichment',()=>{
    expect(validatePublicationUpdate({before:{...base,name:'Couverture classique',
      name_source:required[1]},patch:{is_active:true},context:{catalogMediaCount:1}}))
      .toMatchObject({ok:false,code:'buyer_image_checkout_not_supported'});
  });
  test('explicit manual title also remains blocked',()=>{
    expect(validatePublicationUpdate({before:{...base,name:'Mug - Must Upload Your Image',
      name_source:null},patch:{is_active:true},context:{catalogMediaCount:1}}))
      .toMatchObject({ok:false,code:'buyer_image_checkout_not_supported'});
  });
});
