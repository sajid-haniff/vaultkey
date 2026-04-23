// src/renderer/renderer.js
// Renderer process — untrusted, no Node access.
// Communicates exclusively through window.vaultAPI.

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const SCORE_COLOR = {
    excellent: '#3dd68c',
    good:      '#f0a53a',
    weak:      '#f05c5c',
    breach:    '#f05c5c',
};

const AVATAR_COLORS = [
    '#6366f1','#7c6aff','#ec4899','#f0a53a',
    '#10b981','#4f8ef7','#ef4444','#14b8a6',
];

// ── Pure helpers ─────────────────────────────────────────────────────────────
const avatarColor = (str) => {
    const n = [...str].reduce((a, c) => a + c.charCodeAt(0), 0);
    return AVATAR_COLORS[n % AVATAR_COLORS.length];
};

const $ = (id) => document.getElementById(id);

const show   = (id) => $(id).classList.remove('hidden');
const hide   = (id) => $(id).classList.add('hidden');
const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };

// ── Unlock screen ────────────────────────────────────────────────────────────
const initUnlockScreen = async () => {
    const { exists } = await window.vaultAPI.vaultExists();
    const isNew = !exists;

    setText('unlock-sub',  isNew ? 'Create a master password to get started' : 'Enter your master password');
    setText('unlock-btn-label', isNew ? 'Create Vault' : 'Unlock Vault');
    if (isNew) setText('unlock-hint', 'Use a strong password — it protects everything.');

    const doUnlock = async () => {
        const pw = $('master-password').value.trim();
        if (!pw) return;

        $('unlock-btn').disabled = true;
        setText('unlock-btn-label', isNew ? 'Creating…' : 'Unlocking…');
        $('unlock-error').textContent = '';

        const result = isNew
            ? await window.vaultAPI.createVault(pw)
            : await window.vaultAPI.unlockVault(pw);

        if (result.ok) {
            hide('unlock-screen');
            show('app-shell');
            await loadVault();
        } else {
            $('unlock-error').textContent = result.error ?? 'Incorrect password';
            $('unlock-btn').disabled = false;
            setText('unlock-btn-label', isNew ? 'Create Vault' : 'Unlock Vault');
            $('master-password').value = '';
            $('master-password').focus();
        }
    };

    $('unlock-btn').addEventListener('click', doUnlock);
    $('master-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doUnlock();
    });

    $('master-password').focus();
};

// ── Vault rendering ──────────────────────────────────────────────────────────
let _entries = [];

const loadVault = async () => {
    const result = await window.vaultAPI.getEntries();
    if (!result.ok) return;
    _entries = result.entries;
    renderAll(_entries);
    updateMetrics(_entries);
    updateBadges(_entries);
};

const renderAll = (entries) => {
    const list = $('entries-list');
    setText('list-header', `${entries.length} ENTRIES`);

    if (!entries.length) {
        list.innerHTML = '<li class="entries-empty">No entries yet</li>';
        return;
    }

    list.innerHTML = entries
        .map((e, i) => entryHTML(e, i === 0))
        .join('');
};

const entryHTML = (e, active = false) => `
  <li class="entry-item${active ? ' active' : ''}" data-id="${e.id}">
    <div class="entry-avatar" style="background:${avatarColor(e.title)}">${e.title[0]}</div>
    <div class="entry-info">
      <span class="entry-title">${e.title}</span>
      <span class="entry-username">${e.core?.username ?? '—'}</span>
    </div>
    <div class="entry-meta">
      ${e.auth?.twofa?.enabled ? '<span class="badge-2fa">2FA</span>' : ''}
      ${e.meta?.strength
    ? `<span class="strength-dot" style="background:${SCORE_COLOR[e.meta.strength] ?? '#4a5075'}"></span>`
    : '<span class="strength-dot" style="background:#4a5075"></span>'
}
    </div>
  </li>
`;

const updateMetrics = (entries) => {
    const strong = entries.filter(e => e.meta?.strength === 'excellent').length;
    const weak   = entries.filter(e => e.meta?.strength === 'weak').length;
    const twofa  = entries.filter(e => e.auth?.twofa?.enabled).length;
    setText('m-total',  entries.length);
    setText('m-strong', strong);
    setText('m-weak',   weak);
    setText('m-2fa',    twofa);
};

const updateBadges = (entries) => {
    setText('badge-all', entries.length);
};

// ── Entry selection ──────────────────────────────────────────────────────────
$('entries-list').addEventListener('click', (e) => {
    const item = e.target.closest('.entry-item');
    if (!item) return;
    document.querySelectorAll('.entry-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    const entry = _entries.find(en => en.id === item.dataset.id);
    if (entry) renderDetail(entry);
});

const renderDetail = (entry) => {
    hide('detail-empty');
    const pane = $('detail-pane');

    // Remove any existing detail view
    const old = pane.querySelector('.detail-view');
    if (old) old.remove();

    const div = document.createElement('div');
    div.className = 'detail-view';
    div.innerHTML = `
    <div class="detail-header">
      <div class="detail-avatar" style="background:${avatarColor(entry.title)}">${entry.title[0]}</div>
      <div class="detail-title-group">
        <h2 class="detail-name">${entry.title}</h2>
        <a class="detail-url" href="#">${entry.core?.url || 'No URL'}</a>
      </div>
      <div class="detail-actions">
        <button class="btn-icon" data-action="delete" data-id="${entry.id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="detail-tags">
      ${(entry.meta?.tags ?? []).map(t => `<span class="tag">#${t}</span>`).join('')}
      ${entry.category ? `<span class="tag">#${entry.category.toLowerCase()}</span>` : ''}
    </div>

    <div class="detail-section">
      <div class="detail-field">
        <span class="detail-field-label">USERNAME / EMAIL</span>
        <div class="detail-field-value">${entry.core?.username || '—'}</div>
      </div>
      <div class="detail-field">
        <span class="detail-field-label">PASSWORD</span>
        <div class="detail-field-value password-masked" id="pw-display">
          ${'•'.repeat(Math.min((entry.core?.password?.length ?? 0) + 4, 18))}
        </div>
      </div>
      ${entry.core?.url ? `
      <div class="detail-field">
        <span class="detail-field-label">WEBSITE URL</span>
        <div class="detail-field-value url-value">${entry.core.url}</div>
      </div>` : ''}
      ${entry.auth?.twofa?.enabled ? `
      <div class="detail-field">
        <span class="detail-field-label">TWO-FACTOR AUTH</span>
        <div class="detail-field-value twofa-value">
          ✓ Enabled — ${entry.auth.twofa.type?.toUpperCase() ?? 'TOTP'}
        </div>
      </div>` : ''}
      ${entry.core?.notes ? `
      <div class="detail-field">
        <span class="detail-field-label">NOTES</span>
        <div class="detail-field-value notes-value">${entry.core.notes}</div>
      </div>` : ''}
    </div>
  `;

    // Delete handler
    div.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        if (!confirm(`Delete "${entry.title}"?`)) return;
        const r = await window.vaultAPI.deleteEntry(entry.id);
        if (r.ok) {
            div.remove();
            show('detail-empty');
            await loadVault();
        }
    });

    pane.appendChild(div);
};

// ── Category filter ───────────────────────────────────────────────────────────
$('nav-categories').addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item[data-category]');
    if (!item) return;
    document.querySelectorAll('#nav-categories .nav-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    const cat = item.dataset.category;
    const filtered = cat === 'all' ? _entries : _entries.filter(en => en.category === cat);
    renderAll(filtered);
});

// ── Search ────────────────────────────────────────────────────────────────────
$('search-input').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = q
        ? _entries.filter(en =>
            en.title.toLowerCase().includes(q) ||
            (en.core?.username ?? '').toLowerCase().includes(q) ||
            (en.core?.url ?? '').toLowerCase().includes(q)
        )
        : _entries;
    renderAll(filtered);
});

// ── Lock vault ────────────────────────────────────────────────────────────────
$('btn-lock').addEventListener('click', async () => {
    await window.vaultAPI.lockVault();
    _entries = [];
    hide('app-shell');
    $('master-password').value = '';
    show('unlock-screen');
    await initUnlockScreen();
});

// ── Add entry modal ───────────────────────────────────────────────────────────
const openModal  = () => { show('modal-overlay'); $('f-title').focus(); };
const closeModal = () => {
    hide('modal-overlay');
    ['f-title','f-username','f-password','f-url','f-notes'].forEach(id => $(id).value = '');
    $('f-category').selectedIndex = 0;
};

$('btn-add-entry').addEventListener('click', openModal);
$('modal-close').addEventListener('click',  closeModal);
$('btn-cancel').addEventListener('click',   closeModal);

$('modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('modal-overlay')) closeModal();
});

$('btn-save').addEventListener('click', async () => {
    const title = $('f-title').value.trim();
    if (!title) { $('f-title').focus(); return; }

    const result = await window.vaultAPI.addEntry({
        title,
        category: $('f-category').value,
        core: {
            username: $('f-username').value.trim(),
            password: $('f-password').value,
            url:      $('f-url').value.trim(),
            notes:    $('f-notes').value.trim(),
        },
    });

    if (result.ok) {
        closeModal();
        await loadVault();
    }
});

// ── Version ───────────────────────────────────────────────────────────────────
window.vaultAPI.getVersion().then(v => setText('app-version', `v${v}`));

// ── Boot ──────────────────────────────────────────────────────────────────────
// Check if vault is already unlocked (e.g., after a hot-reload in dev).
// Otherwise start with the unlock screen.
const boot = async () => {
    const { unlocked } = await window.vaultAPI.isUnlocked();
    if (unlocked) {
        hide('unlock-screen');
        show('app-shell');
        await loadVault();
    } else {
        await initUnlockScreen();
    }
};

document.addEventListener('DOMContentLoaded', boot);