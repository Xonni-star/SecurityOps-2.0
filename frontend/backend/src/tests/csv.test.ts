import { escapeCsvCell } from '../utils/csv';

describe('CSV cell serialization', () => {
  test('neutralizes formula-leading text but preserves signed numeric values', () => {
    expect(escapeCsvCell(' \t=1+1', true)).toBe(`"' \t=1+1"`);
    expect(escapeCsvCell('@SUM(1,1)', true)).toBe(`"'@SUM(1,1)"`);
    expect(escapeCsvCell(-1.25)).toBe('"-1.25"');
  });

  test('quotes and escapes CSV text after formula handling', () => {
    expect(escapeCsvCell('=1,"x"', true)).toBe(`"'=1,""x"""`);
    expect(escapeCsvCell('=1,"x"')).toBe(`"=1,""x"""`);
  });
});
