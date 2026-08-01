const COMMON_PASSWORDS = new Set([
  '111111111111111',
  '123456789012345',
  '123456789123456',
  'adminadminadmin',
  'administrator',
  'changemechangeme',
  'iloveyouiloveyou',
  'letmeinletmein',
  'passwordpassword',
  'password123456',
  'qwerty123456789',
  'qwertyuiopasdfgh',
  'shopeeshopee123',
  'welcome123456789',
]);

const COMMON_BASE_PATTERN =
  /^(?:admin|letmein|password|qwerty|shopee|welcome)[\s._!@#$%&*-]*\d{3,}$/u;
const SEQUENTIAL_PATTERN = /^(?:0123456789|1234567890|9876543210){2,}$/u;

function normaliseForComparison(value) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function isRepeatedSequence(value) {
  for (let chunkLength = 1; chunkLength <= Math.floor(value.length / 2); chunkLength += 1) {
    if (value.length % chunkLength !== 0) {
      continue;
    }

    const chunk = value.slice(0, chunkLength);

    if (chunk.repeat(value.length / chunkLength) === value) {
      return true;
    }
  }

  return false;
}

/**
 * Check a password against the deterministic local MVP denylist.
 *
 * The password is normalised only for policy matching. The original Unicode
 * string is preserved unchanged for password hashing.
 *
 * @param {string} password
 * @returns {boolean}
 */
export function isCommonPassword(password) {
  const candidate = normaliseForComparison(password);

  return (
    COMMON_PASSWORDS.has(candidate) ||
    COMMON_BASE_PATTERN.test(candidate) ||
    SEQUENTIAL_PATTERN.test(candidate) ||
    isRepeatedSequence(candidate)
  );
}
