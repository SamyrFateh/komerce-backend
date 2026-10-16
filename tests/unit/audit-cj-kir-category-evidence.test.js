'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({ query:jest.fn(), pool:{end:jest.fn()} }));
jest.mock('../../services/pricing-engine', () => ({loadGlobalConfig:jest.fn()}));
const audit = require('../../scripts/audit-cj-kir-category-evidence');

const config = {
  categories: {
    default:{key:'default',label:'Par défaut',is_active:true},
    home:{key:'home',label:'Maison & bricolage',is_active:true,
      classification_terms:{'key box':5,'key':1,'hardware':2}},
    clothes:{key:'clothes',label:'Vêtements',is_active:true,
      classification_terms:{'shirt':4}},
    inactive:{key:'inactive',label:'Never',is_active:false,
      classification_terms:{'key box':100}},
  },
  boutique_customs_affinities:[],
};
const row = (name,over={}) => ({
  candidate_ref:'KSC-000100',supplier_product_id:'CJ-001',
  product_name:name,supplier_category:'Home & Garden > Hardware > Key Boxes',
  description:'metal key box',komerce_category:'default',state:'watchlist',
  scan_result:{sourcing_decision:'WATCH',reason:'Catégorie Komerce non résolue — décision impossible.'},
  data_sources:{category:'default'},
  raw_payload:{source:'cj_api_v2',cj:{
    id:'CJ-001',nameEn:name,oneCategoryName:'Home & Garden',
    twoCategoryName:'Hardware',threeCategoryName:'Key Boxes',
    oneCategoryId:'123',description:'Details',
  }},
  ...over,
});
describe('audit CJ KIR : preuve brute et comparaison taxonomie en lecture seule', () => {
  test('récupère niveaux et identifiants réellement fournis, sans inventer un ID', () => {
    expect(audit.sourceCategories(row('Key Box').raw_payload)).toMatchObject({
      path:['Home & Garden','Hardware','Key Boxes'],
      ids:{oneCategoryId:'123'},payload_present:true,title_present:true,
    });
    expect(audit.sourceCategories({cj:{categoryName:'Home > Outdoor'}}).path).toEqual(['Home > Outdoor']);
    expect(audit.sourceCategories({}).payload_present).toBe(false);
  });
  test('rapproche catégories fournisseur / candidat / rang lexical, sans recopier raw_payload complet', () => {
    const input=[
      row('Temporary Metal Waterproof Key Box At The Door'),
      row('No details product',{candidate_ref:'KSC-000101',supplier_product_id:'CJ-002',
        supplier_category:null,description:null,raw_payload:{cj:{nameEn:'No details product'}},
        scan_result:{sourcing_decision:'WATCH',reason:'Catégorie Komerce non résolue'}}),
      row('Ready product',{candidate_ref:'KSC-000102',
        scan_result:{sourcing_decision:'TEST'}}),
    ];
    const p=audit.projectEvidence(input,config);
    expect(p.summary).toMatchObject({
      candidates_present:3,deferred_current:2,
      decisions:{WATCH:2,TEST:1},with_cj_raw:2,
      with_supplier_category:1,
    });
    expect(p.items).toHaveLength(2);
    expect(p.items[0].cj.path).toEqual(['Home & Garden','Hardware','Key Boxes']);
    expect(p.items[0].scored_categories[0].key).toBe('home');
    expect(p.items[0].scored_categories.every(x=>x.key!=='inactive')).toBe(true);
    expect(p.items[0].preview_using_current_config.category).toBe('home');
    expect(p.items[0]).not.toHaveProperty('raw_payload');
    expect(p.items[1].possible_gap).toBe('CJ_CATEGORY_NOT_PRESENT');
  });
  test('charge le KIR exact et sa population historique, jamais les autres imports, sans mutation', async () => {
    const query=jest.fn()
      .mockResolvedValueOnce({rows:[{
        id:'d66126e2-9f0a-4a9f-b74f-f5956de3d719',run_ref:'KIR-000003',
        provider:'CJdropshipping',source_total:20,intake:{deferred:12},
      }]})
      .mockResolvedValueOnce({rows:[row('Key Box')]});
    const loadConfig=jest.fn().mockResolvedValue(config);
    const result=await audit.auditRun('KIR-000003',{query,loadConfig});
    expect(result.recorded).toEqual({received:20,deferred:12});
    expect(result.summary.deferred_current).toBe(1);
    expect(result.provider_api_calls).toBe(0);
    expect(result.classification_domains).toEqual({
      regulatory_estimate: {
        source:'customs_categories',
        authority:'DIAGNOSTIC_ONLY',
        may_set_actual_customs:false,
      },
      boutique_commercial: {
        source:'NOT_EVALUATED',
        authority:'NO_COMMERCIAL_DECISION',
        requires_separate_review:true,
      },
    });
    expect(result.note).toContain('ni taxonomie boutique confirmée');
    expect(result.db_writes).toBe(0);
    expect(result.active_taxonomy.map(item=>item.key)).toEqual(['home','clothes']);
    expect(result.active_taxonomy[0]).toMatchObject({
      key:config.categories.home.key,
      label:config.categories.home.label,
      classification_terms:Object.keys(config.categories.home.classification_terms),
    });
    expect(JSON.stringify(result.active_taxonomy)).not.toMatch(/target_margin|default_weight|currency|price/i);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('import_runtime_item_events');
    expect(query.mock.calls[1][0]).toContain('WHERE r.id=$1');
    expect(query.mock.calls[1][0]).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });
  test('compare la classification des produits TEST sans aucune mutation', () => {
    const accepted=row('Wireless Headphones', {
      candidate_ref:'KSC-000010',komerce_category:'home',
      supplier_category:'Consumer Electronics > Audio > Headphones',
      scan_result:{sourcing_decision:'TEST'},
    });
    const result=audit.projectEvidence([accepted,row('Key Box')],config);
    expect(result.summary.accepted_baseline).toBe(1);
    expect(result.summary.accepted_category_drift).toBe(1);
    expect(result.summary.accepted_category_drift_examples[0])
      .toMatchObject({candidate_ref:'KSC-000010',before:'home',preview:null});
    expect(result.items).toHaveLength(1);
  });

  test('distingue une dérive induite par le retrait de la racine fournisseur d’une classification conservée', () => {
    const cfg={
      ...config,categories:{...config.categories,
        clothes:{...config.categories.clothes,classification_terms:{clothing:8,shirt:8}},
      },
    };
    const losing=row('Generic cotton item', {
      candidate_ref:'KSC-000048',description:null,komerce_category:'clothes',
      supplier_category:'Clothing > Jackets > Outerwear',
      data_sources:{category:'mapped'},scan_result:{sourcing_decision:'TEST'},
      raw_payload:{cj:{oneCategoryName:'Clothing',twoCategoryName:'Jackets',
        threeCategoryName:'Outerwear'}},
    });
    const stable=row('Cotton Shirt', {
      candidate_ref:'KSC-000049',description:null,komerce_category:'clothes',
      supplier_category:'Clothing > Tops > Shirts',
      data_sources:{category:'mapped'},scan_result:{sourcing_decision:'TEST'},
    });
    const report=audit.projectEvidence([losing,stable],cfg);
    expect(report.summary).toMatchObject({
      accepted_baseline:2,accepted_category_drift:1,
      accepted_legacy_flat_matches:2,accepted_legacy_flat_not_reproduced:0,
      accepted_source_distribution:{mapped:2},
    });
    expect(report.accepted_shadow).toHaveLength(2);
    expect(report.accepted_shadow[0]).toMatchObject({
      candidate_ref:'KSC-000048',object_name:'Generic cotton item',
      supplier_category_saved:'Clothing > Jackets > Outerwear',
      stored:{category:'clothes',origin:'mapped',decision:'TEST'},
      previous_flat_scoring:{candidate_key:'clothes',confidence:'high',would_map:true},
      current_preview:{category:null,reason:'no_configured_term_match'},
      category_drift:true,
      historical_comparison:'PREVIOUS_FLAT_SCORING_REPRODUCES_STORED',
    });
    expect(report.accepted_shadow[1].category_drift).toBe(false);
    expect(report.accepted_shadow[1].current_preview.category).toBe('clothes');
    expect(JSON.stringify(report.accepted_shadow)).not.toContain('raw_payload');
    expect(JSON.stringify(report.accepted_shadow)).not.toContain('purchase_price');
  });

  test('un classement historiquement stocké mais impossible à reproduire est signalé distinctement', () => {
    const accepted=row('Unrecognized Object', {
      candidate_ref:'KSC-000051',description:null,komerce_category:'clothes',
      supplier_category:'Random > Other > Generic',
      data_sources:{category:'manual'},scan_result:{sourcing_decision:'TEST'},
    });
    const report=audit.projectEvidence([accepted],config);
    expect(report.summary).toMatchObject({
      accepted_baseline:1,accepted_category_drift:1,
      accepted_legacy_flat_matches:0,accepted_legacy_flat_not_reproduced:1,
      accepted_source_distribution:{manual:1},
    });
    expect(report.accepted_shadow[0].historical_comparison)
      .toBe('STORED_NOT_REPRODUCED_BY_PREVIOUS_FLAT_SCORING');
  });

  test('qualifie les écarts déjà calculés en défauts TAXONOMY, sans nouveau moteur ni rejet', () => {
    const accepted=row('Wireless Headphones', {
      candidate_ref:'KSC-000010',komerce_category:'home',
      supplier_category:'Consumer Electronics > Audio > Headphones',
      scan_result:{sourcing_decision:'TEST'},
    });
    const noDetails=row('No details product',{candidate_ref:'KSC-000101',
      supplier_product_id:'CJ-002',supplier_category:null,description:null,
      raw_payload:{cj:{nameEn:'No details product'}},
      scan_result:{sourcing_decision:'WATCH',reason:'Catégorie Komerce non résolue'}});
    const evidence=audit.projectEvidence([accepted,row('Key Box'),noDetails],config);
    const defects=audit.qualifyTaxonomyDefects(evidence);

    // Candidat déjà accepté (TEST) dont le classement actuel diverge du
    // référentiel courant : la divergence peut venir d'un override humain
    // légitime, donc editorial_review tant qu'aucune preuve explicite ne
    // justifie blocking_review (DOCTRINE_CATALOGUE.md §3, ING-I2).
    expect(defects).toContainEqual(expect.objectContaining({
      category:'TAXONOMY',severity:'editorial_review',candidate_ref:'KSC-000010',
      cause:'classification_deja_acceptee_divergente_du_referentiel_actuel',
    }));
    // Candidat différé avec vocabulaire fournisseur exploitable : constat
    // informatif, pas un rejet.
    expect(defects).toContainEqual(expect.objectContaining({
      category:'TAXONOMY',severity:'informational',candidate_ref:'KSC-000100',
      cause:'referentiel_actif_desormais_suffisant',
    }));
    // Candidat sans aucune donnée fournisseur de catégorie : défaut
    // éditorial à revoir, pas une anomalie bloquante.
    expect(defects).toContainEqual(expect.objectContaining({
      category:'TAXONOMY',severity:'editorial_review',candidate_ref:'KSC-000101',
      cause:'categorie_fournisseur_absente',
    }));
    expect(defects).toHaveLength(3);
  });

  test('auditRun expose taxonomy_defects issu du même diagnostic, en lecture seule', async () => {
    const query=jest.fn()
      .mockResolvedValueOnce({rows:[{
        id:'d66126e2-9f0a-4a9f-b74f-f5956de3d719',run_ref:'KIR-000003',
        provider:'CJdropshipping',source_total:20,intake:{deferred:12},
      }]})
      .mockResolvedValueOnce({rows:[row('Key Box')]});
    const loadConfig=jest.fn().mockResolvedValue(config);
    const result=await audit.auditRun('KIR-000003',{query,loadConfig});
    expect(result.taxonomy_defects).toEqual([expect.objectContaining({
      category:'TAXONOMY',candidate_ref:'KSC-000100',
    })]);
    expect(result.db_writes).toBe(0);
  });

  test('fail closed sur KIR invalide et sur fournisseur autre que CJ', async () => {
    await expect(audit.auditRun('KIR-000003; DROP TABLE',{})).rejects.toThrow('KIR_REF_INVALID');
    const query=jest.fn().mockResolvedValueOnce({rows:[{
      id:'uuid',run_ref:'KIR-000003',provider:'Allegro',source_total:5,
    }]});
    await expect(audit.auditRun('KIR-000003',{query})).rejects.toThrow('KIR_NOT_CJ');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
