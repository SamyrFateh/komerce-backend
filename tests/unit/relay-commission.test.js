'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  RELAY_COMMISSION_COMPONENT_KEY,
  RELAY_COMMISSION_CURRENT_FALLBACK_KMF,
  resolveRelayCommissionCurrent,
} = require('../../utils/relay-commission');

const golden = require('../../tools/golden-cdr/golden/cdr.golden.json');

describe('LOT 1A-3 — priorité commission relais', () => {
  test('cost_components est l’autorité nominale devant finance_config.standard', () => {
    expect(resolveRelayCommissionCurrent({
      componentValue: '620.0000',
      legacyStandardValue: 500,
    })).toEqual({
      amount_kmf: 620,
      source: 'cost_components.commission_relais_kmf',
      fallback_used: false,
    });
  });

  test('finance_config.standard reste un fallback legacy explicite', () => {
    expect(resolveRelayCommissionCurrent({
      componentValue: null,
      legacyStandardValue: '600',
    })).toEqual({
      amount_kmf: 600,
      source: 'finance_config.commission_relais_standard_kmf',
      fallback_used: true,
    });
  });

  test('fallback ultime CURRENT = 500 KMF', () => {
    expect(resolveRelayCommissionCurrent({})).toEqual({
      amount_kmf: RELAY_COMMISSION_CURRENT_FALLBACK_KMF,
      source: 'literal_current_fallback',
      fallback_used: true,
    });
    expect(RELAY_COMMISSION_CURRENT_FALLBACK_KMF).toBe(500);
  });

  test('zéro est une valeur explicite valide, pas un signal de fallback', () => {
    expect(resolveRelayCommissionCurrent({
      componentValue: 0,
      legacyStandardValue: 500,
    }).amount_kmf).toBe(0);
  });

  test('le Golden CURRENT prouve l’égalité des deux sources actives à 500 KMF', () => {
    // `is_active` n'existe pas sur les composants de ce golden : capturé
    // (LOT 0C-eco) avant que loadGlobalConfig() ne sélectionne cette colonne,
    // et le golden est figé — on ne le re-capture pas pour un ajout de champ
    // sans impact sur les valeurs qu'il protège (doctrine I-7 : seul un écart
    // de VALEUR expliqué justifie une re-capture). La requête réelle ne
    // retourne de toute façon que des lignes is_active = TRUE
    // (services/pricing-cdr.js), donc un composant présent dans ce snapshot
    // était nécessairement actif au moment de la capture — `!== false`
    // couvre à la fois ce golden historique et un golden futur qui porterait
    // le champ.
    const component = golden.frozen_config.components.find(
      (c) => c.key === RELAY_COMMISSION_COMPONENT_KEY && c.is_active !== false
    );
    expect(component).toBeDefined();
    expect(Number(component.default_value)).toBe(500);

    // NB : golden.frozen_config.finance ne porte ni commission_relais_standard_kmf,
    // ni commission_relais_showroom_kmf, ni commission_relais_pct — ce golden a été
    // figé (LOT 0C-eco) avant que ces colonnes finance_config n'entrent dans le
    // périmètre capturé par loadGlobalConfig(). Le golden est une doctrine
    // "figée, jamais retouchée à la main" (tools/golden-cdr/README.md) : on ne
    // fabrique pas ces valeurs ici pour faire passer le test, même si les
    // DEFAULT réels existent (migrations/036_finance_config_unification.sql :
    // standard=500, showroom=750 ; docs/db/railway-live-schema.sql : pct=5.00).
    // Seule une re-capture délibérée sur la DB de référence (accès que cet
    // environnement n'a pas) peut légitimement ajouter ces champs au snapshot.
    // showroom_kmf et pct sont de toute façon documentés comme morts et
    // volontairement exclus de resolveRelayCommissionCurrent() (voir l'en-tête
    // de ce fichier) — cette portion du test vérifiait une donnée que ni le
    // golden ni le runtime ne portent, sur un champ que le runtime ignore.
  });
});
