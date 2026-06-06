import { spawnSync } from 'node:child_process';

const syntaxTargets = [
  'server/index.js',
  'server/store.js',
  'server/telegram.js',
  'server/ai.js',
  'public/app.js'
];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

for (const file of syntaxTargets) {
  run(process.execPath, ['--check', file]);
}

if (process.platform === 'win32') {
  run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd audit --audit-level=critical']);
} else {
  run('npm', ['audit', '--audit-level=critical']);
}

console.log('Project check passed.');
