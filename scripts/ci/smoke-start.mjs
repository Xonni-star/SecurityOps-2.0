import { spawn } from 'node:child_process';

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 180000);
const BACKEND_PORT = process.env.PORT || '8010';
const backendHealthUrl = `http://127.0.0.1:${BACKEND_PORT}/api/v1/health`;

const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, '');

let output = '';
let finished = false;
let earlyExit = null;
let frontendUrl = null;
let backendReady = false;

const child = spawn('npm', ['run', 'dev'], {
  env: { ...process.env, PORT: BACKEND_PORT, NODE_ENV: process.env.NODE_ENV || 'test' },
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

function scan(text) {
  const clean = stripAnsi(text);

  const frontendMatch = clean.match(/Local:\s+(http:\/\/localhost:\d+)\/?/);
  if (frontendMatch) {
    frontendUrl = frontendMatch[1];
    console.log(`\n[SMOKE] Frontend erkannt: ${frontendUrl}`);
  }

  if (/\[SECURITYOPS 2\.0 BACKEND\] Gestartet auf Port/.test(clean)) {
    backendReady = true;
    console.log('\n[SMOKE] Backend-Startmeldung erkannt.');
  }

  if (!finished && /exited with code (?!0\b)\d+/.test(clean)) {
    const match = clean.match(/npm run dev-(frontend|backend) exited with code (\d+)/);
    earlyExit = match ? `${match[1]} (Exit ${match[2]})` : 'ein Teilprozess';
    console.error(`\n[SMOKE] Vorzeitiges Ende erkannt: ${earlyExit}`);
  }
}

child.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  process.stdout.write(text);
  scan(text);
});

child.stderr.on('data', (data) => {
  const text = data.toString();
  output += text;
  process.stderr.write(text);
  scan(text);
});

child.on('exit', (code, signal) => {
  if (!finished) {
    console.error(`\n[SMOKE] Gesamtprozess wurde vorzeitig beendet (Code ${code}, Signal ${signal}).`);
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, description, timeout = TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (earlyExit) {
      throw new Error(`Vorzeitiges Ende von ${earlyExit}`);
    }
    if (predicate()) {
      return;
    }
    await sleep(300);
  }
  throw new Error(`Timeout: ${description} wurde nicht erreicht.`);
}

async function fetchWithRetry(url, attempts = 20) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} von ${url}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(500);
  }
  throw lastError;
}

function stopProcessGroup(signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Prozessgruppe bereits beendet
  }
}

try {
  await waitFor(() => frontendUrl && backendReady, 'Frontend- und Backend-Bereitschaft');

  const backendResponse = await fetchWithRetry(backendHealthUrl);
  const backendJson = await backendResponse.json();

  if (backendJson.status !== 'OPERATIONAL') {
    throw new Error(`Backend-Health nicht OPERATIONAL: ${JSON.stringify(backendJson)}`);
  }
  console.log(`[SMOKE] Backend-Health: ${backendJson.status} / ${backendJson.database}`);

  const frontendResponse = await fetchWithRetry(frontendUrl);
  const frontendHtml = await frontendResponse.text();
  if (!frontendHtml.includes('id="root"')) {
    throw new Error('Frontend liefert kein erwartetes HTML (id="root" fehlt).');
  }
  console.log(`[SMOKE] Frontend erreichbar: HTTP ${frontendResponse.status}`);

  if (child.exitCode !== null) {
    throw new Error(`Gesamtprozess ist bereits beendet (Exit ${child.exitCode}).`);
  }

  console.log('[SMOKE] Beide Prozesse laufen und antworten. Starttest bestanden.');

  finished = true;
  stopProcessGroup('SIGTERM');
  await sleep(3000);
  stopProcessGroup('SIGKILL');
  process.exit(0);
} catch (err) {
  finished = true;
  console.error(`\n[SMOKE FEHLER] ${err.message}`);
  if (earlyExit) {
    console.error(`[SMOKE FEHLER] Ursache: ${earlyExit} wurde vorzeitig beendet.`);
  }
  stopProcessGroup('SIGTERM');
  await sleep(2000);
  stopProcessGroup('SIGKILL');
  process.exit(1);
}
