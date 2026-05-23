// ─── Parcel Label Generator ─────────────────────────────────
// GET /api/v2/parcels/:ref/label  → HTML imprimable avec QR code
// GET /api/v2/parcels/:ref/label?format=thermal → optimisé 80mm
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const db = require('../db');
const log = require('../utils/logger').child({ module: 'parcel-label' });

// ── Helper: format date ──
function fmtDate(d) {
  if (!d) return '—';
  var dt = new Date(d);
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Helper: format price ──
function fmtPrice(n) {
  return (n || 0).toLocaleString('fr-FR') + ' KMF';
}

// ── GET /:ref/label ──────────────────────────────────────────
router.get('/:ref/label', async (req, res) => {
  const { ref } = req.params;
  const thermal = req.query.format === 'thermal';

  try {
    // 1. Fetch parcel — FIX: COALESCE only same-type columns (uuid)
    const pRes = await db.query(`
      SELECT p.id, p.reference, p.status, p.pickup_code, p.weight_kg,
             p.destination_island,
             p.created_at, p.shipped_at, p.available_at,
             r.name AS relais_name, r.island, r.city AS relais_city
      FROM parcels p
      LEFT JOIN relais r ON r.id = COALESCE(p.relay_id, p.relais_id)
      WHERE p.reference = $1
    `, [ref]);

    if (!pRes.rows.length) return res.status(404).send('Colis non trouvé: ' + ref);
    const p = pRes.rows[0];

    // 2. Fetch clients + orders via parcel_items → order_items → orders
    //    FIX: parcel_items has order_item_id, NOT order_id
    const oRes = await db.query(`
      SELECT DISTINCT o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.payment_status,
             u.full_name AS client_name, u.phone AS client_phone
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE pi.parcel_id = $1
      ORDER BY o.reference
    `, [p.id]);

    let orders = oRes.rows;

    // Fallback: if no parcel_items, use parcels.order_id (1:1 legacy)
    if (orders.length === 0) {
      const fallback = await db.query(`
        SELECT o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.payment_status,
               u.full_name AS client_name, u.phone AS client_phone
        FROM parcels p2
        JOIN orders o ON o.id = p2.order_id
        LEFT JOIN users u ON u.id = o.user_id
        WHERE p2.id = $1
      `, [p.id]);
      orders = fallback.rows;
    }

    // 3. Fetch items per order via parcel_items → order_items → products
    for (let i = 0; i < orders.length; i++) {
      const iRes = await db.query(`
        SELECT pi.quantity, oi.price_kmf AS unit_price, 
               COALESCE(pr.name, pi.product_name, 'Article') AS product_name
        FROM parcel_items pi
        JOIN order_items oi ON oi.id = pi.order_item_id
        LEFT JOIN products pr ON pr.id = oi.product_id
        WHERE pi.parcel_id = $1 AND oi.order_id = $2
      `, [p.id, orders[i].id]);
      orders[i].items = iRes.rows;

      // Fallback: if no parcel_items for this order, use order_items directly
      if (orders[i].items.length === 0) {
        const fb = await db.query(`
          SELECT oi.quantity, oi.price_kmf AS unit_price,
                 COALESCE(pr.name, 'Article') AS product_name
          FROM order_items oi
          LEFT JOIN products pr ON pr.id = oi.product_id
          WHERE oi.order_id = $1
        `, [orders[i].id]);
        orders[i].items = fb.rows;
      }
    }

    // 4. Compute totals
    const totalOrders = orders.length;
    const totalItems = orders.reduce((s, o) => s + (o.items || []).length, 0);
    const totalKmf = orders.reduce((s, o) => s + (parseInt(o.total_kmf) || 0), 0);
    const clientName = orders[0]?.client_name || p.recipient_name || 'Client';
    const clientPhone = orders[0]?.client_phone || p.recipient_phone || '';

    // 5. Build tracking URL for QR
    const baseUrl = req.protocol + '://' + req.get('host');
    const trackingUrl = baseUrl + '/suivi.html?ref=' + encodeURIComponent(p.reference);
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(trackingUrl);

    // 6. Build orders HTML
    let ordersHtml = '';
    for (let o of orders) {
      ordersHtml += '<div class="order-block">';
      ordersHtml += '<div class="order-ref">' + o.reference + ' &middot; ' + fmtPrice(o.total_kmf) + '</div>';
      for (let it of (o.items || [])) {
        ordersHtml += '<div class="item-line">' + (it.product_name || 'Article') + ' x' + (it.quantity || 1);
        if (it.unit_price) ordersHtml += ' &middot; ' + fmtPrice(it.unit_price);
        ordersHtml += '</div>';
      }
      ordersHtml += '</div>';
    }

    // 7. Render HTML label
    const width = thermal ? '80mm' : '148mm'; // 80mm thermal or A5
    const fontSize = thermal ? '11px' : '14px';
    const qrSize = thermal ? '120px' : '180px';

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width">
<title>Etiquette ${p.reference}</title>
<style>
  @page { size: ${width} auto; margin: 3mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: ${fontSize}; color: #1a1a1a;
         width: ${width}; margin: 0 auto; padding: 4mm; }
  .label { border: 2px solid #000; border-radius: 4px; padding: 3mm; }
  .header { display: flex; align-items: center; justify-content: space-between;
            border-bottom: 2px solid #000; padding-bottom: 3mm; margin-bottom: 3mm; }
  .logo { font-size: ${thermal ? '16px' : '22px'}; font-weight: 900; letter-spacing: 2px; }
  .ref-big { font-size: ${thermal ? '18px' : '24px'}; font-weight: 900; font-family: monospace; }
  .qr-section { display: flex; gap: 4mm; align-items: flex-start; margin: 3mm 0;
                padding-bottom: 3mm; border-bottom: 1px dashed #999; }
  .qr-section img { width: ${qrSize}; height: ${qrSize}; }
  .qr-info { flex: 1; }
  .qr-info div { margin-bottom: 2mm; }
  .field-label { font-size: ${thermal ? '9px' : '11px'}; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  .field-value { font-size: ${thermal ? '13px' : '16px'}; font-weight: 700; }
  .client-block { padding: 3mm 0; border-bottom: 1px dashed #999; }
  .client-name { font-size: ${thermal ? '15px' : '20px'}; font-weight: 900; }
  .client-phone { font-size: ${thermal ? '13px' : '16px'}; font-weight: 600; margin-top: 1mm; }
  .pickup-code { text-align: center; margin: 3mm 0; padding: 3mm;
                 background: #000; color: #fff; border-radius: 4px; }
  .pickup-code .code { font-size: ${thermal ? '28px' : '36px'}; font-weight: 900;
                       font-family: monospace; letter-spacing: 6px; }
  .pickup-code .sub { font-size: ${thermal ? '9px' : '11px'}; margin-top: 1mm; opacity: 0.8; }
  .orders-section { padding: 3mm 0; border-bottom: 1px dashed #999; }
  .order-block { margin-bottom: 2mm; }
  .order-ref { font-weight: 700; font-size: ${thermal ? '11px' : '13px'}; }
  .item-line { font-size: ${thermal ? '10px' : '12px'}; color: #444; padding-left: 3mm; }
  .summary { display: flex; justify-content: space-between; padding: 3mm 0;
             border-bottom: 1px dashed #999; font-weight: 700; }
  .footer { text-align: center; padding-top: 2mm; font-size: ${thermal ? '8px' : '10px'}; color: #999; }
  .island-badge { display: inline-block; padding: 1mm 3mm; background: #e0f2fe;
                  border: 1px solid #0284c7; border-radius: 3px; font-weight: 700;
                  font-size: ${thermal ? '12px' : '14px'}; color: #0284c7; }
  .status-badge { display: inline-block; padding: 1mm 3mm; background: #f0fdf4;
                  border: 1px solid #16a34a; border-radius: 3px; font-weight: 700;
                  font-size: ${thermal ? '10px' : '12px'}; color: #16a34a; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style>
</head>
<body>
<div class="no-print" style="text-align:center;padding:10px;background:#f0f9ff;margin-bottom:5mm">
  <button onclick="window.print()" style="padding:8px 24px;font-size:16px;font-weight:700;
    background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer">
    Imprimer l'etiquette
  </button>
  <span style="margin-left:10px;font-size:13px;color:#666">
    ${thermal ? 'Format thermique 80mm' : 'Format A5'}
    &middot; <a href="?format=${thermal ? '' : 'thermal'}">${thermal ? 'Version A5' : 'Version thermique'}</a>
  </span>
</div>
<div class="label">
  <div class="header">
    <div class="logo">KOMERCE</div>
    <div class="ref-big">${p.reference}</div>
  </div>

  <div class="qr-section">
    <img src="${qrUrl}" alt="QR ${p.reference}" />
    <div class="qr-info">
      <div>
        <div class="field-label">Destination</div>
        <div class="field-value"><span class="island-badge">${p.destination_island || p.island || '—'}</span></div>
      </div>
      <div>
        <div class="field-label">Relais</div>
        <div class="field-value">${p.relais_name || '—'}</div>
      </div>
      <div>
        <div class="field-label">Statut</div>
        <div><span class="status-badge">${p.status}</span></div>
      </div>
      ${p.weight_kg ? '<div><div class="field-label">Poids</div><div class="field-value">' + p.weight_kg + ' kg</div></div>' : ''}
    </div>
  </div>

  <div class="client-block">
    <div class="field-label">Client</div>
    <div class="client-name">${clientName}</div>
    <div class="client-phone">${clientPhone}</div>
  </div>

  ${p.pickup_code ? '<div class="pickup-code"><div class="sub">CODE DE RETRAIT</div><div class="code">' + p.pickup_code + '</div></div>' : ''}

  <div class="orders-section">
    <div class="field-label">${totalOrders} commande${totalOrders > 1 ? 's' : ''} &middot; ${totalItems} article${totalItems > 1 ? 's' : ''}</div>
    ${ordersHtml}
  </div>

  <div class="summary">
    <span>TOTAL</span>
    <span>${fmtPrice(totalKmf)}</span>
  </div>

  <div class="footer">
    Cree le ${fmtDate(p.created_at)} ${p.shipped_at ? '&middot; Expedie le ' + fmtDate(p.shipped_at) : ''}
    ${p.available_at ? '&middot; Arrive le ' + fmtDate(p.available_at) : ''}
    <br>Scannez le QR code pour le suivi en temps reel
  </div>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) {
    log.error('[LABEL]', err);
    res.status(500).json({ error: 'Erreur génération étiquette', detail: err.message });
  }
});

module.exports = router;
