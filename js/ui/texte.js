// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/texte.js : brique de composition, carte de texte UNIQUE
// (HO-108, docs/architecture-briques.md §2.2). Un titre, un contenu, bascule
// lecture ↔ édition, dictée micro, pied meta/actions. Remplace le motif
// « carte de texte » écrit trois fois (objet/description.js ×2, journal
// artiste/index.js).
//
// Exception explicitement autorisée au contrat « ui/ pur » (brief HO-108) :
// `micButton` vit dans `views/mic.js` — elle aurait dû naître dans `ui/`,
// mais la déplacer est un chantier à part ; la consommer depuis `ui/` est
// admis ici. `node infra/cartographie.mjs` la signale nommément en §7
// (violation `ui/` → `views/`, attendue et documentée).
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../core/dom.js';
import { loadViewCss } from '../core/css.js';
import { micButton } from '../views/mic.js';

await loadViewCss('texte', 'ui');

function teteHtml(titre, tag) {
  if (!titre && !tag) return '';
  const titreHtml = titre ? `<span class="ui-texte-titre">${esc(titre)}</span>` : '';
  const tagHtml = tag ? `<span class="ui-texte-tag">${esc(tag)}</span>` : '';
  return `<div class="ui-texte-tete">${titreHtml}${tagHtml}</div>`;
}

function lectureHtml(opts) {
  const { contenu, vide, meta, actions = [] } = opts;
  const corpsHtml = contenu
    ? `<div class="ui-texte-corps">${esc(contenu)}</div>`
    : `<div class="ui-texte-corps ui-texte-corps--vide">${esc(vide || '')}</div>`;
  const piedHtml = (meta || actions.length)
    ? `<div class="ui-texte-pied">`
      + (meta ? `<span class="ui-texte-meta">${esc(meta)}</span>` : '')
      + actions.map((a, i) => `<button type="button" class="ui-texte-action" data-ui-texte-action="${i}">${esc(a.label)}</button>`).join('')
      + `</div>`
    : '';
  return corpsHtml + piedHtml;
}

function editionHtml(opts) {
  const { contenu, lignes = 8, micro } = opts;
  return `
    <div class="ui-texte-editeur${micro ? ' ui-texte-editeur--micro' : ''}">
      <textarea class="ui-texte-textarea" rows="${Number(lignes) || 8}">${esc(contenu || '')}</textarea>
    </div>
    <div class="ui-texte-actions-edition">
      <button type="button" class="ui-texte-btn ui-texte-btn--outline" data-ui-texte="annuler">Annuler</button>
      <button type="button" class="ui-texte-btn ui-texte-btn--primaire" data-ui-texte="enregistrer">Enregistrer</button>
    </div>`;
}

/**
 * Rend une carte de texte (titre + contenu) dans `el` — lecture ET édition,
 * dictée micro, sauvegarde. Brique pure : la vue décide de tout (contenu,
 * mode, persistance via sur.enregistrer/annuler) ; texte() ne fait que la
 * mise en page, la bascule d'affichage et la lecture du textarea.
 * @param {HTMLElement} el
 * @param {object} opts
 *   titre   {string=}   titre de la carte (bandeau), optionnel
 *   tag     {string=}   pastille à droite du titre, optionnelle
 *   contenu {string=}   texte affiché en lecture / valeur initiale en édition
 *   vide    {string=}   message affiché si `contenu` est vide, en lecture
 *   mode    {'lecture'|'edition'=} 'lecture' par défaut
 *   micro   {boolean=}  greffe micButton(textarea) en édition (views/mic.js —
 *                       rend `null` si la Web Speech API est indisponible,
 *                       comportement existant préservé, aucun bouton alors)
 *   lignes  {number=8}  hauteur du textarea en édition
 *   meta    {string=}   pied, lecture seule
 *   actions {Array=}    [{ label, onClick }] pied, lecture seule
 *   sur     {object=}   { enregistrer(texte), annuler() } — enregistrer()
 *                       n'est PAS appelé si le texte tapé est identique à
 *                       `contenu` (annuler() est appelé à la place, pour que
 *                       la vue sorte du mode édition sans écriture inutile)
 */
export function texte(el, opts = {}) {
  const mode = opts.mode || 'lecture';
  const sur = opts.sur || {};
  const contenuInitial = opts.contenu ?? '';

  el.innerHTML = `<div class="ui-texte">`
    + teteHtml(opts.titre, opts.tag)
    + (mode === 'edition' ? editionHtml(opts) : lectureHtml(opts))
    + `</div>`;

  if (mode === 'edition') {
    const ta = el.querySelector('.ui-texte-textarea');
    if (opts.micro) {
      const wrap = el.querySelector('.ui-texte-editeur');
      const btn = ta ? micButton(ta) : null;
      if (btn && wrap) wrap.appendChild(btn);
    }
    el.querySelector('[data-ui-texte="annuler"]')?.addEventListener('click', () => sur.annuler?.());
    el.querySelector('[data-ui-texte="enregistrer"]')?.addEventListener('click', () => {
      const valeur = ta?.value ?? '';
      if (valeur === contenuInitial) { sur.annuler?.(); return; }
      sur.enregistrer?.(valeur);
    });
  } else {
    (opts.actions || []).forEach((a, i) => {
      el.querySelector(`[data-ui-texte-action="${i}"]`)?.addEventListener('click', a.onClick);
    });
  }
}
