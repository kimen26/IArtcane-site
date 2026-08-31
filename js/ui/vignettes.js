// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/vignettes.js : bande de vignettes carrées, brique pure
// (HO-106, docs/architecture-briques.md §2.2). Remplace rendreThumb/
// rendreGrille × 3 (objet/photos.js, artiste/images.js, capture/photos.js) et
// leurs trois familles de classes jumelles (préfixées par territoire) au
// profit de `ui-vign*`. Pure : zéro accès aux couches données/état/métier
// (règle de dépendance, docs/architecture-briques.md §2) — props en entrée,
// callbacks `sur.*` en sortie. La brique ignore kind/zone : elle reçoit
// `tag` (libellé déjà résolu, vide/absent = « à taguer »), la traduction
// métier reste dans la vue.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../core/dom.js';
import { loadViewCss } from '../core/css.js';
import { activerGlisser } from './glisser.js';

await loadViewCss('vignettes', 'ui');

function vignetteHtml(img, i, courante) {
  const selectionnee = i === courante;
  // Un seul signal « à traiter » (un point orange, rien d'autre — retour Yann
  // 2026-08-31, HO-114) : les deux vues d'origine pilotaient badge
  // d'avertissement, bannière et opacité atténuée avec la MÊME condition
  // (kind/zone absent) — cf. p.kind==null dans l'ancien objet/photos.js,
  // !p.zone dans l'ancien artiste/images.js. Le libellé « sans tag » en ambre
  // sous la vignette reste : ce n'est pas un signal de plus, c'est le texte.
  const sansTag = !img.tag;
  const libelleAria = img.tag ? `, ${img.tag}` : '';
  return `
    <div class="ui-vign ${selectionnee ? 'ui-vign--courante' : ''}"
      data-idx="${i}" role="listitem" tabindex="0" aria-label="Image ${i + 1}${esc(libelleAria)}">
      ${img.thumbUrl
        ? (img.video ? '<span class="ui-vign-vid">▶</span>' : `<img src="${esc(img.thumbUrl)}" alt="" loading="lazy" decoding="async" draggable="false">`)
        : '<span class="ui-vign-placeholder">📷</span>'}
      ${img.couverture ? '<span class="ui-vign-cover" aria-label="Couverture">★</span>' : ''}
      <span class="ui-vign-num">${i + 1}</span>
      ${sansTag ? '<span class="ui-vign-point" aria-label="À traiter"></span>' : ''}
      <span class="ui-vign-tag ${sansTag ? 'ui-vign-tag--warn' : ''}">${esc(img.tag || 'sans tag')}</span>
    </div>`;
}

/**
 * Bande de vignettes carrées : toutes les images, la courante en highlight,
 * badges (couverture, numéro, alerte, vidéo), ajout et glissé paramétrables.
 * @param {HTMLElement} el
 * @param {object} opts
 *   images         {Array}   [{ id, thumbUrl, tag, couverture, video }] — `tag` vide/absent = « à taguer »
 *   courante       {number=} index de la vignette en highlight
 *   peutAjouter    {boolean=}  false (défaut) → aucun bouton "+" dans le DOM
 *   peutReordonner {boolean=}  false (défaut) → pas de glissé
 *   sur            {{ choisir:(i:number)=>void, ajouter?:()=>void, reordonner?:(ordre:number[])=>void }}
 * @returns {Function|null} détache le glissé si actif, sinon null
 */
export function vignettes(el, opts = {}) {
  const images = opts.images || [];
  const courante = opts.courante ?? 0;
  const sur = opts.sur || {};

  el.innerHTML = `
    <div class="ui-vign-grid" role="list" oncontextmenu="return false">
      ${images.map((img, i) => vignetteHtml(img, i, courante)).join('')}
      ${opts.peutAjouter ? '<button type="button" class="ui-vign-add" data-role="ajouter" aria-label="Ajouter une image">+</button>' : ''}
    </div>`;

  const grille = el.querySelector('.ui-vign-grid');

  grille.querySelectorAll('.ui-vign').forEach(item => {
    item.addEventListener('click', () => sur.choisir?.(Number(item.dataset.idx)));
  });

  grille.querySelector('[data-role="ajouter"]')?.addEventListener('click', () => sur.ajouter?.());

  if (opts.peutReordonner && images.length > 1) {
    return activerGlisser(grille, {
      selecteurItem: '.ui-vign',
      surNumero: (item, i) => {
        const num = item.querySelector('.ui-vign-num');
        if (num) num.textContent = String(i + 1);
      },
      surFin: (ordre) => sur.reordonner?.(ordre),
    });
  }
  return null;
}
