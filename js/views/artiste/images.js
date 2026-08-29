// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/images.js : écran Images de la fiche artiste (3b).
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import { loadViewCss } from '../../core/css.js';
import { sb, logEvent } from '../../core/data.js';
import { toast, enregistrer, withBusy } from '../../core/feedback.js';
import { createOverlay } from '../../core/lightbox.js';
import { page } from '../../ui/page.js';
import { micButton } from '../mic.js';
import { A, hooks } from './etat.js';
import { insererArtistePhoto } from './uploads.js';
import { supprimer, taguer, remplacer, reordonner, cibleArtiste } from '../../services/photos.js';

await loadViewCss('artistes');

// ─── Constantes ─────────────────────────────────────────────────────────────

const ZONES = [
  { key: '', label: 'Choisir une zone…' },
  { key: 'portrait', label: 'Portrait de l\'artiste' },
  { key: 'signature', label: 'Signatures relevées' },
  { key: 'externe', label: 'Galerie externe' },
  { key: 'vrac', label: 'En vrac' },
];

const ZONE_LABELS = {
  portrait: 'portrait',
  signature: 'signature',
  externe: 'galerie externe',
  vrac: 'en vrac',
};

const TAG_SUGGESTIONS = ['sous la base', 'peinte', 'en creux', 'au revers', 'étiquette'];

let currentIndex = 0;
let dragState = null;
let tagInputVisible = false;

// Input file local pour l'ajout d'image depuis l'écran 3b.
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.id = 'file-artiste-image';
fileInput.accept = 'image/*';
fileInput.style.display = 'none';
document.body.append(fileInput);
fileInput.addEventListener('change', async e => {
  if (!canWrite()) { e.target.value = ''; return; }
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !A.nom) return;
  const id = await insererArtistePhoto(files[0], null);
  if (!id) return;
  logEvent('artiste_image_ajoutee', { artiste: A.nom, image: files[0].name }, null);
  toast('Image ajoutée');
  await hooks.recharger(A.nom);
  A.ecran = 'images';
  hooks.rendre();
});

// ─── Rendu principal ────────────────────────────────────────────────────────

export function rendre() {
  const body = $('#artiste-body');
  const images = imagesTriees();
  const n = images.length;

  if (!images[currentIndex]) currentIndex = 0;
  const sel = images[currentIndex];
  const sansZone = images.filter(p => !p.zone).length;

  const corps = page(body, {
    titre: 'Images',
    meta: String(n),
    fil: [...S.fil, { label: 'Images' }],
    barre: {
      actions: [
        { label: '📷 Ajouter', type: 'plat', desactive: !canWrite(), onClick: onAjouter },
        { label: 'Enregistrer', type: 'primaire', plein: true, onClick: onEnregistrer },
      ],
    },
  });

  corps.innerHTML = `
    <div class="art-images-body">
      ${sel ? rendreCarte(sel, n, currentIndex) : rendreSansImage()}
      ${n ? rendreGrille(images, sel) : ''}
      ${sansZone ? `<div class="art-images-status">${sansZone} image${sansZone > 1 ? 's' : ''} attendent leur zone d'apparition</div>` : ''}
    </div>`;

  brancher(corps);
}

function onAjouter() { if (canWrite()) fileInput.click(); }

function onEnregistrer() { toast('✓ Images enregistrées'); hooks.naviguer('fiche'); }

function imagesTriees() {
  return A.images.slice().sort((a, b) => {
    const oa = a.ordre ?? 0;
    const ob = b.ordre ?? 0;
    if (oa !== ob) return oa - ob;
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
}

function imageCourante() {
  return imagesTriees()[currentIndex];
}

// ─── Carte d'édition ──────────────────────────────────────────────────────────

function rendreSansImage() {
  return `<div class="art-images-empty">Aucune image pour cet artiste.</div>`;
}

function rendreCarte(p, n, idx) {
  const rot = p.rotation || 0;
  const modifie = p.updated_at && p.created_at !== p.updated_at;
  const dateImport = fmtShortDate(p.created_at);
  const etatSansZone = !p.zone
    ? '<span class="art-images-state warn">sans zone</span>'
    : '';
  const etatModif = modifie && p.zone
    ? '<span class="art-images-state">modifiée</span>'
    : '';

  return `
    <div class="art-images-card">
      <div class="art-images-card-head">
        <span class="art-images-card-title">Image ${idx + 1} sur ${n}</span>
        <span class="art-images-card-date">· importée le ${esc(dateImport)}</span>
        <span class="art-images-card-state">${etatSansZone}${etatModif}</span>
      </div>
      <div class="art-images-viewer">
        ${p.url
          ? `<img src="${esc(p.url)}" alt="" style="transform: rotate(${rot}deg)" loading="eager" decoding="async">`
          : `<div class="art-images-viewer-placeholder">🖼</div>`}
        <button class="art-images-corner art-images-corner-tl" data-action="recadrer" title="Recadrer">✂</button>
        <button class="art-images-corner art-images-corner-tr" data-action="supprimer" title="Supprimer">🗑</button>
        <button class="art-images-corner art-images-corner-br" data-action="rotater" title="Pivoter de 90°">↻ 90°</button>
      </div>
      <div class="art-images-zone">
        <div class="art-images-label">Où elle apparaît</div>
        <div class="art-images-zone-row">
          <select class="art-images-zone-select ${!p.zone ? 'empty' : ''}" data-action="zone" aria-label="Zone d'apparition">
            ${ZONES.map(z => `<option value="${esc(z.key)}" ${p.zone === z.key ? 'selected' : ''}>${esc(z.label)}</option>`).join('')}
          </select>
          ${p.zone === 'signature' ? rendreSelectObjet(p.objet_id) : ''}
        </div>
      </div>
      <div class="art-images-tags">
        <div class="art-images-label">Ce que montre l'image</div>
        <div class="art-images-tags-list" role="listbox" aria-label="Tags de l'image">
          ${rendreTags(p)}
        </div>
      </div>
      <div class="art-images-comment">
        <div class="art-images-label">Commentaire</div>
        <div class="art-images-comment-wrap">
          <textarea class="art-images-comment-area" rows="2" placeholder="Décris ce qu'on voit…" data-action="commentaire">${esc(p.commentaire || '')}</textarea>
        </div>
      </div>
      ${p.zone === 'signature' ? rendreTranscription(p) : ''}
    </div>`;
}

function rendreSelectObjet(objetId) {
  const objets = A.objets || [];
  const options = objets.map(o =>
    `<option value="${esc(o.id)}" ${String(o.id) === String(objetId || '') ? 'selected' : ''}>#${esc(o.id)} — ${esc(o.titre || 'objet')}</option>`
  ).join('');
  return `
    <select class="art-images-objet-select" data-action="objet-source" aria-label="Objet source de la signature">
      <option value="" ${!objetId ? 'selected' : ''}>aucun</option>
      ${options}
    </select>`;
}

function rendreTags(p) {
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const all = [...new Set([...TAG_SUGGESTIONS, ...tags])];
  const chips = all.map(t => {
    const active = tags.includes(t);
    return `<button type="button" class="art-images-tag ${active ? 'active' : ''}" data-action="tag" data-tag="${esc(t)}" role="option" aria-selected="${active}">${esc(t)}</button>`;
  }).join('');
  const add = tagInputVisible
    ? `<input type="text" class="art-images-tag-input" data-action="tag-input" placeholder="tag…" maxlength="30">`
    : `<button type="button" class="art-images-tag art-images-tag-add" data-action="add-tag">+ tag</button>`;
  return `${chips}${add}`;
}

function rendreTranscription(p) {
  return `
    <div class="art-images-transcription">
      <div class="art-images-label">Lecture de la signature</div>
      <div class="art-images-comment-wrap">
        <textarea class="art-images-comment-area" rows="2" placeholder="lecture de la signature…" data-action="transcription">${esc(p.transcription || '')}</textarea>
      </div>
    </div>`;
}

// ─── Grille ───────────────────────────────────────────────────────────────────

function rendreGrille(images, sel) {
  return `
    <div class="art-images-grid-section">
      <div class="art-images-grid-head">
        <span class="art-images-grid-title">Les ${images.length} image${images.length > 1 ? 's' : ''}</span>
        <span class="art-images-grid-help">touche pour éditer · maintiens et glisse pour l'ordre</span>
      </div>
      <div class="art-images-grid" role="list">
        ${images.map((p, i) => rendreThumb(p, i, sel?.id === p.id)).join('')}
      </div>
    </div>`;
}

function rendreThumb(p, i, selected) {
  const sansZone = !p.zone;
  const label = sansZone ? 'sans zone' : (ZONE_LABELS[p.zone] || p.zone);
  const sigObj = p.zone === 'signature' && p.objet_id ? ` #${esc(p.objet_id)}` : '';
  return `
    <div class="art-images-thumb ${selected ? 'selected' : ''} ${sansZone ? 'untagged' : ''}" data-action="select" data-idx="${i}" role="listitem" tabindex="0" aria-label="Image ${i + 1}">
      ${p.thumbUrl
        ? `<img src="${esc(p.thumbUrl)}" alt="" loading="lazy" decoding="async">`
        : `<span class="art-images-thumb-placeholder">🖼</span>`}
      <span class="art-images-thumb-num">${i + 1}</span>
      ${sansZone ? '<span class="art-images-thumb-warn" aria-label="Zone à choisir">!</span>' : ''}
      <span class="art-images-thumb-label ${sansZone ? 'warn' : ''}">${esc(label)}${sigObj}</span>
    </div>`;
}

// ─── Branchement des événements ───────────────────────────────────────────────

function brancher(el) {
  // Coins de la carte
  el.querySelector('[data-action="recadrer"]')?.addEventListener('click', () => recadrer());
  el.querySelector('[data-action="supprimer"]')?.addEventListener('click', () => supprimerImage());
  el.querySelector('[data-action="rotater"]')?.addEventListener('click', () => pivoterImage());

  // Zone + objet source
  el.querySelector('[data-action="zone"]')?.addEventListener('change', e => changerZone(e.target.value));
  el.querySelector('[data-action="objet-source"]')?.addEventListener('change', e => changerObjetSource(e.target.value || null));

  // Tags
  el.querySelectorAll('[data-action="tag"]').forEach(btn => {
    btn.addEventListener('click', () => basculerTag(btn.dataset.tag));
  });
  const addBtn = el.querySelector('[data-action="add-tag"]');
  if (addBtn) addBtn.addEventListener('click', () => { tagInputVisible = true; hooks.rendre(); });
  const tagInput = el.querySelector('[data-action="tag-input"]');
  if (tagInput) {
    tagInput.focus();
    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = tagInput.value.trim();
        if (v) ajouterTag(v);
        tagInputVisible = false;
      } else if (e.key === 'Escape') {
        tagInputVisible = false;
        hooks.rendre();
      }
    });
    tagInput.addEventListener('blur', () => {
      const v = tagInput.value.trim();
      if (v) ajouterTag(v);
      tagInputVisible = false;
      hooks.rendre();
    });
  }

  // Commentaire + dictée
  const ta = el.querySelector('[data-action="commentaire"]');
  if (ta) {
    const mic = micButton(ta);
    if (mic) ta.parentElement.append(mic);
    ta.addEventListener('change', () => sauverCommentaire(ta.value));
  }

  // Transcription
  const tt = el.querySelector('[data-action="transcription"]');
  if (tt) {
    const mic = micButton(tt);
    if (mic) tt.parentElement.append(mic);
    tt.addEventListener('change', () => sauverTranscription(tt.value));
  }

  // Sélection / drag & drop grille
  el.querySelectorAll('[data-action="select"]').forEach(thumb => {
    thumb.addEventListener('click', () => {
      if (dragState?.moved) return;
      currentIndex = Number(thumb.dataset.idx);
      hooks.rendre();
    });
    initDrag(thumb);
  });
}

// ─── Actions unitaires ──────────────────────────────────────────────────────

async function recadrer() {
  const p = imageCourante();
  if (!p) return;
  if (p.rotation && p.rotation !== 0) {
    toast('Remets l\'image droite (0°) avant de recadrer', true);
    return;
  }
  openCutter(p);
}

async function supprimerImage() {
  const p = imageCourante();
  if (!p) return;
  if (!confirm('Supprimer cette image ? (fichier + référence, définitif)')) return;
  if (!await supprimer(cibleArtiste(A.nom), p)) return;
  logEvent('artiste_image_supprimee', { image: p.storage_path });
  toast('Image supprimée');
  currentIndex = 0;
  await hooks.recharger(A.nom);
}

async function pivoterImage() {
  const p = imageCourante();
  if (!p) return;
  const rotation = ((p.rotation || 0) + 90) % 360;
  if (!await enregistrer(() => sb.from('artistes_photos').update({ rotation }).eq('owner_id', S.tenantId).eq('id', p.id), 'Rotation')) return;
  p.rotation = rotation;
  logEvent('artiste_image_rotation', { image: p.storage_path, deg: rotation });
  hooks.rendre();
}

async function changerZone(zone) {
  const p = imageCourante();
  if (!p) return;
  const valeur = zone || null;
  if (p.zone === valeur) return;
  if (!await taguer(cibleArtiste(A.nom), p, valeur)) { toast("Zone de l'image non enregistrée", true); return; }
  p.zone = valeur;
  if (valeur !== 'signature') p.objet_id = null;
  logEvent('artiste_image_zone', { zone: valeur, objet_id: p.objet_id });
  hooks.rendre();
}

async function changerObjetSource(objetId) {
  const p = imageCourante();
  if (!p || p.zone !== 'signature') return;
  const valeur = objetId || null;
  if (p.objet_id === valeur) return;
  if (!await enregistrer(() => sb.from('artistes_photos').update({ objet_id: valeur }).eq('owner_id', S.tenantId).eq('id', p.id), 'Objet source')) return;
  p.objet_id = valeur;
  logEvent('artiste_image_zone', { zone: p.zone, objet_id: valeur });
  hooks.rendre();
}

async function basculerTag(tag) {
  const p = imageCourante();
  if (!p) return;
  const tags = Array.isArray(p.tags) ? [...p.tags] : [];
  const idx = tags.indexOf(tag);
  if (idx >= 0) tags.splice(idx, 1); else tags.push(tag);
  if (!await enregistrer(() => sb.from('artistes_photos').update({ tags }).eq('owner_id', S.tenantId).eq('id', p.id), 'Tag')) return;
  p.tags = tags;
  logEvent('artiste_image_tag', { tag });
  hooks.rendre();
}

async function ajouterTag(tag) {
  const p = imageCourante();
  if (!p) return;
  const normalise = tag.toLowerCase().trim();
  if (!normalise) return;
  const tags = Array.isArray(p.tags) ? [...p.tags] : [];
  if (tags.includes(normalise)) { tagInputVisible = false; hooks.rendre(); return; }
  tags.push(normalise);
  if (!await enregistrer(() => sb.from('artistes_photos').update({ tags }).eq('owner_id', S.tenantId).eq('id', p.id), 'Tag ajouté')) return;
  p.tags = tags;
  logEvent('artiste_image_tag', { tag: normalise });
  tagInputVisible = false;
  hooks.rendre();
}

async function sauverCommentaire(texte) {
  const p = imageCourante();
  if (!p) return;
  const commentaire = texte.trim() || null;
  if (!await enregistrer(() => sb.from('artistes_photos').update({ commentaire }).eq('owner_id', S.tenantId).eq('id', p.id), "Commentaire de l'image")) return;
  p.commentaire = commentaire;
  logEvent('artiste_image_commentaire', { image: p.storage_path });
}

async function sauverTranscription(texte) {
  const p = imageCourante();
  if (!p || p.zone !== 'signature') return;
  const transcription = texte.trim() || null;
  if (!await enregistrer(() => sb.from('artistes_photos').update({ transcription }).eq('owner_id', S.tenantId).eq('id', p.id), 'Transcription')) return;
  p.transcription = transcription;
  logEvent('artiste_image_transcription', { image: p.storage_path });
}

// ─── Drag & drop réordonnancement ───────────────────────────────────────────

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
    if (timer && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      clearTimeout(timer); timer = null;
    }
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
  const grid = thumb.closest('.art-images-grid');
  const thumbs = [...grid.querySelectorAll('.art-images-thumb')];
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
    idx, clone, grid, thumbs,
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
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.art-images-thumb');
  clone.style.visibility = '';
  if (!target || target === dragState.thumbs[dragState.idx]) return;
  const newIdx = Number(target.dataset.idx);
  if (isNaN(newIdx)) return;

  const arr = [...dragState.thumbs];
  const [moved] = arr.splice(dragState.idx, 1);
  arr.splice(newIdx, 0, moved);
  arr.forEach((t, i) => {
    t.dataset.idx = i;
    const num = t.querySelector('.art-images-thumb-num');
    if (num) num.textContent = i + 1;
  });
  dragState.idx = newIdx;
  dragState.thumbs = arr;
  gridReorder(arr);
}

function gridReorder(arr) {
  const grid = dragState.grid;
  arr.forEach(t => grid.append(t));
}

async function onDragEnd() {
  if (!dragState) return;
  const { idx, clone, thumbs } = dragState;
  clone.remove();
  thumbs.forEach(t => t.classList.remove('drag-ghost'));
  dragState = null;

  const images = imagesTriees();
  const movedId = images[currentIndex]?.id;
  const nouvelOrdre = thumbs.map(t => Number(t.dataset.idx));
  await persisterOrdre(images, nouvelOrdre);

  const nouvellesImages = imagesTriees();
  const nouvelIdx = nouvellesImages.findIndex(p => p.id === movedId);
  if (nouvelIdx >= 0) currentIndex = nouvelIdx;
  hooks.rendre();
}

async function persisterOrdre(images, nouvelOrdre) {
  const { updates, echecs, ok } = await reordonner(cibleArtiste(A.nom), images, nouvelOrdre);
  logEvent('artiste_images_ordre', { n: updates.length, echecs: echecs.length });
  if (!ok) {
    console.warn('persisterOrdre:', echecs);
    toast(`Ordre des images non enregistré — ${echecs.length}/${updates.length} échec${echecs.length > 1 ? 's' : ''} : ${echecs[0].message}`, true,
      { action: { label: 'Réessayer', onClick: () => persisterOrdre(images, nouvelOrdre) } });
    // Tout a échoué → on n'écrit RIEN en mémoire, sinon l'écran affiche un ordre
    // que la base n'a pas et le rendu suivant le « confirme » silencieusement.
    if (echecs.length === updates.length) return;
  } else {
    toast('✓ Ordre des images enregistré');
  }
  A.images.forEach(p => {
    const u = updates.find(u => u.id === p.id);
    if (u) p.ordre = u.ordre;
  });
}

// ─── Lightbox / recadrage ───────────────────────────────────────────────────

function openCutter(p) {
  const { el: lb, close } = createOverlay({
    className: 'cut art-images-cut',
    html: `<img src="${esc(p.url)}" alt="Image à recadrer">
      <div class="cut-bar"><span class="cut-hint">Tire les poignées (bords et coins) pour délimiter la zone à garder</span>
      <button class="btn primary small" data-ok disabled>✂️ Recadrer</button>
      <button class="btn small" data-cancel>Annuler</button></div>`,
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
        const blob = await (await fetch(p.url)).blob();
        const bmp = await createImageBitmap(blob);
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

        // HO-105 : recadrage porté par services/photos.js::remplacer() —
        // écrase désormais storage_path en place (D-073/D-075), au lieu du
        // chemin neuf + suppression de l'ancien pratiqués avant migration.
        const r = await remplacer(cibleArtiste(A.nom), p, out);
        if (!r.ok) throw new Error(r.error);

        close();
        toast('✓ Image recadrée — résolution d’origine conservée');
        logEvent('artiste_image_recadree', { image: p.storage_path });
        await hooks.recharger(A.nom);
      }, { titre: 'Recadrage de l\'image…' });
    } catch (err) {
      toast(`Recadrage échoué : ${err.message ?? err}`, true);
      ok.disabled = false; ok.textContent = '✂️ Recadrer';
    }
  });
}

// ─── Formatage ──────────────────────────────────────────────────────────────

function fmtShortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
