// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/collection.js : listing, recherche, filtres, listes, CSV
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, norm, toast, humaniser, emptyHtml } from '../core/dom.js';
import { S } from '../core/state.js';
import { catCanon, catEmoji, cardHtml, STATUTS } from '../core/format.js';
import { sb, loadPhotoMap } from '../core/data.js';
import { loadViewCss } from '../core/css.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('collection');

export function mount() {
  loadCollection();
  // Retour sur la vue (depuis une fiche/artiste ouverte via une proposition) :
  // la ligne de recherche du bandeau (shell) peut être restée ouverte — rouvrir
  // les propositions si une saisie est en cours, sinon lever l'atténuation.
  const ligneOuverte = !$('#page-search-line').classList.contains('hidden');
  if (ligneOuverte && $('#search').value.trim()) renderSuggest($('#search').value);
  else $('#view-collection').classList.remove('searching');
}

async function loadCollection() {
  const body = $('#collection-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const { data, error } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).order('created_at', { ascending: false });
  if (error) { console.warn('collection:', error); toast(`Collection non chargée — ${humaniser(error)}.`, 'panne'); body.innerHTML = ''; return; }
  S.collection = data ?? [];
  await loadPhotoMap();
  // Ligne de titre du bandeau (HO-042) : « N objets · M à estimer » (HO-043)
  const n = S.collection.length;
  const m = S.collection.filter(o => o.prix_bas == null).length;
  const el = $('#page-sub-count');
  if (el) el.textContent = `${n} objet${n > 1 ? 's' : ''} · ${m} à estimer`;
  renderLists();
  renderGrid();
}

// Prédicat de filtrage pur — utilisé par objMatches (filtre courant) et par
// renderLists (compteurs des listes sauvegardées, filtres « virtuels »).
function matchFiltre(o, f) {
  if (f.list === 'a_localiser' && o.zone && o.zone.trim()) return false;
  if (f.list === 'a_valider' && o.statut !== 'analyse') return false;
  if (f.list === 'chere' && !(o.prix_haut >= 1000)) return false;
  if (f.cats?.length && !f.cats.includes(catCanon(o.categorie))) return false;
  if (f.q) {
    const hay = norm([o.id, o.titre, o.description, o.categorie, o.sous_categorie, o.auteur, o.periode, o.ecole,
      o.technique, o.zone, o.contenant, o.position, o.marques].filter(Boolean).join(' '));
    if (!f.q.split(/\s+/).filter(Boolean).every(tok => hay.includes(tok))) return false;
  }
  // Fourchette prix : on garde l'objet si [prix_bas, prix_haut] intersecte
  // [min, max] ; un objet sans prix sort dès qu'une borne est renseignée.
  if (f.prixMin != null || f.prixMax != null) {
    if (o.prix_bas == null || o.prix_haut == null) return false;
    if (o.prix_haut < (f.prixMin ?? -Infinity) || o.prix_bas > (f.prixMax ?? Infinity)) return false;
  }
  return true;
}
const objMatches = o => matchFiltre(o, S.filters);

// Les chips catégories ont disparu avec l'accordéon des rayons (HO-043) — la
// sélection par catégorie est portée par les volets et le tiroir. `f.cats` reste
// honoré dans matchFiltre pour les listes sauvegardées existantes.

// ─── Listes sauvegardées (filtres nommés, localStorage par locataire) ───────
// Une liste = { id, nom, q, cats, prixMin, prixMax } — persistance locale
// (iartcane-listes-<tenantId>) : le switcher multi-maisons isole les listes.
const listesKey = () => `iartcane-listes-${S.tenantId}`;
function loadListes() {
  try { return JSON.parse(localStorage.getItem(listesKey())) ?? []; }
  catch { return []; }
}
const saveListes = ls => localStorage.setItem(listesKey(), JSON.stringify(ls));

// Filtre « libre » actif (hors raccourcis codés en dur) = quelque chose à sauvegarder.
const filtreActif = () => !!(S.filters.q || S.filters.cats.length || S.filters.prixMin != null || S.filters.prixMax != null);

// Terme brut de la recherche VALIDÉE (libellé de la pastille) — S.filters.q est
// normalisé (minuscules, sans accents), on garde la saisie pour l'affichage.
let qValide = '';

// La liste sauvegardée active = celle dont le filtre coïncide exactement avec
// l'état courant (toute retouche du filtre après application la désactive).
function listeActive() {
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  return loadListes().find(l =>
    norm(l.q || '') === S.filters.q &&
    same(l.cats ?? [], S.filters.cats) &&
    (l.prixMin ?? null) === S.filters.prixMin &&
    (l.prixMax ?? null) === S.filters.prixMax) ?? null;
}

function syncPrixInputs() {
  $('#prix-min').value = S.filters.prixMin ?? '';
  $('#prix-max').value = S.filters.prixMax ?? '';
}

// Applique une liste sauvegardée : recherche + catégories (legacy) + fourchette prix.
function applyListe(l) {
  qValide = l.q ?? '';
  $('#search').value = qValide;
  S.filters.q = norm(qValide);
  S.filters.cats = [...(l.cats ?? [])];
  S.filters.prixMin = l.prixMin ?? null;
  S.filters.prixMax = l.prixMax ?? null;
  syncPrixInputs();
  closeSheet(); // la liste est appliquée depuis la feuille : on la referme
  renderLists(); renderGrid();
}

function resetFiltre() {
  qValide = '';
  $('#search').value = '';
  S.filters.q = ''; S.filters.cats = []; S.filters.prixMin = null; S.filters.prixMax = null;
  syncPrixInputs();
  renderLists(); renderGrid();
}

// Compteur d'une liste sauvegardée : son filtre rejoué en « virtuel » sur le cache.
const compteListe = l => S.collection.filter(o => matchFiltre(o, {
  q: norm(l.q || ''), cats: l.cats ?? [], prixMin: l.prixMin ?? null, prixMax: l.prixMax ?? null, list: '',
})).length;

// Rendu des listes (3 prédéfinies + sauvegardées) — désormais DANS la feuille
// de filtres (HO-044) : #lists a été déplacé de la toolbar vers #filter-sheet.
function renderLists() {
  const nLoc = S.collection.filter(o => !o.zone || !o.zone.trim()).length;
  const nVal = S.collection.filter(o => o.statut === 'analyse').length;
  const nCher = S.collection.filter(o => o.prix_haut >= 1000).length;
  const defs = [
    ['a_localiser', 'var(--amber)', 'À localiser', nLoc],
    ['a_valider', 'var(--violet)', 'Fiches à valider', nVal],
    ['chere', 'var(--green)', '> 1 000 €', nCher],
  ];
  const actId = listeActive()?.id;
  $('#lists').innerHTML = defs.map(([k, col, label, n]) =>
    `<button class="ls ${S.filters.list === k ? 'active' : ''}" data-list="${k}"><span class="dot" style="background:${col}"></span>${label} <span class="n">${n}</span></button>`
  ).join('') + loadListes().map(l =>
    `<button class="ls ${actId === l.id ? 'active' : ''}" data-slist="${esc(l.id)}">🔖 ${esc(l.nom)} <span class="n">${compteListe(l)}</span><span class="ls-del" data-del="${esc(l.id)}" title="Supprimer la liste « ${esc(l.nom)} »">✕</span></button>`
  ).join('');
  // « Sauvegarder ce filtre » n'a de sens que si un filtre est actif
  $('#btn-save-filter').classList.toggle('hidden', !filtreActif());
  $$('#lists .ls[data-list]').forEach(b => b.addEventListener('click', () => {
    S.filters.list = S.filters.list === b.dataset.list ? '' : b.dataset.list;
    renderLists(); renderGrid();
  }));
  $$('#lists .ls[data-slist]').forEach(b => b.addEventListener('click', e => {
    const ls = loadListes();
    const l = ls.find(x => x.id === b.dataset.slist);
    if (!l) return;
    if (e.target.closest('[data-del]')) {
      if (confirm(`Supprimer la liste « ${l.nom} » ?`)) {
        saveListes(ls.filter(x => x.id !== l.id));
        renderLists();
        toast(`Liste « ${l.nom} » supprimée`);
      }
      return;
    }
    if (actId === l.id) resetFiltre(); else applyListe(l); // reclic = désactive
  }));
}

// ─── Recherche : propositions au fil de la frappe (HO-044, état 3) ──────────
// Simplification tranchée (brief) : la frappe n'alimente QUE les propositions,
// la grille ne se filtre qu'à la validation (Entrée / « Tout voir »).
// Surlignage de la saisie : indices lus sur la forme normalisée (norm préserve
// la longueur pour le français courant), HTML échappé avant injection du <b>.
function surligne(label, q) {
  const i = norm(label).indexOf(q);
  if (i < 0) return esc(label);
  return esc(label.slice(0, i)) + '<b>' + esc(label.slice(i, i + q.length)) + '</b>' + esc(label.slice(i + q.length));
}

function renderSuggest(raw) {
  const box = $('#search-suggest');
  const vue = $('#view-collection');
  const q = norm(raw);
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; vue.classList.remove('searching'); return; }
  vue.classList.add('searching'); // grille derrière atténuée (état 3)
  const artistes = [...new Set(S.collection.map(o => o.auteur).filter(Boolean))]
    .filter(a => norm(a).includes(q)).slice(0, 4);
  const objets = S.collection
    .filter(o => matchFiltre(o, { q, cats: [], prixMin: null, prixMax: null, list: '' }))
    .slice(0, 5);
  const sec = (titre, inner) => inner ? `<div class="sug-sec"><div class="sug-title">${titre}</div>${inner}</div>` : '';
  box.innerHTML = '<div class="sug-head">Propositions</div>'
    + sec('Artistes', artistes.map(a =>
      `<button class="sug-artiste" data-artiste="${esc(a)}">${surligne(a, q)}</button>`).join(''))
    + sec('Objets', objets.map(o => {
      const ph = S.photoMap[o.id];
      const img = ph?.url ? `<img src="${esc(ph.url)}" alt="" loading="lazy">` : `<span class="sug-emoji">${catEmoji(o.categorie)}</span>`;
      return `<button class="sug-objet" data-oid="${esc(o.id)}">${img}<span class="sug-objet-t"><span class="sug-objet-titre">${surligne(o.titre || '(sans titre)', q)}</span><span class="sug-objet-meta">#${esc(o.id)} · ${esc(catCanon(o.categorie) ?? '')}</span></span></button>`;
    }).join(''))
    + `<button class="sug-all">Tout voir pour « ${esc(raw.trim())} »</button>`;
  box.classList.remove('hidden');
  $$('.sug-artiste', box).forEach(b => b.addEventListener('click', () => {
    location.hash = '#/artiste/' + encodeURIComponent(b.dataset.artiste);
  }));
  $$('.sug-objet', box).forEach(b => b.addEventListener('click', () => {
    location.hash = '#/objet/' + encodeURIComponent(b.dataset.oid);
  }));
  $('.sug-all', box).addEventListener('click', validerRecherche);
}

// Validation (Entrée / « Tout voir ») : la saisie devient le filtre q, la ligne
// se referme et le terme apparaît en pastille (état 4).
function validerRecherche() {
  const v = $('#search').value.trim();
  if (!v) return;
  qValide = v;
  S.filters.q = norm(v);
  $('#search-suggest').classList.add('hidden');
  $('#view-collection').classList.remove('searching');
  closeSearchLine();
  renderLists(); renderGrid();
}

// Réplique de setSearchLine(false) du shell — app.js est hors périmètre HO-044.
function closeSearchLine() {
  $('#page-title-line').classList.remove('hidden');
  $('#page-search-line').classList.add('hidden');
  $('#btn-search-toggle').setAttribute('aria-expanded', 'false');
}

// ─── Pastilles des critères actifs (HO-044, état 4) ─────────────────────────
// Chaque critère actif (recherche validée incluse) = une pastille retirable ;
// « Tout effacer » réinitialise tout. Le badge de l'entonnoir les compte.
const LIBELLES_LISTES = { a_localiser: 'À localiser', a_valider: 'Fiches à valider', chere: '≥ 1 000 €' };
const LOUPE_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

function compteCriteres() {
  const f = S.filters;
  return (f.q ? 1 : 0) + (f.list ? 1 : 0)
    + ((f.prixMin != null || f.prixMax != null) ? 1 : 0)
    + (f.group !== 'categorie' ? 1 : 0);
}

function renderPills() {
  const row = $('#pills');
  const f = S.filters;
  const pill = (k, inner, label) =>
    `<button class="pill" data-pill="${k}" aria-label="Retirer le filtre ${esc(label)}">${inner}<span class="pill-x" aria-hidden="true">×</span></button>`;
  const p = [];
  if (f.q) p.push(pill('q', LOUPE_SVG + esc(qValide || f.q), `recherche « ${qValide || f.q} »`));
  if (f.prixMin != null || f.prixMax != null) {
    const t = f.prixMin != null && f.prixMax != null ? `${f.prixMin}–${f.prixMax} €`
      : f.prixMin != null ? `≥ ${f.prixMin} €` : `≤ ${f.prixMax} €`;
    p.push(pill('prix', esc(t), `prix ${t}`));
  }
  if (f.list) {
    const t = LIBELLES_LISTES[f.list] ?? f.list;
    p.push(pill('list', esc(t), t));
  }
  const la = listeActive();
  if (la) p.push(pill('slist', `🔖 ${esc(la.nom)}`, `liste « ${la.nom} »`));
  if (f.group !== 'categorie') {
    const t = f.group === 'zone' ? 'regroupé par lieu' : f.group === 'periode' ? 'regroupé par période' : 'sans regroupement';
    p.push(pill('group', t, t));
  }
  row.classList.toggle('hidden', !p.length);
  row.innerHTML = p.join('') + (p.length ? '<button class="pills-clear" id="pills-clear">Tout effacer</button>' : '');
  $$('.pill', row).forEach(b => b.addEventListener('click', () => retirerPastille(b.dataset.pill)));
  $('#pills-clear')?.addEventListener('click', toutEffacer);
}

function retirerPastille(k) {
  const f = S.filters;
  if (k === 'q') { qValide = ''; f.q = ''; $('#search').value = ''; }
  else if (k === 'prix') { f.prixMin = null; f.prixMax = null; syncPrixInputs(); }
  else if (k === 'list') f.list = '';
  else if (k === 'slist') { f.list = ''; resetFiltre(); return; } // la liste = tout son filtre
  else if (k === 'group') { f.group = 'categorie'; $('#group-by').value = 'categorie'; }
  renderLists(); renderGrid();
}

function toutEffacer() {
  S.filters.list = '';
  S.filters.group = 'categorie'; $('#group-by').value = 'categorie';
  resetFiltre(); // vide q/prix/cats + re-render
}

// Badge de l'entonnoir (#filters-count, posé par HO-042) = nombre de critères
// actifs, recherche validée incluse ; les deux entonnoirs passent en état actif.
function updateFiltresUi() {
  const n = compteCriteres();
  const b = $('#filters-count');
  b.textContent = n || '';
  b.classList.toggle('hidden', !n);
  $('#btn-filters').classList.toggle('on', !!n);
  $('#btn-filters-2').classList.toggle('on', !!n);
  // Loupe : état actif visible si une recherche est validée (sinon le filtre
  // serait actif ET invisible — piège de la progressive disclosure)
  $('#btn-search-toggle').classList.toggle('on', !!S.filters.q);
  renderPills();
}

function renderGrid() {
  const body = $('#collection-body');
  updateFiltresUi();
  syncVoletsToggle(false); // masqué par défaut — seul l'accordéon au repos l'affiche
  const items = S.collection.filter(objMatches);
  if (!S.collection.length) {
    body.innerHTML = emptyHtml('Aucun objet pour l’instant', 'Capture ton premier objet — photo + n° d’étiquette, l’IA fait le reste.');
    return;
  }
  if (!items.length) {
    // Aucun résultat : accuser les filtres actifs + sortie en 1 tap (référentiel §4.5)
    const avecFiltres = filtreActif() || S.filters.list;
    body.innerHTML = emptyHtml('Rien ne correspond', 'Essaie d’autres mots, un n° d’étiquette, un lieu…',
      avecFiltres ? '<button class="btn" id="btn-reset-filtres" style="margin-top:16px">Réinitialiser les filtres</button>' : '');
    $('#btn-reset-filtres')?.addEventListener('click', () => { S.filters.list = ''; toutEffacer(); });
    return;
  }
  const g = S.filters.group;
  // Accordéon des rayons (HO-043/HO-044, design étape 2) : rendu par défaut
  // (regroupement catégorie). En mode filtré, les rayons à résultats s'ouvrent
  // (« 9 sur 12 ») et les rayons vides sont regroupés sous « SANS RÉSULTAT ».
  // Les autres regroupements (lieu/période/none) gardent le rendu historique.
  if (g === 'categorie' && !filtreActif() && !S.filters.list) {
    renderAccordeon(body, items);
    syncVoletsToggle(true);
  } else if (g === 'categorie') {
    renderAccordeonFiltre(body, items);
    syncVoletsToggle(false);
  } else if (!g) {
    body.innerHTML = `<div class="grid">${items.map(cardHtml).join('')}</div>`;
  } else {
    const groups = new Map();
    for (const o of items) {
      const raw = String(g === 'categorie' ? (catCanon(o.categorie) ?? '') : (o[g] ?? '')).trim();
      const k = raw || (g === 'zone' ? 'Non localisé' : g === 'periode' ? 'Période inconnue' : 'Sans catégorie');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    body.innerHTML = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'))
      .map(([k, arr]) => `<div class="group-title">${esc(k)} <span class="n">${arr.length}</span></div><div class="grid">${arr.map(cardHtml).join('')}</div>`)
      .join('');
  }
  $$('.card', body).forEach(c => {
    const go = () => { location.hash = '#/objet/' + encodeURIComponent(c.dataset.oid); };
    c.addEventListener('click', go);
    // Carte = div focusable (role="button") : Enter/Espace = même navigation que le clic
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// ─── Accordéon des rayons (HO-043, design handoff étape 2) ─────────────────
// Une carte blanche par catégorie : volet ouvert = 9 objets + pied « Voir les
// N … » (→ vue rayon), volet fermé = ligne 46px + 3 vignettes des pièces les
// mieux estimées. État persisté par locataire ; « jamais enregistré » (clé
// absente → 1er rayon ouvert) ≠ « tout fermé » (clé = [], état valide).
const voletsKey = () => `iartcane-volets-${S.tenantId}`;
function loadVolets() {
  const raw = localStorage.getItem(voletsKey());
  if (raw === null) return null;
  try { return JSON.parse(raw) ?? []; } catch { return []; }
}
const saveVolets = v => localStorage.setItem(voletsKey(), JSON.stringify(v));

// « Tout ouvrir / Tout fermer » au bout de la ligne de titre (demande Yann) :
// bascule tous les volets d'un coup, en respectant la persistance — « tout
// fermé » = [] (état valide, HO-043). Visible uniquement en accordéon au repos
// (en mode filtré, les volets sont pilotés par les résultats).
const tousLesRayons = () => [...new Set(S.collection.map(o => catCanon(o.categorie) || 'Sans catégorie'))];
function syncVoletsToggle(accordeonAuRepos) {
  const b = $('#volets-toggle');
  if (!b) return;
  b.classList.toggle('hidden', !accordeonAuRepos);
  if (!accordeonAuRepos) return;
  const cats = tousLesRayons();
  const persistes = loadVolets();
  const ouverts = persistes ?? (cats.length ? [cats[0]] : []);
  const tousOuverts = cats.length > 0 && cats.every(c => ouverts.includes(c));
  b.textContent = tousOuverts ? 'Tout fermer' : 'Tout ouvrir';
  b.setAttribute('aria-pressed', String(tousOuverts));
}
$('#volets-toggle')?.addEventListener('click', () => {
  const cats = tousLesRayons();
  const persistes = loadVolets();
  const ouverts = persistes ?? (cats.length ? [cats[0]] : []);
  const tousOuverts = cats.length > 0 && cats.every(c => ouverts.includes(c));
  saveVolets(tousOuverts ? [] : cats);
  renderGrid();
});

// Libellé du pied de volet : « Voir les 12 tableaux » — accord simple (minuscule
// + « s »), repli robuste pour les rayons composés (« argenterie/métal »…).
function libelleRayon(k, n) {
  const bas = k.toLowerCase();
  if (bas.includes('/') || /[sx]$/.test(bas)) return `Voir les ${n} objets · ${k}`;
  return `Voir les ${n} ${bas}s`;
}

function renderAccordeon(body, items) {
  const groupes = new Map();
  for (const o of items) {
    const k = catCanon(o.categorie) || 'Sans catégorie';
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(o);
  }
  const tries = [...groupes.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'));
  const persistes = loadVolets();
  const ouverts = persistes ?? (tries.length ? [tries[0][0]] : []);
  body.innerHTML = tries.map(([k, arr]) => {
    const open = ouverts.includes(k);
    // Vignettes du volet fermé : les 3 pièces les mieux estimées du rayon.
    const top3 = [...arr].sort((a, b) => (b.prix_haut ?? -1) - (a.prix_haut ?? -1)).slice(0, 3);
    const thumbs = top3.map(o => {
      const ph = S.photoMap[o.id];
      return ph?.url ? `<img src="${esc(ph.url)}" alt="" loading="lazy">` : `<span class="thumb-emoji">${catEmoji(o.categorie)}</span>`;
    }).join('');
    const apercu = arr.slice(0, 9).map(cardHtml).join('');
    const pied = arr.length > 9 ? `<button class="cat-more" data-cat="${esc(k)}">${esc(libelleRayon(k, arr.length))}</button>` : '';
    return `<section class="cat-pane ${open ? 'open' : ''}" data-cat="${esc(k)}">
      <button class="cat-head" aria-expanded="${open}">
        <span class="cat-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
        <span class="cat-name">${esc(k)}</span>
        <span class="cat-total">${arr.length}</span>
        ${open ? '' : `<span class="cat-thumbs">${thumbs}</span>`}
      </button>
      <div class="cat-body"><div class="grid">${apercu}</div>${pied}</div>
    </section>`;
  }).join('');
  $$('.cat-head', body).forEach(h => h.addEventListener('click', () => {
    const cat = h.closest('.cat-pane').dataset.cat;
    // Matérialiser l'état affiché avant bascule si rien n'était encore persisté.
    const courant = loadVolets() ?? ouverts;
    const i = courant.indexOf(cat);
    if (i >= 0) courant.splice(i, 1); else courant.push(cat);
    saveVolets(courant);
    renderGrid();
  }));
  $$('.cat-more', body).forEach(b => b.addEventListener('click', () => {
    location.hash = '#/rayon/' + encodeURIComponent(b.dataset.cat);
  }));
}

// ─── Accordéon en mode filtré (HO-044, état 4) ──────────────────────────────
// Le filtre porte sur TOUT l'inventaire, volets ouverts ou non : les rayons à
// résultats s'ouvrent d'eux-mêmes (« 9 sur 12 », pied « Voir les 9 résultats »),
// les rayons vides sont regroupés en bas sous « SANS RÉSULTAT » à 50 %. La
// bascule des volets est ici visuelle seulement — l'état persisté (HO-043)
// n'est pas touché et est restauré quand les pastilles sont retirées.
function renderAccordeonFiltre(body, items) {
  const parCat = new Map(); // cat → { total, trouves[] }
  for (const o of S.collection) {
    const k = catCanon(o.categorie) || 'Sans catégorie';
    if (!parCat.has(k)) parCat.set(k, { total: 0, trouves: [] });
    const g = parCat.get(k);
    g.total++;
    if (objMatches(o)) g.trouves.push(o);
  }
  const tries = [...parCat.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], 'fr'));
  const avec = tries.filter(([, g]) => g.trouves.length);
  const sans = tries.filter(([, g]) => !g.trouves.length);
  const ligne = `<div class="result-line">${items.length} objet${items.length > 1 ? 's' : ''} dans ${avec.length} rayon${avec.length > 1 ? 's' : ''} sur ${tries.length}</div>`;
  const paneAvec = ([k, g]) => {
    const t = g.trouves.length;
    const apercu = g.trouves.slice(0, 9).map(cardHtml).join('');
    const pied = (t > 9 || t < g.total)
      ? `<button class="cat-more" data-cat="${esc(k)}">${t > 1 ? `Voir les ${t} résultats` : 'Voir le résultat'}</button>` : '';
    return `<section class="cat-pane open" data-cat="${esc(k)}">
      <button class="cat-head" aria-expanded="true">
        <span class="cat-chev" aria-hidden="true">▾</span>
        <span class="cat-name">${esc(k)}</span>
        <span class="cat-total cat-sur">${t} sur ${g.total}</span>
      </button>
      <div class="cat-body"><div class="grid">${apercu}</div>${pied}</div>
    </section>`;
  };
  const paneSans = ([k, g]) => `<section class="cat-pane cat-vide" data-cat="${esc(k)}">
      <button class="cat-head" aria-expanded="false">
        <span class="cat-chev" aria-hidden="true">▸</span>
        <span class="cat-name">${esc(k)}</span>
        <span class="cat-total">0 sur ${g.total}</span>
      </button>
      <div class="cat-body"></div>
    </section>`;
  body.innerHTML = ligne + avec.map(paneAvec).join('')
    + (sans.length ? '<div class="sans-res-title">Sans résultat</div>' + sans.map(paneSans).join('') : '');
  $$('.cat-head', body).forEach(h => h.addEventListener('click', () => {
    const p = h.closest('.cat-pane');
    const open = p.classList.toggle('open');
    h.setAttribute('aria-expanded', String(open));
    $('.cat-chev', h).textContent = open ? '▾' : '▸';
  }));
  $$('.cat-more', body).forEach(b => b.addEventListener('click', () => {
    location.hash = '#/rayon/' + encodeURIComponent(b.dataset.cat);
  }));
}

// ─── Feuille de filtres (HO-044, entonnoir du bandeau) ─────────────────────
// Regroupe tous les critères (prix, regroupement, listes, sauvegarde) + export
// CSV. Fermeture : voile, Échap, croix.
function openSheet() {
  $('#sheet-veil').classList.remove('hidden');
  $('#filter-sheet').classList.remove('hidden');
  $('#btn-filters').setAttribute('aria-expanded', 'true');
}
function closeSheet() {
  if ($('#filter-sheet').classList.contains('hidden')) return;
  $('#sheet-veil').classList.add('hidden');
  $('#filter-sheet').classList.add('hidden');
  $('#btn-filters').setAttribute('aria-expanded', 'false');
}
$('#btn-filters').addEventListener('click', openSheet);
// #btn-filters-2 (ligne de recherche) délègue déjà à #btn-filters côté shell.
$('#sheet-veil').addEventListener('click', closeSheet);
$('#sheet-close').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ─── Recherche : saisie = propositions seulement (débounce 150ms), la grille
// ne se filtre qu'à la validation (Entrée / « Tout voir ») — brief HO-044 §4.
let searchTimer;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderSuggest(e.target.value), 150);
});
$('#search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); validerRecherche(); }
});
// Loupe : le shell bascule la ligne (app.js) ; si elle s'ouvre avec une saisie
// en cours, on réaffiche les propositions.
$('#btn-search-toggle').addEventListener('click', () => {
  if (!$('#page-search-line').classList.contains('hidden')) renderSuggest($('#search').value);
});
// Croix (spec étape 2 §Interactions) : 1er appui = vider le champ SEULEMENT ;
// 2e appui (champ déjà vide) = refermer la ligne. Le handler du shell (posé en
// HO-042, app.js hors périmètre) referme toujours la ligne — quand le champ
// était rempli on la rouvre dans le même dispatch (aucun repaint entre les
// deux handlers), pour un 1er appui « vider » conforme.
$('#btn-search-close').addEventListener('click', () => {
  const avaitSaisie = !!$('#search').value;
  $('#search').value = '';
  $('#search-suggest').classList.add('hidden');
  $('#view-collection').classList.remove('searching');
  if (avaitSaisie) {
    $('#page-title-line').classList.add('hidden');
    $('#page-search-line').classList.remove('hidden');
    $('#btn-search-toggle').setAttribute('aria-expanded', 'true');
    $('#search').focus();
  }
  // La recherche déjà validée (pastille) n'est pas touchée par la croix.
});

// Filtre prix (même débounce) + regroupement — les contrôles vivent désormais
// dans la feuille de filtres (ids conservés).
for (const [id, key] of [['#prix-min', 'prixMin'], ['#prix-max', 'prixMax']]) {
  $(id).addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = e.target.valueAsNumber;
      S.filters[key] = Number.isNaN(v) ? null : v; // champ vide = borne non renseignée
      renderLists(); renderGrid();
    }, 150);
  });
}
$('#group-by').addEventListener('change', e => { S.filters.group = e.target.value; renderGrid(); });

// « 💾 Sauvegarder ce filtre » : l'état courant (recherche validée + prix)
// devient une liste nommée, persistée en local pour ce locataire.
$('#btn-save-filter').addEventListener('click', () => {
  const nom = prompt('Nom de cette liste :', qValide || $('#search').value.trim() || 'Ma liste');
  if (!nom?.trim()) return;
  const ls = loadListes();
  ls.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nom: nom.trim(),
    q: qValide || $('#search').value.trim(),
    cats: [...S.filters.cats],
    prixMin: S.filters.prixMin,
    prixMax: S.filters.prixMax,
  });
  saveListes(ls);
  renderLists();
  toast(`Liste « ${nom.trim()} » sauvegardée`);
});

// ─── Export CSV (Excel fr-FR : séparateur ';', BOM, champs quotés) ──────────
// Exporte les objets ACTUELLEMENT FILTRÉS (« ma liste → CSV »), pas toute la
// collection. Prix bruts (pas de séparateur de milliers dans le CSV).
const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
$('#btn-csv').addEventListener('click', () => {
  const items = S.collection.filter(objMatches);
  if (!items.length) { toast('Aucun objet ne correspond au filtre — rien à exporter', true); return; }
  const head = ['N°', 'Titre', 'Catégorie', 'Auteur', 'Période', 'École', 'Technique', 'État',
    'Prix bas (€)', 'Prix haut (€)', 'Confiance', 'Statut', 'Zone', 'Contenant', 'Position', 'Créé le'];
  const lignes = items.map(o => [
    o.id, o.titre, catCanon(o.categorie) ?? o.categorie, o.auteur, o.periode, o.ecole,
    o.technique, o.etat, o.prix_bas, o.prix_haut, o.confiance, STATUTS[o.statut] ?? o.statut,
    o.zone, o.contenant, o.position, o.created_at,
  ].map(csvCell).join(';'));
  const csv = '﻿' + head.map(csvCell).join(';') + '\r\n' + lignes.join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `iartcane-collection-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${items.length} ${items.length > 1 ? 'objets exportés' : 'objet exporté'}`);
});
