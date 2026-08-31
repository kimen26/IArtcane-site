// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/maison/index.js : territoire Maison (D-039 / D-041).
//
// Page des propriétaires, ouverte depuis le tiroir. Barre commune (retour
// « ‹ Collection », titre, bandeau d'onglets toujours visible) + deux onglets
// en navigation LOCALE (pas de changement de route) :
//   • identite.js   M1 — hero, renommage, couleur du ruban
//   • membres.js    M3 — membres, rôles, invitations
//
// etat.js porte l'état partagé (M) + les helpers roue/luminance. index.js
// branche les hooks (recharger / rendre / naviguer) pour éviter tout cycle.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { sb } from '../../core/data.js';
import { loadViewCss } from '../../core/css.js';
import { page } from '../../ui/page.js';
import { M, hooks } from './etat.js';

await loadViewCss('maison');

const ONGLETS = [
  { id: 'identite', label: 'Identité' },
  { id: 'membres', label: 'Membres' },
];

export function mount() {
  M.onglet = 'identite';
  M.scroll = {};
  chargerMaison();
}

async function chargerMaison() {
  const body = $('#maison-body');
  body.innerHTML = '<div class="skeleton" style="height:260px"></div>';

  const [{ data: t, error: eT }, { data: membres, error: eM }, { data: invits }, { data: objets }] = await Promise.all([
    sb.from('tenants').select('name, couleur, accent').eq('owner_id', S.tenantId).maybeSingle(),
    sb.from('collection_members').select('member_id, role, created_at').eq('owner_id', S.tenantId).order('created_at'),
    sb.from('maison_invitations').select('id, email, role, created_at, relance_le').eq('owner_id', S.tenantId).order('created_at', { ascending: false }),
    sb.from('objets').select('id, auteur, created_at').eq('owner_id', S.tenantId).order('created_at'),
  ]);

  if (eT || eM) { toast((eT ?? eM).message, true); body.innerHTML = ''; return; }

  // Noms affichés : profiles lisible entre membres d'une maison (policy 0012).
  const ids = (membres ?? []).map(m => m.member_id);
  const { data: profs } = ids.length
    ? await sb.from('profiles').select('id, display_name').in('id', ids)
    : { data: [] };
  const nomDe = id => (profs ?? []).find(p => p.id === id)?.display_name || `membre ${id.slice(0, 8)}…`;

  M.tenant = {
    name: t?.name ?? '',
    couleur: t?.couleur ?? null,
  };
  M.membres = (membres ?? []).map(m => ({ ...m, nom: nomDe(m.member_id) }));
  M.invitations = invits ?? [];
  M.nObjets = (objets ?? []).length;
  M.nArtistes = new Set((objets ?? []).map(o => o.auteur).filter(Boolean)).size;

  rendre();
}

// ─── Navigation locale (pas de route) ──────────────────────────────────────

async function importerOnglet(onglet) {
  if (onglet === 'identite') return import('./identite.js');
  if (onglet === 'membres') return import('./membres.js');
  return null;
}

function naviguer(onglet) {
  if (onglet === M.onglet) return;
  memoriserScroll();
  M.onglet = onglet;
  rendre();
}

function memoriserScroll() {
  const zone = $('#maison-onglet');
  if (zone) M.scroll[M.onglet] = zone.scrollTop;
}

function rendre() {
  const corps = page($('#maison-body'), { titre: 'Maison', fil: S.fil });
  corps.innerHTML = `
    <div class="ms-shell">
      ${rendreTabs()}
      <div class="ms-onglet" id="maison-onglet"></div>
    </div>`;

  corps.querySelectorAll('[data-onglet]').forEach(b => {
    b.addEventListener('click', () => naviguer(b.dataset.onglet));
  });

  const zone = corps.querySelector('#maison-onglet');
  importerOnglet(M.onglet).then(mod => {
    if (mod?.rendre) mod.rendre(zone);
    // Restaure la position de défilement mémorisée (best effort).
    if (M.scroll[M.onglet]) zone.scrollTop = M.scroll[M.onglet];
  });
}

// Bandeau d'onglets (HO-104) : le titre « Maison » et le retour vivent
// désormais dans le chrome uniforme (`ui/page.js`) — cette barre ne porte
// plus que les deux onglets, fidèle à la maquette (filet 2 px bleu action).
function rendreTabs() {
  const onglets = ONGLETS.map(o => `
    <button class="ms-tab ${o.id === M.onglet ? 'is-active' : ''}" data-onglet="${o.id}"
            role="tab" aria-selected="${o.id === M.onglet}">
      <span>${esc(o.label)}</span>
      <span class="ms-tab-filet"></span>
    </button>`).join('');
  return `<div class="ms-tabs" role="tablist">${onglets}</div>`;
}

// Branchement des hooks partagés (sous-onglets → index, sans import direct).
hooks.recharger = chargerMaison;
hooks.rendre = () => rendre();
hooks.naviguer = naviguer;
