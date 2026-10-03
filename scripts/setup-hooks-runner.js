'use strict';

/**
 * Installe les hooks Komerce (scripts/setup-hooks.sh|ps1).
 *
 * - `npm install` le lance via `prepare` ;
 * - `ensureInstalled()` est appelé par `agent:context` et `pr:preflight`, car
 *   les conteneurs d'agents arrivent avec des dépendances préinstallées et ne
 *   lancent jamais `prepare` : sans cet appel, aucun hook n'existe chez eux.
 * Jamais en CI.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function installerCommand(platform = process.platform) {
  return platform === 'win32'
    ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/setup-hooks.ps1']]
    : ['bash', ['scripts/setup-hooks.sh']];
}

function install({ stdio = 'inherit', exec = execFileSync, platform = process.platform } = {}) {
  const [command, args] = installerCommand(platform);
  exec(command, args, { cwd: ROOT, stdio });
}

/**
 * Idempotent et silencieux : installe seulement si le pre-push manque.
 * Retourne true si une installation a eu lieu. N'échoue jamais l'appelant.
 */
function ensureInstalled({
  env = process.env,
  hooksDir = path.join(ROOT, '.git', 'hooks'),
  exists = fs.existsSync,
  exec = execFileSync,
  platform = process.platform,
} = {}) {
  if (env.CI || !exists(path.join(ROOT, '.git'))) return false;
  if (exists(path.join(hooksDir, 'pre-push'))) return false;
  try {
    install({ stdio: 'ignore', exec, platform });
    return true;
  } catch {
    return false;
  }
}

if (require.main === module) {
  if (!process.env.CI) install();
}

module.exports = { ensureInstalled, install, installerCommand };
