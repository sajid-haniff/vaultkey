// src/preload/preload.js
//
// Preload scripts with sandbox:true cannot use ESM import syntax —
// they are loaded by Chromium via a special require shim that only
// supports CommonJS. This is a known Electron constraint.
// We keep CommonJS here ONLY in this file, for this reason.
// Everything else in the project uses ESM.

const { contextBridge, ipcRenderer } = require('electron');

// ── Safe invoke wrapper ───────────────────────────────────────────────────
// Every call goes through this. It ensures we never accidentally expose
// ipcRenderer itself, and gives us a place to add logging/validation later.
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('vaultAPI', {
    // App
    getVersion:     ()           => invoke('app:version'),

    // Vault lifecycle
    vaultExists:    ()           => invoke('vault:exists'),
    createVault:    (password)   => invoke('vault:create',     password),
    unlockVault:    (password)   => invoke('vault:unlock',     password),
    lockVault:      ()           => invoke('vault:lock'),
    isUnlocked:     ()           => invoke('vault:is-unlocked'),

    // CRUD
    getEntries:     ()           => invoke('vault:get-entries'),
    addEntry:       (fields)     => invoke('vault:add-entry',    fields),
    updateEntry:    (id, fields) => invoke('vault:update-entry', id, fields),
    deleteEntry:    (id)         => invoke('vault:delete-entry', id),
});