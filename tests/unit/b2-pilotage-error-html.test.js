'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * B2 — displayed API errors in both pilotage views must be inert text.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../public/dashboards/admin/js/views');
const cases = [
  { file: 'PilotageFinView.js', marker: '// B2: an API error is untrusted text, not HTML.', end: "document.getElementById('pf-kpis').replaceChildren(errorState);", prefix: '❌ Erreur : ' },
  { file: 'PilotageView.js', marker: '// B2: never interpolate server errors in innerHTML.', end: 'main.replaceChildren(errorState);', prefix: '❌ Erreur de chargement: ' },
  { file: 'ControlTowerView.js', marker: '// B2: untrusted errors must be text-only.', end: 'main.replaceChildren(errorState);', prefix: '❌ Erreur de chargement : ' },
];

test.each(cases)('$file displays hostile errors as text, no injected elements', ({ file, marker, end, prefix }) => {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const start = src.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const stop = src.indexOf(end, start);
  expect(stop).toBeGreaterThan(start);
  const snippet = src.slice(start, stop + end.length);
  const main = { replaceChildren: jest.fn() };
  const document = {
    createElement: jest.fn(() => ({ className: '', textContent: '', innerHTML: undefined })),
    getElementById: jest.fn(() => main),
  };
  const hostile = '<img src=x onerror=alert(1)>';
  new Function('document', 'main', 'err', snippet)(document, main, { message: hostile, status: 401 });
  expect(main.replaceChildren).toHaveBeenCalledTimes(1);
  const error = main.replaceChildren.mock.calls[0][0];
  expect(error.className).toBe('error-state');
  expect(error.textContent).toContain(prefix + hostile);
  expect(error.innerHTML).toBeUndefined();
  expect(snippet).not.toContain('innerHTML =');
});


test('SalesView API errors are appended as text nodes, not injected HTML', () => {
  const src = fs.readFileSync(path.join(root, 'SalesView.js'), 'utf8');
  const marker = '// B2: DOM nodes preserve the error heading while treating API text as inert.';
  const start = src.indexOf(marker);
  const end = 'sectionsEl.replaceChildren(errorState);';
  const stop = src.indexOf(end, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(stop).toBeGreaterThan(start);
  const snippet = src.slice(start, stop + end.length);
  const elements = [];
  const document = {
    createElement: jest.fn(tag => {
      const el = { tag, className: '', textContent: '', children: [], appendChild(child) { this.children.push(child); } };
      elements.push(el);
      return el;
    }),
    createTextNode: jest.fn(text => ({ nodeType: 3, textContent: text })),
  };
  const sectionsEl = { replaceChildren: jest.fn() };
  const hostile = '<img src=x onerror=alert(1)>';
  new Function('document', 'sectionsEl', 'err', 'isApiError', snippet)(document, sectionsEl, { message: hostile, status: 401 }, true);
  const rootEl = sectionsEl.replaceChildren.mock.calls[0][0];
  expect(rootEl.className).toBe('error-state');
  expect(document.createTextNode).toHaveBeenCalledWith(hostile);
  expect(rootEl.children.some(node => node.nodeType === 3 && node.textContent === hostile)).toBe(true);
  expect(elements.every(el => !Object.prototype.hasOwnProperty.call(el, 'innerHTML'))).toBe(true);
  expect(snippet).not.toContain('innerHTML');
});
