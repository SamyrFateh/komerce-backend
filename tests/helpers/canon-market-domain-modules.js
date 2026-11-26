'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function el(tag) {
  const classes = new Set(['kmc-workspace']);
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, style: {},
    className: 'kmc-workspace', textContent: '',
    classList: { contains: x => classes.has(x), add: x => classes.add(x) },
    appendChild(n) { this.children.push(n); return n; },
    append(...n) { n.forEach(x => this.appendChild(x)); },
    replaceChildren(...n) { this.children = n; },
    setAttribute(k,v) { this.attrs[k] = v; },
    addEventListener() {}, querySelector() { return null; },
    insertBefore(n) { this.children.unshift(n); }, remove() {},
  };
}
const payload = {
  market: { name: 'Cameroun', currency: 'XAF' },
  actor_capabilities: [], actor_grantable_capabilities: [],
  members: [], invitations: [], relais: [], providers: [], settlements: [],
  disputes: [], policy: {}, services: [], offers: [],
  stock: [{ product_id: 'p1', name: 'Article local', qty_physical: 5 }],
  accounts: [], can_manage: false,
};
function createModule(file, apiName, { denied = false } = {}) {
  const context = {
    actor: { id: 'u', role: 'market_operator' },
    access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM',
      capabilities: [], delegatedCapabilities: { CM: [] } },
  };
  const global = {
    document: { getElementById: () => null, createElement: el, createTextNode: () => el('text') },
    location: { search: '?market=CG' },
    KomerceAdminContext: require('../../public/dashboards/canonical/js/admin-context'),
    fetch: jest.fn(async url => ({
      ok: !denied || url.endsWith('/context'), status: denied && !url.endsWith('/context') ? 403 : 200,
      json: async () => url.endsWith('/context') ? context : denied ? {code:'MARKET_CAPABILITY_REQUIRED'} : payload,
    })),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../../public/dashboards/canonical/js', file + '.js'), 'utf8'),
    { window: global, URL, URLSearchParams });
  return { global, api: global[apiName] };
}

function proveDeniedModule(file, apiName) {
  test(file + ' refuses revoked capability without mounting data or actions', async () => {
    const {global,api}=createModule(file,apiName,{denied:true});
    const root=el('div');
    await api.mount({root,marketCode:'CM'});
    expect(root.children).toHaveLength(0);
    expect(global.fetch.mock.calls.every(([url,opts])=>!url.includes('/CG/') && opts.method==='GET')).toBe(true);
    expect(global.fetch.mock.calls.some(([url])=>url.includes('/CM/'))).toBe(true);
  });
}
module.exports={el,createModule,proveDeniedModule};
