/**
 * Sealing the three contact fields — docs/README.md §3.9, "encrypted at rest with a key held
 * outside the DB".
 *
 * AES-256-GCM, one random 96-bit nonce per value, output laid out as:
 *
 *     ┌────────────┬───────────┬──────────────┬────────────────┐
 *     │ version(1) │ nonce(12) │ tag(16)      │ ciphertext(n)  │
 *     └────────────┴───────────┴──────────────┴────────────────┘
 *
 * ── Why not pgcrypto ──────────────────────────────────────────────────────────
 *
 * Postgres can do this: `pgp_sym_encrypt(value, key)`. It is rejected because the key would
 * then be an argument to a SQL function, and a SQL function's arguments end up in
 * `pg_stat_statements`, in `log_min_duration_statement` output, and in the error text when
 * the statement fails. §3.9 says the key is held *outside* the database, and a key that
 * travels into the database on every insert is not.
 *
 * So the database holds bytes it has no function capable of reading, and this process holds
 * the only thing that can read them. That is the property worth preserving if this file is
 * ever rewritten.
 *
 * ── GCM, not CBC ──────────────────────────────────────────────────────────────
 *
 * The auth tag is the point. Without it, an attacker with write access to the column can flip
 * bits in the ciphertext and the decrypt succeeds, returning a value nobody chose. With it,
 * any tampering fails loudly at `decipher.final()`. For a field that phase 6 will put on a job
 * application on the user's behalf, "this decrypted to something, probably right" is not good
 * enough.
 *
 * ── The key, and the footgun ──────────────────────────────────────────────────
 *
 * `RESUME_ENCRYPTION_KEY` is 32 bytes, base64. **Rotating it does not re-encrypt anything** —
 * every previously sealed field becomes permanently unreadable, and nothing detects that
 * because the rows are still there and still the right length. It is the same class of hazard
 * as phase 3's `VERIFICATION_PEPPER` and it is worse, because a lost pepper un-bans people
 * while a lost key destroys data.
 *
 * The version byte is the escape hatch: a future rotation writes `2` with a new key and keeps
 * reading `1` with the old one, which is a real migration this layout can support and the
 * current code deliberately does not implement. Building the key-list machinery before there
 * are two keys would be guessing at the shape of a rotation nobody has planned yet.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../env.ts';

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Decoded once. A malformed key is a boot-time problem and not a per-request one — a service
 * that accepts uploads for an hour and then cannot seal any of them is worse than one that
 * refuses to start.
 */
let keyCache: Buffer | null | undefined;

function key(): Buffer | null {
  if (keyCache !== undefined) return keyCache;

  const raw = env.resumeEncryptionKey;
  if (!raw) {
    keyCache = null;
    return null;
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    throw new Error(
      `RESUME_ENCRYPTION_KEY must be 32 bytes of base64 (got ${decoded.length}). ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  keyCache = decoded;
  return keyCache;
}

/** Whether this process can seal a contact field. Reported on `/health` as a capability. */
export function canEncrypt(): boolean {
  return key() !== null;
}

/**
 * Seals one value. Returns null for an absent or empty input — a resume with no phone number
 * on it should store a null, not sixteen bytes of authenticated nothing that later decrypts to
 * an empty string and reads as "the user's phone number is blank".
 *
 * Throws when there is no key. The caller decides what that means; `parseResume` treats it as
 * "store the matching fields and drop the contact ones", because a resume that cannot be
 * sealed is still a resume worth matching against.
 */
export function seal(value: string | null | undefined): Buffer | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) return null;

  const k = key();
  if (!k) throw new Error('RESUME_ENCRYPTION_KEY is not set; cannot seal a contact field.');

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', k, nonce);
  const ciphertext = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);

  return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
}

/**
 * Opens one value. Nothing in phase 4 calls this — the contact fields are written and not read
 * until phase 6 needs them for Auto Apply, which is §13.2's data minimization made literal.
 *
 * It exists now because a write path with no tested read path is a write path that is probably
 * wrong, and `verify:phase4` round-trips through it. Every real call in phase 6 must be
 * preceded by a `log_pii_access` row; this function deliberately does not write one itself,
 * because it does not know the purpose and a log that records `purpose: 'unknown'` is a log
 * that stops being worth reading.
 */
export function open(sealed: Buffer | Uint8Array | null | undefined): string | null {
  if (!sealed || sealed.length === 0) return null;

  const k = key();
  if (!k) throw new Error('RESUME_ENCRYPTION_KEY is not set; cannot open a contact field.');

  const buffer = Buffer.isBuffer(sealed) ? sealed : Buffer.from(sealed);
  if (buffer.length < 1 + NONCE_BYTES + TAG_BYTES) {
    throw new Error('Sealed value is too short to be well-formed.');
  }

  const version = buffer[0];
  if (version !== VERSION) {
    // The rotation path this layout leaves room for and this code does not implement.
    throw new Error(`Unknown seal version ${version}; this build understands ${VERSION} only.`);
  }

  const nonce = buffer.subarray(1, 1 + NONCE_BYTES);
  const tag = buffer.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(1 + NONCE_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', k, nonce);
  decipher.setAuthTag(tag);

  // Throws on a bad tag, which is the whole reason for choosing GCM.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Constant-time compare for two sealed values.
 *
 * Not used by the parse path. It is here for phase 6's "is this the same email we already have
 * on file" check, which must not be answered by decrypting both — and cannot be answered by
 * comparing ciphertexts either, since a fresh nonce makes every seal of the same plaintext
 * different. That is a deliberate property (it stops anyone inferring that two accounts share
 * an address by looking at the column), and it means the check has to open both values. This
 * function compares the results without leaking where they diverge.
 */
export function sealedEquals(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
