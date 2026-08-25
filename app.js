// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — app.js (site statique, vanilla JS, aucun build)
// Branché sur Supabase : auth magic link, objets/photos/fiches/comparables/jobs.
// Règle d'or affichée : jamais un chiffre sans comparables vendus.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

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
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'implicit',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ─── Service worker (D-013) : shell offline + réception « Partager avec » ───
// http(s) uniquement (pas de SW en file://) ; échec silencieux — l'app marche sans.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ─── Petits utilitaires ─────────────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Taxonomie canonique v1 (Q15) — la même liste est imposée aux prompts IA
// (Edge Function identify-photo + runbook cron). catCanon() rabat les variantes
// du LLM (« ceramiques », « Céramique »…) sur la forme canonique d'affichage.
const CATS_CANON = {
  tableau: 'Tableau', peinture: 'Tableau', gravure: 'Gravure / estampe', estampe: 'Gravure / estampe',
  dessin: 'Dessin', photographie: 'Photographie', photo: 'Photographie', sculpture: 'Sculpture',
  ceramique: 'Céramique', verrerie: 'Verrerie', verre: 'Verrerie', mobilier: 'Mobilier',
  montre: 'Montre / horlogerie', horlogerie: 'Montre / horlogerie', bijou: 'Bijou',
  argenterie: 'Argenterie / métal', metal: 'Argenterie / métal', luminaire: 'Luminaire',
  textile: 'Textile / tapisserie', tapisserie: 'Textile / tapisserie', livre: 'Livre / document',
  monnaie: 'Monnaie / médaille', medaille: 'Monnaie / médaille', instrument: 'Instrument',
  jouet: 'Jouet', curiosite: 'Curiosité', 'art asiatique': 'Art asiatique', 'art tribal': 'Art tribal', autre: 'Autre',
};
function catCanon(c) {
  const k = norm(c).trim().replace(/s$/, '');
  if (!k) return c;
  return CATS_CANON[k] ?? (String(c).trim().charAt(0).toUpperCase() + String(c).trim().slice(1));
}

// Rattachement objet ↔ fiche artiste : l'auteur saisi par l'IA n'est presque
// jamais le nom canonique exact (« Atelier Roger Capron (signé) », « attribué
// à Alain Maunier », « Signé « DODIK » (…) ») — on matche (normalisé, sans
// accents) sur le nom complet OU sur le nom de cœur (avant parenthèses).
const auteurMatch = (auteur, nom) => {
  if (!auteur || !nom) return false;
  const a = norm(auteur), n = norm(nom);
  if (a === n || a.includes(n)) return true;
  const core = n.split(/[("«]/)[0].trim();
  return core.length >= 5 && a.includes(core);
};
const fmtNum = n => Number(n).toLocaleString('fr-FR');
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
const plur = (n, s, p) => `${n} ${n > 1 ? p : s}`;
const pinSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';
const infoSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>';

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

const STATUTS = {
  capture: 'Capturé', en_file: 'En file', analyse: 'Analyse…', fiche_prete: 'Fiche prête',
  a_completer: 'À compléter', validee: 'Validée', contestee: 'Contestée',
};
const ST_COLOR = {
  capture: '#9A6B1A', en_file: '#2456E0', analyse: '#2456E0', fiche_prete: '#6D4AC8',
  a_completer: '#9A6B1A', validee: '#1E7A46', contestee: '#B3261E',
};
// Confiance comptée 0–4 : 4/4 = validée par un humain (ground truth), sinon 1-3 selon l'IA.
const confMarks = o => o.statut === 'validee' ? 4 : ({ haute: 3, moyenne: 2, basse: 1 }[o.confiance] ?? 0);
const confHtml = n => `<span class="conf">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}<span class="conf-label">${n}/4</span></span>`;

function catEmoji(cat) {
  const c = norm(cat);
  if (/peint|tableau|huile|aquarel/.test(c)) return '🖼️';
  if (/montre|horlog|gousset/.test(c)) return '⌚';
  if (/ceram|porcel|faience|vase|terre cuite/.test(c)) return '🏺';
  if (/bijou|bague|broche|collier|bracelet/.test(c)) return '💍';
  if (/grav|estamp|litho|dessin|encre/.test(c)) return '📜';
  if (/meuble|mobilier/.test(c)) return '🪑';
  if (/livre|manuscrit/.test(c)) return '📖';
  if (/verre|verrerie|cristal/.test(c)) return '🥃';
  return '🏺';
}
const prixHtml = o => (o.prix_bas != null && o.prix_haut != null)
  ? `<span class="price">${fmtNum(o.prix_bas)}–${fmtNum(o.prix_haut)} €</span>`
  : '<span class="price none">à estimer</span>';
const emptyHtml = (t, s, action = '') => `<div class="empty"><div class="big">🗃️</div><h2>${esc(t)}</h2><p>${esc(s)}</p>${action}</div>`;
const isVideo = p => p.kind === 'video' || /\.(mp4|mov|webm)$/i.test(p.storage_path || '');

// ─── État ───────────────────────────────────────────────────────────────────
let user = null;
let tenantId = null;          // locataire courant : soi-même, ou l'owner dont on est membre (D-015)
let tenantName = '';          // nom de la « maison » (D-016) — ex. PONAIRE
let mesTenants = [];          // [{ id, name, role }] — sa maison d'abord (role 'owner'), puis ses memberships
let tenantRole = 'owner';     // rôle dans le locataire courant : 'owner' | 'admin' | 'lecteur'
// Un lecteur voit tout le catalogue mais ne peut rien modifier (RLS 0012 + UI masquée).
const canWrite = () => tenantRole !== 'lecteur';
let collection = [];           // cache des objets (rechargé à chaque visite collection)
let photoMap = {};             // objet_id → URL signée de la 1re photo
// cats = chips catégories multi-cochées ; prixMin/prixMax = bornes du filtre prix (null = non renseigné)
const filters = { q: '', cats: [], group: 'categorie', list: '', prixMin: null, prixMax: null };
let currentObjet = null, currentComps = [], currentFiche = null, currentPhotos = [], currentEvents = [], currentArtiste = null, currentArtistePhotos = [], currentArtisteNom = null;

// Trace un événement du changelog objet (table `evenements`, D-025) — fire & forget.
// Garde lecteur : un lecteur ne grave rien (la RLS 0012 bloquerait de toute façon).
function logEvent(action, detail = {}, oid = currentObjet?.id) {
  if (!oid || !tenantId || !canWrite()) return;
  sb.from('evenements').insert({
    owner_id: tenantId, objet_id: oid,
    acteur: localStorage.getItem('iartcane-qui') ?? 'site',
    action, detail,
  }).then(({ error }) => { if (error) console.warn('logEvent:', error.message); });
}

// Libellés des actions tracées dans `evenements` (site + cron) — partagés entre
// l'historique de la fiche objet et l'écran Activité.
const ACT_LABELS = {
  capture: 'Objet capturé', photo_ajoutee: 'Photo ajoutée', photo_supprimee: 'Photo supprimée',
  recadrage: 'Recadrage', centrage: 'Centrage', localisation: 'Localisation',
  correction: 'Correction', validation: 'Fiche validée', relance: 'Estimation relancée',
  identification: 'Identification IA', passe_marche: 'Recherche de comparables',
  lens: 'Google Lens (signature)', artiste_maj: 'Fiche artiste', photos_manquantes: 'Photos recommandées',
  artiste_photo_ajoutee: 'Photo artiste ajoutée', artiste_photo_supprimee: 'Photo artiste supprimée',
  comparable_supprime: 'Comparable retiré',
};
// Détail utile d'un événement (modèle, prompt, comparables, sources, champs
// avant→après, note) — rendu HTML échappé, partagé fiche objet + Activité.
function evDetailBits(d = {}) {
  const bits = [];
  if (d.modele) bits.push(esc(d.modele));
  if (d.prompt_version) bits.push('prompt ' + esc(d.prompt_version));
  if (d.n != null) bits.push(d.n + ' photo' + (d.n > 1 ? 's' : ''));
  if (d.comps != null) bits.push(d.comps + ' comparable' + (d.comps > 1 ? 's' : ''));
  if (Array.isArray(d.sources) && d.sources.length) bits.push(esc(d.sources.join(', ')));
  if (d.champs && typeof d.champs === 'object') {
    bits.push(Object.entries(d.champs).map(([c, v]) =>
      `${esc(c)} : « ${esc(v?.avant ?? '—')} » → « ${esc(v?.apres ?? '—')} »`).join(' · '));
  }
  if (d.note) bits.push(esc(d.note));
  return bits;
}
let editing = false;
let capFiles = [];

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════
sb.auth.onAuthStateChange((event, session) => {
  user = session?.user ?? null;
  // Ne rejouer enterApp() qu'à la connexion — TOKEN_REFRESHED (~1×/h) ne doit pas
  // recharger toute la vue (audit 2026-08-24).
  if (user) { if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') enterApp(); }
  else showLogin();
});

function show(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  window.scrollTo({ top: 0 });
}
function showLogin() {
  $('#tabs').classList.add('hidden');
  $('#menu-gov').classList.add('hidden');
  $('#header-counter').textContent = '';
  document.body.classList.remove('role-lecteur');
  // Réarmer le realtime : à la prochaine connexion (autre tenant possible),
  // watchLive() doit recréer le canal avec le bon filtre owner_id.
  if (liveOn) { sb.removeAllChannels(); liveOn = false; }
  show('login');
}
async function enterApp() {
  $('#tabs').classList.remove('hidden');
  $('#menu-gov').classList.remove('hidden');
  await resolveTenant();
  renderMenu();
  await Promise.all([loadHeader(), loadProfile()]);
  watchLive();
  route();
}

// ─── Realtime (G-3, D-019) : la passe 0 et les fiches arrivent en direct ────
// Un UPDATE objets du locataire → toast + rafraîchissement de la vue courante.
// replica identity full (migration 0005) → payload.old permet de ne notifier
// que les vraies nouveautés (identification qui apparaît, fiche qui devient prête).
let liveOn = false;
function watchLive() {
  if (liveOn || !tenantId) return;
  liveOn = true;
  sb.channel('objets-live')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'objets', filter: `owner_id=eq.${tenantId}` }, p => {
      const n = p.new, old = p.old ?? {};
      // JAMAIS de rechargement automatique de la vue (règle Yann 2026-08-23 :
      // refresh sur action ou manuel uniquement) — on notifie, point.
      if (!old.categorie && n.categorie) {
        toast(`🔎 #${n.id} identifié par l'IA : « ${n.titre ?? n.categorie} » (passe 0 — recharge pour voir)`);
      } else if (old.statut !== 'fiche_prete' && n.statut === 'fiche_prete') {
        toast(`✨ #${n.id} : fiche IA prête — recharge la page pour la voir`);
      }
    })
    .subscribe();
}

// Locataire courant : si l'utilisateur est membre d'une collection (magasin),
// il peut la voir et l'alimenter — le même catalogue pour tous les admins (D-015).
// Multi-locataires (0012) : TOUTES les memberships sont lues → switcher « Maison »
// dans le menu ; le choix est persisté (localStorage). Le rôle courant pilote
// l'UI : un 'lecteur' passe en lecture seule (canWrite()).
async function resolveTenant() {
  const { data: membres } = await sb.from('collection_members').select('owner_id,role').eq('member_id', user.id);
  const ids = [user.id, ...(membres ?? []).map(m => m.owner_id)];
  const { data: noms } = await sb.from('tenants').select('owner_id,name').in('owner_id', ids);
  const nomDe = id => (noms ?? []).find(t => t.owner_id === id)?.name ?? '';
  mesTenants = [
    { id: user.id, name: nomDe(user.id), role: 'owner' },
    ...(membres ?? []).map(m => ({ id: m.owner_id, name: nomDe(m.owner_id), role: m.role })),
  ];
  // Choix persisté si encore valide, sinon la 1re membership (comportement D-015 :
  // un membre/lecteur tombe sur la maison partagée, pas sur sa collection vide),
  // sinon sa propre maison.
  const pref = localStorage.getItem('iartcane-tenant');
  const courant = mesTenants.find(t => t.id === pref)
    ?? mesTenants.find(t => t.role !== 'owner')
    ?? mesTenants[0];
  tenantId = courant.id;
  tenantRole = courant.role;
  tenantName = courant.name;
  applyRole();
}

// Bascule sur une autre maison (switcher du menu) : persiste le choix et
// recharge l'en-tête + la collection.
function selectTenant(id) {
  const t = mesTenants.find(x => x.id === id);
  if (!t || t.id === tenantId) return;
  localStorage.setItem('iartcane-tenant', t.id);
  tenantId = t.id;
  tenantRole = t.role;
  tenantName = t.name;
  applyRole();
  renderMenu();
  loadHeader();
  const h = location.hash;
  location.hash = '#/';
  if (h === '#/' || h === '') route(); // sinon le hashchange déclenche route()
}

// Reflète le rôle courant dans le DOM : en lecture seule, tout ce qui porte la
// classe .hide-lecteur est masqué (CSS) et les handlers mutants sont gardés.
function applyRole() {
  document.body.classList.toggle('role-lecteur', !canWrite());
}

// Email mémorisé d'un envoi à l'autre (le login revient souvent par paire
// appareil/navigateur — autant éviter de le retaper à chaque fois).
$('#login-email').value = localStorage.getItem('iartcane-login-email') ?? '';

$('#login-btn').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  if (!email) { $('#login-email').focus(); return; }
  const btn = $('#login-btn');
  btn.disabled = true;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  btn.disabled = false;
  if (error) {
    $('#login-msg').innerHTML = `<div class="login-err">Erreur : ${esc(error.message)}</div>`;
  } else {
    localStorage.setItem('iartcane-login-email', email);
    $('#login-msg').innerHTML = `<div class="login-ok">✓ Lien envoyé à <b>${esc(email)}</b> — vérifie ta boîte (et les spams).</div>
      <div class="login-note">💡 Ouvre le lien <b>sur cet appareil, dans ce navigateur</b> : la connexion est mémorisée par appareil. Si tu utilises l'appli installée sur l'écran d'accueil, elle a sa propre connexion — un lien à cliquer une fois de chaque côté.</div>`;
  }
});
$('#login-email').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-btn').click(); });

// Profil : le nom vit dans le panneau du menu (en-tête épuré — plus d'avatar).
let profileName = '';
async function loadProfile() {
  const { data } = await sb.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  profileName = data?.display_name || user.email || '?';
  renderMenu();
}

async function loadHeader() {
  const [{ count }, { data: next }] = await Promise.all([
    sb.from('objets').select('*', { count: 'exact', head: true }).eq('owner_id', tenantId),
    sb.rpc('peek_objet_id', { p_owner: tenantId }),
  ]);
  const n = count ?? 0;
  const label = tenantName ? `${esc(tenantName)} · ` : (tenantId !== user.id ? 'catalogue partagé · ' : '');
  const badgeRO = canWrite() ? '' : '<span class="badge-ro">lecture seule</span>';
  $('#header-counter').innerHTML = `${label}<b>${fmtNum(n)}</b> objet${n > 1 ? 's' : ''} · prochain n° <b>${next ?? '—'}</b> ${badgeRO}`;
  $('#tab-count').textContent = n;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTEUR (hash)
// ═══════════════════════════════════════════════════════════════════════════
function setTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
}

// ─── Menu « gouvernance » de l'en-tête (D-028) ──────────────────────────────
// Zones transverses de l'app. Ajouter une entrée = une ligne ici + une route
// dans route() + une <section class="view"> dans index.html.
// `owner: true` → entrée réservée aux admins (owner + membre admin).
const MENU_GOUV = [
  { hash: '#/maison',     icone: '🏠', label: 'Maison',                desc: 'Membres, rôles, nom de la maison', owner: true },
  { hash: '#/activite',   icone: '📋', label: 'Activité',              desc: 'Quoi de neuf : runs IA, mises à jour, actions — et MAJ forcées du catalogue' },
  { hash: '#/artistes',   icone: '🎨', label: 'Artistes',              desc: 'Fiches artistes créées par le cron lors des passes d\'identification' },
  { hash: '#/sources',    icone: '🔭', label: 'Sources',               desc: 'Référentiels, comparables & corpus — cartographie des accès (D-028)' },
  { hash: '#/categories', icone: '🗂️', label: 'Catégories & familles', desc: 'Taxonomie canonique et prompts d\'identification par famille' },
];
const closeMenu = () => {
  $('#menu-panel').classList.add('hidden');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
};
// Rendu dépendant du contexte : bloc profil (nom + email + déconnexion) en
// tête, switcher multi-locataires (si > 1 maison), entrées filtrées selon le
// rôle (Maison = owner + admin).
function renderMenu() {
  const items = MENU_GOUV.filter(e => !e.owner || canWrite());
  const profil = `
    <div class="menu-user">
      <span class="menu-user-name">${esc(profileName || '…')}</span>
      ${user?.email && user.email !== profileName ? `<span class="menu-user-mail">${esc(user.email)}</span>` : ''}
    </div>
    <button class="menu-item" data-action="logout"><span class="menu-ico">⎋</span><span><span class="menu-label">Se déconnecter</span><span class="menu-desc">La collection reste synchronisée — reconnexion par lien magique</span></span></button>
    <div class="menu-sep"></div>`;
  const switcher = mesTenants.length > 1 ? `
    <div class="menu-sec">Maison</div>
    ${mesTenants.map(t => `<button class="menu-item menu-tenant ${t.id === tenantId ? 'current' : ''}" data-tenant="${esc(t.id)}">
      <span class="menu-ico">${t.id === tenantId ? '✓' : ''}</span>
      <span><span class="menu-label">${esc(t.name || 'Ma collection')}</span><span class="menu-desc">${esc(t.role)}</span></span>
    </button>`).join('')}
    <div class="menu-sep"></div>` : '';
  $('#menu-panel').innerHTML = profil + switcher + items.map(e =>
    `<button class="menu-item" data-hash="${esc(e.hash)}"><span class="menu-ico">${e.icone}</span><span><span class="menu-label">${esc(e.label)}</span><span class="menu-desc">${esc(e.desc)}</span></span></button>`
  ).join('');
}
$('#menu-btn').addEventListener('click', e => {
  e.stopPropagation();
  const opened = !$('#menu-panel').classList.toggle('hidden');
  $('#menu-btn').setAttribute('aria-expanded', String(opened));
});
$('#menu-panel').addEventListener('click', async e => {
  const out = e.target.closest('[data-action="logout"]');
  if (out) { closeMenu(); await sb.auth.signOut(); location.hash = ''; return; }
  const t = e.target.closest('[data-tenant]');
  if (t) { closeMenu(); selectTenant(t.dataset.tenant); return; }
  const b = e.target.closest('[data-hash]');
  if (b) { closeMenu(); location.hash = b.dataset.hash; }
});
document.addEventListener('click', e => { if (!$('#menu-gov').contains(e.target)) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

function route() {
  if (!user || !tenantId) return; // !tenantId : arrivée magic link — le hashchange de nettoyage
  // de l'URL d'auth tire route() pendant resolveTenant() → requêtes avec owner_id null (22P02)
  closeMenu();
  const h = location.hash || '#/';
  const mObj = h.match(/^#\/objet\/([^/]+)$/);
  const mArt = h.match(/^#\/artiste\/([^/]+)$/);
  if (h.startsWith('#/capture')) {
    if (!canWrite()) { location.replace('#/'); return; } // lecteur : pas de capture (RLS 0012)
    setTab('capture'); show('capture'); initCapture(); if (consumeShareFlag()) receiveSharedPhotos();
  }
  else if (mObj) { setTab('collection'); show('objet'); loadObjet(decodeURIComponent(mObj[1])); }
  // Écrans gouvernance : pas des onglets → aucun tab actif (setTab(null))
  else if (h.startsWith('#/maison')) {
    if (!canWrite()) { location.replace('#/'); return; } // owner + admin
    setTab(null); show('maison'); loadMaison();
  }
  else if (h.startsWith('#/activite')) { setTab(null); show('activite'); loadActivite(); }
  else if (mArt) { setTab(null); show('artiste'); loadArtiste(decodeURIComponent(mArt[1])); }
  else if (h.startsWith('#/artistes')) { setTab(null); show('artistes'); loadArtistes(); }
  else if (h.startsWith('#/sources')) { setTab(null); show('sources'); loadSources(); }
  else if (h.startsWith('#/categories')) { setTab(null); show('categories'); loadCategories(); }
  else { setTab('collection'); show('collection'); loadCollection(); }
}
window.addEventListener('hashchange', route);
// data-view → hash : ajouter un onglet = une entrée ici + la route ci-dessus.
const TAB_HASH = { collection: '#/', capture: '#/capture' };
$$('.tab').forEach(t => t.addEventListener('click', () => { location.hash = TAB_HASH[t.dataset.view] ?? '#/'; }));
$('#logo-home').addEventListener('click', () => { location.hash = '#/'; });
$('#obj-back').addEventListener('click', () => { location.hash = '#/'; });
$$('.js-back').forEach(b => b.addEventListener('click', () => { location.hash = '#/'; }));

// ═══════════════════════════════════════════════════════════════════════════
// VUE COLLECTION
// ═══════════════════════════════════════════════════════════════════════════
async function loadCollection() {
  const body = $('#collection-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const { data, error } = await sb.from('objets').select('*').eq('owner_id', tenantId).order('created_at', { ascending: false });
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  collection = data ?? [];
  await loadPhotoMap();
  renderChips();
  renderLists();
  renderGrid();
}

async function loadPhotoMap() {
  photoMap = {};
  if (!collection.length) return;
  const { data } = await sb.from('photos').select('objet_id,storage_path,thumb_path,focal_x,focal_y,kind').eq('owner_id', tenantId).order('created_at');
  const first = {};
  for (const p of data ?? []) if (!first[p.objet_id]) first[p.objet_id] = p;
  const urlByPath = await signPaths(Object.values(first).flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean)));
  for (const [oid, p] of Object.entries(first)) {
    const url = urlByPath[p.thumb_path] ?? urlByPath[p.storage_path]; // miniature d'abord (vitesse)
    // vid : 1re « photo » = vidéo → badge ▶ sur la carte (même sans miniature)
    photoMap[oid] = { url: url ?? null, fx: p.focal_x, fy: p.focal_y, vid: isVideo(p) };
  }
}

// Signe un lot de chemins du bucket privé 'photos' → { path: url }
async function signPaths(paths) {
  if (!paths.length) return {};
  const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600);
  const out = {};
  for (const s of data ?? []) if (s?.signedUrl) out[s.path] = s.signedUrl;
  return out;
}

// Prédicat de filtrage pur — utilisé par objMatches (filtre courant) et par
// renderLists (compteurs des listes sauvegardées, filtres « virtuels »).
function matchFiltre(o, f) {
  if (f.list === 'a_localiser' && o.zone && o.zone.trim()) return false;
  if (f.list === 'a_valider' && o.statut !== 'fiche_prete') return false;
  if (f.list === 'chere' && !(o.prix_haut >= 1000)) return false;
  if (f.cats?.length && !f.cats.includes(catCanon(o.categorie))) return false;
  if (f.q) {
    const hay = norm([o.id, o.titre, o.description, o.categorie, o.auteur, o.periode, o.ecole,
      o.technique, o.zone, o.contenant, o.position, o.marques].filter(Boolean).join(' '));
    if (!f.q.split(/\s+/).filter(Boolean).every(tok => hay.includes(tok))) return false;
  }
  // Fourchette prix : on garde l'objet si [prix_bas, prix_haut] intersecte
  // [min, max] ; un objet sans prix sort dès qu'une borne est renseignée.
  if (f.prixMin != null || f.prixMax != null) {
    if (o.prix_bas == null || o.prix_haut == null) return false;
    if (o.prix_haut < (f.prixMin ?? -Infinity) || o.prix_bas > (f.prixMax ?? Infinity)) return false;
  }
  return true;
}
const objMatches = o => matchFiltre(o, filters);

// Chips catégories multi-cochables (« Tous » = aucune cochée) — une liste
// sauvegardée peut viser plusieurs catégories canoniques à la fois.
function renderChips() {
  const cats = [...new Set(collection.map(o => catCanon(o.categorie)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  $('#chips').innerHTML = [`<button class="chip ${filters.cats.length === 0 ? 'active' : ''}" data-chip="">Tous</button>`]
    .concat(cats.map(c => `<button class="chip ${filters.cats.includes(c) ? 'active' : ''}" data-chip="${esc(c)}">${esc(c)}</button>`))
    .join('');
  $$('#chips .chip').forEach(ch => ch.addEventListener('click', () => {
    const c = ch.dataset.chip;
    if (c === '') filters.cats = [];
    else {
      const i = filters.cats.indexOf(c);
      if (i >= 0) filters.cats.splice(i, 1); else filters.cats.push(c);
    }
    renderChips(); renderLists(); renderGrid();
  }));
}

// ─── Listes sauvegardées (filtres nommés, localStorage par locataire) ───────
// Une liste = { id, nom, q, cats, prixMin, prixMax } — persistance locale
// (iartcane-listes-<tenantId>) : le switcher multi-maisons isole les listes.
const listesKey = () => `iartcane-listes-${tenantId}`;
function loadListes() {
  try { return JSON.parse(localStorage.getItem(listesKey())) ?? []; }
  catch { return []; }
}
const saveListes = ls => localStorage.setItem(listesKey(), JSON.stringify(ls));

// Filtre « libre » actif (hors raccourcis codés en dur) = quelque chose à sauvegarder.
const filtreActif = () => !!(filters.q || filters.cats.length || filters.prixMin != null || filters.prixMax != null);

// La liste sauvegardée active = celle dont le filtre coïncide exactement avec
// l'état courant (toute retouche du filtre après application la désactive).
function listeActive() {
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  return loadListes().find(l =>
    norm(l.q || '') === filters.q &&
    same(l.cats ?? [], filters.cats) &&
    (l.prixMin ?? null) === filters.prixMin &&
    (l.prixMax ?? null) === filters.prixMax) ?? null;
}

function syncPrixInputs() {
  $('#prix-min').value = filters.prixMin ?? '';
  $('#prix-max').value = filters.prixMax ?? '';
}

// Applique une liste sauvegardée : recherche + chips catégories + fourchette prix.
function applyListe(l) {
  $('#search').value = l.q ?? '';
  filters.q = norm(l.q ?? '');
  if (l.q) toolbarEl().classList.add('search-open'); // recherche active → barre dépliée (sinon filtre invisible)
  filters.cats = [...(l.cats ?? [])];
  filters.prixMin = l.prixMin ?? null;
  filters.prixMax = l.prixMax ?? null;
  syncPrixInputs();
  renderChips(); renderLists(); renderGrid();
}

function resetFiltre() {
  $('#search').value = '';
  filters.q = ''; filters.cats = []; filters.prixMin = null; filters.prixMax = null;
  syncPrixInputs();
  renderChips(); renderLists(); renderGrid();
}

// Compteur d'une liste sauvegardée : son filtre rejoué en « virtuel » sur le cache.
const compteListe = l => collection.filter(o => matchFiltre(o, {
  q: norm(l.q || ''), cats: l.cats ?? [], prixMin: l.prixMin ?? null, prixMax: l.prixMax ?? null, list: '',
})).length;

function renderLists() {
  const nLoc = collection.filter(o => !o.zone || !o.zone.trim()).length;
  const nVal = collection.filter(o => o.statut === 'fiche_prete').length;
  const nCher = collection.filter(o => o.prix_haut >= 1000).length;
  const defs = [
    ['a_localiser', 'var(--amber)', 'À localiser', nLoc],
    ['a_valider', 'var(--violet)', 'Fiches à valider', nVal],
    ['chere', 'var(--green)', '> 1 000 €', nCher],
  ];
  const actId = listeActive()?.id;
  $('#lists').innerHTML = defs.map(([k, col, label, n]) =>
    `<button class="ls ${filters.list === k ? 'active' : ''}" data-list="${k}"><span class="dot" style="background:${col}"></span>${label} <span class="n">${n}</span></button>`
  ).join('') + loadListes().map(l =>
    `<button class="ls ${actId === l.id ? 'active' : ''}" data-slist="${esc(l.id)}">🔖 ${esc(l.nom)} <span class="n">${compteListe(l)}</span><span class="ls-del" data-del="${esc(l.id)}" title="Supprimer la liste « ${esc(l.nom)} »">✕</span></button>`
  ).join('');
  // « Sauvegarder ce filtre » n'a de sens que si un filtre est actif
  $('#btn-save-filter').classList.toggle('hidden', !filtreActif());
  $$('#lists .ls[data-list]').forEach(b => b.addEventListener('click', () => {
    filters.list = filters.list === b.dataset.list ? '' : b.dataset.list;
    renderLists(); renderGrid();
  }));
  $$('#lists .ls[data-slist]').forEach(b => b.addEventListener('click', e => {
    const ls = loadListes();
    const l = ls.find(x => x.id === b.dataset.slist);
    if (!l) return;
    if (e.target.closest('[data-del]')) {
      if (confirm(`Supprimer la liste « ${l.nom} » ?`)) {
        saveListes(ls.filter(x => x.id !== l.id));
        renderLists();
        toast(`Liste « ${l.nom} » supprimée`);
      }
      return;
    }
    if (actId === l.id) resetFiltre(); else applyListe(l); // reclic = désactive
  }));
}

function cardHtml(o) {
  const img = photoMap[o.id];
  const marks = confMarks(o);
  const loc = (o.zone || o.contenant)
    ? esc([o.zone, o.contenant].filter(Boolean).join(' / '))
    : '<em>non localisé</em>';
  const meta = [catCanon(o.categorie), o.periode, o.ecole].filter(Boolean).map(esc).join(' · ') || '<em>à identifier</em>';
  const visuel = img?.url
    ? `<img src="${esc(img.url)}" alt="${esc(o.titre || 'Objet de la collection')}" loading="lazy" decoding="async" style="object-position:${img.fx ?? 50}% ${img.fy ?? 50}%">`
    : catEmoji(o.categorie); // pas de visuel : placeholder emoji (+ badge ▶ si vidéo)
  const badgeVid = img?.vid ? '<span class="card-vid" title="Vidéo" aria-label="Vidéo">▶</span>' : '';
  return `<article class="card" data-oid="${esc(o.id)}" tabindex="0" role="button" aria-label="${esc(o.titre || 'Objet')} — fiche #${esc(o.id)}">
    <div class="card-img">${visuel}<span class="card-id">#${esc(o.id)}</span><span class="card-status" style="background:${ST_COLOR[o.statut] || '#8A94B8'}"></span>${badgeVid}</div>
    <div class="card-body">
      <div class="card-title">${esc(o.titre || 'Sans titre')}</div>
      <div class="card-meta">${meta}</div>
      <div class="card-loc">${pinSvg}${loc}</div>
      <div class="card-foot">${prixHtml(o)}${confHtml(marks)}</div>
    </div>
  </article>`;
}

function renderGrid() {
  const body = $('#collection-body');
  updateFiltersCount();
  const items = collection.filter(objMatches);
  if (!collection.length) {
    body.innerHTML = emptyHtml('Aucun objet pour l’instant', 'Capture ton premier objet — photo + n° d’étiquette, l’IA fait le reste.');
    return;
  }
  if (!items.length) {
    // Aucun résultat : accuser les filtres actifs + sortie en 1 tap (référentiel §4.5)
    const avecFiltres = filtreActif() || filters.list;
    body.innerHTML = emptyHtml('Rien ne correspond', 'Essaie d’autres mots, un n° d’étiquette, un lieu…',
      avecFiltres ? '<button class="btn" id="btn-reset-filtres" style="margin-top:16px">Réinitialiser les filtres</button>' : '');
    $('#btn-reset-filtres')?.addEventListener('click', () => { filters.list = ''; resetFiltre(); });
    return;
  }
  const g = filters.group;
  if (!g) {
    body.innerHTML = `<div class="grid">${items.map(cardHtml).join('')}</div>`;
  } else {
    const groups = new Map();
    for (const o of items) {
      const raw = String(g === 'categorie' ? (catCanon(o.categorie) ?? '') : (o[g] ?? '')).trim();
      const k = raw || (g === 'zone' ? 'Non localisé' : g === 'periode' ? 'Période inconnue' : 'Sans catégorie');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    body.innerHTML = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'))
      .map(([k, arr]) => `<div class="group-title">${esc(k)} <span class="n">${arr.length}</span></div><div class="grid">${arr.map(cardHtml).join('')}</div>`)
      .join('');
  }
  $$('.card', body).forEach(c => {
    const go = () => { location.hash = '#/objet/' + encodeURIComponent(c.dataset.oid); };
    c.addEventListener('click', go);
    // Carte = div focusable (role="button") : Enter/Espace = même navigation que le clic
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// Recherche (débounce) + filtre prix (même débounce) + regroupement
let searchTimer;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { filters.q = norm(e.target.value); renderLists(); renderGrid(); }, 150);
});
for (const [id, key] of [['#prix-min', 'prixMin'], ['#prix-max', 'prixMax']]) {
  $(id).addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = e.target.valueAsNumber;
      filters[key] = Number.isNaN(v) ? null : v; // champ vide = borne non renseignée
      renderLists(); renderGrid();
    }, 150);
  });
}
$('#group-by').addEventListener('change', e => { filters.group = e.target.value; renderGrid(); });

// Panneau « Filtres » mobile (progressive disclosure, référentiel §4.1) :
// la pastille compte les filtres actifs cachés dans le panneau (bornes prix,
// regroupement ≠ défaut) ; recherche et chips, elles, restent visibles.
function updateFiltersCount() {
  const n = (filters.prixMin != null) + (filters.prixMax != null) + (filters.group !== 'categorie');
  const b = $('#filters-count');
  b.textContent = n || '';
  b.classList.toggle('hidden', !n);
  // Loupe repliée : état actif visible si une recherche est en cours (sinon
  // le filtre serait caché ET invisible — piège de la progressive disclosure)
  $('#btn-search-toggle').classList.toggle('on', !!filters.q);
}
$('#btn-filters').addEventListener('click', () => {
  const open = $('#filters-panel').classList.toggle('open');
  $('#btn-filters').setAttribute('aria-expanded', String(open));
});

// Recherche repliée en loupe (mobile) : tap → la barre se déploie avec
// autofocus ; « × » efface la recherche en cours puis referme la barre.
const toolbarEl = () => $('#view-collection .toolbar');
$('#btn-search-toggle').addEventListener('click', () => {
  const open = toolbarEl().classList.toggle('search-open');
  $('#btn-search-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
});
$('#btn-search-close').addEventListener('click', () => {
  if ($('#search').value) {
    $('#search').value = '';
    filters.q = '';
    renderLists(); renderGrid();
  }
  toolbarEl().classList.remove('search-open');
  $('#btn-search-toggle').setAttribute('aria-expanded', 'false');
});

// « 💾 Sauvegarder ce filtre » : l'état courant (recherche + chips + prix)
// devient une liste nommée, persistée en local pour ce locataire.
$('#btn-save-filter').addEventListener('click', () => {
  const nom = prompt('Nom de cette liste :', $('#search').value.trim() || 'Ma liste');
  if (!nom?.trim()) return;
  const ls = loadListes();
  ls.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nom: nom.trim(),
    q: $('#search').value.trim(),
    cats: [...filters.cats],
    prixMin: filters.prixMin,
    prixMax: filters.prixMax,
  });
  saveListes(ls);
  renderLists();
  toast(`Liste « ${nom.trim()} » sauvegardée`);
});

// ─── Export CSV (Excel fr-FR : séparateur ';', BOM, champs quotés) ──────────
// Exporte les objets ACTUELLEMENT FILTRÉS (« ma liste → CSV »), pas toute la
// collection. Prix bruts (pas de séparateur de milliers dans le CSV).
const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
$('#btn-csv').addEventListener('click', () => {
  const items = collection.filter(objMatches);
  if (!items.length) { toast('Aucun objet ne correspond au filtre — rien à exporter', true); return; }
  const head = ['N°', 'Titre', 'Catégorie', 'Auteur', 'Période', 'École', 'Technique', 'État',
    'Prix bas (€)', 'Prix haut (€)', 'Confiance', 'Statut', 'Zone', 'Contenant', 'Position', 'Créé le'];
  const lignes = items.map(o => [
    o.id, o.titre, catCanon(o.categorie) ?? o.categorie, o.auteur, o.periode, o.ecole,
    o.technique, o.etat, o.prix_bas, o.prix_haut, o.confiance, STATUTS[o.statut] ?? o.statut,
    o.zone, o.contenant, o.position, o.created_at,
  ].map(csvCell).join(';'));
  const csv = '\uFEFF' + head.map(csvCell).join(';') + '\r\n' + lignes.join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `iartcane-collection-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${items.length} ${items.length > 1 ? 'objets exportés' : 'objet exporté'}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// VUE OBJET
// ═══════════════════════════════════════════════════════════════════════════
// Champs éditables en mode « Corriger » (chaque diff → événement 'correction' = leçon PMO)
const CHAMPS_EDIT = [
  ['titre', 'Titre'], ['categorie', 'Catégorie'], ['technique', 'Technique'],
  ['periode', 'Période'], ['ecole', 'Région / école'], ['auteur', 'Auteur'],
  ['marques', 'Marques / poinçons'], ['etat', 'État'],
  ['prix_bas', 'Prix bas (€)'], ['prix_haut', 'Prix haut (€)'],
];

async function loadObjet(id) {
  const body = $('#objet-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  const { data: o, error } = await sb.from('objets').select('*').eq('owner_id', tenantId).eq('id', id).maybeSingle();
  if (error || !o) {
    body.innerHTML = emptyHtml('Objet introuvable', `Aucun objet #${id} dans ta collection.`);
    return;
  }
  currentObjet = o;
  editing = false;
  const [{ data: photos }, { data: comps }, { data: fiches }, { data: events }, { data: artiste }] = await Promise.all([
    sb.from('photos').select('*').eq('owner_id', tenantId).eq('objet_id', id).order('created_at'),
    sb.from('comparables').select('*').eq('owner_id', tenantId).eq('objet_id', id).order('date_vente', { ascending: false, nullsFirst: false }),
    sb.from('fiches').select('*').eq('owner_id', tenantId).eq('objet_id', id).order('version', { ascending: false }).limit(1),
    sb.from('evenements').select('*').eq('owner_id', tenantId).eq('objet_id', id).order('created_at', { ascending: false }).limit(50),
    // Fiche artiste (migration 0008) : match exact sur objets.auteur, 0 ligne tolérée
    o.auteur ? sb.from('artistes').select('*').eq('owner_id', tenantId).eq('nom', o.auteur).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const urlByPath = await signPaths((photos ?? []).flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean)));
  currentPhotos = (photos ?? []).map(p => ({ ...p, url: urlByPath[p.storage_path], thumbUrl: urlByPath[p.thumb_path] ?? urlByPath[p.storage_path] }));
  currentComps = comps ?? [];
  currentFiche = (fiches ?? [])[0] ?? null;
  currentEvents = events ?? [];
  currentArtiste = artiste ?? null;
  renderObjet();
  loadSimilar(o);
}

// Suppression d'une photo (fichier storage + ligne) — policy storage delete : migration 0007.
async function deletePhoto() {
  const sel = selPhoto();
  if (!sel || !currentObjet) return;
  if (!confirm('Supprimer cette photo ? (fichier + référence, définitif)')) return;
  await sb.storage.from('photos').remove([sel.storage_path]); // tolérant : la ligne prime
  const { error } = await sb.from('photos').delete().eq('owner_id', tenantId).eq('id', sel.id);
  if (error) { toast(error.message, true); return; }
  logEvent('photo_supprimee', { photo: sel.storage_path });
  toast('Photo supprimée');
  await loadObjet(currentObjet.id);
}

// Suppression d'un objet : fichiers storage puis ligne `objets` — les FK
// on delete cascade emportent photos/comparables/fiches/jobs/evenements.
async function deleteObjet() {
  const o = currentObjet;
  if (!o) return;
  if (!confirm(`Supprimer l'objet #${o.id} ?\n${currentPhotos.length} photo(s), fiche, comparables et historique partent avec — définitif.`)) return;
  const paths = currentPhotos.map(p => p.storage_path);
  if (paths.length) await sb.storage.from('photos').remove(paths);
  const { error } = await sb.from('objets').delete().eq('owner_id', tenantId).eq('id', o.id);
  if (error) { toast(error.message, true); return; }
  toast(`Objet #${o.id} supprimé`);
  location.hash = '#/';
}

async function deleteComp(cid) {
  if (!currentObjet || !canWrite()) return;
  const c = currentComps.find(x => String(x.id) === String(cid));
  if (!c) return;
  if (!confirm('Retirer ce comparable de l’estimation ?')) return;
  const { error } = await sb.from('comparables').delete().eq('owner_id', tenantId).eq('id', cid);
  if (error) { toast(error.message, true); return; }
  logEvent('comparable_supprime', { comparable_id: cid, lot: c.lot, maison: c.maison }, currentObjet.id);
  toast('Comparable retiré');
  await loadObjet(currentObjet.id);
}

function dlRow(label, val, editField, type = 'text') {
  const v = (val ?? '') === '' ? null : String(val);
  if (editing && editField) {
    return `<dt>${label}</dt><dd><input id="edit-${editField}" type="${type}" value="${esc(v ?? '')}"></dd>`;
  }
  return `<dt>${label}</dt><dd>${v ? esc(v) : '<span class="miss">—</span>'}</dd>`;
}

function renderObjet() {
  const o = currentObjet;
  const marks = confMarks(o);
  const selIdx = Math.max(0, currentPhotos.findIndex(p => p.sel));
  const sel = currentPhotos[selIdx];

  const gallery = currentPhotos.length ? `
    <div class="panel">
      <div class="gallery-main" data-action="zoom" title="Agrandir">
        ${sel && sel.url ? (isVideo(sel) ? `<video src="${esc(sel.url)}" controls></video>` : `<img src="${esc(sel.url)}" alt="photo de l'objet">`) : catEmoji(o.categorie)}
        ${sel && sel.url && !isVideo(sel) ? `<button class="crop-btn hide-lecteur" data-action="crop-toggle" title="Centrer : choisir le point de la photo sur lequel la carte du listing se centre">🎯 Centrer</button>` : ''}
        ${sel && sel.url && !isVideo(sel) ? `<button class="crop-btn cut-btn hide-lecteur" data-action="cut-photo" title="Recadrer : rogne définitivement la photo (résolution d'origine conservée)">✂️ Recadrer</button>` : ''}
        ${sel && sel.url ? `<button class="crop-btn del-photo hide-lecteur" data-action="del-photo" title="Supprimer cette photo">🗑</button>` : ''}
      </div>
      <div class="thumbs">
        ${currentPhotos.map((p, i) => `
          <div class="thumb ${i === selIdx ? 'sel' : ''}" data-action="thumb" data-idx="${i}" title="${esc(p.kind)}" tabindex="0" role="button" aria-label="Photo ${i + 1} — ${esc(p.kind)}">
            ${p.url ? (isVideo(p) ? '🎬' : `<img src="${esc(p.thumbUrl || p.url)}" alt="${esc(p.kind)} — ${esc(o.titre || 'objet')}" loading="lazy" decoding="async">`) : '📷'}
            <span class="kind">${esc(p.kind)}</span>
          </div>`).join('')}
        <div class="thumb add hide-lecteur" data-action="add-photo" title="Ajouter une photo" tabindex="0" role="button" aria-label="Ajouter une photo">＋</div>
      </div>
    </div>` : `
    <div class="panel">
      <div class="gallery-main" ${canWrite() ? 'data-action="add-photo" title="Ajouter la première photo" style="cursor:pointer"' : ''}>${catEmoji(o.categorie)}</div>
      <div class="thumbs"><div class="thumb add hide-lecteur" data-action="add-photo">＋</div></div>
    </div>`;

  const rebounds = [o.categorie, o.periode, o.ecole].filter(Boolean)
    .map(v => `<button class="rebound" data-action="rebound" data-val="${esc(v)}">${esc(v)}</button>`).join('');

  const identification = editing
    ? `<dl class="dl editing">
        ${CHAMPS_EDIT.map(([f, label]) => dlRow(label, o[f], f, f.startsWith('prix_') ? 'number' : 'text')).join('')}
        <dt>Description</dt><dd><input id="edit-description" value="${esc(o.description ?? '')}"></dd>
       </dl>`
    : `<dl class="dl">
        ${dlRow('Catégorie', o.categorie)}
        ${dlRow('Technique', o.technique)}
        ${dlRow('Période', o.periode)}
        ${dlRow('Région / école', o.ecole)}
        ${dlRow('Auteur', o.auteur)}
        ${dlRow('Marques / poinçons', o.marques)}
        ${dlRow('État', o.etat)}
        ${o.description ? `<dt>Description</dt><dd><em>${esc(o.description)}</em></dd>` : ''}
      </dl>`;

  // Règle d'or : seules les adjudications nourrissent la fourchette — les
  // annonces « en vente » sont du contexte et sont affichées à part (badge ambre).
  const nVendus = currentComps.filter(c => c.source_type !== 'en_vente').length;
  const valeur = (o.prix_bas != null && o.prix_haut != null) ? `
      <div class="value-big">${fmtNum(o.prix_bas)}–${fmtNum(o.prix_haut)} €</div>
      <div class="value-sub">fourchette issue de ${nVendus} adjudication${nVendus > 1 ? 's' : ''} réelle${nVendus > 1 ? 's' : ''} — jamais d'estimation « de mémoire »</div>`
    : `<div class="value-sub">Pas encore d'estimation. La règle d'or : <b>jamais un chiffre sans comparables vendus affichés</b>.</div>`;

  // Comparables visuels : cartes avec image du lot. Adjudications d'abord,
  // « en vente » ensuite (tri stable : la date descendante de la requête est
  // conservée à l'intérieur de chaque groupe).
  const compsSorted = [...currentComps].sort((a, b) =>
    (a.source_type === 'en_vente' ? 1 : 0) - (b.source_type === 'en_vente' ? 1 : 0));
  const compsList = compsSorted.length ? `
    <div class="comps-list">
      ${compsSorted.map(c => {
        const enVente = c.source_type === 'en_vente';
        const img = c.image_url
          ? `<img src="${esc(c.image_url)}" alt="${esc(c.lot ?? 'lot comparable')}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
          : '<span class="comp-noimg">🖼️</span>';
        const thumb = c.lien
          ? `<a class="comp-thumb" href="${esc(c.lien)}" target="_blank" rel="noopener" title="Voir le lot">${img}</a>`
          : `<div class="comp-thumb">${img}</div>`;
        return `<div class="comp-card">
          ${thumb}
          <div class="comp-info">
            <div class="comp-top">
              <span class="comp-maison">${esc(c.maison ?? '')}</span>
              <span class="mono comp-date">${fmtDate(c.date_vente)}</span>
              <span class="comp-badge ${enVente ? 'vente' : 'vendu'}">${enVente ? 'En vente — contexte' : 'Vendu'}</span>
            </div>
            <div class="comp-lot">${esc(c.lot ?? '—')}</div>
            <div class="comp-bot">
              <span class="comp-prix">${c.prix != null ? fmtNum(c.prix) + ' ' + esc(c.devise === 'EUR' ? '€' : c.devise) : '—'}</span>
              <div style="display:flex;gap:8px;align-items:center">
                ${c.lien ? `<a class="link-lot" href="${esc(c.lien)}" target="_blank" rel="noopener">Voir le lot ↗</a>` : ''}
                ${canWrite() ? `<button class="btn small danger" data-action="del-comp" data-cid="${esc(c.id)}">Retirer</button>` : ''}
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  const actions = editing ? `
    <div class="corr-bar">
      ✏️ <b>Mode correction</b> — chaque différence est gravée comme leçon (ground truth).
      Je suis :
      <select id="corr-qui">
        <option value="alain" ${localStorage.getItem('iartcane-qui') !== 'yann' ? 'selected' : ''}>Alain</option>
        <option value="yann" ${localStorage.getItem('iartcane-qui') === 'yann' ? 'selected' : ''}>Yann</option>
      </select>
      <button class="btn primary small" data-action="corr-save">Enregistrer les corrections</button>
      <button class="btn small" data-action="corr-cancel">Annuler</button>
    </div>` : `
    <div class="actions hide-lecteur">
      <button class="btn primary" data-action="valider" ${o.statut === 'validee' ? 'disabled' : ''}>✓ Valider la fiche</button>
      <button class="btn" data-action="corriger">✏️ Corriger</button>
      <button class="btn" data-action="relancer">↻ Relancer l'estimation</button>
      <button class="btn" data-action="take-photo">📸 Prendre une photo</button>
      <button class="btn" data-action="add-photo">🖼️ Ajouter depuis la galerie</button>
      <button class="btn danger" data-action="del-objet">🗑 Supprimer l'objet</button>
    </div>`;

  // Fiche artiste (table `artistes`, migration 0008) — rien affiché si pas de fiche
  const artistePanel = currentArtiste ? `
    <details class="panel panel-pad acc" open>
      <summary class="sec-title">🎨 Artiste — ${esc(currentArtiste.nom)}</summary>
      <div class="md-body">${mdToHtml(currentArtiste.bio_md ?? '')}</div>
      <a class="link-lot" style="display:inline-block;margin-top:12px" href="#/artiste/${encodeURIComponent(currentArtiste.nom)}">Voir la fiche artiste →</a>
    </details>` : '';

  const fichePanel = currentFiche ? `
    <details class="panel panel-pad acc">
      <summary class="sec-title">Fiche IA <span style="font-size:12px;font-family:var(--mono);color:var(--ink-3);font-weight:400">v${currentFiche.version}${currentFiche.modele ? ' · ' + esc(currentFiche.modele) : ''} · ${fmtDate(currentFiche.created_at)}</span></summary>
      <div class="md-body">${mdToHtml(currentFiche.contenu_md)}</div>
    </details>` : `
    <div class="panel panel-pad">
      <div class="sec-title">Fiche IA</div>
      <div class="value-sub">${o.statut === 'en_file' || o.statut === 'analyse'
        ? '⏳ Analyse en file — le cron la traitera et la fiche apparaîtra ici.'
        : 'Pas encore de fiche. Ajoute des photos puis relance l\'analyse.'}</div>
    </div>`;

  // Changelog objet (D-025) : qui a fait quoi, quand, avec quel outil —
  // actions du site (photos, corrections, validation…) + passes IA du cron
  // (identification, marché, Lens…), champs avant→après quand dispo.
  const evRows = currentEvents.map(ev => {
    const bits = evDetailBits(ev.detail ?? {});
    return `<div class="ev-row">
      <span class="ev-date">${fmtDate(ev.created_at)}</span>
      <span class="ev-act">${esc(ACT_LABELS[ev.action] ?? ev.action)}</span>
      <span class="ev-qui">${esc(ev.acteur ?? '')}</span>
      <span class="ev-det">${bits.join(' · ')}</span>
    </div>`;
  }).join('');
  const historyPanel = `
    <details class="panel panel-pad acc">
      <summary class="sec-title">Historique <span style="font-size:12px;font-family:var(--mono);color:var(--ink-3);font-weight:400">${currentEvents.length} événement${currentEvents.length > 1 ? 's' : ''}</span></summary>
      <div class="ev-list">${evRows || '<div class="value-sub">Aucun événement tracé pour l\'instant.</div>'}</div>
    </details>`;

  $('#objet-body').innerHTML = `
  <div class="obj-layout">
    <div class="obj-main">
      ${gallery}
      <div class="panel panel-pad">
        <h1 class="obj-title">${esc(o.titre || 'Sans titre')}</h1>
        ${rebounds ? `<div class="rebounds" style="margin-top:12px">${rebounds}</div>` : ''}
      </div>
      <details class="panel panel-pad acc" open>
        <summary class="sec-title">Identification</summary>
        ${identification}
      </details>
      ${artistePanel}
      <details class="panel panel-pad acc" open>
        <summary class="sec-title">Vente / estimation</summary>
        ${valeur}
        ${compsList}
      </details>
      ${actions}
      ${fichePanel}
      ${historyPanel}
      <div class="panel panel-pad" id="similar-panel" style="display:none">
        <div class="sec-title">Objets qui s'en rapprochent</div>
        <div class="similar" id="similar-grid"></div>
      </div>
      <div class="disclaimer">${infoSvg}
        Aide à l'estimation et au catalogage — ne constitue pas une expertise certifiée. Au-delà de 2 000 € estimés, une expertise humaine est recommandée (CNES/CNE, commissaire-priseur).
      </div>
    </div>
    <aside class="obj-side">
      <div class="panel panel-pad">
        <div class="side-row">
          <span class="side-id">#${esc(o.id)}</span>
          <span class="st st-${esc(o.statut)}">${STATUTS[o.statut] ?? esc(o.statut)}</span>
        </div>
        <div style="margin-top:14px;display:flex;align-items:center;gap:10px">
          ${confHtml(marks)}
        </div>
      </div>
      <div class="loc-card" id="loc-card"></div>
      <div class="panel panel-pad side-dates">
        <div>Capturé le ${fmtDate(o.created_at)} · ${esc(o.source_capture)}</div>
        <div>Modifié le ${fmtDate(o.updated_at)}</div>
        <div>${currentPhotos.length} photo${currentPhotos.length > 1 ? 's' : ''}${currentPhotos.length === 0 ? ' — à prendre' : ''}</div>
      </div>
    </aside>
  </div>`;
  renderLocCard(false);
}

// Carte localisation (lecture / édition inline — simple attribut, pas gravé en correction)
function renderLocCard(edit) {
  const o = currentObjet;
  const el = $('#loc-card');
  if (!el) return;
  if (!edit) {
    el.innerHTML = `
      <div class="loc-line"><span class="k">Zone</span><span class="v">${o.zone ? esc(o.zone) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line"><span class="k">Contenant</span><span class="v">${o.contenant ? esc(o.contenant) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line"><span class="k">Position</span><span class="v">${o.position ? esc(o.position) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line" style="justify-content:flex-end;margin-top:6px"><button class="edit-btn hide-lecteur" data-action="loc-edit">✏️ modifier</button></div>`;
  } else {
    el.innerHTML = `
      <div class="loc-line"><span class="k">Zone</span><input id="loc-zone" value="${esc(o.zone ?? '')}" placeholder="Garage…"></div>
      <div class="loc-line"><span class="k">Contenant</span><input id="loc-contenant" value="${esc(o.contenant ?? '')}" placeholder="Carton 33…"></div>
      <div class="loc-line"><span class="k">Position</span><input id="loc-position" value="${esc(o.position ?? '')}" placeholder="étagère haute…"></div>
      <div class="loc-line" style="justify-content:flex-end;gap:6px;margin-top:8px">
        <button class="edit-btn" data-action="loc-cancel">annuler</button>
        <button class="edit-btn" data-action="loc-save" style="font-weight:700">✓ enregistrer</button>
      </div>`;
  }
}

async function loadSimilar(o) {
  const panel = $('#similar-panel');
  if (!panel) return;
  if (!o.categorie) return;
  const { data } = await sb.from('objets').select('*')
    .eq('owner_id', tenantId).eq('categorie', o.categorie).neq('id', o.id)
    .order('created_at', { ascending: false }).limit(3);
  if (!data?.length) return;
  // Miniatures 480 px (plusieurs Mo → ~30 Ko par vignette — audit 2026-08-24)
  const { data: ph } = await sb.from('photos').select('objet_id,storage_path,thumb_path')
    .eq('owner_id', tenantId).in('objet_id', data.map(s => s.id)).order('created_at');
  const first = {};
  for (const p of ph ?? []) if (!first[p.objet_id]) first[p.objet_id] = p.thumb_path ?? p.storage_path;
  const urls = await signPaths(Object.values(first));
  panel.style.display = '';
  $('#similar-grid').innerHTML = data.map(s => {
    const img = urls[first[s.id]];
    return `<div class="sim-card" data-action="similar" data-oid="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.titre || 'Objet similaire')} — fiche #${esc(s.id)}">
      <div class="sim-img">${img ? `<img src="${esc(img)}" alt="${esc(s.titre || 'Objet similaire')}" loading="lazy" decoding="async">` : catEmoji(s.categorie)}</div>
      <div><div class="sim-t">${esc(s.titre || 'Sans titre')}</div>
      <div class="sim-m">#${esc(s.id)}${s.prix_bas != null ? ` · ${fmtNum(s.prix_bas)}–${fmtNum(s.prix_haut)} €` : ''}</div></div>
    </div>`;
  }).join('');
}

// ─── Actions de la vue Objet (délégation) ───────────────────────────────────
const selPhoto = () => currentPhotos.find(p => p.sel) ?? currentPhotos[0];

// Met l'objet en file d'analyse (statut + job). L'index unique partiel
// jobs_un_en_attente_idx (migration 0011) renvoie 23505 si un job est déjà en
// file pour cet objet — c'est le comportement voulu, on l'ignore.
async function queueAnalyse(oid, type = 'analyse') {
  await sb.from('objets').update({ statut: 'en_file' }).eq('owner_id', tenantId).eq('id', oid);
  const { error } = await sb.from('jobs').insert({ owner_id: tenantId, objet_id: oid, type });
  if (error && error.code !== '23505') toast(error.message, true);
}

// Activation clavier des vignettes/cartes non-boutons (div role="button") :
// Enter/Espace déclenche le même handler que le clic (délégation ci-dessous).
$('#objet-body').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.thumb[data-action], .sim-card[data-action]');
  if (!el || el !== e.target) return; // ne pas voler l'activation des vrais boutons internes
  e.preventDefault();
  el.click();
});

// Actions qui modifient des données — bloquées pour un lecteur (double garde
// avec la RLS 0012 ; l'UI est déjà masquée via .hide-lecteur).
const ACTIONS_MUTANTES = new Set([
  'crop-toggle', 'cut-photo', 'del-photo', 'del-objet', 'add-photo', 'take-photo',
  'loc-edit', 'loc-save', 'valider', 'corriger', 'corr-save', 'relancer',
  'del-comp',
]);

$('#objet-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (ACTIONS_MUTANTES.has(act) && !canWrite()) return;
  const o = currentObjet;

  if (act === 'thumb') {
    currentPhotos.forEach((p, i) => { p.sel = i === Number(el.dataset.idx); });
    renderObjet();
  }
  else if (act === 'zoom') {
    const sel = selPhoto();
    if (!sel?.url) return;
    openLightbox(sel);
  }
  // Cadrage : la photo s'ouvre en PLEIN ÉCRAN (entière, quitte à être petite —
  // retour Yann : « pour la cadrer il faut la voir ») et le clic y définit le
  // point focal de CETTE photo seulement (chaque photo a son cadrage).
  else if (act === 'crop-toggle') {
    const sel = selPhoto();
    if (!sel?.url) return;
    openLightbox(sel, 'focal');
  }
  else if (act === 'cut-photo') {
    const sel = selPhoto();
    if (!sel?.url) return;
    openLightbox(sel, 'cut');
  }
  else if (act === 'del-photo') { deletePhoto(); }
  else if (act === 'del-objet') { deleteObjet(); }
  else if (act === 'del-comp') { deleteComp(el.dataset.cid); }
  else if (act === 'add-photo') { $('#file-add-photo').click(); }
  else if (act === 'take-photo') { openCamera('objet'); }
  else if (act === 'rebound') {
    filters.q = norm(el.dataset.val); filters.cats = []; filters.list = '';
    filters.prixMin = null; filters.prixMax = null;
    $('#search').value = el.dataset.val;
    syncPrixInputs();
    location.hash = '#/';
  }
  else if (act === 'similar') { location.hash = '#/objet/' + encodeURIComponent(el.dataset.oid); }
  else if (act === 'loc-edit') { renderLocCard(true); }
  else if (act === 'loc-cancel') { renderLocCard(false); }
  else if (act === 'loc-save') {
    const updates = {
      zone: $('#loc-zone').value.trim() || null,
      contenant: $('#loc-contenant').value.trim() || null,
      position: $('#loc-position').value.trim() || null,
    };
    const { error } = await sb.from('objets').update(updates).eq('owner_id', tenantId).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    Object.assign(currentObjet, updates);
    logEvent('localisation', { champs: Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, { apres: v }])) });
    renderLocCard(false);
    toast('Localisation mise à jour');
  }
  else if (act === 'valider') {
    const { error } = await sb.from('objets').update({ statut: 'validee' }).eq('owner_id', tenantId).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    logEvent('validation', { note: 'confiance 4/4 (ground truth)' });
    toast(`#${o.id} validée ✓ — confiance 4/4 (ground truth)`);
    loadObjet(o.id); loadHeader();
  }
  else if (act === 'corriger') { editing = true; renderObjet(); }
  else if (act === 'corr-cancel') { editing = false; renderObjet(); }
  else if (act === 'corr-save') { saveCorrections(); }
  else if (act === 'relancer') {
    if (!confirm(`Relancer l'estimation complète de #${o.id} ?\n\nLa passe entière sera rejouée : identification + recherche de comparables. Le cron la traitera au prochain run.`)) return;
    await queueAnalyse(o.id, 'reanalyse');
    logEvent('relance', {});
    toast('Estimation relancée — le cron la traitera');
    loadObjet(o.id);
  }
});

// ─── Actions de la vue Artiste (délégation) ───────────────────────────────
function openArtistePhotoLightbox(pid) {
  const p = currentArtistePhotos.find(x => String(x.id) === String(pid));
  if (!p?.url) return;
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${esc(p.url)}" alt="${esc(p.kind)}" loading="eager">`;
  const close = () => { lb.remove(); document.body.classList.remove('lb-open'); };
  lb.addEventListener('click', close);
  document.body.classList.add('lb-open');
  document.body.append(lb);
}

$('#artiste-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if ((act === 'add-artiste-photo' || act === 'del-artiste-photo') && !canWrite()) return;
  if (act === 'add-artiste-photo') {
    $('#file-artiste-photo').click();
  } else if (act === 'del-artiste-photo') {
    e.stopPropagation();
    await deleteArtistePhoto(el.dataset.pid);
  } else if (act === 'zoom-artiste-photo') {
    openArtistePhotoLightbox(el.dataset.pid);
  }
});

async function saveCorrections() {
  const o = currentObjet;
  const auteur = $('#corr-qui')?.value ?? 'alain';
  localStorage.setItem('iartcane-qui', auteur);
  const updates = {};
  const rows = [];
  for (const [champ] of [...CHAMPS_EDIT, ['description', 'Description']]) {
    const inp = $('#edit-' + champ);
    if (!inp) continue;
    let nv = inp.value.trim();
    const av = o[champ] == null ? '' : String(o[champ]);
    if (champ.startsWith('prix_')) {
      nv = nv === '' ? null : Number(nv.replace(',', '.'));
      if (nv !== null && !Number.isFinite(nv)) { toast(`Prix invalide (${champ})`, true); return; }
    } else {
      nv = nv === '' ? null : nv;
    }
    if (av !== String(nv ?? '')) {
      updates[champ] = nv;
      rows.push({ champ, avant: av || null, apres: nv == null ? null : String(nv) });
    }
  }
  if (!rows.length) { toast('Aucune modification'); editing = false; renderObjet(); return; }
  updates.statut = 'contestee';
  const { error } = await sb.from('objets').update(updates).eq('owner_id', tenantId).eq('id', o.id);
  if (error) { toast(error.message, true); return; }
  // Ground truth tracée dans evenements (corrections absorbée, D-027) — le cron la relit là.
  logEvent('correction', { champs: Object.fromEntries(rows.map(r => [r.champ, { avant: r.avant, apres: r.apres }])) });
  toast(`${rows.length} correction${rows.length > 1 ? 's' : ''} gravée${rows.length > 1 ? 's' : ''} — leçons pour l'IA`);
  loadObjet(o.id);
}

// ─── Upload de photos (partagé capture + fiche objet) ───────────────────────
// Miniature JPEG ≤ 480 px générée à l'upload (listing + carrousel — vitesse, 2026-08-24).
// NULL si échec : l'affichage retombe sur l'image pleine.
async function makeThumbBlob(blob) {
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

async function uploadPhotosFor(oid, files, firstIsFace = false) {
  let done = 0;
  let first = firstIsFace;
  for (const f of files) {
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${tenantId}/${oid}/${crypto.randomUUID()}.${ext}`;
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
    const { error: e2 } = await sb.from('photos').insert({ owner_id: tenantId, objet_id: oid, storage_path: path, thumb_path: thumbPath, kind, source: 'site' });
    if (e2) toast(e2.message, true); else done++;
  }
  return done;
}

$('#file-add-photo').addEventListener('change', async e => {
  if (!canWrite()) { e.target.value = ''; return; }
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !currentObjet) return;
  const oid = currentObjet.id;
  const n = await uploadPhotosFor(oid, files);
  if (n > 0) {
    logEvent('photo_ajoutee', { n, via: 'fichier' }, oid);
    // L'objet avait trop peu de photos → on relance l'analyse automatiquement
    if (['capture', 'a_completer'].includes(currentObjet.statut)) {
      await queueAnalyse(oid);
      toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} — analyse en file`);
    } else {
      toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`);
    }
  }
  loadObjet(oid);
});

// ─── Lightbox ───────────────────────────────────────────────────────────────
// Lightbox plein écran, 3 modes (règle Yann 2026-08-24 : par défaut l'image
// prend la place dispo, PAS PLUS — pas d'ascenseurs ; clic image = zoom 100 %).
//  - null   : agrandissement ajusté à l'écran (clic image = zoom, clic à côté = fermer)
//  - 'focal': le clic sur l'image définit le point focal de CETTE photo (la boîte
//             de l'<img> EST l'image entière → calcul exact, pas de letterbox)
//  - 'cut'  : recadrage RÉEL — cadre à poignées (bords/coins, comme Paint) :
//             rognage aux pixels natifs, la source est remplacée
function openLightbox(photo, mode = null) {
  const lb = document.createElement('div');
  lb.className = 'lightbox' + (mode ? ` ${mode}` : '');
  if (mode === 'cut') {
    lb.innerHTML = `<img src="${esc(photo.url)}" alt="Photo à recadrer — ${esc(currentObjet?.titre || 'objet')}">
      <div class="cut-bar"><span class="cut-hint">Tire les poignées (bords et coins) pour délimiter la zone à garder</span>
      <button class="btn primary small" data-ok disabled>✂️ Recadrer</button>
      <button class="btn small" data-cancel>Annuler</button></div>`;
  } else {
    lb.innerHTML = isVideo(photo) ? `<video src="${esc(photo.url)}" controls autoplay></video>` : `<img src="${esc(photo.url)}" alt="Photo plein écran — ${esc(currentObjet?.titre || 'objet')}">`;
    if (mode === 'focal') lb.insertAdjacentHTML('beforeend', '<div class="crop-hint">Cliquer au centre de l’objet — centrage de <b>cette photo</b> uniquement · clic à côté = annuler</div>');
  }
  const close = () => { lb.remove(); document.body.classList.remove('lb-open'); };
  document.body.classList.add('lb-open');

  if (mode === 'cut') {
    const img = lb.querySelector('img');
    const ok = lb.querySelector('[data-ok]');
    let sel = { x0: 0, y0: 0, x1: 1, y1: 1 }; // cadre initial = image entière
    let box = null;
    let drag = null;
    const MIN = 0.05; // zone minimale 5 %
    const toRel = e => {
      const r = img.getBoundingClientRect();
      return { x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) };
    };
    const H = {
      nw: (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN), y0: Math.min(p.y, s.y1 - MIN) }),
      n:  (s, p) => ({ ...s, y0: Math.min(p.y, s.y1 - MIN) }),
      ne: (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN), y0: Math.min(p.y, s.y1 - MIN) }),
      e:  (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN) }),
      se: (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN), y1: Math.max(p.y, s.y0 + MIN) }),
      s:  (s, p) => ({ ...s, y1: Math.max(p.y, s.y0 + MIN) }),
      sw: (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN), y1: Math.max(p.y, s.y0 + MIN) }),
      w:  (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN) }),
    };
    const draw = () => {
      if (!box) {
        box = document.createElement('div');
        box.className = 'cut-sel';
        box.innerHTML = Object.keys(H).map(h => `<i data-h="${h}" class="h-${h}"></i>`).join('');
        lb.append(box);
      }
      const r = img.getBoundingClientRect();
      box.style.left = `${r.left + sel.x0 * r.width}px`;
      box.style.top = `${r.top + sel.y0 * r.height}px`;
      box.style.width = `${(sel.x1 - sel.x0) * r.width}px`;
      box.style.height = `${(sel.y1 - sel.y0) * r.height}px`;
    };
    if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
    lb.addEventListener('pointerdown', e => {
      const h = e.target.dataset?.h;
      if (!h) return;
      e.preventDefault(); e.stopPropagation();
      drag = h;
    });
    lb.addEventListener('pointermove', e => {
      if (!drag) return;
      sel = H[drag](sel, toRel(e));
      draw();
      ok.disabled = false;
    });
    lb.addEventListener('pointerup', () => { drag = null; });
    lb.querySelector('[data-cancel]').addEventListener('click', e => { e.stopPropagation(); close(); });
    ok.addEventListener('click', async e => {
      e.stopPropagation();
      ok.disabled = true; ok.textContent = 'Recadrage…';
      try {
        const blob = await (await fetch(photo.url)).blob();
        const bmp = await createImageBitmap(blob);
        const sx = Math.round(sel.x0 * bmp.width);
        const sy = Math.round(sel.y0 * bmp.height);
        const sw = Math.round((sel.x1 - sel.x0) * bmp.width);
        const sh = Math.round((sel.y1 - sel.y0) * bmp.height);
        if (sw < 20 || sh < 20) throw new Error('zone trop petite');
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;                       // pixels natifs : pas de perte
        c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
        const out = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
        if (!out) throw new Error('encodage impossible');
        const newPath = photo.storage_path.replace(/[^/]+$/, `${crypto.randomUUID()}.jpg`);
        const { error: e1 } = await sb.storage.from('photos').upload(newPath, out, { contentType: 'image/jpeg' });
        if (e1) throw e1;
        // miniature régénérée depuis la version rognée + centrage remis à zéro
        const tb = await makeThumbBlob(out);
        let thumbPath = null;
        if (tb) {
          thumbPath = newPath.replace(/\.jpg$/, '.thumb.jpg');
          const { error: et } = await sb.storage.from('photos').upload(thumbPath, tb, { contentType: 'image/jpeg' });
          if (et) thumbPath = null;
        }
        const { error: e2 } = await sb.from('photos')
          .update({ storage_path: newPath, thumb_path: thumbPath, focal_x: null, focal_y: null })
          .eq('owner_id', tenantId).eq('id', photo.id);
        if (e2) throw e2;
        await sb.storage.from('photos').remove([photo.storage_path, photo.thumb_path].filter(Boolean));
        close();
        toast('✓ Photo recadrée — résolution d’origine conservée');
        logEvent('recadrage', { photo: newPath });
        await loadObjet(currentObjet.id);
      } catch (err) {
        toast(`Recadrage échoué : ${err.message ?? err}`, true);
        ok.disabled = false; ok.textContent = '✂️ Recadrer';
      }
    });
  } else {
    lb.addEventListener('click', async e => {
      const img = e.target.closest('img');
      if (mode !== 'focal') {
        if (img && !isVideo(photo)) { e.stopPropagation(); lb.classList.toggle('zoomed'); return; }
        close(); return;
      }
      if (!img) { close(); return; }
      e.stopPropagation();
      const r = img.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { close(); return; }
      const fx = Math.round((e.clientX - r.left) / r.width * 100);
      const fy = Math.round((e.clientY - r.top) / r.height * 100);
      const { error } = await sb.from('photos').update({ focal_x: fx, focal_y: fy }).eq('owner_id', tenantId).eq('id', photo.id);
      if (error) { toast(error.message, true); close(); return; }
      photo.focal_x = fx; photo.focal_y = fy;
      close();
      renderObjet();
      toast('✓ Centrage enregistré pour cette photo — la carte de la collection le suivra');
      logEvent('centrage', { photo: photo.storage_path, fx, fy });
    });
  }
  document.body.append(lb);
}

// ─── Mini rendu markdown (fiches IA) ────────────────────────────────────────
function mdInline(s) {
  return s
    // Liens AVANT gras/italique ; http(s) uniquement — tout autre schéma
    // (javascript:…) ne matche pas et reste du texte échappé, inoffensif.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function mdToHtml(md) {
  // Assainissement d'entrée : les bios/fiches LLM arrivent souvent avec des
  // backslash-échappements (\_ \* \#), des espaces doubles ou des espaces
  // avant la ponctuation — on nettoie avant l'échappement HTML.
  const clean = String(md ?? '')
    .replace(/\\([_*#`[\]])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .replace(/ +([,.;:!?»])/g, '$1');
  const lines = esc(clean).split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/^\s*\|.*\|\s*$/.test(L)) {
      closeList();
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const row = lines[i];
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(row)) {
          const cells = row.split('|').slice(1, -1).map(c => mdInline(c.trim()));
          tbl.push(cells);
        }
        i++;
      }
      i--;
      if (tbl.length) {
        out.push('<table><thead><tr>' + tbl[0].map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
          + tbl.slice(1).map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('')
          + '</tbody></table>');
      }
      continue;
    }
    const h = L.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); continue; }
    if (/^\s*---+\s*$/.test(L)) { closeList(); out.push('<hr>'); continue; }
    const ul = L.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${mdInline(ul[1])}</li>`); continue; }
    const ol = L.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${mdInline(ol[1])}</li>`); continue; }
    if (L.trim() === '') { closeList(); continue; }
    closeList();
    out.push(`<p>${mdInline(L)}</p>`);
  }
  closeList();
  return out.join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// VUES GOUVERNANCE — Artistes / Sources / Catégories & familles (D-028)
// ═══════════════════════════════════════════════════════════════════════════
// Garantit le cache collection (comptages objets par artiste, mini-cartes du
// détail) sans ré-afficher la vue collection.
async function ensureCollection() {
  if (collection.length) return;
  const { data } = await sb.from('objets').select('*').eq('owner_id', tenantId).order('created_at', { ascending: false });
  collection = data ?? [];
}

// ─── Artistes : liste des fiches (table `artistes`, migration 0008) ─────────
async function loadArtistes() {
  const body = $('#artistes-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const [{ data, error }] = await Promise.all([
    sb.from('artistes').select('*').eq('owner_id', tenantId).order('nom'),
    ensureCollection(),
  ]);
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  if (!data?.length) {
    body.innerHTML = emptyHtml('Aucune fiche artiste pour l\'instant', 'Le cron les crée lors des passes d\'identification.');
    return;
  }
  const nbObjets = nom => collection.filter(o => auteurMatch(o.auteur, nom)).length;
  body.innerHTML = `<div class="grid">${data.map(a => {
    // Extrait texte brut : on démarque le markdown SANS toucher aux tirets
    // intra-mots (« hauts-de-Seine ») — seuls les tirets de puce en début de
    // ligne sont supprimés. Coupe propre à ~220 car. (pas de mot tronqué).
    const extrait = String(a.bio_md ?? '')
      .replace(/^\s*#{1,4}\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/[*`>_]/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ').trim();
    const court = extrait.length > 220 ? extrait.slice(0, 220).replace(/\s+\S*$/, '') + '…' : extrait;
    const n = nbObjets(a.nom);
    return `<article class="card" data-nom="${esc(a.nom)}">
      <div class="card-body">
        <div class="card-title">🎨 ${esc(a.nom)}</div>
        <div class="card-meta art-extrait">${esc(court)}</div>
        <div class="card-foot"><span class="price none">${n} objet${n > 1 ? 's' : ''} lié${n > 1 ? 's' : ''}</span><span class="conf-label">maj ${fmtDate(a.updated_at)}</span></div>
      </div>
    </article>`;
  }).join('')}</div>`;
  $$('.card', body).forEach(c => c.addEventListener('click', () => {
    location.hash = '#/artiste/' + encodeURIComponent(c.dataset.nom);
  }));
}

// ─── Artiste (détail) : bio complète + objets liés de la collection ─────────
async function loadArtiste(nom) {
  const body = $('#artiste-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  currentArtisteNom = nom;
  await ensureCollection();
  const { data: a, error } = await sb.from('artistes').select('*').eq('owner_id', tenantId).eq('nom', nom).maybeSingle();
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  if (collection.length && !Object.keys(photoMap).length) await loadPhotoMap();
  // Photos attachées à la fiche artiste (portrait, signature, œuvre, fiche…)
  const { data: apRows } = await sb.from('artistes_photos')
    .select('*').eq('owner_id', tenantId).eq('artiste_nom', nom).order('created_at');
  const apPaths = (apRows ?? []).flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean));
  const apUrls = await signPaths(apPaths);
  currentArtistePhotos = (apRows ?? []).map(p => ({
    ...p,
    url: apUrls[p.storage_path],
    thumbUrl: apUrls[p.thumb_path ?? p.storage_path],
  }));
  const objets = collection.filter(o => auteurMatch(o.auteur, nom));
  // Galerie « œuvres » : miniatures (thumb_path via photoMap) des objets liés,
  // en rangée scrollable sous l'en-tête — la reconnaissance visuelle d'abord.
  const oeuvres = objets.filter(o => photoMap[o.id]?.url);
  const galerie = oeuvres.length ? `
    <div class="art-gal">${oeuvres.map(o => {
      const img = photoMap[o.id];
      return `<button class="art-gal-item" data-oid="${esc(o.id)}" title="${esc(o.titre || 'Objet')} — fiche #${esc(o.id)}" aria-label="${esc(o.titre || 'Objet')} — fiche #${esc(o.id)}">
        <img src="${esc(img.url)}" alt="${esc(o.titre || 'Œuvre de la collection')}" loading="lazy" decoding="async" style="object-position:${img.fx ?? 50}% ${img.fy ?? 50}%">
      </button>`;
    }).join('')}</div>` : '';
  const photosPanel = `
    <div class="panel panel-pad">
      <div class="sec-title">Fichiers & images</div>
      ${canWrite() ? `<div class="actions" style="margin-bottom:12px"><button class="btn small" data-action="add-artiste-photo">🖼️ Ajouter une photo</button></div>` : ''}
      ${currentArtistePhotos.length ? `<div class="art-gal art-gal-files">${currentArtistePhotos.map(p => `
        <div class="art-gal-item" data-action="zoom-artiste-photo" data-pid="${esc(p.id)}" tabindex="0" role="button" title="${esc(p.kind)}${p.caption ? ' — ' + esc(p.caption) : ''}">
          <img src="${esc(p.thumbUrl || p.url)}" alt="${esc(p.kind)}" loading="lazy" decoding="async">
          ${canWrite() ? `<button class="art-gal-del" data-action="del-artiste-photo" data-pid="${esc(p.id)}" title="Supprimer">✕</button>` : ''}
        </div>
      `).join('')}</div>` : '<div class="value-sub">Aucune photo, signature ou fiche pour cet artiste.</div>'}
    </div>`;
  const bioPanel = a ? `
    <details class="panel panel-pad acc" open>
      <summary class="sec-title">Biographie</summary>
      <div class="md-body">${mdToHtml(a.bio_md ?? '')}</div>
    </details>` : `
    <div class="panel panel-pad">
      <div class="sec-title">Biographie</div>
      <div class="value-sub">Pas encore de fiche artiste — le cron la crée lors des passes d'identification.</div>
    </div>`;
  // En-tête structuré : nom + badges méta (objets liés, fraîcheur de la fiche)
  body.innerHTML = `
    <div class="art-head">
      <h1 class="obj-title">🎨 ${esc(a?.nom ?? nom)}</h1>
      <div class="art-badges">
        <span class="badge-soft">${objets.length} objet${objets.length > 1 ? 's' : ''} lié${objets.length > 1 ? 's' : ''}</span>
        ${a ? `<span class="badge-soft">Fiche maj le ${fmtDate(a.updated_at)}</span>` : ''}
      </div>
    </div>
    ${photosPanel}
    ${galerie ? `<div class="sec-title" style="margin-top:26px">Œuvres de la collection</div>${galerie}` : ''}
    ${bioPanel}
    <div class="sec-title" style="margin-top:26px">Objets de la collection <span style="font-family:var(--mono);font-size:.8125rem;color:var(--ink-3);font-weight:400">${objets.length}</span></div>
    ${objets.length
      ? `<div class="grid">${objets.map(cardHtml).join('')}</div>`
      : '<div class="value-sub">Aucun objet rattaché à cet artiste pour l\'instant.</div>'}`;
  $$('.art-gal-item[data-oid]', body).forEach(b => b.addEventListener('click', () => {
    location.hash = '#/objet/' + encodeURIComponent(b.dataset.oid);
  }));
  $$('.card', body).forEach(c => {
    const go = () => { location.hash = '#/objet/' + encodeURIComponent(c.dataset.oid); };
    c.addEventListener('click', go);
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// ─── Photos attachées à une fiche artiste (portrait, signature, œuvre, fiche) ─
async function uploadArtistePhoto(file) {
  if (!currentArtisteNom || !canWrite()) return;
  const nom = currentArtisteNom;
  // La fiche artiste doit exister pour la FK — on la crée si besoin.
  const { data: a } = await sb.from('artistes').select('nom').eq('owner_id', tenantId).eq('nom', nom).maybeSingle();
  if (!a) {
    const { error: ec } = await sb.from('artistes').insert({ owner_id: tenantId, nom, bio_md: '' });
    if (ec) { toast(`Création fiche artiste : ${ec.message}`, true); return; }
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const id = crypto.randomUUID();
  const path = `${tenantId}/artistes/${id}.${ext}`;
  const { error: e1 } = await sb.storage.from('photos').upload(path, file, { contentType: file.type || undefined });
  if (e1) { toast(`Upload : ${e1.message}`, true); return; }
  const tb = await makeThumbBlob(file);
  let thumbPath = null;
  if (tb) {
    thumbPath = `${tenantId}/artistes/${id}.thumb.jpg`;
    const { error: et } = await sb.storage.from('photos').upload(thumbPath, tb, { contentType: 'image/jpeg' });
    if (et) thumbPath = null;
  }
  const { error: e2 } = await sb.from('artistes_photos').insert({
    owner_id: tenantId,
    artiste_nom: nom,
    storage_path: path,
    thumb_path: thumbPath,
    kind: 'autre',
  });
  if (e2) { toast(e2.message, true); return; }
  logEvent('artiste_photo_ajoutee', { artiste: nom }, null);
  toast('Photo ajoutée à la fiche artiste');
  await loadArtiste(nom);
}

async function deleteArtistePhoto(pid) {
  if (!currentArtisteNom || !canWrite()) return;
  const p = currentArtistePhotos.find(x => String(x.id) === String(pid));
  if (!p) return;
  if (!confirm('Supprimer cette photo de la fiche artiste ?')) return;
  const { error } = await sb.from('artistes_photos').delete()
    .eq('owner_id', tenantId).eq('id', pid);
  if (error) { toast(error.message, true); return; }
  await sb.storage.from('photos').remove([p.storage_path, p.thumb_path].filter(Boolean));
  logEvent('artiste_photo_supprimee', { artiste: currentArtisteNom }, null);
  toast('Photo supprimée');
  await loadArtiste(currentArtisteNom);
}

$('#file-artiste-photo').addEventListener('change', async e => {
  if (!canWrite()) { e.target.value = ''; return; }
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) await uploadArtistePhoto(f);
});

// ─── Sources : cartographie des accès (miroir docs/cartographie-sources.md) ─
let sourcesCache = null;
async function loadSources() {
  const body = $('#sources-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  try {
    sourcesCache ??= await (await fetch('data/sources.json')).json();
  } catch {
    body.innerHTML = emptyHtml('Sources indisponibles', 'data/sources.json introuvable ou invalide.');
    return;
  }
  const s = sourcesCache;
  const badge = code => (code && s.legende[code])
    ? `<span class="src-badge acc-${esc(code.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" title="${esc(s.legende[code])}">${esc(code)}</span>`
    : '';
  body.innerHTML = `
    <details class="panel panel-pad acc">
      <summary class="sec-title">Légende des accès</summary>
      <div class="src-legende">${Object.entries(s.legende).map(([k, v]) =>
        `<div class="src-leg-row">${badge(k)}<span>${esc(v)}</span></div>`).join('')}</div>
    </details>
    ${(s.sections ?? []).map(sec => `
      <div class="panel panel-pad" style="margin-top:18px">
        <div class="sec-title">${esc(sec.titre)}</div>
        ${sec.intro ? `<div class="value-sub" style="margin-bottom:12px">${esc(sec.intro)}</div>` : ''}
        <table class="src-table">
          <thead><tr><th>Source</th><th>Accès</th><th>Coût</th><th>Usage</th></tr></thead>
          <tbody>${(sec.entrees ?? []).map(e => `<tr>
            <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener"><b>${esc(e.nom)}</b> ↗</a>` : `<b>${esc(e.nom)}</b>`}</td>
            <td>${badge(e.acces)}</td>
            <td>${esc(e.cout ?? '—')}</td>
            <td>${esc(e.usage ?? '')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`).join('')}`;
}

// ─── Catégories & familles : taxonomie canonique + prompts (consultation) ───
let famillesCache = null;
async function loadCategories() {
  const body = $('#categories-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  try {
    famillesCache ??= await (await fetch('data/familles.json')).json();
  } catch {
    body.innerHTML = emptyHtml('Données indisponibles', 'data/familles.json introuvable — lancer infra/build-site-data.py pour le régénérer.');
    return;
  }
  const d = famillesCache;
  body.innerHTML = `
    <div class="note" style="margin-bottom:18px">Consultation — l'édition des prompts arrivera avec le menu admin (table <code>prompts</code>).</div>
    <div class="panel panel-pad">
      <div class="sec-title">Taxonomie — ${(d.categories_canon ?? []).length} catégories canoniques</div>
      <div class="fam-list">${(d.categories_canon ?? []).map(cat => {
        const fam = d.mapping?.[cat];
        const b = fam ? d.familles?.[fam] : null;
        return `<details class="acc fam-row">
          <summary><span class="fam-emoji">${catEmoji(cat)}</span><span class="fam-cat">${esc(cat)}</span>
          ${b ? `<span class="chip fam-chip">${esc(fam)} · ${esc(b.version)}</span>` : '<span class="chip fam-chip">—</span>'}</summary>
          ${b ? `<div class="md-body fam-md">${mdToHtml(b.contenu_md)}</div>` : '<div class="fam-md value-sub">Aucun bloc famille ne couvre cette catégorie.</div>'}
        </details>`;
      }).join('')}</div>
    </div>
    <div class="panel panel-pad" style="margin-top:18px">
      <div class="sec-title">Troncs communs</div>
      <div class="fam-list">${Object.values(d.bases ?? {}).map(b => `
        <details class="acc fam-row">
          <summary><span class="fam-emoji">📐</span><span class="fam-cat">${esc(b.nom)}</span><span class="chip fam-chip">${esc(b.version)}</span></summary>
          <div class="md-body fam-md">${mdToHtml(b.contenu_md)}</div>
        </details>`).join('')}</div>
    </div>`;
}

// ─── Activité : actions manuelles + digest « quoi de neuf » (D-025) ─────────
// Enfile un job par objet en évitant les doublons : on lit d'abord les jobs
// en_attente (index unique « un seul job en_attente par objet », migration 0011)
// et on n'insère que les manquants. Insert par lot ; si un 23505 survient quand
// même (course avec le cron), repli un par un en le tolérant. Les objets
// effectivement enfilés passent en statut « en_file ».
async function enqueueJobs(oids, type) {
  const { data: pending, error: e0 } = await sb.from('jobs').select('objet_id')
    .eq('owner_id', tenantId).eq('statut', 'en_attente');
  if (e0) { toast(e0.message, true); return 0; }
  const busy = new Set((pending ?? []).map(j => j.objet_id));
  const todo = oids.filter(id => !busy.has(id));
  if (!todo.length) return 0;
  let ok = todo;
  const { error } = await sb.from('jobs').insert(todo.map(objet_id => ({ owner_id: tenantId, objet_id, type })));
  if (error) {
    if (error.code !== '23505') { toast(error.message, true); return 0; }
    ok = [];
    for (const objet_id of todo) {
      const { error: e } = await sb.from('jobs').insert({ owner_id: tenantId, objet_id, type });
      if (!e) ok.push(objet_id);
      else if (e.code !== '23505') toast(e.message, true);
    }
  }
  if (ok.length) await sb.from('objets').update({ statut: 'en_file' }).eq('owner_id', tenantId).in('id', ok);
  return ok.length;
}

async function majCatalogue() {
  if (!canWrite()) return;
  await ensureCollection();
  if (!collection.length) { toast('Aucun objet dans le catalogue', true); return; }
  if (!confirm(`Rejouer la passe complète (identification + comparables) sur les ${collection.length} objets du catalogue ?\n\nLes objets déjà en file sont ignorés. Le cron traitera ~5 objets par run de 10 min.`)) return;
  const n = await enqueueJobs(collection.map(o => o.id), 'maj');
  toast(n
    ? `${plur(n, 'objet mis', 'objets mis')} en file — le cron les traitera ~5 par run de 10 min.`
    : 'Tous les objets sont déjà en file');
}

async function majArtistes() {
  if (!canWrite()) return;
  await ensureCollection();
  const objs = collection.filter(o => o.auteur && o.auteur.trim());
  const artistes = [...new Set(objs.map(o => o.auteur))];
  if (!objs.length) { toast('Aucun objet avec un auteur renseigné', true); return; }
  if (!confirm(`Mettre à jour les fiches des ${plur(artistes.length, 'artiste', 'artistes')} (${plur(objs.length, 'objet concerné', 'objets concernés')}) ?\n\nLe cron traitera ~5 objets par run de 10 min.`)) return;
  const n = await enqueueJobs(objs.map(o => o.id), 'artiste_maj');
  toast(n
    ? `${plur(n, 'objet mis', 'objets mis')} en file (${plur(artistes.length, 'artiste', 'artistes')}) — le cron les traitera ~5 par run de 10 min.`
    : 'Ces objets sont déjà tous en file');
}

// Actions écrites par le cron (vs actions du site) — détermine le groupe du digest.
const CRON_ACTIONS = new Set(['identification', 'passe_marche', 'lens', 'artiste_maj', 'photos_manquantes']);
const SITE_PLUR = {
  capture: ['capture', 'captures'],
  photo_ajoutee: ['photo ajoutée', 'photos ajoutées'],
  photo_supprimee: ['photo supprimée', 'photos supprimées'],
  recadrage: ['recadrage', 'recadrages'],
  centrage: ['centrage', 'centrages'],
  localisation: ['localisation', 'localisations'],
  correction: ['correction', 'corrections'],
  validation: ['validation', 'validations'],
  relance: ['relance', 'relances'],
};
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);

// Phrase synthétique d'un groupe d'événements cron : compteurs par action,
// modèles / versions de prompt distincts, comparables cumulés, sources distinctes.
function resumeCron(list) {
  const by = a => list.filter(e => e.action === a);
  const uniq = arr => [...new Set(arr.filter(Boolean))];
  const parts = [];
  const ids = by('identification');
  if (ids.length) {
    const modeles = uniq(ids.map(e => e.detail?.modele));
    const prompts = uniq(ids.map(e => e.detail?.prompt_version));
    const meta = [modeles.join(', '), prompts.length ? 'prompts ' + prompts.join(', ') : ''].filter(Boolean).join(' · ');
    parts.push(plur(ids.length, 'identification', 'identifications') + (meta ? ` (${meta})` : ''));
  }
  const pm = by('passe_marche');
  if (pm.length) {
    const comps = pm.reduce((s, e) => s + (Number(e.detail?.comps) || 0), 0);
    const srcs = uniq(pm.flatMap(e => Array.isArray(e.detail?.sources) ? e.detail.sources : []));
    const meta = [comps ? plur(comps, 'comparable trouvé', 'comparables trouvés') : '', srcs.join(', ')].filter(Boolean).join(' · ');
    parts.push(plur(pm.length, 'passe marché', 'passes marché') + (meta ? ` (${meta})` : ''));
  }
  const am = by('artiste_maj');
  if (am.length) parts.push(plur(am.length, 'fiche artiste mise à jour', 'fiches artistes mises à jour'));
  const lens = by('lens');
  if (lens.length) parts.push(plur(lens.length, 'analyse Lens (signature)', 'analyses Lens (signatures)'));
  const ph = by('photos_manquantes');
  if (ph.length) parts.push(plur(ph.length, 'recommandation photos', 'recommandations photos'));
  return parts.join(', ');
}

// Phrase synthétique d'un groupe d'événements site : compteurs par action +
// acteurs distincts entre parenthèses (« 1 correction (Yann) »).
function resumeSite(list) {
  const counts = new Map();
  for (const e of list) {
    const c = counts.get(e.action) ?? { n: 0, acteurs: new Set() };
    c.n++;
    if (e.acteur && e.acteur !== 'site') c.acteurs.add(capFirst(e.acteur));
    counts.set(e.action, c);
  }
  return [...counts].map(([a, c]) => {
    const [s, p] = SITE_PLUR[a] ?? [ACT_LABELS[a] ?? a, (ACT_LABELS[a] ?? a) + 's'];
    return plur(c.n, s, p) + (c.acteurs.size ? ` (${[...c.acteurs].join(', ')})` : '');
  }).join(', ');
}

// Ligne unitaire du digest : heure, action, acteur, objet (lien fiche) + détail.
function evRowActivite(ev, titres) {
  const h = new Date(ev.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const obj = ev.objet_id
    ? `<a class="link-lot" href="#/objet/${encodeURIComponent(ev.objet_id)}">#${esc(ev.objet_id)}${titres[ev.objet_id] ? ' ' + esc(titres[ev.objet_id]) : ''}</a>`
    : '';
  return `<div class="ev-row">
    <span class="ev-date">${h}</span>
    <span class="ev-act">${esc(ACT_LABELS[ev.action] ?? ev.action)}</span>
    <span class="ev-qui">${esc(ev.acteur ?? '')}</span>
    <span class="ev-det">${[obj, ...evDetailBits(ev.detail ?? {})].filter(Boolean).join(' · ')}</span>
  </div>`;
}

async function loadActivite() {
  const body = $('#activite-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const depuis = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: evts, error }] = await Promise.all([
    sb.from('evenements').select('id,objet_id,created_at,acteur,action,detail')
      .eq('owner_id', tenantId).gte('created_at', depuis)
      .order('created_at', { ascending: false }).limit(500),
    ensureCollection(),
  ]);
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  // Titres d'objets : cache collection d'abord, appoint pour les absents.
  const titres = Object.fromEntries(collection.map(o => [o.id, o.titre]));
  const manquants = [...new Set((evts ?? []).map(e => e.objet_id).filter(id => id && !(id in titres)))];
  if (manquants.length) {
    const { data: plus } = await sb.from('objets').select('id,titre').eq('owner_id', tenantId).in('id', manquants);
    for (const o of plus ?? []) titres[o.id] = o.titre;
  }

  const actionsPanel = `
    <div class="panel panel-pad hide-lecteur">
      <div class="sec-title">Actions</div>
      <div class="value-sub">Forcer des passes IA sans attendre le rythme du cron — les objets déjà en file sont ignorés.</div>
      <div class="actions" style="margin-top:12px">
        <button class="btn primary" id="act-maj-catalogue">↻ MAJ générale du catalogue</button>
        <button class="btn" id="act-maj-artistes">🎨 MAJ des fiches artistes</button>
      </div>
    </div>
    <div class="sec-title" style="margin-top:28px">Quoi de neuf — 30 derniers jours</div>`;

  if (!evts?.length) {
    body.innerHTML = actionsPanel
      + emptyHtml('Rien à signaler sur 30 jours', 'Les runs du cron et les actions du site apparaîtront ici, digérés par jour.');
  } else {
    // Groupement par jour (ordre desc conservé) puis par type d'activité.
    const jours = new Map();
    for (const ev of evts) {
      const d = new Date(ev.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!jours.has(key)) {
        jours.set(key, {
          label: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          list: [],
        });
      }
      jours.get(key).list.push(ev);
    }
    const digRow = (titre, resume, list) => `
      <details class="acc dig-row">
        <summary><span class="dig-sum"><b>${esc(titre)}</b> — ${esc(resume)}</span><span class="chip dig-count">${list.length}</span></summary>
        <div class="ev-list">${list.map(e => evRowActivite(e, titres)).join('')}</div>
      </details>`;
    body.innerHTML = actionsPanel + [...jours.values()].map(({ label, list }) => {
      const cron = list.filter(e => CRON_ACTIONS.has(e.action));
      const site = list.filter(e => !CRON_ACTIONS.has(e.action));
      const rows = [];
      if (cron.length) rows.push(digRow('Run cron', resumeCron(cron), cron));
      if (site.length) rows.push(digRow('Site', resumeSite(site), site));
      return `<div class="dig-day">${esc(label)}</div><div class="panel dig-panel">${rows.join('')}</div>`;
    }).join('');
  }
  $('#act-maj-catalogue').addEventListener('click', majCatalogue);
  $('#act-maj-artistes').addEventListener('click', majArtistes);
}

// ─── Maison : nom, membres, rôles (owner + admin — menu déjà filtré) ────────
// Gestion de la maison courante. Un admin a exactement les mêmes droits
// qu'un owner : inviter, changer les rôles, retirer des membres, renommer.
// Un lecteur voit tout mais ne peut rien modifier (RLS 0012 + UI en lecture seule).
async function loadMaison() {
  const body = $('#maison-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const [{ data: t }, { data: membres, error }] = await Promise.all([
    sb.from('tenants').select('name').eq('owner_id', tenantId).maybeSingle(),
    sb.from('collection_members').select('member_id,role,created_at').eq('owner_id', tenantId).order('created_at'),
  ]);
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  // Noms affichés : profiles lisible entre membres d'une maison (policy 0012).
  const ids = (membres ?? []).map(m => m.member_id);
  const { data: profs } = ids.length
    ? await sb.from('profiles').select('id,display_name').in('id', ids)
    : { data: [] };
  const nomDe = id => (profs ?? []).find(p => p.id === id)?.display_name || `membre ${id.slice(0, 8)}…`;
  const rows = (membres ?? []).map(m => `
    <div class="mbr-row" data-mid="${esc(m.member_id)}">
      <span class="mbr-name">${esc(nomDe(m.member_id))}</span>
      <select class="select mbr-role">
        <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>admin</option>
        <option value="lecteur" ${m.role === 'lecteur' ? 'selected' : ''}>lecteur</option>
      </select>
      <button class="btn small danger mbr-del">Retirer</button>
    </div>`).join('');
  body.innerHTML = `
    <div class="panel panel-pad">
      <div class="sec-title">Nom de la maison</div>
      <div class="value-sub">Affiché dans l'en-tête et dans le switcher du menu.</div>
      <div class="mbr-form" style="margin-top:12px">
        <input id="maison-name" value="${esc(t?.name ?? '')}" placeholder="PONAIRE…">
        <button class="btn primary" id="maison-rename">Renommer</button>
      </div>
    </div>
    <div class="panel panel-pad" style="margin-top:18px">
      <div class="sec-title">Membres <span style="font-family:var(--mono);font-size:13px;color:var(--ink-3);font-weight:400">${(membres ?? []).length}</span></div>
      <div class="note">Un <b>admin</b> peut tout modifier (catalogue, membres, nom de la maison). Un <b>lecteur</b> voit tout le catalogue mais ne peut rien modifier.</div>
      <div class="mbr-list">${rows || '<div class="value-sub">Aucun membre pour l\'instant — invite le premier ci-dessous.</div>'}</div>
    </div>
    <div class="panel panel-pad" style="margin-top:18px">
      <div class="sec-title">Inviter un membre</div>
      <div class="value-sub">Le compte doit déjà exister (créé au premier magic link).</div>
      <div class="mbr-form" style="margin-top:12px">
        <input type="email" id="invite-email" placeholder="email@exemple.fr" autocomplete="off">
        <select class="select" id="invite-role">
          <option value="admin">admin</option>
          <option value="lecteur">lecteur</option>
        </select>
        <button class="btn primary" id="invite-btn">Inviter</button>
      </div>
      <div id="invite-msg" style="margin-top:10px"></div>
    </div>`;

  $('#maison-rename').addEventListener('click', async () => {
    const name = $('#maison-name').value.trim();
    if (!name) { toast('Nom vide', true); return; }
    const { error: e } = await sb.from('tenants').upsert({ owner_id: tenantId, name });
    if (e) { toast(e.message, true); return; }
    const mienne = mesTenants.find(x => x.id === tenantId);
    if (mienne) mienne.name = name;
    tenantName = name;
    renderMenu();
    loadHeader();
    toast(`✓ Maison renommée « ${name} »`);
  });

  $$('.mbr-row', body).forEach(row => {
    const mid = row.dataset.mid;
    const sel = $('.mbr-role', row);
    sel.addEventListener('change', async () => {
      const nv = sel.value;
      if (!confirm(`Passer ${nomDe(mid)} en rôle « ${nv} » ?`)) { loadMaison(); return; }
      const { error: e } = await sb.from('collection_members').update({ role: nv })
        .eq('owner_id', tenantId).eq('member_id', mid);
      if (e) { toast(e.message, true); loadMaison(); return; }
      toast(`✓ ${nomDe(mid)} est maintenant ${nv}`);
    });
    $('.mbr-del', row).addEventListener('click', async () => {
      if (!confirm(`Retirer ${nomDe(mid)} de la maison ?\nIl ne verra plus le catalogue.`)) return;
      const { error: e } = await sb.from('collection_members').delete()
        .eq('owner_id', tenantId).eq('member_id', mid);
      if (e) { toast(e.message, true); return; }
      toast(`${nomDe(mid)} retiré de la maison`);
      loadMaison();
    });
  });

  $('#invite-btn').addEventListener('click', async () => {
    const email = $('#invite-email').value.trim();
    const role = $('#invite-role').value;
    const msg = $('#invite-msg');
    if (!email) { $('#invite-email').focus(); return; }
    const { data, error: e } = await sb.rpc('invite_member', { p_email: email, p_role: role, p_owner: tenantId });
    if (e) {
      // Message métier de la RPC (ex. « compte inexistant ») affiché proprement.
      msg.innerHTML = `<div class="login-err">${esc(e.message)}</div>`;
      return;
    }
    msg.innerHTML = `<div class="login-ok">✓ ${esc(email)} : ${esc(data ?? 'ajouté')} (${esc(role)}).</div>`;
    toast(`✓ ${email} ${data ?? 'ajouté'}`);
    loadMaison();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VUE CAPTURER
// ═══════════════════════════════════════════════════════════════════════════
// ─── Web Share Target (D-013) : photos reçues via « Partager avec » Android ─
// Le SW (sw.js) stocke les images du POST share-target dans le cache
// 'share-inbox' et redirige vers ./?partage=1#/capture — ici on reconstruit
// des File et on alimente la capture en cours. iOS Safari ne supporte pas
// l'API (limite admise) : le flag n'apparaît alors jamais.
function consumeShareFlag() {
  const inSearch = /[?&]partage=1/.test(location.search);
  const inHash = /[?&]partage=1/.test(location.hash);
  if (!inSearch && !inHash) return false;
  const search = location.search.replace(/([?&])partage=1&?/, '$1').replace(/[?&]$/, '');
  history.replaceState(null, '', location.pathname + search + (inHash ? '#/capture' : location.hash));
  return true;
}
async function receiveSharedPhotos() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('share-inbox');
    const keys = await cache.keys();
    const files = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.blob();
      files.push(new File([blob],
        res.headers.get('x-name') || 'partage.jpg',
        { type: res.headers.get('x-type') || blob.type || 'image/jpeg' }));
    }
    await caches.delete('share-inbox'); // inbox consommée : on vide pour le prochain partage
    if (files.length) {
      addCapFiles(files);
      toast(`${plur(files.length, 'photo reçue', 'photos reçues')} par partage`);
    }
  } catch (err) {
    console.warn('share-inbox :', err);
  }
}

async function initCapture() {
  // NE PAS vider capFiles ici (audit 2026-08-24) : naviguer Capturer → Collection →
  // Capturer ne doit pas perdre les clichés non enregistrés. capFiles n'est vidé
  // qu'après un enregistrement réussi (cap-save).
  renderPreviews();
  $('#cap-num').value = '…';
  const [{ data: next }, { data: lieux }] = await Promise.all([
    sb.rpc('peek_objet_id', { p_owner: tenantId }),
    sb.from('objets').select('zone,contenant').eq('owner_id', tenantId),
  ]);
  $('#cap-num').value = next ?? '';
  const zones = [...new Set((lieux ?? []).map(r => r.zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const conts = [...new Set((lieux ?? []).map(r => r.contenant).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('#zones').innerHTML = zones.map(z => `<option>${esc(z)}</option>`).join('');
  $('#contenants').innerHTML = conts.map(z => `<option>${esc(z)}</option>`).join('');
}

function addCapFiles(fileList) {
  for (const f of fileList) capFiles.push(f);
  renderPreviews();
}
// Les clichés attendent dans capFiles tant que « Enregistrer l'objet » n'est pas cliqué :
// on prévient avant tout rechargement/fermeture qui les perdrait silencieusement.
window.addEventListener('beforeunload', e => {
  if (capFiles.length) { e.preventDefault(); e.returnValue = ''; }
});
let pvUrls = [];
function renderPreviews() {
  const box = $('#previews');
  pvUrls.forEach(u => URL.revokeObjectURL(u));
  pvUrls = [];
  box.innerHTML = '';
  capFiles.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'pv';
    if (/^image\//.test(f.type)) {
      const img = document.createElement('img');
      const u = URL.createObjectURL(f);
      pvUrls.push(u);
      img.src = u;
      d.append(img);
    } else {
      d.style.display = 'grid';
      d.style.placeItems = 'center';
      d.style.fontSize = '26px';
      d.textContent = '🎬';
    }
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'Retirer';
    x.addEventListener('click', () => { capFiles.splice(i, 1); renderPreviews(); });
    d.append(x);
    box.append(d);
  });
}

const dz = $('#dropzone');
dz.addEventListener('click', () => $('#file-gallery').click());
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('over');
  addCapFiles(e.dataTransfer.files);
});
// ─── Caméra en direct (getUserMedia) ────────────────────────────────────────
// L'input capture="environment" passe la main à l'app photo du téléphone : sur
// Android le navigateur est souvent tué en arrière-plan pendant le cliché → la
// page se recharge et la photo se perd (« rien n'arrive »). Le flux getUserMedia
// garde la page au premier plan : plus de handoff, et ça marche aussi sur PC
// (webcam). Fallback : l'input fichier si la caméra est indisponible/refusée.
let camStream = null;
let camTarget = 'capture'; // 'capture' → capFiles (nouvel objet) · 'objet' → upload direct sur currentObjet
let camUploaded = 0;       // nb de clichés uploadés en mode 'objet' (pour recharger la fiche à la fermeture)
async function openCamera(target = 'capture') {
  camTarget = target;
  const fallback = () => (target === 'objet' ? $('#file-add-photo') : $('#file-camera')).click();
  if (!navigator.mediaDevices?.getUserMedia) { fallback(); return; }
  try {
    // Résolution raisonnable : un flux pleine résolution (3000×3000) gonfle la mémoire
    // (canvas ≈ 36 Mo par cliché) → l'onglet peut être tué sur mobile = photos perdues.
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 2048 }, height: { ideal: 2048 } },
      audio: false,
    });
  } catch (err) {
    toast(`Caméra indisponible (${err.name}) — sélecteur de fichiers à la place`);
    fallback();
    return;
  }
  $('#camera-video').srcObject = camStream;
  $('#camera-modal').classList.remove('hidden');
  document.body.classList.add('cam-open'); // toasts remontés en haut (sinon masqués par l'obturateur)
}
function closeCamera() {
  camStream?.getTracks().forEach(t => t.stop());
  camStream = null;
  $('#camera-video').srcObject = null;
  $('#camera-modal').classList.add('hidden');
  document.body.classList.remove('cam-open');
  // Mode fiche objet : les clichés ont été uploadés au fil de l'eau → on relance
  // l'analyse si besoin (même règle que l'ajout par fichier) et on recharge la fiche.
  if (camTarget === 'objet' && currentObjet && camUploaded > 0) {
    const oid = currentObjet.id;
    if (['capture', 'a_completer'].includes(currentObjet.statut)) queueAnalyse(oid);
    loadObjet(oid);
  }
  camTarget = 'capture';
  camUploaded = 0;
}
$('#btn-camera').addEventListener('click', () => openCamera('capture'));
$('#camera-close').addEventListener('click', closeCamera);
$('#camera-shot').addEventListener('click', () => {
  const v = $('#camera-video');
  if (!v.videoWidth) { toast('Flux caméra pas encore prêt — réessaie', true); return; }
  // Plafond 2048 px : largement assez pour l'identification IA, et évite les crashs
  // mémoire mobile (chaque cliché reste en RAM jusqu'à l'enregistrement).
  const MAX = 2048;
  const scale = Math.min(1, MAX / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  c.toBlob(async b => {
    if (!b) { toast('Capture impossible', true); return; }
    const file = new File([b], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    if (camTarget === 'objet' && currentObjet) {
      const n = await uploadPhotosFor(currentObjet.id, [file]);
      if (n > 0) { camUploaded += n; logEvent('photo_ajoutee', { n, via: 'camera' }); toast('Photo ajoutée à la fiche — tu peux enchaîner ou Terminer'); }
    } else {
      addCapFiles([file]);
      toast('Photo ajoutée — enchaîne ou « Enregistrer l\'objet »');
    }
  }, 'image/jpeg', 0.85);
});
$('#btn-gallery').addEventListener('click', () => $('#file-gallery').click());
$('#file-camera').addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });
$('#file-gallery').addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });

$$('input[name="cap-mode"]').forEach(r => r.addEventListener('change', () => {
  $('#cap-save').textContent = r.value === 'batch' ? 'Enregistrer les objets' : 'Enregistrer l\'objet';
}));

$('#cap-save').addEventListener('click', async () => {
  if (!canWrite()) return;
  const mode = $('input[name="cap-mode"]:checked')?.value || 'single';
  const btn = $('#cap-save');
  const zone = $('#cap-zone').value.trim() || null;
  const contenant = $('#cap-contenant').value.trim() || null;
  btn.disabled = true;
  btn.textContent = mode === 'batch' ? 'Enregistrement des objets…' : 'Enregistrement…';
  try {
    if (mode === 'batch') {
      if (!capFiles.length) { toast('Aucune photo à enregistrer', true); return; }
      let ok = 0, fails = 0;
      const ids = [];
      const files = [...capFiles];
      for (const f of files) {
        const { data: newId, error: e0 } = await sb.rpc('next_objet_id', { p_owner: tenantId });
        if (e0 || !newId) { fails++; continue; }
        const { error: e1 } = await sb.from('objets').insert({
          owner_id: tenantId, id: newId, statut: 'en_file', zone, contenant, source_capture: 'site',
        });
        if (e1) { fails++; continue; }
        logEvent('capture', { n: 1, zone }, newId);
        const n = await uploadPhotosFor(newId, [f], true);
        if (n > 0) {
          await queueAnalyse(newId);
        } else {
          await sb.from('objets').update({ statut: 'a_completer' }).eq('owner_id', tenantId).eq('id', newId);
        }
        ids.push(newId); ok++;
      }
      capFiles = [];
      renderPreviews();
      toast(`${ok} objet${ok > 1 ? 's' : ''} créé${ok > 1 ? 's' : ''}${fails ? ` (${fails} échec)` : ''}`);
      loadHeader();
      if (ids.length) location.hash = '#/objet/' + encodeURIComponent(ids[0]);
      return;
    }
    const { data: newId, error: e0 } = await sb.rpc('next_objet_id', { p_owner: tenantId });
    if (e0 || !newId) throw (e0 ?? new Error('numérotation impossible'));
    const avecPhotos = capFiles.length > 0;
    const { error: e1 } = await sb.from('objets').insert({
      owner_id: tenantId,
      id: newId,
      statut: avecPhotos ? 'en_file' : 'a_completer',
      zone,
      contenant,
      source_capture: 'site',
    });
    if (e1) throw e1;
    logEvent('capture', { n: capFiles.length, zone }, newId);
    if (avecPhotos) {
      const n = await uploadPhotosFor(newId, capFiles, true);
      if (n > 0) {
        await queueAnalyse(newId);
      } else {
        await sb.from('objets').update({ statut: 'a_completer' }).eq('owner_id', tenantId).eq('id', newId);
      }
    }
    capFiles = [];
    renderPreviews();
    toast(`Objet #${newId} enregistré${avecPhotos ? ' — analyse en file' : ''}`);
    loadHeader();
    location.hash = '#/objet/' + encodeURIComponent(newId);
  } catch (err) {
    toast(err.message ?? String(err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = mode === 'batch' ? 'Enregistrer les objets' : 'Enregistrer l\'objet';
  }
});
