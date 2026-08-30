// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/page.js : brique de composition, squelette UNIQUE d'un écran
// (HO-100, docs/architecture-briques.md §2.1). Pose en-tête + fil d'Ariane +
// corps + barre basse dans `el`. Remplace les quatre en-têtes divergents
// (`obj-nav*`, `art-nav*`, `ms-back*`, `act-barre*`) et leur rustine
// `components.css:164-166`. Migration des vues : HO-104, hors périmètre ici.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../core/dom.js';
import { loadViewCss } from '../core/css.js';
import { fil } from './fil.js';
import { barreBasse } from './barre-basse.js';

// page.js est le point d'entrée unique de la brique : il charge le CSS des
// trois modules (fil et barre-basse ne chargent pas le leur eux-mêmes).
await loadViewCss('page', 'ui');
await loadViewCss('fil', 'ui');
await loadViewCss('barre-basse', 'ui');

const ICONES = { loupe: '🔍', entonnoir: '▽', plus: '+', points: '⋮' };

function outilHtml(o, i) {
  const classes = ['ui-page-outil'];
  if (o.actif) classes.push('ui-page-outil--actif');
  const compteur = o.compteur
    ? `<span class="ui-page-outil-compteur">${esc(String(o.compteur))}</span>`
    : '';
  const icone = ICONES[o.icone] ?? '·';
  return `<button type="button" class="${classes.join(' ')}" data-ui-outil="${i}" aria-label="${esc(o.label)}">${icone}${compteur}</button>`;
}

// Une seule délégation sur `.ui-page-outils` — jamais un listener par bouton.
function bindOutils(el, outils) {
  if (!outils.length) return;
  const cont = el.querySelector('.ui-page-outils');
  if (!cont?.addEventListener) return;
  cont.addEventListener('click', (evt) => {
    const cible = evt.target?.closest ? evt.target.closest('[data-ui-outil]') : null;
    if (!cible) return;
    const i = Number(cible.getAttribute('data-ui-outil'));
    outils[i]?.onClick(evt);
  });
}

/**
 * Pose le chrome d'un écran dans `el` et rend le corps prêt à être rempli.
 * @param {HTMLElement} el     conteneur de la vue (ex. #objet-body)
 * @param {object} opts
 *   titre   {string}    titre de l'écran (obligatoire)
 *   meta    {string=}   méta à droite du titre (ex. '#0025')
 *   outils  {Array=}    0 à 2 MAXIMUM : { icone:'loupe'|'entonnoir'|'plus'|'points',
 *                                         label:string, onClick:Function,
 *                                         actif?:boolean, compteur?:number }
 *   fil     {Array=}    segments passés tels quels à fil()
 *   corps   {string=}   HTML du corps (sinon corps vide, à remplir par l'appelant)
 *   barre   {object=}   { actions: [...] } → barreBasse() ; absent = le corps prend tout
 * @returns {HTMLElement} l'élément de corps (`.ui-page-corps`)
 */
export function page(el, opts = {}) {
  if (!opts.titre) throw new Error('ui/page: titre obligatoire');
  const outils = opts.outils || [];
  if (outils.length > 2) throw new Error(`ui/page: 2 outils maximum (reçu ${outils.length})`);

  const filHtml = fil(opts.fil);
  const { html: barreHtml, bind: bindBarre } = barreBasse(opts.barre?.actions);
  const avecBarre = !!barreHtml;

  const metaHtml = opts.meta ? `<span class="ui-page-meta">${esc(opts.meta)}</span>` : '';
  const outilsHtml = outils.length
    ? `<div class="ui-page-outils">${outils.map(outilHtml).join('')}</div>`
    : '';

  // HO-113 §3 : l'en-tête ne fait double emploi avec le fil que quand il ne
  // porte RIEN de plus que le dernier segment (ni outils, ni meta) — sinon il
  // reste la seule source de cette info (ex. le compteur d'un rayon).
  const dernier = Array.isArray(opts.fil) && opts.fil.length ? opts.fil[opts.fil.length - 1] : null;
  const teteRedondante = !!dernier && dernier.label === opts.titre && !outils.length && !opts.meta;
  const teteHtml = teteRedondante
    ? ''
    : `<header class="ui-page-tete"><span class="ui-page-titre">${esc(opts.titre)}</span>${metaHtml}${outilsHtml}</header>`;

  el.innerHTML = `<div class="ui-page${avecBarre ? ' ui-page--avec-barre' : ''}">`
    + filHtml
    + teteHtml
    + `<div class="ui-page-corps">${opts.corps || ''}</div>`
    + barreHtml
    + `</div>`;

  if (avecBarre) bindBarre(el);
  bindOutils(el, outils);

  return el.querySelector('.ui-page-corps');
}
