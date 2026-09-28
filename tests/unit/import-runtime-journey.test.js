'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const vm = require('vm');
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/catalog-run-progress', () => ({ readRunProgress: jest.fn() }));
const { readRunProgress } = require('../../services/catalog-run-progress');
const runs = require('../../services/import-runtime-runs');

function executor() {
  return { query: jest.fn().mockResolvedValueOnce({ rows:[{ id:'run-id', run_ref:'KIR-1', source_total:0,
    stages:{}, intake:{}, status:'RUNNING' }] }).mockResolvedValueOnce({ rows: [
    { state:'imported_to_catalog', product_ref:'P-1' },
    { state:'watchlist', product_ref:'P-2' },
    { state:'rejected', product_ref:'P-3' },
    { state:'imported_to_catalog', product_ref:null },
  ] }) };
}

test('handoff reads all promoted product refs only, independent of recent-items truncation', async () => {
  readRunProgress.mockResolvedValue({ available:true, marker:'cohort' });
  const q = executor();
  const projection = await runs.getRun('KIR-1', q);
  expect(readRunProgress).toHaveBeenCalledWith(['P-1'], q);
  expect(projection.downstream).toEqual({ available:true, marker:'cohort' });
});

test('downstream failure preserves the same import projection and reports unavailable', async () => {
  readRunProgress.mockResolvedValue({ available:true });
  const before = await runs.getRun('KIR-1', executor());
  readRunProgress.mockRejectedValue(new Error('market database offline'));
  const after = await runs.getRun('KIR-1', executor());
  expect(after.downstream).toEqual({ available:false });
  expect(after.status).toBe(before.status);
  expect(after.accounting).toEqual(before.accounting);
});

test('missing run never queries downstream', async () => {
  expect(await runs.getRun('missing', {query:jest.fn().mockResolvedValue({rows:[]})})).toBeNull();
  expect(readRunProgress).not.toHaveBeenCalled();
});

function renderer() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../public/dashboards/canonical/js/import-runtime.js'), 'utf8'), context);
  return context.window.KomerceCanonicalImportRuntime.render;
}
const base = { run_ref:'KIR-1', status:'COMPLETED', accounting:{source_total:19,deferred:3,rejected:1},
  stages:[{key:'CATALOGUE',status:'COMPLETED',processed:15,total:15}] };

test('renders separate blocks and escapes product/market content with preserved open details', () => {
  const detail = { open:false, getAttribute:()=> 'catalog' };
  const root = {querySelectorAll:()=> [detail]};
  renderer()(root, {...base, downstream:{available:true,
    catalog:{received:15,preparing:15,ready:0,published:0,other:0,missing:0},
    items:[{product_ref:'P/1',name:'<img src=x>',stage:'preparing',reason:'<review>'}],
    market_decisions:{awaiting_validation:0,published_undecided:15},
    markets:[{name:'<Comores>',code:'KM',awaiting_validation:0,published_undecided:15,hidden:0,exposed:0,visible:0}],
    visible_products:0,exposed_products:0,
  }});
  expect(root.innerHTML).toContain('15 / 15 transmis');
  expect(root.innerHTML).toContain('15 à préparer · 0 prêts · 0 publiés');
  expect(root.innerHTML).toContain('0 visibles en boutique');
  expect(root.innerHTML).toContain('0 nouveaux à valider · 15 publiés sans décision pays');
  expect(root.innerHTML).toContain('Import terminé');
  expect(root.innerHTML).toContain('Progression de l’import');
  expect(root.innerHTML).toContain('/admin/products/P%2F1');
  expect(root.innerHTML).toContain('&lt;img src=x&gt;');
  expect(root.innerHTML).toContain('&lt;Comores&gt;');
  expect(detail.open).toBe(true);
});

test('unknown downstream is never displayed as zero ready or zero visible', () => {
  const root = {};
  renderer()(root, {...base,downstream:{available:false}});
  expect(root.innerHTML).toContain('État indisponible');
  expect(root.innerHTML).not.toContain('0 visibles en boutique');
  expect(root.innerHTML).toContain('Import terminé');
  renderer()(root, null);
  expect(root.innerHTML).not.toContain('aria-label="Parcours du lot"');
});
