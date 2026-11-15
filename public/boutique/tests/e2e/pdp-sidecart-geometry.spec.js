/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */
'use strict';

// Preuve Chromium non mutante : vraie coque Boutique/CSS, catalogue de recette
// intercepté uniquement pour construire 4 lignes de panier déterministes.
// Aucun paiement, aucun POST de commande ni écriture DB.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { buildEnrichedFixture } = require('./helpers/geometry-fixtures');

const OUT = path.join(process.cwd(), 'test-results', 'pdp-sidecart-geometry');
const SIZES = [1440, 1700, 1920];
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000/boutique/';

function fixtureProduct(detail) {
  return {
    id: detail.product.id,
    name: detail.product.name,
    price_kmf: detail.pricing.price_kmf,
    description: detail.product.description || '',
    images: (detail.media || []).map(media => media.url),
    image_url: (detail.media || [])[0]?.url || '',
    category: detail.product.category || 'mode',
    is_available: true, stock: 12,
    inventory_model: detail.inventory_model,
  };
}

async function openWithFourCartLines(page, customDetail = null) {
  const detail = customDetail || buildEnrichedFixture();
  // Le rail unique est volontairement sans supplément visible.
  detail.delivery_options = [{
    code: 'SEA_STANDARD', label: 'Livraison standard',
    available: true, price_kmf: null, eta_label: null, unavailable_reason: null,
  }];
  const product = fixtureProduct(detail);
  // Staging utilise les API de bootstrap réelles. Le fallback [] est
  // réservé au serveur local statique sans backend.
  if (!process.env.BASE_URL) {
    await page.route(/\/api\//, route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
  }
  await page.route(/\/api\/boutique\/suggestions/, route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"suggestions":[]}',
  }));
  await page.route(/\/api\/products(\?|$)/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([product]),
  }));
  await page.route(/\/api\/products\/[^/]+\/detail/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(detail),
  }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // Ne pas dépendre des globals debug, absents volontairement en staging.
  // Playwright importe les modules canoniques dans l'origine de la page :
  // aucun instrument de debug n'est ajouté au runtime public.
  await page.waitForSelector('#k-modal-overlay', { state: 'attached', timeout: 12000 });
  await page.evaluate(async product => {
    const [{ state }, { bus }] = await Promise.all([
      import('/boutique/js/b-store.js'),
      import('/boutique/js/b-bus.js'),
    ]);
    if (!state || !bus) throw new Error('Modules Boutique non disponibles');
    const items = [
      { variant: 'Red / 3XL', qty: 2 },
      { variant: 'Red / XL', qty: 1 },
      { variant: 'Black / L', qty: 1 },
      { variant: 'Black / 4XL', qty: 1 },
    ];
    state.cart = items.map((item, i) => ({
      product: {
        id: 'pdp-proof-' + i,
        name: 'Chemise femme à imprimé multicolore',
        price_kmf: 8990,
        image_url: product.image_url,
      },
      qty: item.qty,
      variant_label: item.variant,
    }));
    bus.emit('side-cart:render');
    if (!state.products.some(p => String(p.id) === String(product.id))) state.products.push(product);
    bus.emit('modal:open', { id: product.id });
  }, product);
  await expect(page.locator('#k-modal')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#k-modal .k-modal-cart-slot #k-side-cart')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#k-modal .k-sc-item')).toHaveCount(4, { timeout: 7000 });
  await page.waitForTimeout(350);
}

function bounds(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
}

for (const width of SIZES) {
  test('PDP side cart / galerie / buybox à ' + width + 'px', async ({ page }) => {
    test.setTimeout(35000);
    await page.setViewportSize({ width, height: 900 });
    await openWithFourCartLines(page);
    const evidence = await page.evaluate(() => {
      const q = selector => document.querySelector(selector);
      const box = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, width: r.width, right: r.right, y: r.y, height: r.height };
      };
      const body = box(q('#k-modal .k-modal-body'));
      const gallery = box(q('#k-modal .k-modal-product-zone .k-modal-img-wrap'));
      const buybox = box(q('#k-modal .k-modal-product-zone > .k-modal-right-rail'));
      const side = box(q('#k-modal .k-modal-cart-slot'));
      const cart = box(q('#k-modal .k-modal-cart-slot #k-side-cart'));
      const lines = [...document.querySelectorAll('#k-modal .k-sc-item')].map(box);
      const controls = [...document.querySelectorAll('#k-modal .k-sc-item-actions, #k-modal .k-sc-subtotal-amount, #k-modal #k-sc-checkout')].map(box);
      const overflow = controls.filter(c => c && side && (c.right > side.right - 5 || c.x < side.x - 2));
      return {
        viewport: innerWidth,
        body, gallery, buybox, side, cart, lines, controls,
        overflowCount: overflow.length,
        overflow,
        documentOverflowX: document.documentElement.scrollWidth - innerWidth,
        transportText: q('#k-modal-delivery')?.textContent?.trim() || '',
      };
    });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'measure-' + width + '.json'), JSON.stringify(evidence, null, 2));
    await page.screenshot({
      path: path.join(OUT, 'pdp-' + width + '.png'), animations: 'disabled',
    });
    expect(evidence.body).not.toBeNull();
    expect(evidence.side).not.toBeNull();
    expect(evidence.cart).not.toBeNull();
    expect(evidence.cart.width).toBeGreaterThanOrEqual(evidence.side.width - 2);
    expect(evidence.cart.right).toBeLessThanOrEqual(evidence.side.right + 2);
    expect(evidence.gallery).not.toBeNull();
    expect(evidence.buybox).not.toBeNull();
    console.log('PDP_GEOMETRY_EVIDENCE', JSON.stringify(evidence));
    expect(evidence.side.width).toBeGreaterThanOrEqual(width === 1440 ? 260 : width === 1700 ? 302 : 316);
    expect(evidence.overflowCount, JSON.stringify(evidence.overflow)).toBe(0);
    expect(evidence.documentOverflowX).toBeLessThanOrEqual(2);
    const ratio = {
      gallery: evidence.gallery.width / evidence.body.width,
      buybox: evidence.buybox.width / evidence.body.width,
      side: evidence.side.width / evidence.body.width,
    };
    expect(ratio.gallery).toBeGreaterThan(.33);
    expect(ratio.gallery).toBeLessThan(.40);
    expect(ratio.buybox).toBeGreaterThan(.39);
    expect(ratio.buybox).toBeLessThan(.49);
    expect(ratio.side).toBeGreaterThan(.16);
    expect(ratio.side).toBeLessThan(.20);
    expect(evidence.transportText).not.toContain('26 KMF');
    const ctaRatio = await page.evaluate(() => {
      const add = document.getElementById('k-add-cart-btn')?.getBoundingClientRect().width || 0;
      const buy = document.getElementById('k-buy-now-btn')?.getBoundingClientRect().width || 0;
      return add / (add + buy);
    });
    expect(ctaRatio).toBeGreaterThan(.41);
    expect(ctaRatio).toBeLessThan(.49);
    // Oracle du mock canonique : fiche descriptif/caractéristiques avant
    // suggestions, une seule colonne scrollable, panier stationnaire.
    const hierarchy = await page.evaluate(() => {
      const panel = document.getElementById('k-modal-long-details');
      const desc = document.getElementById('k-modal-long-description');
      const specs = panel?.querySelector('.k-modal-enriched-block--specs');
      const suggestions = document.getElementById('k-modal-suggestions');
      const main = document.querySelector('#k-modal .k-modal-main');
      const cart = document.querySelector('#k-modal .k-modal-cart-slot');
      const box = e => e?.getBoundingClientRect();
      return {
        heading: panel?.querySelector('#k-modal-long-details-heading')?.textContent,
        description: desc?.textContent,
        specs: specs?.textContent,
        panelColumns: getComputedStyle(panel).gridTemplateColumns.split(' ').length,
        panelTop: box(panel)?.top,
        suggestionsHidden: suggestions?.classList.contains('u-hidden'),
        cartTop: box(cart)?.top,
        mainOverflow: getComputedStyle(main).overflowY,
        brandVisible: box(document.querySelector('#k-modal .k-modal-brand'))?.width > 0,
      };
    });
    expect(hierarchy.heading).toContain('Détails du produit');
    expect(hierarchy.description?.length).toBeGreaterThan(10);
    expect(hierarchy.specs?.length).toBeGreaterThan(10);
    expect(hierarchy.panelColumns).toBe(2);
    expect(hierarchy.suggestionsHidden).toBe(true);
    expect(hierarchy.mainOverflow).toBe('auto');
    expect(hierarchy.brandVisible).toBe(true);
    // La capture CM a révélé une galerie de ~810px avec photo ~390px,
    // donc 250-350px de vide avant la carte. Ce ratio doit rester borné.
    const fidelity = await page.evaluate(() => {
      const q = selector => document.querySelector(selector);
      const rect = e => e?.getBoundingClientRect();
      const gallery = rect(q('#k-modal .k-modal-img-wrap'));
      const carousel = rect(q('#k-modal .k-modal-carousel'));
      const buybox = rect(q('#k-modal .k-modal-right-rail'));
      const panel = rect(q('#k-modal-long-details'));
      return {
        emptyMediaTail: gallery.height - carousel.height,
        mediaHeight: gallery.height,
        panelGap: panel.top - Math.max(gallery.bottom, buybox.bottom),
        brandCount: document.querySelectorAll('#k-modal .k-modal-brand').length,
        cartIconDisplay: getComputedStyle(q('#k-modal .k-modal-cart-btn')).display,
        longDescriptionClamped: Boolean(q('#k-modal-long-description .k-modal-enriched-read-more')),
      };
    });
    expect(fidelity.emptyMediaTail).toBeLessThanOrEqual(35);
    expect(fidelity.mediaHeight).toBeLessThanOrEqual(670);
    expect(fidelity.panelGap).toBeGreaterThanOrEqual(-2);
    expect(fidelity.panelGap).toBeLessThanOrEqual(65);
    expect(fidelity.brandCount).toBe(1);
    expect(fidelity.cartIconDisplay).toBe('none');
    expect(fidelity.longDescriptionClamped).toBe(false);
    fs.writeFileSync(path.join(OUT, 'fidelity-' + width + '.json'), JSON.stringify(fidelity, null, 2));
    await page.locator('#k-modal .k-modal-main').evaluate(el => { el.scrollTop = 420; });
    await page.screenshot({
      path: path.join(OUT, 'pdp-below-hero-' + width + '.png'),
      animations: 'disabled',
    });
  });
}

test('PDP desktop CM : fiche historique sans content.specifications', async ({ page }) => {
  await page.setViewportSize({ width: 1650, height: 900 });
  const detail = buildEnrichedFixture();
  detail.content = null;
  detail.product.description =
    'Débardeur de sport à coupe ample et dos fendu. ' +
    'Matière : tissu lycra, composition 100 % fibre de cupro. ' +
    'Coloris proposés : bleu saphir, noir, caramel, camel. ' +
    'Tailles : S, M, L, XL. Les tailles asiatiques taillent plus petit. ' +
    'Contenu : 1 débardeur.';
  detail.option_axes[0].values = ['Gris', 'Noir', 'Beige', 'Camel']
    .map(value => ({ value, thumbnail_url: null }));
  await openWithFourCartLines(page, detail);
  const panel = page.locator('#k-modal-long-details');
  await expect(panel.locator('.k-modal-enriched-block--specs')).toContainText('Tailles');
  await expect(panel.locator('.k-modal-enriched-block--specs')).toContainText('Contenu');
  await expect(panel.locator('.k-modal-enriched-block--specs')).toContainText('Coupe');
  await expect(panel.locator('.k-modal-enriched-block--specs')).toContainText('Dos');
  await expect(page.locator('#k-modal-long-description .k-modal-enriched-read-more')).toHaveCount(0);
  const swatches = await page.locator('#k-modal .k-vg-skus .k-sku--color').evaluateAll(els =>
    els.map(el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height, radius: style.borderRadius };
    })
  );
  expect(swatches.length).toBe(4);
  swatches.forEach(swatch => {
    expect(swatch.width).toBeLessThanOrEqual(44);
    expect(Math.abs(swatch.width - swatch.height)).toBeLessThanOrEqual(2);
    expect(parseFloat(swatch.radius)).toBeGreaterThanOrEqual(swatch.width / 2);
  });
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({
    path: path.join(OUT, 'pdp-cm-legacy-1650.png'), animations: 'disabled',
  });
});

test('marché KM — devis maritime interne non exposé sur le détail public réel', async ({ request }) => {
  test.skip(!process.env.BASE_URL, 'Contrôle du serveur réel réservé à la campagne staging');
  const root = new URL(BASE);
  const catalog = await request.get(new URL('/api/products?market=KM&limit=1000', root).toString());
  expect(catalog.ok()).toBeTruthy();
  const body = await catalog.json();
  const product = (body.products || body.items || (Array.isArray(body) ? body : []))
    .find(x => x.product_ref === 'KPR-000101');
  expect(product, 'Le produit de la capture doit être exposé en staging KM').toBeDefined();
  const response = await request.get(new URL('/api/products/' + product.id + '/detail?market=KM', root).toString());
  expect(response.ok()).toBeTruthy();
  const detail = await response.json();
  const sea = (detail.delivery_options || []).find(x => x.code === 'SEA_STANDARD');
  expect(sea).toBeDefined();
  expect(sea.price_kmf).toBeNull();
});

test('AUDIT VISUEL — vraie fiche débardeur CM, sans fixture ni mutation', async ({ page, request }) => {
  test.skip(!process.env.BASE_URL, 'Réservé à la campagne Chromium distante sur staging');
  test.setTimeout(65000);
  await page.setViewportSize({ width: 1586, height: 992 });

  const root = new URL(BASE);
  const url = new URL('/api/products?market=CM&limit=1000', root);
  const response = await request.get(url.toString());
  expect(response.ok(), 'Catalogue CM HTTP ' + response.status()).toBeTruthy();
  const raw = await response.json();
  const products = Array.isArray(raw) ? raw
    : (raw.products || raw.items || raw.data?.products || []);
  expect(Array.isArray(products), 'Structure catalogue CM').toBe(true);
  const norm = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const target = products.find(p => {
    const name = norm(p.name || p.title || p.product_name);
    return name.includes('debardeur') && (name.includes('dos fendu') || name.includes('coupe ample'));
  });
  expect(target, 'Débardeur CM réel absent. Exemples catalogue: ' +
    products.slice(0, 15).map(p => p.name || p.title).join(' | ')).toBeDefined();

  const out = path.join(OUT, 'cm-real-fidelity');
  fs.mkdirSync(out, { recursive: true });
  await page.goto(new URL('/CM', root).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#k-modal-overlay', { state: 'attached', timeout: 12000 });
  const suggestionsResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/boutique/suggestions' &&
      url.searchParams.get('surface') === 'pdp' &&
      url.searchParams.get('market') === 'CM' &&
      url.searchParams.get('viewed_product_id') === String(target.id || target.product_id);
  });
  await page.evaluate(async item => {
    const [{ state }, { bus }] = await Promise.all([
      import('/boutique/js/b-store.js'), import('/boutique/js/b-bus.js'),
    ]);
    const product = { ...item, id: item.id || item.product_id };
    if (!state.products.some(p => String(p.id) === String(product.id))) state.products.push(product);
    bus.emit('modal:open', { id: product.id });
  }, target);
  await expect(page.locator('#k-modal')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#k-modal-name')).toContainText(/Débardeur/i, { timeout: 15000 });
  await expect(page.locator('#k-modal-long-description')).toBeVisible({ timeout: 15000 });
  const suggestionsResult = await suggestionsResponse;
  expect(suggestionsResult.ok()).toBe(true);
  const { suggestions } = await suggestionsResult.json();
  expect(suggestions.length).toBeLessThanOrEqual(3);
  const visibleIds = new Set(products.map(product => String(product.id || product.product_id)));
  for (const suggestion of suggestions) {
    expect(visibleIds.has(String(suggestion.product_id))).toBe(true);
    expect(suggestion.name).not.toMatch(/casserole/i);
  }
  await page.waitForTimeout(350);

  const audit = await page.evaluate(() => {
    const q = selector => document.querySelector(selector);
    const box = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
        w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
        bottom: Math.round(r.bottom * 10) / 10,
        display: css.display, position: css.position, gap: css.gap,
        padding: css.padding, fontSize: css.fontSize, borderRadius: css.borderRadius,
        objectFit: css.objectFit, aspectRatio: css.aspectRatio,
      };
    };
    const main = q('#k-modal .k-modal-main');
    const gallery = q('#k-modal .k-modal-img-wrap');
    const carousel = q('#k-modal .k-modal-carousel');
    const panel = q('#k-modal-long-details');
    const title = q('#k-modal-name');
    const side = q('#k-modal .k-modal-cart-slot');
    const add = q('#k-add-cart-btn');
    const buy = q('#k-buy-now-btn');
    const slides = [...document.querySelectorAll('#k-modal .k-modal-slide')];
    const activeSlide = slides.find(el => el.getBoundingClientRect().x >= (carousel?.getBoundingClientRect().x || 0) - 10) || slides[0];
    const swatches = [...document.querySelectorAll('#k-modal .k-sku--color')].map(box);
    const thumbs = [...document.querySelectorAll('#k-modal .k-modal-thumbs img')].map(box);
    const suggestionCards = [...document.querySelectorAll('#k-modal-suggestions .k-sug-card')].map(box);
    const geom = {
      width: innerWidth, height: innerHeight,
      main: box(main), side: box(side),
      gallery: box(gallery), carousel: box(carousel),
      thumbnails: box(q('#k-modal .k-modal-thumbs')), thumbs,
      slide: box(activeSlide),
      buybox: box(q('#k-modal .k-modal-right-rail')),
      title: box(title), price: box(q('#k-modal-price')),
      swatches, add: box(add), buy: box(buy),
      desc: box(q('#k-modal-long-description')),
      details: box(panel), specs: box(panel?.querySelector('.k-modal-enriched-block--specs')),
      suggestions: box(q('#k-modal-suggestions')), suggestionCards,
      brand: box(q('#k-modal .k-modal-brand')),
      cardTitle: q('#k-modal-suggestions .k-sug-title')?.textContent.trim() || '',
      productTitle: title?.textContent.trim() || '',
      productPrice: q('#k-modal-price')?.textContent.trim() || '',
      description: q('#k-modal-long-description')?.textContent.trim().slice(0, 700) || '',
      imageSrc: activeSlide?.currentSrc || activeSlide?.src || '',
      imageNatural: { width: activeSlide?.naturalWidth, height: activeSlide?.naturalHeight },
      miniCartCount: q('#k-modal .k-modal-cart-slot')?.querySelectorAll('.k-sc-item').length || 0,
      bodyScrollY: main?.scrollTop, productCount: slides.length,
      suggestionCount: suggestionCards.length,
      suggestionsHidden: !!q('#k-modal-suggestions')?.classList.contains('u-hidden'),
    };
    geom.sideRatio = geom.side?.w / geom.width;
    geom.galleryRatio = geom.gallery?.w / geom.width;
    geom.buyboxRatio = geom.buybox?.w / geom.width;
    geom.buyButtonRatio = geom.buy?.w / (geom.buy?.w + geom.add?.w);
    geom.galleryThumbGap = (geom.carousel?.x || 0) - (geom.thumbnails?.x || 0) - (geom.thumbnails?.w || 0);
    geom.descriptionGap = (geom.details?.y || 0) - Math.max(geom.gallery?.bottom || 0, geom.buybox?.bottom || 0);
    return geom;
  });
  fs.writeFileSync(path.join(out, 'cm-real-layout.json'), JSON.stringify({
    product: { id: target.id || target.product_id, name: target.name || target.title },
    measured: audit,
    reference: {
      imageSize: { w: 1586, h: 992 }, 
      note: 'Mock utilisateur; cibles indicatives à corroborer par revue visuelle',
      cartWidthPx: [250, 300],
      photoHeightPx: [480, 515],
      addShareOfCtas: [0.42, 0.48],
      detailPanelStartsNear: 610,
    },
  }, null, 2));
  await page.screenshot({ path: path.join(out, 'cm-real-at-open-1586x992.png'), animations: 'disabled' });
  await page.locator('#k-modal .k-modal-main').evaluate(el => { el.scrollTop = 380; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'cm-real-after-scroll-1586x992.png'), animations: 'disabled' });
  const thumbs = page.locator('#k-modal .k-modal-thumb');
  if (await thumbs.count() >= 5) {
    await thumbs.last().click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, 'cm-real-last-thumbnail-1586x992.png'), animations: 'disabled' });
  }
  console.log('PDP_CM_REAL_FIDELITY_AUDIT', JSON.stringify(audit));
  expect(audit.productTitle.toLowerCase()).toContain('débardeur');
  expect(audit.gallery).not.toBeNull();
  expect(audit.buybox).not.toBeNull();
  expect(audit.side).not.toBeNull();
  // Cibles du mock validé à 1586 × 992 : la fixture ne fait pas foi,
  // ce contrat s'exécute sur le produit CM et ses vraies images.
  expect(audit.sideRatio).toBeGreaterThan(.16);
  expect(audit.sideRatio).toBeLessThan(.20);
  expect(audit.galleryRatio).toBeGreaterThan(.33);
  expect(audit.galleryRatio).toBeLessThan(.39);
  expect(audit.buyboxRatio).toBeGreaterThan(.40);
  expect(audit.buyboxRatio).toBeLessThan(.48);
  expect(audit.buyButtonRatio).toBeGreaterThan(.51);
  expect(audit.buyButtonRatio).toBeLessThan(.59);
  expect(audit.galleryThumbGap).toBeGreaterThanOrEqual(20);
  expect(audit.galleryThumbGap).toBeLessThanOrEqual(26);
  expect(audit.thumbnails.h).toBeLessThanOrEqual(460);
  expect(audit.gallery.bottom).toBeLessThanOrEqual(audit.buybox.bottom + 10);
  expect(audit.suggestionCount).toBe(suggestions.length);
  if (suggestions.length) {
    expect(audit.suggestions.y).toBeGreaterThanOrEqual(audit.details.bottom);
    expect(audit.suggestions.y - audit.details.bottom).toBeLessThan(48);
  } else {
    expect(audit.suggestionsHidden).toBe(true);
  }
});
