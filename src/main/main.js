// src/main/main.js

import { app, BrowserWindow, session } from 'electron';
import { join, dirname }               from 'path';
import { fileURLToPath }               from 'url';
import { registerHandlers }            from './ipc-handlers.js';
import { createVaultStore }            from './vault-store.js';

// ESM doesn't have __dirname — we reconstruct it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

// ── Vault store ─────────────────────────────────────────────────────────────
// app.getPath('userData') → ~/.config/vaultkey on Linux
// We instantiate once; ipc-handlers closes over this instance.
// The path isn't available until app emits 'ready', so we initialise lazily.
let vaultStore;

// ── createWindow ─────────────────────────────────────────────────────────────
const createWindow = () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [[
                    "default-src 'self' file:",
                    "script-src 'self' file:",
                    "style-src 'self' file: 'unsafe-inline'",
                    "img-src 'self' file: data:",
                    "font-src 'self' file: data:",
                ].join('; ')],
            },
        });
    });

    const win = new BrowserWindow({
        width:           1280,
        height:          800,
        minWidth:        960,
        minHeight:       620,
        backgroundColor: '#090b10',
        show:            false,
        titleBarStyle:   process.platform === 'linux' ? 'default' : 'hiddenInset',
        webPreferences: {
            preload:                  join(__dirname, '../preload/preload.js'),
            contextIsolation:         true,
            nodeIntegration:          false,
            sandbox:                  true,
            webSecurity:              true,
            allowRunningInsecureContent: false,
        },
    });

    win.loadFile(join(__dirname, '../renderer/index.html'));

    win.once('ready-to-show', () => {
        win.show();
        if (isDev) win.webContents.openDevTools({ mode: 'detach' });
    });

    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
            console.warn(`[SECURITY] Blocked navigation to: ${url}`);
        }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    return win;
};

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    // Now safe to call app.getPath
    const vaultPath = join(app.getPath('userData'), 'vault.vk');
    vaultStore = createVaultStore(vaultPath);

    registerHandlers(vaultStore);
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});