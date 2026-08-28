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
