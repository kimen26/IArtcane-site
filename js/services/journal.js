// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — services/journal.js : le journal d'accueil (HO-119, données →
// données, docs/architecture-briques.md §2). Rien d'affiché et rien de
// persisté ici — la vue (views/accueil.js) rend le HTML et lit/écrit la
// dernière visite. Quatre fonctions de calcul PURES et exportées (testables
// sans réseau, infra/test-journal.mjs) + `chargerJournal()` qui lit
// `core/data.js` via `deps()`, motif de services/photos.js : core/data.js
// importe le SDK Supabase depuis une URL `https:`, un schéma que le loader
// ESM de Node refuse (ERR_UNSUPPORTED_ESM_URL_SCHEME) — un import statique
// romprait tout test hors-ligne de ce fichier sous Node.
// ═══════════════════════════════════════════════════════════════════════════
import { S } from '../core/state.js';
import { fmtNum, CHAMPS_OBLIGATOIRES } from '../core/format.js';

let _deps = null;
async function deps() {
  if (!_deps) _deps = await import('../core/data.js');
  return _deps;
}
/** Test-only : injecte un double de core/data.js (sb + primitives) avant tout appel réel. */
export function _injecterDeps(fauxDeps) { _deps = fauxDeps; }

// ─── Champs « obligatoires » → clé de lecture sur l'objet (HO-119 §calculerReste) ─
// `dimensions` = un des trois *_cm ; `categorie` = colonne `categorie` (brief).
const DIM_CHAMPS = ['longueur_cm', 'largeur_cm', 'hauteur_cm'];
function champRempli(o, champ) {
  if (champ === 'dimensions') return DIM_CHAMPS.some(c => o[c] != null && o[c] !== '');
  const v = o[champ];
  return v != null && v !== '';
}

// ─── calculerTravail() — bloc 1, agrégé, humain seulement ──────────────────
// Un évènement est humain si son acteur n'est ni 'site', ni 'cron', ni
// préfixé 'ia ' (R1/R2/R3/R9 tracent 'ia R1', etc. — cf. ACT_LABELS).
function estHumain(evt) {
  const a = evt.acteur;
  if (!a) return false;
  if (a === 'site' || a === 'cron') return false;
  if (a.startsWith('ia ')) return false;
  return true;
}

/**
 * @param {Array} evts  évènements (table `evenements`, plus récents d'abord)
 * @param {string|null} depuis  ISO de la dernière visite, ou null (1re visite)
 * @returns {null | { depuis:string, objets:number, nouveauxObjets:number, photos:number, commentaires:number, fichesCompletees:number }}
 */
export function calculerTravail(evts, depuis) {
  if (!depuis) return null;
  // Seuls les évènements POSTÉRIEURS à la dernière visite comptent : la fenêtre
  // chargée est plus large (30 j mini, pour les trouvailles).
  const humains = (evts || []).filter(e => estHumain(e) && e.created_at >= depuis);
  const objetsSet = new Set(humains.map(e => e.objet_id).filter(Boolean));
  if (objetsSet.size === 0) return null;
  const COMMENTAIRE_ACTIONS = new Set(['commentaire_photo', 'artiste_note', 'note_maison', 'artiste_image_commentaire']);
  let nouveauxObjets = 0, photos = 0, commentaires = 0, fichesCompletees = 0;
  for (const e of humains) {
    if (e.action === 'capture') nouveauxObjets++;
    else if (e.action === 'photo_ajoutee') photos++;
    else if (COMMENTAIRE_ACTIONS.has(e.action)) commentaires++;
    else if (e.action === 'validation') fichesCompletees++;
  }
  return { depuis, objets: objetsSet.size, nouveauxObjets, photos, commentaires, fichesCompletees };
}

// ─── calculerTrouvailles() — bloc 2, 2 max, iArcane nommé ──────────────────
/**
 * @param {Array} evts  évènements, plus récents d'abord
 * @param {Array} objets  S.collection (objets)
 * @param {Record<string,{thumbUrl:string|null}>} photoMap  objet_id → vignette déjà signée
 * @returns {Array<{type:'artiste'|'vente', valeur:string, objetId:string, objetTitre:string, thumbUrl:string|null, quand:string}>}
 */
export function calculerTrouvailles(evts, objets, photoMap) {
  const parId = new Map((objets || []).map(o => [String(o.id), o]));
  const vues = new Set(); // `${objetId}:${type}` — un seul par objet et par type
  const out = [];
  for (const e of evts || []) {
    if (out.length >= 2) break;
    const oid = e.objet_id;
    if (!oid) continue;
    const o = parId.get(String(oid));
    if (!o) continue;

    if (e.action === 'artiste_maj' || e.action === 'identification') {
      const auteur = o.auteur;
      if (!auteur) continue;
      const cle = `${oid}:artiste`;
      if (vues.has(cle)) continue;
      vues.add(cle);
      out.push({
        type: 'artiste', valeur: auteur, objetId: String(oid), objetTitre: o.titre || 'Sans titre',
        thumbUrl: photoMap?.[oid]?.thumbUrl ?? null, quand: e.created_at,
      });
    } else if (e.action === 'passe_marche') {
      if (o.prix_bas == null || o.prix_haut == null) continue;
      const cle = `${oid}:vente`;
      if (vues.has(cle)) continue;
      vues.add(cle);
      out.push({
        type: 'vente', valeur: `${fmtNum(o.prix_bas)} – ${fmtNum(o.prix_haut)} €`, objetId: String(oid),
        objetTitre: o.titre || 'Sans titre', thumbUrl: photoMap?.[oid]?.thumbUrl ?? null, quand: e.created_at,
      });
    }
  }
  return out.slice(0, 2);
}

// ─── calculerReste() — bloc 3, 3 lignes max, 0 omise ───────────────────────
/**
 * @param {Array} objets
 * @param {Array} photos  { objet_id, kind, thumb_path, couverture }
 * @returns {Array<{cle:'photosNonTaguees'|'artistesNonTrouves'|'infosNonValidees', n:number, apercu:Array<{objetId, thumbUrl}>}>}
 */
export function calculerReste(objets, photos) {
  const lignes = [];

  // photosNonTaguees : photos kind == null, aperçu = 3 objets distincts
  const photosSansKind = (photos || []).filter(p => p.kind == null);
  if (photosSansKind.length) {
    const objetsVus = [];
    for (const p of photosSansKind) {
      if (!objetsVus.includes(p.objet_id)) objetsVus.push(p.objet_id);
      if (objetsVus.length >= 3) break;
    }
    lignes.push({
      cle: 'photosNonTaguees', n: photosSansKind.length,
      apercu: objetsVus.map(oid => ({ objetId: String(oid), thumbUrl: null })),
    });
  }

  // artistesNonTrouves : auteur vide et statut !== 'en_attente'
  const sansArtiste = (objets || []).filter(o => (!o.auteur || o.auteur === '') && o.statut !== 'en_attente');
  if (sansArtiste.length) {
    lignes.push({
      cle: 'artistesNonTrouves', n: sansArtiste.length,
      apercu: sansArtiste.slice(0, 3).map(o => ({ objetId: String(o.id), thumbUrl: null })),
    });
  }

  // infosNonValidees : ≥ 1 champ obligatoire rempli et non validé (validation_champs[champ] absent)
  const nonValidees = (objets || []).filter(o => {
    const vc = o.validation_champs || {};
    return CHAMPS_OBLIGATOIRES.some(champ => champRempli(o, champ) && !vc[champ]);
  });
  if (nonValidees.length) {
    lignes.push({
      cle: 'infosNonValidees', n: nonValidees.length,
      apercu: nonValidees.slice(0, 3).map(o => ({ objetId: String(o.id), thumbUrl: null })),
    });
  }

  return lignes;
}

// ─── calculerResume() — bloc 4, l'état de la collection ────────────────────
/**
 * @param {Array} objets
 * @param {Date} maintenant
 * @returns {{objets:number, artistesIdentifies:number, fichesEstimees:number, valeurTotale:number|null, fichesValidees:number, ajoutsDuMois:number}}
 */
export function calculerResume(objets, maintenant) {
  const list = objets || [];
  const objetsN = list.length;
  const artistesIdentifies = list.filter(o => o.auteur && o.auteur !== '').length;
  const estimees = list.filter(o => o.prix_bas != null);
  const fichesEstimees = estimees.length;
  const valeurTotale = estimees.length
    ? Math.round(estimees.reduce((s, o) => s + (o.prix_bas + o.prix_haut) / 2, 0) / 100) * 100
    : null;
  const fichesValidees = list.filter(o => o.statut === 'validee').length;
  const m = maintenant.getMonth(), y = maintenant.getFullYear();
  const ajoutsDuMois = list.filter(o => {
    if (!o.created_at) return false;
    const d = new Date(o.created_at);
    return d.getMonth() === m && d.getFullYear() === y;
  }).length;
  return { objets: objetsN, artistesIdentifies, fichesEstimees, valeurTotale, fichesValidees, ajoutsDuMois };
}

// ─── chargerJournal() — assemblage, seul point qui touche le réseau ────────
/**
 * Le journal d'une maison : ce qui a bougé depuis `depuis` (ISO ou null =
 * première visite).
 * @param {{depuis:string|null}} opts
 * @returns {Promise<{travail, trouvailles, reste, resume}>}
 */
export async function chargerJournal({ depuis }) {
  const d = await deps();
  await d.ensureCollection();
  const objets = S.collection;

  // Fenêtre des évènements : au moins 30 jours, quel que soit `depuis` — les
  // trouvailles sont « les 2 plus récentes » (maquette), pas « depuis la visite » ;
  // seul `calculerTravail` se borne à `depuis` (revue HO-119 : un `depuis` posé à
  // l'instant vidait le bloc « iArcane a trouvé »).
  const trenteJours = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const bornePhotos = depuis && depuis < trenteJours ? depuis : trenteJours;
  const [{ data: photos }, { data: evts }] = await Promise.all([
    d.sb.from('photos').select('objet_id,kind,thumb_path,couverture,created_at').eq('owner_id', S.tenantId),
    d.sb.from('evenements').select('*').eq('owner_id', S.tenantId).gte('created_at', bornePhotos)
      .order('created_at', { ascending: false }).limit(2000),
  ]);
  const photosList = photos ?? [];
  const evtsList = evts ?? [];

  // Vignette de couverture par objet (jamais la brute — L-067)
  const couvParObjet = {};
  for (const p of photosList) {
    if (!couvParObjet[p.objet_id]) couvParObjet[p.objet_id] = p;
    else if (p.couverture) couvParObjet[p.objet_id] = p;
  }
  const pathsAConsigner = new Set(Object.values(couvParObjet).map(p => p.thumb_path).filter(Boolean));
  // Aperçus « il vous reste » : mêmes vignettes de couverture, par objet cité
  const objetsPourApercu = new Set();
  const resteBrut = calculerReste(objets, photosList);
  for (const ligne of resteBrut) for (const a of ligne.apercu) objetsPourApercu.add(a.objetId);
  for (const oid of objetsPourApercu) {
    const p = couvParObjet[oid];
    if (p?.thumb_path) pathsAConsigner.add(p.thumb_path);
  }
  const signed = await d.signPaths([...pathsAConsigner]);
  const photoMap = {};
  for (const [oid, p] of Object.entries(couvParObjet)) {
    photoMap[oid] = { thumbUrl: p.thumb_path ? (signed[p.thumb_path] ?? null) : null };
  }

  const travail = calculerTravail(evtsList, depuis);
  const trouvailles = calculerTrouvailles(evtsList, objets, photoMap);
  const reste = resteBrut.map(ligne => ({
    ...ligne,
    apercu: ligne.apercu.map(a => ({ ...a, thumbUrl: photoMap[a.objetId]?.thumbUrl ?? null })),
  }));
  const resume = calculerResume(objets, new Date());

  return { travail, trouvailles, reste, resume };
}
