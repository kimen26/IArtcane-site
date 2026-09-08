// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/liste.js : la liste des fiches artistes (#/artistes).
//
// UNE LIGNE PAR ARTISTE, et une recherche (demande Yann 2026-09-07). Les
// mini-cartes en 2 colonnes qui précédaient tronquaient tout : le nom passait
// à l'ellipse dès une douzaine de caractères, et il n'y avait de place que pour
// un seul sous-titre. Une ligne pleine largeur porte sans rogner ce qu'Alain
// veut voir d'un coup d'œil : qui, quel art, quel pays, combien d'objets.
//
// Le pays s'affiche en DRAPEAU SVG (flag-icons vendoré), jamais en emoji :
// l'emoji drapeau ne se rend pas sur Windows, où Chrome affiche les deux
// lettres du code dans un carré — alors qu'il s'affiche sur l'Android d'Alain
// (D-092). Un drapeau qui marche chez l'un et pas chez l'autre n'est pas un
// drapeau.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, emptyHtml } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { auteurMatch } from '../../core/format.js';
import { sb, signPaths, ensureCollection } from '../../core/data.js';
import { toast, humaniser } from '../../core/feedback.js';
import { page } from '../../ui/page.js';
import { loadViewCss } from '../../core/css.js';
import { libelleArts, indexRecherche, filtrer, compterVentes } from './liste-calc.js';

// Les drapeaux sont vendorés sous `site/vendor/`, pas sous `site/styles/` :
// c'est du code tiers qu'on ne modifie pas, il ne se mélange pas à nos feuilles.
// `loadViewCss` résout relativement à `site/styles/`, d'où le `../vendor`.
// Chargé ici et pas dans `index.html` : une vue possède son CSS, aucun fichier
// transverse n'est touché (core/css.js).
await loadViewCss('flag-icons', '../vendor/flag-icons');

// Initiales de repli : 2 lettres max, sur les mots signifiants du nom.
function initiales(nom) {
  const mots = String(nom ?? '').split(/[\s'’-]+/).filter(m => m.length > 1);
  return mots.slice(0, 2).map(m => m[0].toUpperCase()).join('') || '?';
}

// Le drapeau. `pays` est un code ISO-3166-1 alpha-2 minuscule, garanti par une
// contrainte CHECK en base — c'est exactement ce que flag-icons attend comme
// classe. L'infobulle porte la région quand on la connaît, le code sinon.
function drapeau(pays, region) {
  if (!pays) return '';
  const lieu = region || String(pays).toUpperCase();
  return `<span class="fi fi-${esc(pays)} art-ligne-drapeau" role="img" aria-label="${esc(lieu)}" title="${esc(lieu)}"></span>`;
}

// Une ligne. L'ordre de lecture suit la question qu'Alain se pose : qui, quoi,
// d'où, combien.
function ligne(a) {
  const visuel = a._url
    ? `<img src="${esc(a._url)}" alt="" loading="lazy" decoding="async">`
    : `<span class="art-ligne-initiales" aria-hidden="true">${esc(initiales(a.nom))}</span>`;
  // Le métier vient de la R9 (texte libre, souvent énumératif) ; les catégories
  // viennent de la taxonomie. On préfère les catégories — elles sont cadrées,
  // donc comparables d'un artiste à l'autre — et on retombe sur le métier sinon.
  const arts = libelleArts(a.categories) || String(a.dossier?.identite?.metier ?? '').split(',')[0].trim();
  const meta = [arts, a.region || ''].filter(Boolean);
  return `<article class="art-ligne" data-nom="${esc(a.nom)}" tabindex="0" role="button">
    <span class="art-ligne-visuel${a._url ? '' : ' art-ligne-visuel--vide'}">${visuel}</span>
    <span class="art-ligne-corps">
      <span class="art-ligne-haut">
        <span class="art-ligne-nom">${esc(a.nom)}</span>
        ${drapeau(a.pays, a.region)}
      </span>
      ${meta.length ? `<span class="art-ligne-meta">${esc(meta.join(' · '))}</span>` : ''}
    </span>
    <span class="art-ligne-compteurs">
      ${a._n ? `<span class="art-ligne-n" title="${a._n} objet${a._n > 1 ? 's' : ''}">${a._n} obj.</span>` : ''}
      ${a._nVentes ? `<span class="art-ligne-nventes" title="${a._nVentes} vente${a._nVentes > 1 ? 's' : ''} aux enchères connues">🔨 ${a._nVentes}</span>` : ''}
    </span>
  </article>`;
}

export async function loadArtistesList() {
  const el = $('#artistes-body');
  el.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  // Compteur de ventes : PostgREST n'a pas d'agrégation GROUP BY sans vue ni
  // RPC dédiée (sondé HO-162, aucune n'existe sur ce projet) — repli sur une
  // colonne seule (975 valeurs courtes) comptée en JS par compterVentes().
  const [{ data, error }, { data: ventesRows }] = await Promise.all([
    sb.from('artistes').select('*').eq('owner_id', S.tenantId).order('nom'),
    sb.from('ventes_artiste').select('artiste_nom').eq('owner_id', S.tenantId),
    ensureCollection(),
  ]);
  const nVentesParNom = compterVentes(ventesRows);
  const corps = page(el, { titre: 'Artistes', fil: S.fil });
  if (error) { console.warn('artiste:', error); toast(`Fiche artiste non chargée — ${humaniser(error)}.`, 'panne'); corps.innerHTML = ''; return; }
  if (!data?.length) {
    corps.innerHTML = emptyHtml('Aucune fiche artiste pour l\'instant', 'Le cron les crée lors des passes d\'identification.');
    return;
  }

  // Portraits et alias : deux requêtes pour toute la liste, jamais une par
  // ligne. Les vignettes sont signées en un seul lot.
  const noms = data.map(a => a.nom);
  const [{ data: portraits }, { data: alias }] = await Promise.all([
    sb.from('artistes_photos').select('artiste_nom,storage_path,thumb_path')
      .eq('owner_id', S.tenantId).eq('zone', 'portrait').in('artiste_nom', noms)
      .order('ordre', { nullsFirst: false }).order('created_at'),
    sb.from('artistes_alias').select('artiste_nom,alias').eq('owner_id', S.tenantId),
  ]);
  const parNom = {};
  for (const p of portraits ?? []) if (!parNom[p.artiste_nom]) parNom[p.artiste_nom] = p;
  const chemins = Object.values(parNom).map(p => p.thumb_path ?? p.storage_path).filter(Boolean);
  const urlByPath = chemins.length ? await signPaths(chemins) : {};
  const aliasParNom = {};
  for (const a of alias ?? []) (aliasParNom[a.artiste_nom] ??= []).push(a.alias);

  const nbObjets = nom => S.collection.filter(o => auteurMatch(o.auteur, nom)).length;
  // Index de recherche calculé UNE fois : renormaliser 50 fiches à chaque
  // frappe serait du travail jeté à chaque caractère.
  const fiches = data.map(a => {
    const p = parNom[a.nom];
    return {
      ...a,
      _n: nbObjets(a.nom),
      _nVentes: nVentesParNom.get(a.nom) ?? 0,
      _url: p ? urlByPath[p.thumb_path ?? p.storage_path] : null,
      _cherche: indexRecherche(a, aliasParNom[a.nom] ?? []),
    };
  });

  corps.innerHTML = `
    <div class="art-recherche">
      <input type="search" id="art-q" class="art-recherche-champ" placeholder="Chercher un artiste, un art, un pays…"
             aria-label="Chercher un artiste" autocomplete="off" enterkeyhint="search">
    </div>
    <p class="art-compte" id="art-compte" role="status"></p>
    <div class="art-liste" id="art-liste"></div>`;

  const listeEl = $('#art-liste', corps);
  const compteEl = $('#art-compte', corps);

  const rendre = (saisie = '') => {
    const vus = filtrer(fiches, saisie);
    listeEl.innerHTML = vus.length
      ? vus.map(ligne).join('')
      : `<p class="art-vide">Aucun artiste ne correspond à « ${esc(saisie)} ».</p>`;
    compteEl.textContent = vus.length === fiches.length
      ? `${fiches.length} artiste${fiches.length > 1 ? 's' : ''}`
      : `${vus.length} sur ${fiches.length}`;
    // Les lignes sont réécrites à chaque frappe : leurs écouteurs aussi.
    $$('.art-ligne', listeEl).forEach(c => {
      const go = () => { location.hash = '#/artiste/' + encodeURIComponent(c.dataset.nom); };
      c.addEventListener('click', go);
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  };

  rendre();
  $('#art-q', corps).addEventListener('input', e => rendre(e.target.value));
}
