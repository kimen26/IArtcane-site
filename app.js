// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — app.js : SHELL (D-039, architecture modulaire par vue)
// Boot, service worker, auth magic link, locataire/rôle, en-tête, menu
// gouvernance, routeur à lazy imports. Les écrans vivent dans js/views/*,
// le partagé dans js/core/* — ce fichier est TRANSVERSAL (gelé hors handoff dédié).
// Règle d'or affichée : jamais un chiffre sans comparables vendus.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast } from './js/core/dom.js';
import { S, canWrite } from './js/core/state.js';
import { catCanon, catEmoji } from './js/core/format.js';
import { sb } from './js/core/data.js';
import { withBusy } from './js/core/feedback.js';
import { viewLabel } from './js/core/nav.js';

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
  // Ligne de titre/recherche + loupe/entonnoir = outils propres à la collection (HO-042) ;
  // la bulle « écrire à l'admin » (#header-actions), elle, reste visible sur toute vue (D-072).
  const isColl = view === 'collection';
  $('#page-subhead').classList.toggle('hidden', !isColl);
  $('#header-actions').classList.toggle('hidden', !S.user);
  ['#btn-search-toggle', '#btn-filters'].forEach(sel => $(sel).classList.toggle('hidden', !isColl));
  window.scrollTo({ top: 0 });
}
function showLogin() {
  $('#menu-gov').classList.add('hidden');
  $('#header-actions').classList.add('hidden');
  $('#page-subhead').classList.add('hidden');
  document.body.classList.remove('role-lecteur');
  // Réarmer le realtime : à la prochaine connexion (autre tenant possible),
  // watchLive() doit recréer le canal avec le bon filtre owner_id.
  if (liveOn) { sb.removeAllChannels(); liveOn = false; }
  show('login');
}
async function enterApp() {
  $('#menu-gov').classList.remove('hidden');
  await resolveTenant();
  renderMenu();
  await Promise.all([loadHeader(), loadProfile(), S.refreshDemandes()]);
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
      } else if (old.statut !== 'analyse' && n.statut === 'analyse') {
        toast(`✨ #${n.id} analysé (R2) — recharge la page pour voir`);
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
  S.refreshDemandes();
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
  const { valeur: error } = await withBusy(() => sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: location.origin + location.pathname },
  }).then(r => r.error), { titre: 'Envoi du lien de connexion…', annulable: false });
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
  const [{ count }, { count: nArtistes }] = await Promise.all([
    sb.from('objets').select('*', { count: 'exact', head: true }).eq('owner_id', S.tenantId),
    sb.from('artistes').select('*', { count: 'exact', head: true }).eq('owner_id', S.tenantId),
  ]);
  S.objetsCount = count ?? 0;
  S.artistesCount = nArtistes ?? 0;
  renderMenu(); // le tiroir affiche les comptes (HO-042)
}

// Hooks transverses : les vues rafraîchissent en-tête/menu sans importer le shell.
S.refreshHeader = () => loadHeader();
S.refreshMenu = () => renderMenu();
S.refreshDemandes = async () => { await (await import('./js/views/demandes.js')).refreshCompteur(); renderMenu(); }; // D-072

// ═══════════════════════════════════════════════════════════════════════════
// ROUTEUR (hash) — lazy import des vues (D-039)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tiroir de navigation (HO-042, design handoff étape 2) ──────────────────
// Remplace le menu déroulant ☰ (D-028) : panneau glissant 280px — frise
// d'avancement, CTA capture, entrées Maison/Artistes/Collection (+ rayons en
// second niveau), pied Activité/Sources/Catégories, profil + déconnexion.
const MENU_GOUV = [
  { hash: '#/activite',   label: 'Activité' },
  { hash: '#/sources',    label: 'Sources' },
  { hash: '#/categories', label: 'Catégories & familles' },
  { hash: '#/demandes',   label: 'Demandes' },
];
const drawerEl = () => $('#menu-panel');
const veilEl = () => $('#drawer-veil');
function openMenu() {
  renderMenu(); // contenu frais (comptes, frise) à chaque ouverture
  drawerEl().classList.add('open');
  veilEl().classList.add('open');
  $('#menu-btn').setAttribute('aria-expanded', 'true');
}
function closeMenu() {
  drawerEl().classList.remove('open');
  veilEl().classList.remove('open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
}
// Frise d'avancement : calculée depuis le cache collection s'il est chargé
// (découpage disjoint : sans photo → à estimer (prix_bas null) → estimées).
function friseHtml() {
  if (!S.collection?.length || !S.photoMap) return '';
  const total = S.collection.length;
  const sansPhoto = S.collection.filter(o => !S.photoMap[o.id]).length;
  const aEstimer = S.collection.filter(o => S.photoMap[o.id] && o.prix_bas == null).length;
  const ok = total - sansPhoto - aEstimer;
  const pct = n => (n / total * 100).toFixed(1) + '%';
  return `<div class="frise" role="img" aria-label="${ok} fiches estimées, ${aEstimer} à estimer, ${sansPhoto} sans photo">
    <span class="frise-ok" style="width:${pct(ok)}"></span><span class="frise-todo" style="width:${pct(aEstimer)}"></span><span class="frise-nophoto" style="width:${pct(sansPhoto)}"></span>
  </div>
  <div class="frise-legende">
    <span><i class="dot frise-ok"></i>${ok} estimée${ok > 1 ? 's' : ''}</span>
    <span><i class="dot frise-todo"></i>${aEstimer} à estimer</span>
    <span><i class="dot frise-nophoto"></i>${sansPhoto} sans photo</span>
  </div>`;
}
// Rayons du second niveau « Collection » : catégories canoniques présentes dans
// le cache, vignette = 1re photo du rayon (emoji en repli). Cible #/rayon/<cat>
// (route ajoutée en HO-043 — le routeur retombe sur la collection en attendant).
function rayonsHtml() {
  if (!S.collection?.length) return '';
  const parCat = new Map();
  for (const o of S.collection) {
    const c = catCanon(o.categorie);
    if (!c) continue;
    if (!parCat.has(c)) parCat.set(c, []);
    parCat.get(c).push(o);
  }
  const lignes = [...parCat.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([c, arr]) => {
    const ph = arr.map(o => S.photoMap?.[o.id]).find(p => p?.url);
    const visuel = ph ? `<img src="${esc(ph.url)}" alt="" loading="lazy">` : `<span class="rayon-emoji">${catEmoji(c)}</span>`;
    return `<button class="drawer-rayon" data-hash="#/rayon/${encodeURIComponent(c)}"><span class="rayon-thumb">${visuel}</span><span class="rayon-nom">${esc(c)}</span><span class="rayon-n">${arr.length}</span></button>`;
  }).join('');
  return `<div class="drawer-sub">${lignes}</div>`;
}
// Rendu dépendant du contexte : frise + comptes (données chargées), switcher
// multi-locataires (si > 1 maison), entrées filtrées selon le rôle (Maison =
// owner + admin), profil + déconnexion en pied.
function renderMenu() {
  const badgeRO = canWrite() ? '' : '<span class="badge-ro">lecture seule</span>';
  const switcher = S.mesTenants.length > 1 ? `
    <div class="menu-sec">Maison</div>
    ${S.mesTenants.map(t => `<button class="drawer-item menu-tenant ${t.id === S.tenantId ? 'current' : ''}" data-tenant="${esc(t.id)}">
      <span class="tenant-check">${t.id === S.tenantId ? '✓' : ''}</span>
      <span class="drawer-label">${esc(t.name || 'Ma collection')}</span><span class="drawer-meta">${esc(t.role)}</span>
    </button>`).join('')}` : '';
  drawerEl().innerHTML = `
    <div class="drawer-head">
      <div class="logo-name drawer-logo"><span class="w-i">I</span><img class="logo-glyph" src="assets/logo-glyph.png" alt="ART">cane<img class="logo-mark" src="assets/mark-cygne.svg" alt=""></div>
      ${friseHtml()}
      ${switcher}
    </div>
    <button class="btn primary drawer-cta hide-lecteur" data-hash="#/capture">+ Capturer un objet</button>
    <nav class="drawer-nav">
      ${canWrite() ? '<button class="drawer-item" data-hash="#/maison"><span class="drawer-label">Maison</span></button>' : ''}
      <button class="drawer-item" data-hash="#/artistes"><span class="drawer-label">Artistes</span><span class="drawer-n">${S.artistesCount ?? ''}</span></button>
      <button class="drawer-item current" data-hash="#/"><span class="drawer-label"><b>Collection</b></span><span class="drawer-n">${S.objetsCount ?? ''}</span></button>
      ${rayonsHtml()}
    </nav>
    <div class="drawer-foot">
      ${MENU_GOUV.map(e => `<button class="drawer-foot-item" data-hash="${esc(e.hash)}">${esc(e.label)}${e.hash === '#/demandes' && S.demandesOuvertes ? `<span class="drawer-n">${S.demandesOuvertes}</span>` : ''}</button>`).join('')}
      <div class="drawer-user">
        <span class="menu-user-name">${esc(profileName || '…')}${badgeRO}</span>
        ${S.user?.email && S.user.email !== profileName ? `<span class="menu-user-mail">${esc(S.user.email)}</span>` : ''}
        <button class="drawer-foot-item" data-action="logout">Se déconnecter</button>
      </div>
    </div>`;
}
$('#menu-btn').addEventListener('click', e => {
  e.stopPropagation();
  drawerEl().classList.contains('open') ? closeMenu() : openMenu();
});
drawerEl().addEventListener('click', async e => {
  const out = e.target.closest('[data-action="logout"]');
  if (out) { closeMenu(); await sb.auth.signOut(); location.hash = ''; return; }
  const t = e.target.closest('[data-tenant]');
  if (t) { closeMenu(); selectTenant(t.dataset.tenant); return; }
  const b = e.target.closest('[data-hash]');
  if (b) { closeMenu(); location.hash = b.dataset.hash; }
});
veilEl().addEventListener('click', closeMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
// Swipe gauche sur le tiroir = fermeture (design étape 2).
let touchX0 = null;
drawerEl().addEventListener('touchstart', e => { touchX0 = e.touches[0].clientX; }, { passive: true });
drawerEl().addEventListener('touchend', e => {
  if (touchX0 != null && e.changedTouches[0].clientX - touchX0 < -50) closeMenu();
  touchX0 = null;
}, { passive: true });

// ─── Bandeau : loupe / entonnoir (HO-042 — la recherche détaillée arrive en HO-044)
// La loupe bascule ligne de titre ↔ ligne de recherche ; la vue collection écoute
// aussi ce bouton (classe search-open résiduelle, sans effet) — les deux coexistent.
function setSearchLine(open) {
  $('#page-title-line').classList.toggle('hidden', open);
  $('#page-search-line').classList.toggle('hidden', !open);
  $('#btn-search-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
}
$('#btn-search-toggle').addEventListener('click', () => {
  setSearchLine($('#page-search-line').classList.contains('hidden'));
});
// La croix (bindée par la vue collection pour vider le champ) referme aussi la ligne.
$('#btn-search-close').addEventListener('click', () => setSearchLine(false));
// L'entonnoir de la ligne de recherche délègue à celui du bandeau (même panneau).
$('#btn-filters-2').addEventListener('click', () => $('#btn-filters').click());
$('#btn-demande').addEventListener('click', () => import('./js/views/demande.js').then(m => m.openDemandeSheet())); // D-072, feuille en HO-083

// Registre des routes : ajouter un écran = 1 entrée ici + 1 module js/views/
// (export `mount`, ou le nom donné via fn) + 1 <section class="view">.
// `write: true` → écran réservé aux rôles qui écrivent (lecteur redirigé).
const ROUTES = [
  { re: /^#\/capture/,            tab: 'capture',    view: 'capture',    write: true, load: () => import('./js/views/capture.js') },
  { re: /^#\/objet\/([^/]+)$/,    tab: 'collection', view: 'objet',      load: () => import('./js/views/objet/index.js') },
  { re: /^#\/rayon\/([^/]+)$/,    tab: 'collection', view: 'rayon',      load: () => import('./js/views/rayon.js') },
  { re: /^#\/maison/,             view: 'maison',    write: true,        load: () => import('./js/views/maison.js') },
  { re: /^#\/activite/,           view: 'activite',  load: () => import('./js/views/activite.js') },
  { re: /^#\/artiste\/([^/]+)$/,  tab: 'artistes',  view: 'artiste',   load: () => import('./js/views/artistes.js'), fn: 'mountDetail' },
  { re: /^#\/artistes/,           tab: 'artistes',  view: 'artistes',  load: () => import('./js/views/artistes.js'), fn: 'mountList' },
  { re: /^#\/sources/,            view: 'sources',   load: () => import('./js/views/sources.js') },
  { re: /^#\/demandes/,           view: 'demandes',  load: () => import('./js/views/demandes.js') },
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
    show('collection');
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
  show(r.view);
  m[r.fn ?? 'mount'](...meta.params);
  prevView = currentView;
  currentView = meta;
  updateBackButtons();
}
window.addEventListener('hashchange', route);
$('#logo-home').addEventListener('click', () => { location.hash = '#/'; });
$('#obj-back').addEventListener('click', () => { location.hash = prevView?.hash ?? '#/'; });
$$('.js-back').forEach(b => b.addEventListener('click', () => { location.hash = prevView?.hash ?? '#/'; }));

// ─── Fil d'Ariane contextuel (HO-025) ───────────────────────────────────────
// Mémoire d'une seule vue source : le retour ramène d'où l'on vient, avec
// fallback Collection sur entrée directe ou lien partagé.
let currentView = null;
let prevView = null;

function updateBackButtons() {
  S.currentView = currentView; // D-072 : la feuille de demande connaît la page courante
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
