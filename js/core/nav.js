// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/nav.js : table des libellés de vue du fil d'Ariane (HO-025)
// Sortie du shell (app.js) pour tenir le plafond de modularité en cliquet
// (infra/check-site.mjs) — déplacée telle quelle depuis app.js par HO-082.
// ═══════════════════════════════════════════════════════════════════════════

export function viewLabel(view, params = []) {
  switch (view) {
    case 'accueil':    return 'Accueil';
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
    case 'rayon':      return { label: 'Collection', hash: '#/collection' };
    case 'objet':      return null; // la vue calcule son parent (rayon de la catégorie)
    case 'collection': return null; // racine : pas de retour
    case 'accueil':    return null; // racine : pas de retour
    default:           return { label: 'Accueil', hash: '#/' };
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
  const ACCUEIL    = { label: 'Accueil', hash: '#/' };
  const COLLECTION = { label: 'Collection', hash: '#/collection' };
  switch (view) {
    case 'accueil':    return [{ label: 'Accueil' }];
    case 'collection': return [ACCUEIL, { label: 'Collection' }];
    case 'rayon':      return [ACCUEIL, COLLECTION, { label: params[0] || 'Rayon' }];
    case 'objet':      return [ACCUEIL, COLLECTION, { label: 'Objet' }, { label: `#${params[0] ?? ''}` }];
    case 'capture':    return [ACCUEIL, { label: 'Capturer' }];
    case 'artistes':   return [ACCUEIL, { label: 'Artistes' }];
    case 'artiste':    return [ACCUEIL, { label: 'Artistes', hash: '#/artistes' }, { label: params[0] || 'Artiste' }];
    case 'maison':     return [ACCUEIL, { label: 'Maison' }];
    case 'activite':   return [ACCUEIL, { label: 'Activité' }];
    case 'sources':    return [ACCUEIL, { label: 'Sources' }];
    case 'categories': return [ACCUEIL, { label: 'Catégories & familles' }];
    case 'demandes':   return [ACCUEIL, { label: 'Demandes' }];
    default:           return [{ label: 'Accueil' }];
  }
}
