'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

function element(tag) {
  const classes = new Set();
  return {
    tagName: tag.toUpperCase(), className: '', children: [], attrs: {},
    classList: { add: c => classes.add(c), contains: c => classes.has(c) },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute(k, v) { this.attrs[k] = v; },
  };
}
const documentStub = { createElement: element };

beforeEach(() => {
  jest.resetModules();
  delete global.KomerceCanonicalHubWorkstation;
  require('../../public/dashboards/canonical/js/hub-workstation.js');
});

test('le hub affiche exactement deux branches et compose les vrais writers existants', () => {
  const app = global.KomerceCanonicalHubWorkstation;
  const root = element('main');
  const admin = jest.fn().mockResolvedValue('admin');
  const ops = jest.fn().mockResolvedValue('ops');
  app.mount({
    root, user: {role:'admin'}, document:documentStub,
    location:{search:'?branch=administrative&market=KM'},
    renderAdministrative:admin, renderOperations:ops,
  });
  expect(admin).toHaveBeenCalledTimes(1);
  expect(ops).not.toHaveBeenCalled();
  const layout = root.children[1];
  const nav = layout.children[0];
  expect(nav.children.filter(x => x.attrs['data-hub-branch']).map(x => x.attrs['data-hub-branch']))
    .toEqual(['administrative','operations']);
  expect(nav.children.filter(x => x.attrs['aria-current'] === 'page')).toHaveLength(1);
});

test('l’agent Hub n’accède pas à la branche administrative par URL', () => {
  const app = global.KomerceCanonicalHubWorkstation;
  const root = element('main');
  const admin = jest.fn();
  const ops = jest.fn();
  app.mount({
    root, user:{role:'agent_hub'}, document:documentStub,
    location:{search:'?branch=administrative&market=KM'},
    renderAdministrative:admin, renderOperations:ops,
  });
  expect(admin).not.toHaveBeenCalled();
  expect(ops).toHaveBeenCalledTimes(1);
  expect(root.children[1].children[0].children.filter(x => x.attrs['data-hub-branch']))
    .toHaveLength(1);
});

test('le changement de branche conserve le marché et ne transporte pas le dossier PO dans Hub Live', () => {
  const app = global.KomerceCanonicalHubWorkstation;
  const ops = app.href('operations','?market=KM&po=PO-42');
  expect(ops).toBe('/admin/hub?market=KM&branch=operations');
  expect(app.href('administrative','?market=KM')).toBe('/admin/hub?market=KM&branch=administrative');
  expect(app.parseBranch('?branch=inconnue')).toBe('operations');
});

test('la mini-app est bien raccordée au routeur Canonical et non à une page de démonstration', () => {
  const root = path.join(__dirname,'../..');
  const appSrc = fs.readFileSync(path.join(root,'public/dashboards/canonical/js/app.js'),'utf8');
  const navSrc = fs.readFileSync(path.join(root,'public/dashboards/canonical/js/navigation-policy-v4.js'),'utf8');
  const html = fs.readFileSync(path.join(root,'public/dashboards/canonical/index.html'),'utf8');
  const routes = fs.readFileSync(path.join(root,'bootstrap/html-routes.js'),'utf8');
  expect(appSrc).toContain('renderHubWorkstation(root, user, adminContext)');
  expect(appSrc).toContain("if (path === '/admin/hub')");
  expect(navSrc).toContain("id: 'hub-workstation'");
  expect(html).toContain('/dashboards/canonical/js/hub-workstation.js');
  expect(routes).toContain("'/admin/hub'");
});
