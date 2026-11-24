/**
 * @komerce-arch
 * @role          hub-opaque-scan-labels
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        authorized_market_scope, verified_allocation_or_box, actor_id
 * @outputs       immutable_opaque_qr_label, print_document, read_only_scan_resolution
 * @depends       crypto, qrcode, db
 * @used-by       routes/admin-operations-workspace.js, services/hub-physical-identity.js
 * @db-read       hub_scan_labels, hub_purchase_allocations, hub_physical_unit_placements, hub_physical_units, orders, relais, markets
 * @db-write      hub_scan_labels
 * @db-txn        issue transaction caller-owned; scan resolution read-only
 * @doctrine      QR_is_identity_not_authorization; no_personal_data_or_commercial_reference_on_paper
 * @impact-areas  hub, relay, logistics, scanning, G6
 * @version       2026-11
 */
'use strict';

const { randomBytes } = require('crypto');
const QRCode = require('qrcode');
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const OPAQUE = /^KQ1_[A-F0-9]{32}$/;
const ALIAS = /^[A-HJ-NP-Z2-9]{8}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ARTICLES = 250;

class LabelError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
function validId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new LabelError(400, 'HUB_LABEL_ID_INVALID');
  return value;
}
function validScope(value) { return validId(value); }
function shortAlias() {
  const bytes = randomBytes(8);
  return [...bytes].map(n => ALPHABET[n % ALPHABET.length]).join('');
}
function qrValue() { return 'KQ1_' + randomBytes(16).toString('hex').toUpperCase(); }
function normalizeScan(input) {
  const code = String(input || '').trim().toUpperCase();
  if (!OPAQUE.test(code) && !ALIAS.test(code)) throw new LabelError(400, 'HUB_LABEL_CODE_INVALID');
  return code;
}
async function loadArticle(q, allocationId, marketId) {
  const { rows:[row] } = await q.query(
    `SELECT a.id,a.market_id,a.order_id,a.product_sku_id,o.relais_id
       FROM hub_purchase_allocations a JOIN orders o ON o.id=a.order_id
      WHERE a.id=$1 AND a.market_id=$2 AND o.market_id=$2
      FOR UPDATE OF a`, [validId(allocationId), validScope(marketId)]
  );
  if (!row || !row.relais_id) throw new LabelError(404,'HUB_LABEL_ARTICLE_NOT_FOUND');
  const { rows:[received] } = await q.query(
    `SELECT COALESCE(SUM(quantity),0)::integer AS qty
       FROM hub_physical_unit_placements
      WHERE allocation_id=$1 AND operation_type='RECEIVE'`, [row.id]
  );
  const count = Number(received.qty);
  if (!Number.isSafeInteger(count) || count < 1) throw new LabelError(409,'HUB_LABEL_NOT_PHYSICALLY_RECEIVED');
  if (count > MAX_ARTICLES) throw new LabelError(409,'HUB_LABEL_BATCH_TOO_LARGE');
  return { ...row, count };
}
async function insertOpaque(q, {type,allocationId=null,number=null,boxId=null,marketId,relaisId,actorId}) {
  for (let attempt=0; attempt<16; attempt++) {
    const token=qrValue(), alias=shortAlias();
    const {rows} = await q.query(
      `INSERT INTO hub_scan_labels
        (target_type,allocation_id,unit_number,physical_unit_id,market_id,relais_id,qr_value,short_alias,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING
       RETURNING id,target_type,allocation_id,unit_number,physical_unit_id,market_id,relais_id,qr_value,short_alias`,
      [type,allocationId,number,boxId,marketId,relaisId,token,alias,actorId]
    );
    if (rows.length) return rows[0];
    // For an already issued label, the natural key wins. Return that exact label.
    const {rows:existing} = await q.query(
      type==='ARTICLE'
        ? "SELECT * FROM hub_scan_labels WHERE allocation_id=$1 AND unit_number=$2 AND target_type='ARTICLE'"
        : "SELECT * FROM hub_scan_labels WHERE physical_unit_id=$1 AND target_type='COMBOX'",
      type==='ARTICLE'?[allocationId,number]:[boxId]
    );
    if (existing.length) return existing[0];
  }
  throw new LabelError(409,'HUB_LABEL_CODE_COLLISION_RETRY');
}
async function issueArticleLabels(q,{allocationId,marketId,actorId}) {
  const item=await loadArticle(q,allocationId,marketId);
  for(let number=1;number<=item.count;number++) {
    await insertOpaque(q,{type:'ARTICLE',allocationId:item.id,number,
      marketId:item.market_id,relaisId:item.relais_id,actorId:validId(actorId)});
  }
  const {rows} = await q.query(
    "SELECT * FROM hub_scan_labels WHERE target_type='ARTICLE' AND allocation_id=$1 ORDER BY unit_number",
    [item.id]
  );
  if(rows.length!==item.count) throw new LabelError(409,'HUB_LABEL_RECEIVED_QUANTITY_MISMATCH');
  return rows;
}
async function issueBoxLabel(q,{boxId,marketId,relaisId=null,actorId}) {
  const {rows:[box]}=await q.query(
    "SELECT id,market_id,unit_type,state FROM hub_physical_units WHERE id=$1 FOR UPDATE",
    [validId(boxId)]
  );
  if(!box||box.unit_type!=='MARKET_PARCEL'||(box.market_id&&String(box.market_id)!==String(marketId)))
    throw new LabelError(404,'HUB_LABEL_BOX_NOT_IN_MARKET');
  // The final box label is issued only after the content is closed and locked.
  // During composition, the Hub still uses its internal box reference for scanning.
  if(!['PACKED','DISPATCHED'].includes(box.state))
    throw new LabelError(409,'HUB_LABEL_BOX_NOT_CLOSED');
  const {rows:destinations}=await q.query(
    `SELECT DISTINCT a.market_id,o.relais_id
       FROM hub_box_effective_placements p
       JOIN hub_purchase_allocations a ON a.id=p.allocation_id
       JOIN orders o ON o.id=a.order_id
      WHERE p.box_unit_id=$1`,[box.id]
  );
  if(destinations.length!==1||!destinations[0].relais_id)
    throw new LabelError(409,'HUB_LABEL_BOX_DESTINATION_REQUIRED');
  const destination=destinations[0];
  if(String(destination.market_id)!==String(marketId)||
     (relaisId&&String(destination.relais_id)!==String(relaisId)))
    throw new LabelError(409,'HUB_LABEL_BOX_DESTINATION_MISMATCH');
  const actualRelay=validId(String(destination.relais_id));
  const {rows:[relay]}=await q.query(
    'SELECT id FROM relais WHERE id=$1 AND market_id=$2 AND is_active=TRUE',
    [actualRelay,validScope(marketId)]
  );
  if(!relay) throw new LabelError(404,'HUB_LABEL_RELAY_NOT_IN_MARKET');
  const label=await insertOpaque(q,{type:'COMBOX',boxId:box.id,marketId,
    relaisId:actualRelay,actorId:validId(actorId)});
  if(String(label.market_id)!==String(marketId)||String(label.relais_id)!==actualRelay)
    throw new LabelError(409,'HUB_LABEL_BOX_DESTINATION_IMMUTABLE');
  return label;
}

async function resolveLabel(q,{code,marketId,relaisId=null}) {
  const scan=normalizeScan(code);
  const {rows:[row]}=await q.query(
    `SELECT l.id,l.target_type,l.allocation_id,l.unit_number,l.physical_unit_id,
            l.market_id,l.relais_id,l.short_alias,l.qr_value,
            a.product_sku_id,a.purchase_order_id,a.order_id,u.reference AS box_reference
       FROM hub_scan_labels l
       LEFT JOIN hub_purchase_allocations a ON a.id=l.allocation_id
       LEFT JOIN hub_physical_units u ON u.id=l.physical_unit_id
      WHERE (l.qr_value=$1 OR l.short_alias=$1) AND l.market_id=$2
        AND ($3::uuid IS NULL OR l.relais_id=$3)`, [scan,validScope(marketId),relaisId?validId(relaisId):null]
  );
  if(!row) throw new LabelError(404,'HUB_LABEL_NOT_FOUND');
  return {label_id:row.id,target_type:row.target_type,allocation_id:row.allocation_id,
    unit_number:row.unit_number,physical_unit_id:row.physical_unit_id,
    market_id:row.market_id,relais_id:row.relais_id,short_alias:row.short_alias,
    product_sku_id:row.product_sku_id,purchase_order_id:row.purchase_order_id,
    order_id:row.order_id,box_reference:row.box_reference};
}
async function listLabels(q,{targetType,targetId,marketId}) {
  const {rows}=await q.query(
    targetType==='ARTICLE'
      ? "SELECT * FROM hub_scan_labels WHERE allocation_id=$1 AND market_id=$2 AND target_type='ARTICLE' ORDER BY unit_number"
      : "SELECT * FROM hub_scan_labels WHERE physical_unit_id=$1 AND market_id=$2 AND target_type='COMBOX'",
    [validId(targetId),validScope(marketId)]
  );
  if(!rows.length) throw new LabelError(404,'HUB_LABEL_NOT_ISSUED');
  return rows;
}
// Read-only worklist for already issued labels. Neither QR payloads nor
// buyer identities leave this endpoint; PDF bytes remain capability-gated.
async function listMarketLabelGroups(q,{marketId,limit=80}) {
  const id=validScope(marketId);
  const size=Math.max(1,Math.min(100,Number(limit)||80));
  const {rows}=await q.query(
    `SELECT l.target_type,
            CASE WHEN l.target_type='ARTICLE' THEN l.allocation_id ELSE l.physical_unit_id END AS target_id,
            COUNT(*)::integer AS label_count,MAX(l.created_at) AS issued_at,
            MAX(o.reference) AS order_ref,MAX(u.reference) AS box_ref,
            MAX(u.state) AS box_state,
            COALESCE(MAX(r.short_code),'—') AS relay_code
       FROM hub_scan_labels l
       LEFT JOIN hub_purchase_allocations a ON l.target_type='ARTICLE' AND a.id=l.allocation_id
       LEFT JOIN orders o ON o.id=a.order_id
       LEFT JOIN hub_physical_units u ON l.target_type='COMBOX' AND u.id=l.physical_unit_id
       LEFT JOIN relais r ON r.id=l.relais_id
      WHERE l.market_id=$1
      GROUP BY l.target_type,l.allocation_id,l.physical_unit_id
      ORDER BY MAX(l.created_at) DESC
      LIMIT $2`,[id,size]
  );
  return rows.map(row=>({
    type:row.target_type,target_id:row.target_id,
    quantity:Number(row.label_count),issued_at:row.issued_at,
    reference:row.target_type==='ARTICLE'?row.order_ref:row.box_ref,
    relay_code:row.relay_code,box_state:row.target_type==='COMBOX'?row.box_state:null,
  }));
}

function escapeHtml(value) {
  return String(value==null?'':value).replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}
async function printHtml(q,{labels,marketCode,format='thermal'}) {
  if(!['thermal','a4'].includes(format)) throw new LabelError(400,'HUB_LABEL_PRINT_FORMAT_INVALID');
  if(!Array.isArray(labels)||!labels.length) throw new LabelError(404,'HUB_LABEL_NOT_ISSUED');
  const {rows:relayRows}=await q.query(
    "SELECT id,COALESCE(short_code,'—') AS short_code FROM relais WHERE id=ANY($1::uuid[])",
    [[...new Set(labels.map(l=>l.relais_id))]]
  );
  const relays=new Map(relayRows.map(r=>[String(r.id),String(r.short_code)]));
  const pages=[];
  for(const label of labels) {
    const code=await QRCode.toDataURL(label.qr_value,{errorCorrectionLevel:'M',margin:2,width:270});
    const destination=escapeHtml(marketCode)+' · '+escapeHtml(relays.get(String(label.relais_id))||'—');
    pages.push(`<section class="ticket">
      <header><strong>KOMERCE</strong><small>${label.target_type==='COMBOX'?'COMBOX':'ARTICLE'}</small></header>
      <div class="destination">${destination}</div>
      <img class="qr" alt="QR Komerce" src="${code}">
      <div class="alias">${escapeHtml(label.short_alias)}</div>
    </section>`);
  }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Étiquettes Komerce</title>
<style>
@page{size:${format==='thermal'?'80mm 105mm':'A4'};margin:4mm}
*{box-sizing:border-box}body{font:16px Arial,sans-serif;margin:0;background:white;color:#111}
.ticket{width:${format==='thermal'?'72mm':'78mm'};min-height:94mm;padding:3mm;border:1px solid #555;break-after:page;
display:flex;align-items:center;flex-direction:column;gap:4mm}
header{width:100%;display:flex;align-items:center;justify-content:space-between}
header strong{font-size:22px}header small{font-weight:bold;font-size:12px}
.destination{font-weight:800;font-size:23px}.qr{width:54mm;height:54mm;image-rendering:pixelated}
.alias{font:700 17px monospace;letter-spacing:2px}
.no-print{padding:12px}button{padding:10px 16px}
@media print{.no-print{display:none}}
</style></head><body><div class="no-print"><button onclick="window.print()">Imprimer les étiquettes</button></div>
${pages.join('\n')}</body></html>`;
}
async function boxRequiresOpaqueQr(db, unitId) {
  // Les COMBOX historiques restent valides. Toute COMBOX déjà étiquetée,
  // ou contenant une commande sur le nouveau moteur de vague, exige un QR.
  const {rows:[qrPolicy]}=await db.query(
    `SELECT (
      EXISTS (SELECT 1 FROM hub_scan_labels l
               WHERE l.physical_unit_id=$1 AND l.target_type='COMBOX')
      OR EXISTS (
        SELECT 1 FROM hub_physical_unit_placements p
        JOIN hub_purchase_allocations a ON a.id=p.allocation_id
        JOIN orders o ON o.id=a.order_id
        WHERE p.physical_unit_id=$1 AND p.removed_at IS NULL
          AND o.reference ~ $2
      )
    ) AS qr_required`,[unitId,'^[A-Z]{2}-[A-Z]{2}[0-9]{2}-[A-Z][A-Z0-9]{2}[0-9]{2}$']);
  return qrPolicy?.qr_required === true;
}
module.exports={LabelError,normalizeScan,issueArticleLabels,issueBoxLabel,resolveLabel,listLabels,listMarketLabelGroups,printHtml,boxRequiresOpaqueQr};
