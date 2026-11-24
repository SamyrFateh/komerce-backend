/** @komerce-arch-lite
 * @role hub-opaque-labels-pdf
 * @domain logistics
 * @layer service
 * @owner backend-core
 * @purpose Export already issued ARTICLE/COMBOX opaque QR labels as private A4/80mm PDFs.
 * @db-read relais
 * @db-write none
 * @impact-areas hub, logistics, scanning, documents
 */
'use strict';

const PDFDocument=require('pdfkit');
const QRCode=require('qrcode');
const {LabelError}=require('./hub-opaque-labels');

const POINTS_PER_MM=72/25.4;
const mm=value=>value*POINTS_PER_MM;
const OPAQUE=/^KQ1_[A-F0-9]{32}$/;
const ALIAS=/^[A-HJ-NP-Z2-9]{8}$/;
const PAGE=Object.freeze({
 thermal:[mm(80),mm(105)],
 a4:[mm(210),mm(297)]
});

function validated(labels,marketCode,format){
 if(!Object.hasOwn(PAGE,format))throw new LabelError(400,'HUB_LABEL_PRINT_FORMAT_INVALID');
 if(!/^[A-Z]{2}$/.test(marketCode||'')||!Array.isArray(labels)||labels.length<1||labels.length>250)
  throw new LabelError(400,'HUB_LABEL_PDF_INPUT_INVALID');
 if(!labels.every(l=>l&&['ARTICLE','COMBOX'].includes(l.target_type)&&OPAQUE.test(l.qr_value||'')&&
  ALIAS.test(l.short_alias||'')&&typeof l.relais_id==='string'))
  throw new LabelError(400,'HUB_LABEL_PDF_INPUT_INVALID');
 if(new Set(labels.map(l=>l.qr_value)).size!==labels.length||
    new Set(labels.map(l=>l.short_alias)).size!==labels.length)
  throw new LabelError(409,'HUB_LABEL_PDF_DUPLICATE_IDENTITY');
}

async function renderHubLabelPdf(q,{labels,marketCode,format='a4'}){
 validated(labels,marketCode,format);
 const relayIds=[...new Set(labels.map(l=>l.relais_id))];
 const {rows}=await q.query(
  "SELECT id,COALESCE(short_code,'—') AS short_code FROM relais WHERE id=ANY($1::uuid[])",
  [relayIds]);
 const relays=new Map(rows.map(r=>[String(r.id),String(r.short_code)]));
 const [pageWidth,pageHeight]=PAGE[format];
 const pdf=new PDFDocument({autoFirstPage:false,margin:0,compress:true,info:{
  Title:'Étiquettes QR Komerce',Author:'Komerce',Subject:'Étiquettes logistiques internes'
 }});
 const chunks=[];
 const done=new Promise((resolve,reject)=>{
  pdf.on('data',chunk=>chunks.push(chunk));
  pdf.once('end',()=>resolve(Buffer.concat(chunks)));
  pdf.once('error',reject);
 });
 try{
  for(const label of labels){
   const code=await QRCode.toBuffer(label.qr_value,{
    type:'png',errorCorrectionLevel:'M',margin:2,width:480
   });
   pdf.addPage({size:[pageWidth,pageHeight],margin:0});
   // The PDF retains the identical opaque payload as the HTML print preview.
   // No buyer, commercial order reference, supplier or contact details.
   const ticketWidth=mm(72),ticketHeight=mm(97);
   const x=(pageWidth-ticketWidth)/2,y=format==='a4'?mm(16):mm(4);
   const center=x+ticketWidth/2;
   const destinationRaw=relays.get(String(label.relais_id))||'—';
   const destination=/^[A-Z0-9-]{2,16}$/.test(destinationRaw)?destinationRaw:'--';
   pdf.rect(x,y,ticketWidth,ticketHeight).lineWidth(0.7).stroke('#555555');
   pdf.fillColor('#151515');
   pdf.font('Helvetica-Bold').fontSize(17).text('KOMERCE',x+mm(5),y+mm(5),{
    width:ticketWidth-mm(10),align:'center',lineBreak:false
   });
   pdf.font('Helvetica-Bold').fontSize(11).text(label.target_type,x+mm(4),y+mm(16),{
    width:ticketWidth-mm(8),align:'center',lineBreak:false
   });
   pdf.font('Helvetica-Bold').fontSize(17).text(marketCode+' - '+destination,x+mm(3),y+mm(25),{
    width:ticketWidth-mm(6),align:'center',lineBreak:false
   });
   const qrSize=mm(49);
   pdf.image(code,center-qrSize/2,y+mm(35),{width:qrSize,height:qrSize});
   pdf.font('Courier-Bold').fontSize(15).text(label.short_alias,x+mm(4),y+mm(86),{
    width:ticketWidth-mm(8),align:'center',characterSpacing:1.5,lineBreak:false
   });
  }
  pdf.end();
 }catch(err){
  pdf.destroy(err);
  throw err;
 }
 return done;
}
module.exports={renderHubLabelPdf};
