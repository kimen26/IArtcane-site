// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/demande.js : feuille « écrire à l'admin » (D-072)
// Contrat : openDemandeSheet() ouvre la feuille ; rien d'autre n'est exporté.
// Feuille construite une fois, réutilisée à chaque ouverture. Le brouillon
// survit en localStorage (une clé unique, pas par page — micro qui coupe,
// onglet qui recharge, connexion qui lâche : on ne perd pas ce qui est tapé).
// ═══════════════════════════════════════════════════════════════════════════
import { loadViewCss } from '../core/css.js';
import { $, esc } from '../core/dom.js';
import { toast, enregistrer } from '../core/feedback.js';
import { S } from '../core/state.js';
import { sb } from '../core/data.js';
import { micButton } from './mic.js';

await loadViewCss('demande');

const DRAFT_KEY = 'iartcane-demande-brouillon';
const MAX_TEXTE = 5000;
const SEUIL_COMPTEUR = 4700;

let veil = null;
let sheet = null;
let textarea = null;
let compteurEl = null;
let pageEl = null;
let sendBtn = null;
let nomAuteurCache = null;

function construireFeuille() {
  if (sheet) return;

  veil = document.createElement('div');
  veil.className = 'dem-veil';
  veil.addEventListener('click', fermerFeuille);

  sheet = document.createElement('div');
  sheet.className = 'dem-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', "Écrire à l'admin");

  const head = document.createElement('div');
  head.className = 'dem-head';
  const title = document.createElement('span');
  title.className = 'dem-title';
  title.textContent = "Écrire à l'admin";
  const closeBtn = document.createElement('button');
  closeBtn.className = 'dem-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Fermer');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', fermerFeuille);
  head.append(title, closeBtn);

  pageEl = document.createElement('p');
  pageEl.className = 'dem-page';

  const field = document.createElement('div');
  field.className = 'dem-field';
  textarea = document.createElement('textarea');
  textarea.id = 'dem-texte';
  textarea.rows = 5;
  textarea.maxLength = MAX_TEXTE;
  textarea.placeholder = 'Ce qui ne va pas, ce qui manque, ce qu\'on pourrait ajouter…';
  textarea.addEventListener('input', onInput);
  field.append(textarea);

  const mic = micButton(textarea); // null si Web Speech API absente (Firefox, iOS ancien) — pas de bouton mort
  if (mic) field.append(mic);

  const foot = document.createElement('div');
  foot.className = 'dem-foot';
  compteurEl = document.createElement('span');
  compteurEl.className = 'dem-compteur';
  sendBtn = document.createElement('button');
  sendBtn.className = 'btn primary';
  sendBtn.id = 'dem-send';
  sendBtn.type = 'button';
  sendBtn.textContent = 'Envoyer';
  sendBtn.addEventListener('click', envoyer);
  foot.append(compteurEl, sendBtn);

  sheet.append(head, pageEl, field, foot);
  document.body.append(veil, sheet);

  // Posé une seule fois, à la création — ne fait rien si la feuille est fermée
  // (app.js a déjà un listener Escape pour le tiroir : les deux coexistent).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && estOuverte()) fermerFeuille();
  });
}

function estOuverte() {
  return sheet?.classList.contains('open') ?? false;
}

function onInput() {
  try { localStorage.setItem(DRAFT_KEY, textarea.value); } catch { /* stockage indisponible (navigation privée) : tant pis pour le brouillon */ }
  majCompteur();
}

function majCompteur() {
  const n = textarea.value.length;
  const restant = MAX_TEXTE - n;
  compteurEl.textContent = n >= SEUIL_COMPTEUR ? `${restant} caractères restants` : '';
}

function fermerFeuille() {
  // La fermeture ne vide pas la textarea : le brouillon survit (§6 du brief).
  veil.classList.remove('open');
  sheet.classList.remove('open');
}

export function openDemandeSheet() {
  construireFeuille();

  if (!textarea.value) {
    try {
      const brouillon = localStorage.getItem(DRAFT_KEY);
      if (brouillon) textarea.value = brouillon;
    } catch { /* stockage indisponible : ouverture sans brouillon */ }
  }

  const v = S.currentView ?? {};
  pageEl.innerHTML = `À propos de : <b>${esc(v.label ?? 'Collection')}</b> <span class="dem-route">${esc(location.hash || '#/')}</span>`;
  majCompteur();

  veil.classList.add('open');
  sheet.classList.add('open');
  textarea.focus();
}

// L'écran tel que l'auteur le voyait, en texte — jamais le DOM affiché lui-même
// (clone d'abord). Les URL signées Supabase (photos) sont réduites à leur
// pathname : le token expire en 1 h (inutile de le garder) et une table lisible
// par toute la maison n'est pas l'endroit où stocker un credential.
function snapshotEcran() {
  const vue = document.querySelector('main .view.active');
  if (!vue) return '';
  const clone = vue.cloneNode(true);
  clone.querySelectorAll('script, style, svg').forEach(n => n.remove());
  clone.querySelectorAll('[src], [href]').forEach(n => {
    for (const attr of ['src', 'href']) {
      const val = n.getAttribute(attr);
      if (val && val.startsWith('http')) {
        try { n.setAttribute(attr, new URL(val).pathname); } catch { /* URL invalide : laissée telle quelle */ }
      }
    }
  });
  let html = clone.innerHTML;
  if (html.length > 50000) html = html.slice(0, 50000) + '\n…[snapshot tronqué]';
  return html;
}

function contexteCourant() {
  const v = S.currentView ?? {};
  return {
    route: location.hash || '#/',
    vue: v.view ?? null,
    contexte: {
      label: v.label ?? null,
      params: v.params ?? [],
      maison: { id: S.tenantId, nom: S.tenantName, role: S.tenantRole },
      ua: navigator.userAgent,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      snapshot: snapshotEcran(),
    },
  };
}

async function nomAuteur() {
  if (nomAuteurCache) return nomAuteurCache;
  const { data } = await sb.from('profiles').select('display_name').eq('id', S.user.id).maybeSingle();
  nomAuteurCache = data?.display_name || S.user.email || null;
  return nomAuteurCache;
}

async function envoyer() {
  const texte = textarea.value.trim();
  if (!texte) { textarea.focus(); return; }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Envoi…';

  const charge = {
    owner_id: S.tenantId,
    auteur_id: S.user.id,
    auteur_nom: await nomAuteur(),
    auteur_email: S.user.email ?? null,
    texte,
    ...contexteCourant(),          // route, vue, contexte
  };

  const ok = await enregistrer(() => sb.from('demandes').insert(charge), 'Demande');

  sendBtn.disabled = false;
  sendBtn.textContent = 'Envoyer';

  if (ok) {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* rien à nettoyer si indisponible */ }
    textarea.value = '';
    majCompteur();
    fermerFeuille();
    S.refreshDemandes?.();
  }
  // Échec : feuille laissée ouverte, texte conservé, bouton déjà réactivé.
  // Le toast d'erreur persistant + « Réessayer » sont pris en charge par enregistrer().
}
