'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs=require('fs');
const path=require('path');

const ROOT=path.join(__dirname,'..','..');
const css=fs.readFileSync(path.join(ROOT,'public/dashboards/canonical/css/dashboard-hierarchy-v1.css'),'utf8');
const ops=fs.readFileSync(path.join(ROOT,'public/dashboards/canonical/js/operations-decision.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'public/dashboards/canonical/index.html'),'utf8');

describe('Dashboard visual hierarchy V1',()=>{
  test('le runtime charge le contrat partagé',()=>{
    expect(html).toContain('/dashboards/canonical/css/dashboard-hierarchy-v1.css');
  });

  test('le contrat encode Hero → Attention → Primary → Secondary',()=>{
    expect(css).toMatch(/data-dashboard-role="hero"[^}]*order:\s*10/s);
    expect(css).toMatch(/data-dashboard-role="attention"[^}]*order:\s*20/s);
    expect(css).toMatch(/data-dashboard-role="primary"[^}]*order:\s*30/s);
    expect(css).toMatch(/data-dashboard-role="secondary"[^}]*order:\s*40/s);
  });

  test('les cartes attention ont une présence visuelle renforcée',()=>{
    expect(css).toMatch(/data-dashboard-role="attention"[^}]*\.kmc-decision-card[^}]*border-left:\s*5px solid var\(--decision-accent\)/s);
    expect(css).toMatch(/\.kmc-decision-card-value[^}]*font-size:\s*clamp\(29px/s);
  });

  test('Operations déclare explicitement les quatre niveaux',()=>{
    expect(ops).toContain("data-dashboard-hierarchy', 'hero-attention-primary-secondary");
    expect(ops).toContain("data-dashboard-role', 'hero");
    expect(ops).toContain("data-dashboard-role', 'attention");
    expect(ops).toContain("data-dashboard-role', 'primary");
    expect(ops).toContain("data-dashboard-role', 'secondary");
  });
});
