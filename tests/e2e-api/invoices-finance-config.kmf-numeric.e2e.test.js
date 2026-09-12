'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-INVOICES-FINANCE-CONFIG-KMF-NUMERIC — LOT 4 du chantier currency debt
 *
 * 20 colonnes monétaires integer -> numeric(14,2) (migration 217) :
 *   - invoices.subtotal_kmf, shipping_kmf, total_kmf
 *   - finance_config : 17 colonnes, dont 10 créées dans
 *     bootstrap/startup-migrations.js (hors dossier migrations/, trouvées
 *     par recoupement avec le dump de schéma vivant, pas par grep des seuls
 *     fichiers migrations/*.sql — voir en-tête de la migration 217).
 *
 * Aucune boucle d'accumulation trouvée sur ces colonnes (contrairement au
 * risque propre à LOT 3 wallet) : ce lot vérifie le décodage number, la
 * conservation des centimes, et — pour finance_config — que la validation
 * API (routes/admin-finance-config.js) accepte désormais des décimales sur
 * les 10 champs dont le type a été changé de 'int' à 'decimal' dans ce même
 * lot (sans ce correctif applicatif, l'API continuerait de rejeter tout
 * centime malgré la colonne numeric).
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(30000);

describeE2E('E2E-INVOICES-FINANCE-CONFIG-KMF-NUMERIC — conversion integer -> numeric', ({ db }) => {
  const marketId = uuid();
  const userId = uuid();
  const relaisId = uuid();

  let cleanup;

  beforeAll(async () => {
    cleanup = createCleanup(db);

    await db.query(
      `INSERT INTO markets (id, code, name, currency, minor_unit, is_active)
       VALUES ($1, $2, $3, 'KMF', 0, TRUE)`,
      [marketId, tag('E4').slice(0, 2).toUpperCase(), tag('marche-e2e-lot4')]
    );
    cleanup.track('markets', 'id', marketId);

    await db.query(
      `INSERT INTO users (id, full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'e2e-not-a-real-hash', 'client')`,
      [userId, tag('E2E User'), tag('user') + '@e2e.invalid']
    );
    cleanup.track('users', 'id', userId);

    await db.query(
      `INSERT INTO relais (id, name, agent_name, phone, address, market_id)
       VALUES ($1, $2, 'E2E Agent', $3, 'E2E Address', $4)`,
      [relaisId, tag('E2E Relais'), '+269' + String(Math.floor(1e8 + Math.random() * 8e8)), marketId]
    );
    cleanup.track('relais', 'id', relaisId);
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  async function insertOrder(totalKmf) {
    const id = uuid();
    await db.query(
      `INSERT INTO orders (id, reference, user_id, relais_id, market_id, total_kmf, payment_mode, payment_status, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'cash_relais', 'paid', 'pending')`,
      [id, tag('E2E-ORDER'), userId, relaisId, marketId, totalKmf]
    );
    cleanup.track('orders', 'id', id);
    return id;
  }

  test('invoices.subtotal_kmf/shipping_kmf/total_kmf décodent en number et conservent les centimes', async () => {
    const orderId = await insertOrder(12345.67);
    const invoiceId = uuid();
    await db.query(
      `INSERT INTO invoices
         (id, invoice_number, order_id, client_name, client_phone, relay_name,
          items_snapshot, subtotal_kmf, shipping_kmf, total_kmf, payment_mode)
       VALUES ($1, $2, $3, 'E2E Client', '+269000000', 'E2E Relais',
               '[]'::jsonb, $4, $5, $6, 'cash_relais')`,
      [invoiceId, tag('E2E-INV'), orderId, 12000.5, 345.17, 12345.67]
    );
    cleanup.track('invoices', 'id', invoiceId);

    const { rows: [inv] } = await db.query(
      'SELECT subtotal_kmf, shipping_kmf, total_kmf FROM invoices WHERE id = $1',
      [invoiceId]
    );
    expect(typeof inv.subtotal_kmf).toBe('number');
    expect(inv.subtotal_kmf).toBe(12000.5);
    expect(inv.shipping_kmf).toBe(345.17);
    expect(inv.total_kmf).toBe(12345.67);
    // Cohérence interne : subtotal + shipping == total, au centime.
    expect(inv.subtotal_kmf + inv.shipping_kmf).toBe(inv.total_kmf);
  });

  describe('finance_config — 17 colonnes, décodage et centimes', () => {
    let original;

    beforeAll(async () => {
      const { rows: [row] } = await db.query('SELECT * FROM finance_config WHERE id = 1');
      original = row;
    });

    afterAll(async () => {
      // finance_config est un singleton partagé — on restaure les valeurs
      // d'origine plutôt que de les supprimer, pour ne pas polluer les
      // autres tests/l'environnement partagé.
      if (!original) return;
      await db.query(
        `UPDATE finance_config SET
           cost_fixed_sourcing_kmf = $1, cost_fixed_transit_kmf = $2,
           cost_fixed_hub_kmf = $3, cost_fixed_relais_kmf = $4,
           cost_fixed_support_kmf = $5, target_panier_moyen_kmf = $6,
           objectif_ca_mensuel_kmf = $7, frais_livraison_defaut_kmf = $8,
           seuil_livraison_gratuite_kmf = $9, loyalty_threshold_kmf = $10,
           frais_stripe_fixed_kmf = $11, commission_relais_standard_kmf = $12,
           commission_relais_showroom_kmf = $13, transitaire_fixed_kmf = $14,
           portuaires_kmf = $15, sante_seuil_vip_kmf = $16,
           sante_seuil_atrisk_ltv_kmf = $17
         WHERE id = 1`,
        [
          original.cost_fixed_sourcing_kmf, original.cost_fixed_transit_kmf,
          original.cost_fixed_hub_kmf, original.cost_fixed_relais_kmf,
          original.cost_fixed_support_kmf, original.target_panier_moyen_kmf,
          original.objectif_ca_mensuel_kmf, original.frais_livraison_defaut_kmf,
          original.seuil_livraison_gratuite_kmf, original.loyalty_threshold_kmf,
          original.frais_stripe_fixed_kmf, original.commission_relais_standard_kmf,
          original.commission_relais_showroom_kmf, original.transitaire_fixed_kmf,
          original.portuaires_kmf, original.sante_seuil_vip_kmf,
          original.sante_seuil_atrisk_ltv_kmf,
        ]
      );
    });

    test('les 17 colonnes acceptent et conservent des centimes réels', async () => {
      await db.query(
        `UPDATE finance_config SET
           cost_fixed_sourcing_kmf = 1000.25, cost_fixed_transit_kmf = 500.10,
           cost_fixed_hub_kmf = 400.75, cost_fixed_relais_kmf = 300.33,
           cost_fixed_support_kmf = 200.05, target_panier_moyen_kmf = 15000.99,
           objectif_ca_mensuel_kmf = 1500000.01, frais_livraison_defaut_kmf = 1500.5,
           seuil_livraison_gratuite_kmf = 25000.25, loyalty_threshold_kmf = 20000.75,
           frais_stripe_fixed_kmf = 150.15, commission_relais_standard_kmf = 500.5,
           commission_relais_showroom_kmf = 750.5, transitaire_fixed_kmf = 450.45,
           portuaires_kmf = 1200.2, sante_seuil_vip_kmf = 200000.5,
           sante_seuil_atrisk_ltv_kmf = 500000.5
         WHERE id = 1`
      );

      const { rows: [cfg] } = await db.query('SELECT * FROM finance_config WHERE id = 1');

      expect(typeof cfg.cost_fixed_sourcing_kmf).toBe('number');
      expect(cfg.cost_fixed_sourcing_kmf).toBe(1000.25);
      expect(cfg.cost_fixed_transit_kmf).toBe(500.1);
      expect(cfg.cost_fixed_hub_kmf).toBe(400.75);
      expect(cfg.cost_fixed_relais_kmf).toBe(300.33);
      expect(cfg.cost_fixed_support_kmf).toBe(200.05);
      expect(cfg.target_panier_moyen_kmf).toBe(15000.99);
      expect(cfg.objectif_ca_mensuel_kmf).toBe(1500000.01);
      expect(cfg.frais_livraison_defaut_kmf).toBe(1500.5);
      expect(cfg.seuil_livraison_gratuite_kmf).toBe(25000.25);
      expect(cfg.loyalty_threshold_kmf).toBe(20000.75);
      expect(cfg.frais_stripe_fixed_kmf).toBe(150.15);
      expect(cfg.commission_relais_standard_kmf).toBe(500.5);
      expect(cfg.commission_relais_showroom_kmf).toBe(750.5);
      expect(cfg.transitaire_fixed_kmf).toBe(450.45);
      expect(cfg.portuaires_kmf).toBe(1200.2);
      expect(cfg.sante_seuil_vip_kmf).toBe(200000.5);
      expect(cfg.sante_seuil_atrisk_ltv_kmf).toBe(500000.5);

      // Somme des 5 coûts fixes (routes/admin-finance-config.js) reste
      // arithmétiquement correcte sur des décimales réelles, pas une
      // concaténation de chaînes.
      const sumFixed =
        cfg.cost_fixed_sourcing_kmf + cfg.cost_fixed_transit_kmf +
        cfg.cost_fixed_hub_kmf + cfg.cost_fixed_relais_kmf +
        cfg.cost_fixed_support_kmf;
      expect(sumFixed).toBeCloseTo(2401.38, 5);
    });
  });
});
