// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/identification.js : écran Identification (stub HO-046).
// Version complète avec champs, pastilles, suggestions : HO-048.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { hooks, CHAMPS_VALIDABLES, pastilleHtml } from './etat.js';

export function rendre(el) {
  const o = S.currentObjet;
  el.innerHTML = `
    <div class="obj-screen">
      <nav class="obj-nav">
        <button class="obj-nav-back" data-action="nav" data-ecran="hub">← Fiche</button>
        <span class="obj-nav-title">Identification</span>
        <span class="obj-nav-meta">#${esc(o.id)}</span>
      </nav>
      <div class="obj-screen-body">
        <div class="obj-stub">Écran en chantier — HO-048</div>
        <div class="obj-id-list">
          ${CHAMPS_VALIDABLES.map(ch => `
            <div class="obj-id-row">
              <span class="obj-id-label">${esc(ch)}</span>
              <span class="obj-id-val">${valeurChamp(ch, o)}</span>
              ${pastilleHtml(ch)}
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  el.querySelectorAll('[data-action="nav"]').forEach(b => b.addEventListener('click', () => hooks.naviguer('hub')));
  el.querySelectorAll('[data-action="toggle-val"]').forEach(b => b.addEventListener('click', () => {
    toggleValidation(b.dataset.champ);
  }));
}

function valeurChamp(ch, o) {
  if (ch === 'dimensions') {
    const parts = [];
    if (o.hauteur_cm != null) parts.push(`H ${o.hauteur_cm}`);
    if (o.largeur_cm != null) parts.push(`L ${o.largeur_cm}`);
    if (o.profondeur_cm != null) parts.push(`P ${o.profondeur_cm}`);
    return parts.length ? esc(parts.join(' × ') + ' cm') : '<span class="miss">—</span>';
  }
  if (ch === 'prix') return o.prix_bas != null ? `${o.prix_bas}–${o.prix_haut} €` : '<span class="miss">—</span>';
  return o[ch] ? esc(o[ch]) : '<span class="miss">—</span>';
}
