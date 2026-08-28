// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/state.js : état partagé de l'app (D-039)
// Source unique des variables transverses (session, locataire, caches).
// Règles : views → core, jamais l'inverse ; ce module n'importe rien.
// Les hooks refreshHeader/refreshMenu sont branchés par le shell (app.js)
// au démarrage — les vues les appellent sans importer le shell (pas de cycle).
// ═══════════════════════════════════════════════════════════════════════════

export const S = {
  user: null,
  tenantId: null,          // locataire courant : soi-même, ou l'owner dont on est membre (D-015)
  tenantName: '',          // nom de la « maison » (D-016) — ex. PONAIRE
  mesTenants: [],          // [{ id, name, role }] — sa maison d'abord (role 'owner'), puis ses memberships
  tenantRole: 'owner',     // rôle dans le locataire courant : 'owner' | 'admin' | 'lecteur'
  collection: [],          // cache des objets (rechargé à chaque visite collection)
  photoMap: {},            // objet_id → { url, fx, fy, vid } (URL signée de la 1re photo)
  // cats = chips catégories multi-cochées ; prixMin/prixMax = bornes du filtre prix (null = non renseigné)
  filters: { q: '', cats: [], group: 'categorie', list: '', prixMin: null, prixMax: null },
  currentObjet: null,      // objet ouvert sur la fiche (utilisé par logEvent, caméra, lightbox)
  capFiles: [],            // clichés en attente d'enregistrement (vue Capturer)
  currentView: null,       // { view, tab, hash, label, params } — vue affichée (contexte des demandes, D-072)
  demandesOuvertes: 0,     // demandes non closes de la maison (pastille d'en-tête)
  // Hooks branchés par le shell — rafraîchissement transverse depuis les vues
  refreshHeader: null,
  refreshMenu: null,
  refreshDemandes: null,
};

// Un lecteur voit tout le catalogue mais ne peut rien modifier (RLS 0012 + UI masquée).
export const canWrite = () => S.tenantRole !== 'lecteur';
