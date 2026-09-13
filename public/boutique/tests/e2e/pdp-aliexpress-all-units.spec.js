/** @test-kind e2e @test-runner playwright @test-requires remote-webapp */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, IS_REMOTE, waitForModalOpen } = require('./helpers/boutique.helpers');

const REFS = ['KPR-131413','KPR-131414','KPR-131415','KPR-131416','KPR-131417'];
const PROJECTS = new Set(['Mobile Chrome','Desktop Chrome']);

function esc(value) {
  return String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
}
function optionSelector(axis, value) {
  return `[data-axis-key="${esc(axis)}"] button[data-option-value="${esc(value)}"]`;
}
function kmf(text) {
  const digits=String(text||'').replace(/[^0-9]/g,'');
  return digits?Number(digits):null;
}
async function productAndDetail(page, ref) {
  return page.evaluate(async (wantedRef) => {
    const list = await fetch('/api/products?market=KM&limit=1000').then(r=>r.json());
    const product=(list.products||[]).find(p=>p.product_ref===wantedRef);
    if(!product)return {product:null,detail:null};
    const response=await fetch(`/api/products/${product.id}/detail?market=KM`);
    return {product,detail:response.ok?await response.json():null};
  }, ref);
}
async function openProduct(page, product) {
  const input=page.locator('#k-search-input');
  await input.fill(product.name);
  const item=page.locator(`#k-search-dropdown .k-search-item[data-id="${esc(product.id)}"]`);
  await expect(item).toBeVisible({timeout:8000});
  await item.click();
  await waitForModalOpen(page);
}
async function chooseUnit(page, detail, unit) {
  for(const axis of detail.option_axes||[]) {
    const value=unit.option_values?.[axis.key];
    expect(value, `${unit.sku||unit.sku_id}: valeur manquante pour ${axis.key}`).toBeTruthy();
    const button=page.locator(optionSelector(axis.key,value));
    await expect(button, `${axis.key}=${value}`).toBeVisible({timeout:5000});
    await button.click();
    await expect(page.locator(optionSelector(axis.key,value))).toHaveAttribute('aria-pressed','true');
  }
}

test.describe('AliExpress pilot — every sellable unit',()=>{
  test.beforeEach(async({page},testInfo)=>{
    test.skip(!IS_REMOTE,'remote backend required');
    test.skip(!PROJECTS.has(testInfo.project.name),'Chrome mobile/desktop only');
    await page.goto(`${BASE_URL}?market=KM`,{waitUntil:'domcontentloaded'});
  });

  for(const ref of REFS) test(`${ref} — every SKU/option combination`,async({page})=>{
    const {product,detail}=await productAndDetail(page,ref);
    expect(product,`${ref} doit être visible sur KM`).not.toBeNull();
    expect(detail,`${ref} doit exposer /detail`).not.toBeNull();
    expect(detail.inventory_model,`${ref} doit avoir basculé en SKU`).toBe('SKU');
    expect(Array.isArray(detail.sellable_units)).toBe(true);
    expect(detail.sellable_units.length).toBeGreaterThan(0);

    await openProduct(page,product);

    for(const unit of detail.sellable_units) {
      await chooseUnit(page,detail,unit);
      const available=unit.stock_status==='AVAILABLE'&&Number(unit.available_quantity)>0;
      const add=page.locator('#k-add-cart-btn');
      const buy=page.locator('#k-buy-now-btn');

      if(available) {
        await expect(add,`${unit.sku}: Ajouter`).toBeEnabled();
        await expect(buy,`${unit.sku}: Acheter`).toBeEnabled();
        if(unit.sku) await expect(page.locator('#k-modal-sku')).toContainText(unit.sku);
        const expected=unit.price_kmf??detail.pricing?.price_kmf;
        if(expected!=null) await expect.poll(async()=>kmf(await page.locator('#k-modal-price').textContent())).toBe(expected);
      } else {
        await expect(add,`${unit.sku}: rupture`).toBeDisabled();
        await expect(buy,`${unit.sku}: rupture`).toBeDisabled();
      }
    }
  });
});
