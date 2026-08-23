// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — app.js (site statique, vanilla JS, aucun build)
// Branché sur Supabase : auth magic link, objets/photos/fiches/comparables/jobs.
// Règle d'or affichée : jamais un chiffre sans comparables vendus.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.IARTCANE_CONFIG;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Petits utilitaires ─────────────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmtNum = n => Number(n).toLocaleString('fr-FR');
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
const pinSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';
const infoSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>';

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4500);
}

const STATUTS = {
  capture: 'Capturé', en_file: 'En file', analyse: 'Analyse…', fiche_prete: 'Fiche prête',
  a_completer: 'À compléter', validee: 'Validée', contestee: 'Contestée',
};
const ST_COLOR = {
  capture: '#9A6B1A', en_file: '#2456E0', analyse: '#2456E0', fiche_prete: '#6D4AC8',
  a_completer: '#9A6B1A', validee: '#1E7A46', contestee: '#B3261E',
};
// Confiance comptée 0–4 : 4/4 = validée par un humain (ground truth), sinon 1-3 selon l'IA.
const confMarks = o => o.statut === 'validee' ? 4 : ({ haute: 3, moyenne: 2, basse: 1 }[o.confiance] ?? 0);
const confHtml = n => `<span class="conf">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}<span class="conf-label">${n}/4</span></span>`;

function catEmoji(cat) {
  const c = norm(cat);
  if (/peint|tableau|huile|aquarel/.test(c)) return '🖼️';
  if (/montre|horlog|gousset/.test(c)) return '⌚';
  if (/ceram|porcel|faience|vase|terre cuite/.test(c)) return '🏺';
  if (/bijou|bague|broche|collier|bracelet/.test(c)) return '💍';
  if (/grav|estamp|litho|dessin|encre/.test(c)) return '📜';
  if (/meuble|mobilier/.test(c)) return '🪑';
  if (/livre|manuscrit/.test(c)) return '📖';
  if (/verre|verrerie|cristal/.test(c)) return '🥃';
  return '🏺';
}
const prixHtml = o => (o.prix_bas != null && o.prix_haut != null)
  ? `<span class="price">${fmtNum(o.prix_bas)}–${fmtNum(o.prix_haut)} €</span>`
  : '<span class="price none">à estimer</span>';
const emptyHtml = (t, s) => `<div class="empty"><div class="big">🗃️</div><h2>${esc(t)}</h2><p>${esc(s)}</p></div>`;
const isVideo = p => p.kind === 'video' || /\.(mp4|mov|webm)$/i.test(p.storage_path || '');

// ─── État ───────────────────────────────────────────────────────────────────
let user = null;
let tenantId = null;          // locataire courant : soi-même, ou l'owner dont on est membre (D-015)
let tenantName = '';          // nom de la « maison » (D-016) — ex. PONAIRE
let collection = [];           // cache des objets (rechargé à chaque visite collection)
let photoMap = {};             // objet_id → URL signée de la 1re photo
const filters = { q: '', chip: '', group: 'categorie', list: '' };
let currentObjet = null, currentComps = [], currentFiche = null, currentPhotos = [];
let editing = false;
let capFiles = [];

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════
sb.auth.onAuthStateChange((_event, session) => {
  user = session?.user ?? null;
  if (user) enterApp(); else showLogin();
});

function show(view) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  window.scrollTo({ top: 0 });
}
function showLogin() {
  $('#tabs').classList.add('hidden');
  $('#avatar').classList.add('hidden');
  $('#header-counter').textContent = '';
  show('login');
}
async function enterApp() {
  $('#tabs').classList.remove('hidden');
  $('#avatar').classList.remove('hidden');
  await resolveTenant();
  await Promise.all([loadHeader(), loadProfile()]);
  route();
}

// Locataire courant : si l'utilisateur est membre d'une collection (magasin),
// c'est ELLE qu'il voit et alimente — le même catalogue pour tous les vendeurs (D-015).
// v1 : un seul locataire partagé pris en compte (le premier) ; switcher multi-locataires plus tard.
async function resolveTenant() {
  const { data } = await sb.from('collection_members').select('owner_id').eq('member_id', user.id).limit(1);
  tenantId = data?.[0]?.owner_id ?? user.id;
  const { data: t } = await sb.from('tenants').select('name').eq('owner_id', tenantId).maybeSingle();
  tenantName = t?.name ?? '';
}

$('#login-btn').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  if (!email) { $('#login-email').focus(); return; }
  const btn = $('#login-btn');
  btn.disabled = true;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  btn.disabled = false;
  $('#login-msg').innerHTML = error
    ? `<div class="login-err">Erreur : ${esc(error.message)}</div>`
    : '<div class="login-ok">✓ Lien envoyé — vérifie ta boîte (et les spams). Le lien te reconnecte ici automatiquement.</div>';
});
$('#login-email').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login-btn').click(); });
$('#avatar').addEventListener('click', async () => { await sb.auth.signOut(); location.hash = ''; });

async function loadProfile() {
  const { data } = await sb.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  const name = data?.display_name || user.email || '?';
  $('#avatar').textContent = name.trim().charAt(0).toUpperCase();
  $('#avatar').title = `${name} — se déconnecter`;
}

async function loadHeader() {
  const [{ count }, { data: next }] = await Promise.all([
    sb.from('objets').select('*', { count: 'exact', head: true }).eq('owner_id', tenantId),
    sb.rpc('peek_objet_id', { p_owner: tenantId }),
  ]);
  const n = count ?? 0;
  const label = tenantName ? `${esc(tenantName)} · ` : (tenantId !== user.id ? 'catalogue partagé · ' : '');
  $('#header-counter').innerHTML = `${label}<b>${fmtNum(n)}</b> objet${n > 1 ? 's' : ''} · prochain n° <b>${next ?? '—'}</b>`;
  $('#tab-count').textContent = n;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTEUR (hash)
// ═══════════════════════════════════════════════════════════════════════════
function setTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
}
function route() {
  if (!user) return;
  const h = location.hash || '#/';
  const mObj = h.match(/^#\/objet\/([^/]+)$/);
  if (h.startsWith('#/capture')) { setTab('capture'); show('capture'); initCapture(); }
  else if (mObj) { setTab('collection'); show('objet'); loadObjet(decodeURIComponent(mObj[1])); }
  else { setTab('collection'); show('collection'); loadCollection(); }
}
window.addEventListener('hashchange', route);
$$('.tab').forEach(t => t.addEventListener('click', () => { location.hash = t.dataset.view === 'capture' ? '#/capture' : '#/'; }));
$('#logo-home').addEventListener('click', () => { location.hash = '#/'; });
$('#obj-back').addEventListener('click', () => { location.hash = '#/'; });

// ═══════════════════════════════════════════════════════════════════════════
// VUE COLLECTION
// ═══════════════════════════════════════════════════════════════════════════
async function loadCollection() {
  const body = $('#collection-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const { data, error } = await sb.from('objets').select('*').eq('owner_id', tenantId).order('created_at', { ascending: false });
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  collection = data ?? [];
  await loadPhotoMap();
  renderChips();
  renderLists();
  renderGrid();
}

async function loadPhotoMap() {
  photoMap = {};
  if (!collection.length) return;
  const { data } = await sb.from('photos').select('objet_id,storage_path').order('created_at');
  const first = {};
  for (const p of data ?? []) if (!first[p.objet_id]) first[p.objet_id] = p.storage_path;
  const urlByPath = await signPaths(Object.values(first));
  for (const [oid, p] of Object.entries(first)) if (urlByPath[p]) photoMap[oid] = urlByPath[p];
}

// Signe un lot de chemins du bucket privé 'photos' → { path: url }
async function signPaths(paths) {
  if (!paths.length) return {};
  const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600);
  const out = {};
  for (const s of data ?? []) if (s?.signedUrl) out[s.path] = s.signedUrl;
  return out;
}

function objMatches(o) {
  const f = filters;
  if (f.list === 'a_localiser' && o.zone && o.zone.trim()) return false;
  if (f.list === 'a_valider' && o.statut !== 'fiche_prete') return false;
  if (f.list === 'chere' && !(o.prix_haut >= 1000)) return false;
  if (f.chip && norm(o.categorie) !== norm(f.chip)) return false;
  if (f.q) {
    const hay = norm([o.id, o.titre, o.description, o.categorie, o.auteur, o.periode, o.ecole,
      o.technique, o.zone, o.contenant, o.position, o.marques].filter(Boolean).join(' '));
    if (!f.q.split(/\s+/).filter(Boolean).every(tok => hay.includes(tok))) return false;
  }
  return true;
}

function renderChips() {
  const cats = [...new Set(collection.map(o => o.categorie).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  $('#chips').innerHTML = [`<button class="chip ${filters.chip === '' ? 'active' : ''}" data-chip="">Tous</button>`]
    .concat(cats.map(c => `<button class="chip ${filters.chip === c ? 'active' : ''}" data-chip="${esc(c)}">${esc(c)}</button>`))
    .join('');
  $$('#chips .chip').forEach(ch => ch.addEventListener('click', () => {
    filters.chip = ch.dataset.chip;
    renderChips(); renderGrid();
  }));
}

function renderLists() {
  const nLoc = collection.filter(o => !o.zone || !o.zone.trim()).length;
  const nVal = collection.filter(o => o.statut === 'fiche_prete').length;
  const nCher = collection.filter(o => o.prix_haut >= 1000).length;
  const defs = [
    ['a_localiser', 'var(--amber)', 'À localiser', nLoc],
    ['a_valider', 'var(--violet)', 'Fiches à valider', nVal],
    ['chere', 'var(--green)', '> 1 000 €', nCher],
  ];
  $('#lists').innerHTML = defs.map(([k, col, label, n]) =>
    `<button class="ls ${filters.list === k ? 'active' : ''}" data-list="${k}"><span class="dot" style="background:${col}"></span>${label} <span class="n">${n}</span></button>`
  ).join('');
  $$('#lists .ls').forEach(b => b.addEventListener('click', () => {
    filters.list = filters.list === b.dataset.list ? '' : b.dataset.list;
    renderLists(); renderGrid();
  }));
}

function cardHtml(o) {
  const img = photoMap[o.id];
  const marks = confMarks(o);
  const loc = (o.zone || o.contenant)
    ? esc([o.zone, o.contenant].filter(Boolean).join(' / '))
    : '<em>non localisé</em>';
  const meta = [o.categorie, o.periode, o.ecole].filter(Boolean).map(esc).join(' · ') || '<em>à identifier</em>';
  return `<article class="card" data-oid="${esc(o.id)}">
    <div class="card-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : catEmoji(o.categorie)}<span class="card-id">#${esc(o.id)}</span><span class="card-status" style="background:${ST_COLOR[o.statut] || '#8A94B8'}"></span></div>
    <div class="card-body">
      <div class="card-title">${esc(o.titre || 'Sans titre')}</div>
      <div class="card-meta">${meta}</div>
      <div class="card-loc">${pinSvg}${loc}</div>
      <div class="card-foot">${prixHtml(o)}${confHtml(marks)}</div>
    </div>
  </article>`;
}

function renderGrid() {
  const body = $('#collection-body');
  const items = collection.filter(objMatches);
  if (!collection.length) {
    body.innerHTML = emptyHtml('Aucun objet pour l’instant', 'Capture ton premier objet — photo + n° d’étiquette, l’IA fait le reste.');
    return;
  }
  if (!items.length) {
    body.innerHTML = emptyHtml('Rien ne correspond', 'Essaie d’autres mots, un n° d’étiquette, un lieu…');
    return;
  }
  const g = filters.group;
  if (!g) {
    body.innerHTML = `<div class="grid">${items.map(cardHtml).join('')}</div>`;
  } else {
    const groups = new Map();
    for (const o of items) {
      const raw = (o[g] || '').trim();
      const k = raw || (g === 'zone' ? 'Non localisé' : g === 'periode' ? 'Période inconnue' : 'Sans catégorie');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }
    body.innerHTML = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'))
      .map(([k, arr]) => `<div class="group-title">${esc(k)} <span class="n">${arr.length}</span></div><div class="grid">${arr.map(cardHtml).join('')}</div>`)
      .join('');
  }
  $$('.card', body).forEach(c => c.addEventListener('click', () => {
    location.hash = '#/objet/' + encodeURIComponent(c.dataset.oid);
  }));
}

// Recherche (débounce) + regroupement
let searchTimer;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { filters.q = norm(e.target.value); renderGrid(); }, 150);
});
$('#group-by').addEventListener('change', e => { filters.group = e.target.value; renderGrid(); });

// ═══════════════════════════════════════════════════════════════════════════
// VUE OBJET
// ═══════════════════════════════════════════════════════════════════════════
// Champs éditables en mode « Corriger » (chaque diff → table corrections = leçon PMO)
const CHAMPS_EDIT = [
  ['titre', 'Titre'], ['categorie', 'Catégorie'], ['technique', 'Technique'],
  ['periode', 'Période'], ['ecole', 'Région / école'], ['auteur', 'Auteur'],
  ['marques', 'Marques / poinçons'], ['etat', 'État'],
  ['prix_bas', 'Prix bas (€)'], ['prix_haut', 'Prix haut (€)'],
];

async function loadObjet(id) {
  const body = $('#objet-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  const { data: o, error } = await sb.from('objets').select('*').eq('id', id).maybeSingle();
  if (error || !o) {
    body.innerHTML = emptyHtml('Objet introuvable', `Aucun objet #${id} dans ta collection.`);
    return;
  }
  currentObjet = o;
  editing = false;
  const [{ data: photos }, { data: comps }, { data: fiches }] = await Promise.all([
    sb.from('photos').select('*').eq('objet_id', id).order('created_at'),
    sb.from('comparables').select('*').eq('objet_id', id).order('date_vente', { ascending: false, nullsFirst: false }),
    sb.from('fiches').select('*').eq('objet_id', id).order('version', { ascending: false }).limit(1),
  ]);
  const urlByPath = await signPaths((photos ?? []).map(p => p.storage_path));
  currentPhotos = (photos ?? []).map(p => ({ ...p, url: urlByPath[p.storage_path] }));
  currentComps = comps ?? [];
  currentFiche = (fiches ?? [])[0] ?? null;
  renderObjet();
  loadSimilar(o);
}

function dlRow(label, val, editField, type = 'text') {
  const v = (val ?? '') === '' ? null : String(val);
  if (editing && editField) {
    return `<dt>${label}</dt><dd><input id="edit-${editField}" type="${type}" value="${esc(v ?? '')}"></dd>`;
  }
  return `<dt>${label}</dt><dd>${v ? esc(v) : '<span class="miss">—</span>'}</dd>`;
}

function renderObjet() {
  const o = currentObjet;
  const marks = confMarks(o);
  const selIdx = Math.max(0, currentPhotos.findIndex(p => p.sel));
  const sel = currentPhotos[selIdx];

  const gallery = currentPhotos.length ? `
    <div class="panel">
      <div class="gallery-main" data-action="zoom" title="Agrandir">
        ${sel && sel.url ? (isVideo(sel) ? `<video src="${esc(sel.url)}" controls></video>` : `<img src="${esc(sel.url)}" alt="photo de l'objet">`) : catEmoji(o.categorie)}
      </div>
      <div class="thumbs">
        ${currentPhotos.map((p, i) => `
          <div class="thumb ${i === selIdx ? 'sel' : ''}" data-action="thumb" data-idx="${i}" title="${esc(p.kind)}">
            ${p.url ? (isVideo(p) ? '🎬' : `<img src="${esc(p.url)}" alt="">`) : '📷'}
            <span class="kind">${esc(p.kind)}</span>
          </div>`).join('')}
        <div class="thumb add" data-action="add-photo" title="Ajouter une photo">＋</div>
      </div>
    </div>` : `
    <div class="panel">
      <div class="gallery-main" data-action="add-photo" title="Ajouter la première photo" style="cursor:pointer">${catEmoji(o.categorie)}</div>
      <div class="thumbs"><div class="thumb add" data-action="add-photo">＋</div></div>
    </div>`;

  const rebounds = [o.categorie, o.periode, o.ecole].filter(Boolean)
    .map(v => `<button class="rebound" data-action="rebound" data-val="${esc(v)}">${esc(v)}</button>`).join('');

  const identification = editing
    ? `<dl class="dl editing">
        ${CHAMPS_EDIT.map(([f, label]) => dlRow(label, o[f], f, f.startsWith('prix_') ? 'number' : 'text')).join('')}
        <dt>Description</dt><dd><input id="edit-description" value="${esc(o.description ?? '')}"></dd>
       </dl>`
    : `<dl class="dl">
        ${dlRow('Catégorie', o.categorie)}
        ${dlRow('Technique', o.technique)}
        ${dlRow('Période', o.periode)}
        ${dlRow('Région / école', o.ecole)}
        ${dlRow('Auteur', o.auteur)}
        ${dlRow('Marques / poinçons', o.marques)}
        ${dlRow('État', o.etat)}
        ${o.description ? `<dt>Description</dt><dd><em>${esc(o.description)}</em></dd>` : ''}
      </dl>`;

  const valeur = (o.prix_bas != null && o.prix_haut != null) ? `
      <div class="value-big">${fmtNum(o.prix_bas)}–${fmtNum(o.prix_haut)} €</div>
      <div class="value-sub">fourchette issue de ${currentComps.length} adjudication${currentComps.length > 1 ? 's' : ''} réelle${currentComps.length > 1 ? 's' : ''} — jamais d'estimation « de mémoire »</div>`
    : `<div class="value-sub">Pas encore d'estimation. La règle d'or : <b>jamais un chiffre sans comparables vendus affichés</b>.</div>`;

  const compsTable = currentComps.length ? `
    <table class="comps">
      <thead><tr><th>Maison</th><th>Date</th><th>Lot</th><th>Prix</th><th></th></tr></thead>
      <tbody>
        ${currentComps.map(c => `<tr>
          <td>${esc(c.maison)}</td>
          <td class="mono">${fmtDate(c.date_vente)}</td>
          <td>${esc(c.lot ?? '—')}</td>
          <td class="prix">${c.prix != null ? fmtNum(c.prix) + ' ' + esc(c.devise === 'EUR' ? '€' : c.devise) : '—'}</td>
          <td>${c.lien ? `<a class="link-lot" href="${esc(c.lien)}" target="_blank" rel="noopener">voir ↗</a>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '';

  const actions = editing ? `
    <div class="corr-bar">
      ✏️ <b>Mode correction</b> — chaque différence est gravée comme leçon (ground truth).
      Je suis :
      <select id="corr-qui">
        <option value="alain" ${localStorage.getItem('iartcane-qui') !== 'yann' ? 'selected' : ''}>Alain</option>
        <option value="yann" ${localStorage.getItem('iartcane-qui') === 'yann' ? 'selected' : ''}>Yann</option>
      </select>
      <button class="btn primary small" data-action="corr-save">Enregistrer les corrections</button>
      <button class="btn small" data-action="corr-cancel">Annuler</button>
    </div>` : `
    <div class="actions">
      <button class="btn primary" data-action="valider" ${o.statut === 'validee' ? 'disabled' : ''}>✓ Valider la fiche</button>
      <button class="btn" data-action="corriger">✏️ Corriger</button>
      <button class="btn" data-action="relancer">↻ Relancer l'analyse IA</button>
      <button class="btn" data-action="add-photo">📷 Ajouter une photo</button>
    </div>`;

  const fichePanel = currentFiche ? `
    <div class="panel panel-pad">
      <div class="sec-title">Fiche IA <span style="font-size:12px;font-family:var(--mono);color:var(--ink-3);font-weight:400">v${currentFiche.version}${currentFiche.modele ? ' · ' + esc(currentFiche.modele) : ''} · ${fmtDate(currentFiche.created_at)}</span></div>
      <div class="md-body">${mdToHtml(currentFiche.contenu_md)}</div>
    </div>` : `
    <div class="panel panel-pad">
      <div class="sec-title">Fiche IA</div>
      <div class="value-sub">${o.statut === 'en_file' || o.statut === 'analyse'
        ? '⏳ Analyse en file — le cron la traitera et la fiche apparaîtra ici.'
        : 'Pas encore de fiche. Ajoute des photos puis relance l\'analyse.'}</div>
    </div>`;

  $('#objet-body').innerHTML = `
  <div class="obj-layout">
    <div class="obj-main">
      ${gallery}
      <div class="panel panel-pad">
        <h1 class="obj-title">${esc(o.titre || 'Sans titre')}</h1>
        ${rebounds ? `<div class="rebounds" style="margin-top:12px">${rebounds}</div>` : ''}
      </div>
      <div class="panel panel-pad">
        <div class="sec-title">Identification</div>
        ${identification}
      </div>
      <div class="panel panel-pad">
        <div class="sec-title">Valeur</div>
        ${valeur}
        ${compsTable}
      </div>
      ${actions}
      ${fichePanel}
      <div class="panel panel-pad" id="similar-panel" style="display:none">
        <div class="sec-title">Objets qui s'en rapprochent</div>
        <div class="similar" id="similar-grid"></div>
      </div>
      <div class="disclaimer">${infoSvg}
        Aide à l'estimation et au catalogage — ne constitue pas une expertise certifiée. Au-delà de 2 000 € estimés, une expertise humaine est recommandée (CNES/CNE, commissaire-priseur).
      </div>
    </div>
    <aside class="obj-side">
      <div class="panel panel-pad">
        <div class="side-row">
          <span class="side-id">#${esc(o.id)}</span>
          <span class="st st-${esc(o.statut)}">${STATUTS[o.statut] ?? esc(o.statut)}</span>
        </div>
        <div style="margin-top:14px;display:flex;align-items:center;gap:10px">
          ${confHtml(marks)}
        </div>
      </div>
      <div class="loc-card" id="loc-card"></div>
      <div class="panel panel-pad side-dates">
        <div>Capturé le ${fmtDate(o.created_at)} · ${esc(o.source_capture)}</div>
        <div>Modifié le ${fmtDate(o.updated_at)}</div>
        <div>${currentPhotos.length} photo${currentPhotos.length > 1 ? 's' : ''}${currentPhotos.length === 0 ? ' — à prendre' : ''}</div>
      </div>
    </aside>
  </div>`;
  renderLocCard(false);
}

// Carte localisation (lecture / édition inline — simple attribut, pas gravé en correction)
function renderLocCard(edit) {
  const o = currentObjet;
  const el = $('#loc-card');
  if (!el) return;
  if (!edit) {
    el.innerHTML = `
      <div class="loc-line"><span class="k">Zone</span><span class="v">${o.zone ? esc(o.zone) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line"><span class="k">Contenant</span><span class="v">${o.contenant ? esc(o.contenant) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line"><span class="k">Position</span><span class="v">${o.position ? esc(o.position) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line" style="justify-content:flex-end;margin-top:6px"><button class="edit-btn" data-action="loc-edit">✏️ modifier</button></div>`;
  } else {
    el.innerHTML = `
      <div class="loc-line"><span class="k">Zone</span><input id="loc-zone" value="${esc(o.zone ?? '')}" placeholder="Garage…"></div>
      <div class="loc-line"><span class="k">Contenant</span><input id="loc-contenant" value="${esc(o.contenant ?? '')}" placeholder="Carton 33…"></div>
      <div class="loc-line"><span class="k">Position</span><input id="loc-position" value="${esc(o.position ?? '')}" placeholder="étagère haute…"></div>
      <div class="loc-line" style="justify-content:flex-end;gap:6px;margin-top:8px">
        <button class="edit-btn" data-action="loc-cancel">annuler</button>
        <button class="edit-btn" data-action="loc-save" style="font-weight:700">✓ enregistrer</button>
      </div>`;
  }
}

async function loadSimilar(o) {
  const panel = $('#similar-panel');
  if (!panel) return;
  if (!o.categorie) return;
  const { data } = await sb.from('objets').select('*')
    .eq('categorie', o.categorie).neq('id', o.id)
    .order('created_at', { ascending: false }).limit(3);
  if (!data?.length) return;
  const { data: ph } = await sb.from('photos').select('objet_id,storage_path')
    .in('objet_id', data.map(s => s.id)).order('created_at');
  const first = {};
  for (const p of ph ?? []) if (!first[p.objet_id]) first[p.objet_id] = p.storage_path;
  const urls = await signPaths(Object.values(first));
  panel.style.display = '';
  $('#similar-grid').innerHTML = data.map(s => {
    const img = urls[first[s.id]];
    return `<div class="sim-card" data-action="similar" data-oid="${esc(s.id)}">
      <div class="sim-img">${img ? `<img src="${esc(img)}" alt="">` : catEmoji(s.categorie)}</div>
      <div><div class="sim-t">${esc(s.titre || 'Sans titre')}</div>
      <div class="sim-m">#${esc(s.id)}${s.prix_bas != null ? ` · ${fmtNum(s.prix_bas)}–${fmtNum(s.prix_haut)} €` : ''}</div></div>
    </div>`;
  }).join('');
}

// ─── Actions de la vue Objet (délégation) ───────────────────────────────────
$('#objet-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  const o = currentObjet;

  if (act === 'thumb') {
    currentPhotos.forEach((p, i) => { p.sel = i === Number(el.dataset.idx); });
    renderObjet();
  }
  else if (act === 'zoom') {
    const sel = currentPhotos.find(p => p.sel) ?? currentPhotos[0];
    if (sel?.url) openLightbox(sel);
  }
  else if (act === 'add-photo') { $('#file-add-photo').click(); }
  else if (act === 'rebound') {
    filters.q = norm(el.dataset.val); filters.chip = ''; filters.list = '';
    $('#search').value = el.dataset.val;
    location.hash = '#/';
  }
  else if (act === 'similar') { location.hash = '#/objet/' + encodeURIComponent(el.dataset.oid); }
  else if (act === 'loc-edit') { renderLocCard(true); }
  else if (act === 'loc-cancel') { renderLocCard(false); }
  else if (act === 'loc-save') {
    const updates = {
      zone: $('#loc-zone').value.trim() || null,
      contenant: $('#loc-contenant').value.trim() || null,
      position: $('#loc-position').value.trim() || null,
    };
    const { error } = await sb.from('objets').update(updates).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    Object.assign(currentObjet, updates);
    renderLocCard(false);
    toast('Localisation mise à jour');
  }
  else if (act === 'valider') {
    const { error } = await sb.from('objets').update({ statut: 'validee' }).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    toast(`#${o.id} validée ✓ — confiance 4/4 (ground truth)`);
    loadObjet(o.id); loadHeader();
  }
  else if (act === 'corriger') { editing = true; renderObjet(); }
  else if (act === 'corr-cancel') { editing = false; renderObjet(); }
  else if (act === 'corr-save') { saveCorrections(); }
  else if (act === 'relancer') {
    const { error } = await sb.from('jobs').insert({ owner_id: tenantId, objet_id: o.id, type: 'reanalyse' });
    if (error) { toast(error.message, true); return; }
    await sb.from('objets').update({ statut: 'en_file' }).eq('id', o.id);
    toast('Analyse relancée — le cron la traitera');
    loadObjet(o.id);
  }
});

async function saveCorrections() {
  const o = currentObjet;
  const auteur = $('#corr-qui')?.value ?? 'alain';
  localStorage.setItem('iartcane-qui', auteur);
  const updates = {};
  const rows = [];
  for (const [champ] of [...CHAMPS_EDIT, ['description', 'Description']]) {
    const inp = $('#edit-' + champ);
    if (!inp) continue;
    let nv = inp.value.trim();
    const av = o[champ] == null ? '' : String(o[champ]);
    if (champ.startsWith('prix_')) {
      nv = nv === '' ? null : Number(nv.replace(',', '.'));
      if (nv !== null && !Number.isFinite(nv)) { toast(`Prix invalide (${champ})`, true); return; }
    } else {
      nv = nv === '' ? null : nv;
    }
    if (av !== String(nv ?? '')) {
      updates[champ] = nv;
      rows.push({ owner_id: tenantId, objet_id: o.id, champ, avant: av || null, apres: nv == null ? null : String(nv), auteur });
    }
  }
  if (!rows.length) { toast('Aucune modification'); editing = false; renderObjet(); return; }
  updates.statut = 'contestee';
  const { error } = await sb.from('objets').update(updates).eq('id', o.id);
  if (error) { toast(error.message, true); return; }
  const { error: e2 } = await sb.from('corrections').insert(rows);
  if (e2) { toast(e2.message, true); return; }
  toast(`${rows.length} correction${rows.length > 1 ? 's' : ''} gravée${rows.length > 1 ? 's' : ''} — leçons pour l'IA`);
  loadObjet(o.id);
}

// ─── Upload de photos (partagé capture + fiche objet) ───────────────────────
async function uploadPhotosFor(oid, files, firstIsFace = false) {
  let done = 0;
  let first = firstIsFace;
  for (const f of files) {
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${tenantId}/${oid}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from('photos').upload(path, f, { contentType: f.type || undefined });
    if (error) { toast(`Upload « ${f.name} » : ${error.message}`, true); continue; }
    const video = /^video\//.test(f.type);
    const kind = video ? 'video' : (first ? 'face' : 'autre');
    first = false;
    const { error: e2 } = await sb.from('photos').insert({ owner_id: tenantId, objet_id: oid, storage_path: path, kind, source: 'site' });
    if (e2) toast(e2.message, true); else done++;
  }
  return done;
}

$('#file-add-photo').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !currentObjet) return;
  const oid = currentObjet.id;
  const n = await uploadPhotosFor(oid, files);
  if (n > 0) {
    // L'objet avait trop peu de photos → on relance l'analyse automatiquement
    if (['capture', 'a_completer'].includes(currentObjet.statut)) {
      await sb.from('objets').update({ statut: 'en_file' }).eq('id', oid);
      await sb.from('jobs').insert({ owner_id: tenantId, objet_id: oid, type: 'analyse' });
      toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} — analyse en file`);
    } else {
      toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`);
    }
  }
  loadObjet(oid);
});

// ─── Lightbox ───────────────────────────────────────────────────────────────
function openLightbox(photo) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = isVideo(photo) ? `<video src="${esc(photo.url)}" controls autoplay></video>` : `<img src="${esc(photo.url)}" alt="">`;
  lb.addEventListener('click', () => lb.remove());
  document.body.append(lb);
}

// ─── Mini rendu markdown (fiches IA) ────────────────────────────────────────
function mdInline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function mdToHtml(md) {
  const lines = esc(md ?? '').split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/^\s*\|.*\|\s*$/.test(L)) {
      closeList();
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const row = lines[i];
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(row)) {
          const cells = row.split('|').slice(1, -1).map(c => mdInline(c.trim()));
          tbl.push(cells);
        }
        i++;
      }
      i--;
      if (tbl.length) {
        out.push('<table><thead><tr>' + tbl[0].map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
          + tbl.slice(1).map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('')
          + '</tbody></table>');
      }
      continue;
    }
    const h = L.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); continue; }
    if (/^\s*---+\s*$/.test(L)) { closeList(); out.push('<hr>'); continue; }
    const ul = L.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${mdInline(ul[1])}</li>`); continue; }
    const ol = L.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${mdInline(ol[1])}</li>`); continue; }
    if (L.trim() === '') { closeList(); continue; }
    closeList();
    out.push(`<p>${mdInline(L)}</p>`);
  }
  closeList();
  return out.join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// VUE CAPTURER
// ═══════════════════════════════════════════════════════════════════════════
async function initCapture() {
  capFiles = [];
  renderPreviews();
  $('#cap-num').value = '…';
  const [{ data: next }, { data: lieux }] = await Promise.all([
    sb.rpc('peek_objet_id', { p_owner: tenantId }),
    sb.from('objets').select('zone,contenant').eq('owner_id', tenantId),
  ]);
  $('#cap-num').value = next ?? '';
  const zones = [...new Set((lieux ?? []).map(r => r.zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const conts = [...new Set((lieux ?? []).map(r => r.contenant).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('#zones').innerHTML = zones.map(z => `<option>${esc(z)}</option>`).join('');
  $('#contenants').innerHTML = conts.map(z => `<option>${esc(z)}</option>`).join('');
}

function addCapFiles(fileList) {
  for (const f of fileList) capFiles.push(f);
  renderPreviews();
}
function renderPreviews() {
  const box = $('#previews');
  box.innerHTML = '';
  capFiles.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'pv';
    if (/^image\//.test(f.type)) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      d.append(img);
    } else {
      d.style.display = 'grid';
      d.style.placeItems = 'center';
      d.style.fontSize = '26px';
      d.textContent = '🎬';
    }
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'Retirer';
    x.addEventListener('click', () => { capFiles.splice(i, 1); renderPreviews(); });
    d.append(x);
    box.append(d);
  });
}

const dz = $('#dropzone');
dz.addEventListener('click', () => $('#file-gallery').click());
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('over');
  addCapFiles(e.dataTransfer.files);
});
// ─── Caméra en direct (getUserMedia) ────────────────────────────────────────
// L'input capture="environment" passe la main à l'app photo du téléphone : sur
// Android le navigateur est souvent tué en arrière-plan pendant le cliché → la
// page se recharge et la photo se perd (« rien n'arrive »). Le flux getUserMedia
// garde la page au premier plan : plus de handoff, et ça marche aussi sur PC
// (webcam). Fallback : l'input fichier si la caméra est indisponible/refusée.
let camStream = null;
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { $('#file-camera').click(); return; }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 3000 }, height: { ideal: 3000 } },
      audio: false,
    });
  } catch (err) {
    toast(`Caméra indisponible (${err.name}) — sélecteur de fichiers à la place`);
    $('#file-camera').click();
    return;
  }
  $('#camera-video').srcObject = camStream;
  $('#camera-modal').classList.remove('hidden');
}
function closeCamera() {
  camStream?.getTracks().forEach(t => t.stop());
  camStream = null;
  $('#camera-video').srcObject = null;
  $('#camera-modal').classList.add('hidden');
}
$('#btn-camera').addEventListener('click', openCamera);
$('#camera-close').addEventListener('click', closeCamera);
$('#camera-shot').addEventListener('click', () => {
  const v = $('#camera-video');
  if (!v.videoWidth) { toast('Flux caméra pas encore prêt — réessaie', true); return; }
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  c.toBlob(b => {
    if (!b) { toast('Capture impossible', true); return; }
    addCapFiles([new File([b], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
    toast('Photo ajoutée — tu peux enchaîner (revers, signature…) ou Terminer');
  }, 'image/jpeg', 0.92);
});
$('#btn-gallery').addEventListener('click', () => $('#file-gallery').click());
$('#file-camera').addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });
$('#file-gallery').addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });

$('#cap-save').addEventListener('click', async () => {
  const btn = $('#cap-save');
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  try {
    const { data: newId, error: e0 } = await sb.rpc('next_objet_id', { p_owner: tenantId });
    if (e0 || !newId) throw (e0 ?? new Error('numérotation impossible'));
    const avecPhotos = capFiles.length > 0;
    const { error: e1 } = await sb.from('objets').insert({
      owner_id: tenantId,
      id: newId,
      statut: avecPhotos ? 'en_file' : 'a_completer',
      zone: $('#cap-zone').value.trim() || null,
      contenant: $('#cap-contenant').value.trim() || null,
      source_capture: 'site',
    });
    if (e1) throw e1;
    if (avecPhotos) {
      const n = await uploadPhotosFor(newId, capFiles, true);
      if (n > 0) {
        const { error: e2 } = await sb.from('jobs').insert({ owner_id: tenantId, objet_id: newId, type: 'analyse' });
        if (e2) toast(e2.message, true);
      } else {
        await sb.from('objets').update({ statut: 'a_completer' }).eq('id', newId);
      }
    }
    capFiles = [];
    toast(`Objet #${newId} enregistré${avecPhotos ? ' — analyse en file' : ''}`);
    loadHeader();
    location.hash = '#/objet/' + encodeURIComponent(newId);
  } catch (err) {
    toast(err.message ?? String(err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enregistrer l\'objet';
  }
});
