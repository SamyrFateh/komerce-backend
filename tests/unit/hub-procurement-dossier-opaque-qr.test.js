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