/** @test-kind e2e @test-runner playwright @test-requires webapp */
'use strict';

const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers/boutique.helpers');

const VIEWPORTS = [
  { name: '360x800 (Android compact)', width: 360, height: 800 },
  { name: '390x844 (iPhone 12/13/14)', width: 390, height: 844 },
  { name: '1280x800 (Desktop)', width: 1280, height: 800 },
];
const IMG_FULL_FRAME = 'tests/fixtures/images/produit-plein-cadre.png';
const IMG_WHITESPACE = 'tests/fixtures/images/produit-fond-blanc.png';
const distinct = (url, id) => `${url}?mdm9=${id}`;

async function renderProductInModal(page,{images,name='Produit test',price='25 000 KMF'}){
  await page.evaluate(async ({images,name,price})=>{
    const modal = await import('/boutique/js/b-modal-product.js');
    const store = await import('/boutique/js/b-store.js');
    modal.buildCarouselSlides({name,price,images});
    store.dom.modalName.textContent=name;
    store.dom.modalPrice.textContent=price;
    store.dom.modalSku.textContent='REF-E2E-MDM9';
    store.dom.modalOverlay.classList.add('open');
    document.body.classList.add('modal-open');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  },{images,name,price});
}

async function closeModal(page){
  await page.evaluate(async()=>{
    const store=await import('/boutique/js/b-store.js');
    store.dom.modalOverlay.classList.remove('open');
    document.body.classList.remove('modal-open');
  });
}

async function waitFirstImage(page){
  await page.waitForFunction(()=>{
    const img=document.querySelector('#k-modal-carousel-track .k-modal-slide');
    return Boolean(img&&img.complete&&img.naturalWidth>0);
  },null,{timeout:8000});
}

async function measure(page){
  return page.evaluate(()=>{
    const wrap=document.querySelector('.k-modal-img-wrap');
    const modal=document.getElementById('k-modal');
    const actions=document.querySelector('.k-modal-actions');
    const price=document.getElementById('k-modal-price');
    const rect=(el)=>el?el.getBoundingClientRect():null;
    const wr=rect(wrap), mr=rect(modal), ar=rect(actions), pr=rect(price);
    return {
      galleryMode:wrap?.dataset.galleryMode||null,
      mediaCount:wrap?.dataset.mediaCount||null,
      wrapWidth:wr?.width||0,
      wrapHeight:wr?.height||0,
      slideCount:document.querySelectorAll('#k-modal-carousel-track .k-modal-slide').length,
      dotCount:document.querySelectorAll('#k-modal-dots .k-modal-dot').length,
      thumbsCount:document.querySelectorAll('.k-modal-thumbs .k-modal-thumb').length,
      counterVisible:document.querySelector('.k-modal-counter')?.classList.contains('is-visible')||false,
      trackTransform:document.getElementById('k-modal-carousel-track')?.style.transform||'',
      modalScrollWidth:modal?.scrollWidth||0,
      modalClientWidth:modal?.clientWidth||0,
      actionsVisible:Boolean(ar&&ar.top>=0&&ar.bottom<=innerHeight&&ar.left>=0&&ar.right<=innerWidth),
      actionsTop:ar?.top||0,
      priceBottom:pr?.bottom||0,
      modalWidth:mr?.width||0,
    };
  });
}

for(const viewport of VIEWPORTS){
  test.describe(`MDM-9 — Viewport ${viewport.name}`,()=>{
    test.use({viewport:{width:viewport.width,height:viewport.height}});

    test('single media — one canonical slide, no phantom navigation, CTA visible',async({page})=>{
      await page.goto(BASE_URL);
      await page.waitForSelector('#k-modal',{state:'attached'});
      await renderProductInModal(page,{images:[distinct(IMG_WHITESPACE,'single')]});
      await waitFirstImage(page);
      const m=await measure(page);
      expect(m.galleryMode).toBe('single');
      expect(m.mediaCount).toBe('1');
      expect(m.slideCount).toBe(1);
      expect(m.dotCount).toBe(0);
      expect(m.thumbsCount).toBe(0);
      expect(m.counterVisible).toBe(false);
      expect(m.actionsVisible).toBe(true);
      expect(m.modalScrollWidth).toBeLessThanOrEqual(m.modalClientWidth+1);
      expect(m.actionsTop).toBeGreaterThanOrEqual(m.priceBottom);
      if(viewport.width<900){
        expect(m.wrapHeight).toBeCloseTo(m.wrapWidth*0.75,0);
      }
      await closeModal(page);
    });

    test('multiple media — distinct media stay distinct, rebuild is idempotent, navigation works',async({page})=>{
      await page.goto(BASE_URL);
      await page.waitForSelector('#k-modal',{state:'attached'});
      // Les anciens tests passaient deux fois la même URL puis exigeaient trois
      // slides, en contradiction avec la déduplication canonique volontaire.
      const images=[
        distinct(IMG_FULL_FRAME,'a'),
        distinct(IMG_WHITESPACE,'b'),
        distinct(IMG_FULL_FRAME,'c'),
      ];
      await renderProductInModal(page,{images});
      await waitFirstImage(page);
      await renderProductInModal(page,{images});
      await waitFirstImage(page);
      let m=await measure(page);
      expect(m.galleryMode).toBe('multiple');
      expect(m.mediaCount).toBe('3');
      expect(m.slideCount).toBe(3);
      expect(m.actionsVisible).toBe(true);
      expect(m.modalScrollWidth).toBeLessThanOrEqual(m.modalClientWidth+1);

      if(viewport.width<900){
        expect(m.dotCount).toBe(3);
        await page.locator('#k-modal-dots .k-modal-dot').nth(1).click();
        await expect.poll(async()=>(await measure(page)).trackTransform,{timeout:2000}).toContain('-100%');
        m=await measure(page);
        expect(m.wrapHeight).toBeCloseTo(m.wrapWidth*0.75,0);
      }else{
        expect(m.thumbsCount).toBe(3);
        await page.locator('.k-modal-carousel-handle--next').click();
        await expect(page.locator('.k-modal-thumb').nth(1)).toHaveClass(/is-active/);
      }

      const seven=Array.from({length:7},(_,index)=>distinct(index%2?IMG_WHITESPACE:IMG_FULL_FRAME,`many-${index}`));
      await renderProductInModal(page,{images:seven});
      await waitFirstImage(page);
      m=await measure(page);
      expect(m.slideCount).toBe(7);
      expect(m.mediaCount).toBe('7');
      if(viewport.width<900){
        expect(m.dotCount).toBe(0);
        expect(m.counterVisible).toBe(true);
      }
      await renderProductInModal(page,{images:seven});
      await waitFirstImage(page);
      expect((await measure(page)).slideCount).toBe(7);
      await closeModal(page);
    });

    test('mobile geometry — single and multiple share the canonical 4:3 hero',async({page})=>{
      test.skip(viewport.width>=900,'contrat géométrique mobile uniquement');
      await page.goto(BASE_URL);
      await page.waitForSelector('#k-modal',{state:'attached'});

      await renderProductInModal(page,{images:[distinct(IMG_WHITESPACE,'geo-single')]});
      await waitFirstImage(page);
      const single=await measure(page);
      await closeModal(page);

      await renderProductInModal(page,{images:[distinct(IMG_WHITESPACE,'geo-a'),distinct(IMG_FULL_FRAME,'geo-b')]});
      await waitFirstImage(page);
      const multiple=await measure(page);

      // Doctrine actuelle : depuis P1 audit-3 la hauteur n'est plus 36/48vh.
      // Le hero est volontairement stable à 4:3, indépendamment du nombre de médias.
      expect(single.wrapHeight).toBeCloseTo(single.wrapWidth*0.75,0);
      expect(multiple.wrapHeight).toBeCloseTo(multiple.wrapWidth*0.75,0);
      expect(Math.abs(single.wrapHeight-multiple.wrapHeight)).toBeLessThanOrEqual(2);
      expect(single.actionsVisible).toBe(true);
      expect(multiple.actionsVisible).toBe(true);
      expect(single.modalScrollWidth).toBeLessThanOrEqual(single.modalClientWidth+1);
      expect(multiple.modalScrollWidth).toBeLessThanOrEqual(multiple.modalClientWidth+1);
      await closeModal(page);
    });
  });
}
