'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

test('L5 : l’avis « politique de marché absente » est un bloc d’information stylé, sans variante bouton', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/pricing-economic-cockpit.css'), 'utf8');
  expect(css).toContain('.kmc-pricing-decision-overview .kmc-pricing-configuration-notice');
  expect(css).toContain('.kmc-pricing-configuration-title');
  expect(css).toContain('.kmc-pricing-configuration-copy');
  expect(css).not.toMatch(/kmc-pricing-configuration[^{]*\{[^}]*cursor:\s*pointer/);
});

const {v7Money,createV7CostCenters}=require('../../public/dashboards/canonical/js/pricing-economic-cockpit');
function node(tag){
  return {tag,children:[],dataset:{},attrs:{},textContent:'',append(...xs){this.children.push(...xs);},appendChild(x){this.children.push(x);return x;},replaceChildren(){this.children=[];},addEventListener(e,fn){this[e]=fn;},setAttribute(k,v){this.attrs[k]=v;}};
}
const doc={createElement:node};
function all(n){return [n,...n.children.flatMap(all)];}
function find(n,label){return all(n).find(x=>x.tag==='button'&&x.textContent===label);}
function texts(n){return all(n).map(x=>x.textContent);}
test('V7 renders exact amount text, preserves zero and never treats null as zero',()=>{
  expect(v7Money('100000000000000.01')).toBe('100\u202f000\u202f000\u202f000\u202f000,01 EUR');
  expect(v7Money('0.00')).toBe('0,00 EUR');
  expect(v7Money(null)).toBe('Non disponible');
});
test('V7 scoped center -> family -> post drill-down uses server data; one family only',()=>{
  const model={scope:'MARKET',marketCode:'CM',periodStart:'2026-01-01',budgetSummary:{totalEur:null,recordedEur:'10.00',coveredPosts:1,totalPosts:2},
    commitmentSummary:{totalEur:'7.00'},structureEvidence:{amountKmf:'1000.00'},centers:[{id:'a',label:'Relais',budgetSummary:{totalEur:'10.00'},commitmentSummary:{totalEur:'7.00'}}],
    families:[{id:'f1',center_id:'a',label:'Personnel'},{id:'f2',center_id:'a',label:'Matériel'}],
    resources:[{id:'r',center_id:'a',label:'Équipe'}],
    posts:[{id:'p',center_id:'a',family_id:'f1',resource_id:'r',label:'Salaires',economic_nature:'FIXED',budget:{native:'6559',currency:'XAF'},commitments:[]},
    {id:'q',center_id:'a',family_id:'f2',label:'Équipement',budget:null,commitments:[]}]};
  const host=createV7CostCenters(doc,model);
  expect(texts(host)).toContain('Centres de coûts');
  expect(texts(host)).toContain('10,00 EUR · partiel (1/2)');
  expect(texts(host)).toContain('7,00 EUR');
  expect(texts(host)).toContain('1\u202f000 KMF · structure partielle');
  find(host,'Consulter').click();
  expect(find(host,'Salaires')).toBeTruthy();expect(find(host,'Équipement')).toBeUndefined();
  find(host,'Salaires').click();expect(texts(host)).toContain('Équipe');
  find(host,'Matériel').click();expect(find(host,'Salaires')).toBeUndefined();expect(find(host,'Équipement')).toBeTruthy();
  expect(texts(host)).not.toContain('Équipe');find(host,'Tous les centres').click();
  expect(texts(host)).toContain('Centres de coûts');
});
