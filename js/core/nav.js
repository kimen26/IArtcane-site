// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/nav.js : table des libellés de vue du fil d'Ariane (HO-025)
// Sortie du shell (app.js) pour tenir le plafond de modularité en cliquet
// (infra/check-site.mjs) — déplacée telle quelle depuis app.js par HO-082.
// ═══════════════════════════════════════════════════════════════════════════

export function viewLabel(view, params = []) {
  switch (view) {
    case 'collection': return 'Collection';
    case 'capture':    return 'Capturer';
    case 'artistes':   return 'Artistes';
    case 'artiste':    return params[0] || 'Artiste';
    case 'objet':      return 'Objet';
    case 'rayon':      return params[0] || 'Rayon';
    case 'maison':     return 'Maison';
    case 'activite':   return 'Activité';
    case 'sources':    return 'Sources';
    case 'demandes':   return 'Demandes';
    case 'categories': return 'Catégories & familles';
    default:           return 'Collection';
  }
}

/** Parent HIÉRARCHIQUE de chaque vue (≠ page précédemment visitée).
 *  Le bouton retour doit être prévisible : deux visites de la même page
 *  affichent le même libellé, quel que soit le chemin emprunté (HO-098). */
export function viewParent(view, params = []) {
  switch (view) {
    case 'artiste':    return { label: 'Artistes', hash: '#/artistes' };
    case 'rayon':      return { label: 'Collection', hash: '#/' };
    case 'objet':      return null; // la vue calcule son parent (rayon de la catégorie)
    case 'collection': return null; // racine : pas de retour
    default:           return { label: 'Collection', hash: '#/' };
  }
}
