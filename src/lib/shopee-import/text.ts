/** 字數一律以 Unicode code point 計（等同 Postgres char_length），不可用 string.length（F-5.3） */
export function codePointLength(s: string): number {
  return [...s].length;
}

export function normalizeDescription(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

const INTEGER = /^\d+$/;

/** 只接受非負整數字串（"1500"）；其他（空白、小數、千分位、負數）一律 null */
export function parseNonNegativeInt(raw: string): number | null {
  if (!INTEGER.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
