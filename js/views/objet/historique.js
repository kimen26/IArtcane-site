// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/historique.js : écran Mise à jour / historique (2f).
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { fmtDateTime, ACT_LABELS, actorBadge, evDetailBits, mdToHtml } from '../../core/format.js';
import { loadViewCss } from '../../core/css.js';
import { page } from '../../ui/page.js';
import { grouperEvenements } from '../../services/historique.js';
import { O } from './etat.js';

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

// Libellé du compte d'un groupe de rafale : « N champs validés » est plus
// parlant que « N validations de champ » pour les 2-3 actions qui arrivent
// réellement en rafale — repli générique pour le reste (pas de table exhaustive
// des 20 actions).
function libelleGroupe(action, n) {
  switch (action) {
    case 'validation_champ': return `${n} champs validés`;
    case 'correction': return `${n} corrections`;
    case 'tag_photo': return `${n} photos taguées`;
    default: return `${n} × ${ACT_LABELS[action] ?? action}`;
  }
}

function carteEvenement(ev) {
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
}

function carteGroupe(g) {
  const plage = g.debut === g.fin
    ? fmtDateTime(g.fin)
    : `${fmtDateTime(g.debut)} → ${new Date(g.fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  return `
    <details class="hist-groupe">
      <summary class="hist-head hist-groupe-summary">
        <span class="hist-title">${esc(ACT_LABELS[g.action] ?? g.action)}</span>
        <span class="hist-groupe-compte">${esc(libelleGroupe(g.action, g.n))}</span>
        <span class="hist-date">${plage}</span>
        ${actorBadge(g.acteur ?? '')}
        <span class="tech-chev">›</span>
      </summary>
      <div class="hist-groupe-panel">
        ${g.evts.map(ev => carteEvenement(ev)).join('')}
      </div>
    </details>`;
}

export function rendre(el) {
  const o = S.currentObjet;
  const pipe = O.pipe ?? { r1: { state: 'todo' }, r2: { state: 'todo' }, valo: { state: 'todo' }, r3: { state: 'todo' } };

  const groupes = grouperEvenements(O.events);
  const journal = groupes.map(g => g.n > 1 ? carteGroupe(g) : carteEvenement(g.evts[0])).join('');

  // Le compteur d'en-tête devient trompeur une fois groupé : afficher le
  // nombre de groupes, et garder le total en second seulement s'ils diffèrent.
  const nGroupes = groupes.length;
  const nTotal = O.events.length;
  const meta = nGroupes === nTotal
    ? `${nTotal} étape${nTotal > 1 ? 's' : ''}`
    : `${nGroupes} étape${nGroupes > 1 ? 's' : ''} · ${nTotal} évènements`;

  const corps = page(el, {
    titre: 'Mise à jour',
    meta,
    fil: [...S.fil, { label: 'Mise à jour' }],
  });

  corps.innerHTML = `
    <div class="suivi-body">
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
    </div>`;
}
