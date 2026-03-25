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
const QRCode = require('qrcode');

const adminOnly = [authenticate, requireRole(['admin'])];

// POST /api/logistics/shipments
router.post('/shipments', ...adminOnly, async (req, res) => {
  try {
    const { carrier, container_ref, departed_at, eta, notes } = req.body;
    const reference = generateShipmentRef();
    const { rows } = await db.query(
      `INSERT INTO shipments (reference, carrier, container_ref, departed_at, eta, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [reference, carrier, container_ref, departed_at, eta, notes]
    );
    res.status(201).json(rows[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur création expédition' }); }
});

// GET /api/logistics/shipments
router.get('/shipments', ...adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.*, COUNT(o.id) AS nb_commandes
      FROM shipments s LEFT JOIN orders o ON o.shipment_id = s.id
      GROUP BY s.id ORDER BY s.created_at DESC LIMIT 20
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PATCH /api/logistics/shipments/:id
router.patch('/shipments/:id', ...adminOnly, async (req, res) => {
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

    // Si arrivée confirmée — mettre commandes en available + SMS clients
    if (arrived_at && customs_cleared_at) {
      await db.query(
        "UPDATE orders SET status='available', available_at=NOW() WHERE shipment_id=$1 AND status='shipped'",
        [req.params.id]
      );
      const clients = await db.query(`
        SELECT o.reference, o.pickup_code, u.phone, rc.full_name AS dest_name, r.name AS relais_name, r.address AS relais_addr
        FROM orders o
        JOIN users u ON u.id=o.user_id
        LEFT JOIN recipients rc ON rc.id=o.recipient_id
        LEFT JOIN relais r ON r.id=o.relais_id
        WHERE o.shipment_id=$1 AND o.status='available'
      `, [req.params.id]);

      const { sendSMS } = require('../utils/sms');
      for (const c of clients.rows) {
        if (c.phone) {
          await sendSMS(c.phone,
            `Komerce · Votre commande ${c.reference} est disponible au ${c.relais_name} (${c.relais_addr}). Code de retrait : ${c.pickup_code}`,
            'available', null
          );
        }
      }
    }

    res.json(rows[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur mise à jour expédition' }); }
});

// GET /api/logistics/labels/:shipment_id — Étiquettes PDF A6
router.get('/labels/:shipment_id', ...adminOnly, async (req, res) => {
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
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur génération étiquettes' }); }
});

// GET /api/logistics/manifest/:shipment_id — Manifeste PDF
router.get('/manifest/:shipment_id', ...adminOnly, async (req, res) => {
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
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur génération manifeste' }); }
});

module.exports = router;
