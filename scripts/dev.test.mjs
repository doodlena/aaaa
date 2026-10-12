import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { DEFAULT_DB_URL, dbTarget, devDbUrl, envFileFor, isStale, parseEnv } from './dev.mjs';

test('parseEnv reads values, quotes, and inline comments', () => {
  const env = parseEnv([
    '# comment',
    'FOODACCESS_ENVIRONMENT=development          # development | test | production',
    'FOODACCESS_CORS_ORIGINS=["http://localhost:5173"]',
    'QUOTED="a # b"',
    'export EXPORTED=yes',
    'not a setting',
  ].join('\r\n'));
  assert.deepEqual(env, {
    FOODACCESS_ENVIRONMENT: 'development',
    FOODACCESS_CORS_ORIGINS: '["http://localhost:5173"]',
    QUOTED: 'a # b',
    EXPORTED: 'yes',
  });
});

test('dbTarget reads the default URL without credentials', () => {
  assert.deepEqual(dbTarget(DEFAULT_DB_URL), {
    host: 'localhost', port: 5433, user: '', password: '', database: 'foodaccess', local: true,
  });
});

test('dbTarget decodes credentials, defaults the port, and recognises remote hosts', () => {
  const t = dbTarget('postgresql+psycopg://me:p%40ss@db.example.org/foodaccess');
  assert.equal(t.user, 'me');
  assert.equal(t.password, 'p@ss');
  assert.equal(t.port, 5432);
  assert.equal(t.local, false);
});

test('devDbUrl round-trips through dbTarget on the requested port', () => {
  const t = dbTarget(devDbUrl(5544));
  assert.equal(t.port, 5544);
  assert.equal(t.local, true);
  assert.equal(t.user, 'foodaccess');
});

test('envFileFor replaces only the database URL line', () => {
  const example = 'A=1\nFOODACCESS_DATABASE_URL=postgresql+psycopg://localhost:5433/foodaccess\nB=2\n';
  const out = envFileFor(example, devDbUrl(5433));
  assert.equal(out, `A=1\nFOODACCESS_DATABASE_URL=${devDbUrl(5433)}\nB=2\n`);
  assert.equal(parseEnv(envFileFor('A=1\n', 'x://y')).FOODACCESS_DATABASE_URL, 'x://y');
});

test('isStale is true for a missing or older target', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foodaccess-dev-'));
  const source = path.join(dir, 'source');
  const target = path.join(dir, 'target');
  writeFileSync(source, '');
  assert.equal(isStale(target, source), true);
  writeFileSync(target, '');
  utimesSync(source, new Date(2000), new Date(2000));
  assert.equal(isStale(target, source), false);
  utimesSync(source, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
  assert.equal(isStale(target, source), true);
});
