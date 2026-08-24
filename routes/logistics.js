/**
 * @komerce-arch
 * @role          logistics-logistics
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, parcels, relais, shipments, users
 * @db-write      shipments
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Logistique M12 — Colisage & PDF (+ Sécurité v1.0)
 *
 * SÉCURITÉ LOGISTIQUE v1.0 :
 *   [S1] Étiquettes banalisées — AUCUNE info sensible visible
 *        ✅ Code externe neutre + QR + relais + destination + poids
 *        ❌ Pas de nom client, téléphone, produits, prix, pickup_code
 *   [S3] Manifeste = info interne (client + articles) — PAS sur le colis
 *        Le manifeste est un document SYSTÈME (jamais collé sur un colis)
 *
 * POST /api/logistics/shipments          → créer expédition
 * PATCH /api/logistics/shipments/:id     → mettre à jour expédition
 * GET  /api/logistics/shipments          → liste expéditions
 * GET  /api/logistics/labels/:shipment_id → étiquettes PDF A6 [S1 NEUTRES]
 * GET  /api/logistics/manifest/:shipment_id → manifeste PDF [système]
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateShipmentRef } = require('../utils/reference');
const PDFDocument = require('pdfkit');
const { notifyText, appendRelayLocation } = require('../services/notification-service'); // ZG-1: remplace sendSMS
const { safeSyncScanToParcels } = require('../utils/parcelSync');
const QRCode = require('qrcode');
const { validate } = require('../middleware/validate');
const { logistics } = require('../validators');
const { logParcelEvent } = require('../services/parcel-security');
const log = require('../utils/logger').child({ module: 'logistics' });

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

    // R1 COMPLIANCE: parcelSync on arrival
    if (arrived_at && customs_cleared_at) {
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

      for (const sp of shipmentParcels) {
        await safeSyncScanToParcels({
          order_id: sp.order_id,
          step: 'relais_received',
          scan_id: null,
          scanned_by: req.user.id,
          notes: `Arrivée conteneur ${rows[0].container_ref || req.params.id}`,
        });

        // [S2] Logger l'événement
        if (sp.parcel_id) {
          await logParcelEvent(db, {
            parcel_id: sp.parcel_id,
            event_type: 'location_changed',
            actor_id: req.user.id,
            location: sp.relais_name,
            notes: `Arrivée au relais via conteneur ${rows[0].container_ref || ''}`,
          });
        }
      }

      // SMS per parcel (R1: 1 SMS per available parcel)
      const smsTargets = shipmentParcels.filter(sp => sp.phone);
      Promise.all(
        smsTargets.map(sp => {
          const message = appendRelayLocation(
            `Komerce · Colis ${sp.parcel_ref || sp.order_ref} disponible au ${sp.relais_name} (${sp.relais_addr}).`,
            { name: sp.relais_name, address: sp.relais_addr },
          );
          return notifyText(sp.phone, message, 'available', null);
        })
      ).catch(err => log.error({ err }, 'Notification parcel batch error'));
    }

    res.json(rows[0]);
  } catch(e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// [S1] ÉTIQUETTES NEUTRES — AUCUNE INFO SENSIBLE
// ═══════════════════════════════════════════════════════════════════════════
// VISIBLE sur le colis :
//   ✅ Code externe neutre (KP-XXXXXX)
//   ✅ QR code → URL interne (nécessite auth)
//   ✅ Nom du relais + adresse (nécessaire au routage)
//   ✅ Île destination (nécessaire au routage)
//   ✅ Poids (manutention)
//   ✅ Type (standard/fragile)
//   ✅ Date
//
// JAMAIS sur le colis :
//   ❌ Nom du client
//   ❌ Téléphone
//   ❌ Liste des produits
//   ❌ Prix / valeur
//   ❌ Code retrait (communiqué par SMS uniquement)
//   ❌ Référence commande (lien commande = info système)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/labels/:shipment_id', ...adminOnly, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT p.external_code, p.reference AS parcel_ref, p.type AS parcel_type,
             p.weight_kg, p.seal_code,
             o.destination_island, o.routing_mode,
             r.name AS relais_name, r.address AS relais_address
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.shipment_id = $1 AND p.status != 'cancelled'
      ORDER BY p.reference
    `, [req.params.shipment_id]);

    if (!rows.length) return res.status(404).json({ error: 'Aucun colis pour cette expédition' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="etiquettes-${req.params.shipment_id}.pdf"`);

    const doc = new PDFDocument({ size: [297.6, 419.5], margin: 15 }); // A6
    doc.pipe(res);

    let first = true;
    for (const p of rows) {
      if (!first) doc.addPage();
      first = false;

      // ─── En-tête neutre ───
      doc.fontSize(10).font('Helvetica').text('KOMERCE', { align: 'center' });
      doc.moveDown(0.3);

      // ─── Code externe principal (GROS, centré) ───
      doc.fontSize(22).font('Helvetica-Bold').text(p.external_code || p.parcel_ref, { align: 'center' });
      doc.moveDown(0.5);

      // ─── QR code → URL interne (nécessite auth pour voir le contenu) ───
      try {
        const qrUrl = `https://komerce.km/p/${p.external_code || p.parcel_ref}`;
        const qr = await QRCode.toDataURL(qrUrl, { width: 120, margin: 1 });
        const qrX = (297.6 - 100) / 2; // centrer sur A6
        doc.image(Buffer.from(qr.split(',')[1], 'base64'), qrX, doc.y, { width: 100 });
        doc.moveDown(6);
      } catch {}

      // ─── Destination (routage) ───
      if (p.destination_island) {
        const routeTag = p.routing_mode === 'INTER_ISLAND' ? ' → via ANJOUAN'
                       : p.routing_mode === 'SPECIAL_ROUTE' ? ' (route spéciale)'
                       : '';
        doc.fontSize(14).font('Helvetica-Bold').text(
          `→ ${p.destination_island}${routeTag}`,
          { align: 'center' }
        );
        doc.moveDown(0.3);
      }

      // ─── Relais destination (nécessaire au routage physique) ───
      doc.fontSize(11).font('Helvetica-Bold').text(p.relais_name || 'Relais à confirmer', { align: 'center' });
      if (p.relais_address) {
        doc.fontSize(8).font('Helvetica').text(p.relais_address, { align: 'center' });
      }
      doc.moveDown(0.4);

      // ─── Métadonnées manutention ───
      const meta = [];
      if (p.weight_kg) meta.push(`${p.weight_kg} kg`);
      if (p.parcel_type === 'fragile') meta.push('⚠️ FRAGILE');
      meta.push(new Date().toLocaleDateString('fr-FR'));

      doc.fontSize(8).font('Helvetica').text(meta.join(' · '), { align: 'center' });

      // ─── Ligne de séparation ───
      doc.moveDown(0.3);
      doc.moveTo(30, doc.y).lineTo(267, doc.y).dash(3, { space: 2 }).stroke();
      doc.undash();
      doc.moveDown(0.2);

      // ─── Petit texte sécurité ───
      doc.fontSize(6).font('Helvetica')
        .text('Colis banalisé — contenu confidentiel — traçabilité Komerce', { align: 'center' });
    }

    doc.end();
  } catch(e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MANIFESTE — Document SYSTÈME (info complète, JAMAIS sur un colis)
// Le manifeste contient les infos client + articles pour la gestion interne.
// Il est imprimé séparément et conservé par l'admin/hub.
// ═══════════════════════════════════════════════════════════════════════════

router.get('/manifest/:shipment_id', ...adminOnly, async (req, res, next) => {
  try {
    const ship = await db.query('SELECT * FROM shipments WHERE id=$1', [req.params.shipment_id]);
    if (!ship.rows.length) return res.status(404).json({ error: 'Expédition introuvable' });

    const { rows } = await db.query(`
      SELECT o.reference, o.total_kmf, o.total_eur, o.payment_mode,
             o.destination_island, o.routing_mode,
             p_agg.external_code, p_agg.parcel_count,
             u.full_name, u.phone,
             r.name AS relais_name,
             COUNT(oi.id) AS nb_articles
      FROM orders o
      JOIN users u ON u.id=o.user_id
      LEFT JOIN relais r ON r.id=o.relais_id
      LEFT JOIN order_items oi ON oi.order_id=o.id
      LEFT JOIN LATERAL (
        SELECT string_agg(p2.external_code, ', ') AS external_code,
               COUNT(p2.id) AS parcel_count
        FROM parcels p2 WHERE p2.order_id = o.id AND p2.status != 'cancelled'
      ) p_agg ON true
      WHERE o.shipment_id=$1
      GROUP BY o.id, o.reference, o.total_kmf, o.total_eur, o.payment_mode,
               o.destination_island, o.routing_mode,
               p_agg.external_code, p_agg.parcel_count,
               u.full_name, u.phone, r.name
      ORDER BY o.reference
    `, [req.params.shipment_id]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="manifeste-${ship.rows[0].reference}.pdf"`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    const s = ship.rows[0];
    doc.fontSize(16).font('Helvetica-Bold').text('KOMERCE — MANIFESTE D\'EXPÉDITION', { align: 'center' });
    doc.fontSize(8).font('Helvetica').fillColor('red')
      .text('⚠️ DOCUMENT CONFIDENTIEL — USAGE INTERNE UNIQUEMENT', { align: 'center' });
    doc.fillColor('black');
    doc.fontSize(10).font('Helvetica')
      .text(`Expédition : ${s.reference}`, { align: 'center' })
      .text(`Container : ${s.container_ref || 'À confirmer'} · ${s.carrier || ''}`, { align: 'center' })
      .text(`Départ : ${s.departed_at ? new Date(s.departed_at).toLocaleDateString('fr-FR') : 'À confirmer'} · ETA : ${s.eta ? new Date(s.eta).toLocaleDateString('fr-FR') : 'À confirmer'}`, { align: 'center' });
    doc.moveDown();

    const colW = [55, 55, 90, 55, 70, 35, 60];
    const headers = ['Réf cmd', 'Code colis', 'Client', 'Dest.', 'Relais', 'Art.', 'Total KMF'];
    let x = 40, y = doc.y;

    doc.fontSize(7).font('Helvetica-Bold');
    headers.forEach((h, i) => { doc.text(h, x, y, { width: colW[i] }); x += colW[i]; });
    y += 14; doc.moveTo(40, y).lineTo(560, y).stroke(); y += 4;

    doc.font('Helvetica').fontSize(7);
    let total = 0;
    for (const o of rows) {
      x = 40;
      [o.reference, o.external_code||'-', o.full_name, o.destination_island||'-', o.relais_name||'-', o.nb_articles, (o.total_kmf||0).toLocaleString('fr')].forEach((v,i) => {
        doc.text(String(v||'-'), x, y, { width: colW[i] }); x += colW[i];
      });
      y += 14; total += parseInt(o.total_kmf||0);
      if (y > 760) { doc.addPage(); y = 40; }
    }
    doc.moveTo(40, y).lineTo(560, y).stroke(); y += 6;
    doc.font('Helvetica-Bold').fontSize(9).text(`Total : ${rows.length} commandes · ${total.toLocaleString('fr')} KMF`, 40, y);
    doc.moveDown(2).fontSize(7).font('Helvetica').text(`Généré le ${new Date().toLocaleDateString('fr-FR')} · Komerce · Document interne`);

    doc.end();
  } catch(e) { next(e); }
});

module.exports = router;
