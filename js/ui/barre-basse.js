// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/barre-basse.js : barre d'actions du bas, gabarit UNIQUE (HO-100).
// Brique pure : props → HTML + câblage par délégation. Remplace `rendreBarreBasse`
// réécrite trois fois (objet, artiste, capture — docs/architecture-briques.md §2.2).
// Migration des vues : HO-104/106, hors périmètre ici.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../core/dom.js';

/**
 * @param {Array<{label:string, type?:'primaire'|'plat'|'danger', plein?:boolean,
 *                  desactive?:boolean, lecteurCache?:boolean, onClick:Function}>} actions
 * @returns {{html:string, bind:(racine:HTMLElement)=>void}}
 */
export function barreBasse(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { html: '', bind: () => {} };
  }

  const html = `<div class="ui-barre">${actions.map((a, i) => {
    const classes = ['ui-barre-btn', `ui-barre-btn--${a.type || 'plat'}`];
    if (a.plein) classes.push('ui-barre-btn--plein');
    if (a.lecteurCache) classes.push('hide-lecteur'); // masqué par le CSS transverse existant
    const disabled = a.desactive ? ' disabled' : '';
    return `<button type="button" class="${classes.join(' ')}" data-ui-action="${i}"${disabled}>${esc(a.label)}</button>`;
  }).join('')}</div>`;

  // Une seule délégation sur `.ui-barre` — jamais un listener par bouton.
  const bind = (racine) => {
    const conteneur = racine?.querySelector ? racine.querySelector('.ui-barre') : null;
    if (!conteneur?.addEventListener) return;
    conteneur.addEventListener('click', (evt) => {
      const cible = evt.target?.closest ? evt.target.closest('[data-ui-action]') : null;
      if (!cible) return;
      const i = Number(cible.getAttribute('data-ui-action'));
      const action = actions[i];
      if (action && !action.desactive) action.onClick(evt);
    });
  };

  return { html, bind };
}
