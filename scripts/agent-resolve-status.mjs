#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BRANCH = 'agent/lane-mobile-renderer';
const REMOTE_REF = `origin/${BRANCH}`;
const FINAL_STATUSES = new Set(['DONE', 'REVIEW', 'BLOCKED']);
const RECOVERY_PRIORITY = [
  'RECOVER_TO_DURABLE',
  'REMOTE_WORK_AHEAD_OF_STATE',
  'IN_PROGRESS',
];

function fail(message, code = 1) {
  console.error(`STATUS_RESOLUTION_FAILED=${message}`);
  process.exit(code);
}

function runGit(root, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.status !== 0 && !allowFailure) {
    const detail = `${result.stderr || ''}${result.stdout || ''}`.trim();
    fail(`git ${args.join(' ')}${detail ? ` — ${detail}` : ''}`);
  }

  return result;
}

function gitText(root, args) {
  return (runGit(root, args).stdout || '').trim();
}

function taskNumber(taskId) {
  const match = /^T-(\d+)$/.exec(taskId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function isRecoverableWorkPath(file) {
  if (file.startsWith('.agent/evidence/')) return true;
  if (file.startsWith('.agent/')) return false;
  if (file.startsWith('docs/')) return false;
  if (file.startsWith('public/boutique/docs/')) return false;
  return true;
}

function parseTaskCommits(root, taskId, remoteRefs) {
  const marker = '@@@COMMIT@@@';
  const result = runGit(root, [
    'log',
    '--regexp-ignore-case',
    `--grep=${taskId}`,
    `--format=${marker}%H%x1f%s`,
    '--name-only',
    ...remoteRefs,
  ]);

  const commits = [];
  let current = null;

  for (const rawLine of (result.stdout || '').split(/\r?\n/)) {
    if (rawLine.startsWith(marker)) {
      if (current) commits.push(current);
      const [sha, subject = ''] = rawLine.slice(marker.length).split('\x1f');
      current = { sha, subject, files: [] };
      continue;
    }

    const file = rawLine.trim();
    if (current && file) current.files.push(file);
  }
  if (current) commits.push(current);

  return commits
    .filter(commit => commit.files.some(isRecoverableWorkPath))
    .map(commit => {
      const onDurable = runGit(
        root,
        ['merge-base', '--is-ancestor', commit.sha, REMOTE_REF],
        { allowFailure: true },
      ).status === 0;
      return { ...commit, on_durable_branch: onDurable };
    });
}

function loadRemoteStates(root) {
  const paths = gitText(root, [
    'ls-tree', '-r', '--name-only', REMOTE_REF, '--', '.agent/state',
  ])
    .split(/\r?\n/)
    .filter(path => /^\.agent\/state\/T-\d+\.json$/.test(path));

  if (!paths.length) fail(`aucun state trouvé sur ${REMOTE_REF}`);

  return paths.map(path => {
    const raw = gitText(root, ['show', `${REMOTE_REF}:${path}`]);
    try {
      return { path, state: JSON.parse(raw) };
    } catch (error) {
      fail(`${path} invalide: ${error.message}`);
    }
  });
}

function effectiveRecord(root, entry, remoteRefs) {
  const { state, path } = entry;
  const taskId = state.task_id;
  if (!taskId) fail(`${path}: task_id absent`);

  const storedStatus = state.status || 'UNKNOWN';
  const commits = FINAL_STATUSES.has(storedStatus)
    ? []
    : parseTaskCommits(root, taskId, remoteRefs);
  const durableWork = commits.filter(commit => commit.on_durable_branch);
  const externalWork = commits.filter(commit => !commit.on_durable_branch);

  let effectiveStatus = storedStatus;
  if (!FINAL_STATUSES.has(storedStatus)) {
    if (externalWork.length > 0 && durableWork.length === 0) {
      effectiveStatus = 'RECOVER_TO_DURABLE';
    } else if (durableWork.length > 0) {
      effectiveStatus = 'REMOTE_WORK_AHEAD_OF_STATE';
    } else if (storedStatus === 'IN_PROGRESS') {
      effectiveStatus = 'IN_PROGRESS';
    } else {
      effectiveStatus = 'READY';
    }
  }

  return {
    task_id: taskId,
    title: state.title || '',
    stored_status: storedStatus,
    effective_status: effectiveStatus,
    depends_on: Array.isArray(state.depends_on) ? state.depends_on : [],
    state_path: path,
    durable_work_commits: durableWork,
    external_work_commits: externalWork,
  };
}

function dependenciesSatisfied(record, recordsById) {
  return record.depends_on.every(taskId => {
    const dependency = recordsById.get(taskId);
    return dependency && ['DONE', 'REVIEW'].includes(dependency.effective_status);
  });
}

function chooseCurrent(records) {
  for (const status of RECOVERY_PRIORITY) {
    const candidates = records
      .filter(record => record.effective_status === status)
      .sort((a, b) => taskNumber(a.task_id) - taskNumber(b.task_id));
    if (candidates.length) return candidates[0];
  }

  const recordsById = new Map(records.map(record => [record.task_id, record]));
  return records
    .filter(record => record.effective_status === 'READY')
    .filter(record => dependenciesSatisfied(record, recordsById))
    .sort((a, b) => taskNumber(a.task_id) - taskNumber(b.task_id))[0] || null;
}

function actionFor(record) {
  if (!record) return 'Aucune tâche exécutable détectée. Examiner uniquement les tâches BLOCKED et les revues humaines.';

  switch (record.effective_status) {
    case 'RECOVER_TO_DURABLE':
      return `Récupérer le travail distant existant de ${record.task_id} vers ${BRANCH} sans le réimplémenter; pousser le travail, vérifier les gates nécessaires, puis reconstruire son state.`;
    case 'REMOTE_WORK_AHEAD_OF_STATE':
      return `Inspecter le travail déjà poussé pour ${record.task_id} sur ${BRANCH}; continuer seulement ce qui manque ou reconstruire les métadonnées si le travail est complet. Ne pas réimplémenter.`;
    case 'IN_PROGRESS':
      return `Reprendre ${record.task_id} depuis son dernier travail distant sur ${BRANCH}; pousser chaque unité avant les métadonnées.`;
    case 'READY':
      return `Démarrer ${record.task_id} sur ${BRANCH} en lisant sa tâche et son state, puis pousser le travail avant les métadonnées.`;
    default:
      return `Examiner ${record.task_id} (${record.effective_status}).`;
  }
}

const root = gitText(process.cwd(), ['rev-parse', '--show-toplevel']);
const branch = gitText(root, ['branch', '--show-current']);
if (branch !== BRANCH) fail(`branche courante ${branch || '(HEAD détaché)'}; attendu ${BRANCH}`);

const localSha = gitText(root, ['rev-parse', 'HEAD']);
const remoteSha = gitText(root, ['rev-parse', REMOTE_REF]);
if (localSha !== remoteSha) fail(`branche non synchronisée: local=${localSha} distant=${remoteSha}`);

const remoteRefs = gitText(root, [
  'for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/agent/',
])
  .split(/\r?\n/)
  .filter(Boolean);
if (!remoteRefs.includes(REMOTE_REF)) remoteRefs.push(REMOTE_REF);

const records = loadRemoteStates(root)
  .map(entry => effectiveRecord(root, entry, remoteRefs))
  .sort((a, b) => taskNumber(a.task_id) - taskNumber(b.task_id));
const current = chooseCurrent(records);

const instructionPath = join(root, '.agent', 'ADDITIONAL-INSTRUCTION.json');
let additionalInstruction = null;
if (existsSync(instructionPath)) {
  try {
    const instruction = JSON.parse(readFileSync(instructionPath, 'utf8'));
    additionalInstruction = typeof instruction.instruction === 'string' && instruction.instruction.trim()
      ? instruction.instruction.trim()
      : null;
  } catch (error) {
    fail(`ADDITIONAL-INSTRUCTION.json invalide: ${error.message}`);
  }
}

const resolved = {
  branch: BRANCH,
  remote_sha: remoteSha,
  current_task: current?.task_id || null,
  effective_status: current?.effective_status || null,
  stored_status: current?.stored_status || null,
  current_action: actionFor(current),
  additional_instruction: additionalInstruction,
  evidence: current ? {
    state_path: current.state_path,
    durable_work_commits: current.durable_work_commits.map(({ sha, subject }) => ({ sha, subject })),
    external_work_commits: current.external_work_commits.map(({ sha, subject }) => ({ sha, subject })),
  } : null,
};

console.log(`BRANCH=${resolved.branch}`);
console.log(`REMOTE_SHA=${resolved.remote_sha}`);
console.log(`CURRENT_TASK=${resolved.current_task || 'NONE'}`);
console.log(`EFFECTIVE_STATUS=${resolved.effective_status || 'NONE'}`);
console.log(`STORED_STATUS=${resolved.stored_status || 'NONE'}`);
console.log(`CURRENT_ACTION=${resolved.current_action}`);
if (resolved.additional_instruction) {
  console.log(`ADDITIONAL_INSTRUCTION=${resolved.additional_instruction}`);
}
console.log(`RESOLVED_STATUS_JSON=${JSON.stringify(resolved)}`);
console.log('STATUS_RESOLVED=1');