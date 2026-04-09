/**
 * KOMERCE — Logistique M12 — Colisage & PDF
 * POST /api/logistics/shipments          → créer expédition
 * PATCH /api/logistics/shipments/:id     → mettre à jour expédition
 * GET  /api/logistics/shipments          → liste expéditions
 * POST /api/logistics/parcels            → créer colis
 * POST /api/logistics/parcels/:id/photo  → photo colis agent Dubai
 * GET  /api/logistics/labels/:shipment_id → étiquettes PDF A6
 * GET  /api/logistics/manifest/:shipment_id → manifeste PDF
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateShipmentRef } = require('../utils/reference');
const PDFDocument = require('pdfkit');
const { sendSMS }   = require('../utils/sms');
const { safeSyncScanToParcels } = require('../utils/parcelSync');
const QRCode = require('qrcode');
const { validate } = require('../middleware/validate');
const { logistics } = require('../validators');

const adminOnly = [authenticate, requireRole(['admin'])];

// POST /api/logistics/shipments
router.post('/shipments', ...adminOnly, validate(logistics.createShipment), async (req, res, next) => {
  try {
    const { carrier, container_ref, departed_at, eta, notes } = req.body;
    const reference = await generateShipmentRef(db);
    const { rows } = await db.query(
      `INSERT INTO shipments (reference, carrier, container_ref, departed_at, eta, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [reference, carrier, container_ref, departed_at, eta, notes]
    );
    res.status(201).json(rows[0]);
  } catch(e) { next(e); }
});

// GET /api/logistics/shipments
router.get('/shipments', ...adminOnly, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT s.*, COUNT(o.id) AS nb_commandes
      FROM shipments s LEFT JOIN orders o ON o.shipment_id = s.id
      GROUP BY s.id ORDER BY s.created_at DESC LIMIT 20
    `);
    res.json(rows);
  } catch(e) { next(e); }
});

// PATCH /api/logistics/shipments/:id
router.patch('/shipments/:id', ...adminOnly, validate(logistics.updateShipment), async (req, res, next) => {
  try {
    const { carrier, container_ref, departed_at, eta, arrived_at, customs_cleared_at, notes } = req.body;
    const { rows } = await db.query(
      `UPDATE shipments SET
         carrier=COALESCE($2,carrier), container_ref=COALESCE($3,container_ref),
         departed_at=COALESCE($4,departed_at), eta=COALESCE($5,eta),
         arrived_at=COALESCE($6,arrived_at), customs_cleared_at=COALESCE($7,customs_cleared_at),
         notes=COALESCE($8,notes), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id, carrier, container_ref, departed_at, eta, arrived_at, customs_cleared_at, notes]
    );
    if (!rows.length) return res.status(404).json({ error: 'Expédition introuvable' });

    // ── R1 COMPLIANCE: Use parcelSync instead of direct UPDATE ──
    if (arrived_at && customs_cleared_at) {
      // 1. Get all parcels for orders in this shipment
      const { rows: shipmentParcels } = await db.query(`
        SELECT p.id AS parcel_id, p.order_id, p.reference AS parcel_ref,
               o.reference AS order_ref, u.phone, u.full_name,
               r.name AS relais_name, r.address AS relais_addr
        FROM parcels p
        JOIN orders o ON o.id = p.order_id
        JOIN users u ON u.id = o.user_id
        LEFT JOIN relais r ON r.id = o.relais_id
        WHERE o.shipment_id = $1 AND p.status != 'cancelled'
      `, [req.params.id]);

      // 2. Update each parcel via parcelSync (R1 compliant)
      for (const sp of shipmentParcels) {
        await safeSyncScanToParcels({
          order_id: sp.order_id,
          step: 'relais_received',
          scan_id: null,
          scanned_by: req.user.id,
          notes: `Arrivée conteneur ${rows[0].container_ref || req.params.id}`,
        });
      }

      // 3. SMS per parcel (R1: 1 SMS per available parcel, not per order)
      const smsTargets = shipmentParcels.filter(sp => sp.phone);
      Promise.all(
        smsTargets.map(sp => sendSMS(
          sp.phone,
          `Komerce · Colis ${sp.parcel_ref || sp.order_ref} disponible au ${sp.relais_name} (${sp.relais_addr}).`,
          'available', null
        ))
      ).catch(err => console.error('SMS parcel batch error:', err.message));
    }

    res.json(rows[0]);
  } catch(e) { next(e); }
});

// GET /api/logistics/labels/:shipment_id — Étiquettes PDF A6
router.get('/labels/:shipment_id', ...adminOnly, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT o.reference, o.pickup_code, u.full_name, u.phone,
             r.name AS relais_name, r.address AS relais_address,
             array_agg(p.name||' x'||oi.quantity) AS articles
      FROM orders o
      JOIN users u ON u.id=o.user_id
      LEFT JOIN relais r ON r.id=o.relais_id
      LEFT JOIN order_items oi ON oi.order_id=o.id
      LEFT JOIN products p ON p.id=oi.product_id
      WHERE o.shipment_id=$1
      GROUP BY o.id, o.reference, o.pickup_code, u.full_name, u.phone, r.name, r.address
      ORDER BY o.reference
    `, [req.params.shipment_id]);

    if (!rows.length) return res.status(404).json({ error: 'Aucune commande pour cette expédition' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="etiquettes-${req.params.shipment_id}.pdf"`);

    const doc = new PDFDocument({ size: [297.6, 419.5], margin: 15 }); // A6
    doc.pipe(res);

    let first = true;
    for (const o of rows) {
      if (!first) doc.addPage();
      first = false;

      doc.fontSize(14).font('Helvetica-Bold').text('KOMERCE', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text('komerce.km', { align: 'center' });
      doc.moveDown(0.4);

      doc.fontSize(16).font('Helvetica-Bold').text(o.reference, { align: 'center' });
      doc.moveDown(0.4);

      doc.fontSize(12).font('Helvetica-Bold').text(o.full_name);
      doc.fontSize(9).font('Helvetica').text(`Tél : ${o.phone}`);
      doc.moveDown(0.3);

      doc.fontSize(10).font('Helvetica-Bold').text(`Relais : ${o.relais_name}`);
      doc.fontSize(8).font('Helvetica').text(o.relais_address || '');
      doc.moveDown(0.3);

      if (o.articles?.length) {
        doc.fontSize(8).text('Contenu : ' + o.articles.filter(Boolean).join(', '));
      }
      doc.moveDown(0.2);
      doc.fontSize(7).text(`Code retrait : ${o.pickup_code} · ${new Date().toLocaleDateString('fr-FR')}`);

      try {
        const qr = await QRCode.toDataURL(`https://komerce.km/suivi/${o.reference}`);
        doc.image(Buffer.from(qr.split(',')[1], 'base64'), doc.page.width - 80, 15, { width: 65 });
      } catch {}
    }

    doc.end();
  } catch(e) { next(e); }
});

// GET /api/logistics/manifest/:shipment_id — Manifeste PDF
router.get('/manifest/:shipment_id', ...adminOnly, async (req, res, next) => {
  try {
    const ship = await db.query('SELECT * FROM shipments WHERE id=$1', [req.params.shipment_id]);
    if (!ship.rows.length) return res.status(404).json({ error: 'Expédition introuvable' });

    const { rows } = await db.query(`
      SELECT o.reference, o.total_kmf, o.total_eur, o.payment_mode,
             u.full_name, u.phone,
             r.name AS relais_name,
             COUNT(oi.id) AS nb_articles
      FROM orders o
      JOIN users u ON u.id=o.user_id
      LEFT JOIN relais r ON r.id=o.relais_id
      LEFT JOIN order_items oi ON oi.order_id=o.id
      WHERE o.shipment_id=$1
      GROUP BY o.id, o.reference, o.total_kmf, o.total_eur, o.payment_mode, u.full_name, u.phone, r.name
      ORDER BY o.reference
    `, [req.params.shipment_id]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="manifeste-${ship.rows[0].reference}.pdf"`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    const s = ship.rows[0];
    doc.fontSize(18).font('Helvetica-Bold').text('KOMERCE — MANIFESTE D\'EXPÉDITION', { align: 'center' });
    doc.fontSize(10).font('Helvetica')
      .text(`Expédition : ${s.reference}`, { align: 'center' })
      .text(`Container : ${s.container_ref || 'À confirmer'} · ${s.carrier || ''}`, { align: 'center' })
      .text(`Départ : ${s.departed_at ? new Date(s.departed_at).toLocaleDateString('fr-FR') : 'À confirmer'} · ETA : ${s.eta ? new Date(s.eta).toLocaleDateString('fr-FR') : 'À confirmer'}`, { align: 'center' });
    doc.moveDown();

    const colW = [80, 110, 90, 90, 50, 80];
    const headers = ['Réf', 'Client', 'Téléphone', 'Relais', 'Art.', 'Total KMF'];
    let x = 40, y = doc.y;

    doc.fontSize(8).font('Helvetica-Bold');
    headers.forEach((h, i) => { doc.text(h, x, y, { width: colW[i] }); x += colW[i]; });
    y += 14; doc.moveTo(40, y).lineTo(540, y).stroke(); y += 4;

    doc.font('Helvetica').fontSize(8);
    let total = 0;
    for (const o of rows) {
      x = 40;
      [o.reference, o.full_name, o.phone, o.relais_name||'-', o.nb_articles, (o.total_kmf||0).toLocaleString('fr')].forEach((v,i) => {
        doc.text(String(v||'-'), x, y, { width: colW[i] }); x += colW[i];
      });
      y += 14; total += parseInt(o.total_kmf||0);
      if (y > 760) { doc.addPage(); y = 40; }
    }
    doc.moveTo(40, y).lineTo(540, y).stroke(); y += 6;
    doc.font('Helvetica-Bold').fontSize(9).text(`Total : ${rows.length} commandes · ${total.toLocaleString('fr')} KMF`, 40, y);
    doc.moveDown(2).fontSize(7).font('Helvetica').text(`Généré le ${new Date().toLocaleDateString('fr-FR')} · Komerce`);

    doc.end();
  } catch(e) { next(e); }
});

module.exports = router;
