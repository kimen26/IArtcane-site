// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — services/artistes.js : renommer une fiche artiste (HO-150,
// demande Alain n°21). Données → données (docs/architecture-briques.md §2) :
// ni HTML, ni toast — c'est la vue (views/artiste/identite.js) qui affiche.
//
// `artistes.nom` est la clé de jointure de trois tables par FK composite
// (owner_id, artiste_nom) — artistes_photos, artistes_notes, artistes_alias.
// Ces FK n'ont pas de `on update cascade` (update_rule = NO ACTION) et
// `artistes_alias` cascade en DELETE (donc supprimer l'ancienne fiche avant
// d'avoir déplacé ses propres alias les perdrait). Patron du renommage repris
// tel quel de infra/supabase/migrations/0036_noms_artistes_nom_prenom.sql :
//   1. insérer la fiche cible (copie du contenu),
//   2. déplacer les enfants (artistes_photos, artistes_notes, artistes_alias),
//   3. supprimer l'ancienne fiche,
//   4. réaligner objets.auteur (texte libre, sans FK),
//   5. réaligner ventes_artiste / sources_consultations (texte libre),
//   6. insérer l'ancien nom comme alias de la cible (D-091) — sinon le cron
//      qui résout les alias (infra/cron/resoudre-artiste.py) recrée une fiche
//      sur l'ancien nom à la prochaine identification (mécanique même des
//      grappes de doublons fermées par 0039).
//
// ⚠️ Indirection `deps()` volontaire (comme services/photos.js) : core/data.js
// importe le SDK Supabase depuis une URL `https:`, un schéma que le loader
// ESM de Node refuse (ERR_UNSUPPORTED_ESM_URL_SCHEME). `deps()` importe
// paresseusement au premier appel réel ; `_injecterDeps()` permet à
// infra/test-service-artistes.mjs de fournir un double de `sb` sans jamais
// toucher au vrai client.
//
// Chaque requête porte owner_id (L-091) : PONAIRE et DEMO portent les mêmes
// noms d'artistes, un `where nom = …` nu écrirait dans les deux maisons.
// ═══════════════════════════════════════════════════════════════════════════
import { S } from '../core/state.js';

let _deps = null;
async function deps() {
  if (!_deps) _deps = await import('../core/data.js');
  return _deps;
}
/** Test-only : injecte un double de core/data.js (sb) avant tout appel réel. */
export function _injecterDeps(fauxDeps) { _deps = fauxDeps; }

// Colonnes de contenu copiées de l'ancienne fiche vers la cible — lues en
// base le 2026-09-07 (information_schema.columns) : owner_id, nom, created_at,
// updated_at sont gérées par la fiche cible elle-même (defaults / la clé),
// dossier et categories sont NOT NULL (défauts jsonb côté schéma si absents).
const COLONNES_COPIEES = ['bio_md', 'dossier', 'commentaire', 'type', 'pays', 'region', 'categories'];

/**
 * Renomme une fiche artiste : l'ancien nom devient un alias de la cible.
 * Refuse tôt les cas invalides (aucune écriture) : nom vide, identique à
 * l'ancien, ou fiche cible déjà existante (une fusion n'est pas un
 * renommage — hors périmètre, à faire par un autre geste).
 * @param {string} ancien  nom actuel de la fiche (A.nom)
 * @param {string} nouveauBrut  nom saisi par l'utilisateur
 * @returns {Promise<{ok:true, nouveau:string} | {ok:false, erreur:string, etape?:string}>}
 */
export async function renommer(ancien, nouveauBrut) {
  const nouveau = String(nouveauBrut ?? '').trim();
  if (!nouveau) {
    return { ok: false, erreur: 'Le nom ne peut pas être vide.' };
  }
  if (nouveau === String(ancien ?? '').trim()) {
    return { ok: false, erreur: 'Le nom n\'a pas changé.' };
  }

  const d = await deps();
  const ownerId = S.tenantId;

  // ─── 0. Refuser si la fiche cible existe déjà (fusion ≠ renommage) ───────
  const { data: existante, error: eLookup } = await d.sb.from('artistes')
    .select('nom').eq('owner_id', ownerId).eq('nom', nouveau).maybeSingle();
  if (eLookup) return { ok: false, erreur: eLookup.message, etape: 'verification-cible' };
  if (existante) {
    return { ok: false, erreur: `Une fiche « ${nouveau} » existe déjà — c'est une fusion, pas un renommage. Ce geste n'est pas pris en charge ici.` };
  }

  // ─── 1. Lire la fiche source (contenu à copier) ──────────────────────────
  const { data: source, error: eSource } = await d.sb.from('artistes')
    .select('*').eq('owner_id', ownerId).eq('nom', ancien).maybeSingle();
  if (eSource) return { ok: false, erreur: eSource.message, etape: 'lecture-source' };
  if (!source) return { ok: false, erreur: `Fiche « ${ancien} » introuvable.`, etape: 'lecture-source' };

  // ─── 2. Insérer la fiche cible (copie du contenu) ────────────────────────
  const copie = { owner_id: ownerId, nom: nouveau };
  for (const col of COLONNES_COPIEES) copie[col] = source[col];
  const { error: eInsert } = await d.sb.from('artistes').insert(copie);
  if (eInsert) return { ok: false, erreur: eInsert.message, etape: 'insertion-cible' };

  // ─── 3. Déplacer les enfants ──────────────────────────────────────────────
  const { error: ePhotos } = await d.sb.from('artistes_photos')
    .update({ artiste_nom: nouveau }).eq('owner_id', ownerId).eq('artiste_nom', ancien);
  if (ePhotos) return { ok: false, erreur: ePhotos.message, etape: 'deplacement-photos' };

  const { error: eNotes } = await d.sb.from('artistes_notes')
    .update({ artiste_nom: nouveau }).eq('owner_id', ownerId).eq('artiste_nom', ancien);
  if (eNotes) return { ok: false, erreur: eNotes.message, etape: 'deplacement-notes' };

  const { error: eAlias } = await d.sb.from('artistes_alias')
    .update({ artiste_nom: nouveau }).eq('owner_id', ownerId).eq('artiste_nom', ancien);
  if (eAlias) return { ok: false, erreur: eAlias.message, etape: 'deplacement-alias' };

  // ─── 4. Supprimer l'ancienne fiche (plus aucun enfant ne la référence) ───
  const { error: eDelete } = await d.sb.from('artistes')
    .delete().eq('owner_id', ownerId).eq('nom', ancien);
  if (eDelete) return { ok: false, erreur: eDelete.message, etape: 'suppression-ancienne' };

  // ─── 5. Réaligner objets.auteur (texte libre, sans FK) ───────────────────
  const { error: eObjets } = await d.sb.from('objets')
    .update({ auteur: nouveau }).eq('owner_id', ownerId).eq('auteur', ancien);
  if (eObjets) return { ok: false, erreur: eObjets.message, etape: 'realignement-objets' };

  // ─── 6. Réaligner les tables à nom libre ─────────────────────────────────
  const { error: eVentes } = await d.sb.from('ventes_artiste')
    .update({ artiste_nom: nouveau }).eq('owner_id', ownerId).eq('artiste_nom', ancien);
  if (eVentes) return { ok: false, erreur: eVentes.message, etape: 'realignement-ventes' };

  const { error: eSources } = await d.sb.from('sources_consultations')
    .update({ artiste: nouveau }).eq('owner_id', ownerId).eq('artiste', ancien);
  if (eSources) return { ok: false, erreur: eSources.message, etape: 'realignement-sources' };

  // ─── 7. Insérer l'ancien nom comme alias de la cible (D-091) ─────────────
  // Tolère un alias déjà présent (unicité (owner_id, alias_norm)) : ne fait
  // pas échouer tout le renommage pour ça — l'ancien nom référence déjà la
  // bonne fiche dans ce cas.
  // `alias_norm` n'est PAS posée ici : c'est une colonne GENERATED ALWAYS
  // (migration 0038), calculée par Postgres. L'écrire fait échouer l'insert —
  // vérifié par le chemin réel du site le 2026-09-07 : PostgREST répond 400
  // « cannot insert a non-DEFAULT value into column alias_norm » avec, et 201
  // sans (la colonne vaut alors bien « roger capron »). Chercher un TRIGGER ne
  // suffit pas à conclure qu'une colonne est au client : il faut lire
  // `information_schema.columns.is_generated`.
  const { error: eAliasInsert } = await d.sb.from('artistes_alias').insert({
    owner_id: ownerId, artiste_nom: nouveau, alias: ancien, origine: 'humain',
  });
  if (eAliasInsert && eAliasInsert.code !== '23505') {
    return { ok: false, erreur: eAliasInsert.message, etape: 'alias-ancien-nom' };
  }

  return { ok: true, nouveau };
}
