#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const die = message => { console.error(`ERREUR: ${message}`); process.exit(1); };
const norm = value => String(value).replaceAll('\\', '/').replace(/^\.\//, '');
const slug = value => String(value || 'subject')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

function root() {
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, '.agent', 'MANIFEST.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('.agent introuvable');
    dir = parent;
  }
  return dir;
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function run(repo, args, options = {}) {
  return spawnSync(args[0], args.slice(1), {
    cwd: repo,
    encoding: 'utf8',
    shell: false,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024
  });
}

function ok(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label}: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

const git = (repo, ...args) => run(repo, ['git', ...args]);
const branch = repo => ok(git(repo, 'branch', '--show-current'), 'git branch');
const head = repo => ok(git(repo, 'rev-parse', 'HEAD'), 'git rev-parse');

function parseArgs() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith('--')) continue;
    const key = args[index].slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { command, options };
}

function required(options, key) {
  if (!options[key] || options[key] === true) throw new Error(`Option obligatoire: --${key}`);
  return String(options[key]);
}

function taskPaths(repo, taskId) {
  return {
    task: path.join(repo, '.agent', 'tasks', `${taskId}.md`),
    state: path.join(repo, '.agent', 'state', `${taskId}.json`),
    worklog: path.join(repo, '.agent', 'worklogs', `${taskId}.md`),
    handoff: path.join(repo, '.agent', 'handoffs', `${taskId}.md`),
    evidence: path.join(repo, '.agent', 'evidence', taskId),
    arbitration: path.join(repo, '.agent', 'arbitrations', `${taskId}.md`)
  };
}

function lanePaths(repo, lane) {
  return {
    state: path.join(repo, '.agent', 'lanes', `${lane}.json`),
    handoff: path.join(repo, '.agent', 'handoffs', `${lane}.md`)
  };
}

function states(repo) {
  return fs.readdirSync(path.join(repo, '.agent', 'state'))
    .filter(name => /^T-\d{3}\.json$/.test(name))
    .map(name => json(path.join(repo, '.agent', 'state', name)))
    .sort((a, b) => a.task_id.localeCompare(b.task_id));
}

function depsDone(repo, state) {
  return (state.depends_on || []).every(taskId => json(taskPaths(repo, taskId).state).status === 'DONE');
}

function laneOf(state) {
  if (!state.parallel_lane) throw new Error(`${state.task_id} sans parallel_lane`);
  return state.parallel_lane;
}

function laneBranch(state) {
  return `agent/${slug(laneOf(state))}`;
}

function laneTasks(repo, lane) {
  return states(repo).filter(state => laneOf(state) === lane);
}

function nextReadyInLane(repo, lane) {
  return laneTasks(repo, lane).find(state => state.status === 'READY' && depsDone(repo, state));
}

function nextReady(repo) {
  const manifest = json(path.join(repo, '.agent', 'MANIFEST.json'));
  const all = states(repo);
  const preferred = all.find(state => state.task_id === manifest.next_ready_task);
  if (preferred?.status === 'READY' && depsDone(repo, preferred)) return preferred;
  return all.find(state => state.status === 'READY' && depsDone(repo, state));
}

function dirty(repo) {
  const result = run(repo, ['git', 'status', '--porcelain=v1', '-uall']);
  if (result.status !== 0) throw new Error(`git status: ${(result.stderr || result.stdout || '').trim()}`);
  const output = (result.stdout || '').replace(/\r?\n$/, '');
  if (!output) return [];
  return output.split(/\r?\n/).map(line => norm(line.slice(3).trim()));
}

function audit(repo, action, state, actor, details = '') {
  const file = path.join(repo, '.agent', 'audit.ndjson');
  fs.appendFileSync(file, `${JSON.stringify({
    at: new Date().toISOString(),
    action,
    task: state.task_id,
    lane: laneOf(state),
    agent: actor,
    branch: state.branch,
    details
  })}\n`);
}

function dashboard(repo) {
  const lines = [
    '# STATUS — Chantier PDP',
    '',
    '> Généré par `scripts/agent.mjs`.',
    '',
    '| ID | Lane | Statut | Agent | Branche | Prochaine action |',
    '|---|---|---|---|---|---|'
  ];
  for (const state of states(repo)) {
    lines.push(`| ${state.task_id} | ${state.parallel_lane || '—'} | ${state.status} | ${state.agent || '—'} | ${state.branch || '—'} | ${(state.next_action || '—').replaceAll('|', '/')} |`);
  }
  fs.writeFileSync(path.join(repo, '.agent', 'STATUS.md'), `${lines.join('\n')}\n`);
}

function log(repo, state, event, message, next = state.next_action) {
  const paths = taskPaths(repo, state.task_id);
  fs.mkdirSync(path.dirname(paths.worklog), { recursive: true });
  if (!fs.existsSync(paths.worklog)) {
    fs.writeFileSync(paths.worklog, [
      `# WORKLOG — ${state.task_id}`,
      '',
      `- Tâche : ${state.title}`,
      `- Lane : ${laneOf(state)}`,
      `- Branche : ${state.branch}`,
      ''
    ].join('\n'));
  }
  fs.appendFileSync(paths.worklog, [
    `## ${new Date().toISOString()} — ${event}`,
    '',
    `- Résultat : ${String(message).replace(/\r?\n/g, ' ')}`,
    `- Commit : ${head(repo)}`,
    `- Prochaine action : ${next || '—'}`,
    ''
  ].join('\n') + '\n');
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateSources(repo, taskId) {
  const file = path.join(repo, '.agent', 'SOURCES.json');
  if (!fs.existsSync(file)) return;
  const requiredSources = (json(file).sources || []).filter(source =>
    !(source.required_for || []).length || source.required_for.includes(taskId)
  );
  for (const source of requiredSources) {
    const sourcePath = path.join(repo, norm(source.path));
    if (!fs.existsSync(sourcePath)) throw new Error(`Source absente: ${source.path}`);
    if (source.sha256 && checksum(sourcePath) !== source.sha256.toLowerCase()) {
      throw new Error(`Checksum source invalide: ${source.path}`);
    }
  }
}

function active(repo) {
  const currentBranch = branch(repo);
  const activeStates = states(repo).filter(state =>
    state.branch === currentBranch &&
    ['IN_PROGRESS', 'AWAITING_DECISION', 'BLOCKED'].includes(state.status)
  );
  if (activeStates.length !== 1) throw new Error(`Tâche active introuvable sur ${currentBranch}`);
  return activeStates[0];
}

function push(repo, state, message) {
  for (const file of dirty(repo)) ok(git(repo, 'add', '-A', '--', file), `git add ${file}`);
  if (git(repo, 'diff', '--cached', '--quiet').status !== 0) {
    ok(git(repo, 'commit', '-m', message), 'git commit');
  }
  ok(git(repo, 'push', '-u', 'origin', state.branch), 'git push');
  return head(repo);
}

function switchToLane(repo, state, baseBranch) {
  const subjectBranch = laneBranch(state);
  ok(git(repo, 'fetch', 'origin', '--prune'), 'git fetch');
  const exists = git(repo, 'ls-remote', '--exit-code', '--heads', 'origin', subjectBranch).status === 0;
  if (exists) {
    ok(git(repo, 'switch', '-C', subjectBranch, `origin/${subjectBranch}`), 'git switch');
    ok(git(repo, 'pull', '--ff-only', 'origin', subjectBranch), 'git pull');
  } else {
    ok(git(repo, 'switch', '-C', subjectBranch, `origin/${baseBranch}`), 'git switch');
  }
  return { subjectBranch, exists };
}

function startTask(repo, state, agent, subjectBranch, message = 'START') {
  state.status = 'IN_PROGRESS';
  state.agent = agent;
  state.branch = subjectBranch;
  state.started_at = state.started_at || new Date().toISOString();
  state.resumed_at = new Date().toISOString();
  state.base_commit = state.base_commit || head(repo);
  state.next_action = 'Exécuter une petite unité cohérente puis save.';
  put(taskPaths(repo, state.task_id).state, state);
  log(repo, state, message, `Tâche active dans ${laneOf(state)}.`);
  audit(repo, message, state, agent);
  dashboard(repo);
  return push(repo, state, `chore(${state.task_id.toLowerCase()}): start in ${slug(laneOf(state))}`);
}

function start(repo, options) {
  if (dirty(repo).length) throw new Error('Working tree non propre');
  ok(git(repo, 'ls-remote', 'origin', 'HEAD'), 'Accès GitHub');

  const manifest = json(path.join(repo, '.agent', 'MANIFEST.json'));
  const initial = options.task ? json(taskPaths(repo, options.task).state) : nextReady(repo);
  if (!initial) throw new Error('Aucune tâche READY');
  const agent = required(options, 'agent');
  const lane = laneOf(initial);

  const { subjectBranch } = switchToLane(repo, initial, manifest.base_branch || 'main');
  const selected = options.task
    ? json(taskPaths(repo, options.task).state)
    : nextReadyInLane(repo, lane);

  if (!selected) throw new Error(`Aucune tâche READY dans ${lane}`);
  if (selected.status !== 'READY' || !depsDone(repo, selected)) throw new Error('Tâche non exécutable');

  validateSources(repo, selected.task_id);
  const commit = startTask(repo, selected, agent, subjectBranch);
  console.log(`TASK=${selected.task_id}\nLANE=${lane}\nBRANCH=${subjectBranch}\nPUSH=${commit}`);
}

function save(repo, options) {
  const state = active(repo);
  if (state.status !== 'IN_PROGRESS') throw new Error('Tâche non IN_PROGRESS');
  const message = required(options, 'message');
  state.next_action = options['next-action'] || 'Continuer dans la même lane.';
  state.last_checkpoint_at = new Date().toISOString();
  put(taskPaths(repo, state.task_id).state, state);
  log(repo, state, 'CHECKPOINT', message);
  audit(repo, 'CHECKPOINT', state, state.agent, message);
  dashboard(repo);
  console.log(`PUSH=${push(repo, state, `wip(${state.task_id.toLowerCase()}): ${message}`)}`);
}

function runGate(repo, command) {
  const result = spawnSync(command, {
    cwd: repo,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });
  return {
    command,
    result: result.status === 0 ? 'PASS' : 'FAIL',
    exit_code: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim()
  };
}

function openPr(repo, state) {
  if (run(repo, ['gh', '--version']).status !== 0 || run(repo, ['gh', 'auth', 'status']).status !== 0) return null;
  const current = run(repo, ['gh', 'pr', 'view', state.branch, '--json', 'url', '--jq', '.url']);
  if (current.status === 0 && current.stdout.trim()) return current.stdout.trim();
  const lane = laneOf(state);
  const result = run(repo, [
    'gh', 'pr', 'create', '--draft',
    '--base', 'main',
    '--head', state.branch,
    '--title', `${lane} — livraison du sujet`,
    '--body', state.summary || `Livraison complète de ${lane}`
  ]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function writeLaneReview(repo, state, summary) {
  const lane = laneOf(state);
  const paths = lanePaths(repo, lane);
  const completed = laneTasks(repo, lane).filter(item => item.status === 'DONE').map(item => item.task_id);
  const laneState = {
    lane,
    branch: state.branch,
    status: 'REVIEW',
    tasks_done: completed,
    last_task: state.task_id,
    summary,
    updated_at: new Date().toISOString()
  };
  put(paths.state, laneState);
  fs.writeFileSync(paths.handoff, [
    `# HANDOFF — ${lane}`,
    '',
    `- Statut : REVIEW`,
    `- Branche : ${state.branch}`,
    `- Tâches terminées : ${completed.join(', ') || '—'}`,
    `- Résumé : ${summary}`,
    '- Prochaine action : revue humaine de la branche complète puis merge dans main.',
    ''
  ].join('\n'));
}

function finish(repo, options) {
  const state = active(repo);
  const summary = required(options, 'summary');
  if (state.status !== 'IN_PROGRESS') throw new Error('Tâche non IN_PROGRESS');

  const results = (state.gates || []).map(command => runGate(repo, command));
  const failed = results.some(result => result.result === 'FAIL');
  const paths = taskPaths(repo, state.task_id);
  fs.mkdirSync(paths.evidence, { recursive: true });
  put(path.join(paths.evidence, 'agent-gates.json'), results);

  state.finished_at = new Date().toISOString();
  state.summary = summary;
  state.gate_results = results;
  state.blocking_reason = failed ? 'Gate en échec' : null;

  if (failed) {
    state.status = 'BLOCKED';
    state.next_action = 'Corriger les gates dans la même branche de lane.';
    put(paths.state, state);
    log(repo, state, 'BLOCKED', summary);
    audit(repo, 'BLOCKED', state, state.agent, 'Gate en échec');
    dashboard(repo);
    const commit = push(repo, state, `wip(${state.task_id.toLowerCase()}): gates failed`);
    console.log(`Tâche: ${state.task_id}\nStatut: BLOCKED\nBranche: ${state.branch}\nDernier commit: ${commit}\nPR: non créée\nGates: ${results.map(result => result.result).join('/')}\nRésumé: ${summary}`);
    return;
  }

  state.status = 'DONE';
  state.next_action = 'Passer automatiquement à la tâche suivante de la même lane.';
  put(paths.state, state);
  log(repo, state, 'DONE', summary);
  audit(repo, 'DONE_IN_LANE', state, state.agent, summary);
  dashboard(repo);
  let commit = push(repo, state, `feat(${state.task_id.toLowerCase()}): ${state.title}`);

  const next = nextReadyInLane(repo, laneOf(state));
  if (next) {
    commit = startTask(repo, next, state.agent, state.branch, 'AUTO_START');
    console.log(`Tâche: ${state.task_id}\nStatut: DONE\nBranche: ${state.branch}\nDernier commit: ${commit}\nPR: non créée\nGates: ${results.map(result => result.result).join('/')}\nRésumé: ${summary}; poursuite automatique sur ${next.task_id}`);
    return;
  }

  state.next_action = 'Revue humaine de la branche complète puis merge.';
  put(paths.state, state);
  writeLaneReview(repo, state, summary);
  dashboard(repo);
  commit = push(repo, state, `chore(${slug(laneOf(state))}): ready for review`);
  const url = openPr(repo, state);
  console.log(`Tâche: ${state.task_id}\nStatut: REVIEW\nBranche: ${state.branch}\nDernier commit: ${commit}\nPR: ${url || 'non créée'}\nGates: ${results.map(result => result.result).join('/') || 'Aucun'}\nRésumé: ${summary}`);
}

function block(repo, options) {
  const state = active(repo);
  const reason = required(options, 'reason');
  const next = required(options, 'next-action');
  state.status = 'BLOCKED';
  state.blocking_reason = reason;
  state.next_action = next;
  put(taskPaths(repo, state.task_id).state, state);
  log(repo, state, 'BLOCKED', reason, next);
  audit(repo, 'BLOCKED', state, state.agent, reason);
  dashboard(repo);
  console.log(`PUSH=${push(repo, state, `wip(${state.task_id.toLowerCase()}): blocked`)}`);
}

function resume(repo, options) {
  const taskId = required(options, 'task');
  const agent = required(options, 'agent');
  const initial = json(taskPaths(repo, taskId).state);
  const subjectBranch = laneBranch(initial);
  ok(git(repo, 'fetch', 'origin', '--prune'), 'git fetch');
  ok(git(repo, 'switch', '-C', subjectBranch, `origin/${subjectBranch}`), 'git switch');
  ok(git(repo, 'pull', '--ff-only', 'origin', subjectBranch), 'git pull');
  const state = json(taskPaths(repo, taskId).state);
  if (!['IN_PROGRESS', 'BLOCKED'].includes(state.status)) throw new Error('Tâche non reprenable');
  state.status = 'IN_PROGRESS';
  state.agent = agent;
  state.branch = subjectBranch;
  state.resumed_at = new Date().toISOString();
  put(taskPaths(repo, taskId).state, state);
  log(repo, state, 'RESUME', 'Reprise depuis la branche de lane.');
  audit(repo, 'RESUMED', state, agent);
  dashboard(repo);
  console.log(`PUSH=${push(repo, state, `chore(${taskId.toLowerCase()}): resume by ${agent}`)}`);
}

function arbitrate(repo, options) {
  const state = active(repo);
  const question = required(options, 'question');
  const choices = required(options, 'options').split('|').map(value => value.trim()).filter(Boolean);
  const recommendation = required(options, 'recommendation');
  const context = required(options, 'context');
  const next = required(options, 'next-action');
  if (choices.length < 2 || choices.length > 3) throw new Error('2 ou 3 options requises');

  state.status = 'AWAITING_DECISION';
  state.arbitration = {
    question,
    options: choices,
    recommendation,
    context,
    requested_at: new Date().toISOString()
  };
  state.next_action = `Après décision: ${next}`;
  const paths = taskPaths(repo, state.task_id);
  fs.mkdirSync(path.dirname(paths.arbitration), { recursive: true });
  fs.writeFileSync(paths.arbitration, [
    `# ARBITRAGE — ${state.task_id}`,
    '',
    '## Décision attendue',
    question,
    '',
    '## Faits',
    context,
    '',
    '## Options',
    ...choices.map((choice, index) => `${index + 1}. ${choice}`),
    '',
    '## Recommandation',
    recommendation,
    '',
    '## Décision',
    '_En attente._',
    ''
  ].join('\n'));
  put(paths.state, state);
  log(repo, state, 'ARBITRATION', question, state.next_action);
  audit(repo, 'ARBITRATION_REQUIRED', state, state.agent, question);
  dashboard(repo);
  const commit = push(repo, state, `chore(${state.task_id.toLowerCase()}): request arbitration`);
  console.log(`Tâche: ${state.task_id}\nStatut: AWAITING_DECISION\nBranche: ${state.branch}\nDernier commit: ${commit}\nPR: non créée\nDécision attendue: ${question}\nOptions: ${choices.join(' | ')}\nRecommandation: ${recommendation}`);
}

function doctor(repo) {
  const manifest = json(path.join(repo, '.agent', 'MANIFEST.json'));
  ok(git(repo, 'rev-parse', '--is-inside-work-tree'), 'Git');
  ok(git(repo, 'ls-remote', 'origin', 'HEAD'), 'Origin');
  validateSources(repo);
  console.log(`Gouvernance: ${manifest.governance_version}\nRuntime: ${manifest.runtime}\nBranch model: ${manifest.branch_model}\nMode: ${manifest.execution_mode}\nDiagnostic: PASS`);
}

function status(repo) {
  dashboard(repo);
  console.log(fs.readFileSync(path.join(repo, '.agent', 'STATUS.md'), 'utf8'));
}

function help() {
  console.log('node scripts/agent.mjs start|save|finish|block|resume|arbitrate|doctor|status');
}

try {
  const repo = root();
  const { command, options } = parseArgs();
  const commands = { start, save, finish, block, resume, arbitrate, doctor, status };
  (commands[command] || help)(repo, options);
} catch (error) {
  die(error.message || String(error));
}
