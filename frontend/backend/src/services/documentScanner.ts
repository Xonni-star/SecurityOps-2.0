import net from 'net';
import { env } from '../config/env';

export type DocumentScanStatus = 'clean' | 'infected' | 'unavailable' | 'error' | 'not_scanned';

export interface DocumentScanner {
  scan(bytes: Buffer): Promise<Extract<DocumentScanStatus, 'clean' | 'infected'>>;
}

export class DocumentScannerUnavailableError extends Error {}

export class UnavailableDocumentScanner implements DocumentScanner {
  async scan(_bytes: Buffer): Promise<'clean' | 'infected'> {
    throw new DocumentScannerUnavailableError('No malware scanner is configured.');
  }
}

export class ClamAvDocumentScanner implements DocumentScanner {
  async scan(bytes: Buffer): Promise<'clean' | 'infected'> {
    const chunks: Buffer[] = [Buffer.from('zINSTREAM\0')];
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      const chunk = bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.length));
      const length = Buffer.alloc(4);
      length.writeUInt32BE(chunk.length);
      chunks.push(length, chunk);
    }
    chunks.push(Buffer.alloc(4));

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: env.DMS_CLAMAV_HOST, port: env.DMS_CLAMAV_PORT });
      let response = '';
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new DocumentScannerUnavailableError(error.message));
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        const result = response.replace(/\0/g, '').trim();
        socket.destroy();
        if (result === 'stream: OK') resolve('clean');
        else if (/^stream: .+ FOUND$/.test(result)) resolve('infected');
        else reject(new Error('Scanner returned an invalid response.'));
      };
      socket.setTimeout(env.DMS_CLAMAV_TIMEOUT_MS, () => fail(new Error('Scanner timed out.')));
      socket.on('connect', () => socket.end(Buffer.concat(chunks)));
      socket.on('data', (data) => {
        response += data.toString('utf8');
        if (response.includes('\0') || response.endsWith('\n')) finish();
      });
      socket.on('error', fail);
      socket.on('end', finish);
    });
  }
}

export let documentScanner: DocumentScanner = env.DMS_SCANNER_PROVIDER === 'clamav'
  ? new ClamAvDocumentScanner()
  : new UnavailableDocumentScanner();

export function setDocumentScanner(scanner: DocumentScanner): void {
  documentScanner = scanner;
}
