/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const cases=[
 ['staging-g6-prereq-probe.yml','probe'],
 ['staging-g6-cleanup-recette.yml','cleanup'],
 ['dashboard-final-intersession-readonly.yml','certify'],
 ['staging-g6-central-hub-product.yml','create'],
 ['staging-g6-canonical-buyer-cash.yml','canonical'],
 ['staging-g6-dynamic-fresh-buyer-cash.yml','buyer-cash']
];
const group='komerce-g6-canonical-real-transaction';
describe('G6 staging — skipped issue workflows must not own the shared lock',()=>{
 test.each(cases)('%s: only the authorized owner job acquires the shared lock',(filename,job)=>{
  const workflow=fs.readFileSync(path.join(root,'.github/workflows',filename),'utf8');
  expect(workflow).toContain('issues:');
  expect(workflow).not.toMatch(/^concurrency:\s*$/m);
  expect(workflow).toMatch(new RegExp(
   '^  '+job+':\\n(?:    #.*\\n)*    concurrency:\\n'+
   '      group: '+group+'\\n      cancel-in-progress: false\\n'+
   '(?:    #.*\\n)*    if:',
   'm'
  ));
  expect(workflow.match(new RegExp('group: '+group,'g'))).toHaveLength(1);
  expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
 });
});
