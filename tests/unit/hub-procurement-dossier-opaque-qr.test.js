'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs=require('fs'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../../services/hub-procurement-dossier.js'),'utf8');
describe('Projection des articles reçus pour l impression Hub',()=>{
  test('le relais est issu de la commande et non du navigateur',()=>{
    expect(source).toContain("o.relais_id, rl.short_code AS relais_code");
    expect(source).toContain("LEFT JOIN relais rl ON rl.id = o.relais_id");
    expect(source).toContain("relais_id: r.relais_id, relais_code: r.relais_code");
    expect(source).toContain("p.removed_at IS NULL AND p.quantity > 0 AND a.market_id = $1");
  });
});
test('réimpression : le dossier projette uniquement le nombre de QR articles existants dans le même marché',()=>{
 expect(source).toContain("a.id AS allocation_id");
 expect(source).toContain("AND l.allocation_id=a.id AND l.market_id=a.market_id) AS issued_label_count");
 expect(source).toContain("issued_label_count: Number(r.issued_label_count || 0)");
});

test('destination COMBOX issue des allocations et du relais de même marché',()=>{
 expect(source).toContain('a.id AS allocation_id, o.relais_id, rl.short_code AS relais_code');
 expect(source).toContain('rl.id = o.relais_id AND rl.market_id = a.market_id');
 expect(source).toContain('relais_id: r.relais_id || null, relais_code: r.relais_code || null');
});
