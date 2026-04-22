// src/renderer/renderer.js
//
// This file runs in the renderer process. It is UNTRUSTED from the main
// process's perspective. It has zero access to Node.js, Electron APIs,
// or the filesystem — only to the DOM and window.vaultAPI (our bridge).
//
// Treat this file like you'd treat client-side code on a public website.

// ── Seed data ─────────────────────────────────────────────────────────────────
// Placeholder entries so the UI is not empty. Phase 2 will replace this
// with real vault data read from an encrypted file via IPC.
const SEED_ENTRIES = [
    { id: 1, title: 'Twitter / X',  username: 'johndoe@gmail.com', category: 'Social',    twofa: true,  strength: 'excellent', active: true  },
    { id: 2, title: 'Chase Bank',   username: 'john.doe',          category: 'Finance',   twofa: true,  strength: 'excellent', active: false },
    { id: 3, title: 'Gmail',        username: 'johndoe@gmail.com', category: 'Email',     twofa: true,  strength: 'good',      active: false },
    { id: 4, title: 'Amazon',       username: 'johndoe@gmail.com', category: 'Shopping',  twofa: false, strength: 'weak',      active: false },
    { id: 5, title: 'GitHub',       username: 'johndoe-dev',       category: 'Developer', twofa: true,  strength: 'excellent', active: false },
    { id: 6, title: 'Coinbase',     username: 'johndoe@proton.me', category: 'Finance',   twofa: true,  strength: 'excellent', active: false },
    { id: 7, title: 'Discord',      username: 'johndoe#1234',      category: 'Social',    twofa: false, strength: 'good',      active: false },
    { id: 8, title: 'Netflix',      username: 'johndoe@gmail.com', category: 'Streaming', twofa: false, strength: 'good',      active: false },
];

// ── Strength → color mapping ──────────────────────────────────────────────────
const STRENGTH_COLOR = {
    excellent: '#4ade80',
    good:      '#f59e0b',
    weak:      '#ef4444',
};

// ── renderEntries ─────────────────────────────────────────────────────────────
// Pure function: given an array of entries, returns an HTML string.
// Separating data → HTML transformation from DOM mutation is cleaner and testable.
const entryToHTML = (entry) => `
  <li class="entry-item ${entry.active ? 'active' : ''}" data-id="${entry.id}">
    <div class="entry-avatar" style="background: ${avatarColor(entry.title)}">
      ${entry.title[0]}
    </div>
    <div class="entry-info">
      <span class="entry-title">${entry.title}</span>
      <span class="entry-username">${entry.username}</span>
    </div>
    <div class="entry-meta">
      ${entry.twofa ? '<span class="twofa-badge">2FA</span>' : ''}
      <span class="strength-dot" style="background:${STRENGTH_COLOR[entry.strength]}"></span>
    </div>
  </li>
`;

// Deterministic color from a string — gives each entry a unique avatar color
const avatarColor = (str) => {
    const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];
    const hash = [...str].reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return colors[hash % colors.length];
};

// ── DOM initialization ────────────────────────────────────────────────────────
const init = async () => {
    // Render entries list
    const list = document.getElementById('entries-list');
    list.innerHTML = SEED_ENTRIES.map(entryToHTML).join('');

    // Entry click → highlight selected (detail pane will expand in Phase 2)
    list.addEventListener('click', (e) => {
        const item = e.target.closest('.entry-item');
        if (!item) return;
        document.querySelectorAll('.entry-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
    });

    // ── IPC round-trip: get app version from main process ─────────────────────
    // window.vaultAPI is our preload bridge. We call it like a normal async function.
    // Under the hood: renderer → ipcRenderer.invoke → main ipcMain.handle → return.
    try {
        const version = await window.vaultAPI.getAppVersion();
        document.getElementById('app-version').textContent = version;
    } catch (err) {
        console.error('IPC call failed:', err);
    }
};

// Run after DOM is ready
document.addEventListener('DOMContentLoaded', init);