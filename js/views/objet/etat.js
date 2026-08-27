// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/etat.js : état local de la fiche produit.
//
// Territoire découpé en sous-écrans (index / photos / identification / ventes /
// description / historique) qui partagent les mêmes données chargées. Cet
// objet en est la source unique — même parti pris que core/state.js pour l'app :
// on exporte un OBJET dont on mute les champs, jamais des `let` exportés.
//
// `hooks` évite toute dépendance circulaire entre les modules : index.js y
// branche ses fonctions de rechargement/rendu/navigation ; les sous-écrans les
// appellent sans importer index.js.
// ═══════════════════════════════════════════════════════════════════════════
import { toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { sb, logEvent } from '../../core/data.js';

export const O = {
  photos: [],     // [{ ...photo, url, thumbUrl }] — sans `sel` (galerie déplacée)
  comps: [],      // comparables de l'objet
  fiche: null,    // dernière fiche IA (version max)
  events: [],     // changelog (table evenements, 50 derniers)
  artiste: null,  // fiche artiste rattachée (table artistes) ou null
  pipe: null,     // état R1/R2/R3/Valo (computePipe)
  jobs: [],       // jobs en attente/en cours
  ecran: 'hub',   // 'hub' | 'photos' | 'identification' | 'ventes' | 'description' | 'historique'
  focus: null,    // { champ } | { photoId } — consommé par l'écran cible puis remis à null
};

/** Photo actuellement affichée dans la galerie (à défaut : la première). */
export const selPhoto = () => O.photos[0];

/** Branchés par views/objet/index.js au chargement du module. */
export const hooks = {
  recharger: null,  // (id) => Promise — recharge toute la fiche depuis la base
  rendre: null,     // ()   => void    — re-rend la fiche depuis l'état courant
  naviguer: null,   // (ecran, focus?) => void — index.js pose O.ecran/O.focus puis re-rend
};

// ─── Validation par champ (motif central HO-046) ────────────────────────────

export const CHAMPS_VALIDABLES = ['titre','categorie','auteur','technique','periode','ecole','etat','marques','dimensions','prix','description'];
// 'dimensions' = triplet hauteur/largeur/profondeur_cm ; 'prix' = prix_bas+prix_haut.

/** Renvoie true si le champ est validé dans objets.validation_champs. */
export const estValide = (champ) => Boolean(S.currentObjet?.validation_champs?.[champ]);

/** Pastille ronde 20 px : validé = plein --ok + ✓ ; sinon cercle vide. */
export function pastilleHtml(champ) {
  const ok = estValide(champ);
  const title = ok ? 'Validé par un humain' : 'À valider';
  const cls = ok ? 'pastille ok' : 'pastille';
  return `<span class="${cls}" data-action="toggle-val" data-champ="${champ}" title="${title}" role="button" aria-label="${title}">${ok ? '✓' : ''}</span>`;
}

/** Bascule validation_champs[champ] = { par, at } ou suppression de la clé. */
export async function toggleValidation(champ) {
  const o = S.currentObjet;
  if (!o) return;
  const qui = localStorage.getItem('iartcane-qui') ?? 'alain';
  const vc = { ...(o.validation_champs || {}) };
  const actuel = vc[champ];
  if (actuel) {
    delete vc[champ];
  } else {
    vc[champ] = { par: qui, at: new Date().toISOString() };
  }
  const { error } = await sb.from('objets').update({ validation_champs: vc }).eq('owner_id', S.tenantId).eq('id', o.id);
  if (error) { toast?.(error.message, true); return; }
  o.validation_champs = vc;
  logEvent('validation_champ', { champ, valide: !actuel });
  hooks.rendre?.();
}
