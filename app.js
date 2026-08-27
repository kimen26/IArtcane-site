// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — app.js : SHELL (D-039, architecture modulaire par vue)
// Boot, service worker, auth magic link, locataire/rôle, en-tête, menu
// gouvernance, routeur à lazy imports. Les écrans vivent dans js/views/*,
// le partagé dans js/core/* — ce fichier est TRANSVERSAL (gelé hors handoff dédié).
// Règle d'or affichée : jamais un chiffre sans comparables vendus.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast } from './js/core/dom.js';
import { S, canWrite } from './js/core/state.js';
import { fmtNum } from './js/core/format.js';
import { sb } from './js/core/data.js';

// ─── Service worker (D-013) : shell offline + réception « Partager avec » ───
// http(s) uniquement (pas de SW en file://) ; échec silencieux — l'app marche sans.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════
sb.auth.onAuthStateChange((event, session) => {
  S.user = session?.user ?? null;
  // Ne rejouer enterApp() qu'à la connexion — TOKEN_REFRESHED (~1×/h) ne doit pas
  // recharger toute la vue (audit 2026-08-24).
  if (S.user) { if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') enterApp(); }
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

// ─── Realtime (G-3, D-019) : la R1 et les fiches arrivent en direct ────
// Un UPDATE objets du locataire → toast + rafraîchissement de la vue courante.
// replica identity full (migration 0005) → payload.old permet de ne notifier
// que les vraies nouveautés (identification qui apparaît, fiche qui devient prête).
let liveOn = false;
function watchLive() {
  if (liveOn || !S.tenantId) return;
  liveOn = true;
  sb.channel('objets-live')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'objets', filter: `owner_id=eq.${S.tenantId}` }, p => {
      const n = p.new, old = p.old ?? {};
      // JAMAIS de rechargement automatique de la vue (règle Yann 2026-08-23 :
      // refresh sur action ou manuel uniquement) — on notifie, point.
      if (!old.categorie && n.categorie) {
        toast(`🔎 #${n.id} identifié par l'IA : « ${n.titre ?? n.categorie} » (R1 — recharge pour voir)`);
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
  const { data: membres } = await sb.from('collection_members').select('owner_id,role').eq('member_id', S.user.id);
  const ids = [S.user.id, ...(membres ?? []).map(m => m.owner_id)];
  const { data: noms } = await sb.from('tenants').select('owner_id,name,couleur').in('owner_id', ids);
  const ligneDe = id => (noms ?? []).find(t => t.owner_id === id);
  S.mesTenants = [
    { id: S.user.id, name: ligneDe(S.user.id)?.name ?? '', couleur: ligneDe(S.user.id)?.couleur ?? null, role: 'owner' },
    ...(membres ?? []).map(m => ({ id: m.owner_id, name: ligneDe(m.owner_id)?.name ?? '', couleur: ligneDe(m.owner_id)?.couleur ?? null, role: m.role })),
  ];
  // Choix persisté si encore valide, sinon la 1re membership (comportement D-015 :
  // un membre/lecteur tombe sur la maison partagée, pas sur sa collection vide),
  // sinon sa propre maison.
  const pref = localStorage.getItem('iartcane-tenant');
  const courant = S.mesTenants.find(t => t.id === pref)
    ?? S.mesTenants.find(t => t.role !== 'owner')
    ?? S.mesTenants[0];
  S.tenantId = courant.id;
  S.tenantRole = courant.role;
  S.tenantName = courant.name;
  applyRuban(courant);
  applyRole();
}

// Couleur du ruban d'estimation, choisie par maison (HO-041) : couleur NULL →
// chaîne vide = la propriété est retirée, le fallback CSS #35696c reprend.
function applyRuban(t) {
  document.documentElement.style.setProperty('--ruban', t?.couleur || '');
}

// Bascule sur une autre maison (switcher du menu) : persiste le choix et
// recharge l'en-tête + la collection.
function selectTenant(id) {
  const t = S.mesTenants.find(x => x.id === id);
  if (!t || t.id === S.tenantId) return;
  localStorage.setItem('iartcane-tenant', t.id);
  S.tenantId = t.id;
  S.tenantRole = t.role;
  S.tenantName = t.name;
  applyRuban(t);
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
  const { data } = await sb.from('profiles').select('display_name').eq('id', S.user.id).maybeSingle();
  profileName = data?.display_name || S.user.email || '?';
  renderMenu();
}

async function loadHeader() {
  const [{ count }, { data: next }] = await Promise.all([
    sb.from('objets').select('*', { count: 'exact', head: true }).eq('owner_id', S.tenantId),
    sb.rpc('peek_objet_id', { p_owner: S.tenantId }),
  ]);
  const n = count ?? 0;
  const label = S.tenantName ? `${esc(S.tenantName)} · ` : (S.tenantId !== S.user.id ? 'catalogue partagé · ' : '');
  const badgeRO = canWrite() ? '' : '<span class="badge-ro">lecture seule</span>';
  $('#header-counter').innerHTML = `${label}<b>${fmtNum(n)}</b> objet${n > 1 ? 's' : ''} · prochain n° <b>${next ?? '—'}</b> ${badgeRO}`;
  $('#tab-count').textContent = n;
}

// Hooks transverses : les vues rafraîchissent en-tête/menu sans importer le shell.
S.refreshHeader = () => loadHeader();
S.refreshMenu = () => renderMenu();

// ═══════════════════════════════════════════════════════════════════════════
// ROUTEUR (hash) — lazy import des vues (D-039)
// ═══════════════════════════════════════════════════════════════════════════
function setTab(name) {
  $$('.tab').forEach(t => {
    const active = t.dataset.view === name;
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
}

// ─── Menu « gouvernance » de l'en-tête (D-028) ──────────────────────────────
// Zones transverses de l'app. Ajouter une entrée = une ligne ici + une route
// dans ROUTES + une <section class="view"> dans index.html + un module js/views/.
// `owner: true` → entrée réservée aux admins (owner + membre admin).
const MENU_GOUV = [
  { hash: '#/maison',     icone: '🏠', label: 'Maison',                desc: 'Membres, rôles, nom de la maison', owner: true },
  { hash: '#/activite',   icone: '📋', label: 'Activité',              desc: 'Quoi de neuf : runs IA, mises à jour, actions — et MAJ forcées du catalogue' },
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
      ${S.user?.email && S.user.email !== profileName ? `<span class="menu-user-mail">${esc(S.user.email)}</span>` : ''}
    </div>
    <button class="menu-item" data-action="logout"><span class="menu-ico">⎋</span><span><span class="menu-label">Se déconnecter</span><span class="menu-desc">La collection reste synchronisée — reconnexion par lien magique</span></span></button>
    <div class="menu-sep"></div>`;
  const switcher = S.mesTenants.length > 1 ? `
    <div class="menu-sec">Maison</div>
    ${S.mesTenants.map(t => `<button class="menu-item menu-tenant ${t.id === S.tenantId ? 'current' : ''}" data-tenant="${esc(t.id)}">
      <span class="menu-ico">${t.id === S.tenantId ? '✓' : ''}</span>
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

// Registre des routes : ajouter un écran = 1 entrée ici + 1 module js/views/
// (export `mount`, ou le nom donné via fn) + 1 <section class="view">.
// `write: true` → écran réservé aux rôles qui écrivent (lecteur redirigé).
const ROUTES = [
  { re: /^#\/capture/,            tab: 'capture',    view: 'capture',    write: true, load: () => import('./js/views/capture.js') },
  { re: /^#\/objet\/([^/]+)$/,    tab: 'collection', view: 'objet',      load: () => import('./js/views/objet/index.js') },
  { re: /^#\/maison/,             view: 'maison',    write: true,        load: () => import('./js/views/maison.js') },
  { re: /^#\/activite/,           view: 'activite',  load: () => import('./js/views/activite.js') },
  { re: /^#\/artiste\/([^/]+)$/,  tab: 'artistes',  view: 'artiste',   load: () => import('./js/views/artistes.js'), fn: 'mountDetail' },
  { re: /^#\/artistes/,           tab: 'artistes',  view: 'artistes',  load: () => import('./js/views/artistes.js'), fn: 'mountList' },
  { re: /^#\/sources/,            view: 'sources',   load: () => import('./js/views/sources.js') },
  { re: /^#\/categories/,         view: 'categories', load: () => import('./js/views/categories.js') },
];

async function route() {
  if (!S.user || !S.tenantId) return; // !tenantId : arrivée magic link — le hashchange de nettoyage
  // de l'URL d'auth tire route() pendant resolveTenant() → requêtes avec owner_id null (22P02)
  closeMenu();
  const h = location.hash || '#/';
  const r = ROUTES.find(x => x.re.test(h));
  // Le module est chargé AVANT d'afficher l'écran : chaque vue attend son propre
  // CSS (core/css.js) au chargement du module, donc on n'affiche jamais une vue
  // nue le temps que la feuille arrive (D-041).
  if (!r) {
    const m = await import('./js/views/collection.js');
    setTab('collection'); show('collection');
    m.mount();
    prevView = currentView;
    currentView = { view: 'collection', tab: 'collection', hash: '#/', label: 'Collection', params: [] };
    updateBackButtons();
    return;
  }
  // Gardes d'écriture : capture et maison interdites au lecteur (RLS 0012, UI masquée)
  if (r.write && !canWrite()) { location.replace('#/'); return; }
  const meta = computeViewMeta(r, h);
  const m = await r.load();
  setTab(r.tab ?? null); // écrans gouvernance : pas des onglets → aucun tab actif
  show(r.view);
  m[r.fn ?? 'mount'](...meta.params);
  prevView = currentView;
  currentView = meta;
  updateBackButtons();
}
window.addEventListener('hashchange', route);
// data-view → hash : ajouter un onglet = une entrée ici + la route ci-dessus.
const TAB_HASH = { collection: '#/', capture: '#/capture', artistes: '#/artistes' };
$$('.tab').forEach(t => t.addEventListener('click', () => { location.hash = TAB_HASH[t.dataset.view] ?? '#/'; }));
$('#logo-home').addEventListener('click', () => { location.hash = '#/'; });
$('#obj-back').addEventListener('click', () => { location.hash = prevView?.hash ?? '#/'; });
$$('.js-back').forEach(b => b.addEventListener('click', () => { location.hash = prevView?.hash ?? '#/'; }));

// ─── Fil d'Ariane contextuel (HO-025) ───────────────────────────────────────
// Mémoire d'une seule vue source : le retour ramène d'où l'on vient, avec
// fallback Collection sur entrée directe ou lien partagé.
let currentView = null;
let prevView = null;

function viewLabel(view, params = []) {
  switch (view) {
    case 'collection': return 'Collection';
    case 'capture':    return 'Capturer';
    case 'artistes':   return 'Artistes';
    case 'artiste':    return params[0] || 'Artiste';
    case 'objet':      return 'Objet';
    case 'maison':     return 'Maison';
    case 'activite':   return 'Activité';
    case 'sources':    return 'Sources';
    case 'categories': return 'Catégories & familles';
    default:           return 'Collection';
  }
}

function updateBackButtons() {
  const label = '← ' + (prevView?.label ?? 'Collection');
  $('#obj-back').textContent = label;
  $$('.js-back').forEach(b => b.textContent = label);
}

function computeViewMeta(r, h) {
  const params = (h.match(r.re) ?? []).slice(1).map(decodeURIComponent);
  return {
    view: r.view,
    tab: r.tab ?? null,
    hash: h,
    label: viewLabel(r.view, params),
    params,
  };
}
