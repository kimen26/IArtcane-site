// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/identite.js : édition du bloc Identité de la fiche
// artiste (HO-148) — type, pays, région, catégories.
//
// Module dédié plutôt que du code de plus dans blocs.js (228 lignes, plafond
// 400 : le formulaire, ses options et sa validation y tiendraient mal).
// Expose le rendu (lecture ET édition) et le branchement ; blocs.js appelle
// depuis rendreIdentite(), index.js branche après insertion (patron de
// brancherJournal()).
//
// Fonctions PURES exportées (paysListe, sousCategoriesPour, validerIdentite)
// pour que infra/test-identite-artiste.mjs les éprouve hors-ligne, sans
// réseau ni navigateur — même esprit que liste-calc.js pour liste.js, mais
// gardées ICI (pas de fichier -calc.js séparé : hors périmètre du brief
// HO-148, qui n'autorise que identite.js). La technique change en
// conséquence : `core/data.js` importe le SDK Supabase par une URL `https:`
// que Node refuse (ERR_UNSUPPORTED_ESM_URL_SCHEME) — un import STATIQUE le
// romprait pour tout le fichier, fonctions pures comprises. `deps()` ci-dessous
// l'importe PARESSEUSEMENT (transparent dans le navigateur), motif déjà
// établi par services/photos.js et services/journal.js (HO-105/HO-119).
// `loadViewCss` est, de la même façon, appelé depuis une fonction (jamais au
// top-level du module) pour ne pas toucher `document` au chargement.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { A, hooks } from './etat.js';
import { CATS_CANON, SOUS } from '../../core/taxonomie.js';

let _deps = null;
async function deps() {
  if (!_deps) _deps = await Promise.all([import('../../core/data.js'), import('../../core/feedback.js'), import('../../core/css.js')]);
  return _deps;
}
/** Test-only : injecte un double de [core/data.js, core/feedback.js, core/css.js] avant tout appel réel. */
export function _injecterDeps(fauxDeps) { _deps = fauxDeps; }

let cssCharge = false;
// flag-icons est déjà chargé par liste.js pour la liste, mais le hub détail
// (index.js → rendreFiche() → rendreIdentiteBloc()) ne le charge pas : on
// ouvre la fiche d'un artiste sans être jamais passé par la liste dans la
// même session (lien direct, retour arrière). Chargé ici au premier rendu
// réel — jamais en haut de module, `document` n'existe pas sous Node.
async function assurerCss() {
  if (cssCharge) return;
  cssCharge = true;
  const [, , { loadViewCss }] = await deps();
  await loadViewCss('flag-icons', '../vendor/flag-icons');
}

const TYPES = [
  { valeur: 'personne', label: 'Personne' },
  { valeur: 'collectif', label: 'Collectif' },
  { valeur: 'maison', label: 'Maison / manufacture' },
  { valeur: 'lieu', label: 'Lieu / estampille' },
  { valeur: 'anonyme', label: 'Anonyme qualifié' },
];

// Régions françaises actuelles (13 métropolitaines + 5 d'outre-mer), triées
// alphabétiquement — pas de source native pour ce niveau administratif
// (Intl.DisplayNames couvre les pays, pas les subdivisions FR).
const REGIONS_FR = [
  'Auvergne-Rhône-Alpes',
  'Bourgogne-Franche-Comté',
  'Bretagne',
  'Centre-Val de Loire',
  'Corse',
  'Grand Est',
  'Guadeloupe',
  'Guyane',
  'Hauts-de-France',
  'Île-de-France',
  'Martinique',
  'Mayotte',
  'Normandie',
  'Nouvelle-Aquitaine',
  'Occitanie',
  'Pays de la Loire',
  "Provence-Alpes-Côte d'Azur",
  'La Réunion',
].sort((a, b) => a.localeCompare(b, 'fr'));

// ─── Fonctions pures (exportées pour infra/test-identite-artiste.mjs) ──────

/**
 * La liste des pays : { code (iso-3166-1 alpha-2 minuscule), label (nom
 * français) }, triée par nom. Construite depuis Intl.DisplayNames — natif,
 * pas de table à maintenir à la main pour couvrir l'exhaustif (Alain
 * cataloguera un objet danois ou japonais sans prévenir).
 * @param {string[]} codes  liste de codes ISO à afficher (paramétrable pour
 *                          le test hors-ligne, où Intl.DisplayNames n'est
 *                          pas dispo côté Node sans données complètes)
 * @param {Intl.DisplayNames=} dn  instance déjà construite (permet au test
 *                                 de l'injecter si l'environnement le permet,
 *                                 et à l'écran de la réutiliser sans la
 *                                 reconstruire à chaque rendu)
 */
export function paysListe(codes, dn) {
  const displayNames = dn ?? (typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['fr'], { type: 'region' })
    : null);
  const liste = codes.map(code => {
    const c = String(code).toLowerCase();
    let label;
    try { label = displayNames?.of(c.toUpperCase()); } catch { label = null; }
    return { code: c, label: label && label !== c.toUpperCase() ? label : c.toUpperCase() };
  });
  return liste.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/** Tous les codes ISO-3166-1 alpha-2 usuels (ceux que flag-icons vendore). */
export const CODES_PAYS = [
  'ad','ae','af','ag','al','am','ao','ar','at','au','az','ba','bb','bd','be','bf','bg','bh','bi','bj',
  'bn','bo','br','bs','bt','bw','by','bz','ca','cd','cf','cg','ch','ci','cl','cm','cn','co','cr','cu',
  'cv','cy','cz','de','dj','dk','dm','do','dz','ec','ee','eg','er','es','et','fi','fj','fm','fr','ga',
  'gb','gd','ge','gh','gm','gn','gq','gr','gt','gw','gy','hn','hr','ht','hu','id','ie','il','in','iq',
  'ir','is','it','jm','jo','jp','ke','kg','kh','ki','km','kn','kp','kr','kw','kz','la','lb','lc','li',
  'lk','lr','ls','lt','lu','lv','ly','ma','mc','md','me','mg','mh','mk','ml','mm','mn','mr','mt','mu',
  'mv','mw','mx','my','mz','na','ne','ng','ni','nl','no','np','nr','nz','om','pa','pe','pg','ph','pk',
  'pl','pt','pw','py','qa','ro','rs','ru','rw','sa','sb','sc','sd','se','sg','si','sk','sl','sm','sn',
  'so','sr','ss','st','sv','sy','sz','td','tg','th','tj','tl','tm','tn','to','tr','tt','tv','tw','tz',
  'ua','ug','us','uy','uz','va','vc','ve','vn','vu','ws','ye','za','zm','zw',
];

/**
 * La sous-catégorie proposée dépend de la catégorie choisie (cascade). Rend
 * la liste des sous-catégories de `SOUS`, ou [] si la catégorie n'existe pas
 * dans la taxonomie.
 */
export function sousCategoriesPour(categorie) {
  return SOUS[categorie] ?? [];
}

/**
 * Valide + normalise l'état du formulaire avant écriture. Ne jette jamais :
 * rend { ok:false, erreur } ou { ok:true, valeurs } — valeurs prêtes pour un
 * `.update()` Supabase.
 * @param {{type?:string, pays?:string, region?:string, categories?:Array}} saisie
 */
export function validerIdentite(saisie) {
  const type = saisie?.type ? String(saisie.type).trim() : null;
  const paysBrut = saisie?.pays ? String(saisie.pays).trim() : '';
  if (!paysBrut) {
    return { ok: false, erreur: 'Le pays est obligatoire pour enregistrer.' };
  }
  const pays = paysBrut.toLowerCase();
  // La région n'a de sens qu'en France (contrainte CHECK en base) — si le
  // pays n'est plus 'fr', elle est vidée dans le même geste, jamais envoyée
  // telle quelle (la contrainte la rejetterait).
  const regionBrut = saisie?.region ? String(saisie.region).trim() : '';
  const region = pays === 'fr' && regionBrut ? regionBrut : null;

  const categoriesEntree = Array.isArray(saisie?.categories) ? saisie.categories : [];
  const categories = [];
  const vus = new Set();
  for (const c of categoriesEntree) {
    const categorie = String(c?.categorie ?? '').trim();
    if (!categorie) continue;
    if (!CATS_CANON.includes(categorie)) {
      return { ok: false, erreur: `Catégorie inconnue de la taxonomie : « ${categorie} ».` };
    }
    const sousCategorie = String(c?.sous_categorie ?? '').trim();
    if (sousCategorie && !sousCategoriesPour(categorie).includes(sousCategorie)) {
      return { ok: false, erreur: `Sous-catégorie inconnue pour ${categorie} : « ${sousCategorie} ».` };
    }
    const cle = categorie + '|' + sousCategorie;
    if (vus.has(cle)) continue; // doublon exact non dupliqué
    vus.add(cle);
    categories.push(sousCategorie ? { categorie, sous_categorie: sousCategorie } : { categorie });
  }

  return { ok: true, valeurs: { type, pays, region, categories } };
}

// ─── État d'édition local (module-scope, comme filePickerTarget dans index.js) ─

let enEdition = false;
let brouillon = null; // { type, pays, region, categories: [...] } pendant l'édition

function initBrouillon(id) {
  return {
    type: id.type ?? '',
    pays: id.pays ?? '',
    region: id.region ?? '',
    categories: Array.isArray(id.categories) ? id.categories.map(c => ({ ...c })) : [],
  };
}

// ─── Rendu ───────────────────────────────────────────────────────────────

/**
 * Rend le bloc Identité — lecture ou édition selon `enEdition`. Appelé par
 * blocs.js::rendreIdentite(). `a` est la ligne `artistes` (A.artiste).
 * @param {object} a
 */
export function rendreIdentiteBloc(a) {
  // Fire-and-forget : rendreFiche() est synchrone (composition de gabarits),
  // le CSS ne peut donc pas être attendu ici. assurerCss() est idempotent
  // (cssCharge) et loadViewCss() met déjà en cache par vue — le pire cas est
  // un premier rendu sans le style flag-icons le temps d'un aller-retour
  // réseau local, jamais un rechargement répété.
  assurerCss();
  if (enEdition) return rendreEdition(a);
  return rendreLecture(a);
}

function rendreLecture(a) {
  const type = a?.type ? (TYPES.find(t => t.valeur === a.type)?.label ?? a.type) : '';
  const pays = a?.pays ?? null;
  const region = a?.region ?? null;
  const arts = libelleCategories(a?.categories);

  const lignes = [];
  if (type) lignes.push({ label: 'Type', val: esc(type) });
  lignes.push({ label: 'Pays', val: pays ? drapeauEtNom(pays, region) : '<span class="art-id-manque">non renseigné</span>' });
  if (arts) lignes.push({ label: 'Catégories', val: esc(arts) });

  return `
    <section class="art-identite2" aria-label="Identité">
      <div class="art-identite2-head">
        <span>Identité</span>
        <button type="button" class="art-identite2-editer" data-action="identite-editer">✎ Modifier</button>
      </div>
      ${lignes.map(l => `<div class="art-id-row"><span class="art-id-label">${l.label}</span><span class="art-id-value">${l.val}</span></div>`).join('')}
    </section>`;
}

function drapeauEtNom(pays, region) {
  const lieu = region || String(pays).toUpperCase();
  return `<span class="fi fi-${esc(pays)} art-id-drapeau" role="img" aria-label="${esc(lieu)}" title="${esc(lieu)}"></span> ${esc(lieu)}`;
}

function libelleCategories(categories) {
  const list = Array.isArray(categories) ? categories : [];
  if (!list.length) return '';
  return list.map(c => c.sous_categorie ? `${c.categorie} (${c.sous_categorie})` : c.categorie).join(' · ');
}

function rendreEdition(a) {
  if (!brouillon) brouillon = initBrouillon(a ?? {});
  const b = brouillon;
  const paysOptions = paysListe(CODES_PAYS);
  const drapeauSel = b.pays ? `<span class="fi fi-${esc(b.pays)} art-id-drapeau" role="img" aria-label="drapeau"></span>` : '';

  return `
    <section class="art-identite2 art-identite2--edition" aria-label="Identité, édition">
      <div class="art-identite2-head">
        <span>Identité</span>
      </div>
      <div class="art-identite2-form">
        <label class="art-id-champ">
          <span class="art-id-champ-label">Type</span>
          <select class="art-id-input" data-champ="type">
            <option value="">—</option>
            ${TYPES.map(t => `<option value="${esc(t.valeur)}" ${b.type === t.valeur ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
          </select>
        </label>
        <label class="art-id-champ">
          <span class="art-id-champ-label">Pays <span class="art-id-oblig">*</span></span>
          <span class="art-id-pays-wrap">
            ${drapeauSel}
            <select class="art-id-input" data-champ="pays">
              <option value="">—</option>
              ${paysOptions.map(p => `<option value="${esc(p.code)}" ${b.pays === p.code ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </span>
        </label>
        ${b.pays === 'fr' ? `
        <label class="art-id-champ">
          <span class="art-id-champ-label">Région</span>
          <select class="art-id-input" data-champ="region">
            <option value="">—</option>
            ${REGIONS_FR.map(r => `<option value="${esc(r)}" ${b.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
          </select>
        </label>` : ''}
        <div class="art-id-champ art-id-champ--categories">
          <span class="art-id-champ-label">Catégories</span>
          ${rendreCategories(b.categories)}
          <button type="button" class="art-id-cat-ajouter" data-action="identite-cat-ajouter">+ catégorie</button>
        </div>
        <div class="art-identite2-actions">
          <button type="button" class="btn small" data-action="identite-annuler">Annuler</button>
          <button type="button" class="btn small primary" data-action="identite-enregistrer">Enregistrer</button>
        </div>
      </div>
    </section>`;
}

function rendreCategories(categories) {
  if (!categories.length) return '<div class="art-id-cat-vide">Aucune catégorie</div>';
  return `<div class="art-id-cat-liste">${categories.map((c, i) => `
    <div class="art-id-cat-row" data-idx="${i}">
      <select class="art-id-input" data-champ="cat-categorie" data-idx="${i}">
        <option value="">—</option>
        ${CATS_CANON.map(cat => `<option value="${esc(cat)}" ${c.categorie === cat ? 'selected' : ''}>${esc(cat)}</option>`).join('')}
      </select>
      <select class="art-id-input" data-champ="cat-sous" data-idx="${i}">
        <option value="">—</option>
        ${sousCategoriesPour(c.categorie).map(s => `<option value="${esc(s)}" ${c.sous_categorie === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
      </select>
      <button type="button" class="art-id-cat-retirer" data-action="identite-cat-retirer" data-idx="${i}" aria-label="Retirer cette catégorie">✕</button>
    </div>`).join('')}</div>`;
}

// ─── Branchement (appelé par index.js après insertion HTML) ────────────────

/**
 * Branche les actions du bloc Identité sur `corps` (racine de la fiche). À
 * appeler après CHAQUE rendu de rendreFiche() — patron de brancherJournal().
 * @param {HTMLElement} corps
 */
export function brancherIdentite(corps) {
  const sec = corps.querySelector('.art-identite2');
  if (!sec) return;

  if (!enEdition) {
    sec.querySelector('[data-action="identite-editer"]')?.addEventListener('click', () => {
      enEdition = true;
      brouillon = initBrouillon(A.artiste ?? {});
      hooks.rendre();
    });
    return;
  }

  sec.querySelector('[data-champ="type"]')?.addEventListener('change', e => { brouillon.type = e.target.value; });
  sec.querySelector('[data-champ="pays"]')?.addEventListener('change', e => {
    brouillon.pays = e.target.value.toLowerCase();
    if (brouillon.pays !== 'fr') brouillon.region = '';
    hooks.rendre();
  });
  sec.querySelector('[data-champ="region"]')?.addEventListener('change', e => { brouillon.region = e.target.value; });

  sec.querySelectorAll('[data-champ="cat-categorie"]').forEach(el => el.addEventListener('change', e => {
    const idx = Number(e.target.dataset.idx);
    brouillon.categories[idx].categorie = e.target.value;
    brouillon.categories[idx].sous_categorie = '';
    hooks.rendre();
  }));
  sec.querySelectorAll('[data-champ="cat-sous"]').forEach(el => el.addEventListener('change', e => {
    const idx = Number(e.target.dataset.idx);
    brouillon.categories[idx].sous_categorie = e.target.value;
  }));
  sec.querySelector('[data-action="identite-cat-ajouter"]')?.addEventListener('click', () => {
    brouillon.categories.push({ categorie: '', sous_categorie: '' });
    hooks.rendre();
  });
  sec.querySelectorAll('[data-action="identite-cat-retirer"]').forEach(el => el.addEventListener('click', e => {
    const idx = Number(e.target.dataset.idx || e.currentTarget.dataset.idx);
    brouillon.categories.splice(idx, 1);
    hooks.rendre();
  }));

  sec.querySelector('[data-action="identite-annuler"]')?.addEventListener('click', () => {
    enEdition = false;
    brouillon = null;
    hooks.rendre();
  });
  sec.querySelector('[data-action="identite-enregistrer"]')?.addEventListener('click', onEnregistrer);
}

async function onEnregistrer() {
  const [{ sb, logEvent }, { toast, enregistrer }] = await deps();
  const resultat = validerIdentite(brouillon);
  if (!resultat.ok) {
    toast(resultat.erreur, 'panne');
    return;
  }
  const { type, pays, region, categories } = resultat.valeurs;
  // owner_id ET nom dans le filtre (L-091) : PONAIRE et DEMO peuvent porter
  // le même nom d'artiste, un `where nom = …` nu écrirait dans les deux.
  const ok = await enregistrer(() => sb.from('artistes')
    .update({ type, pays, region, categories })
    .eq('owner_id', S.tenantId)
    .eq('nom', A.nom), 'Identité');
  if (!ok) return;
  logEvent('artiste_identite', { artiste: A.nom, type, pays, region, n_categories: categories.length });
  enEdition = false;
  brouillon = null;
  await hooks.recharger(A.nom);
}
