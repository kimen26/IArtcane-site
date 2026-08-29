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

/** Segments hiérarchiques d'un écran, racine → page courante (HO-104).
 *  Le dernier segment n'a pas de `hash` : c'est la page courante (non cliquable).
 *  Pour `objet`, le libellé de catégorie (2e segment) n'est pas connu ici — la
 *  vue le complète une fois l'objet chargé (catCanon(o.categorie)) ; cette
 *  fonction ne fournit que la forme (docs/architecture-briques.md §2.1).
 *  @returns {Array<{label:string, hash?:string}>}
 */
export function filDe(view, params = []) {
  const COLLECTION = { label: 'Collection', hash: '#/' };
  switch (view) {
    case 'collection': return [{ label: 'Collection' }];
    case 'rayon':      return [COLLECTION, { label: params[0] || 'Rayon' }];
    case 'objet':      return [COLLECTION, { label: 'Objet' }, { label: `#${params[0] ?? ''}` }];
    case 'capture':    return [COLLECTION, { label: 'Capturer' }];
    case 'artistes':   return [COLLECTION, { label: 'Artistes' }];
    case 'artiste':    return [COLLECTION, { label: 'Artistes', hash: '#/artistes' }, { label: params[0] || 'Artiste' }];
    case 'maison':     return [COLLECTION, { label: 'Maison' }];
    case 'activite':   return [COLLECTION, { label: 'Activité' }];
    case 'sources':    return [COLLECTION, { label: 'Sources' }];
    case 'categories': return [COLLECTION, { label: 'Catégories & familles' }];
    case 'demandes':   return [COLLECTION, { label: 'Demandes' }];
    default:           return [{ label: 'Collection' }];
  }
}
