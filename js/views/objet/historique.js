// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/historique.js : écran Mise à jour / historique (HO-046).
// Version minimaliste : journal chronologique existant. Grille des passes +
// présentation champ-par-champ : HO-049.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { fmtDateTime, ACT_LABELS, actorBadge, evDetailBits } from '../../core/format.js';
import { O, hooks } from './etat.js';

export function rendre(el) {
  const o = S.currentObjet;
  const rows = O.events.map(ev => {
    const bits = evDetailBits(ev.detail ?? {});
    return `<div class="ev-row">
      <span class="ev-date">${fmtDateTime(ev.created_at)}</span>
      <span class="ev-act">${esc(ACT_LABELS[ev.action] ?? ev.action)}</span>
      ${actorBadge(ev.acteur ?? '')}
      <div class="ev-det">${bits.map(b => `<div class="ev-bit">${b}</div>`).join('')}</div>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="obj-screen">
      <nav class="obj-nav">
        <button class="obj-nav-back" data-action="nav" data-ecran="hub">← Fiche</button>
        <span class="obj-nav-title">Mise à jour</span>
        <span class="obj-nav-meta">${O.events.length} étape${O.events.length > 1 ? 's' : ''}</span>
      </nav>
      <div class="obj-screen-body">
        <div class="ev-list">${rows || '<div class="obj-stub">Aucun événement tracé pour l’instant.</div>'}</div>
      </div>
    </div>`;
  el.querySelector('[data-action="nav"]')?.addEventListener('click', () => hooks.naviguer('hub'));
}
