// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/photos.js : écran Photos de la fiche (stub HO-046).
// Version complète gérant tags, ordre, caméra, lightbox : HO-047.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { isVideo } from '../../core/format.js';
import { O, hooks } from './etat.js';

export function rendre(el) {
  const o = S.currentObjet;
  const n = O.photos.length;
  el.innerHTML = `
    <div class="obj-screen">
      <nav class="obj-nav">
        <button class="obj-nav-back" data-action="nav" data-ecran="hub">← Fiche</button>
        <span class="obj-nav-title">Photos</span>
        <span class="obj-nav-meta">${n}</span>
      </nav>
      <div class="obj-screen-body">
        <div class="obj-stub">Écran en chantier — HO-047</div>
        <div class="obj-photo-grid">
          ${O.photos.map((p, i) => `
            <div class="obj-photo-thumb" title="${esc(p.kind)}">
              ${p.thumbUrl
                ? (isVideo(p) ? '🎬' : `<img src="${esc(p.thumbUrl)}" alt="${esc(p.kind)}" loading="lazy" decoding="async">`)
                : '📷'}
              ${p.couverture ? '<span class="obj-thumb-star">★</span>' : ''}
              ${p.remarque_statut === 'en_attente' || p.kind === 'autre' ? '<span class="obj-thumb-warn">!</span>' : ''}
              <span class="obj-thumb-kind">${esc(p.kind)}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  el.querySelector('[data-action="nav"]')?.addEventListener('click', () => hooks.naviguer('hub'));
}
