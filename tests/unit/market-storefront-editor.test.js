/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const { validateStorefrontTexts, updateMarketStorefront } = require('../../services/market-lifecycle-service');

describe('Market storefront owner writer',()=>{
  test('validates only public allowed fields and max length',()=>{
    expect(validateStorefrontTexts({seo_title:' Komerce Gabon ',relay_default_zone:null}))
      .toEqual({seo_title:'Komerce Gabon',relay_default_zone:null});
    expect(()=>validateStorefrontTexts({payment_secret:'secret'})).toThrow('Champ boutique non autorisé');
    expect(()=>validateStorefrontTexts({seo_title:'a'.repeat(501)})).toThrow('500');
    expect(()=>validateStorefrontTexts([])).toThrow('invalides');
  });
  test('updates canonical market data without activating the market',async()=>{
    const before={id:'11111111-1111-4111-8111-111111111111',code:'GA',lifecycle_status:'PROVISIONING',storefront_texts:{}};
    const after={id:before.id,code:'GA',storefront_texts:{seo_title:'Komerce Gabon'}};
    const query=jest.fn().mockResolvedValueOnce({rows:[before]}).mockResolvedValueOnce({rows:[after]});
    const result=await updateMarketStorefront({query},{marketCode:'GA',storefrontTexts:{seo_title:'Komerce Gabon'}});
    expect(result.changed).toBe(true);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE markets SET storefront_texts/);
    expect(query.mock.calls[1][0]).not.toMatch(/is_active\s*=/);
    expect(result.after).toEqual(after);
  });
  test('CLOSED or unknown markets are rejected',async()=>{
    const closed={id:'11111111-1111-4111-8111-111111111111',code:'GA',lifecycle_status:'CLOSED',storefront_texts:{}};
    const query=jest.fn().mockResolvedValueOnce({rows:[closed]});
    await expect(updateMarketStorefront({query},{marketCode:'GA',storefrontTexts:{welcome:'Hello'}}))
      .rejects.toMatchObject({code:'MARKET_CLOSED',status:409});
    expect(query).toHaveBeenCalledTimes(1);
  });
  test('fails before writing if metadata is invalid',async()=>{
    const query=jest.fn();
    await expect(updateMarketStorefront({query},{marketCode:'GA',storefrontTexts:{unexpected:'no'}}))
      .rejects.toMatchObject({code:'MARKET_STOREFRONT_FIELD_UNKNOWN',status:400});
    expect(query).not.toHaveBeenCalled();
  });
});
