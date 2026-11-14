import net from 'net';
import { env } from '../config/env';
import {
  ClamAvDocumentScanner,
  DocumentScannerUnavailableError,
  UnavailableDocumentScanner
} from '../services/documentScanner';

async function scanThroughFakeClamAv(response: string): Promise<'clean' | 'infected'> {
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('data', () => undefined);
    socket.on('end', () => socket.end(`${response}\0`));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previousHost = env.DMS_CLAMAV_HOST;
  const previousPort = env.DMS_CLAMAV_PORT;
  env.DMS_CLAMAV_HOST = '127.0.0.1';
  env.DMS_CLAMAV_PORT = (server.address() as net.AddressInfo).port;
  try {
    return await new ClamAvDocumentScanner().scan(Buffer.from('test document bytes'));
  } finally {
    env.DMS_CLAMAV_HOST = previousHost;
    env.DMS_CLAMAV_PORT = previousPort;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe('DMS malware scanner', () => {
  test('distinguishes clean and infected ClamAV responses', async () => {
    await expect(scanThroughFakeClamAv('stream: OK')).resolves.toBe('clean');
    await expect(scanThroughFakeClamAv('stream: Eicar-Test-Signature FOUND')).resolves.toBe('infected');
  });

  test('reports an unconfigured scanner as unavailable, never clean', async () => {
    await expect(new UnavailableDocumentScanner().scan(Buffer.from('test')))
      .rejects.toBeInstanceOf(DocumentScannerUnavailableError);
  });
});
