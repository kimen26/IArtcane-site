// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/demandes.js : écran de tri des demandes (D-072)
// Squelette posé par HO-082, rempli par HO-084.
// Contrat : mount() rend l'écran dans #demandes-body.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, emptyHtml } from '../core/dom.js';
import { S, canWrite } from '../core/state.js';
import { sb } from '../core/data.js';
import { toast, enregistrer, humaniser } from '../core/feedback.js';
import { fmtDateTime } from '../core/format.js';
import { loadViewCss } from '../core/css.js';
import { micButton } from './mic.js';
import { page } from '../ui/page.js';

await loadViewCss('demandes');

// Vue → libellé clair (repli sur la valeur brute si absente).
const VUES = {
  collection: 'Collection', objet: 'Objet', artiste: 'Artiste', maison: 'Maison',
  activite: 'Activité', sources: 'Sources', categories: 'Catégories', capture: 'Capturer',
  demandes: 'Demandes',
};

const BADGES = {
  nouvelle: { txt: 'Nouvelle', cls: 'nouvelle' },
  acceptee: { txt: 'Acceptée', cls: 'acceptee' },
  refusee: { txt: 'Refusée', cls: 'refusee' },
  faite: { txt: 'Faite', cls: 'faite' },
};

const LABELS = { acceptee: 'Demande acceptée', refusee: 'Demande refusée', faite: 'Demande faite' };

// Chips de filtre (D-072 §3) : id → statuts couverts.
const CHIPS = [
  { id: 'ouvertes', txt: 'Ouvertes', statuts: ['nouvelle', 'acceptee'] },
  { id: 'nouvelles', txt: 'Nouvelles', statuts: ['nouvelle'] },
  { id: 'traitees', txt: 'Traitées', statuts: ['faite', 'refusee'] },
  { id: 'toutes', txt: 'Toutes', statuts: null },
];

const DEM = {
  data: [],
  erreur: false,
  filtre: 'ouvertes',
  reponseOuverte: {},   // id → bool (zone réponse dépliée)
  refusSansTexte: {},   // id → bool (2e clic refuser sans texte accepté)
};

let branche = false;

async function charger() {
  DEM.erreur = false;
  const { data, error } = await sb.from('demandes')
    .select('*')
    .eq('owner_id', S.tenantId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('demandes:', error);
    console.warn('demandes:', error); toast(`Demandes non chargées — ${humaniser(error)}.`, 'panne');
    DEM.erreur = true;
    DEM.data = [];
    return;
  }
  DEM.data = data ?? [];
}

function compteChip(statuts) {
  if (!statuts) return DEM.data.length;
  return DEM.data.filter(d => statuts.includes(d.statut)).length;
}

function demandesFiltrees() {
  const chip = CHIPS.find(c => c.id === DEM.filtre) ?? CHIPS[0];
  return chip.statuts ? DEM.data.filter(d => chip.statuts.includes(d.statut)) : DEM.data;
}

function contexteTechnique(d) {
  const ctx = d.contexte ?? {};
  const lignes = [];
  if (ctx.maison) lignes.push(`<div><b>Maison</b> ${esc(ctx.maison.nom ?? '')} (${esc(ctx.maison.role ?? '')})</div>`);
  if (ctx.params?.length) lignes.push(`<div><b>Paramètres</b> ${esc(ctx.params.join(', '))}</div>`);
  if (ctx.viewport) lignes.push(`<div><b>Viewport</b> ${esc(ctx.viewport.w)}×${esc(ctx.viewport.h)}</div>`);
  if (ctx.ua) lignes.push(`<div><b>UA</b> ${esc(ctx.ua)}</div>`);
  // Le snapshot est du HTML capturé sur l'écran de l'auteur : affiché comme du
  // TEXTE (esc dans un <pre>), jamais injecté — un innerHTML ici serait une XSS
  // stockée (n'importe quel membre peut écrire une demande).
  const snapshot = ctx.snapshot
    ? `<pre class="dems-snapshot">${esc(ctx.snapshot)}</pre>`
    : '<p class="dems-snapshot-vide">Aucun aperçu d\'écran.</p>';
  return `
    <details class="dems-ctx">
      <summary>Contexte technique</summary>
      <div class="dems-ctx-corps">
        ${lignes.join('') || '<div class="dems-ctx-vide">Aucune information de contexte.</div>'}
        ${snapshot}
      </div>
    </details>`;
}

function carte(d) {
  const badge = BADGES[d.statut] ?? { txt: esc(d.statut), cls: '' };
  const auteur = d.auteur_nom || d.auteur_email || 'Anonyme';
  const vueLabel = VUES[d.vue] ?? d.vue ?? '';
  const aRoute = !!d.route;
  const ecrivable = canWrite();
  const reponseOuverte = !!DEM.reponseOuverte[d.id];

  return `
    <article class="dem-carte" data-id="${esc(d.id)}">
      <div class="dem-carte-tete">
        <span class="dem-badge ${badge.cls}">${esc(badge.txt)}</span>
        <span class="dem-carte-auteur">${esc(auteur)} · ${esc(fmtDateTime(d.created_at))}</span>
      </div>
      <p class="dem-carte-texte">${esc(d.texte)}</p>
      <div class="dem-carte-page">
        <span>${esc(vueLabel)}</span>
        ${d.route ? `<span class="dem-carte-route">${esc(d.route)}</span>` : ''}
        <button type="button" class="dem-carte-aller" data-action="aller" data-route="${esc(d.route ?? '')}" ${aRoute ? '' : 'disabled'}>→ Aller à la page</button>
      </div>
      ${contexteTechnique(d)}
      ${d.reponse ? `
        <div class="dem-reponse">
          <div class="dem-reponse-tete">Réponse de l'admin</div>
          <p class="dem-reponse-texte">${esc(d.reponse)}</p>
          <div class="dem-reponse-date">${esc(fmtDateTime(d.traite_at))}</div>
        </div>` : ''}
      ${ecrivable ? `
        <div class="dem-actions">
          <div class="dem-actions-boutons">
            <button type="button" class="btn small" data-action="traiter" data-statut="acceptee" data-id="${esc(d.id)}">Accepter</button>
            <button type="button" class="btn small" data-action="traiter" data-statut="refusee" data-id="${esc(d.id)}">Refuser</button>
            <button type="button" class="btn small" data-action="traiter" data-statut="faite" data-id="${esc(d.id)}">Faite</button>
            <button type="button" class="dem-carte-repondre" data-action="toggle-reponse" data-id="${esc(d.id)}">Répondre</button>
          </div>
          <div class="dem-carte-reponse-zone ${reponseOuverte ? 'open' : ''}" data-reponse-zone="${esc(d.id)}">
            <textarea class="dem-carte-reponse-txt" data-id="${esc(d.id)}" placeholder="${esc(DEM.refusSansTexte[d.id] ? 'Dis pourquoi — c\'est ce que l\'auteur verra.' : 'Réponse visible de toute la maison…')}" rows="3"></textarea>
          </div>
        </div>` : ''}
    </article>`;
}

function render() {
  const corps = page($('#demandes-body'), { titre: 'Demandes', fil: S.fil });
  if (DEM.erreur) {
    corps.innerHTML = `<div class="empty"><div class="big">⚠️</div><h2>Demandes indisponibles</h2><p>Le chargement a échoué — réessaie dans un instant.</p></div>`;
    return;
  }
  if (!DEM.data.length) {
    corps.innerHTML = emptyHtml('Aucune demande', "Le bouton 💬 de l'en-tête sert à en écrire une.");
    return;
  }
  const filtrees = demandesFiltrees();
  const chips = CHIPS.map(c => `
    <button type="button" class="dem-chip ${DEM.filtre === c.id ? 'actif' : ''}" data-action="chip" data-id="${esc(c.id)}">
      ${esc(c.txt)} <span class="dem-chip-n">${compteChip(c.statuts)}</span>
    </button>`).join('');

  corps.innerHTML = `
    <div class="dem-chips">${chips}</div>
    <div class="dem-liste">
      ${filtrees.length ? filtrees.map(carte).join('') : '<div class="empty"><p>Aucune demande dans ce filtre.</p></div>'}
    </div>`;
}

async function recharger() {
  await charger();
  render();
}

async function traiter(id, statut) {
  const d = DEM.data.find(x => String(x.id) === String(id));
  if (!d) return;

  const zone = $(`[data-reponse-zone="${id}"]`);
  const texte = zone?.querySelector('textarea')?.value?.trim() ?? '';

  // Refuser sans réponse écrite : ouvre la zone avec le message d'accompagnement
  // plutôt que de refuser en silence — un second clic reste possible sans texte.
  if (statut === 'refusee' && !texte && !DEM.refusSansTexte[id]) {
    DEM.refusSansTexte[id] = true;
    DEM.reponseOuverte[id] = true;
    render();
    $(`[data-reponse-zone="${id}"] textarea`)?.focus();
    return;
  }

  const patch = { statut, traite_par: S.user.id, traite_at: new Date().toISOString() };
  if (texte) patch.reponse = texte;

  const ok = await enregistrer(() => sb.from('demandes').update(patch).eq('id', id), LABELS[statut]);
  if (!ok) return;

  delete DEM.refusSansTexte[id];
  delete DEM.reponseOuverte[id];
  await recharger();
  S.refreshDemandes?.();
}

function brancher() {
  const body = $('#demandes-body');

  body.addEventListener('click', async e => {
    const chip = e.target.closest('[data-action="chip"]');
    if (chip) {
      DEM.filtre = chip.dataset.id;
      render();
      return;
    }
    const aller = e.target.closest('[data-action="aller"]');
    if (aller) {
      const route = aller.dataset.route;
      if (route) location.hash = route;
      return;
    }
    const toggle = e.target.closest('[data-action="toggle-reponse"]');
    if (toggle) {
      const id = toggle.dataset.id;
      DEM.reponseOuverte[id] = !DEM.reponseOuverte[id];
      render();
      if (DEM.reponseOuverte[id]) $(`[data-reponse-zone="${id}"] textarea`)?.focus();
      return;
    }
    const traiterBtn = e.target.closest('[data-action="traiter"]');
    if (traiterBtn) {
      await traiter(traiterBtn.dataset.id, traiterBtn.dataset.statut);
    }
  });

  // Micro sur chaque zone de réponse dépliée : posé une fois par carte, au
  // premier rendu qui l'affiche (délégation impossible pour un composant DOM).
  const obs = new MutationObserver(() => {
    body.querySelectorAll('.dem-carte-reponse-zone.open').forEach(zone => {
      if (zone.querySelector('.mic-btn')) return;
      const ta = zone.querySelector('textarea');
      const mic = ta && micButton(ta);
      if (mic) zone.append(mic);
    });
  });
  obs.observe(body, { childList: true, subtree: true });
}

export async function mount() {
  page($('#demandes-body'), { titre: 'Demandes', fil: S.fil }).innerHTML = '<div class="skeleton" style="height:220px"></div>';
  DEM.filtre = 'ouvertes';
  DEM.reponseOuverte = {};
  DEM.refusSansTexte = {};
  await charger();
  render();
  if (!branche) { brancher(); branche = true; }
}

// Demandes encore ouvertes de la maison (D-072) : compteur + pastille d'en-tête,
// appelé par le shell (app.js) via import dynamique — logique déportée ici plutôt
// que dans app.js, au plafond de modularité en cliquet (infra/check-site.mjs).
export async function refreshCompteur() {
  const { count } = await sb.from('demandes')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', S.tenantId)
    .in('statut', ['nouvelle', 'acceptee']);
  S.demandesOuvertes = count ?? 0;
  const pastille = $('#demandes-count');
  pastille.textContent = S.demandesOuvertes || '';
  pastille.classList.toggle('hidden', !S.demandesOuvertes);
}
