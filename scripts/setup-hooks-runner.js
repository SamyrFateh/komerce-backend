'use strict';

const { execFileSync } = require('child_process');

if (process.env.CI) process.exit(0);

const windows = process.platform === 'win32';
const command = windows ? 'powershell.exe' : 'bash';
const args = windows
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/setup-hooks.ps1']
  : ['scripts/setup-hooks.sh'];

execFileSync(command, args, { stdio: 'inherit' });
