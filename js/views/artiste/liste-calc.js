// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/liste-calc.js : le calcul pur de la liste artistes.
//
// Séparé de `liste.js` (qui monte le DOM et parle à Supabase) pour la même
// raison que `services/journal.js` l'est de la vue accueil : `core/data.js`
// importe le SDK Supabase par une URL `https:`, que le loader ESM de Node
// refuse. Ces trois fonctions n'ont aucune dépendance, donc `infra/test-liste-
// artistes.mjs` les éprouve hors-ligne, sans réseau ni navigateur.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Forme comparable d'un texte : minuscules, accents retirés.
 * La MÊME règle que `artistes_alias.alias_norm` côté base (migration 0038) —
 * chercher « marklin » doit trouver « Märklin », exactement comme en base deux
 * graphies qui ne diffèrent que par un accent désignent le même artiste.
 */
export function normaliser(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/**
 * Le type d'art, dit court. `categories` porte N couples {categorie,
 * sous_categorie} (D-092) : on montre la catégorie, précisée par sa
 * sous-catégorie quand il n'y en a qu'une seule — « Dessin (Encre) » informe,
 * là où « Dessin (Encre, Lavis, Crayon) » encombrerait la ligne.
 * @param {Array<{categorie?:string, sous_categorie?:string}>} categories
 * @returns {string}
 */
export function libelleArts(categories) {
  const list = Array.isArray(categories) ? categories : [];
  if (!list.length) return '';
  const parCat = new Map();
  for (const c of list) {
    const cat = String(c?.categorie ?? '').trim();
    if (!cat) continue;
    if (!parCat.has(cat)) parCat.set(cat, new Set());
    const sous = String(c?.sous_categorie ?? '').trim();
    if (sous) parCat.get(cat).add(sous);
  }
  return [...parCat.entries()]
    .map(([cat, sous]) => (sous.size === 1 ? `${cat} (${[...sous][0]})` : cat))
    .join(' · ');
}

/**
 * L'index de recherche d'une fiche : tout ce sur quoi Alain peut vouloir
 * tomber. Les ALIAS en font partie — c'est ce qui retrouve une fiche quelle que
 * soit l'orthographe portée par l'œuvre (D-091).
 * @param {{nom:string, pays?:string, region?:string, dossier?:object}} a
 * @param {string[]} alias
 * @returns {string}
 */
export function indexRecherche(a, alias = []) {
  const arts = libelleArts(a?.categories);
  const metier = String(a?.dossier?.identite?.metier ?? '');
  return normaliser([a?.nom, ...alias, arts, metier, a?.pays, a?.region].filter(Boolean).join(' '));
}

/**
 * Filtre la liste sur une saisie, via l'index calculé une fois par fiche.
 * @param {Array<{_cherche:string}>} artistes
 * @param {string} saisie
 */
export function filtrer(artistes, saisie) {
  const q = normaliser(saisie);
  if (!q) return artistes;
  return (artistes ?? []).filter(a => String(a?._cherche ?? '').includes(q));
}

/**
 * Compte les ventes par artiste depuis des lignes `{ artiste_nom }` (une
 * colonne, HO-162) — jamais confondu avec `_n`, le nombre d'objets de la
 * collection : deux compteurs, deux sources. Une valeur nulle/vide est
 * ignorée (un lot mal rattaché ne doit pas gonfler le compte d'un artiste
 * fantôme sous une clé vide).
 * @param {Array<{artiste_nom?:string|null}>} rows
 * @returns {Map<string, number>}
 */
export function compterVentes(rows) {
  const m = new Map();
  for (const r of rows ?? []) {
    const nom = r?.artiste_nom;
    if (!nom) continue;
    m.set(nom, (m.get(nom) ?? 0) + 1);
  }
  return m;
}
