import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(nodeScrypt);

export const DEFAULT_SCRYPT_PARAMETERS = Object.freeze({
  keyLength: 64,
  maxmem: 256 * 1024 * 1024,
  N: 2 ** 17,
  p: 1,
  r: 8,
  saltLength: 16,
});

const HASH_VERSION = 'scrypt-v1';
const MAX_STORED_COST = 2 ** 20;
const MAX_STORED_PARALLELIZATION = 16;

function assertParameters(parameters) {
  if (
    !Number.isSafeInteger(parameters.N) ||
    parameters.N < 2 ||
    (parameters.N & (parameters.N - 1)) !== 0 ||
    !Number.isSafeInteger(parameters.r) ||
    parameters.r < 1 ||
    !Number.isSafeInteger(parameters.p) ||
    parameters.p < 1 ||
    !Number.isSafeInteger(parameters.keyLength) ||
    parameters.keyLength < 32 ||
    !Number.isSafeInteger(parameters.saltLength) ||
    parameters.saltLength < 16
  ) {
    throw new TypeError('Invalid scrypt password-hashing parameters');
  }
}

function parsePositiveInteger(value) {
  if (!/^\d+$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePasswordHash(encodedHash) {
  if (typeof encodedHash !== 'string') {
    return null;
  }

  const [
    version,
    costValue,
    blockSizeValue,
    parallelizationValue,
    keyLengthValue,
    saltValue,
    hashValue,
  ] = encodedHash.split('$');
  const N = parsePositiveInteger(costValue ?? '');
  const r = parsePositiveInteger(blockSizeValue ?? '');
  const p = parsePositiveInteger(parallelizationValue ?? '');
  const keyLength = parsePositiveInteger(keyLengthValue ?? '');

  if (
    version !== HASH_VERSION ||
    N === null ||
    N > MAX_STORED_COST ||
    (N & (N - 1)) !== 0 ||
    r === null ||
    r > 32 ||
    p === null ||
    p > MAX_STORED_PARALLELIZATION ||
    keyLength === null ||
    keyLength < 32 ||
    keyLength > 128 ||
    !saltValue ||
    !hashValue
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const hash = Buffer.from(hashValue, 'base64url');

    if (salt.length < 16 || hash.length !== keyLength) {
      return null;
    }

    return { hash, keyLength, N, p, r, salt };
  } catch {
    return null;
  }
}

function calculateMaxmem({ N, r }, configuredMaxmem) {
  const required = 128 * N * r + 1024 * 1024;
  return Math.max(configuredMaxmem, required);
}

/**
 * Create the single versioned asynchronous password-hashing boundary.
 *
 * @param {object} [options]
 * @param {typeof DEFAULT_SCRYPT_PARAMETERS} [options.parameters]
 */
export function createPasswordHasher({ parameters = DEFAULT_SCRYPT_PARAMETERS } = {}) {
  assertParameters(parameters);

  return Object.freeze({
    /**
     * Hash one plaintext password with a unique random salt.
     *
     * @param {string} password
     * @returns {Promise<string>}
     */
    async hash(password) {
      const salt = randomBytes(parameters.saltLength);
      const derivedKey = await scryptAsync(password, salt, parameters.keyLength, {
        N: parameters.N,
        maxmem: calculateMaxmem(parameters, parameters.maxmem),
        p: parameters.p,
        r: parameters.r,
      });

      return [
        HASH_VERSION,
        parameters.N,
        parameters.r,
        parameters.p,
        parameters.keyLength,
        salt.toString('base64url'),
        Buffer.from(derivedKey).toString('base64url'),
      ].join('$');
    },

    /**
     * Verify a plaintext password using the parameters encoded with its hash.
     *
     * @param {string} password
     * @param {string} encodedHash
     * @returns {Promise<boolean>}
     */
    async verify(password, encodedHash) {
      const parsed = parsePasswordHash(encodedHash);

      if (!parsed) {
        return false;
      }

      const derivedKey = await scryptAsync(password, parsed.salt, parsed.keyLength, {
        N: parsed.N,
        maxmem: calculateMaxmem(parsed, parameters.maxmem),
        p: parsed.p,
        r: parsed.r,
      });

      return timingSafeEqual(Buffer.from(derivedKey), parsed.hash);
    },
  });
}
