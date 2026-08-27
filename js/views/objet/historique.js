// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/historique.js : écran Mise à jour / historique (2f).
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { fmtDateTime, ACT_LABELS, actorBadge, evDetailBits, mdToHtml } from '../../core/format.js';
import { loadViewCss } from '../../core/css.js';
import { O, hooks } from './etat.js';

await loadViewCss('objet-suivi');

const PASSES = [
  { key: 'r1', short: 'R1', long: 'Identification' },
  { key: 'r2', short: 'R2', long: 'Recherche artiste' },
  { key: 'valo', short: '', long: 'Valorisation' },
  { key: 'r3', short: 'R3', long: 'Rewriting' },
];

function fmtShortDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${heure}`;
}

function passeBadge({ state, date }, short, long) {
  if (state === 'done') {
    return `<div class="pipe-cell pipe-done"><div class="pipe-label">${esc(short ? `${short} · ${long}` : long)}</div><div class="pipe-state">✓ ${fmtShortDateTime(date)}</div></div>`;
  }
  if (state === 'pending') {
    return `<div class="pipe-cell pipe-pending"><div class="pipe-label">${esc(short ? `${short} · ${long}` : long)}</div><div class="pipe-state">en cours · ${fmtShortDateTime(date) || '—'}</div></div>`;
  }
  return `<div class="pipe-cell pipe-todo"><div class="pipe-label">${esc(short ? `${short} · ${long}` : long)}</div><div class="pipe-state">—</div></div>`;
}

function ficheTechnique() {
  const f = O.fiche;
  if (!f) return '<div class="tech-empty">Aucune fiche IA versionnée enregistrée.</div>';
  const html = mdToHtml(f.contenu_md || f.contenu || '');
  return `
    <div class="tech-meta">
      <span>version ${esc(f.version ?? '—')}</span>
      <span>${esc(f.modele ?? 'IA')}</span>
      <span>${fmtDateTime(f.created_at)}</span>
    </div>
    <div class="tech-md">${html}</div>`;
}

export function rendre(el) {
  const o = S.currentObjet;
  const pipe = O.pipe ?? { r1: { state: 'todo' }, r2: { state: 'todo' }, valo: { state: 'todo' }, r3: { state: 'todo' } };

  const journal = O.events.map(ev => {
    const bits = evDetailBits(ev.detail ?? {});
    return `
      <article class="hist-card">
        <div class="hist-head">
          <span class="hist-title">${esc(ACT_LABELS[ev.action] ?? ev.action)}</span>
          <span class="hist-date">${fmtDateTime(ev.created_at)}</span>
          ${actorBadge(ev.acteur ?? '')}
        </div>
        ${bits.length ? `<div class="hist-body">${bits.map(b => `<div class="hist-bit">${b}</div>`).join('')}</div>` : ''}
      </article>`;
  }).join('');

  el.innerHTML = `
    <div class="obj-screen suivi-screen">
      <nav class="obj-nav">
        <button class="obj-nav-back" data-action="nav" data-ecran="hub">← Fiche</button>
        <span class="obj-nav-title">Mise à jour</span>
        <span class="obj-nav-meta">${O.events.length} étape${O.events.length > 1 ? 's' : ''}</span>
      </nav>

      <div class="obj-screen-body suivi-body">
        <section class="pipe-grid" aria-label="Passes IA">
          ${PASSES.map(p => passeBadge(pipe[p.key], p.short, p.long)).join('')}
        </section>

        <section class="hist-list" aria-label="Journal">
          ${journal || '<div class="obj-stub">Aucun événement tracé pour l’instant.</div>'}
        </section>

        <details class="tech-details">
          <summary class="tech-summary">
            <span>détails techniques</span>
            <span class="tech-chev">›</span>
          </summary>
          <div class="tech-panel">
            ${ficheTechnique()}
          </div>
        </details>
      </div>
    </div>`;

  el.querySelector('[data-action="nav"]')?.addEventListener('click', () => hooks.naviguer('hub'));
}
