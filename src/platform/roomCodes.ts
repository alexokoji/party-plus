/**
 * Room codes.
 *
 * A code is the only thing protecting a room, so it has to be unguessable.
 * The original was 5 characters from a 32-character alphabet — 33.5 million
 * combinations, which a script works through in minutes — and worse, asking
 * for any code CREATED that room, so there was no wrong answer to rate-limit
 * against. Both halves are fixed: codes are 8 characters minted from a CSPRNG
 * (32^8 ≈ 1.1 × 10^12), and a room has to be created before it can be joined,
 * so a wrong guess is a 404 that the limiter can count.
 */

/** No 0/O or 1/I: codes get read aloud and typed by someone else. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

/**
 * Mints a code from the platform CSPRNG.
 *
 * Rejection sampling rather than `% alphabet.length`: 256 is not a multiple of
 * 32 for every alphabet size, and the modulo bias that introduces would shrink
 * the real search space. (It happens to divide evenly for 32, but the code
 * should not silently become biased if someone edits the alphabet.)
 */
export function mintRoomCode(length = CODE_LENGTH): string {
  const max = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let code = "";
  while (code.length < length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= max) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === length) break;
    }
  }
  return code;
}

/** Accepts what someone typed or pasted, including a formatted code. */
export function normalizeRoomCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

/** True for a code this system could have minted. */
export function isValidRoomCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  return [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

/** ABCD-EFGH: easier to read out and to copy by eye. */
export function formatRoomCode(code: string): string {
  return code.length === CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
