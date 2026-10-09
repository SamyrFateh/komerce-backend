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
const pilotage=fs.readFileSync(path.join(ROOT,'public/dashboards/canonical/js/pilotage-decision.js'),'utf8');
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

  test.each([
    ['Operations', ops],
    ['Pilotage', pilotage],
  ])('%s déclare explicitement les quatre niveaux',(_name,source)=>{
    expect(source).toContain("data-dashboard-hierarchy', 'hero-attention-primary-secondary");
    expect(source).toContain("data-dashboard-role', 'hero");
    expect(source).toContain("data-dashboard-role', 'attention");
    expect(source).toContain("data-dashboard-role', 'primary");
    expect(source).toContain("data-dashboard-role', 'secondary");
  });
});
