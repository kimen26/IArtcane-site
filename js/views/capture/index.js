// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/capture/index.js : création d'objet, écrans 4a/4b (HO-054).
// Remplace le contenu de #view-capture à chaque mount ; capture.js est coquille.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import { plur } from '../../core/format.js';
import { sb, logEvent, lancerRecherches, enqueueJobs, uploadPhotosFor } from '../../core/data.js';
import { openCamera } from '../../core/camera.js';
import { loadViewCss } from '../../core/css.js';
import { createOverlay } from '../../core/lightbox.js';
import { micButton } from '../mic.js';
import { CATS_PROMPT } from '../../core/taxonomie.js';
import { getCurrentIndex, setCurrentIndex, ensureCurrentIndex, suggestedViews, countDoneViews, setCover, reorderCapFiles } from './etat.js';
import { renderCarte, renderGrille } from './photos.js';

await loadViewCss('capture');

let pendingObjetId = null;
let dragState = null;

export function mount() {
  ensureCurrentIndex();
  render();
  initCapture();
  if (consumeShareFlag()) receiveSharedPhotos();
}

// ─── Rendu global de l'écran ───────────────────────────────────────────────

function render() {
  const n = S.capFiles.length;
  ensureCurrentIndex();
  const selected = n ? getCurrentIndex() : -1;

  const capture = $('#view-capture');
  capture.innerHTML = `
    <div class="capture-screen">
      <header class="capture-head">
        <span class="capture-head-close" data-action="back">✕</span>
        <h1 class="capture-head-title">Nouvel objet</h1>
        <span class="capture-head-status">brouillon${n ? ' · ' + n + ' photo' + (n > 1 ? 's' : '') : ''}</span>
      </header>

      <div class="capture-body">
        ${renderCategorisation()}
        ${renderVuesConseillees()}
        ${n === 0 ? renderZoneAjout() : renderEdition()}
      </div>

      ${renderBarreBasse()}
    </div>`;

  brancher();
}

function renderCategorisation() {
  return `
    <div class="capture-card">
      <div class="capture-card-title">
        <span>Catégorisation</span>
        <span class="capture-card-hint">le reste viendra de l'IA</span>
      </div>
      <div class="capture-fields-row">
        <div class="capture-field">
          <select id="cap-categorie" class="capture-select">
            <option value="" disabled selected>Catégorie</option>
            ${CATS_PROMPT.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="capture-field">
          <input id="cap-zone" list="zones" placeholder="Zone" class="capture-input">
          <datalist id="zones"></datalist>
        </div>
      </div>
      <div class="capture-field" style="margin-top:8px">
        <input id="cap-contenant" list="contenants" placeholder="Contenant" class="capture-input">
        <datalist id="contenants"></datalist>
      </div>
      <div class="cap-comment" style="margin-top:8px">
        <div class="cap-comment-label">Note maison <span class="capture-card-hint">lue par l'IA dès la 1re passe</span></div>
        <div class="cap-comment-wrap">
          <textarea id="cap-commentaire" class="cap-comment-area" rows="2" placeholder="Ce que tu sais déjà : signature lue, origine, anecdote…"></textarea>
        </div>
      </div>
    </div>`;
}

function renderVuesConseillees() {
  const vues = suggestedViews();
  const done = countDoneViews();
  const total = vues.length;
  const allDone = done === total;

  if (allDone) {
    return `
      <details class="capture-vues">
        <summary class="capture-vues-summary capture-vues-summary-ok">
          <span class="capture-vues-ok">✓</span>
          <span class="capture-vues-title">Vues conseillées</span>
          <span class="capture-vues-count ok">${done} / ${total}</span>
          <span class="capture-vues-chev">▾</span>
        </summary>
        <div class="capture-vues-list">
          ${vues.map(v => renderVueLine(v, true)).join('')}
        </div>
      </details>`;
  }

  return `
    <details class="capture-vues" open>
      <summary class="capture-vues-summary">
        <span class="capture-vues-dot"></span>
        <span class="capture-vues-title">Vues conseillées</span>
        <span class="capture-vues-count">${done} / ${total}</span>
      </summary>
      <div class="capture-vues-list">
        ${vues.map(v => renderVueLine(v, false)).join('')}
      </div>
    </details>`;
}

function renderVueLine(vue, done) {
  return `
    <div class="capture-vue ${done ? 'done' : ''}">
      <span class="capture-vue-bar"></span>
      <div class="capture-vue-txt">
        <span class="capture-vue-label">${esc(vue.label)}</span>
        <span class="capture-vue-hint">${esc(vue.hint)}</span>
      </div>
      <button class="capture-vue-cam" data-action="vue-cam" data-key="${vue.key}" title="Prendre cette vue">📷</button>
    </div>`;
}

function renderZoneAjout() {
  return `
    <div class="capture-addzone" id="cap-dropzone">
      <div class="capture-addzone-round">📷</div>
      <div class="capture-addzone-title">Ajouter une photo</div>
      <div class="capture-addzone-hint">aucune photo pour l'instant</div>
    </div>`;
}

function renderEdition() {
  const idx = getCurrentIndex();
  const item = S.capFiles[idx];
  return renderCarte(item, idx, S.capFiles.length) + renderGrille(S.capFiles, idx);
}

function renderBarreBasse() {
  const n = S.capFiles.length;
  const prefix = n ? `${n} photo${n > 1 ? 's' : ''} · ` : '';
  return `
    <div class="capture-bar">
      <span class="capture-bar-num" id="cap-bar-num">${prefix}l'objet prendra le n° #<span id="cap-num">…</span></span>
      <div class="capture-bar-actions">
        <button class="capture-bar-cam" id="cap-btn-cam" title="Ajouter une photo" aria-label="Ajouter une photo">📷</button>
        <button class="capture-bar-save" id="cap-save">Créer la fiche</button>
      </div>
    </div>`;
}

// ─── Branchement des événements ─────────────────────────────────────────────

async function initCapture() {
  const numEl = $('#cap-num');
  if (numEl) numEl.textContent = '…';
  const [{ data: next }, { data: lieux }] = await Promise.all([
    sb.rpc('peek_objet_id', { p_owner: S.tenantId }),
    sb.from('objets').select('zone,contenant').eq('owner_id', S.tenantId),
  ]);
  if (numEl) numEl.textContent = next ?? '';
  const zones = [...new Set((lieux ?? []).map(r => r.zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const conts = [...new Set((lieux ?? []).map(r => r.contenant).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('#zones').innerHTML = zones.map(z => `<option>${esc(z)}</option>`).join('');
  $('#contenants').innerHTML = conts.map(z => `<option>${esc(z)}</option>`).join('');
}

function brancher() {
  // Retour
  $('[data-action="back"]')?.addEventListener('click', () => { location.hash = '#/'; });

  // Zone d'ajout + boutons caméra/galerie
  const dropzone = $('#cap-dropzone');
  if (dropzone) {
    dropzone.addEventListener('click', () => $('#file-gallery').click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('over'); addCapFiles(e.dataTransfer.files);
    });
  }
  $('#cap-btn-cam')?.addEventListener('click', () => openCamera('capture', { addFiles: addCapFiles }));
  $('#file-camera')?.addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });
  $('#file-gallery')?.addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });

  // Tags radio
  $$('[data-action="tag"]').forEach(btn => {
    btn.addEventListener('click', () => changerTag(btn.dataset.kind));
  });

  // Coins de la carte photo
  $('[data-action="recadrer"]')?.addEventListener('click', () => {
    const idx = getCurrentIndex();
    const item = S.capFiles[idx];
    if (item?.file) openLocalCrop(item.file, idx);
  });
  $('[data-action="retirer"]')?.addEventListener('click', retirerPhoto);
  $('[data-action="couverture"]')?.addEventListener('click', basculerCouverture);
  $('[data-action="rotater"]')?.addEventListener('click', rotaterPhoto);

  // Commentaire + dictée
  const ta = $('[data-action="commentaire"]');
  if (ta) {
    ta.addEventListener('input', () => { const item = S.capFiles[getCurrentIndex()]; if (item) item.comment = ta.value; });
    const mic = micButton(ta);
    if (mic) ta.parentElement.append(mic);
  }

  // Note maison (objets.commentaire — lue par R1 dès la 1re passe) + dictée
  const note = $('#cap-commentaire');
  if (note) {
    const mic = micButton(note);
    if (mic) note.parentElement.append(mic);
  }

  // Grille
  $$('[data-action="select"]').forEach(thumb => {
    thumb.addEventListener('click', () => {
      if (dragState?.moved) return;
      setCurrentIndex(Number(thumb.dataset.idx));
      render();
    });
    initDrag(thumb);
  });

  // Vues conseillées : bouton 📷 par ligne
  $$('[data-action="vue-cam"]').forEach(btn => {
    btn.addEventListener('click', () => openCamera('capture', { addFiles: files => addCapFiles(files) }));
  });

  // Créer la fiche
  $('#cap-save')?.addEventListener('click', creerFiche);

  // Désactivation du clic droit sur les images locales (optionnel, pas critique)
  $$('.cap-viewer img').forEach(img => {
    img.addEventListener('contextmenu', e => e.preventDefault());
  });
}

function addCapFiles(fileList) {
  const first = S.capFiles.length === 0;
  let i = 0;
  for (const f of fileList) {
    const file = f instanceof File ? f : f?.file;
    if (!file) continue;
    const item = {
      file,
      comment: '',
      kind: first && i === 0 && /^image\//.test(file.type) ? 'face' : '',
      cover: first && S.capFiles.length === 0 && i === 0,
      ordre: S.capFiles.length + i + 1,
    };
    S.capFiles.push(item);
    i++;
  }
  if (S.capFiles.length) setCurrentIndex(S.capFiles.length - i || 0);
  render();
}

// ─── Actions unitaires ──────────────────────────────────────────────────────

function changerTag(kind) {
  const idx = getCurrentIndex();
  const item = S.capFiles[idx];
  if (!item || item.kind === kind) return;
  item.kind = kind;
  render();
}

function retirerPhoto() {
  const idx = getCurrentIndex();
  const item = S.capFiles[idx];
  if (!item) return;
  if (item.url) URL.revokeObjectURL(item.url);
  S.capFiles.splice(idx, 1);
  setCurrentIndex(Math.min(idx, S.capFiles.length - 1));
  render();
}

function basculerCouverture() {
  const idx = getCurrentIndex();
  setCover(idx);
  render();
}

async function rotaterPhoto() {
  const idx = getCurrentIndex();
  const item = S.capFiles[idx];
  if (!item?.file || !/^image\//.test(item.file.type)) return;
  try {
    const bmp = await createImageBitmap(item.file);
    const c = document.createElement('canvas');
    c.width = bmp.height; c.height = bmp.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('encodage impossible');
    if (item.url) URL.revokeObjectURL(item.url);
    const name = (item.file.name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg';
    const rotated = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
    item.file = rotated;
    item.url = null; // sera recréé au prochain render
    render();
    toast('✓ Photo pivotée');
  } catch (err) {
    toast(`Rotation échouée : ${err.message ?? err}`, true);
  }
}

// ─── Recadrage local (même pattern que capture.js historique) ─────────────────

function openLocalCrop(file, index) {
  const url = URL.createObjectURL(file);
  const { el: lb, close } = createOverlay({
    className: 'cut',
    html: `<img src="${esc(url)}" alt="Photo à recadrer">
      <div class="cut-bar"><span class="cut-hint">Tire les poignées (bords et coins) pour délimiter la zone à garder</span>
      <button class="btn primary small" data-ok disabled>✂️ Recadrer</button>
      <button class="btn small" data-cancel>Annuler</button></div>`,
    onClose: () => URL.revokeObjectURL(url),
  });

  const img = lb.querySelector('img');
  const ok = lb.querySelector('[data-ok]');
  let sel = { x0: 0, y0: 0, x1: 1, y1: 1 };
  let box = null;
  let drag = null;
  const MIN = 0.05;
  const toRel = e => {
    const r = img.getBoundingClientRect();
    return { x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) };
  };
  const H = {
    nw: (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN), y0: Math.min(p.y, s.y1 - MIN) }),
    n:  (s, p) => ({ ...s, y0: Math.min(p.y, s.y1 - MIN) }),
    ne: (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN), y0: Math.min(p.y, s.y1 - MIN) }),
    e:  (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN) }),
    se: (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN), y1: Math.max(p.y, s.y0 + MIN) }),
    s:  (s, p) => ({ ...s, y1: Math.max(p.y, s.y0 + MIN) }),
    sw: (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN), y1: Math.max(p.y, s.y0 + MIN) }),
    w:  (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN) }),
  };
  const draw = () => {
    if (!box) {
      box = document.createElement('div');
      box.className = 'cut-sel';
      box.innerHTML = Object.keys(H).map(h => `<i data-h="${h}" class="h-${h}"></i>`).join('');
      lb.append(box);
    }
    const r = img.getBoundingClientRect();
    box.style.left = `${r.left + sel.x0 * r.width}px`;
    box.style.top = `${r.top + sel.y0 * r.height}px`;
    box.style.width = `${(sel.x1 - sel.x0) * r.width}px`;
    box.style.height = `${(sel.y1 - sel.y0) * r.height}px`;
  };
  if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
  lb.addEventListener('pointerdown', e => {
    const h = e.target.dataset?.h;
    if (!h) return;
    e.preventDefault(); e.stopPropagation();
    drag = h;
  });
  lb.addEventListener('pointermove', e => {
    if (!drag) return;
    sel = H[drag](sel, toRel(e));
    draw();
    ok.disabled = false;
  });
  lb.addEventListener('pointerup', () => { drag = null; });
  lb.querySelector('[data-cancel]').addEventListener('click', e => { e.stopPropagation(); close(); });
  ok.addEventListener('click', async e => {
    e.stopPropagation();
    ok.disabled = true; ok.textContent = 'Recadrage…';
    try {
      const bmp = await createImageBitmap(file);
      const sx = Math.round(sel.x0 * bmp.width);
      const sy = Math.round(sel.y0 * bmp.height);
      const sw = Math.round((sel.x1 - sel.x0) * bmp.width);
      const sh = Math.round((sel.y1 - sel.y0) * bmp.height);
      if (sw < 20 || sh < 20) throw new Error('zone trop petite');
      const c = document.createElement('canvas');
      c.width = sw; c.height = sh;
      c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
      const out = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
      if (!out) throw new Error('encodage impossible');
      const name = (file.name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg';
      const cropped = new File([out], name, { type: 'image/jpeg', lastModified: Date.now() });
      const item = S.capFiles[index];
      if (item) {
        if (item.url) URL.revokeObjectURL(item.url);
        item.file = cropped;
        item.url = null;
      }
      close();
      toast('✓ Photo recadrée');
      render();
    } catch (err) {
      toast(`Recadrage échoué : ${err.message ?? err}`, true);
      ok.disabled = false; ok.textContent = '✂️ Recadrer';
    }
  });
}

// ─── Drag & drop de la grille (appui long + glisser) ────────────────────────

function initDrag(thumb) {
  let timer = null;
  let startX = 0, startY = 0;

  const start = e => {
    if (e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => activerDrag(thumb, e), 400);
    thumb.setPointerCapture?.(e.pointerId);
  };
  const move = e => {
    if (!timer && !dragState) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (timer && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) { clearTimeout(timer); timer = null; }
    if (dragState) onDragMove(e);
  };
  const end = e => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (dragState) onDragEnd(e);
  };

  thumb.addEventListener('pointerdown', start);
  thumb.addEventListener('pointermove', move);
  thumb.addEventListener('pointerup', end);
  thumb.addEventListener('pointercancel', end);
}

function activerDrag(thumb, e) {
  const grid = thumb.closest('.cap-grid');
  const thumbs = [...grid.querySelectorAll('.cap-thumb')];
  const idx = Number(thumb.dataset.idx);
  const rect = thumb.getBoundingClientRect();
  const clone = thumb.cloneNode(true);
  clone.classList.add('dragging');
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  document.body.append(clone);
  thumb.classList.add('drag-ghost');

  dragState = {
    idx, startIdx: idx, clone, grid, thumbs,
    offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
    moved: false,
  };
}

function onDragMove(e) {
  if (!dragState) return;
  const { clone, offsetX, offsetY } = dragState;
  clone.style.left = `${e.clientX - offsetX}px`;
  clone.style.top = `${e.clientY - offsetY}px`;
  dragState.moved = true;

  clone.style.visibility = 'hidden';
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cap-thumb');
  clone.style.visibility = '';
  if (!target || target === dragState.thumbs[dragState.idx]) return;
  const newIdx = Number(target.dataset.idx);
  if (isNaN(newIdx)) return;

  const arr = [...dragState.thumbs];
  const [moved] = arr.splice(dragState.idx, 1);
  arr.splice(newIdx, 0, moved);
  arr.forEach((t, i) => { t.dataset.idx = i; });
  dragState.idx = newIdx;
  dragState.thumbs = arr;
  gridReorder(arr);
}

function gridReorder(arr) {
  const grid = dragState.grid;
  arr.forEach(t => grid.append(t));
}

function onDragEnd() {
  if (!dragState) return;
  const { startIdx, idx: finalIdx, clone, thumbs } = dragState;
  clone.remove();
  thumbs.forEach(t => t.classList.remove('drag-ghost'));
  dragState = null;

  if (finalIdx !== startIdx) reorderCapFiles(startIdx, finalIdx);
  render();
}

// ─── Enregistrement / création de la fiche ──────────────────────────────────

async function creerFiche() {
  if (!canWrite()) return;
  const categorie = $('#cap-categorie')?.value || '';
  const zone = $('#cap-zone')?.value.trim() || null;
  const contenant = $('#cap-contenant')?.value.trim() || null;
  const commentaire = $('#cap-commentaire')?.value.trim() || null;

  if (!categorie) {
    toast('Choisis d\'abord la catégorie', true);
    $('#cap-categorie')?.focus();
    return;
  }

  const btn = $('#cap-save');
  btn.disabled = true;
  btn.textContent = 'Création…';
  const qui = localStorage.getItem('iartcane-qui') ?? 'alain';

  try {
    if (pendingObjetId) {
      if (!S.capFiles.length) {
        toast('Aucune photo en attente à renvoyer', true);
        return;
      }
      // Retry d'upload sur un objet déjà créé
      await envoyerPhotos(pendingObjetId, true);
      return;
    }

    const { data: newId, error: e0 } = await sb.rpc('next_objet_id', { p_owner: S.tenantId });
    if (e0 || !newId) throw (e0 ?? new Error('numérotation impossible'));

    const { error: e1 } = await sb.from('objets').insert({
      owner_id: S.tenantId,
      id: newId,
      statut: 'nouveau',
      categorie,
      zone,
      contenant,
      commentaire,
      source_capture: 'site',
      verrous_humains: ['categorie'],
      validation_champs: { categorie: { par: qui, at: new Date().toISOString() } },
    });
    if (e1) throw e1;

    logEvent('capture', { n: S.capFiles.length, zone, categorie }, newId);

    if (S.capFiles.length) {
      await envoyerPhotos(newId, false, btn);
      // si des échecs restent, pendingObjetId a été positionné dans envoyerPhotos
      if (pendingObjetId) return;
    }

    finaliserCreation(newId);
  } catch (err) {
    toast(err.message ?? String(err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Créer la fiche';
  }
}

// R1 en tâche de fond (F-capture, 2026-08-28) : on ne bloque PLUS la navigation
// sur les 2 appels Kimi vision (1-3 min mesurées). La fiche s'ouvre tout de
// suite, la recherche continue derrière et se signale par un toast. Si elle
// échoue ou dépasse le plafond (A9), on bascule sur un job `r1` que le cron
// reprendra — l'utilisateur n'attend jamais devant un écran figé (L-027).
function lancerR1EnFond(oid) {
  lancerRecherches(oid)
    .then(async r => {
      if (r.ok) {
        if (!r.skip) toast(`Objet #${oid} — recherche R1 terminée, recharge pour voir.`);
        return;
      }
      await enqueueJobs([oid], 'r1');
    })
    .catch(async () => { await enqueueJobs([oid], 'r1'); });
}

async function envoyerPhotos(oid, isRetry, btn = $('#cap-save')) {
  const total = S.capFiles.length;
  const onProgress = (sent, tot) => { if (btn) btn.textContent = `Envoi photo ${sent + 1}/${tot}…`; };
  const { done, failed } = await uploadPhotosFor(oid, S.capFiles, true, onProgress);

  if (failed.length > 0) {
    pendingObjetId = oid;
    S.capFiles = failed.map(({ item }) => item);
    render();
    if (done > 0) lancerR1EnFond(oid);
    toast(`Objet #${oid} créé — ${done}/${total} photos envoyées. ${failed.length} en échec : renvoyez-les depuis cet écran.`, true);
    return;
  }

  if (done > 0) lancerR1EnFond(oid);

  if (!isRetry) finaliserCreation(oid);
}

function finaliserCreation(oid) {
  S.capFiles = [];
  pendingObjetId = null;
  render();
  toast(`Objet #${oid} créé — recherches en cours en arrière-plan (R1 · R2 suit)`);
  S.refreshHeader?.();
  location.hash = '#/objet/' + encodeURIComponent(oid);
}

// ─── Protection fermeture + Share Target ────────────────────────────────────

window.addEventListener('beforeunload', e => {
  if (S.capFiles.length) { e.preventDefault(); e.returnValue = ''; }
});

function consumeShareFlag() {
  const inSearch = /[?&]partage=1/.test(location.search);
  const inHash = /[?&]partage=1/.test(location.hash);
  if (!inSearch && !inHash) return false;
  const search = location.search.replace(/([?&])partage=1&?/, '$1').replace(/[?&]$/, '');
  history.replaceState(null, '', location.pathname + search + (inHash ? '#/capture' : location.hash));
  return true;
}
async function receiveSharedPhotos() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('share-inbox');
    const keys = await cache.keys();
    const files = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.blob();
      files.push(new File([blob], res.headers.get('x-name') || 'partage.jpg', { type: res.headers.get('x-type') || blob.type || 'image/jpeg' }));
    }
    await caches.delete('share-inbox');
    if (files.length) {
      addCapFiles(files);
      toast(`${plur(files.length, 'photo reçue', 'photos reçues')} par partage`);
    }
  } catch (err) {
    console.warn('share-inbox :', err);
  }
}

