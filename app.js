// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — app.js : SHELL (D-039, architecture modulaire par vue)
// Boot, service worker, auth magic link, locataire/rôle, en-tête, menu gouvernance, routeur à lazy imports.
// Les écrans vivent dans js/views/*, le partagé dans js/core/* — ce fichier est TRANSVERSAL (gelé hors handoff dédié).
// Règle d'or affichée : jamais un chiffre sans comparables vendus.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast } from './js/core/dom.js';
import { S, canWrite } from './js/core/state.js';
import { sb } from './js/core/data.js';
import { withBusy } from './js/core/feedback.js';
import { viewLabel, filDe } from './js/core/nav.js';
import { initMenu, renderMenu, closeMenu } from './js/core/menu.js';
import { VERSION } from './js/core/version.js';

import { surveillerMiseAJour } from './js/core/maj.js';
surveillerMiseAJour(); // D-013 + HO-117 : SW offline/partage, nouvelle version annoncée

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
  // Nom de la maison + nombre d'objets (HO-118) : visible partout, sauf sur la
  // vue collection en mobile — le nom y est déjà porté par la ligne de titre.
  const collMobile = isColl && matchMedia('(max-width:640px)').matches;
  $('#header-maison').classList.toggle('hidden', collMobile || !S.tenantId);
  // Sur la collection, la ligne de titre dit le NOM DE LA MAISON (« Collection » est
  // déjà le dernier segment du fil, donc redondant) — tronqué si long (base.css).
  if (isColl) $('.page-title').textContent = S.tenantName || 'Collection';
  window.scrollTo({ top: 0 });
}
function showLogin() {
  $('#menu-gov').classList.add('hidden');
  $('#header-actions').classList.add('hidden');
  $('#page-subhead').classList.add('hidden');
  $('#header-maison').classList.add('hidden');
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
  const { data: noms } = await sb.from('tenants').select('owner_id,name,couleur,accent').in('owner_id', ids);
  const ligneDe = id => (noms ?? []).find(t => t.owner_id === id);
  const tenantDe = (id, role) => {
    const l = ligneDe(id);
    return { id, name: l?.name ?? '', couleur: l?.couleur ?? null, accent: l?.accent ?? null, role };
  };
  S.mesTenants = [
    tenantDe(S.user.id, 'owner'),
    ...(membres ?? []).map(m => tenantDe(m.owner_id, m.role)),
  ];
  // Choix persisté si encore valide, sinon la 1re membership (comportement D-015 :
  // un membre/lecteur tombe sur la maison partagée, pas sur sa collection vide),
  // sinon sa propre maison.
  // La maison DEMO (banc d'essai jetable, D-080) n'est JAMAIS un choix par défaut :
  // on n'y entre que par le switcher (retour Yann 2026-08-31 — le seed l'inscrit
  // membre admin, et la règle « 1re membership » l'y faisait tomber sans choix mémorisé).
  const estDemo = t => /^demo$/i.test(t.name ?? '');
  // Même mémorisée, DEMO ne survit pas à un rechargement (arbitrage Yann 2026-08-31 :
  // « ma maison PONAIRE par défaut ») — on y retourne par le switcher, pas par habitude.
  const pref = localStorage.getItem('iartcane-tenant');
  const courant = S.mesTenants.find(t => t.id === pref && !estDemo(t))
    ?? S.mesTenants.find(t => t.role !== 'owner' && !estDemo(t))
    ?? S.mesTenants.find(t => !estDemo(t))
    ?? S.mesTenants[0];
  S.tenantId = courant.id;
  S.tenantRole = courant.role;
  S.tenantName = courant.name;
  applyCouleursMaison(courant);
  applyRole();
}

// Couleurs de la maison : le RUBAN d'estimation (HO-041) et l'ACCENT d'ambiance
// (2026-08-31, demande Yann « une 2e couleur qui fasse sortir du lot »). Dans
// les deux cas, NULL → chaîne vide = la propriété est retirée et le repli CSS
// reprend (#35696c pour le ruban, le bleu primaire pour l'accent).
function applyCouleursMaison(t) {
  document.documentElement.style.setProperty('--ruban', t?.couleur || '');
  document.documentElement.style.setProperty('--accent-maison', t?.accent || '');
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
  applyCouleursMaison(t);
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
  $('#header-maison-nom').textContent = S.tenantName;
  $('#header-maison-n').textContent = `${S.objetsCount} objet${S.objetsCount > 1 ? 's' : ''}`;
  poserLogoMaison(S.tenantName);
  $('#header-maison').classList.remove('hidden');
}

// Logo de maison (demande Yann 2026-08-31 : la calligraphie PONAIRE dans
// l'en-tête, les autres maisons gardant leur nom écrit).
//
// La liste est EXPLICITE, et non « on tente l'image, on retombe sur le texte au
// 404 » : ce repli-là marche à l'écran mais salit la console d'une erreur à
// chaque maison sans logo — or la recette échoue sur toute erreur console, et
// une porte qui hurle sur un comportement normal finit par être ignorée.
// Ajouter une maison = déposer `assets/maisons/<slug>.webp` ET son slug ici
// (`python infra/logo-maison.py <source> <slug>` fait le fichier). Ne JAMAIS
// déclarer un slug sans son image : l'en-tête afficherait une vignette cassée,
// pire que le nom écrit.
const LOGOS_MAISON = new Set(['ponaire']);

const slugMaison = nom => String(nom ?? '').toLowerCase()
  .normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function poserLogoMaison(nom) {
  const img = $('#header-maison-logo');
  const nomEl = $('#header-maison-nom');
  const slug = slugMaison(nom);
  const avecLogo = LOGOS_MAISON.has(slug);
  if (avecLogo) {
    img.alt = nom ?? '';
    img.src = `assets/maisons/${slug}.webp?v=${VERSION}`;
  }
  img.classList.toggle('hidden', !avecLogo);
  nomEl.classList.toggle('hidden', avecLogo);
}

// Hooks transverses : les vues rafraîchissent en-tête/menu sans importer le shell.
S.refreshHeader = () => loadHeader();
S.refreshMenu = () => renderMenu();
S.refreshDemandes = async () => { await (await import('./js/views/demandes.js')).refreshCompteur(); renderMenu(); }; // D-072

// ═══════════════════════════════════════════════════════════════════════════
// ROUTEUR (hash) — lazy import des vues (D-039)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tiroir de navigation ───────────────────────────────────────────────────
// Le tiroir vit dans core/menu.js (extrait le 2026-08-31, plafond des 400
// lignes). Le shell lui fournit ce que lui seul sait : la vue courante, le nom
// du profil, la bascule de maison et le routage.
initMenu({
  vueCourante: () => currentView?.view ?? null,
  nomProfil: () => profileName,
  choisirMaison: selectTenant,
  // Hash identique = pas de hashchange = écran figé (retour Yann 2026-08-31 :
  // « je clique sur Collection, rien ne s'ouvre »). On rejoue alors la route.
  aller: cible => {
    if (location.hash === cible || (cible === '#/' && !location.hash)) route();
    else location.hash = cible;
  },
});

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
  { re: /^#\/collection/, tab: 'collection', view: 'collection', load: () => import('./js/views/collection.js') },
  { re: /^#\/?$/,          tab: 'accueil',    view: 'accueil',    load: () => import('./js/views/accueil.js') },
  { re: /^#\/capture/,            tab: 'capture',    view: 'capture',    write: true, load: () => import('./js/views/capture.js') },
  { re: /^#\/objet\/([^/]+)\/photo\/([^/]+)\/modifier$/, tab: 'collection', view: 'objet', write: true, load: () => import('./js/views/objet/edition-photo.js'), fn: 'mount' },
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
  // Le module est chargé AVANT d'afficher l'écran : chaque vue attend son propre
  // CSS (core/css.js) au chargement du module, donc on n'affiche jamais une vue
  // nue le temps que la feuille arrive (D-041). Un hash inconnu ouvre l'accueil
  // (HO-118) : plus de repli sur la collection.
  const r = ROUTES.find(x => x.re.test(h)) ?? ROUTES.find(x => x.view === 'accueil');
  // Gardes d'écriture : capture et maison interdites au lecteur (RLS 0012, UI masquée)
  if (r.write && !canWrite()) { location.replace('#/'); return; }
  const meta = computeViewMeta(r, h);
  // Fil d'Ariane posé AVANT le montage (HO-104) : la vue le lit dans S.fil au
  // montage — seule navigation ascendante depuis l'arbitrage Yann 2026-08-29
  // (le bouton retour disparaît, il ne se déplace pas).
  S.fil = filDe(meta.view, meta.params);
  const m = await r.load();
  show(r.view);
  m[r.fn ?? 'mount'](...meta.params);
  currentView = meta;
  S.currentView = currentView; // D-072 : la feuille de demande connaît la page courante
}
window.addEventListener('hashchange', route);
$('#logo-home').addEventListener('click', () => { location.hash = '#/'; });

let currentView = null;

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
