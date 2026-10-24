'use strict';
const products = require('../../scripts/recette/demo60/manifest');

describe('staging demo60 durable catalog manifest',()=>{
  test('60 unique stable identifiers and no implicit publication',()=>{
    expect(products).toHaveLength(60);
    expect(new Set(products.map(p=>p.product_ref)).size).toBe(60);
    for(const [i,p] of products.entries()){
      expect(p.product_ref).toBe('DEMO26-'+String(i+1).padStart(3,'0'));
      expect(p.demo_flag).toBe(true);
      expect(p.lifecycle_requested).toBe('DRAFT_NOT_EXPOSED');
      expect(p.image_status).toBe('TO_SOURCE_AND_LICENSE');
      expect(p.supplier_provenance).toBe('UNVERIFIED');
      expect(p.price_status).toBe('NOT_DECIDED');
      expect(p.stock_status).toBe('NOT_CONFIRMED');
      expect(p.name).toEqual(expect.any(String));
    }
  });
});
