// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/accueil.js : le journal (HO-119, route `#/`). Assemblage
// seul (docs/architecture-briques.md §2) : services/journal.js calcule,
// ui/page.js pose le chrome, cette vue rend le HTML des 4 blocs.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc } from '../core/dom.js';
import { S, canWrite } from '../core/state.js';
import { loadViewCss } from '../core/css.js';
import { page } from '../ui/page.js';
import { fmtNum, fmtDate, plur } from '../core/format.js';
import { chargerJournal } from '../services/journal.js';

await loadViewCss('accueil');

const VISITE_KEY = () => `iartcane-visite-${S.tenantId}`;

function repereJour(depuis) {
  const d = new Date(depuis);
  const ecartJours = (Date.now() - d.getTime()) / 86400000;
  return ecartJours < 7 ? d.toLocaleDateString('fr-FR', { weekday: 'long' }) : fmtDate(depuis);
}

// ─── Bloc 1 : travail, agrégé ───────────────────────────────────────────────
function blocTravail(travail) {
  if (!travail) return '';
  const detail = [];
  if (travail.nouveauxObjets) detail.push(`${travail.nouveauxObjets} nouveaux objets`);
  if (travail.photos) detail.push(`${travail.photos} photos`);
  if (travail.commentaires) detail.push(`${travail.commentaires} commentaires`);
  if (travail.fichesCompletees) detail.push(`${travail.fichesCompletees} fiches complétées`);
  const ligneDetail = detail.length ? `<p class="acc-detail">${detail.join(' · ')}</p>` : '';
  return `<section class="acc-bloc acc-bloc-travail">
    <p class="acc-phrase">Depuis <b>${esc(repereJour(travail.depuis))}</b>, vous avez avancé sur ${esc(plur(travail.objets, 'objet', 'objets'))}.</p>
    ${ligneDetail}
  </section>`;
}

// ─── Bloc 2 : iArcane a trouvé ──────────────────────────────────────────────
const SURTITRE = { artiste: 'Artiste trouvé', vente: 'Vente trouvée' };

function ligneTrouvaille(t) {
  const vignette = t.thumbUrl
    ? `<img class="acc-trouv-vignette" src="${esc(t.thumbUrl)}" alt="" loading="lazy">`
    : `<span class="acc-trouv-vignette acc-trouv-vignette--vide"></span>`;
  return `<div class="acc-trouv-ligne">
    ${vignette}
    <div class="acc-trouv-corps">
      <span class="acc-trouv-surtitre">${esc(SURTITRE[t.type] || '')}</span>
      <span class="acc-trouv-valeur">${esc(t.valeur)}</span>
      <span class="acc-trouv-sur">sur ${esc(t.objetTitre)}</span>
    </div>
    <button type="button" class="acc-trouv-voir" data-acc-objet="${esc(t.objetId)}">Voir</button>
  </div>`;
}

function blocTrouvailles(trouvailles) {
  if (!trouvailles || !trouvailles.length) return '';
  return `<section class="acc-bloc acc-carte acc-trouvailles">
    <div class="acc-trouv-tete"><span class="acc-trouv-pastille"></span>IARCANE A TROUVÉ</div>
    ${trouvailles.map(ligneTrouvaille).join('')}
  </section>`;
}

// ─── Bloc 3 : il vous reste ─────────────────────────────────────────────────
const RESTE_LIBELLE = {
  photosNonTaguees: n => plur(n, 'photo à taguer', 'photos à taguer'),
  artistesNonTrouves: n => plur(n, 'artiste à chercher', 'artistes à chercher'),
  infosNonValidees: n => plur(n, 'info à valider', 'infos à valider'),
};
const RESTE_SOUS_TITRE = {
  photosNonTaguees: 'ce que montre chaque photo',
  artistesNonTrouves: 'iArcane sèche, un indice ?',
  infosNonValidees: 'parmi : catégorie, auteur, technique, titre, état, dimensions',
};

function ligneReste(l) {
  const vignettes = (l.apercu || []).map(a => a.thumbUrl
    ? `<img class="acc-reste-vignette" src="${esc(a.thumbUrl)}" alt="" loading="lazy">`
    : `<span class="acc-reste-vignette acc-reste-vignette--vide"></span>`).join('');
  const cible = l.apercu?.[0]?.objetId;
  return `<div class="acc-reste-ligne" data-acc-objet="${esc(cible || '')}" role="button" tabindex="0">
    <div class="acc-reste-corps">
      <span class="acc-reste-chiffre">${esc(String(l.n))}</span>
      <span class="acc-reste-libelle">${esc(RESTE_LIBELLE[l.cle](l.n))}</span>
      <span class="acc-reste-sous">${esc(RESTE_SOUS_TITRE[l.cle] || '')}</span>
    </div>
    <div class="acc-reste-vignettes">${vignettes}</div>
    <span class="acc-reste-chevron">›</span>
  </div>`;
}

function blocReste(reste) {
  if (!reste || !reste.length) return '';
  const total = reste.reduce((s, l) => s + l.n, 0);
  return `<section class="acc-bloc acc-reste">
    <div class="acc-reste-titre"><span>Il vous reste</span><span class="acc-reste-total">${esc(plur(total, 'action', 'actions'))}</span></div>
    <div class="acc-carte">${reste.map(ligneReste).join('')}</div>
  </section>`;
}

// ─── Bloc 4 : la collection à date ──────────────────────────────────────────
function blocResume(resume) {
  const { objets, artistesIdentifies, fichesEstimees, valeurTotale, fichesValidees, ajoutsDuMois } = resume;
  const restant = Math.max(0, objets - fichesEstimees - fichesValidees);
  const total = Math.max(1, fichesValidees + Math.max(0, fichesEstimees - fichesValidees) + restant);
  const pct = n => `${Math.round((n / total) * 100)}%`;
  return `<section class="acc-bloc acc-resume">
    <div class="acc-resume-tete">
      <span>LA COLLECTION À DATE</span>
      <span class="acc-resume-date">${esc(fmtDate(new Date().toISOString()))}</span>
    </div>
    <div class="acc-resume-ligne">
      <span class="acc-resume-chiffre">${esc(String(objets))}</span>
      <span class="acc-resume-libelle">objets</span>
      <span class="acc-resume-precision">dont ${esc(String(ajoutsDuMois))} ajoutés ce mois</span>
    </div>
    <div class="acc-resume-ligne">
      <span class="acc-resume-chiffre">${esc(String(artistesIdentifies))}</span>
      <span class="acc-resume-libelle">artistes identifiés</span>
      <span class="acc-resume-precision">sur ${esc(String(objets))} objets</span>
    </div>
    <div class="acc-resume-ligne">
      <span class="acc-resume-chiffre">${esc(String(fichesEstimees))}</span>
      <span class="acc-resume-libelle">fiches estimées</span>
      <span class="acc-resume-precision">${valeurTotale != null ? esc(fmtNum(valeurTotale)) + ' € au total (milieu des fourchettes)' : 'aucune estimation'}</span>
    </div>
    <div class="acc-resume-ligne">
      <span class="acc-resume-chiffre">${esc(String(fichesValidees))}</span>
      <span class="acc-resume-libelle">fiches validées</span>
      <span class="acc-resume-precision">relues par vous</span>
    </div>
    <div class="acc-resume-frise">
      <span class="acc-resume-frise-seg acc-resume-frise-seg--validees" style="width:${pct(fichesValidees)}"></span>
      <span class="acc-resume-frise-seg acc-resume-frise-seg--estimees" style="width:${pct(Math.max(0, fichesEstimees - fichesValidees))}"></span>
      <span class="acc-resume-frise-seg acc-resume-frise-seg--reste" style="width:${pct(restant)}"></span>
    </div>
  </section>`;
}

function rendreBlocs(journal) {
  const { travail, trouvailles, reste, resume } = journal;
  const blocs = travail
    ? [blocTravail(travail), blocTrouvailles(trouvailles), blocReste(reste), blocResume(resume)]
    : [blocResume(resume), blocTrouvailles(trouvailles), blocReste(reste)];
  return blocs.filter(Boolean).join('');
}

function bindNavigation(corps) {
  corps.addEventListener('click', (evt) => {
    const cible = evt.target?.closest ? evt.target.closest('[data-acc-objet]') : null;
    if (!cible) return;
    const oid = cible.getAttribute('data-acc-objet');
    if (oid) location.hash = `#/objet/${oid}`;
  });
}

export function mount() {
  const el = $('#accueil-body');
  const corps = page(el, {
    titre: 'Accueil', fil: S.fil,
    barre: canWrite() ? { actions: [{ label: 'Capturer un objet', type: 'primaire', onClick: () => { location.hash = '#/capture'; } }] } : undefined,
  });

  corps.innerHTML = `<div class="acc-chargement">
    <span class="acc-chargement-bloc"></span><span class="acc-chargement-bloc"></span>
    <span class="acc-chargement-bloc"></span><span class="acc-chargement-bloc"></span>
  </div>`;
  bindNavigation(corps);

  const cle = VISITE_KEY();
  let depuis = null;
  try { depuis = localStorage.getItem(cle); } catch { /* stockage bloqué */ }

  chargerJournal({ depuis }).then((journal) => {
    corps.innerHTML = rendreBlocs(journal);
  });

  // Écrite à la SORTIE de l'écran, pas à l'entrée (sinon un rechargement
  // efface le journal avant même de l'avoir montré) — hashchange { once:true }.
  // Un hashchange qui reste sur l'accueil (`''` → `#/`, cas de la recette) ne
  // compte pas comme une sortie : on ne pose la date qu'en quittant vraiment.
  const surSortie = () => {
    if (/^#\/?$/.test(location.hash)) return;
    window.removeEventListener('hashchange', surSortie);
    try { localStorage.setItem(cle, new Date().toISOString()); } catch { /* stockage bloqué */ }
  };
  window.addEventListener('hashchange', surSortie);
}
