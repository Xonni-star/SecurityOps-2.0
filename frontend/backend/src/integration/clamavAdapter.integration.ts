import assert from 'node:assert/strict';
import net from 'node:net';
import { env } from '../config/env';
import { ClamAvDocumentScanner } from '../services/documentScanner';

const readinessTimeoutMs = 5 * 60 * 1000;
const connectionTimeoutMs = 1500;
const cleanDocument = Buffer.from('SecurityOps ClamAV INSTREAM integration test document.\n');
const eicarTestSignature = Buffer.from(
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
);

function pingClamAv(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: env.DMS_CLAMAV_HOST, port: env.DMS_CLAMAV_PORT });
    let response = '';
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(connectionTimeoutMs, () => finish(false));
    socket.on('connect', () => socket.end('zPING\0'));
    socket.on('data', (data) => {
      response += data.toString('utf8');
      if (response.includes('PONG')) finish(true);
    });
    socket.on('end', () => finish(response.includes('PONG')));
    socket.on('error', () => finish(false));
  });
}

async function waitForClamAv(): Promise<void> {
  const deadline = Date.now() + readinessTimeoutMs;
  while (Date.now() < deadline) {
    if (await pingClamAv()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`ClamAV did not become ready within ${readinessTimeoutMs} ms.`);
}

async function run(): Promise<void> {
  assert.equal(env.DMS_SCANNER_PROVIDER, 'clamav', 'Integration check requires the ClamAV provider.');
  assert.equal(env.DMS_SCAN_REQUIRED, true, 'Integration check requires fail-closed scanning.');

  await waitForClamAv();
  const scanner = new ClamAvDocumentScanner();

  assert.equal(await scanner.scan(cleanDocument), 'clean', 'ClamAV should accept the clean test document.');
  assert.equal(await scanner.scan(eicarTestSignature), 'infected', 'ClamAV should detect the EICAR test signature.');
  console.log('ClamAV INSTREAM adapter detected clean content and the EICAR test signature.');
}

run().catch((error: unknown) => {
  console.error('ClamAV INSTREAM adapter integration check failed:', error);
  process.exitCode = 1;
});
