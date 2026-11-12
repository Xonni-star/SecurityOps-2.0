import { detectDocumentContent, sanitizeOriginalFilename } from '../services/documentFiles';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<[string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [filename, value] of entries) {
    const name = Buffer.from(filename);
    const data = Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

describe('DMS file validation', () => {
  test('validates PDF, image and UTF-8 text signatures instead of trusting extensions', () => {
    expect(detectDocumentContent(Buffer.from('%PDF-1.7\n'), 'contract.pdf').contentType).toBe('application/pdf');
    expect(detectDocumentContent(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'photo.png'
    ).contentType).toBe('image/png');
    expect(detectDocumentContent(Buffer.from('id,name\n1,Guard\n', 'utf8'), 'staff.csv').contentType)
      .toBe('text/csv; charset=utf-8');
  });

  test('rejects mismatched, binary-text and unsupported uploads', () => {
    expect(() => detectDocumentContent(Buffer.from('not a PDF'), 'contract.pdf')).toThrow(/Dateiinhalte/);
    expect(() => detectDocumentContent(Buffer.from([0x00, 0xff]), 'data.txt')).toThrow(/Dateiinhalte/);
    expect(() => detectDocumentContent(Buffer.from('%PDF-1.7'), 'payload.exe')).toThrow(/Dateityp/);
  });

  test('checks OOXML archive entries, document content, and CRC before accepting DOCX', () => {
    const valid = zip([
      ['[Content_Types].xml', '<Types>wordprocessingml.document.main+xml</Types>'],
      ['word/document.xml', '<w:document xmlns:w="urn:test"/>']
    ]);
    expect(detectDocumentContent(valid, 'document.docx').contentType)
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    const wrongType = zip([
      ['[Content_Types].xml', '<Types/>'],
      ['word/document.xml', '<w:document/>']
    ]);
    expect(() => detectDocumentContent(wrongType, 'document.docx')).toThrow(/Dateiinhalte/);
  });

  test('uses only a sanitized basename as filename metadata', () => {
    expect(sanitizeOriginalFilename('../../private\\contract.pdf')).toBe('contract.pdf');
    expect(() => sanitizeOriginalFilename('../')).toThrow(/Dateiname/);
    expect(() => sanitizeOriginalFilename('x'.repeat(256))).toThrow(/Dateiname/);
  });
});
