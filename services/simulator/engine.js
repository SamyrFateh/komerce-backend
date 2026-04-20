/**
 * Simulator Engine v2 — moteur autonome avec setInterval
 * Tourne dans le process Railway, piloté via API admin
 *
 * v2: Chaos actions impactantes (duplicate_scan, desync, waits, incidents)
 */
'use strict';

const db = require('../../db');
const scenarios = require('./scenarios');
const advancer = require('./state-advancer');
const journal = require('./journal');

let running = false;
let intervalId = null;
let config = {};
let tickCount = 0;
const trackedOrders = new Map();

async function start(cfg) {
  if (running) throw new Error('Simulation déjà en cours — arrêtez d\'abord');

  config = {
    cadence_minutes: cfg.cadence_minutes || 3,
    max_orders: cfg.max_orders || 20,
    chaos_level: cfg.chaos_level || 0.1,
    scenarios: cfg.scenarios || ['nominal', 'abandoned', 'cancelled'],
  };

  global.__SIMULATION_ACTIVE = true;
  running = true;
  tickCount = 0;
  trackedOrders.clear();
  journal.clear();

  // Build scenario stats for journal
  const scenarioNames = config.scenarios.map(s => {
    const sc = scenarios.SCENARIOS[s];
    return sc ? (sc.icon || '') + ' ' + s : s;
  }).join(', ');

  journal.log(null, null, null,
    '🚀 Simulation démarrée — cadence ' + config.cadence_minutes + 'min, max ' +
    config.max_orders + ' cmds, chaos ' + (config.chaos_level * 100) + '% — scénarios: ' + scenarioNames);

  await enrollOrders();
  await tick();

  intervalId = setInterval(async () => {
    try { await tick(); } catch(e) { console.error('[SIM] Tick error:', e.message); }
  }, config.cadence_minutes * 60 * 1000);

  return getStatus();
}

async function stop() {
  running = false;
  global.__SIMULATION_ACTIVE = false;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }

  // Stats summary
  const stats = getStats();
  journal.log(null, null, null,
    '⏹️ Simulation arrêtée — ' + tickCount + ' ticks, ' + trackedOrders.size + ' commandes, ' +
    stats.completed + ' terminées, ' + stats.chaos_events + ' chaos');

  return getStatus();
}

async function enrollOrders() {
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.reference, o.status, o.payment_mode, o.payment_status
      FROM orders o
      WHERE o.status NOT IN ('collected', 'cancelled', 'refunded')
      ORDER BY o.created_at ASC
      LIMIT $1
    `, [config.max_orders]);

    for (const order of rows) {
      if (trackedOrders.has(order.id)) continue;

      const scenario = scenarios.assign(order, config);

      // Find starting step based on current status
      let startStep = 0;
      const statusOrder = ['pending', 'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available'];
      const currentIdx = statusOrder.indexOf(order.status);

      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (step.targetStatus) {
          const targetIdx = statusOrder.indexOf(step.targetStatus);
          if (targetIdx >= 0 && targetIdx <= currentIdx) {
            startStep = i + 1;
          }
        }
      }

      trackedOrders.set(order.id, {
        ref: order.reference,
        scenario: scenario.name,
        currentStep: startStep,
        currentStatus: order.status,
        payment_mode: order.payment_mode,
        payment_status: order.payment_status,
        completed: false,
        errors: [],
        _waitCounter: 0,
        _chaosWait: 0,
        _chaosCount: 0,
      });

      journal.log(order.id, order.reference, scenario.name,
        '📋 Enrollée — ' + order.status + ' (step ' + startStep + '/' + scenario.steps.length + ')');
    }
  } catch(e) {
    journal.log(null, null, null, '❌ Erreur enrollment: ' + e.message, false);
  }
}

async function tick() {
  if (!running) return;
  tickCount++;
  journal.log(null, null, null, '═══ Tick #' + tickCount + ' ═══');

  await enrollOrders();

  for (const [orderId, tracked] of trackedOrders) {
    if (tracked.completed) continue;

    try {
      const nextAction = scenarios.getNextAction(tracked);

      if (!nextAction) {
        tracked.completed = true;
        journal.log(orderId, tracked.ref, tracked.scenario, '✅ Scénario terminé');
        continue;
      }

      // ── Chaos v2: impactful actions ──
      if (config.chaos_level > 0 && Math.random() < config.chaos_level &&
          nextAction.action !== 'wait' && nextAction.action !== 'log_only') {
        const chaos = scenarios.getChaosAction(tracked, config.chaos_level);
        if (chaos) {
          tracked._chaosCount++;

          // Execute chaos impact (v2: actually does something)
          if (advancer.executeChaosImpact) {
            try {
              const impact = await advancer.executeChaosImpact(orderId, tracked, chaos);
              const severityIcon = chaos.severity === 'high' ? '🔴' : chaos.severity === 'medium' ? '🟡' : '⚪';
              journal.log(orderId, tracked.ref, tracked.scenario,
                '🎲 ' + severityIcon + ' ' + (impact.message || chaos.description), true);
            } catch(ce) {
              journal.log(orderId, tracked.ref, tracked.scenario,
                '🎲 ' + chaos.description + ' (impact error: ' + ce.message + ')', false);
            }
          } else {
            journal.log(orderId, tracked.ref, tracked.scenario, '🎲 ' + chaos.description);
          }
          continue;
        }
      }

      // ── Execute normal action ──
      const result = await advancer.execute(orderId, tracked, nextAction);

      if (result.success) {
        if (nextAction.action !== 'wait') tracked.currentStep++;
        if (result.to) tracked.currentStatus = result.to;

        journal.log(orderId, tracked.ref, tracked.scenario,
          (nextAction.action === 'wait' ? '⏳ ' : '✅ ') + nextAction.description +
          (result.from !== result.to ? ' (' + result.from + ' → ' + result.to + ')' : ''),
          true);
      } else {
        tracked.errors.push(result.error);
        journal.log(orderId, tracked.ref, tracked.scenario,
          '❌ ' + nextAction.description + ' — ' + result.error, false);
      }

      // Check terminal
      if (['collected', 'cancelled', 'refunded'].includes(result.to)) {
        tracked.completed = true;
      }

    } catch(e) {
      tracked.errors.push(e.message);
      journal.log(orderId, tracked.ref, tracked.scenario, '💥 ' + e.message, false);
    }
  }
}

function getStats() {
  let transitions_ok = 0, errors = 0, completed = 0, chaos_events = 0;
  const scenarioBreakdown = {};

  for (const [, t] of trackedOrders) {
    if (t.completed) completed++;
    errors += t.errors.length;
    chaos_events += (t._chaosCount || 0);

    // Track per-scenario stats
    if (!scenarioBreakdown[t.scenario]) {
      scenarioBreakdown[t.scenario] = { total: 0, completed: 0, errors: 0, chaos: 0 };
    }
    scenarioBreakdown[t.scenario].total++;
    if (t.completed) scenarioBreakdown[t.scenario].completed++;
    scenarioBreakdown[t.scenario].errors += t.errors.length;
    scenarioBreakdown[t.scenario].chaos += (t._chaosCount || 0);
  }

  transitions_ok = journal.countSuccess();
  chaos_events = Math.max(chaos_events, journal.countChaos());

  return { transitions_ok, errors, completed, chaos_events, scenarioBreakdown };
}

function getStatus() {
  const stats = getStats();

  return {
    running,
    tick_count: tickCount,
    orders_tracked: trackedOrders.size,
    config: running ? config : null,
    stats,
    recent_journal: journal.getRecent(30),
    // v2: available scenarios list for UI
    available_scenarios: Object.entries(scenarios.SCENARIOS).map(([key, s]) => ({
      key,
      icon: s.icon || '',
      name: s.name,
      category: s.category || 'happy',
      description: s.description,
      steps: s.steps.length,
    })),
  };
}

module.exports = { start, stop, getStatus };
