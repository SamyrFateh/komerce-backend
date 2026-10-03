'use strict';

const fs = require('fs');
const path = require('path');
const handoff = require('../../scripts/lib/agent-context-handoff');

const AGENTS = [
  '# AGENTS', '## 0.1. Mode', 'Règle dette : ne jamais introduire de bypass.', '## 8. Règles',
  '', '- Statuts : machine.', '- Couverture : si tu touches', '  un fichier, 100 %.', '## 9. Divergence', '', 'Ne pas corriger silencieusement.',
].join('\n');
const pack = { pack: 'authz', feature: 'widgets', card: 'features/widgets.feature.js', invariants: ['inv'], otherInvariants: 0, tests: [] };
const impactLib = require('../../scripts/lib/agent-context-impact');
const impact = impactLib.fileImpact(impactLib.indexSources({}), 'routes/w.js', { feature: 'widgets', tests: null, migration: null });

describe('agent-context-handoff', () => {
  test('règles extraites d’AGENTS.md : dette, §8 (lignes de continuation jointes), §9', () => {
    expect(handoff.rulesFromAgents(AGENTS)).toEqual([
      'Dette : ne jamais introduire de bypass.',
      'Statuts : machine.',
      'Couverture : si tu touches un fichier, 100 %.',
      'Ne pas corriger silencieusement.',
    ]);
  });

  test('AGENTS.md réel : §8 extrait (garde contre la dérive de structure)', () => {
    const rules = handoff.rulesFromAgents(fs.readFileSync(path.resolve(__dirname, '../../AGENTS.md'), 'utf8'));
    expect(rules[0]).toMatch(/^Dette : /);
    expect(rules.some(r => /order-status-machine/.test(r))).toBe(true);
    expect(rules.some(r => /probe non-mutant défini au §7/.test(r))).toBe(true);
    expect(rules.length).toBeGreaterThanOrEqual(5);
  });

  test('brief : mission, règles, pack et impact sans ligne budget intermédiaire, définition de fini, budget final', () => {
    const out = handoff.renderHandoff({ task: 'ajouter X', packs: [pack], impacts: [impact], agentsMd: AGENTS });
    expect(out.startsWith('MISSION KOMERCE : ajouter X')).toBe(true);
    expect(out).toContain('RÈGLES NON NÉGOCIABLES (4)');
    expect(out).toContain('PACK authz · feature widgets');
    expect(out).toContain('IMPACT routes/w.js');
    expect(out).toContain(`DÉFINITION DE FINI (${handoff.DONE.length})`);
    expect(out).toContain('git push --dry-run --force --porcelain origin HEAD:refs/heads/wip/capability-probe');
    expect(out).toContain('poursuivre comme agent d’exécution');
    expect(out.match(/budget: /g)).toHaveLength(1);
    expect(out).toMatch(/budget: \d+ chars ≈ \d+ tokens$/);
  });

  test('sans tâche ni impacts ; AGENTS.md sans §8 refusé', () => {
    expect(handoff.renderHandoff({ packs: [pack], agentsMd: AGENTS }).split('\n')[0]).toBe('MISSION KOMERCE');
    expect(() => handoff.renderHandoff({ packs: [pack], agentsMd: '# vide' })).toThrow(/§8/);
    expect(handoff.rulesFromAgents('## 8. R\n- a\n')).toEqual(['a']);
  });
});
