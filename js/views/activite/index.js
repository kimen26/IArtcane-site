// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/activite/index.js : barre commune + fenêtre + 4 onglets
// Architecture territoire (HO-057) : onglets locaux, pas de route interne.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast, emptyHtml } from '../../core/dom.js';
import { loadViewCss } from '../../core/css.js';
import {
  A, FENETRES, Onglets, loadActiviteData, setOnglet, setFenetre,
} from './etat.js';
import { renderPouls } from './pouls.js';
import { renderOutils } from './outils.js';
import { renderPersonnes } from './personnes.js';
import { renderObjets } from './objets.js';

await loadViewCss('activite');

const RENDERS = {
  pouls: renderPouls,
  outils: renderOutils,
  personnes: renderPersonnes,
  objets: renderObjets,
};

export function mount() {
  const body = $('#activite-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  A.fenetre = '30j';
  A.onglet = 'pouls';
  A.scrolls = {};
  A.filtreActeur = null;
  loadActiviteData().then(() => render()).catch(e => {
    console.error(e);
    toast('Impossible de charger l’activité', true);
    body.innerHTML = emptyHtml('Erreur de chargement', 'Réessaie dans un instant.');
  });
}

function render() {
  const body = $('#activite-body');
  body.innerHTML = `
    <div class="act-view">
      ${barreHtml()}
      <div class="act-body" id="act-body"></div>
    </div>`;
  bindBarre(body);
  renderOnglet();
}

function barreHtml() {
  const fen = FENETRES.find(f => f.id === A.fenetre) ?? FENETRES[2];
  return `
    <div class="act-barre">
      <div class="act-barre-top">
        <span class="act-barre-title">Activité</span>
        <div class="act-fenetres">
          ${FENETRES.map(f => `
            <button class="act-fenetre ${f.id === A.fenetre ? 'active' : ''}" data-fenetre="${f.id}">${esc(f.label)}</button>
          `).join('')}
        </div>
      </div>
      <div class="act-onglets">
        ${Onglets.map(o => `
          <button class="act-onglet ${o.id === A.onglet ? 'active' : ''}" data-onglet="${o.id}">
            <span>${esc(o.label)}</span>
            <span class="act-onglet-bar"></span>
          </button>
        `).join('')}
      </div>
    </div>`;
}

function bindBarre(body) {
  body.querySelectorAll('[data-fenetre]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.fenetre === A.fenetre) return;
      saveScroll();
      setFenetre(btn.dataset.fenetre);
      await loadActiviteData();
      render();
    });
  });
  body.querySelectorAll('[data-onglet]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.onglet === A.onglet) return;
      saveScroll();
      setOnglet(btn.dataset.onglet);
      renderOnglet();
    });
  });
}

function saveScroll() {
  const el = $('#act-body');
  if (el) A.scrolls[A.onglet] = el.scrollTop;
}

function renderOnglet() {
  const container = $('#act-body');
  if (!container) return;
  container.innerHTML = '';
  const fn = RENDERS[A.onglet];
  if (!fn) return;
  fn(container);
  container.scrollTop = A.scrolls[A.onglet] || 0;
}
