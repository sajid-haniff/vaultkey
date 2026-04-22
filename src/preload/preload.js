// src/preload/preload.js
//
// The preload script runs in the renderer's context BEFORE any renderer JS,
// but it has access to a restricted Node.js surface (contextBridge, ipcRenderer).
//
// Its ONLY job: expose a narrow, explicit, validated API to the renderer.
// Think of it as the API contract between two untrusted parties.
//
// Rules for this file:
// - Only use contextBridge.exposeInMainWorld — never attach to window directly
// - Never expose ipcRenderer itself — that would let the renderer send arbitrary IPC
// - Never expose raw Node.js APIs (fs, path, child_process, etc.)
// - Validate all inputs before forwarding to main

const { contextBridge, ipcRenderer } = require('electron');

// ── vaultAPI ─────────────────────────────────────────────────────────────────
// This is the ENTIRE surface area the renderer has access to.
// Every function here is a deliberate, auditable decision.
// When we add features (vault read/write, password gen, etc.),
// we add them here explicitly — never by expanding access.

contextBridge.exposeInMainWorld('vaultAPI', {
    // Get the app version from the main process.
    // Demonstrates the full IPC round-trip: renderer → preload → main → preload → renderer.
    getAppVersion: () => ipcRenderer.invoke('app:get-version'),

    // Future expansion follows this exact same pattern:
    // someFeature: (validatedInput) => ipcRenderer.invoke('channel:name', validatedInput),
});

// ── Why 'vaultAPI' and not 'electron' or 'api'? ───────────────────────────────
// Naming matters. 'vaultAPI' is:
// - Specific to our application domain
// - Searchable in code (easy to audit all usages)
// - Unlikely to collide with browser globals
// - Self-documenting about what it is