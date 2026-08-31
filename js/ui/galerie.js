// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/galerie.js : grande zone lecture ET grande zone édition d'une
// image, UN SEUL composant (HO-106, docs/architecture-briques.md §2.2). Rend
// la carte principale (image + actions selon `mode`/`actions`) et compose
// vignettes() en dessous — une vue n'assemble jamais les deux à la main.
// Pure : zéro accès aux couches données/état/métier (règle de dépendance,
// docs/architecture-briques.md §2). Le geste d'édition est UN bouton
// « Modifier » (D-073/HO-095), pas les coins ✂ / ↻ 90° — c'est
// l'unification demandée : les trois territoires adoptent le geste de la
// fiche objet, `sur.modifier(image)` décide où ça mène (route pour l'objet,
// atelier local pour artiste/capture).
//
// Champs d'image au-delà de l'exemple du brief (`{ id, url, thumbUrl, tag,
// couverture, commentaire, video }`), tous optionnels et déjà résolus par la
// vue — la brique reste pure, elle n'interprète rien :
//   rotation {number=0}  degrés, transform CSS (affichage d'une rotation
//                         persistée non encore rebaquée dans le pixel)
//   etat     {string=}   badge court dans l'en-tête (« modifiée », « sans
//                         zone », « importée le 12/08 »…), déjà formaté
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../core/dom.js';
import { loadViewCss } from '../core/css.js';
import { vignettes } from './vignettes.js';

await loadViewCss('galerie', 'ui');

function rendreVide() {
  return `<div class="ui-galerie-vide">Aucune image pour le moment.</div>`;
}

function rendreActions(actions, img) {
  const boutons = [];
  if (actions.includes('modifier')) {
    boutons.push('<button type="button" class="ui-galerie-action ui-galerie-action--tl" data-role="modifier" title="Modifier">✎ Modifier</button>');
  }
  if (actions.includes('supprimer')) {
    boutons.push('<button type="button" class="ui-galerie-action ui-galerie-action--tr" data-role="supprimer" title="Supprimer">🗑</button>');
  }
  if (actions.includes('couverture')) {
    boutons.push(`<button type="button" class="ui-galerie-action ui-galerie-action--bl ${img.couverture ? 'ui-galerie-action--active' : ''}" data-role="couverture" title="Couverture"><span>★</span><span>Couverture</span></button>`);
  }
  return boutons.join('');
}

function rendreTags(tags, img) {
  return `
    <div class="ui-galerie-tags">
      <div class="ui-galerie-tags-label">Ce que montre la photo</div>
      <div class="ui-galerie-tags-list" role="radiogroup" aria-label="Tag de la photo">
        ${tags.map(t => `
          <button type="button" class="ui-galerie-tag-btn ${img.tag === t.label ? 'ui-galerie-tag-btn--active' : ''}"
            data-role="tag" data-key="${esc(t.key)}" role="radio" aria-checked="${img.tag === t.label}">${esc(t.label)}</button>`).join('')}
      </div>
    </div>`;
}

function rendreCommentaire(img) {
  return `
    <div class="ui-galerie-comment">
      <div class="ui-galerie-comment-label">Commentaire</div>
      <div class="ui-galerie-comment-wrap">
        <textarea class="ui-galerie-comment-area" rows="2" placeholder="Décris ce qu'on voit…" data-role="commentaire">${esc(img.commentaire || '')}</textarea>
      </div>
    </div>`;
}

function rendreNav(n, idx) {
  if (n <= 1) return '';
  return `
    <button type="button" class="ui-galerie-nav ui-galerie-nav--prec" data-role="prec" aria-label="Image précédente" ${idx === 0 ? 'disabled' : ''}>‹</button>
    <button type="button" class="ui-galerie-nav ui-galerie-nav--suiv" data-role="suiv" aria-label="Image suivante" ${idx === n - 1 ? 'disabled' : ''}>›</button>`;
}

function rendreCarte(img, n, idx, mode, actions, tags, libelle, ouvrable) {
  const rot = img.rotation || 0;
  return `
    <div class="ui-galerie-carte">
      <div class="ui-galerie-head">
        <span class="ui-galerie-titre">${esc(libelle)} ${idx + 1} sur ${n}</span>
        <span class="ui-galerie-tag-label">· ${esc(img.tag || 'sans tag')}</span>
        ${img.etat ? `<span class="ui-galerie-etat">${esc(img.etat)}</span>` : ''}
      </div>
      <div class="ui-galerie-viewer ${ouvrable ? 'ui-galerie-viewer--ouvrable' : ''}" oncontextmenu="return false">
        ${img.url || img.thumbUrl
          ? (img.video
              ? `<video src="${esc(img.url)}" controls preload="metadata"></video>`
              : `<img src="${esc(img.url || img.thumbUrl)}" alt="" style="transform: rotate(${rot}deg)" loading="eager" decoding="async" draggable="false">`)
          : '<div class="ui-galerie-placeholder">📷</div>'}
        ${mode === 'edition' ? rendreActions(actions, img) : ''}
        ${rendreNav(n, idx)}
      </div>
      ${mode === 'edition' && tags.length ? rendreTags(tags, img) : ''}
      ${mode === 'edition' ? rendreCommentaire(img) : ''}
    </div>`;
}

/**
 * Grande zone lecture ET édition d'une image + bande de vignettes.
 * @param {HTMLElement} el
 * @param {object} opts
 *   images         {Array}    [{ id, url, thumbUrl, tag, couverture, commentaire, video, rotation?, etat? }]
 *   courante       {number=0} index de l'image affichée en grand
 *   mode           {'lecture'|'edition'=} 'lecture' → aucune action mutante, aucun bouton d'édition
 *   tags           {Array=}   vocabulaire [{key,label}] pour la sélection de tag (mode édition)
 *   libelle        {string='Photo'} nom affiché dans l'en-tête ("Photo"/"Image")
 *   peutAjouter    {boolean=}
 *   peutReordonner {boolean=}
 *   actions        {Array=}   sous-ensemble de ['modifier','couverture','supprimer']
 *   sur            {{ choisir, ajouter, reordonner, taguer, modifier, supprimer, couverture, commenter, ouvrir }}
 *     ouvrir(image) — mode 'lecture' seulement : clic sur la grande image (pas vidéo, pas flèches) → la vue ouvre la loupe (`core/lightbox.js`)
 * @returns {Function|null} détache le glissé des vignettes si actif
 */
export function galerie(el, opts = {}) {
  const images = opts.images || [];
  const n = images.length;
  const courante = n ? Math.min(Math.max(opts.courante ?? 0, 0), n - 1) : 0;
  const img = images[courante];
  const mode = opts.mode === 'edition' ? 'edition' : 'lecture';
  const actions = opts.actions || [];
  const tags = opts.tags || [];
  const sur = opts.sur || {};
  const libelle = opts.libelle || 'Photo';
  const ouvrable = mode === 'lecture' && typeof sur.ouvrir === 'function';

  el.innerHTML = `
    <div class="ui-galerie">
      ${img ? rendreCarte(img, n, courante, mode, actions, tags, libelle, ouvrable) : rendreVide()}
      <div class="ui-galerie-vign" data-role="vignettes"></div>
    </div>`;

  if (img) {
    el.querySelector('[data-role="modifier"]')?.addEventListener('click', () => sur.modifier?.(img));
    el.querySelector('[data-role="supprimer"]')?.addEventListener('click', () => sur.supprimer?.(img));
    el.querySelector('[data-role="couverture"]')?.addEventListener('click', () => sur.couverture?.(img));
    el.querySelectorAll('[data-role="tag"]').forEach(btn => {
      btn.addEventListener('click', () => sur.taguer?.(btn.dataset.key));
    });
    const ta = el.querySelector('[data-role="commentaire"]');
    ta?.addEventListener('change', () => sur.commenter?.(ta.value));
    el.querySelector('[data-role="prec"]')?.addEventListener('click', () => sur.choisir?.(courante - 1));
    el.querySelector('[data-role="suiv"]')?.addEventListener('click', () => sur.choisir?.(courante + 1));
    if (ouvrable) {
      el.querySelector('.ui-galerie-viewer img')?.addEventListener('click', () => sur.ouvrir?.(img));
    }
  }

  const vignEl = el.querySelector('[data-role="vignettes"]');
  return vignettes(vignEl, {
    images, courante,
    peutAjouter: !!opts.peutAjouter,
    peutReordonner: !!opts.peutReordonner,
    sur: { choisir: sur.choisir, ajouter: sur.ajouter, reordonner: sur.reordonner },
  });
}
