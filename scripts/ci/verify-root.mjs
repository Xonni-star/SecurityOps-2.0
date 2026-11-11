import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const failures = [];
const ok = (msg) => console.log(`✅ ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.error(`❌ ${msg}`);
};

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

// 1. Node-Version
const nvmrc = fs.readFileSync('.nvmrc', 'utf8').trim();
if (nvmrc === '24') {
  ok(`.nvmrc pinnt Node.js auf ${nvmrc}`);
} else {
  fail(`.nvmrc erwartet "24", gefunden: "${nvmrc}"`);
}

const expectedEngine = '>=24.15.0';
if (pkg.engines?.node === expectedEngine) {
  ok(`engines.node = ${expectedEngine}`);
} else {
  fail(`engines.node erwartet "${expectedEngine}", gefunden: "${pkg.engines?.node}"`);
}

// 2. concurrently exakt gepinnt und installiert
const concurrentlySpec = pkg.devDependencies?.concurrently;
if (!concurrentlySpec) {
  fail('concurrently fehlt in devDependencies');
} else if (!/^\d+\.\d+\.\d+$/.test(concurrentlySpec)) {
  fail(`concurrently ist nicht exakt gepinnt (kein latest, kein Range): "${concurrentlySpec}"`);
} else {
  ok(`concurrently exakt gepinnt: ${concurrentlySpec}`);
}

const lockedVersion = lock.packages?.['node_modules/concurrently']?.version;
if (lockedVersion === concurrentlySpec) {
  ok(`Lockfile enthält concurrently@${lockedVersion}`);
} else {
  fail(`Lockfile-Version (${lockedVersion}) weicht von package.json (${concurrentlySpec}) ab`);
}

try {
  const ls = JSON.parse(
    execFileSync('npm', ['ls', 'concurrently', '--depth=0', '--json'], { encoding: 'utf8' })
  );
  const installed = ls.dependencies?.concurrently?.version;
  if (installed === concurrentlySpec) {
    ok(`concurrently ist installiert: ${installed}`);
  } else {
    fail(`Installierte concurrently-Version (${installed}) weicht von ${concurrentlySpec} ab`);
  }
} catch (err) {
  fail(`npm ls concurrently fehlgeschlagen: ${err.message}`);
}

// 3. Root-Skripte zeigen auf die richtigen Verzeichnisse
const frontendScript = pkg.scripts?.['dev-frontend'] ?? '';
const backendScript = pkg.scripts?.['dev-backend'] ?? '';

if (frontendScript === 'npm run dev --prefix frontend') {
  ok('dev-frontend -> frontend');
} else {
  fail(`dev-frontend zeigt nicht auf "frontend": "${frontendScript}"`);
}

if (backendScript === 'npm run dev --prefix frontend/backend') {
  ok('dev-backend -> frontend/backend');
} else {
  fail(`dev-backend zeigt nicht auf "frontend/backend": "${backendScript}"`);
}

if (/--prefix\s+backend(\s|$)/.test(backendScript)) {
  fail(`dev-backend verwendet noch das Google-Cloud-Proxy-Verzeichnis: "${backendScript}"`);
} else {
  ok('dev-backend verwendet nicht das Google-Cloud-Proxy-Verzeichnis');
}

// 4. Keine unbeabsichtigten Abhängigkeiten auf das Proxy-Backend
if ('workspaces' in pkg) {
  fail(`Root-Paket deklariert weiterhin workspaces: ${JSON.stringify(pkg.workspaces)}`);
} else {
  ok('Keine workspaces-Deklaration im Root-Paket');
}

const dependencyEntries = Object.entries({
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
  ...(pkg.optionalDependencies ?? {}),
  ...(pkg.peerDependencies ?? {})
});

if (dependencyEntries.length === 0) {
  fail('Root-Paket besitzt keine Abhängigkeiten (concurrently fehlt?)');
}

const proxyLike = dependencyEntries.filter(([name, spec]) => {
  return (
    name === 'backend' ||
    /^(file|link|workspace):/.test(String(spec)) ||
    /(^|\/)backend(\/|$)/.test(String(spec))
  );
});

if (proxyLike.length === 0) {
  ok(`Keine Root-Abhängigkeit verweist auf das Proxy-Backend (${dependencyEntries.length} Einträge geprüft)`);
} else {
  fail(`Verdächtige Root-Abhängigkeiten: ${JSON.stringify(proxyLike)}`);
}

// 5. .gitignore schützt node_modules
const gitignore = fs.readFileSync('.gitignore', 'utf8');
if (/^node_modules\/$/m.test(gitignore)) {
  ok('.gitignore ignoriert node_modules/');
} else {
  fail('.gitignore ignoriert node_modules/ nicht');
}

if (failures.length > 0) {
  console.error(`\nRoot-Strukturprüfung fehlgeschlagen: ${failures.length} Fehler.`);
  process.exit(1);
}

console.log('\nRoot-Strukturprüfung vollständig bestanden.');
