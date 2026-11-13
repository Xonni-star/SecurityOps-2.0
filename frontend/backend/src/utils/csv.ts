export function escapeCsvCell(value: unknown, protectFormula = false): string {
  let text = String(value ?? '');
  if (protectFormula && /^[\s\u0000-\u001f\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
