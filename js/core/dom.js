// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/dom.js : utilitaires DOM & échappement (D-039)
// ═══════════════════════════════════════════════════════════════════════════

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

export const emptyHtml = (t, s, action = '') => `<div class="empty"><div class="big">🗃️</div><h2>${esc(t)}</h2><p>${esc(s)}</p>${action}</div>`;
