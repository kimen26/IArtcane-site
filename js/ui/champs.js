// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/champs.js : zone d'affichage 2 colonnes, titre + contenu
// (HO-107, docs/architecture-briques.md §2.2). Remplace la grille `.dl` et le
// couple renderBloc/fieldHtml/textFieldHtml d'objet/identification.js.
//
// Brique PURE : aucun accès à core/data.js ni core/state.js. La brique affiche
// un état (`etat` par champ) mais ne le décide jamais — la validité vient de
// la vue. Toute logique métier (verrous humains, suggestions, cascades de
// catégorie…) reste dans la vue ; celle-ci peut augmenter le DOM rendu ici
// (ex. injecter une sous-liste ou un bouton) via les data-champ posés sur
// chaque carte, exactement comme un consommateur de page()/galerie() le fait
// déjà avec leurs classes stables.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../core/dom.js';
import { loadViewCss } from '../core/css.js';

await loadViewCss('champs', 'ui');

const PASTILLES = {
  valide: { classe: 'ui-champs-pastille--ok', symbole: '✓', titre: 'Validé par un humain' },
  verrouille: { classe: 'ui-champs-pastille--verrou', symbole: '🔒', titre: 'Verrouillé' },
  'a-valider': { classe: '', symbole: '', titre: 'À valider' },
};

function pastilleHtml(cle, etat) {
  if (!etat) return '';
  const p = PASTILLES[etat] ?? PASTILLES['a-valider'];
  return `<span class="ui-champs-pastille ${p.classe}" data-ui-role="pastille" data-champ="${esc(cle)}" title="${esc(p.titre)}" role="button" aria-label="${esc(p.titre)}">${p.symbole}</span>`;
}

function optionsHtml(options, valeurCourante) {
  return (options || []).map(o => {
    const ov = typeof o === 'string' ? o : o.valeur;
    const ol = typeof o === 'string' ? o : (o.label ?? o.valeur);
    return `<option value="${esc(ov)}" ${ov === valeurCourante ? 'selected' : ''}>${esc(ol)}</option>`;
  }).join('');
}

function controleHtml(c) {
  const val = c.valeur ?? '';
  const ph = c.placeholder ? ` placeholder="${esc(c.placeholder)}"` : '';
  const auto = c.autocomplete ? ` autocomplete="${esc(c.autocomplete)}"` : '';

  if (!c.editable) {
    const vide = val === '' || val == null;
    return `<div class="ui-champs-valeur">${vide ? '<span class="ui-champs-manque">—</span>' : esc(String(val))}</div>`;
  }
  const attrs = `data-ui-role="valeur" data-champ="${esc(c.cle)}"`;
  if (c.type === 'select') {
    return `<select class="ui-champs-input" ${attrs}><option value="">—</option>${optionsHtml(c.options, val)}</select>`;
  }
  if (c.type === 'texte-long') {
    return `<textarea class="ui-champs-input ui-champs-textarea" ${attrs}${ph}${auto}>${esc(val)}</textarea>`;
  }
  if (c.type === 'case') {
    return `<label class="ui-champs-case"><input type="checkbox" class="ui-champs-checkbox" ${attrs} ${val ? 'checked' : ''}></label>`;
  }
  if (c.type === 'nombre') {
    return `<input type="text" inputmode="decimal" class="ui-champs-input" ${attrs}${ph}${auto} value="${esc(val)}">`;
  }
  // 'texte' par défaut
  return `<input type="text" class="ui-champs-input" ${attrs}${ph}${auto} value="${esc(val)}">`;
}

function champHtml(c) {
  const classes = ['ui-champs-champ'];
  if (c.pleineLargeur) classes.push('ui-champs-champ--pleine');
  if (c.type === 'case') classes.push('ui-champs-champ--case');
  const label = c.titre ? `<span class="ui-champs-label">${esc(c.titre)}</span>` : '';
  const aide = c.aide ? `<div class="ui-champs-aide">${esc(c.aide)}</div>` : '';
  const entete = (label || c.etat) ? `<div class="ui-champs-entete">${label}${pastilleHtml(c.cle, c.etat)}</div>` : '';
  return `<div class="${classes.join(' ')}" data-champ="${esc(c.cle)}">${entete}${aide}${controleHtml(c)}</div>`;
}

// Coloration du bloc : dérivée UNIQUEMENT des `etat` déjà transmis (aucun
// accès à validation_champs) — ok si tous les champs porteurs d'un etat sont
// 'valide', warn sinon. Un bloc sans titre, ou dont aucun champ ne porte
// d'etat, reste neutre (cas maison : aucune coloration, la carte de la vue
// fournit déjà son propre cadre).
function classeBloc(opts, liste) {
  if (!opts.titre) return '';
  const etats = liste.map(c => c.etat).filter(e => e != null);
  if (!etats.length) return '';
  return etats.every(e => e === 'valide') ? ' ui-champs--ok' : ' ui-champs--warn';
}

function bind(el, sur = {}) {
  el.querySelectorAll('[data-ui-role]').forEach(node => {
    const cle = node.dataset.champ;
    if (node.dataset.uiRole === 'pastille') {
      node.addEventListener('click', () => sur.basculerValidation?.(cle));
      return;
    }
    node.addEventListener('change', () => {
      const valeur = node.type === 'checkbox' ? node.checked : node.value;
      sur.changer?.(cle, valeur);
    });
  });
}

/**
 * Rend une zone de champs (titre + contenu) dans `el` — lecture ET édition,
 * pastilles comprises. Brique pure : la vue décide de tout (valeurs, etat,
 * persistance via sur.changer) ; champs() ne fait que la mise en page et la
 * saisie.
 * @param {HTMLElement} el
 * @param {object} opts
 *   titre    {string=}  titre de bloc, optionnel (pas de bandeau si absent)
 *   colonnes {number=}  2 par défaut, 1 en mobile (CSS, ≤640px)
 *   liste    {Array}    [{ cle, titre, valeur, editable, type, options,
 *                          pleineLargeur, etat, aide, placeholder, autocomplete }]
 *   sur      {object=}  { changer(cle, valeur), basculerValidation(cle) }
 */
export function champs(el, opts = {}) {
  const liste = opts.liste || [];
  const cols = Number(opts.colonnes) || 2;

  const titreHtml = opts.titre ? `<h2 class="ui-champs-titre">${esc(opts.titre)}</h2>` : '';
  const champsHtml = liste.map(champHtml).join('');

  el.innerHTML = `<section class="ui-champs${classeBloc(opts, liste)}">`
    + titreHtml
    + `<div class="ui-champs-grille" style="--ui-champs-cols:${cols}">${champsHtml}</div>`
    + `</section>`;

  bind(el, opts.sur);
}
