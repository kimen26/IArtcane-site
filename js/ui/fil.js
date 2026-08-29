// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/fil.js : fil d'Ariane, gabarit UNIQUE du site (HO-100).
// Brique pure : props → HTML. Zéro Supabase, zéro état global.
//
// Remplace la navigation ascendante posée par chaque territoire (`.back` du
// shell, `obj-nav-back`, `art-nav-back`, `ms-back`) — arbitrage Yann 2026-08-29
// (docs/architecture-briques.md §2.1) : le fil d'Ariane REMPLACE le bouton
// retour, il n'y a plus de bouton retour nulle part. Migration des vues :
// HO-104, hors périmètre ici.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../core/dom.js';

const SEP = '<span class="ui-fil-sep" aria-hidden="true">›</span>';

/**
 * @param {Array<{label:string, hash?:string}>} segments — hiérarchie, racine → page courante.
 *   Le DERNIER segment est la page courante : rendu non cliquable même si `hash` est fourni.
 *   Un segment intermédiaire sans `hash` est aussi rendu en texte (jamais un lien mort).
 * @returns {string} HTML, ou '' si segments vide/absent (pas de bande vide).
 */
export function fil(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '';

  const dernier = segments.length - 1;
  const parts = segments.map((s, i) => {
    const label = esc(s?.label);
    const estCourant = i === dernier || !s?.hash;
    if (estCourant) {
      // aria-current="page" réservé au segment réellement courant (le dernier) —
      // un segment intermédiaire sans hash est du texte non cliquable, pas « la page ».
      const aria = i === dernier ? ' aria-current="page"' : '';
      return `<span class="ui-fil-courant"${aria}>${label}</span>`;
    }
    return `<a class="ui-fil-lien" href="${esc(s.hash)}">${label}</a>`;
  });

  return `<nav class="ui-fil" aria-label="Fil d'Ariane">${parts.join(SEP)}</nav>`;
}
