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

// Met l'objet en file d'analyse (statut + job). L'index unique partiel
// jobs_un_en_attente_idx (migration 0011) renvoie 23505 si un job est déjà en
// file pour cet objet — c'est le comportement voulu, on l'ignore.
export async function queueAnalyse(oid, type = 'analyse') {
  await sb.from('objets').update({ statut: 'en_file' }).eq('owner_id', S.tenantId).eq('id', oid);
  const { error } = await sb.from('jobs').insert({ owner_id: S.tenantId, objet_id: oid, type });
  if (error && error.code !== '23505') toast(error.message, true);
}

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

export async function uploadPhotosFor(oid, files, firstIsFace = false) {
  let done = 0;
  let first = firstIsFace;
  for (const f of files) {
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${S.tenantId}/${oid}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('photos').upload(path, f, { contentType: f.type || undefined });
    if (error) { toast(`Upload « ${f.name} » : ${error.message}`, true); continue; }
    const video = /^video\//.test(f.type);
    let thumbPath = null;
    if (!video) {
      const tb = await makeThumbBlob(f);
      if (tb) {
        thumbPath = path.replace(/\.[a-z0-9]+$/i, '') + '.thumb.jpg';
        const { error: et } = await sb.storage.from('photos').upload(thumbPath, tb, { contentType: 'image/jpeg' });
        if (et) thumbPath = null;
      }
    }
    const kind = video ? 'video' : (first ? 'face' : 'autre');
    first = false;
    const { error: e2 } = await sb.from('photos').insert({ owner_id: S.tenantId, objet_id: oid, storage_path: path, thumb_path: thumbPath, kind, source: 'site' });
    if (e2) toast(e2.message, true); else done++;
  }
  return done;
}
