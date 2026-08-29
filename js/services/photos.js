// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — services/photos.js : UN service pour les gestes photo, identiques
// pour un objet et pour une fiche artiste (HO-105, docs/architecture-briques.md
// §2.3). Données → données : zéro HTML, zéro toast — c'est l'appelant (la vue)
// qui affiche (§2 de l'architecture). Les 6 primitives bas niveau de
// core/data.js (uploadPhotosFor, uploadImageWithThumb, deleteStoredPhoto,
// makeVariantBlob, makeThumbBlob, purgeConsigne) restent inchangées ; ce
// service les CONSOMME, il ne les remplace pas.
//
// ⚠️ Indirection `deps()` volontaire (pas un `import` statique de core/data.js
// en tête de fichier) : core/data.js importe le SDK Supabase depuis une URL
// `https:` (CDN), un schéma que le loader ESM de Node refuse tel quel
// (ERR_UNSUPPORTED_ESM_URL_SCHEME — vérifié). Un import statique romprait donc
// tout test hors-ligne de ce fichier sous Node. `deps()` importe
// dynamiquement au premier appel réel (transparent dans le navigateur, où les
// URLs https sont résolues normalement) ; `_injecterDeps()` permet aux tests
// hors-ligne (infra/test-ui.mjs) de fournir un double de `sb` et des
// primitives AVANT le premier appel, sans jamais toucher au vrai client.
// ═══════════════════════════════════════════════════════════════════════════
import { S } from '../core/state.js';

let _deps = null;
async function deps() {
  if (!_deps) _deps = await import('../core/data.js');
  return _deps;
}
/** Test-only : injecte un double de core/data.js (sb + primitives) avant tout appel réel. */
export function _injecterDeps(fauxDeps) { _deps = fauxDeps; }

/** @typedef {{ table:'photos'|'artistes_photos', dossier:string, cle:Record<string,string> }} Cible */

// ─── Cibles ─────────────────────────────────────────────────────────────────
// Patron déjà en place dans deleteStoredPhoto(table, …) — prolongé ici.
export const cibleObjet = (objetId) => ({
  table: 'photos', dossier: `${S.tenantId}/${objetId}`, cle: { objet_id: objetId },
});
export const cibleArtiste = (nom) => ({
  table: 'artistes_photos', dossier: `${S.tenantId}/artistes`, cle: { artiste_nom: nom },
});

// ─── ajouter() — LE geste demandé par Yann ──────────────────────────────────
// Un seul appel enchaîne envoi du fichier, génération des 3 variantes (jamais
// en cascade — D-075), insertion de la ligne, ordre/kind/couverture (objet),
// purge de consigne et trace d'événement — ces deux derniers seulement si
// demandés par `opts` (une création d'objet en cours, par ex., ne veut ni
// l'un ni l'autre : la fiche n'existe pas encore côté S.currentObjet).
//
// Boucle UNIQUE pour les deux cibles, consommant uploadImageWithThumb —
// c'est le patron déjà en place pour la table `photos` dans uploadPhotosFor
// (core/data.js), étendu ici à artistes_photos. `uploadPhotosFor` lui-même
// n'est PAS appelé : il reste exporté et fonctionnel pour son appelant
// direct restant (core/camera.js), mais dupliquer son insertion ICI est ce
// qui rend le service testable hors ligne (cf. infra/test-ui.mjs) sans
// passer par lui — l'alternative (déléguer) aurait fait de `ajouter()` une
// boîte noire dont on ne peut pas prouver le contenu de la ligne insérée.
//
// Cible artiste (ou toute autre table sans kind/couverture/mini/moyen) :
// insertion minimale — colonnes absentes non écrites (constat HO-089,
// asymétrie de schéma à préserver, pas à corriger).
//
// @param {Cible} cible
// @param {(File|{file:File, comment?:string, kind?:string, cover?:boolean, ordre?:number, zone?:string})[]} fichiers
// @param {{ firstIsFace?:boolean, onProgress?:Function, evenement?:{action:string, detail?:object}, purgerConsigne?:boolean }} [opts]
// @returns {Promise<{done:number, failed:Array<{item, reason:string}>, ids:(string|null)[]}>}
export async function ajouter(cible, fichiers, opts = {}) {
  const d = await deps();
  const total = fichiers.length;
  let done = 0;
  const failed = [];
  const ids = [];
  let first = opts.firstIsFace ?? false;

  for (let i = 0; i < fichiers.length; i++) {
    const item = fichiers[i];
    const f = item instanceof File ? item : item?.file;
    if (!f) continue;
    if (opts.onProgress && opts.onProgress(done + failed.length, total) === false) break;

    const up = await d.uploadImageWithThumb(cible.dossier, f);
    if (!up) { failed.push({ item, reason: 'envoi du fichier impossible (réseau ?)' }); continue; }

    const row = { owner_id: S.tenantId, storage_path: up.path, thumb_path: up.thumbPath, ...cible.cle };
    if (cible.table === 'photos') {
      const kind = item.kind ?? (up.video ? 'video' : (first ? 'face' : 'autre'));
      row.mini_path = up.miniPath; row.moyen_path = up.moyenPath;
      row.kind = kind; row.source = 'site';
      row.commentaire = item instanceof File ? null : (item?.comment ?? null);
      row.ordre = item.ordre ?? i + 1;
      if (item.cover === true) row.couverture = true;
    } else if (item?.zone) {
      row.zone = item.zone; // artiste : ni mini_path ni moyen_path ni couverture (HO-089)
    }
    first = false;

    const { data, error } = await d.sb.from(cible.table).insert(row).select('id');
    if (error) { failed.push({ item, reason: error.message }); continue; }
    done++;
    ids.push(data?.[0]?.id ?? null);
  }

  const resultat = { done, failed, ids };
  // Trace d'événement : oid = cible.cle.objet_id — absent côté artiste, donc
  // logEvent (qui exige un oid) se tait tout seul. C'est l'asymétrie §3 du
  // brief, pas une correction : rien ici ne distingue « objet » d'« artiste ».
  if (done > 0 && opts.evenement) {
    d.logEvent(opts.evenement.action, {
      n: done, ...(failed.length ? { echecs: failed.length } : {}), ...(opts.evenement.detail ?? {}),
    }, cible.cle.objet_id);
  }
  // Purge de consigne : sans objet côté artiste (§3) — cible.table le filtre.
  // Garde d'identité : ne purge que si S.currentObjet EST bien cet objet-là
  // (une création en cours n'a pas encore S.currentObjet dessus).
  if (done > 0 && opts.purgerConsigne && cible.table === 'photos'
    && S.currentObjet && String(S.currentObjet.id) === String(cible.cle.objet_id)) {
    await d.purgeConsigne(S.currentObjet, cible.cle.objet_id);
  }
  return resultat;
}

// ─── supprimer() ─────────────────────────────────────────────────────────────
// Prolongement direct de deleteStoredPhoto(table, id, paths), déjà paramétré
// par table. @returns {Promise<boolean>} true si la ligne a bien été supprimée.
export async function supprimer(cible, photo) {
  const d = await deps();
  return d.deleteStoredPhoto(cible.table, photo.id, [photo.storage_path, photo.thumb_path]);
}

// ─── remplacer() — édition destructive (D-073/D-075) ────────────────────────
// Écrase la brute (storage_path, upsert), régénère les dérivées EXISTANTES
// pour la cible depuis `blob` — jamais en cascade d'une variante sur l'autre.
// `blob` est déjà le résultat du crop/rotation : c'est la vue qui dessine sur
// le canvas et encode (qualité laissée à son choix — 0.95 objet, 0.92 artiste
// aujourd'hui) ; le service ne sait rien de la géométrie, seulement du stockage.
// Bornes HO-089, portées telles quelles (edition-photo.js avant migration).
const MINI_PX = 160, THUMB_PX = 480, MOYEN_PX = 2048;

// @returns {Promise<{ok:boolean, error?:string, paths?:object}>}
export async function remplacer(cible, photo, blob) {
  const d = await deps();
  const { error: e1 } = await d.sb.storage.from('photos')
    .upload(photo.storage_path, blob, { contentType: 'image/jpeg', upsert: true });
  if (e1) return { ok: false, error: e1.message };

  // Nom neuf à chaque enregistrement pour les dérivées (cache CDN cassé
  // exprès) — la brute, elle, garde son chemin (upsert ci-dessus).
  const base = photo.storage_path.replace(/\.[^./]+$/, '').replace(/[^/]+$/, crypto.randomUUID());
  const patch = { rotation: 0 };
  if (cible.table === 'photos') patch.crop_path = null; // colonne absente côté artiste

  const bornes = cible.table === 'photos'
    ? [['mini_path', MINI_PX, 0.75], ['thumb_path', THUMB_PX, 0.8], ['moyen_path', MOYEN_PX, 0.85]]
    : [['thumb_path', THUMB_PX, 0.8]]; // artiste : ni mini_path ni moyen_path (HO-089)
  for (const [col, px, q] of bornes) {
    const vb = await d.makeVariantBlob(blob, px, q); // ← `blob`, TOUJOURS. Jamais la variante précédente.
    const p = vb && `${base}.${col.replace('_path', '')}.jpg`;
    patch[col] = p && !(await d.sb.storage.from('photos').upload(p, vb, { contentType: 'image/jpeg' })).error ? p : null;
  }
  const { error: e2 } = await d.sb.from(cible.table).update(patch).eq('owner_id', S.tenantId).eq('id', photo.id);
  if (e2) return { ok: false, error: e2.message };

  const anciennes = [photo.crop_path, photo.mini_path, photo.thumb_path, photo.moyen_path].filter(Boolean);
  if (anciennes.length) await d.sb.storage.from('photos').remove(anciennes);

  return { ok: true, paths: patch };
}

// ─── reordonner() ────────────────────────────────────────────────────────────
// `images` = liste triée courante, `ordre[i]` = nouvelle valeur d'ordre pour
// `images[i]`. Toutes les écritures sont tentées (pas d'arrêt à la 1re erreur,
// choix délibéré au moment de l'unification objet/artiste — les deux gestes
// d'origine divergeaient sur ce point) ; l'appelant décide quoi en faire.
// @returns {Promise<{updates:Array<{id,ordre}>, echecs:Array, ok:boolean}>}
export async function reordonner(cible, images, ordre) {
  const d = await deps();
  const updates = images.map((p, i) => ({ id: p.id, ordre: ordre[i] }));
  const resultats = await Promise.all(updates.map(u =>
    d.sb.from(cible.table).update({ ordre: u.ordre }).eq('owner_id', S.tenantId).eq('id', u.id)
  ));
  const echecs = resultats.filter(r => r.error).map(r => r.error);
  return { updates, echecs, ok: echecs.length === 0 };
}

// ─── taguer() ────────────────────────────────────────────────────────────────
// Taxonomie : `kind` côté objet, `zone` côté artiste (§3). Règle portée telle
// quelle depuis changerZone() : quitter la zone 'signature' efface l'objet_id
// source — asymétrie propre à l'artiste (le champ n'existe pas côté objet).
// @returns {Promise<boolean>}
export async function taguer(cible, photo, tag) {
  const d = await deps();
  const patch = cible.table === 'photos'
    ? { kind: tag }
    : { zone: tag, ...(tag !== 'signature' ? { objet_id: null } : {}) };
  const { error } = await d.sb.from(cible.table).update(patch).eq('owner_id', S.tenantId).eq('id', photo.id);
  return !error;
}

// ─── definirCouverture() ─────────────────────────────────────────────────────
// Couverture exclusive : absente côté artiste (§3, colonne inexistante) — no-op
// gardé explicite plutôt qu'un crash sur colonne manquante.
// @returns {Promise<boolean>}
export async function definirCouverture(cible, photo) {
  if (cible.table !== 'photos') return false;
  const d = await deps();
  const { error: e1 } = await d.sb.from('photos').update({ couverture: false })
    .eq('owner_id', S.tenantId).eq('objet_id', cible.cle.objet_id).neq('id', photo.id);
  if (e1) return false;
  const { error: e2 } = await d.sb.from('photos').update({ couverture: true })
    .eq('owner_id', S.tenantId).eq('id', photo.id);
  return !e2;
}
