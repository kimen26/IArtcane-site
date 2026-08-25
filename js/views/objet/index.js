// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/index.js : fiche produit — chargement, rendu et
// délégation des actions. Point d'entrée de la vue (`mount(id)`), appelé par le
// routeur de app.js.
//
// Territoire découpé en trois (D-041, la fiche dépassait 650 lignes et était le
// point de conflit n°1 entre chantiers parallèles) :
//   • index.js   ce fichier — chargement, rendu, actions, localisation, similaires
//   • photos.js  galerie : suppression, caméra, lightbox (zoom / centrage / recadrage)
//   • edition.js mode « Corriger » : champs éditables et enregistrement
//   • etat.js    état partagé des trois (objet O) + hooks de rechargement/rendu
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, norm, toast, emptyHtml } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import {
  fmtNum, fmtDate, confMarks, confHtml, catEmoji, isVideo, infoSvg,
  STATUTS, ACT_LABELS, evDetailBits, mdToHtml,
} from '../../core/format.js';
import { sb, signPaths, logEvent, queueAnalyse, uploadPhotosFor } from '../../core/data.js';
import { openCamera } from '../../core/camera.js';
import { loadViewCss } from '../../core/css.js';
import { O, selPhoto, hooks } from './etat.js';
import { deletePhoto, onCamClose, openLightbox } from './photos.js';
import { CHAMPS_EDIT, dlRow, saveCorrections } from './edition.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('objet');

export function mount(id) {
  loadObjet(id);
}

async function loadObjet(id) {
  const body = $('#objet-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  const { data: o, error } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).eq('id', id).maybeSingle();
  if (error || !o) {
    body.innerHTML = emptyHtml('Objet introuvable', `Aucun objet #${id} dans ta collection.`);
    return;
  }
  S.currentObjet = o;
  O.editing = false;
  const [{ data: photos }, { data: comps }, { data: fiches }, { data: events }, { data: artiste }] = await Promise.all([
    sb.from('photos').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('created_at'),
    sb.from('comparables').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('date_vente', { ascending: false, nullsFirst: false }),
    sb.from('fiches').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('version', { ascending: false }).limit(1),
    sb.from('evenements').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('created_at', { ascending: false }).limit(50),
    // Fiche artiste (migration 0008) : match exact sur objets.auteur, 0 ligne tolérée
    o.auteur ? sb.from('artistes').select('*').eq('owner_id', S.tenantId).eq('nom', o.auteur).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const urlByPath = await signPaths((photos ?? []).flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean)));
  O.photos = (photos ?? []).map(p => ({ ...p, url: urlByPath[p.storage_path], thumbUrl: urlByPath[p.thumb_path] ?? urlByPath[p.storage_path] }));
  O.comps = comps ?? [];
  O.fiche = (fiches ?? [])[0] ?? null;
  O.events = events ?? [];
  O.artiste = artiste ?? null;
  renderObjet();
  loadSimilar(o);
}

// Suppression d'un objet : fichiers storage puis ligne `objets` — les FK
// on delete cascade emportent photos/comparables/fiches/jobs/evenements.
async function deleteObjet() {
  const o = S.currentObjet;
  if (!o) return;
  if (!confirm(`Supprimer l'objet #${o.id} ?\n${O.photos.length} photo(s), fiche, comparables et historique partent avec — définitif.`)) return;
  const paths = O.photos.map(p => p.storage_path);
  if (paths.length) await sb.storage.from('photos').remove(paths);
  const { error } = await sb.from('objets').delete().eq('owner_id', S.tenantId).eq('id', o.id);
  if (error) { toast(error.message, true); return; }
  toast(`Objet #${o.id} supprimé`);
  location.hash = '#/';
}

async function deleteComp(cid) {
  if (!S.currentObjet || !canWrite()) return;
  const c = O.comps.find(x => String(x.id) === String(cid));
  if (!c) return;
  if (!confirm('Retirer ce comparable de l’estimation ?')) return;
  const { error } = await sb.from('comparables').delete().eq('owner_id', S.tenantId).eq('id', cid);
  if (error) { toast(error.message, true); return; }
  logEvent('comparable_supprime', { comparable_id: cid, lot: c.lot, maison: c.maison }, S.currentObjet.id);
  toast('Comparable retiré');
  await loadObjet(S.currentObjet.id);
}

function renderObjet() {
  const o = S.currentObjet;
  const marks = confMarks(o);
  const selIdx = Math.max(0, O.photos.findIndex(p => p.sel));
  const sel = O.photos[selIdx];

  const gallery = O.photos.length ? `
    <div class="panel">
      <div class="gallery-main" data-action="zoom" title="Agrandir">
        ${sel && sel.url ? (isVideo(sel) ? `<video src="${esc(sel.url)}" controls></video>` : `<img src="${esc(sel.url)}" alt="photo de l'objet">`) : catEmoji(o.categorie)}
        ${sel && sel.url && !isVideo(sel) ? `<button class="crop-btn hide-lecteur" data-action="crop-toggle" title="Centrer : choisir le point de la photo sur lequel la carte du listing se centre">🎯 Centrer</button>` : ''}
        ${sel && sel.url && !isVideo(sel) ? `<button class="crop-btn cut-btn hide-lecteur" data-action="cut-photo" title="Recadrer : rogne définitivement la photo (résolution d'origine conservée)">✂️ Recadrer</button>` : ''}
        ${sel && sel.url ? `<button class="crop-btn del-photo hide-lecteur" data-action="del-photo" title="Supprimer cette photo">🗑</button>` : ''}
      </div>
      <div class="thumbs">
        ${O.photos.map((p, i) => `
          <div class="thumb ${i === selIdx ? 'sel' : ''}" data-action="thumb" data-idx="${i}" title="${esc(p.kind)}" tabindex="0" role="button" aria-label="Photo ${i + 1} — ${esc(p.kind)}">
            ${p.url ? (isVideo(p) ? '🎬' : `<img src="${esc(p.thumbUrl || p.url)}" alt="${esc(p.kind)} — ${esc(o.titre || 'objet')}" loading="lazy" decoding="async">`) : '📷'}
            <span class="kind">${esc(p.kind)}</span>
          </div>`).join('')}
        <div class="thumb add hide-lecteur" data-action="add-photo" title="Ajouter une photo" tabindex="0" role="button" aria-label="Ajouter une photo">＋</div>
      </div>
    </div>` : `
    <div class="panel">
      <div class="gallery-main" ${canWrite() ? 'data-action="add-photo" title="Ajouter la première photo" style="cursor:pointer"' : ''}>${catEmoji(o.categorie)}</div>
      <div class="thumbs"><div class="thumb add hide-lecteur" data-action="add-photo">＋</div></div>
    </div>`;

  const rebounds = [o.categorie, o.periode, o.ecole].filter(Boolean)
    .map(v => `<button class="rebound" data-action="rebound" data-val="${esc(v)}">${esc(v)}</button>`).join('');

  const identification = O.editing
    ? `<dl class="dl O.editing">
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

  // Règle d'or : seules les adjudications nourrissent la fourchette — les
  // annonces « en vente » sont du contexte et sont affichées à part (badge ambre).
  const nVendus = O.comps.filter(c => c.source_type !== 'en_vente').length;
  const valeur = (o.prix_bas != null && o.prix_haut != null) ? `
      <div class="value-big">${fmtNum(o.prix_bas)}–${fmtNum(o.prix_haut)} €</div>
      <div class="value-sub">fourchette issue de ${nVendus} adjudication${nVendus > 1 ? 's' : ''} réelle${nVendus > 1 ? 's' : ''} — jamais d'estimation « de mémoire »</div>`
    : `<div class="value-sub">Pas encore d'estimation. La règle d'or : <b>jamais un chiffre sans comparables vendus affichés</b>.</div>`;

  // Comparables visuels : cartes avec image du lot. Adjudications d'abord,
  // « en vente » ensuite (tri stable : la date descendante de la requête est
  // conservée à l'intérieur de chaque groupe).
  const compsSorted = [...O.comps].sort((a, b) =>
    (a.source_type === 'en_vente' ? 1 : 0) - (b.source_type === 'en_vente' ? 1 : 0));
  const compsList = compsSorted.length ? `
    <div class="comps-list">
      ${compsSorted.map(c => {
        const enVente = c.source_type === 'en_vente';
        const img = c.image_url
          ? `<img src="${esc(c.image_url)}" alt="${esc(c.lot ?? 'lot comparable')}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
          : '<span class="comp-noimg">🖼️</span>';
        const thumb = c.lien
          ? `<a class="comp-thumb" href="${esc(c.lien)}" target="_blank" rel="noopener" title="Voir le lot">${img}</a>`
          : `<div class="comp-thumb">${img}</div>`;
        return `<div class="comp-card">
          ${thumb}
          <div class="comp-info">
            <div class="comp-top">
              <span class="comp-maison">${esc(c.maison ?? '')}</span>
              <span class="mono comp-date">${fmtDate(c.date_vente)}</span>
              <span class="comp-badge ${enVente ? 'vente' : 'vendu'}">${enVente ? 'En vente — contexte' : 'Vendu'}</span>
            </div>
            <div class="comp-lot">${esc(c.lot ?? '—')}</div>
            <div class="comp-bot">
              <span class="comp-prix">${c.prix != null ? fmtNum(c.prix) + ' ' + esc(c.devise === 'EUR' ? '€' : c.devise) : '—'}</span>
              <div style="display:flex;gap:8px;align-items:center">
                ${c.lien ? `<a class="link-lot" href="${esc(c.lien)}" target="_blank" rel="noopener">Voir le lot ↗</a>` : ''}
                ${canWrite() ? `<button class="btn small danger" data-action="del-comp" data-cid="${esc(c.id)}">Retirer</button>` : ''}
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  const actions = O.editing ? `
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
    <div class="actions hide-lecteur">
      <button class="btn primary" data-action="valider" ${o.statut === 'validee' ? 'disabled' : ''}>✓ Valider la fiche</button>
      <button class="btn" data-action="corriger">✏️ Corriger</button>
      <button class="btn" data-action="relancer">↻ Relancer l'estimation</button>
      <button class="btn" data-action="take-photo">📸 Prendre une photo</button>
      <button class="btn" data-action="add-photo">🖼️ Ajouter depuis la galerie</button>
      <button class="btn danger" data-action="del-objet">🗑 Supprimer l'objet</button>
    </div>`;

  // Fiche artiste (table `artistes`, migration 0008) — rien affiché si pas de fiche
  const artistePanel = O.artiste ? `
    <details class="panel panel-pad acc" open>
      <summary class="sec-title">🎨 Artiste — ${esc(O.artiste.nom)}</summary>
      <div class="md-body">${mdToHtml(O.artiste.bio_md ?? '')}</div>
      <a class="link-lot" style="display:inline-block;margin-top:12px" href="#/artiste/${encodeURIComponent(O.artiste.nom)}">Voir la fiche artiste →</a>
    </details>` : '';

  const fichePanel = O.fiche ? `
    <details class="panel panel-pad acc">
      <summary class="sec-title">Fiche IA <span style="font-size:12px;font-family:var(--mono);color:var(--ink-3);font-weight:400">v${O.fiche.version}${O.fiche.modele ? ' · ' + esc(O.fiche.modele) : ''} · ${fmtDate(O.fiche.created_at)}</span></summary>
      <div class="md-body">${mdToHtml(O.fiche.contenu_md)}</div>
    </details>` : `
    <div class="panel panel-pad">
      <div class="sec-title">Fiche IA</div>
      <div class="value-sub">${o.statut === 'en_file' || o.statut === 'analyse'
        ? '⏳ Analyse en file — le cron la traitera et la fiche apparaîtra ici.'
        : 'Pas encore de fiche. Ajoute des photos puis relance l\'analyse.'}</div>
    </div>`;

  // Changelog objet (D-025) : qui a fait quoi, quand, avec quel outil —
  // actions du site (photos, corrections, validation…) + passes IA du cron
  // (identification, marché, Lens…), champs avant→après quand dispo.
  const evRows = O.events.map(ev => {
    const bits = evDetailBits(ev.detail ?? {});
    return `<div class="ev-row">
      <span class="ev-date">${fmtDate(ev.created_at)}</span>
      <span class="ev-act">${esc(ACT_LABELS[ev.action] ?? ev.action)}</span>
      <span class="ev-qui">${esc(ev.acteur ?? '')}</span>
      <span class="ev-det">${bits.join(' · ')}</span>
    </div>`;
  }).join('');
  const historyPanel = `
    <details class="panel panel-pad acc">
      <summary class="sec-title">Historique <span style="font-size:12px;font-family:var(--mono);color:var(--ink-3);font-weight:400">${O.events.length} événement${O.events.length > 1 ? 's' : ''}</span></summary>
      <div class="ev-list">${evRows || '<div class="value-sub">Aucun événement tracé pour l\'instant.</div>'}</div>
    </details>`;

  $('#objet-body').innerHTML = `
  <div class="obj-layout">
    <div class="obj-main">
      ${gallery}
      <div class="panel panel-pad">
        <h1 class="obj-title">${esc(o.titre || 'Sans titre')}</h1>
        ${rebounds ? `<div class="rebounds" style="margin-top:12px">${rebounds}</div>` : ''}
      </div>
      <details class="panel panel-pad acc" open>
        <summary class="sec-title">Identification</summary>
        ${identification}
      </details>
      ${artistePanel}
      <details class="panel panel-pad acc" open>
        <summary class="sec-title">Vente / estimation</summary>
        ${valeur}
        ${compsList}
      </details>
      ${actions}
      ${fichePanel}
      ${historyPanel}
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
        <div>${O.photos.length} photo${O.photos.length > 1 ? 's' : ''}${O.photos.length === 0 ? ' — à prendre' : ''}</div>
      </div>
    </aside>
  </div>`;
  renderLocCard(false);
}

// Carte localisation (lecture / édition inline — simple attribut, pas gravé en correction)
function renderLocCard(edit) {
  const o = S.currentObjet;
  const el = $('#loc-card');
  if (!el) return;
  if (!edit) {
    el.innerHTML = `
      <div class="loc-line"><span class="k">Zone</span><span class="v">${o.zone ? esc(o.zone) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line"><span class="k">Contenant</span><span class="v">${o.contenant ? esc(o.contenant) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line"><span class="k">Position</span><span class="v">${o.position ? esc(o.position) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line" style="justify-content:flex-end;margin-top:6px"><button class="edit-btn hide-lecteur" data-action="loc-edit">✏️ modifier</button></div>`;
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
    .eq('owner_id', S.tenantId).eq('categorie', o.categorie).neq('id', o.id)
    .order('created_at', { ascending: false }).limit(3);
  if (!data?.length) return;
  // Miniatures 480 px (plusieurs Mo → ~30 Ko par vignette — audit 2026-08-24)
  const { data: ph } = await sb.from('photos').select('objet_id,storage_path,thumb_path')
    .eq('owner_id', S.tenantId).in('objet_id', data.map(s => s.id)).order('created_at');
  const first = {};
  for (const p of ph ?? []) if (!first[p.objet_id]) first[p.objet_id] = p.thumb_path ?? p.storage_path;
  const urls = await signPaths(Object.values(first));
  panel.style.display = '';
  $('#similar-grid').innerHTML = data.map(s => {
    const img = urls[first[s.id]];
    return `<div class="sim-card" data-action="similar" data-oid="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.titre || 'Objet similaire')} — fiche #${esc(s.id)}">
      <div class="sim-img">${img ? `<img src="${esc(img)}" alt="${esc(s.titre || 'Objet similaire')}" loading="lazy" decoding="async">` : catEmoji(s.categorie)}</div>
      <div><div class="sim-t">${esc(s.titre || 'Sans titre')}</div>
      <div class="sim-m">#${esc(s.id)}${s.prix_bas != null ? ` · ${fmtNum(s.prix_bas)}–${fmtNum(s.prix_haut)} €` : ''}</div></div>
    </div>`;
  }).join('');
}

// ─── Actions de la vue Objet (délégation) ───────────────────────────────────

// Activation clavier des vignettes/cartes non-boutons (div role="button") :
// Enter/Espace déclenche le même handler que le clic (délégation ci-dessous).
$('#objet-body').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.thumb[data-action], .sim-card[data-action]');
  if (!el || el !== e.target) return; // ne pas voler l'activation des vrais boutons internes
  e.preventDefault();
  el.click();
});

// Actions qui modifient des données — bloquées pour un lecteur (double garde
// avec la RLS 0012 ; l'UI est déjà masquée via .hide-lecteur).
const ACTIONS_MUTANTES = new Set([
  'crop-toggle', 'cut-photo', 'del-photo', 'del-objet', 'add-photo', 'take-photo',
  'loc-edit', 'loc-save', 'valider', 'corriger', 'corr-save', 'relancer',
  'del-comp',
]);

$('#objet-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (ACTIONS_MUTANTES.has(act) && !canWrite()) return;
  const o = S.currentObjet;

  if (act === 'thumb') {
    O.photos.forEach((p, i) => { p.sel = i === Number(el.dataset.idx); });
    renderObjet();
  }
  else if (act === 'zoom') {
    const sel = selPhoto();
    if (!sel?.url) return;
    openLightbox(sel);
  }
  // Cadrage : la photo s'ouvre en PLEIN ÉCRAN (entière, quitte à être petite —
  // retour Yann : « pour la cadrer il faut la voir ») et le clic y définit le
  // point focal de CETTE photo seulement (chaque photo a son cadrage).
  else if (act === 'crop-toggle') {
    const sel = selPhoto();
    if (!sel?.url) return;
    openLightbox(sel, 'focal');
  }
  else if (act === 'cut-photo') {
    const sel = selPhoto();
    if (!sel?.url) return;
    openLightbox(sel, 'cut');
  }
  else if (act === 'del-photo') { deletePhoto(); }
  else if (act === 'del-objet') { deleteObjet(); }
  else if (act === 'del-comp') { deleteComp(el.dataset.cid); }
  else if (act === 'add-photo') { $('#file-add-photo').click(); }
  else if (act === 'take-photo') { openCamera('objet', { onClose: onCamClose }); }
  else if (act === 'rebound') {
    S.filters.q = norm(el.dataset.val); S.filters.cats = []; S.filters.list = '';
    S.filters.prixMin = null; S.filters.prixMax = null;
    $('#search').value = el.dataset.val;
    $('#prix-min').value = ''; $('#prix-max').value = '';
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
    const { error } = await sb.from('objets').update(updates).eq('owner_id', S.tenantId).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    Object.assign(S.currentObjet, updates);
    logEvent('localisation', { champs: Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, { apres: v }])) });
    renderLocCard(false);
    toast('Localisation mise à jour');
  }
  else if (act === 'valider') {
    const { error } = await sb.from('objets').update({ statut: 'validee' }).eq('owner_id', S.tenantId).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    logEvent('validation', { note: 'confiance 4/4 (ground truth)' });
    toast(`#${o.id} validée ✓ — confiance 4/4 (ground truth)`);
    loadObjet(o.id); S.refreshHeader?.();
  }
  else if (act === 'corriger') { O.editing = true; renderObjet(); }
  else if (act === 'corr-cancel') { O.editing = false; renderObjet(); }
  else if (act === 'corr-save') { saveCorrections(); }
  else if (act === 'relancer') {
    if (!confirm(`Relancer l'estimation complète de #${o.id} ?\n\nLa passe entière sera rejouée : identification + recherche de comparables. Le cron la traitera au prochain run.`)) return;
    await queueAnalyse(o.id, 'reanalyse');
    logEvent('relance', {});
    toast('Estimation relancée — le cron la traitera');
    loadObjet(o.id);
  }
});

$('#file-add-photo').addEventListener('change', async e => {
  if (!canWrite()) { e.target.value = ''; return; }
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !S.currentObjet) return;
  const oid = S.currentObjet.id;
  const n = await uploadPhotosFor(oid, files);
  if (n > 0) {
    logEvent('photo_ajoutee', { n, via: 'fichier' }, oid);
    // L'objet avait trop peu de photos → on relance l'analyse automatiquement
    if (['capture', 'a_completer'].includes(S.currentObjet.statut)) {
      await queueAnalyse(oid);
      toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} — analyse en file`);
    } else {
      toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`);
    }
  }
  loadObjet(oid);
});

// Branchement des hooks partagés : photos.js et edition.js déclenchent le
// rechargement/rendu sans importer ce module (pas de cycle d'imports).
hooks.recharger = loadObjet;
hooks.rendre = renderObjet;
