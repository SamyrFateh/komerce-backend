/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const cssDir = path.resolve(__dirname, '../../css');

test.describe('Greeting / panier desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('la salutation reste derrière les contrôles du panier', async ({ page }) => {
    await page.setContent(`
      <div id="k-greeting-chip" class="k-greeting-chip--visible">Karibu G6 😊</div>
      <aside id="k-side-cart" class="k-side-cart has-items">
        <button id="cart-stepper" type="button">+</button>
      </aside>
    `);
    await page.addStyleTag({ content: fs.readFileSync(path.join(cssDir, 'interactions.css'), 'utf8') });
    await page.addStyleTag({ content: fs.readFileSync(path.join(cssDir, 'boutique-desktop.css'), 'utf8') });

    const chip = page.locator('#k-greeting-chip');
    const cart = page.locator('#k-side-cart');
    const stepper = page.locator('#cart-stepper');
    await expect(chip).toBeVisible();
    await expect(stepper).toBeVisible();

    const layers = await page.evaluate(() => ({
      greeting: Number.parseInt(getComputedStyle(document.querySelector('#k-greeting-chip')).zIndex, 10),
      cart: Number.parseInt(getComputedStyle(document.querySelector('#k-side-cart')).zIndex, 10),
      stepper: (() => {
        const { x, y, width, height } = document.querySelector('#cart-stepper').getBoundingClientRect();
        return document.elementFromPoint(x + width / 2, y + height / 2)?.id;
      })(),
    }));

    expect(layers.greeting).toBeLessThan(layers.cart);
    expect(layers.stepper).toBe('cart-stepper');
  });
});
