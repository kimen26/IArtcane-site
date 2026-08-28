// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/sources/etat.js : état de la vue Sources (HO-059)
//
// Territoire autonome (D-039/D-041). Ce module charge :
//   • site/data/sources.json  — métadonnées (périmètre / statut / trigger, HO-058)
//   • sources_consultations   — rendement DÉRIVÉ (30 j, par source_nom) — 0026
//   • objets / photos / comparables — les « trous » qui alimentent les mesures
//     de déclenchement d'achat (meta.mesures du JSON, clé fermée)
//
// Rien n'est saisi à la main : le rendement et l'avancement des déclencheurs
// sont entièrement calculés. Une mesure non calculable proprement vaut `null`
// (affichée « — ») — jamais un chiffre inventé (règle d'or).
// ═══════════════════════════════════════════════════════════════════════════
import { S } from '../../core/state.js';
import { sb } from '../../core/data.js';
import { catCanon } from '../../core/format.js';

export const SRC = {
  data: null,          // contenu brut de sources.json
  rendement: {},       // source_nom → { vues, utiles, derniereVue } (30 j, S-A)
  consultations: [],   // lignes brutes (tout l'historique) — filtrées côté S-B (fenêtre + besoin)
  mesures: {},         // clé meta.mesures → nombre | null
  ecarts: [],          // messages d'écart (mesures non calculables proprement)
  q: '',               // filtre de recherche (nom de source)
  ouvert: null,        // id de section actuellement dépliée (accordéon : un seul)
  plusDeplie: {},      // id de section → true si « voir les N autres » a été cliqué
};

/** Branchés par views/sources/index.js. */
export const hooks = {
  rendre: null,        // () => void — re-rend depuis l'état courant
  recharger: null,     // () => Promise — recharge tout depuis la base
};

const JOURS_30 = 30 * 24 * 3600 * 1000;
const ilya30j = () => new Date(Date.now() - JOURS_30).toISOString();

/** true si l'auteur d'un objet n'est pas résolu (aucun nom, ou chaîne vide). */
const auteurVide = o => !o.auteur || !String(o.auteur).trim();

// ─── Chargement ────────────────────────────────────────────────────────────

export async function chargerTout() {
  SRC.data ??= await (await fetch('data/sources.json')).json();
  await Promise.all([chargerRendement(), chargerConsultations(), chargerMesures()]);
}

// Agrégat des consultations sur 30 jours, par nom canonique de source (S-A).
async function chargerRendement() {
  SRC.rendement = {};
  const { data, error } = await sb
    .from('sources_consultations')
    .select('source_nom, a_nourri, created_at')
    .eq('owner_id', S.tenantId)
    .gte('created_at', ilya30j());
  if (error) { console.warn('sources_consultations:', error.message); return; }
  for (const c of data ?? []) {
    const r = SRC.rendement[c.source_nom] ??= { vues: 0, utiles: 0, derniereVue: null };
    r.vues++;
    if (c.a_nourri) r.utiles++;
    if (!r.derniereVue || c.created_at > r.derniereVue) r.derniereVue = c.created_at;
  }
}

// Lignes brutes, tout l'historique (S-B « Palmarès ») — la fenêtre 30 j/tout et
// le filtre de besoin s'appliquent côté vue, sans re-requêter.
async function chargerConsultations() {
  SRC.consultations = [];
  const { data, error } = await sb
    .from('sources_consultations')
    .select('source_nom, besoin, objet_id, a_nourri, created_at')
    .eq('owner_id', S.tenantId);
  if (error) { console.warn('sources_consultations (palmarès):', error.message); return; }
  SRC.consultations = data ?? [];
}

// Les 4 mesures de la clé fermée meta.mesures (HO-058). Chaque mesure est un
// compte d'objets sur 30 jours ; ce qu'on ne sait pas calculer proprement
// (« coté », périmètre DACH) est signalé dans SRC.ecarts et vaut null.
async function chargerMesures() {
  SRC.mesures = {};
  SRC.ecarts = [];
  const depuis = ilya30j();

  const [{ data: objets, error: eO }, { data: sign, error: eS }, { data: comps, error: eC }] = await Promise.all([
    sb.from('objets').select('id, auteur, categorie, created_at')
      .eq('owner_id', S.tenantId).gte('created_at', depuis),
    sb.from('photos').select('objet_id, kind')
      .eq('owner_id', S.tenantId).eq('kind', 'signature'),
    sb.from('comparables').select('objet_id').eq('owner_id', S.tenantId),
  ]);
  if (eO || eS || eC) {
    SRC.ecarts.push('Base indisponible : mesures de déclenchement non calculées.');
    for (const k of Object.keys(SRC.data?.meta?.mesures ?? {})) SRC.mesures[k] = null;
    return;
  }

  const recents = objets ?? [];
  const avecComp = new Set((comps ?? []).map(c => c.objet_id));
  const avecSignature = new Set((sign ?? []).map(p => p.objet_id));

  // Pas de champ « artiste coté » en base : on compte tous les objets récents
  // à auteur non résolu (écart signalé — le seuil du JSON parle d'« artistes
  // cotés »).
  SRC.mesures.artistes_non_resolus_30j = recents.filter(auteurVide).length;
  SRC.ecarts.push('« artistes non résolus » : compté sur tous les objets récents sans auteur — pas de notion « coté » en base.');

  // Signature à déchiffrer : objet récent portant une photo taguée `signature`
  // et sans auteur résolu (vocabulaire de tag vérifié : photos.kind='signature',
  // migration 0001/0024).
  SRC.mesures.signatures_a_dechiffrer_30j = recents
    .filter(o => avecSignature.has(o.id) && auteurVide(o)).length;

  // Pas de champ zone/pays DACH exploitable : mesure globale (objets récents
  // sans aucun comparable) — écart signalé.
  SRC.mesures.objets_dach_sans_comparable_30j = recents.filter(o => !avecComp.has(o.id)).length;
  SRC.ecarts.push('« objets DACH sans comparable » : compté globalement — aucun champ pays/zone DACH sur les objets.');

  // Tableaux récents sans comparable (catégorie canonique « Tableau »).
  SRC.mesures.tableaux_cotes_sans_comparable_30j = recents
    .filter(o => catCanon(o.categorie) === 'Tableau' && !avecComp.has(o.id)).length;
  SRC.ecarts.push('« tableaux cotés sans comparable » : filtre « coté » non disponible — tous les tableaux récents sans comparable.');
}

// ─── Marquage d'une consultation (le seul geste d'écriture de l'écran) ──────
// a_nourri reste false ici : le marquage « utile » se fait au moment où la
// consultation nourrit une fiche (point ouvert de la maquette — hors périmètre).

export async function marquerConsultee(sourceNom, besoinId, note) {
  const acteur = localStorage.getItem('iartcane-qui') || 'site';
  const { error } = await sb.from('sources_consultations').insert({
    owner_id: S.tenantId,
    source_nom: sourceNom,
    besoin: besoinId,
    acteur,
    outil: 'manuel',
    a_nourri: false,
    ...(note ? { note } : {}),
  });
  return { error };
}
