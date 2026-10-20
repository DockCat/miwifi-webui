/**
 * Shared UUID format validator.
 *
 * Matches UUID v1–v5 in canonical 8-4-4-4-12 hyphenated form.
 * Used across route handlers that accept UUID path or query parameters.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
