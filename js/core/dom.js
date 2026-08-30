// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/dom.js : utilitaires DOM & échappement (D-039)
// ═══════════════════════════════════════════════════════════════════════════

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Implémentation déplacée dans feedback.js (HO-075, socle toast/enregistrer/withBusy) —
// re-export pour ne pas casser les 20 appelants historiques qui importent d'ici.
export { toast, humaniser } from './feedback.js';

export const emptyHtml = (t, s, action = '') => `<div class="empty"><div class="big">🗃️</div><h2>${esc(t)}</h2><p>${esc(s)}</p>${action}</div>`;
