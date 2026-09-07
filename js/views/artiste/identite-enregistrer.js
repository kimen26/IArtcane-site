// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/identite-enregistrer.js : orchestration de
// l'enregistrement du bloc Identité (HO-150) — extrait de identite.js
// (dépassait le plafond 400 lignes une fois le champ Nom ajouté, L-096 :
// le cliquet dit où découper, pas quoi raboter).
//
// Le service porte le métier du renommage (site/js/services/artistes.js) ;
// ce module ne fait qu'assembler : valider la saisie, appeler le service SI
// le nom a changé, appliquer les champs d'identité restants sur la fiche
// (cible du renommage le cas échéant), puis rafraîchir l'écran.
//
// Import paresseux de core/data.js/core/feedback.js/services/artistes.js —
// même motif que identite.js (core/data.js importe le SDK Supabase par une
// URL `https:` que Node refuse en import statique).
// ═══════════════════════════════════════════════════════════════════════════
import { S } from '../../core/state.js';
import { A, hooks } from './etat.js';
import { validerIdentite } from './identite.js';

let _deps = null;
async function deps() {
  if (!_deps) _deps = await Promise.all([import('../../core/data.js'), import('../../core/feedback.js'), import('../../services/artistes.js')]);
  return _deps;
}
/** Test-only : injecte un double de [core/data.js, core/feedback.js, services/artistes.js] avant tout appel réel. */
export function _injecterDeps(fauxDeps) { _deps = fauxDeps; }

/**
 * Valide puis enregistre le bloc Identité, en renommant d'abord la fiche si
 * le nom a changé. `finEdition()` est appelé (annule enEdition/brouillon côté
 * identite.js) dès que l'écriture a réussi, avant le rafraîchissement.
 * @param {{nom?:string, type?:string, pays?:string, region?:string, categories?:Array}} brouillon
 * @param {() => void} finEdition
 */
export async function onEnregistrer(brouillon, finEdition) {
  const [{ sb, logEvent }, { toast, enregistrer }, { renommer }] = await deps();
  const resultat = validerIdentite(brouillon);
  if (!resultat.ok) {
    toast(resultat.erreur, 'panne');
    return;
  }
  const { type, pays, region, categories } = resultat.valeurs;
  const nomSaisi = String(brouillon?.nom ?? '').trim();
  const nomActuel = A.nom;

  // Renommage demandé (le nom a changé) : le service exécute la séquence
  // complète (insertion cible, déplacement des enfants, alias) AVANT que les
  // champs d'identité ne soient appliqués — sur la fiche cible désormais.
  let nomCible = nomActuel;
  if (nomSaisi !== nomActuel) {
    const r = await renommer(nomActuel, nomSaisi);
    if (!r.ok) {
      toast(r.erreur, 'panne');
      return;
    }
    nomCible = r.nouveau;
  }

  // owner_id ET nom dans le filtre (L-091) : PONAIRE et DEMO peuvent porter
  // le même nom d'artiste, un `where nom = …` nu écrirait dans les deux.
  const ok = await enregistrer(() => sb.from('artistes')
    .update({ type, pays, region, categories })
    .eq('owner_id', S.tenantId)
    .eq('nom', nomCible), 'Identité');
  if (!ok) return;
  logEvent('artiste_identite', { artiste: nomCible, type, pays, region, n_categories: categories.length });
  finEdition();
  if (nomCible !== nomActuel) {
    // La vue s'appuie sur le nom dans l'URL (#/artiste/<nom>) : la mettre à
    // jour rafraîchit la fiche sous son nouveau nom sans rechargement manuel
    // (demande Alain n°21) — le hash routeur (app.js) déclenche mountDetail().
    location.hash = '#/artiste/' + encodeURIComponent(nomCible);
    return;
  }
  await hooks.recharger(nomCible);
}
