'use strict';
const path = require('path');
const readline = require('readline/promises');
const { writeSecret } = require('../src/private-store');

async function save(value) {
  if (typeof value.token !== 'string' || value.token.length < 40) throw new Error('A TMDB API read token is required.');
  await writeSecret(path.join(__dirname, '..', 'cache', 'private', 'tmdb.json'), {
    token:value.token.trim(), key:typeof value.key === 'string' ? value.key.trim() : ''
  });
  process.stdout.write('TMDB credentials protected for this Windows account.\n');
}

(async () => {
  if (process.stdin.isTTY) {
    const prompt = readline.createInterface({ input:process.stdin, output:process.stdout });
    try {
      const token = await prompt.question('TMDB API read token: ');
      const key = await prompt.question('TMDB API key (optional): ');
      await save({ token, key });
    } finally { prompt.close(); }
    return;
  }
  let body = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    body += chunk;
    if (body.length > 10000) throw new Error('Credential input is too large.');
  }
  await save(JSON.parse(body || '{}'));
})().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
