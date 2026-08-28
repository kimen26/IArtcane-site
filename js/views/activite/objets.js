// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/activite/objets.js : onglet A4 · Par objet (le fil) (HO-057)
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { fmtNum, ACT_LABELS } from '../../core/format.js';
import {
  A, CRON_ACTIONS, resumeCron, colorOf,
  fmtHeure,
} from './etat.js';

const SIGN_PATHS_BATCH = [];

export function renderObjets(container) {
  const filtre = A.filtreActeur;
  A.filtreActeur = null; // consommer

  let evts = A.evts;
  if (filtre) {
    if (filtre === 'cron') {
      evts = evts.filter(e => CRON_ACTIONS.has(e.action));
    } else {
      evts = evts.filter(e => e.acteur === filtre);
    }
  }

  // Groupement par jour puis par objet
  const jours = new Map();
  for (const e of evts) {
    const d = new Date(e.created_at);
    const dk = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!jours.has(dk)) {
      jours.set(dk, {
        label: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
        objets: new Map(),
      });
    }
    const jour = jours.get(dk);
    const oid = e.objet_id || '_';
    if (!jour.objets.has(oid)) jour.objets.set(oid, []);
    jour.objets.get(oid).push(e);
  }

  if (!jours.size) {
    container.innerHTML = '<div class="act-empty">Aucun événement sur la période</div>';
    return;
  }

  // Construire le HTML jour par jour
  const html = [...jours.entries()].map(([dk, jour]) => {
    const objetsTouches = [...jour.objets.entries()].filter(([oid]) => oid !== '_').length;
    const anonymes = jour.objets.get('_')?.length || 0;
    const totalTouches = objetsTouches + (anonymes ? 1 : 0);
    const rows = [];

    // Objets avec événements
    for (const [oid, list] of jour.objets) {
      if (oid === '_') continue;
      rows.push(ObjetRow(oid, list, dk));
    }

    // Événements sans objet (groupe site)
    if (anonymes) {
      const list = jour.objets.get('_');
      const cron = list.filter(e => CRON_ACTIONS.has(e.action));
      const site = list.filter(e => !CRON_ACTIONS.has(e.action));
      if (cron.length > 10) {
        rows.push(cronReplieHtml('Événements cron', cron, dk));
      } else if (cron.length) {
        rows.push(ObjetRow('_', cron, dk));
      }
      if (site.length) rows.push(ObjetRow('_', site, dk));
    }

    return `
      <div class="act-jour-header">
        <span class="act-jour-title">${esc(jour.label)}</span>
        <span class="act-jour-line"></span>
        <span class="act-jour-count">${totalTouches} objet${totalTouches > 1 ? 's' : ''} touché${totalTouches > 1 ? 's' : ''}</span>
      </div>
      <div class="act-fil">${rows.join('')}</div>`;
  }).join('');

  container.innerHTML = `<div class="act-panels act-fil-wrapper">${html}</div>`;
  container.querySelectorAll('[data-action="toggle-cron"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = container.querySelector(`#${btn.dataset.target}`);
      if (target) target.classList.toggle('open');
    });
  });
}

function ObjetRow(oid, list, dk) {
  const first = list[0];
  const titre = oid === '_' ? 'Événements sans objet' : (A.titres[oid] || `#${oid}`);
  const photo = oid !== '_' ? A.photoMap[oid] : null;
  const img = photo?.thumbUrl || photo?.url;
  const estim = list.find(e => e.detail?.estimation || (e.action === 'passe_marche' && e.detail?.prix_bas != null));
  const events = list.map(e => EventBit(e)).join('');
  const isCronHeavy = list.length > 10 && list.every(e => CRON_ACTIONS.has(e.action));

  if (isCronHeavy) return cronReplieHtml(titre, list, dk);

  return `
    <div class="act-objet" data-oid="${esc(oid)}">
      <div class="act-objet-thumb">
        ${img ? `<img src="${esc(img)}" alt="">` : '<div class="act-objet-noimg">?</div>'}
        ${oid !== '_' ? `<div class="act-objet-voile"></div><span class="act-objet-id">#${esc(oid)}</span>` : ''}
      </div>
      <div class="act-objet-body">
        <div class="act-objet-head">
          <span class="act-objet-title">${esc(titre)}</span>
          <span class="act-objet-heure">${fmtHeure(first.created_at)}</span>
        </div>
        <div class="act-objet-events">${events}</div>
        ${estim ? estimationHtml(estim) : ''}
      </div>
    </div>`;
}

function EventBit(e) {
  const actor = e.acteur || 'site';
  const color = colorOf(actor, e.action);
  const text = eventText(e);
  return `
    <div class="act-event">
      <span class="act-event-puce" style="background:${color}"></span>
      <span class="act-event-txt">${esc(text)}</span>
      <span class="act-event-tag" style="background:${color}20;color:${color}">${esc(actor)}</span>
    </div>`;
}

function eventText(e) {
  const base = ACT_LABELS[e.action] || e.action;
  const d = e.detail || {};
  const parts = [base];
  if (d.modele) parts.push(d.modele);
  if (d.prompt_version) parts.push(`prompt ${d.prompt_version}`);
  if (d.n != null) parts.push(`${d.n} photo${d.n > 1 ? 's' : ''}`);
  if (d.comps != null) parts.push(`${d.comps} comparable${d.comps > 1 ? 's' : ''}`);
  if (Array.isArray(d.sources) && d.sources.length) parts.push(d.sources.join(', '));
  if (d.note) parts.push(d.note);
  return parts.join(' · ');
}

function estimationHtml(e) {
  const detail = e.detail || {};
  const montant = detail.estimation || (detail.prix_bas != null ? `${fmtNum(detail.prix_bas)} ${detail.prix_haut != null && detail.prix_haut !== detail.prix_bas ? '– ' + fmtNum(detail.prix_haut) : ''} €` : null);
  if (!montant) return '';
  return `
    <div class="act-estim">
      <span class="act-estim-label">Nouvelle estimation</span>
      <span class="act-estim-montant">${esc(montant)}</span>
    </div>`;
}

function cronReplieHtml(titre, list, dk) {
  const id = `cron-${dk}-${list[0].objet_id || 'x'}-${list[0].id}`;
  const vignettes = list.slice(0, 5).map(e => {
    const oid = e.objet_id;
    const ph = oid ? A.photoMap[oid] : null;
    const img = ph?.thumbUrl || ph?.url;
    return img ? `<img src="${esc(img)}" alt="">` : '<span class="act-vignette-empty">?</span>';
  }).join('');
  const resume = resumeCron(list);
  return `
    <div class="act-cron-replie">
      <div class="act-cron-vignettes">${vignettes}</div>
      <div class="act-cron-resume">${esc(resume)}</div>
      <button class="act-cron-chev" data-action="toggle-cron" data-target="${id}" aria-label="Déplier"></button>
    </div>
    <div class="act-cron-detail" id="${id}">
      ${list.map(e => `<div class="act-cron-line">${esc(fmtHeure(e.created_at))} · ${esc(ACT_LABELS[e.action] || e.action)}</div>`).join('')}
    </div>`;
}
