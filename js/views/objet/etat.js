// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/etat.js : état local de la fiche produit.
//
// La fiche est découpée en trois territoires (index / photos / edition) qui
// partagent les mêmes données chargées. Cet objet en est la source unique —
// même parti pris que core/state.js pour l'app : on exporte un OBJET dont on
// mute les champs, jamais des `let` exportés (qui seraient figés à l'import).
//
// `hooks` évite toute dépendance circulaire entre les trois modules : index.js
// y branche ses fonctions de rechargement/rendu, photos.js et edition.js les
// appellent sans importer index.js (même pattern que S.refreshHeader dans app.js).
// ═══════════════════════════════════════════════════════════════════════════

export const O = {
  photos: [],     // [{ ...photo, url, thumbUrl, sel }] — sel = vignette affichée
  comps: [],      // comparables de l'objet
  fiche: null,    // dernière fiche IA (version max)
  events: [],     // changelog (table evenements, 50 derniers)
  artiste: null,  // fiche artiste rattachée (table artistes) ou null
  editing: false, // mode « Corriger » actif
};

/** Photo actuellement affichée dans la galerie (à défaut : la première). */
export const selPhoto = () => O.photos.find(p => p.sel) ?? O.photos[0];

/** Branchés par views/objet/index.js au chargement du module. */
export const hooks = {
  recharger: null, // (id) => Promise — recharge toute la fiche depuis la base
  rendre: null,    // ()   => void    — re-rend la fiche depuis l'état courant
};
