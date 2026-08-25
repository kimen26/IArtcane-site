// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/data.js : client Supabase + accès données partagés (D-039)
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { toast } from './dom.js';
import { S, canWrite } from './state.js';
import { isVideo } from './format.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.IARTCANE_CONFIG;
// Options auth explicites (2026-08-25, retour Yann « magic link redemandé ») :
// session persistée en localStorage, rafraîchie automatiquement.
// ⚠️ flowType 'implicit' volontaire (D-037) : PKCE impose d'ouvrir le lien dans
// LE navigateur qui a fait la demande (le code_verifier y est stocké) — or Yann/
// Alain demandent sur un appareil et cliquent depuis une appli mail/autre
// navigateur/autre appareil → échec systématique. L'implicite (jetons en #hash)
// marche partout. ⚠️ ne PAS changer storageKey (déconnecterait tout le monde).
// Une session = un appareil × un navigateur (la PWA installée a son propre
// stockage) — normal de cliquer un lien par contexte, anormal de le refaire à
// chaque visite (→ dashboard : JWT expiry, projet free en pause après 7 j).
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Signe un lot de chemins du bucket privé 'photos' → { path: url }
export async function signPaths(paths) {
  if (!paths.length) return {};
  const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600);
  const out = {};
  for (const s of data ?? []) if (s?.signedUrl) out[s.path] = s.signedUrl;
  return out;
}

// Trace un événement du changelog objet (table `evenements`, D-025) — fire & forget.
// Garde lecteur : un lecteur ne grave rien (la RLS 0012 bloquerait de toute façon).
export function logEvent(action, detail = {}, oid = S.currentObjet?.id) {
  if (!oid || !S.tenantId || !canWrite()) return;
  sb.from('evenements').insert({
    owner_id: S.tenantId, objet_id: oid,
    acteur: localStorage.getItem('iartcane-qui') ?? 'site',
    action, detail,
  }).then(({ error }) => { if (error) console.warn('logEvent:', error.message); });
}

// ─── File d'analyse (règle métier, partagée fiche objet + écran Activité) ────
// Enfile un job par objet en évitant les doublons : on lit d'abord les jobs
// en_attente (index unique partiel jobs_un_en_attente_idx, migration 0011) et on
// n'insère que les manquants. Insert par lot ; si un 23505 survient quand même
// (course avec le cron), repli un par un en le tolérant. Les objets réellement
// enfilés passent au statut « en_file ».
// @returns {Promise<number>} nombre d'objets effectivement mis en file
export async function enqueueJobs(oids, type = 'analyse') {
  if (!oids.length) return 0;
  const { data: pending, error: e0 } = await sb.from('jobs').select('objet_id')
    .eq('owner_id', S.tenantId).eq('statut', 'en_attente');
  if (e0) { toast(e0.message, true); return 0; }
  const busy = new Set((pending ?? []).map(j => j.objet_id));
  const todo = oids.filter(id => !busy.has(id));
  if (!todo.length) return 0;
  let ok = todo;
  const { error } = await sb.from('jobs').insert(todo.map(objet_id => ({ owner_id: S.tenantId, objet_id, type })));
  if (error) {
    if (error.code !== '23505') { toast(error.message, true); return 0; }
    ok = [];
    for (const objet_id of todo) {
      const { error: e } = await sb.from('jobs').insert({ owner_id: S.tenantId, objet_id, type });
      if (!e) ok.push(objet_id);
      else if (e.code !== '23505') toast(e.message, true);
    }
  }
  if (ok.length) await sb.from('objets').update({ statut: 'en_file' }).eq('owner_id', S.tenantId).in('id', ok);
  return ok.length;
}

// Mise en file d'UN objet (relance depuis la fiche) — même règle de dédoublonnage.
export const queueAnalyse = (oid, type = 'analyse') => enqueueJobs([oid], type);

// Garantit le cache collection (comptages objets par artiste, mini-cartes du
// détail, digest Activité) sans ré-afficher la vue collection.
export async function ensureCollection() {
  if (S.collection.length) return;
  const { data } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).order('created_at', { ascending: false });
  S.collection = data ?? [];
}

// Remplit S.photoMap : objet_id → { url (miniature d'abord), fx, fy, vid }.
export async function loadPhotoMap() {
  S.photoMap = {};
  if (!S.collection.length) return;
  const { data } = await sb.from('photos').select('objet_id,storage_path,thumb_path,focal_x,focal_y,kind').eq('owner_id', S.tenantId).order('created_at');
  const first = {};
  for (const p of data ?? []) if (!first[p.objet_id]) first[p.objet_id] = p;
  const urlByPath = await signPaths(Object.values(first).flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean)));
  for (const [oid, p] of Object.entries(first)) {
    const url = urlByPath[p.thumb_path] ?? urlByPath[p.storage_path]; // miniature d'abord (vitesse)
    // vid : 1re « photo » = vidéo → badge ▶ sur la carte (même sans miniature)
    S.photoMap[oid] = { url: url ?? null, fx: p.focal_x, fy: p.focal_y, vid: isVideo(p) };
  }
}

// ─── Upload de photos (partagé capture + fiche objet + caméra) ───────────────
// Miniature JPEG ≤ 480 px générée à l'upload (listing + carrousel — vitesse, 2026-08-24).
// NULL si échec : l'affichage retombe sur l'image pleine.
export async function makeThumbBlob(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const M = 480;
    const s = Math.min(1, M / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
  } catch { return null; }
}

// Envoie UN fichier dans le bucket + sa miniature. Primitive partagée par les
// photos d'objet et les photos de fiche artiste (deux séquences identiques
// auparavant — factorisées 2026-08-25).
// @param dossier  préfixe de chemin dans le bucket (sans slash final)
// @returns { path, thumbPath, video } ou null si l'envoi du fichier a échoué
export async function uploadImageWithThumb(dossier, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const base = `${dossier}/${crypto.randomUUID()}`;
  const path = `${base}.${ext}`;
  const { error } = await sb.storage.from('photos').upload(path, file, { contentType: file.type || undefined });
  if (error) { toast(`Upload « ${file.name} » : ${error.message}`, true); return null; }

  const video = /^video\//.test(file.type);
  let thumbPath = null;
  if (!video) {
    const tb = await makeThumbBlob(file);
    if (tb) {
      thumbPath = `${base}.thumb.jpg`;
      // Miniature ratée = pas bloquant : l'affichage retombe sur l'image pleine.
      const { error: et } = await sb.storage.from('photos').upload(thumbPath, tb, { contentType: 'image/jpeg' });
      if (et) thumbPath = null;
    }
  }
  return { path, thumbPath, video };
}

export async function uploadPhotosFor(oid, files, firstIsFace = false) {
  let done = 0;
  let first = firstIsFace;
  for (const f of files) {
    const up = await uploadImageWithThumb(`${S.tenantId}/${oid}`, f);
    if (!up) continue;
    const kind = up.video ? 'video' : (first ? 'face' : 'autre');
    first = false;
    const { error } = await sb.from('photos').insert({
      owner_id: S.tenantId, objet_id: oid,
      storage_path: up.path, thumb_path: up.thumbPath, kind, source: 'site',
    });
    if (error) toast(error.message, true); else done++;
  }
  return done;
}

// Supprime une photo : ligne d'abord (la référence prime), puis les fichiers du
// bucket (policy storage delete : migration 0007). Partagé fiche objet / fiche
// artiste — seules la table et les chemins changent.
// @returns true si la ligne a bien été supprimée
export async function deleteStoredPhoto(table, id, paths) {
  const { error } = await sb.from(table).delete().eq('owner_id', S.tenantId).eq('id', id);
  if (error) { toast(error.message, true); return false; }
  await sb.storage.from('photos').remove(paths.filter(Boolean));
  return true;
}
