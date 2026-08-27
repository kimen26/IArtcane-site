// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/description.js : écran Description (stub HO-046).
// Version complète avec texte IA + description maison : HO-049.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { hooks } from './etat.js';

export function rendre(el) {
  const o = S.currentObjet;
  el.innerHTML = `
    <div class="obj-screen">
      <nav class="obj-nav">
        <button class="obj-nav-back" data-action="nav" data-ecran="hub">← Fiche</button>
        <span class="obj-nav-title">Description</span>
        <span class="obj-nav-meta">#${esc(o.id)}</span>
      </nav>
      <div class="obj-screen-body">
        <div class="obj-stub">Écran en chantier — HO-049</div>
        <div class="obj-desc-full">${o.description ? esc(o.description) : '<span class="miss">Pas encore de description</span>'}</div>
      </div>
    </div>`;
  el.querySelector('[data-action="nav"]')?.addEventListener('click', () => hooks.naviguer('hub'));
}
