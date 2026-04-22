// src/main/main.js
//
// The main process is the privileged backend of our Electron app.
// It runs in Node.js, owns the OS, and creates browser windows.
// Think of it as a server that happens to spawn its own client UI.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// ── Security note ─────────────────────────────────────────────────────────────
// We read NODE_ENV to make development-only decisions (DevTools, etc.).
// In production builds this will be 'production' or undefined.
const isDev = process.env.NODE_ENV === 'development';

// ── createWindow ──────────────────────────────────────────────────────────────
// A factory function (not a class) that creates and returns the main window.
// We keep this as a function so it's testable and composable.
const createWindow = () => {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#0d0f14',   // Prevents white flash before renderer loads
        titleBarStyle: 'hiddenInset', // Cleaner on macOS; no-op on Linux/Windows
        show: false,                  // Don't show until content is ready (prevents flash)

        webPreferences: {
            // ── CRITICAL SECURITY SETTINGS ────────────────────────────────────────
            //
            // preload: runs our bridge script before the renderer's JS executes.
            // It has access to a restricted Node surface, which we use to build
            // the contextBridge API. The renderer gets ONLY what we expose there.
            preload: path.join(__dirname, '../preload/preload.js'),

            // contextIsolation: true (DEFAULT since Electron 12, but we're explicit).
            // This creates a separate JavaScript context for the preload script.
            // Without it, the preload's `window` is the renderer's `window`,
            // meaning a compromised renderer could tamper with our bridge.
            contextIsolation: true,

            // nodeIntegration: false (DEFAULT, but again — explicit).
            // If true, every script in the renderer can do require('fs'),
            // require('child_process'), etc. That means XSS = full shell access.
            // Never enable this.
            nodeIntegration: false,

            // sandbox: true isolates the renderer process at the OS level.
            // It can't make syscalls directly; it goes through Chromium's broker.
            // This is defense-in-depth. Even if contextIsolation is somehow
            // bypassed, the renderer still can't touch the filesystem.
            sandbox: true,

            // Disallow loading remote content into the webview (belt and suspenders)
            webSecurity: true,

            // Prevent navigation to remote URLs from within the renderer
            allowRunningInsecureContent: false,
        },
    });

    // ── Content Security Policy ───────────────────────────────────────────────
    // Set CSP headers on every response the renderer receives.
    // This prevents inline scripts, remote scripts, and external resources
    // from loading — a critical XSS mitigation layer.
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"
                ],
            },
        });
    });

    // ── Load the UI ───────────────────────────────────────────────────────────
    // We load a local HTML file. We will NEVER load a remote URL for the main UI.
    // A remote URL would be a massive attack surface for a password manager.
    win.loadFile(path.join(__dirname, '../renderer/index.html'));

    // ── Show window only when ready ───────────────────────────────────────────
    // 'ready-to-show' fires after the first paint. This eliminates the white
    // flash that occurs if you call win.show() immediately.
    win.once('ready-to-show', () => {
        win.show();
        if (isDev) {
            win.webContents.openDevTools({ mode: 'detach' });
        }
    });

    // ── Prevent navigation away from our local file ───────────────────────────
    // If any code in the renderer tries to navigate to an external URL
    // (e.g., via window.location or a link click), we block it.
    win.webContents.on('will-navigate', (event, url) => {
        const localUrl = `file://${path.resolve(__dirname, '../../renderer/index.html')}`;
        if (url !== localUrl) {
            event.preventDefault();
            // In production: log this as a security event
            console.warn(`[SECURITY] Blocked navigation attempt to: ${url}`);
        }
    });

    // Prevent new windows from opening (e.g., target="_blank" links)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    return win;
};

// ── App lifecycle ─────────────────────────────────────────────────────────────
// Electron fires 'ready' when the OS is ready to create windows.
// Before this event, you cannot create BrowserWindows.
app.whenReady().then(() => {
    createWindow();

    // macOS behavior: re-create window when dock icon is clicked and no windows exist
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed (standard on Linux/Windows)
// macOS keeps the app running in the dock even with no windows — hence the check
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ─────────────────────────────────────────────────────────────
// ipcMain.handle registers async request/response handlers.
// The renderer calls window.vaultAPI.getAppVersion() (defined in preload),
// which sends an IPC message here. We handle it and return the value.
// The renderer never touches `app` directly — it only sees what we return.
ipcMain.handle('app:get-version', () => app.getVersion());

// This is our zero-trust IPC pattern:
// 1. Renderer calls a named preload function
// 2. Preload validates and forwards via ipcRenderer.invoke
// 3. Main handles via ipcMain.handle, does the privileged work
// 4. Return value travels back through the same channel
// At no point does the renderer have direct access to Node or Electron APIs.