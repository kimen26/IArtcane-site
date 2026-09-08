// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/etat.js : état local de la fiche artiste (hub 3a).
//
// Partage les données chargées entre les sous-écrans du territoire artiste.
// Exporte un objet A muté en place + des hooks branchés par index.js.
// ═══════════════════════════════════════════════════════════════════════════

/** État partagé du territoire artiste. */
export const A = {
  nom: null,           // nom normalisé de l'artiste (clé d'URL)
  artiste: null,       // ligne `artistes` (maybeSingle)
  images: [],          // [{ ...artistes_photos, url, thumbUrl }]
  objets: [],          // objets de S.collection liés par auteurMatch
  ventes: [],          // comparables adjudication non exclus
  signatures: [],      // photos kind='signature' des objets liés [{ ..., url, thumbUrl, objetId }]
  notes: [],           // artistes_notes triées created_at asc
  cote: null,          // ligne artistes_cote (vue dérivée du pool, HO-144) — maybeSingle
  lotsMarteau: [],      // ventes_artiste prix_type='marteau', non invendu — inchangé (HO-144), consommé par la note « € » (blocs.js), ne pas y toucher
  pool: [],            // ventes_artiste — TOUT le pool (HO-162), chacun enrichi de `imageSrc` (URL signée depuis image_path, absente si pas d'image)
  poolTotal: 0,         // nombre réel de lignes en base pour l'artiste (peut dépasser pool.length si plafonné à 300)
  ecran: 'fiche',      // 'fiche' pour l'instant ; HO-053 ajoutera d'autres écrans
  focus: null,         // { objetId } | null — prévu pour surligner les ventes
  pendingPhotos: [],   // ids des photos jointes au composeur de notes (index.js les mute, blocs-maison.js les lit)
};

/** Branchés par views/artiste/index.js au chargement du module. */
export const hooks = {
  recharger: null,   // (nom) => Promise — recharge toute la fiche
  naviguer: null,    // (ecran, focus?) => void
};
