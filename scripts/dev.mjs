#!/usr/bin/env node
// One-command local launcher: `npm start` (see the root package.json). Node standard library only.
// It prepares .venv and frontend/node_modules, makes sure a PostGIS database is reachable (starting a local Docker
// container when none is), runs `foodaccess bootstrap`, then runs the API (:8000) and the Vite dev server (:5173).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const WINDOWS = process.platform === 'win32';
const VENV_PYTHON = path.join(ROOT, '.venv', WINDOWS ? 'Scripts' : 'bin', WINDOWS ? 'python.exe' : 'python');

const API_URL = 'http://localhost:8000';
const WEB_URL = 'http://localhost:5173';
export const DEFAULT_DB_URL = 'postgresql+psycopg://localhost:5433/foodaccess'; // same default as backend/app/config.py

// Development-only database container. The port is published on 127.0.0.1 only, so the fixed password is not
// reachable from the network. Never use these credentials for a deployed database (see docker-compose.yml for that).
const DB_CONTAINER = 'foodaccess-dev-db';
const DB_VOLUME = 'foodaccess-dev-pgdata';
const DB_IMAGE = process.env.FOODACCESS_DEV_DB_IMAGE || 'postgis/postgis:17-3.5';
const DB_USER = 'foodaccess';
const DB_PASSWORD = 'foodaccess';
const DEMO_ADMIN = 'demo-admin@example.org';

/** Minimal .env reader: KEY=value lines, optional quotes, `#` comments. Enough for the keys this script needs. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = value.match(/^(['"])(.*?)\1/);
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
    out[m[1]] = value;
  }
  return out;
}

/** Host, port, and credentials of a SQLAlchemy PostgreSQL URL. */
export function dbTarget(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, '') || 'localhost';
  return {
    host,
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    local: ['localhost', '127.0.0.1', '::1'].includes(host),
  };
}

export function devDbUrl(port) {
  return `postgresql+psycopg://${DB_USER}:${DB_PASSWORD}@localhost:${port}/foodaccess`;
}

/** .env.example with the database URL replaced, so a first launch gets a working .env. */
export function envFileFor(exampleText, dbUrl) {
  const line = `FOODACCESS_DATABASE_URL=${dbUrl}`;
  return /^FOODACCESS_DATABASE_URL=.*$/m.test(exampleText)
    ? exampleText.replace(/^FOODACCESS_DATABASE_URL=.*$/m, line)
    : `${line}\n${exampleText}`;
}

/** True when `target` is missing or older than `source`. */
export function isStale(target, source) {
  return !existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs;
}

class LaunchError extends Error {}

function step(message) {
  console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw new LaunchError(`could not run ${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new LaunchError(`${cmd} ${args.join(' ')} exited with code ${r.status}`);
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true)).once('timeout', () => done(false)).once('error', () => done(false));
  });
}

function findPython() {
  const candidates = WINDOWS ? [['py', '-3'], ['python']] : [['python3'], ['python']];
  for (const [cmd, ...pre] of candidates) {
    const version = capture(cmd, [...pre, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])']);
    if (!version) continue;
    const [major, minor] = version.split('.').map(Number);
    if (major === 3 && minor >= 11) return [cmd, ...pre];
  }
  throw new LaunchError('Python 3.11 or newer was not found. Install it from https://www.python.org/downloads/ and retry.');
}

function ensureBackend() {
  if (!existsSync(VENV_PYTHON)) {
    step('Creating the Python virtual environment (.venv)');
    const [cmd, ...pre] = findPython();
    run(cmd, [...pre, '-m', 'venv', path.join(ROOT, '.venv')]);
  }
  const stamp = path.join(ROOT, '.venv', '.foodaccess-installed');
  if (isStale(stamp, path.join(BACKEND, 'pyproject.toml'))) {
    step('Installing backend dependencies');
    run(VENV_PYTHON, ['-m', 'pip', 'install', '--disable-pip-version-check', '-e', `${BACKEND}[dev]`]);
    writeFileSync(stamp, '');
  }
}

function ensureFrontend() {
  const lock = path.join(FRONTEND, 'package-lock.json');
  if (!isStale(path.join(FRONTEND, 'node_modules', '.package-lock.json'), lock)) return;
  step('Installing frontend dependencies');
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.js$/.test(npmCli)) run(process.execPath, [npmCli, 'ci'], { cwd: FRONTEND });
  else run('npm', ['ci'], { cwd: FRONTEND, shell: WINDOWS });
}

async function startDevDatabase(port) {
  if (capture('docker', ['info', '--format', '{{.ServerVersion}}']) === null) {
    throw new LaunchError(
      `No database is reachable on localhost:${port} and Docker is not running.\n` +
      '  Either start Docker Desktop (https://www.docker.com/products/docker-desktop/) and run this again,\n' +
      '  or install PostgreSQL 15+ with PostGIS and set FOODACCESS_DATABASE_URL in .env\n' +
      '  (docs/deployment/SETUP_AND_DEPLOYMENT.md).',
    );
  }
  if (capture('docker', ['container', 'inspect', DB_CONTAINER]) !== null) {
    step(`Starting the database container (${DB_CONTAINER})`);
    run('docker', ['start', DB_CONTAINER]);
  } else {
    step(`Creating the database container (${DB_CONTAINER}, ${DB_IMAGE})`);
    run('docker', [
      'run', '--detach', '--name', DB_CONTAINER,
      '--publish', `127.0.0.1:${port}:5432`,
      '--volume', `${DB_VOLUME}:/var/lib/postgresql/data`,
      '--env', `POSTGRES_USER=${DB_USER}`, '--env', `POSTGRES_PASSWORD=${DB_PASSWORD}`, '--env', 'POSTGRES_DB=foodaccess',
      DB_IMAGE,
    ]);
  }
  // -h 127.0.0.1: the image's first-run init server listens on the Unix socket only, so this waits for the real one.
  const ready = ['exec', DB_CONTAINER, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', DB_USER, '-d', 'foodaccess'];
  for (let i = 0; i < 90; i++) {
    if (spawnSync('docker', ready, { stdio: 'ignore' }).status === 0 && (await portOpen('127.0.0.1', port))) return;
    await sleep(1000);
  }
  throw new LaunchError(`The database container did not become ready. Check: docker logs ${DB_CONTAINER}`);
}

/** Returns the database URL the backend should use, starting the development container if nothing is listening. */
async function ensureDatabase() {
  const envPath = path.join(ROOT, '.env');
  const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
  const configured = process.env.FOODACCESS_DATABASE_URL || fileEnv.FOODACCESS_DATABASE_URL;
  const ours = capture('docker', ['container', 'inspect', DB_CONTAINER]) !== null;
  let url = configured || DEFAULT_DB_URL;
  let target = dbTarget(url);

  if (await portOpen(target.host, target.port)) {
    if (configured || !ours) return url;
  } else if (!target.local) {
    throw new LaunchError(`The configured database ${target.host}:${target.port} is not reachable.`);
  } else if (configured && (target.user !== DB_USER || target.password !== DB_PASSWORD)) {
    throw new LaunchError(
      `Nothing is listening on ${target.host}:${target.port} (FOODACCESS_DATABASE_URL in .env).\n` +
      '  Start that PostgreSQL server, or remove the line to let this script run a Docker database instead.',
    );
  } else {
    await startDevDatabase(target.port);
  }

  url = devDbUrl(target.port);
  if (!existsSync(envPath)) {
    writeFileSync(envPath, envFileFor(readFileSync(path.join(ROOT, '.env.example'), 'utf8'), url));
    console.log('Wrote .env (from .env.example) pointing at the development database.');
  }
  return url;
}

function foodaccess(args, env) {
  run(VENV_PYTHON, ['-m', 'app.cli', ...args], { cwd: BACKEND, env });
}

function openBrowser(url) {
  const [cmd, args] = WINDOWS ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

async function waitForHttp(url, isDown) {
  for (let i = 0; i < 120 && !isDown(); i++) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

function prefixed(child, label, color) {
  const tag = `\x1b[${color}m${label}\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.setEncoding('utf8').on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      for (const line of lines) process.stdout.write(`${tag}${line}\n`);
    });
  }
}

async function serve(env, { demo, open }) {
  step('Starting the API and the web app (Ctrl+C stops both)');
  const stdio = ['ignore', 'pipe', 'pipe'];
  const children = [
    spawn(VENV_PYTHON, ['-m', 'uvicorn', 'app.main:app', '--port', '8000', '--reload'], { cwd: BACKEND, env, stdio }),
    spawn(process.execPath, [path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: FRONTEND, env, stdio }),
  ];
  prefixed(children[0], 'api', 36);
  prefixed(children[1], 'web', 35);

  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (child.exitCode !== null) continue;
      // uvicorn --reload runs a worker subprocess; on Windows only taskkill /T takes the whole tree down.
      if (WINDOWS) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
    process.exitCode = code;
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  children.forEach((child, i) => child.on('exit', (code) => {
    if (!stopping) console.error(`\n${i === 0 ? 'The API' : 'The web app'} stopped (exit code ${code}). Shutting down.`);
    stop(code ?? 1);
  }));

  const up = await Promise.all([`${API_URL}/api/health`, WEB_URL].map((u) => waitForHttp(u, () => stopping)));
  if (stopping) return;
  if (!up.every(Boolean)) {
    console.error('\nThe servers did not come up in time. See the output above.');
    return stop(1);
  }
  console.log(`\n\x1b[1mReady.\x1b[0m  Web app: ${WEB_URL}   API docs: ${API_URL}/api/docs`);
  if (!demo) {
    console.log('Real listings were loaded from data/snapshots (unverified, labelled). For fictional [TEST] listings too: npm run demo');
  }
  if (open && !process.env.CI && !process.env.CODESPACES) openBrowser(WEB_URL);
}

async function main(argv) {
  const cli = argv[0] === 'cli';
  const demo = !cli && argv.includes('--demo');
  ensureBackend();
  if (!cli) ensureFrontend();
  const localEnvPath = path.join(ROOT, '.env');
  const localEnv = existsSync(localEnvPath) ? parseEnv(readFileSync(localEnvPath, 'utf8')) : {};
  const env = { ...localEnv, ...process.env, FOODACCESS_DATABASE_URL: await ensureDatabase() };

  if (cli) return foodaccess(argv.slice(1), env);

  step('Preparing the database (foodaccess bootstrap)');
  foodaccess(['bootstrap'], env);

  // Real listings: load the committed snapshot (data/snapshots/) into a fresh database. No scraping; skipped when
  // the database already has real listings. Unverified records show as "From a public list — not yet verified".
  step('Loading real listings from data/snapshots (first run only)');
  foodaccess(['load-data', '--if-empty'], env);

  if (demo) {
    step('Loading synthetic demo data (fictional, labelled [TEST])');
    const password = randomBytes(12).toString('base64url');
    foodaccess(['create-admin', '--email', DEMO_ADMIN], { ...env, FOODACCESS_ADMIN_PASSWORD: password });
    foodaccess(['demo', '--reviewer-email', DEMO_ADMIN], env);
    env.FOODACCESS_SHOW_SYNTHETIC = 'true';
    console.log(`Demo admin sign-in for this run: ${DEMO_ADMIN} / ${password}`);
  }
  await serve(env, { demo, open: !argv.includes('--no-open') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`\n\x1b[31m${err instanceof LaunchError ? err.message : err.stack}\x1b[0m`);
    process.exit(1);
  });
}
