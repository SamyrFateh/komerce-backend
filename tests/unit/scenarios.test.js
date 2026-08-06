'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/scenarios.test.js
 * Couvre services/simulator/scenarios.js
 *
 * Module statique pur (aucun accès DB). La structure SCENARIOS/CATEGORIES
 * est déjà couverte par tests/unit/simulator-platform-ops.test.js — ce
 * fichier se concentre sur les 3 fonctions comportementales : assign(),
 * getNextAction(), getChaosAction(). assign() et getChaosAction() utilisent
 * Math.random() en interne → mocké via jest.spyOn pour rendre les tests
 * déterministes.
 */

const { SCENARIOS, CATEGORIES, assign, getNextAction, getChaosAction } = require('../../services/simulator/scenarios');

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CATEGORIES', () => {
  it('expose happy/delay/fail avec label et color', () => {
    expect(CATEGORIES).toEqual({
      happy: { label: 'Flux normal', color: '#22c55e' },
      delay: { label: 'Retards', color: '#f59e0b' },
      fail: { label: 'Échecs', color: '#ef4444' },
    });
  });
});

describe('assign — sélection de scénario', () => {
  it('config.scenarios absent → défaut ["nominal"], retourne SCENARIOS.nominal', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = assign({ status: 'confirmed' }, {});
    expect(result).toBe(SCENARIOS.nominal);
  });

  it('aucun nom de la liste ne correspond à un scénario connu → fallback SCENARIOS.nominal', () => {
    const result = assign({ status: 'confirmed' }, { scenarios: ['inexistant', 'autre_inconnu'] });
    expect(result).toBe(SCENARIOS.nominal);
  });

  it('noms partiellement valides → ne garde que les scénarios connus', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99); // pousse vers le dernier candidat pondéré
    const result = assign({ status: 'confirmed' }, { scenarios: ['inexistant', 'cancelled'] });
    expect(result).toBe(SCENARIOS.cancelled);
  });

  it('order pending + cash_relais, late_cash disponible, random < 0.3 → retourne late_cash directement (court-circuite la pondération)', () => {
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.1);
    const result = assign(
      { status: 'pending', payment_mode: 'cash_relais' },
      { scenarios: ['nominal', 'late_cash'] }
    );
    expect(result).toBe(SCENARIOS.late_cash);
  });

  it('order pending + cash_relais, mais random >= 0.3 → retombe sur la pondération normale', () => {
    // 1er random() pour le court-circuit late_cash (>=0.3 → pas retenu)
    // 2e random() pour la pondération pondérée (renvoie le 1er candidat : nominal)
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.9).mockReturnValueOnce(0.0);
    const result = assign(
      { status: 'pending', payment_mode: 'cash_relais' },
      { scenarios: ['nominal', 'late_cash'] }
    );
    expect(result).toBe(SCENARIOS.nominal);
  });

  it('late_cash absent de la liste activée → court-circuit jamais déclenché même si pending+cash_relais', () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const result = assign(
      { status: 'pending', payment_mode: 'cash_relais' },
      { scenarios: ['nominal', 'cancelled'] }
    );
    // un seul appel random() pour la pondération (pas de check late_cash car absent)
    expect(result).toBe(SCENARIOS.nominal);
    expect(randomSpy).toHaveBeenCalledTimes(1);
  });

  it('order.status non-pending → ignore le court-circuit late_cash même si cash_relais', () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.0);
    assign({ status: 'confirmed', payment_mode: 'cash_relais' }, { scenarios: ['nominal', 'late_cash'] });
    expect(randomSpy).toHaveBeenCalledTimes(1); // pas de check late_cash → 1 seul random pour la pondération
  });

  it('payment_mode différent de cash_relais → ignore le court-circuit late_cash', () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.0);
    assign({ status: 'pending', payment_mode: 'card' }, { scenarios: ['nominal', 'late_cash'] });
    expect(randomSpy).toHaveBeenCalledTimes(1);
  });

  it('pondération : un scénario "happy" (poids 3) est plus représenté qu\'un "fail" (poids 1)', () => {
    // happy=nominal(poids 3), fail=cancelled(poids 1) → totalWeight=4
    // rand proche de 0 → tombe dans la tranche du premier candidat (nominal)
    jest.spyOn(Math, 'random').mockReturnValue(0.01);
    const result = assign({ status: 'confirmed' }, { scenarios: ['nominal', 'cancelled'] });
    expect(result).toBe(SCENARIOS.nominal);
  });

  it('pondération : rand élevé peut sélectionner le scénario "fail" en fin de liste', () => {
    // totalWeight=4 (3+1) ; rand = 0.99*4 = 3.96 → consomme nominal(3) reste 0.96, puis cancelled(1) reste -0.04 <=0
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const result = assign({ status: 'confirmed' }, { scenarios: ['nominal', 'cancelled'] });
    expect(result).toBe(SCENARIOS.cancelled);
  });
});

describe('getNextAction — avancement séquentiel', () => {
  it('scenario inconnu sur le tracked → null', () => {
    expect(getNextAction({ scenario: 'inexistant', currentStep: 0 })).toBeNull();
  });

  it('currentStep au-delà de la longueur des steps → null', () => {
    const tracked = { scenario: 'cancelled', currentStep: SCENARIOS.cancelled.steps.length };
    expect(getNextAction(tracked)).toBeNull();
  });

  it('step non-"wait" → retourne le step tel quel, ne touche pas currentStep', () => {
    // cancelled.steps[1] = { action: 'cancel', ... } (steps[0] est 'wait' ticks:1)
    const tracked = { scenario: 'cancelled', currentStep: 1 };
    const action = getNextAction(tracked);
    expect(action).toEqual(SCENARIOS.cancelled.steps[1]);
    expect(tracked.currentStep).toBe(1);
  });

  it('step "wait" avec ticks par défaut (1) → avance immédiatement vers le step suivant', () => {
    // cancelled.steps[0] = { action:'wait', ticks:1 } → 1er appel: waitCounter 0→1, 1<1 faux → avance
    const tracked = { scenario: 'cancelled', currentStep: 0 };
    const action = getNextAction(tracked);
    expect(action).toEqual(SCENARIOS.cancelled.steps[1]); // a sauté directement à 'cancel'
    expect(tracked.currentStep).toBe(1);
  });

  it('step "wait" ticks > 1 → reste sur le même step tant que le compteur n\'a pas atteint ticks', () => {
    // abandoned.steps[0] = { action:'wait', ticks:5 }
    const tracked = { scenario: 'abandoned', currentStep: 0 };

    const a1 = getNextAction(tracked);
    expect(a1.action).toBe('wait');
    expect(a1.description).toContain('(1/5)');
    expect(tracked.currentStep).toBe(0);

    const a2 = getNextAction(tracked);
    expect(a2.description).toContain('(2/5)');
    expect(tracked.currentStep).toBe(0);
  });

  it('step "wait" ticks > 1 → après le dernier tick, avance au step suivant et réinitialise le compteur', () => {
    const tracked = { scenario: 'abandoned', currentStep: 0 };
    for (let i = 1; i < 5; i++) getNextAction(tracked); // ticks 1..4

    const last = getNextAction(tracked); // 5e tick → avance
    expect(tracked.currentStep).toBe(1);
    expect(tracked._waitCounter).toBe(0);
    expect(last).toEqual(SCENARIOS.abandoned.steps[1]); // log_only final
  });

  it('plusieurs steps "wait" consécutifs (customs_delay) → chacun gère son propre compteur', () => {
    // customs_delay : steps[4] wait ticks:4, steps[6] wait ticks:2 — on saute directement au step 4
    const tracked = { scenario: 'customs_delay', currentStep: 4 };
    for (let i = 0; i < 3; i++) getNextAction(tracked); // 3 ticks sur 4, reste sur step 4
    expect(tracked.currentStep).toBe(4);
    getNextAction(tracked); // 4e tick → avance à step 5 (log_only)
    expect(tracked.currentStep).toBe(5);
  });

  it('tracked.completed n\'affecte pas getNextAction (seulement getChaosAction)', () => {
    const tracked = { scenario: 'cancelled', currentStep: 1, completed: true };
    expect(getNextAction(tracked)).toEqual(SCENARIOS.cancelled.steps[1]);
  });
});

describe('getChaosAction — sélection d\'une action chaos selon le niveau', () => {
  it('tracked.completed → null, sans même consulter Math.random', () => {
    const randomSpy = jest.spyOn(Math, 'random');
    expect(getChaosAction({ completed: true }, 0.9)).toBeNull();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('chaosLevel >= 0.7 → pioche dans le pool complet (peut renvoyer une action "high")', () => {
    // dernier élément de CHAOS_ACTIONS (concurrent_update) est severity "high"
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    const action = getChaosAction({ completed: false }, 0.7);
    expect(action.id).toBe('concurrent_update');
    expect(action.severity).toBe('high');
  });

  it('chaosLevel entre 0.4 et 0.69 → exclut les actions "high"', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999); // dernier élément du pool filtré
    const action = getChaosAction({ completed: false }, 0.5);
    expect(action.severity).not.toBe('high');
  });

  it('chaosLevel < 0.4 → ne pioche que des actions "low"', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    const action = getChaosAction({ completed: false }, 0.1);
    expect(action.severity).toBe('low');
  });

  it('chaosLevel = 0.4 (borne incluse) → traité comme palier moyen (exclut "high")', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    const action = getChaosAction({ completed: false }, 0.4);
    expect(action.severity).not.toBe('high');
  });

  it('chaosLevel = 0 → pool restreint aux actions "low" uniquement, jamais "medium"/"high"', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.0);
    for (let i = 0; i < 5; i++) {
      const action = getChaosAction({ completed: false }, 0);
      expect(action.severity).toBe('low');
    }
  });

  it('chaosLevel élevé, sur plusieurs tirages → ne renvoie jamais une action hors du pool CHAOS_ACTIONS connu', () => {
    const knownIds = [
      'network_delay', 'operator_absent', 'slow_system', 'duplicate_scan',
      'relais_offline', 'power_outage', 'customs_random_check', 'payment_glitch',
      'sms_failure', 'wrong_weight', 'label_error', 'concurrent_update',
    ];
    for (let i = 0; i < 20; i++) {
      const action = getChaosAction({ completed: false }, 0.8);
      expect(knownIds).toContain(action.id);
    }
  });
});
