'use strict';
const fs = require('fs');
const file = 'public/boutique/tests/unit/b-favs.test.js';
let src = fs.readFileSync(file, 'utf8');

const favMock = "jest.mock('../../js/catalog-favorites.js', () => ({ isFav: jest.fn(() => false), toggleFav: jest.fn() }));\n";
if (!src.includes(favMock)) throw new Error('catalog favorites mock marker missing');
if (!src.includes("jest.mock('../../js/b-utils.js'")) {
  src = src.replace(
    favMock,
    favMock + "jest.mock('../../js/b-utils.js', () => {\n  const actual = jest.requireActual('../../js/b-utils.js');\n  return { ...actual, showToast: jest.fn() };\n});\n"
  );
}

const oldTest = `    it('ne réinstalle pas de listener panier local', () => {\n      state.products = PRODUCTS;\n      state.favs = [2];\n      renderFavView();\n      document.querySelector('.k-card-add-trigger').dispatchEvent(new Event('click', { bubbles: true }));\n      expect(quickAdd).not.toHaveBeenCalled();\n      expect(quickRemove).not.toHaveBeenCalled();\n    });`;
const newTest = `    it('ne réinstalle pas de mutation panier locale', () => {\n      state.products = PRODUCTS;\n      state.favs = [2];\n      state.cart = [];\n      renderFavView();\n      expect(() => document.querySelector('.k-card-add-trigger').dispatchEvent(new Event('click', { bubbles: true }))).not.toThrow();\n      expect(state.cart).toEqual([]);\n    });`;
if (!src.includes(oldTest)) throw new Error('legacy local cart listener test marker missing');
src = src.replace(oldTest, newTest);

if (/\bquickAdd\b|\bquickRemove\b/.test(src)) throw new Error('stale quick cart symbols remain in b-favs harness');
fs.writeFileSync(file, src);
console.log('b-favs harness aligned with catalog ownership');
