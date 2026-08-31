// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/menu.js : tiroir de navigation (HO-042, design handoff étape 2).
//
// Extrait d'app.js le 2026-08-31 (le shell dépassait le plafond de 400 lignes).
// Panneau glissant 280 px : frise d'avancement, switcher de maison replié, CTA
// capture, entrées Maison/Artistes/Collection (+ rayons en second niveau), pied
// gouvernance, profil + déconnexion.
//
// Le shell garde la main sur ce qu'il est seul à savoir : la vue courante, le
// nom du profil, la bascule de locataire et le routage. Ils arrivent par
// `initMenu()` — ce module ne lit jamais l'état du shell directement.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc } from './dom.js';
import { S, canWrite } from './state.js';
import { catCanon, catEmoji } from './format.js';
import { sb, ensureCollection, loadPhotoMap } from './data.js';

const MENU_GOUV = [
  { hash: '#/activite',   label: 'Activité' },
  { hash: '#/sources',    label: 'Sources' },
  { hash: '#/categories', label: 'Catégories & familles' },
  { hash: '#/demandes',   label: 'Demandes' },
];

const drawerEl = () => $('#menu-panel');
const veilEl = () => $('#drawer-veil');

// Injecté par le shell (initMenu) : ce que ce module ne peut pas savoir seul.
let ctx = {
  vueCourante: () => null,   // () => string|null — surligne l'entrée active
  nomProfil: () => '',       // () => string
  choisirMaison: () => {},   // (id) => void
  aller: () => {},           // (hash) => void — routage, y compris hash identique
};

export function openMenu() {
  renderMenu(); // contenu frais (comptes, frise) à chaque ouverture
  drawerEl().classList.add('open');
  veilEl().classList.add('open');
  $('#menu-btn').setAttribute('aria-expanded', 'true');
  // HO-123 : verrouille le défilement de la page derrière le tiroir — sans ça,
  // deux barres de défilement coexistent sur mobile, tiroir ouvert.
  document.body.classList.add('drawer-open');
  // Frise et rayons sortent du cache collection : sans lui, le second niveau
  // « Collection » reste vide tant qu'on n'a pas visité la collection (retour
  // Yann 2026-08-31). Chargement APRÈS l'ouverture — le tiroir ne doit jamais
  // attendre le réseau pour apparaître.
  if (!S.collection?.length) {
    ensureCollection()
      .then(loadPhotoMap)
      .then(() => { if (drawerEl().classList.contains('open')) renderMenu(); })
      .catch(err => console.warn('menu rayons:', err));
  }
}

export function closeMenu() {
  drawerEl().classList.remove('open');
  veilEl().classList.remove('open');
  $('#menu-btn').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('drawer-open');
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
// le cache, vignette = 1re photo du rayon (emoji en repli).
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

// Switcher replié (retour Yann 2026-08-31) : la maison courante est le résumé,
// les autres n'apparaissent qu'au dépli. Une seule maison → pas de dépli.
function switcherHtml() {
  const courant = S.mesTenants.find(t => t.id === S.tenantId);
  if (!courant) return '';
  const autres = S.mesTenants.filter(t => t.id !== S.tenantId);
  const nom = esc(courant.name || 'Ma collection');
  if (!autres.length) {
    return `<div class="menu-maison menu-maison--seule">
      <span class="menu-sec">Maison</span><span class="menu-maison-nom">${nom}</span>
    </div>`;
  }
  const ligne = t => `<button class="drawer-item menu-tenant" data-tenant="${esc(t.id)}">
      <span class="drawer-label">${esc(t.name || 'Ma collection')}</span><span class="drawer-meta">${esc(t.role)}</span>
    </button>`;
  return `<details class="menu-maison">
      <summary class="menu-maison-resume">
        <span class="menu-sec">Maison</span>
        <span class="menu-maison-nom">${nom}</span>
        <span class="menu-maison-chevron" aria-hidden="true">▾</span>
      </summary>
      <div class="menu-maison-liste">${autres.map(ligne).join('')}</div>
    </details>`;
}

// Rendu dépendant du contexte : frise + comptes (données chargées), switcher
// multi-locataires, entrées filtrées selon le rôle, profil + déconnexion en pied.
export function renderMenu() {
  const badgeRO = canWrite() ? '' : '<span class="badge-ro">lecture seule</span>';
  const vue = ctx.vueCourante();
  const profil = ctx.nomProfil();
  drawerEl().innerHTML = `
    <div class="drawer-head">
      <div class="logo-name drawer-logo"><span class="w-i">I</span><img class="logo-glyph" src="assets/logo-glyph.png" alt="ART">cane<img class="logo-mark" src="assets/mark-cygne.svg" alt=""></div>
      ${friseHtml()}
      ${switcherHtml()}
    </div>
    <button class="btn primary drawer-cta hide-lecteur" data-hash="#/capture">+ Capturer un objet</button>
    <nav class="drawer-nav">
      <button class="drawer-item ${vue === 'accueil' ? 'current' : ''}" data-hash="#/"><span class="drawer-label">Accueil</span></button>
      ${canWrite() ? '<button class="drawer-item" data-hash="#/maison"><span class="drawer-label">Maison</span></button>' : ''}
      <button class="drawer-item" data-hash="#/artistes"><span class="drawer-label">Artistes</span><span class="drawer-n">${S.artistesCount ?? ''}</span></button>
      <button class="drawer-item ${vue === 'collection' ? 'current' : ''}" data-hash="#/collection"><span class="drawer-label"><b>Collection</b></span><span class="drawer-n">${S.objetsCount ?? ''}</span></button>
      ${rayonsHtml()}
    </nav>
    <div class="drawer-foot">
      ${MENU_GOUV.map(e => `<button class="drawer-foot-item" data-hash="${esc(e.hash)}">${esc(e.label)}${e.hash === '#/demandes' && S.demandesOuvertes ? `<span class="drawer-n">${S.demandesOuvertes}</span>` : ''}</button>`).join('')}
      <div class="drawer-user">
        <span class="menu-user-name">${esc(profil || '…')}${badgeRO}</span>
        ${S.user?.email && S.user.email !== profil ? `<span class="menu-user-mail">${esc(S.user.email)}</span>` : ''}
        <button class="drawer-foot-item" data-action="logout">Se déconnecter</button>
      </div>
    </div>`;
}

// Branche les gestes du tiroir. Appelé une seule fois au démarrage du shell.
export function initMenu(contexte) {
  ctx = { ...ctx, ...contexte };

  $('#menu-btn').addEventListener('click', e => {
    e.stopPropagation();
    drawerEl().classList.contains('open') ? closeMenu() : openMenu();
  });

  drawerEl().addEventListener('click', async e => {
    const out = e.target.closest('[data-action="logout"]');
    if (out) { closeMenu(); await sb.auth.signOut(); location.hash = ''; return; }
    const t = e.target.closest('[data-tenant]');
    if (t) { closeMenu(); ctx.choisirMaison(t.dataset.tenant); return; }
    const b = e.target.closest('[data-hash]');
    if (b) { closeMenu(); ctx.aller(b.dataset.hash); }
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
}
