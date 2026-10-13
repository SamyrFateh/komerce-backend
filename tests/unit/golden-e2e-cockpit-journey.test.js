'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..','..');
test('Golden journey controller is CSP-safe and loaded by the cockpit',()=>{
  const html=fs.readFileSync(path.join(ROOT,'public/golden-e2e-cockpit.html'),'utf8');
  const js=fs.readFileSync(path.join(ROOT,'public/js/golden-e2e-cockpit-journey.js'),'utf8');
  expect(html).toContain('<script defer src="/js/golden-e2e-cockpit-journey.js"></script>');
  expect(html).not.toMatch(/<script(?:\\s[^>]*)?>\\s*\\(/);
  expect(js).toContain("const steps=[");
  expect(js).toContain("function render()");
});
