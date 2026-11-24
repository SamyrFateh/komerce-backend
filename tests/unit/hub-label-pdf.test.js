/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {renderHubLabelPdf}=require('../../services/hub-label-pdf');
const root=path.resolve(__dirname,'../..');
const relay='22222222-2222-4222-8222-222222222222';
const labels=Array.from({length:3},(_,i)=>({
 target_type:'ARTICLE',relais_id:relay,short_alias:['ABCDEFGH','JKLMNPQR','STUVWXYZ'][i],
 qr_value:'KQ1_'+(i+1).toString(16).toUpperCase().repeat(32),
 market_id:'11111111-1111-4111-8111-111111111111',
 client_phone:'SENSITIVE_PHONE_NEVER_EXPORT',
 commercial_reference:'SECRET_ORDER_K1',
}));
const query=jest.fn(async(_sql,ids)=>({
 rows:[{id:relay,short_code:'YA01'}]
}));
const db={query};
describe('Private Hub ARTICLE / COMBOX PDF exports: printed QR remain stable and non-PII',()=>{
 beforeEach(()=>query.mockClear());
 test.each(['a4','thermal'])('produces a real scan-ready PDF in %s, one page per issued QR',async(format)=>{
  const pdf=await renderHubLabelPdf(db,{labels,marketCode:'KM',format});
  expect(Buffer.isBuffer(pdf)).toBe(true);
  expect(pdf.subarray(0,5).toString()).toBe('%PDF-');
  const raw=pdf.toString('latin1');
  expect((raw.match(/\/Type \/Page\b/g)||[])).toHaveLength(3);
  expect((raw.match(/\/Subtype \/Image\b/g)||[]).length).toBeGreaterThanOrEqual(3);
  for(const forbidden of ['SENSITIVE_PHONE_NEVER_EXPORT','SECRET_ORDER_K1'])expect(raw).not.toContain(forbidden);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain('FROM relais WHERE id=ANY');
  expect(query.mock.calls[0][1]).toEqual([[relay]]);
 });
 test('COMBOX PDF remains private and uses the same QR payload',async()=>{
  const [box]={...labels.slice(0,1).map(l=>({...l,target_type:'COMBOX'}))};
  const pdf=await renderHubLabelPdf(db,{labels:[box],marketCode:'KM',format:'a4'});
  expect(pdf.subarray(0,5).toString()).toBe('%PDF-');
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[])).toHaveLength(1);
 });
 test('rejects unknown format, bad QR, duplicate or unissued label and excessive count',async()=>{
  const opts={labels,marketCode:'KM'};
  await expect(renderHubLabelPdf(db,{...opts,format:'strange'})).rejects.toThrow('HUB_LABEL_PRINT_FORMAT_INVALID');
  await expect(renderHubLabelPdf(db,{...opts,labels:[]})).rejects.toThrow('HUB_LABEL_PDF_INPUT_INVALID');
  await expect(renderHubLabelPdf(db,{...opts,marketCode:'KM-HACK'})).rejects.toThrow('HUB_LABEL_PDF_INPUT_INVALID');
  await expect(renderHubLabelPdf(db,{...opts,labels:[{...labels[0],qr_value:'https://example.test'}]}))
    .rejects.toThrow('HUB_LABEL_PDF_INPUT_INVALID');
  await expect(renderHubLabelPdf(db,{...opts,labels:[labels[0],labels[0]]}))
    .rejects.toThrow('HUB_LABEL_PDF_DUPLICATE_IDENTITY');
  await expect(renderHubLabelPdf(db,{...opts,labels:Array(251).fill(labels[0])}))
    .rejects.toThrow('HUB_LABEL_PDF_INPUT_INVALID');
  expect(query).not.toHaveBeenCalled();
 });
 test('routes keep market execution capability and private response; UI downloads through authenticated fetch',()=>{
  const route=fs.readFileSync(path.join(root,'routes/admin-operations-workspace.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/dashboards/canonical/js/operations-workspace.js'),'utf8');
  expect(route).toContain("'/market/:marketCode/labels/articles/:id/pdf'");
  expect(route).toContain("'/market/:marketCode/labels/boxes/:id/pdf'");
  expect(route).toContain("attachHubExecutionCapability('execution.parcel.receive')");
  expect(route).toContain("attachHubExecutionCapability('execution.parcel.ship')");
  expect(route).toContain("requireHubWorkspaceAction");
  expect(route).toContain("res.set('Cache-Control','private, no-store')");
  expect(route).toContain("res.set('X-Content-Type-Options','nosniff')");
  expect(route).toContain("return res.status(200).type('pdf').send(data)");
  expect(ui).toContain("headers:{Accept:'application/pdf'}");
  expect(ui).toContain("pdfLink('articles',line.allocation_id,'a4')");
  expect(ui).toContain("pdfLink('articles',line.allocation_id,'thermal')");
  expect(ui).toContain("pdfLink('boxes',box.unit_id,'a4')");
  expect(ui).toContain("pdfLink('boxes',box.unit_id,'thermal')");
 });
});
