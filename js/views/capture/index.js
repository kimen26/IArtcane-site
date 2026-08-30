// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/capture/index.js : création d'objet, écrans 4a/4b (HO-054).
// Remplace le contenu de #view-capture à chaque mount ; capture.js est coquille.
// Depuis HO-106 : galerie()/vignettes() (ui/) portent carte + grille, ex-
// capture/photos.js (supprimé, absorbé). Photos pas encore en base (`File`
// locaux, S.capFiles) : pas de services/photos.js ici, chaque item porte un
// `id` local stable (assigné à l'ajout). Modifier remplace ✂/🗑/↻90° (D-073/
// HO-095) : `sur.modifier` ouvre openLocalCrop (gardé, pas d'équivalent
// routé, même raisonnement qu'artiste) ; rotaterPhoto disparaît faute de
// bouton — signalé au rapport.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast } from '../../core/dom.js';
import { withBusy, humaniser } from '../../core/feedback.js';
import { S } from '../../core/state.js';
import { plur, isVideo } from '../../core/format.js';
import { sb } from '../../core/data.js';
import { openCamera } from '../../core/camera.js';
import { loadViewCss } from '../../core/css.js';
import { createOverlay } from '../../core/lightbox.js';
import { galerie } from '../../ui/galerie.js';
import { micButton } from '../mic.js';
import { CATS_PROMPT } from '../../core/taxonomie.js';
import { getCurrentIndex, setCurrentIndex, ensureCurrentIndex, suggestedViews, countDoneViews, setCover, reorderCapFiles, KINDS, kindLabel } from './etat.js';
import { creerFiche, setRenderer } from './creation.js';

await loadViewCss('capture');

setRenderer(render);

export function mount() {
  ensureCurrentIndex();
  render();
  initCapture();
  if (consumeShareFlag()) receiveSharedPhotos();
}

function render() {
  const n = S.capFiles.length;
  ensureCurrentIndex();

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
        ${n === 0 ? renderZoneAjout() : '<div class="capture-galerie" data-role="galerie"></div>'}
      </div>

      ${renderBarreBasse()}
    </div>`;

  if (n > 0) {
    galerie($('[data-role="galerie"]'), {
      images: S.capFiles.map(mapImage), courante: getCurrentIndex(), mode: 'edition',
      tags: KINDS, libelle: 'Photo', peutAjouter: false, peutReordonner: true,
      actions: ['modifier', 'couverture', 'supprimer'],
      sur: { choisir: onChoisir, reordonner: onReordonner, taguer: changerTag, modifier: onModifier, supprimer: retirerPhoto, couverture: basculerCouverture, commenter: () => {} },
    });
  }

  brancher();
}

function mapImage(item) {
  const label = kindLabel(item.kind) || null;
  const url = item.url || (item.file ? URL.createObjectURL(item.file) : null);
  if (url && !item.url) item.url = url;
  const estImage = item.file && /^image\//.test(item.file.type);
  return {
    id: item.id, url, thumbUrl: estImage ? url : null, tag: label,
    couverture: !!item.cover, commentaire: item.comment, video: !!(item.file && isVideo(item.file)),
  };
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
        <div class="capture-vues-list">${vues.map(v => renderVueLine(v, true)).join('')}</div>
      </details>`;
  }

  return `
    <details class="capture-vues" open>
      <summary class="capture-vues-summary">
        <span class="capture-vues-dot"></span>
        <span class="capture-vues-title">Vues conseillées</span>
        <span class="capture-vues-count">${done} / ${total}</span>
      </summary>
      <div class="capture-vues-list">${vues.map(v => renderVueLine(v, false)).join('')}</div>
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
  $('[data-action="back"]')?.addEventListener('click', () => { location.hash = '#/'; });

  const dropzone = $('#cap-dropzone');
  if (dropzone) {
    dropzone.addEventListener('click', () => $('#file-gallery').click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
    dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('over'); addCapFiles(e.dataTransfer.files); });
  }
  $('#cap-btn-cam')?.addEventListener('click', () => openCamera('capture', { addFiles: addCapFiles }));
  $('#file-camera')?.addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });
  $('#file-gallery')?.addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });

  // 'input', pas seulement 'change' (comme galerie() l'écoute pour objet/
  // artiste, DB) : capture est local, rien à perdre si "Créer la fiche"
  // arrive avant le blur du champ.
  const ta = $('.ui-galerie-comment-area');
  if (ta) {
    ta.addEventListener('input', () => { const item = S.capFiles[getCurrentIndex()]; if (item) item.comment = ta.value; });
    const mic = micButton(ta);
    if (mic) ta.parentElement.append(mic);
  }

  const note = $('#cap-commentaire');
  if (note) { const mic = micButton(note); if (mic) note.parentElement.append(mic); }

  $$('[data-action="vue-cam"]').forEach(btn => {
    btn.addEventListener('click', () => openCamera('capture', { addFiles: files => addCapFiles(files) }));
  });

  $('#cap-save')?.addEventListener('click', creerFiche);
}

function addCapFiles(fileList) {
  const first = S.capFiles.length === 0;
  let i = 0;
  for (const f of fileList) {
    const file = f instanceof File ? f : f?.file;
    if (!file) continue;
    S.capFiles.push({
      id: crypto.randomUUID(), file, comment: '',
      kind: first && i === 0 && /^image\//.test(file.type) ? 'face' : '',
      cover: first && S.capFiles.length === 0 && i === 0,
      ordre: S.capFiles.length + i + 1,
    });
    i++;
  }
  if (S.capFiles.length) setCurrentIndex(S.capFiles.length - i || 0);
  render();
}

function onChoisir(i) { setCurrentIndex(i); render(); }

function changerTag(kind) {
  const item = S.capFiles[getCurrentIndex()];
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

function basculerCouverture() { setCover(getCurrentIndex()); render(); }

function onModifier() {
  const item = S.capFiles[getCurrentIndex()];
  if (item?.file) openLocalCrop(item.file, getCurrentIndex());
}

// ordre[i] (permutation complète, ui/glisser.js) → (startIdx,finalIdx) pour
// reorderCapFiles, figé dans etat.js : un seul item bouge par glissé, c'est
// celui dont l'écart |ordre[i]-i| est maximal (les autres décalent d'un cran).
function onReordonner(ordre) {
  let startIdx = 0, ecart = -1;
  ordre.forEach((rang, i) => { const e = Math.abs(rang - i); if (e > ecart) { ecart = e; startIdx = i; } });
  const finalIdx = ordre[startIdx];
  if (finalIdx !== startIdx) reorderCapFiles(startIdx, finalIdx);
  render();
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
      await withBusy(async () => {
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
      }, { titre: 'Recadrage de la photo…' });
    } catch (err) {
      console.warn('recadrage capture:', err); toast(`Recadrage échoué — ${humaniser(err)}. Réessaie.`, 'action');
    } finally {
      ok.disabled = false; ok.textContent = '✂️ Recadrer';
    }
  });
}

// Enregistrement / création de la fiche : voir ./creation.js (HO-079)

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
    try {
      await caches.delete('share-inbox');
    } catch (errDelete) {
      console.warn('share-inbox : purge du cache échouée (non bloquant) :', errDelete);
    }
    if (files.length) {
      addCapFiles(files);
      toast(`${plur(files.length, 'photo reçue', 'photos reçues')} par partage`);
    }
  } catch (err) {
    console.warn('share-inbox :', err);
    toast(`Photos partagées non récupérées — ${humaniser(err)}. Réessaie le partage.`, 'action');
  }
}
