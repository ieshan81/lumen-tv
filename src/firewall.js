'use strict';
const { execFile } = require('child_process');
const path = require('path');
const { ROOT } = require('./config');

const SCRIPT = path.join(ROOT, 'scripts', 'firewall.ps1');

/** True if Windows Firewall would drop phones trying to reach the remote page. */
function isBlocked(port) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, 'check', '-Port', String(port), '-Program', process.execPath],
      { windowsHide: true, timeout: 60000 },
      (err, stdout) => resolve(!err && stdout.trim() === 'blocked')
    );
  });
}

/** Opens the one-time fix in an administrator window. Windows shows its own approval prompt first. */
function openFix(port) {
  const inner = `-NoProfile -ExecutionPolicy Bypass -File "${SCRIPT}" fix -Port ${Number(port)}`;
  execFile(
    'powershell.exe',
    ['-NoProfile', '-Command', `Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList '${inner.replace(/'/g, "''")}'`],
    { windowsHide: true },
    () => {}
  );
}

module.exports = { isBlocked, openFix };
