'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief No unrelated issue-open event may reserve the shared G6 staging writer lock.
 */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const workflows=[
 ['staging-g6-prereq-probe.yml','probe'],
 ['staging-g6-cleanup-recette.yml','cleanup'],
 ['dashboard-final-intersession-readonly.yml','certify'],
 ['staging-g6-central-hub-product.yml','create'],
 ['staging-g6-canonical-buyer-cash.yml','canonical'],
 ['staging-g6-dynamic-fresh-buyer-cash.yml','buyer-cash'],
 ['hub-v1-clicks-staging.yml','clicks'],
];
test.each(workflows)('%s reserves G6 shared lock ONLY at authorized job level', (name,job)=>{
 const yaml=fs.readFileSync(path.join(root,'.github/workflows',name),'utf8');
 const prefix=yaml.split(/^jobs:/m)[0];
 expect(prefix).not.toMatch(/^concurrency:/m);
 const start=yaml.indexOf('jobs:\n  '+job+':');
 expect(start).toBeGreaterThan(0);
 const body=yaml.slice(start);
 expect(body).toMatch(/\n    concurrency:\n      group: komerce-g6-canonical-real-transaction\n      cancel-in-progress: false\n/);
 expect(body).toContain('    if: >-');
 expect(body).toContain('github.actor == github.repository_owner');
 expect(body).toContain('github.event.issue.user.login == github.repository_owner');
 expect(yaml).toContain('issues:');
 expect(yaml).toContain('types: [opened]');
});
