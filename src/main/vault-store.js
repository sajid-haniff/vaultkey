// src/main/vault-store.js
//
// Owns all cryptographic operations and vault file I/O.
// Nothing outside this module touches crypto or the vault file directly.
// This is the enforcement point for the security boundary.

import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { promisify } from 'util';

// promisify wraps Node callback-style functions into Promise-returning ones.
// crypto.pbkdf2 uses the old Node callback style — this makes it async/await friendly.
const pbkdf2Async = promisify(pbkdf2);

// ── Crypto constants ────────────────────────────────────────────────────────
// These are not arbitrary. Each value has a specific reason.
const ALGO        = 'aes-256-gcm'; // Authenticated encryption — detects tampering
const KEY_LEN     = 32;            // 256 bits — required by AES-256
const IV_LEN      = 12;            // 96 bits — GCM standard, optimal for performance
const SALT_LEN    = 32;            // 256 bits — large enough to prevent rainbow tables
const TAG_LEN     = 16;            // 128 bits — GCM auth tag, maximum strength
const KDF_ITER    = 210_000;       // PBKDF2 iterations — OWASP 2023 recommendation for SHA-512
const KDF_DIGEST  = 'sha512';      // SHA-512 — stronger than SHA-256 for KDF
const VAULT_VER   = 1;             // Schema version — lets us migrate format later

// ── Key derivation ──────────────────────────────────────────────────────────

// deriveKey: password (string) + salt (Buffer) → 32-byte key (Buffer)
// This is intentionally slow. 210k iterations of SHA-512 takes ~150ms.
// That's imperceptible to a human unlocking their vault.
// To an attacker trying a billion passwords, it's a wall.
const deriveKey = (password, salt) =>
    pbkdf2Async(password, salt, KDF_ITER, KEY_LEN, KDF_DIGEST);

// ── Encryption ──────────────────────────────────────────────────────────────

// encrypt: (plaintext string, password string) → vault envelope object
// The envelope is what gets written to disk as JSON.
const encrypt = async (plaintext, password) => {
    const salt = randomBytes(SALT_LEN); // Fresh random salt every save
    const iv   = randomBytes(IV_LEN);   // Fresh random IV every save — never reuse
    const key  = await deriveKey(password, salt);

    const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });

    // AAD (Additional Authenticated Data) is not encrypted but IS authenticated.
    // Binding the version number means an attacker can't swap in an old vault
    // version to exploit a vulnerability in an older schema parser.
    const aad = Buffer.from(`vaultkey-v${VAULT_VER}`);
    cipher.setAAD(aad);

    const ct1 = cipher.update(plaintext, 'utf8');
    const ct2 = cipher.final();
    const ciphertext = Buffer.concat([ct1, ct2]);
    const authTag = cipher.getAuthTag();

    return {
        version:    VAULT_VER,
        salt:       salt.toString('hex'),
        iv:         iv.toString('hex'),
        authTag:    authTag.toString('hex'),
        ciphertext: ciphertext.toString('hex'),
    };
};

// decrypt: (envelope object, password string) → plaintext string
// Throws if password is wrong OR if file was tampered with.
// The caller cannot distinguish between the two — intentionally.
// (Telling an attacker "wrong password" vs "tampered file" leaks information.)
const decrypt = async (envelope, password) => {
    const salt       = Buffer.from(envelope.salt,       'hex');
    const iv         = Buffer.from(envelope.iv,         'hex');
    const authTag    = Buffer.from(envelope.authTag,    'hex');
    const ciphertext = Buffer.from(envelope.ciphertext, 'hex');

    const key = await deriveKey(password, salt);

    const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(authTag);

    const aad = Buffer.from(`vaultkey-v${VAULT_VER}`);
    decipher.setAAD(aad);

    // If the auth tag doesn't match, this throws — before we ever see the data.
    // This is the tamper detection in action.
    const pt1 = decipher.update(ciphertext);
    const pt2 = decipher.final();

    return Buffer.concat([pt1, pt2]).toString('utf8');
};

// ── Vault data structure ────────────────────────────────────────────────────

// makeEntry: creates a complete, valid vault entry with all fields initialized.
// Using a factory function here ensures every entry has the same shape,
// even when callers only provide a subset of fields.
export const makeEntry = ({
                              title    = 'Untitled',
                              category = 'Other',
                              icon     = '🔑',
                              core     = {},
                              security = {},
                              auth     = {},
                              custom   = [],
                              meta     = {},
                          } = {}) => ({
    id:       crypto.randomUUID(),  // Web Crypto API — available in Node 19+ and all Electron
    title,
    category,
    icon,

    core: {
        username: core.username ?? '',
        password: core.password ?? '',
        url:      core.url      ?? '',
        notes:    core.notes    ?? '',
    },

    security: {
        questions: security.questions ?? [],  // [{q: string, a: string}]
        pins:      security.pins      ?? [],  // [{label: string, value: string}]
    },

    auth: {
        twofa: {
            enabled: auth.twofa?.enabled ?? false,
            type:    auth.twofa?.type    ?? null,   // 'totp' | 'sms' | 'hardware' | null
            secret:  auth.twofa?.secret  ?? null,   // TOTP secret — sensitive
        },
        tokens: auth.tokens ?? [],  // [{label, value, expiresAt?}]
    },

    custom,  // [{label: string, value: string, type: 'text'|'password'|'otp', protected: bool}]

    meta: {
        createdAt:          meta.createdAt          ?? new Date().toISOString(),
        updatedAt:          meta.updatedAt          ?? new Date().toISOString(),
        passwordChangedAt:  meta.passwordChangedAt  ?? new Date().toISOString(),
        strength:           meta.strength           ?? null,  // 'excellent'|'good'|'weak'|'breach'
        breached:           meta.breached           ?? false,
        tags:               meta.tags               ?? [],
    },
});

// ── Empty vault ─────────────────────────────────────────────────────────────
const emptyVault = () => ({ entries: [] });

// ── VaultStore factory ──────────────────────────────────────────────────────
// This is the main export — a factory function that closes over the vault path.
// We instantiate it once in main.js and pass it to ipc-handlers.js.
// No global state, no singletons, easily testable.

export const createVaultStore = (vaultPath) => {
    // In-memory state — the decrypted vault lives here while the app is unlocked.
    // On lock, we clear this.
    let _vault    = null;   // { entries: VaultEntry[] } | null
    let _password = null;   // master password — held in memory while unlocked

    // ── isUnlocked ─────────────────────────────────────────────────────────────
    const isUnlocked = () => _vault !== null;

    // ── vaultExists ────────────────────────────────────────────────────────────
    // Check if a vault file exists on disk yet.
    const vaultExists = async () => {
        try {
            await readFile(vaultPath);
            return true;
        } catch {
            return false; // ENOENT = file doesn't exist
        }
    };

    // ── create ─────────────────────────────────────────────────────────────────
    // Create a brand new vault with the given master password.
    const create = async (password) => {
        // Ensure the directory exists before writing
        await mkdir(dirname(vaultPath), { recursive: true });

        _vault    = emptyVault();
        _password = password;

        await _persist();
        return { ok: true };
    };

    // ── unlock ─────────────────────────────────────────────────────────────────
    // Read and decrypt the vault from disk.
    // Returns { ok: true } or throws — never returns { ok: false } silently,
    // because silent failures hide security bugs.
    const unlock = async (password) => {
        const raw      = await readFile(vaultPath, 'utf8');
        const envelope = JSON.parse(raw);
        const plaintext = await decrypt(envelope, password); // throws if wrong password

        _vault    = JSON.parse(plaintext);
        _password = password;
        return { ok: true };
    };

    // ── lock ───────────────────────────────────────────────────────────────────
    // Zero out in-memory state. The vault is now inaccessible until unlocked again.
    const lock = () => {
        _vault    = null;
        _password = null;
        return { ok: true };
    };

    // ── getEntries ─────────────────────────────────────────────────────────────
    const getEntries = () => {
        if (!isUnlocked()) throw new Error('Vault is locked');
        // Return a shallow copy — renderer gets a snapshot, not a reference
        return [..._vault.entries];
    };

    // ── addEntry ───────────────────────────────────────────────────────────────
    const addEntry = async (fields) => {
        if (!isUnlocked()) throw new Error('Vault is locked');
        const entry = makeEntry(fields);
        _vault.entries.push(entry);
        await _persist();
        return entry; // return the created entry (with its generated id)
    };

    // ── updateEntry ────────────────────────────────────────────────────────────
    const updateEntry = async (id, fields) => {
        if (!isUnlocked()) throw new Error('Vault is locked');
        const idx = _vault.entries.findIndex(e => e.id === id);
        if (idx === -1) throw new Error(`Entry not found: ${id}`);

        // Deep merge: preserve existing fields, overlay with new ones
        // We explicitly update the timestamp
        _vault.entries[idx] = {
            ..._vault.entries[idx],
            ...fields,
            id, // never allow id to be overwritten
            meta: {
                ..._vault.entries[idx].meta,
                ...(fields.meta ?? {}),
                updatedAt: new Date().toISOString(),
            },
        };
        await _persist();
        return _vault.entries[idx];
    };

    // ── deleteEntry ────────────────────────────────────────────────────────────
    const deleteEntry = async (id) => {
        if (!isUnlocked()) throw new Error('Vault is locked');
        const before = _vault.entries.length;
        _vault.entries = _vault.entries.filter(e => e.id !== id);
        if (_vault.entries.length === before) throw new Error(`Entry not found: ${id}`);
        await _persist();
        return { ok: true };
    };

    // ── _persist ───────────────────────────────────────────────────────────────
    // Private: encrypt and write vault to disk.
    // Called after every mutation. Atomic-ish: we encrypt to memory first,
    // then write. A crash during writeFile leaves a partially-written file,
    // which we'll address with atomic writes (write-then-rename) in a future phase.
    const _persist = async () => {
        const plaintext = JSON.stringify(_vault);
        const envelope  = await encrypt(plaintext, _password);
        await writeFile(vaultPath, JSON.stringify(envelope, null, 2), 'utf8');
    };

    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        isUnlocked,
        vaultExists,
        create,
        unlock,
        lock,
        getEntries,
        addEntry,
        updateEntry,
        deleteEntry,
    };
};