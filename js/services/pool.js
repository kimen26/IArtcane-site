// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — services/pool.js : les deux portées de la contestation d'un
// comparable (HO-161, docs/doctrine-cotation.md §6). Données → données :
// zéro HTML, zéro toast — c'est l'appelant (la vue) qui affiche.
//
// - ecarterPourObjet() : portée OBJET — ce que faisait déjà `setExclu()` de
//   views/objet/ventes.js, déplacé ici tel quel.
// - ecarterDuPool()    : portée POOL — le lot sort de `ventes_artiste` pour
//   TOUS les objets qui le portaient, avec une trace `pool_exclusions`
//   écrite AVANT toute suppression (§ordre du brief).
// - retablir()          : ne concerne QUE la portée objet (un retrait du
//   pool ne se rétablit pas depuis cet écran — la ligne `pool_exclusions`
//   est la mémoire du refus).
//
// ⚠️ Indirection `deps()` (pas d'import statique de core/data.js) : même
// motif que services/photos.js — core/data.js importe le SDK Supabase
// depuis une URL `https:`, que le loader ESM de Node refuse tel quel. Un
// import statique romprait tout test hors-ligne sous Node.
// ═══════════════════════════════════════════════════════════════════════════
import { S } from '../core/state.js';

let _deps = null;
async function deps() {
  if (!_deps) _deps = await import('../core/data.js');
  return _deps;
}
/** Test-only : injecte un double de core/data.js (sb + primitives) avant tout appel réel. */
export function _injecterDeps(fauxDeps) { _deps = fauxDeps; }

/** Portée OBJET — écarte (ou rétablit) un comparable pour CET objet seulement.
 * `raison` vide au moment d'écarter → aucune écriture. */
export async function ecarterPourObjet(objetId, comparableId, motif) {
  if (!motif) return { ok: false };
  const { sb } = await deps();
  const { error } = await sb.from('comparables')
    .update({ exclu: true, raison_exclusion: motif })
    .eq('owner_id', S.tenantId).eq('objet_id', objetId).eq('id', comparableId);
  if (error) throw error;
  return { ok: true };
}

/** Ne concerne QUE la portée objet — un rétablissement de portée pool serait
 * un geste de cerveau, hors de cet écran (le brief, §3). */
export async function retablir(comparableId) {
  const { sb } = await deps();
  const { error } = await sb.from('comparables')
    .update({ exclu: false, raison_exclusion: null })
    .eq('owner_id', S.tenantId).eq('id', comparableId);
  if (error) throw error;
  return { ok: true };
}

/** Portée POOL — retire un lot de TOUT le pool de l'artiste : plus jamais
 * reproposé, sur aucun objet, définitivement.
 *
 * Ordre strict (chaque étape vérifiée avant la suivante — aucune suppression
 * avant que la trace soit écrite) :
 *   1. insert pool_exclusions (la mémoire du refus, jamais rejouée) ;
 *   2. update comparables.exclu=true sur TOUTES les lignes de la maison qui
 *      portent ce vente_id OU ce lien (tous les objets, pas seulement le
 *      courant) ;
 *   3. delete ventes_artiste sur ce vente_id (si vente_id est nul — un lot
 *      remonté par recherche LLM, hors pool — rien à supprimer, seule
 *      l'étape 2 s'applique).
 *
 * @param comparable  { vente_id, lien, lot, titre, intitule } — la carte affichée
 * @param artisteNom  nom de fiche (objets.auteur)
 * @param motif       jamais vide (appelant garde-fou déjà côté écran)
 * @returns {Promise<{ comparables_touches: number, retire_du_pool: boolean }>}
 * @throws  toute erreur réseau/RLS remonte telle quelle — le service n'avale rien.
 */
export async function ecarterDuPool(comparable, artisteNom, motif) {
  if (!motif) return { comparables_touches: 0, retire_du_pool: false };
  const { sb } = await deps();
  const venteId = comparable.vente_id ?? null;
  const lien = comparable.lien ?? null;
  const titreLot = comparable.lot ?? comparable.titre ?? comparable.intitule ?? null;

  // 1. Trace — avant tout, jamais rejouée par le collecteur (commun.py §JAMAIS).
  const { error: eTrace } = await sb.from('pool_exclusions').insert({
    owner_id: S.tenantId,
    vente_id: venteId,
    lien,
    artiste_nom: artisteNom,
    motif,
    titre_lot: titreLot,
    acteur: 'humain',
  });
  if (eTrace) throw eTrace;

  // 2. Toutes les fiches qui portent ce lot (vente_id OU lien), pas seulement l'objet courant.
  let requete = sb.from('comparables')
    .update({ exclu: true, raison_exclusion: motif })
    .eq('owner_id', S.tenantId);
  requete = venteId != null
    ? requete.or(`vente_id.eq.${venteId},lien.eq.${lien ?? ''}`)
    : requete.eq('lien', lien ?? '');
  const { data: touches, error: eMaj } = await requete.select('id');
  if (eMaj) throw eMaj;

  // 3. Retrait effectif du pool — seulement si le lot en venait (vente_id non nul).
  let retireDuPool = false;
  if (venteId != null) {
    const { error: eDel } = await sb.from('ventes_artiste')
      .delete().eq('owner_id', S.tenantId).eq('id', venteId);
    if (eDel) throw eDel;
    retireDuPool = true;
  }

  return { comparables_touches: touches?.length ?? 0, retire_du_pool: retireDuPool };
}
