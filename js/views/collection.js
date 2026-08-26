// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/collection.js : listing, recherche, filtres, listes, CSV
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, norm, toast, emptyHtml } from '../core/dom.js';
import { S } from '../core/state.js';
import { catCanon, cardHtml, STATUTS } from '../core/format.js';
import { sb, loadPhotoMap } from '../core/data.js';
import { loadViewCss } from '../core/css.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('collection');

export function mount() {
  loadCollection();
}

async function loadCollection() {
  const body = $('#collection-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const { data, error } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).order('created_at', { ascending: false });
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  S.collection = data ?? [];
  await loadPhotoMap();
  renderChips();
  renderLists();
  renderGrid();
}

// Prédicat de filtrage pur — utilisé par objMatches (filtre courant) et par
// renderLists (compteurs des listes sauvegardées, filtres « virtuels »).
function matchFiltre(o, f) {
  if (f.list === 'a_localiser' && o.zone && o.zone.trim()) return false;
  if (f.list === 'a_valider' && o.statut !== 'fiche_prete') return false;
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

// Chips catégories multi-cochables (« Tous » = aucune cochée) — une liste
// sauvegardée peut viser plusieurs catégories canoniques à la fois.
function renderChips() {
  const cats = [...new Set(S.collection.map(o => catCanon(o.categorie)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  $('#chips').innerHTML = [`<button class="chip ${S.filters.cats.length === 0 ? 'active' : ''}" data-chip="">Tous</button>`]
    .concat(cats.map(c => `<button class="chip ${S.filters.cats.includes(c) ? 'active' : ''}" data-chip="${esc(c)}">${esc(c)}</button>`))
    .join('');
  $$('#chips .chip').forEach(ch => ch.addEventListener('click', () => {
    const c = ch.dataset.chip;
    if (c === '') S.filters.cats = [];
    else {
      const i = S.filters.cats.indexOf(c);
      if (i >= 0) S.filters.cats.splice(i, 1); else S.filters.cats.push(c);
    }
    renderChips(); renderLists(); renderGrid();
  }));
}

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

// Applique une liste sauvegardée : recherche + chips catégories + fourchette prix.
function applyListe(l) {
  $('#search').value = l.q ?? '';
  S.filters.q = norm(l.q ?? '');
  if (l.q) toolbarEl().classList.add('search-open'); // recherche active → barre dépliée (sinon filtre invisible)
  S.filters.cats = [...(l.cats ?? [])];
  S.filters.prixMin = l.prixMin ?? null;
  S.filters.prixMax = l.prixMax ?? null;
  syncPrixInputs();
  renderChips(); renderLists(); renderGrid();
}

function resetFiltre() {
  $('#search').value = '';
  S.filters.q = ''; S.filters.cats = []; S.filters.prixMin = null; S.filters.prixMax = null;
  syncPrixInputs();
  renderChips(); renderLists(); renderGrid();
}

// Compteur d'une liste sauvegardée : son filtre rejoué en « virtuel » sur le cache.
const compteListe = l => S.collection.filter(o => matchFiltre(o, {
  q: norm(l.q || ''), cats: l.cats ?? [], prixMin: l.prixMin ?? null, prixMax: l.prixMax ?? null, list: '',
})).length;

function renderLists() {
  const nLoc = S.collection.filter(o => !o.zone || !o.zone.trim()).length;
  const nVal = S.collection.filter(o => o.statut === 'fiche_prete').length;
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

function renderGrid() {
  const body = $('#collection-body');
  updateFiltersCount();
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
    $('#btn-reset-filtres')?.addEventListener('click', () => { S.filters.list = ''; resetFiltre(); });
    return;
  }
  const g = S.filters.group;
  if (!g) {
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

// Recherche (débounce) + filtre prix (même débounce) + regroupement
let searchTimer;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.filters.q = norm(e.target.value); renderLists(); renderGrid(); }, 150);
});
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

// Panneau « Filtres » mobile (progressive disclosure, référentiel §4.1) :
// la pastille compte les filtres actifs cachés dans le panneau (bornes prix,
// regroupement ≠ défaut) ; recherche et chips, elles, restent visibles.
function updateFiltersCount() {
  const n = (S.filters.prixMin != null) + (S.filters.prixMax != null) + (S.filters.group !== 'categorie');
  const b = $('#filters-count');
  b.textContent = n || '';
  b.classList.toggle('hidden', !n);
  // Loupe repliée : état actif visible si une recherche est en cours (sinon
  // le filtre serait caché ET invisible — piège de la progressive disclosure)
  $('#btn-search-toggle').classList.toggle('on', !!S.filters.q);
}
$('#btn-filters').addEventListener('click', () => {
  const open = $('#filters-panel').classList.toggle('open');
  $('#btn-filters').setAttribute('aria-expanded', String(open));
});

// Recherche repliée en loupe (mobile) : tap → la barre se déploie avec
// autofocus ; « × » efface la recherche en cours puis referme la barre.
const toolbarEl = () => $('#view-collection .toolbar');
$('#btn-search-toggle').addEventListener('click', () => {
  const open = toolbarEl().classList.toggle('search-open');
  $('#btn-search-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('#search').focus();
});
$('#btn-search-close').addEventListener('click', () => {
  if ($('#search').value) {
    $('#search').value = '';
    S.filters.q = '';
    renderLists(); renderGrid();
  }
  toolbarEl().classList.remove('search-open');
  $('#btn-search-toggle').setAttribute('aria-expanded', 'false');
});

// « 💾 Sauvegarder ce filtre » : l'état courant (recherche + chips + prix)
// devient une liste nommée, persistée en local pour ce locataire.
$('#btn-save-filter').addEventListener('click', () => {
  const nom = prompt('Nom de cette liste :', $('#search').value.trim() || 'Ma liste');
  if (!nom?.trim()) return;
  const ls = loadListes();
  ls.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    nom: nom.trim(),
    q: $('#search').value.trim(),
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
  const csv = '\uFEFF' + head.map(csvCell).join(';') + '\r\n' + lignes.join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `iartcane-collection-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${items.length} ${items.length > 1 ? 'objets exportés' : 'objet exporté'}`);
});
