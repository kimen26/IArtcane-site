// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/data.js : client Supabase + accès données partagés (D-039)
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { toast, enregistrer, humaniser } from './feedback.js';
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

// Signe un lot de chemins du bucket privé 'photos' → { path: url }.
// Mémo localStorage 24 h : re-signer à chaque écran changeait le token, donc
// l'URL, donc le navigateur retéléchargeait tout (egress ×50 — quota Free
// crevé le 2026-08-31). Une URL stable entre deux écrans ET deux visites
// laisse enfin le cache HTTP travailler. Marge d'1 h sur l'expiration.
const SURL_KEY = 'iartcane-surl-v1';
const SURL_TTL = 86400;            // durée de signature (s)
const SURL_MARGE = 3600e3;         // re-signe si moins d'1 h de vie restante (ms)
function surlLire() {
  try { return JSON.parse(localStorage.getItem(SURL_KEY)) ?? {}; } catch { return {}; }
}
// À appeler quand un fichier est ÉCRASÉ sous le même chemin (édition destructive,
// HO-095) : la prochaine signature produira une URL neuve → pas de cache périmé.
export function oublierSignatures(paths) {
  const memo = surlLire();
  for (const p of paths) delete memo[p];
  try { localStorage.setItem(SURL_KEY, JSON.stringify(memo)); } catch { /* au pire on garde le mémo */ }
}
export async function signPaths(paths) {
  if (!paths.length) return {};
  const memo = surlLire();
  const limite = Date.now() + SURL_MARGE;
  const out = {};
  const manquants = [];
  for (const p of new Set(paths)) {
    if (memo[p]?.exp > limite) out[p] = memo[p].url;
    else manquants.push(p);
  }
  if (manquants.length) {
    const { data } = await sb.storage.from('photos').createSignedUrls(manquants, SURL_TTL);
    const exp = Date.now() + SURL_TTL * 1000;
    for (const s of data ?? []) if (s?.signedUrl) { out[s.path] = s.signedUrl; memo[s.path] = { url: s.signedUrl, exp }; }
    for (const p of Object.keys(memo)) if (memo[p].exp <= limite) delete memo[p]; // purge des mortes
    try { localStorage.setItem(SURL_KEY, JSON.stringify(memo)); } catch { /* stockage bloqué : on re-signera */ }
  }
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

// ─── File de jobs (règle métier, partagée fiche objet + écran Activité) ────
// Enfile un job par objet en évitant les doublons : on lit d'abord les jobs
// en_attente (index unique partiel jobs_un_en_attente_idx, migration 0011) et on
// n'insère que les manquants. Insert par lot ; si un 23505 survient quand même
// (course avec le cron), repli un par un en le tolérant. Les statuts d'objets ne
// sont PLUS touchés ici (D-057 : les états transitoires se lisent dans `jobs`).
// @returns {Promise<number>} nombre d'objets effectivement mis en file
export async function enqueueJobs(oids, type = 'r2') {
  if (!oids.length) return 0;
  const { data: pending, error: e0 } = await sb.from('jobs').select('objet_id')
    .eq('owner_id', S.tenantId).eq('statut', 'en_attente');
  if (e0) { console.warn('enqueueJobs:', e0); toast(humaniser(e0), 'panne'); return 0; }
  const busy = new Set((pending ?? []).map(j => j.objet_id));
  const todo = oids.filter(id => !busy.has(id));
  if (!todo.length) return 0;
  let ok = todo;
  const { error } = await sb.from('jobs').insert(todo.map(objet_id => ({ owner_id: S.tenantId, objet_id, type })));
  if (error) {
    if (error.code !== '23505') { console.warn('enqueueJobs:', error); toast(humaniser(error), 'panne'); return 0; }
    ok = [];
    for (const objet_id of todo) {
      const { error: e } = await sb.from('jobs').insert({ owner_id: S.tenantId, objet_id, type });
      if (!e) ok.push(objet_id);
      else if (e.code !== '23505') { console.warn('enqueueJobs:', e); toast(humaniser(e), 'panne'); }
    }
  }
  return ok.length;
}

// Lancement manuel des recherches (D-057 — cœur du pipeline militaire) :
// UN appel à l'edge R1 (live, ~40 s, JWT utilisateur), qui enfile ensuite le
// job R2 (Lens, cron 2 min). Plus AUCUN recalcul automatique à l'ajout de
// photos : le recalcul est un acte humain (Enregistrer / « Relancer les
// recherches »). L'edge elle-même saute la R1 si aucune photo n'a changé.
//
// HO-110 : cette primitive SE TAIT à l'écran — seul l'appelant sait si
// l'échec est rattrapé (job `r1` enfilé) ou non, donc lequel des deux doit
// parler. `console.warn` reste ici : se taire à l'écran, pas dans les
// journaux ; `erreur` porte le message brut pour l'appelant (`console.warn`
// et `humaniser`).
// @returns {Promise<
//   { ok: true, [x: string]: any }                                | // succès (inchangé)
//   { ok: false, raison: 'session' }                               | // pas de jeton
//   { ok: false, raison: 'delai', timeout: true }                  | // plafond dépassé (AbortError)
//   { ok: false, raison: 'reseau', erreur: string }                | // fetch en échec
//   { ok: false, raison: 'service', http: number, erreur: string } | // réponse non OK de l'edge
//   { ok: false, raison: 'budget', etape: string }                   // l'edge a rendu la main (202, HO-126) — job r1 déjà enfilé par elle
// >}
// Plafond d'attente de la R1 live (A9, 2026-08-28 ; abaissé HO-127, 2026-08-31).
// Sans lui, un appel bloqué laissait l'utilisateur sur « Recherche R1 (Kimi)… »
// indéfiniment — perçu comme « ça n'ouvre jamais » (L-027). Doit rester SOUS le
// budget que l'edge se donne (110 s, HO-126) : c'est le site qui rend la main en
// premier, proprement, pas l'edge qui se fait tuer au mur des 150 s.
const R1_TIMEOUT_MS = 95000;

export async function lancerRecherches(oid, { force = false } = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.access_token) { console.warn('lancerRecherches: session expirée'); return { ok: false, raison: 'session' }; }
  let res;
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), R1_TIMEOUT_MS);
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/identify-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ owner_id: S.tenantId, objet_id: oid, force }),
      signal: ctrl.signal,
    });
  } catch (e) {
    // Abort = dépassement du plafond, pas une panne réseau : raison distincte
    // pour que l'appelant sache que la recherche continue en file.
    if (e?.name === 'AbortError') {
      console.warn('lancerRecherches: délai dépassé');
      return { ok: false, raison: 'delai', timeout: true };
    }
    console.warn('lancerRecherches: réseau', e);
    return { ok: false, raison: 'reseau', erreur: e.message ?? String(e) };
  } finally {
    clearTimeout(minuteur);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const erreur = body.error ?? `Recherches échouées (HTTP ${res.status})`;
    console.warn('lancerRecherches: service', res.status, erreur);
    return { ok: false, raison: 'service', http: res.status, erreur };
  }
  return { ok: true, ...body };
}

// Purge de la consigne « photos à refaire » dès que de nouvelles photos arrivent
// (HO-030) — déplacée depuis views/objet/index.js pour être partagée avec le flux
// caméra (photos.js:onCamClose).
export async function purgeConsigne(o, oid) {
  if (!o.consigne_humain) return;
  const avant = o.consigne_humain;
  const ok = await enregistrer(
    () => sb.from('objets').update({ consigne_humain: null }).eq('owner_id', S.tenantId).eq('id', oid),
    'Consigne photos',
    { silencieuxSiOk: true },
  );
  if (!ok) return;
  if (S.currentObjet?.id === oid) S.currentObjet.consigne_humain = null;
  logEvent('correction', { champ: 'consigne_humain', avant: avant.slice(0, 80), apres: null }, oid);
}

// Garantit le cache collection (comptages objets par artiste, mini-cartes du
// détail, digest Activité) sans ré-afficher la vue collection.
export async function ensureCollection() {
  if (S.collection.length) return;
  const { data } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).order('created_at', { ascending: false });
  S.collection = data ?? [];
}

// Remplit S.photoMap : objet_id → { url (miniature 480 d'abord — cartes en
// masonry, la 160 y serait floue), miniUrl (160, pour les futurs consommateurs
// de vignettes — rayons, similaires), vid }.
export async function loadPhotoMap() {
  S.photoMap = {};
  if (!S.collection.length) return;
  const { data } = await sb.from('photos').select('objet_id,storage_path,thumb_path,mini_path,kind,couverture').eq('owner_id', S.tenantId).order('couverture', { ascending: false }).order('created_at');
  const first = {};
  for (const p of data ?? []) if (!first[p.objet_id]) first[p.objet_id] = p;
  // On ne signe plus la brute : toutes les photos ont leurs variantes (backfill
  // HO-089) et servir 2 Mo là où 27 Ko suffisent a crevé le quota egress (2026-08-31).
  const urlByPath = await signPaths(Object.values(first).flatMap(p => [p.thumb_path, p.mini_path].filter(Boolean)));
  for (const [oid, p] of Object.entries(first)) {
    const url = urlByPath[p.thumb_path] ?? null; // 480 (masonry, vitesse)
    const miniUrl = urlByPath[p.mini_path] ?? url;
    // vid : 1re « photo » = vidéo → badge ▶ sur la carte (même sans miniature)
    S.photoMap[oid] = { url: url ?? null, miniUrl: miniUrl ?? null, vid: isVideo(p) };
  }
}

// ─── Upload de photos (partagé capture + fiche objet + caméra) ───────────────
// Échelle d'images à l'upload — D-081 (arbitrage Yann 2026-08-31) : l'image
// MAÎTRESSE est réencodée à 2048 px q0.85 dès l'envoi ; le fichier d'origine du
// téléphone (2 Mo et plus) ne touche jamais le bucket — « on est amateur,
// n'abusons pas à faire plus que les gros ». L'ex-variante `moyen` (2048)
// devient redondante et n'est plus produite (colonne conservée, NULL).
// mini/thumb se génèrent depuis l'ORIGINE, jamais en cascade (deux
// réencodages successifs dégradent — HO-089).
const MINI_PX = 160;           // vignettes de rayon, mini-cartes, objets similaires
const THUMB_PX = 480;          // collection, fiche produit, galerie, navigation photo
// Cache navigateur des images du bucket (Yann 2026-08-31). Défaut Supabase = 1 h :
// l'URL signée restait stable 24 h mais le navigateur retéléchargeait le fichier
// toutes les heures, d'où un `cached egress` ridicule (0,64 Go) face à l'uncached.
// Une semaine : une photo est immuable sous son chemin, sauf édition destructive
// (D-081) — et celle-ci appelle `oublierSignatures()`, qui produit une URL neuve.
export const CACHE_IMAGES = '604800'; // 7 j, en secondes (option `cacheControl`)
export const MAITRE_PX = 2048; // image maîtresse : grande zone, atelier, envoi LLM
export const MAITRE_Q = 0.85;

// Génère une variante JPEG bornée à `maxPx` sur son plus grand côté.
// Ne grossit jamais une image plus petite que la borne (s = min(1, …)).
// NULL si échec : l'affichage se replie sur la variante supérieure.
export async function makeVariantBlob(blob, maxPx, qualite) {
  try {
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', qualite));
  } catch { return null; }
}

// Miniature JPEG ≤ 480 px (listing + carrousel — vitesse, 2026-08-24).
// Conservée telle quelle : 4 appelants externes en dépendent (dont
// views/artiste/images.js et views/objet/photos.js).
export async function makeThumbBlob(blob) {
  return makeVariantBlob(blob, THUMB_PX, 0.8);
}

// Envoie UN fichier dans le bucket (image maîtresse 2048, D-081) + ses
// variantes mini/thumb. Primitive partagée par les photos d'objet et les photos
// de fiche artiste (deux séquences identiques auparavant — factorisées 2026-08-25).
// @param dossier  préfixe de chemin dans le bucket (sans slash final)
// @returns { path, thumbPath, miniPath, moyenPath: null, video } ou null si
//          l'envoi de la maîtresse a échoué (moyenPath gardé pour les appelants)
export async function uploadImageWithThumb(dossier, file) {
  const video = /^video\//.test(file.type);
  const base = `${dossier}/${crypto.randomUUID()}`;
  // Image : maîtresse 2048 q0.85. Repli sur l'origine si le décodage échoue
  // (format exotique) — perdre du poids vaut mieux que perdre la photo.
  const maitre = video ? null : await makeVariantBlob(file, MAITRE_PX, MAITRE_Q);
  const ext = maitre ? 'jpg' : ((file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg');
  const path = `${base}.${ext}`;
  const { error } = await sb.storage.from('photos').upload(path, maitre ?? file, { contentType: maitre ? 'image/jpeg' : (file.type || undefined), cacheControl: CACHE_IMAGES });
  if (error) { console.warn('uploadImageWithThumb:', error); toast(`Photo « ${file.name} » non envoyée — ${humaniser(error)}.`, 'action'); return null; }

  let thumbPath = null, miniPath = null;
  if (!video) {
    // Chaque variante se génère depuis `file` d'origine (jamais en cascade) ;
    // échec d'une variante = non bloquant, le chemin reste NULL.
    const [mb, tb] = await Promise.all([
      makeVariantBlob(file, MINI_PX, 0.75),
      makeVariantBlob(file, THUMB_PX, 0.8),
    ]);
    if (mb) {
      const p = `${base}.mini.jpg`;
      const { error: e } = await sb.storage.from('photos').upload(p, mb, { contentType: 'image/jpeg', cacheControl: CACHE_IMAGES });
      if (!e) miniPath = p;
    }
    if (tb) {
      const p = `${base}.thumb.jpg`;
      const { error: e } = await sb.storage.from('photos').upload(p, tb, { contentType: 'image/jpeg', cacheControl: CACHE_IMAGES });
      if (!e) thumbPath = p;
    }
  }
  return { path, thumbPath, miniPath, moyenPath: null, video };
}

// Accepte un tableau de File purs (rétro-compat caméra / fiche objet)
// ou de { file, comment } (capture enrichie HO-013).
// @param onProgress(sent, total)  appelé avant chaque upload (sent = déjà terminés) ;
//                                 s'il rend false, la boucle s'arrête avant le fichier
//                                 suivant (annulation douce — l'envoi en cours aboutit)
// @returns { done, failed }        done = photos insérées ; failed = [{ item, reason }]
export async function uploadPhotosFor(oid, files, firstIsFace = false, onProgress = null) {
  const valid = files.map(item => {
    const f = item instanceof File ? item : item?.file;
    return { item, f, comment: item instanceof File ? null : item?.comment ?? null };
  }).filter(({ f }) => f);
  const total = valid.length;
  let done = 0;
  const failed = [];
  let first = firstIsFace;
  for (let i = 0; i < valid.length; i++) {
    const { item, f, comment } = valid[i];
    if (onProgress && onProgress(done + failed.length, total) === false) break;
    const up = await uploadImageWithThumb(`${S.tenantId}/${oid}`, f);
    if (!up) {
      failed.push({ item, reason: 'envoi du fichier impossible (réseau ?)' });
      continue;
    }
    const kind = item.kind ?? (up.video ? 'video' : (first ? 'face' : 'autre'));
    const couverture = item.cover === true ? true : false;
    const ordre = item.ordre ?? i + 1;
    first = false;
    const insertPayload = {
      owner_id: S.tenantId, objet_id: oid,
      storage_path: up.path, thumb_path: up.thumbPath,
      mini_path: up.miniPath, moyen_path: up.moyenPath,
      kind, source: 'site',
      commentaire: comment,
      ordre,
    };
    if (couverture) insertPayload.couverture = true;
    const { error } = await sb.from('photos').insert(insertPayload);
    if (error) {
      console.warn('uploadPhotosFor:', error); toast(`Photo « ${f.name} » non envoyée — ${humaniser(error)}.`, 'action');
      failed.push({ item, reason: error.message });
    } else {
      done++;
    }
  }
  return { done, failed };
}

// Supprime une photo : ligne d'abord (la référence prime), puis les fichiers du
// bucket (policy storage delete : migration 0007). Partagé fiche objet / fiche
// artiste — seules la table et les chemins changent.
// @returns true si la ligne a bien été supprimée
export async function deleteStoredPhoto(table, id, paths) {
  // `.select()` force PostgREST à renvoyer les lignes RÉELLEMENT supprimées.
  // Sans lui, un DELETE que la RLS bloque rend `error: null` et 0 ligne : le
  // code concluait « supprimée », l'écran se rerendait sans la vignette, et la
  // ligne restait en base. Panne muette constatée en prod (Yann, 2026-08-28).
  const { data, error } = await sb.from(table).delete().eq('owner_id', S.tenantId).eq('id', id).select('id');
  if (error) { console.warn('deleteStoredPhoto:', error); toast(`Photo non supprimée — ${humaniser(error)}.`, 'panne'); return false; }
  if (!data?.length) { toast('Photo non supprimée — droits insuffisants ou déjà supprimée. Recharge la page.', true); return false; }
  await sb.storage.from('photos').remove(paths.filter(Boolean));
  return true;
}
