'use strict';
// Inspect the exact Git index before publishing. Never print a matching credential.
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const files = execFileSync('git',['diff','--cached','--name-only','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
let pairingSecret = '';
try { pairingSecret = JSON.parse(fs.readFileSync('settings.json','utf8')).remote?.token || ''; } catch {}
const denied = /(^|\/)(?:node_modules|cache|edge-profile|browser-profile|graphify-out)(?:\/|$)|(^|\/)(?:settings\.json|\.env(?:\..*)?)$|\.(?:pem|key|pfx|p12|db|sqlite.*|log)$/i;
const credential = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|[a-f0-9]{32}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/;
let failed = false;
for (const file of files) {
  if (denied.test(file) && file !== '.env.example') {console.error(`Local or credential file is staged: ${file}`);failed = true;continue;}
  if (/\.(?:png|woff2|jpg|ico)$/i.test(file)) continue;
  const content = execFileSync('git',['show',`:${file}`],{encoding:'utf8',maxBuffer:8*1024*1024});
  if (credential.test(content) || (pairingSecret.length >= 8 && content.includes(pairingSecret))) {
    console.error(`Possible credential in staged file: ${file}`); failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(`Checked ${files.length} staged files: local settings, browser data and recognizable credentials excluded.`);
