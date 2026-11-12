export type DocumentScanStatus = 'clean' | 'infected' | 'not_scanned';

export interface DocumentScanner {
  scan(bytes: Buffer): Promise<DocumentScanStatus>;
}

export class UnavailableDocumentScanner implements DocumentScanner {
  async scan(_bytes: Buffer): Promise<DocumentScanStatus> {
    return 'not_scanned';
  }
}

export const documentScanner: DocumentScanner = new UnavailableDocumentScanner();
