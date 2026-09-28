'use strict';
const fs=require('fs');const path=require('path');
const file=fs.readFileSync(path.join(__dirname,'../../public/dashboards/admin/js/views/ProvidersView.js'),'utf8');
describe('Provider Control Center operational truth',()=>{
 test('renders backend connector readiness, runtime and capture health without inventing provider switches',()=>{
  expect(file).toContain('source.connector_ready');
  expect(file).toContain('source.runtime_enabled');
  expect(file).toContain('source.last_capture_status');
  expect(file).toContain('source.last_capture_at');
  expect(file).toContain('setSourcingSourceAutopilot');
  expect(file).not.toContain('data-discovery');
  expect(file).not.toContain('data-sync');
  expect(file).not.toContain('data-production');
 });
});
