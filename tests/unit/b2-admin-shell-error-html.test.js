'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * B2 continuation — the admin shell must never turn a renderer error
 * (which can contain API/customer input) into HTML.
 */
const fs = require('fs');
const path = require('path');

test('B2 admin view error: malicious markup is rendered as text', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../public/dashboards/admin/js/app.js'),
    'utf8'
  );
  const start = src.indexOf('      // B2: server-derived errors are plain text, never HTML.');
  const end = src.indexOf('      main.replaceChildren(errorState);', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const code = src.slice(start, end + '      main.replaceChildren(errorState);'.length);
  const dom = {
    createElement: jest.fn(() => ({ className: '', textContent: '', innerHTML: undefined })),
  };
  const main = { replaceChildren: jest.fn() };
  const payload = '<img src=x onerror=alert(1)>';
  new Function('document', 'main', 'err', code)(dom, main, { message: payload });
  expect(dom.createElement).toHaveBeenCalledWith('div');
  expect(main.replaceChildren).toHaveBeenCalledTimes(1);
  const el = main.replaceChildren.mock.calls[0][0];
  expect(el.className).toBe('error-state');
  expect(el.textContent).toBe('Erreur: ' + payload);
  expect(el.innerHTML).toBeUndefined();
  expect(src).not.toContain('Erreur: ${err.message}</div>');
});
