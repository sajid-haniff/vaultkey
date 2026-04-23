// src/main/ipc-handlers.js
//
// Centralising all ipcMain.handle registrations keeps main.js clean
// and makes the full IPC surface area auditable in one file.
// Every handler follows the same pattern:
//   1. Validate inputs
//   2. Call vault store
//   3. Return a plain serialisable result
//   4. Never throw raw errors to renderer — wrap them

import { ipcMain, app } from 'electron';

// registerHandlers: call once from main.js after app is ready.
// Takes the vaultStore instance — no global state.
export const registerHandlers = (vaultStore) => {

    // ── Utility: safe handler wrapper ────────────────────────────────────────
    // Wraps every handler so errors become { ok: false, error: string }
    // instead of unhandled rejections that crash the app.
    // The renderer always receives a plain object — never a thrown error.
    const handle = (channel, fn) => {
        ipcMain.handle(channel, async (_event, ...args) => {
            try {
                const result = await fn(...args);
                return { ok: true, ...result };
            } catch (err) {
                // Log server-side (main process) but send a safe message to renderer.
                // Never send stack traces or internal paths to the renderer.
                console.error(`[IPC:${channel}] ${err.message}`);
                return { ok: false, error: err.message };
            }
        });
    };

    // ── App ────────────────────────────────────────────────────────────────────
    ipcMain.handle('app:version', () => app.getVersion());

    // ── Vault lifecycle ────────────────────────────────────────────────────────

    handle('vault:exists', async () => {
        const exists = await vaultStore.vaultExists();
        return { exists };
    });

    handle('vault:create', async (password) => {
        if (typeof password !== 'string' || password.length < 8)
            throw new Error('Master password must be at least 8 characters');
        return vaultStore.create(password);
    });

    handle('vault:unlock', async (password) => {
        if (typeof password !== 'string' || !password)
            throw new Error('Password required');
        return vaultStore.unlock(password);
    });

    handle('vault:lock', () => vaultStore.lock());

    handle('vault:is-unlocked', async () => ({
        unlocked: vaultStore.isUnlocked()
    }));

    // ── CRUD ───────────────────────────────────────────────────────────────────

    handle('vault:get-entries', async () => {
        const entries = vaultStore.getEntries();
        return { entries };
    });

    handle('vault:add-entry', async (fields) => {
        // Basic input validation at the trust boundary
        if (!fields || typeof fields !== 'object')
            throw new Error('Invalid entry data');
        const entry = await vaultStore.addEntry(fields);
        return { entry };
    });

    handle('vault:update-entry', async (id, fields) => {
        if (typeof id !== 'string' || !id)
            throw new Error('Entry id required');
        if (!fields || typeof fields !== 'object')
            throw new Error('Invalid entry data');
        const entry = await vaultStore.updateEntry(id, fields);
        return { entry };
    });

    handle('vault:delete-entry', async (id) => {
        if (typeof id !== 'string' || !id)
            throw new Error('Entry id required');
        return vaultStore.deleteEntry(id);
    });
};