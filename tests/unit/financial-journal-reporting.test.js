'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const reporting=require('../../services/financial-journal-reporting');
test('rapprochement fournisseur sur chaque fait, devise, sens et pièce ; aucune somme inter-devise',async()=>{
 const query=jest.fn().mockResolvedValueOnce({rows:[{journal_kmf:'0',source_kmf:'0'}]}).mockResolvedValueOnce({rows:[{journal_kmf:'0',source_kmf:'0'}]}).mockResolvedValueOnce({rows:[{journal_kmf:'0',source_kmf:'0'}]}).mockResolvedValueOnce({rows:[{mismatches:2}]}).mockResolvedValueOnce({rows:[{n:0}]});
 const result=await reporting.reconcileWithSources({query},{marketId:'CM-ID'});
 expect(result.ok).toBe(false);expect(result.checks.find(c=>c.name==='supplier_settlements_native')).toMatchObject({journal:2,source:0,ok:false});
 const [sql,args]=query.mock.calls[3];expect(sql).toContain('FULL JOIN journal j ON j.source_id=s.source_id AND j.facet=s.facet');expect(sql).toContain('COALESCE(s.fee_amount,s.fees_kmf)');expect(sql).toContain('j.currency IS DISTINCT FROM s.currency');expect(sql).toContain('d.doc_ref=s.proof_ref');expect(sql).not.toContain('SUM(');expect(args).toEqual(['CM-ID']);
 expect(query.mock.calls[4][1]).toEqual(['CM-ID']);
});
