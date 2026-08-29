// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/photos.js : écran Photos de la fiche (HO-047).
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast } from '../../core/dom.js';
import { enregistrer } from '../../core/feedback.js';
import { S } from '../../core/state.js';
import { isVideo } from '../../core/format.js';
import { loadViewCss } from '../../core/css.js';
import { sb, logEvent, deleteStoredPhoto } from '../../core/data.js';
import { openCamera } from '../../core/camera.js';
import { openViewer } from '../../core/lightbox.js';
import { page } from '../../ui/page.js';
import { micButton } from '../mic.js';
import { O, hooks } from './etat.js';

await loadViewCss('objet-photos');

// ─── Constantes ─────────────────────────────────────────────────────────────

const KINDS = [
  { key: 'face', label: 'face' }, { key: 'profil', label: 'profil' },
  { key: 'revers', label: 'revers' }, { key: 'signature', label: 'signature' },
  { key: 'poincon', label: 'marque / poinçon' }, { key: 'detail', label: 'détail décor' },
  { key: 'defaut', label: 'défaut' }, { key: 'echelle', label: 'échelle' },
  { key: 'infos', label: 'infos' }, { key: 'autre', label: 'autre' },
  { key: 'sans_tag', label: '✕ pas de tag' },
];

const VUE_LABELS = {
  face: 'face', profil: 'profil', revers: 'revers', signature: 'signature',
  poincon: 'marque / poinçon', detail: 'détail décor', defaut: 'défaut',
  echelle: 'échelle', infos: 'infos', dos: 'au dos', echelle_regle: 'règle / échelle',
};

let currentIndex = 0;
let dragState = null;

// ─── Rendu principal ────────────────────────────────────────────────────────

export function rendre(el) {
  const o = S.currentObjet;
  const photos = O.photos.slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));

  if (O.focus?.photoId) {
    const idx = photos.findIndex(p => String(p.id) === String(O.focus.photoId));
    if (idx >= 0) currentIndex = idx;
    O.focus = null;
  } else if (!photos[currentIndex]) {
    currentIndex = 0;
  }

  const sel = photos[currentIndex];
  const n = photos.length;
  const nActions = photos.filter(p => p.kind == null).length;
  const vues = Array.isArray(o.vues_manquantes) ? o.vues_manquantes : [];
  const vuesAFaire = vues.filter(v => v.statut !== 'absente');
  const vuesAbsentes = vues.filter(v => v.statut === 'absente');

  const corps = page(el, {
    titre: 'Photos',
    meta: `#${o.id}`,
    fil: [...S.fil, { label: 'Photos' }],
    barre: {
      actions: [
        { label: '📷 Ajouter', type: 'plat', onClick: onAjouter },
        { label: 'Enregistrer', type: 'primaire', plein: true, onClick: onEnregistrer },
        { label: '↻ Relancer les recherches', type: 'plat', onClick: onRelancer },
      ],
    },
  });

  corps.innerHTML = `
    <div class="obj-photos-body">
      ${rendreTiroirVues(vues, vuesAFaire, vuesAbsentes)}
      ${sel ? rendreCartePhoto(sel, n, currentIndex) : rendreSansPhoto()}
      ${rendreGrille(photos, sel)}
      <div class="obj-photos-status">${nActions ? `${nActions} photo${nActions > 1 ? 's' : ''} demandent encore une action` : 'Toutes les photos sont en ordre'}</div>
    </div>`;

  brancher(corps);
}

function rendreTiroirVues(vues, aFaire, absente) {
  if (!vues.length) return '';
  const total = vues.length;
  const nAFaire = aFaire.length;
  const detail = aFaire.map(v => VUE_LABELS[v.vue] || v.vue).join(', ');
  return `
    <details class="photos-vues">
      <summary class="photos-vues-summary">
        <span class="warn-puce"></span>
        <span class="photos-vues-title">${total} vue${total > 1 ? 's' : ''} manquante${total > 1 ? 's' : ''}</span>
        ${detail ? `<span class="photos-vues-detail">${esc(detail)}</span>` : ''}
        <span class="photos-vues-chev">▸</span>
      </summary>
      <div class="photos-vues-list">
        ${vues.map((v, i) => rendreLigneVue(v, i)).join('')}
      </div>
    </details>`;
}

function rendreLigneVue(v, i) {
  const label = VUE_LABELS[v.vue] || v.vue;
  const qui = localStorage.getItem('iartcane-qui') ?? 'alain';
  if (v.statut === 'absente') {
    const date = v.declaree_at ? fmtShortDate(v.declaree_at) : '';
    const par = v.declaree_par || qui;
    return `
      <div class="photos-vue absente" data-vue-idx="${i}">
        <span class="photos-vue-label">${esc(label)}</span>
        <span class="photos-vue-meta">déclarée absente — ${esc(par)}${date ? ', ' + date : ''}</span>
        <button class="photos-vue-undo" data-action="vue-annuler" data-idx="${i}">annuler</button>
      </div>`;
  }
  return `
    <div class="photos-vue" data-vue-idx="${i}">
      <span class="photos-vue-label">${esc(label)}</span>
      <span class="photos-vue-provenance">${esc(v.demandee_par || 'kimi R1')}</span>
      <div class="photos-vue-actions">
        <button class="photos-vue-prendre" data-action="vue-prendre" data-idx="${i}">prendre la vue</button>
        <button class="photos-vue-none" data-action="vue-absente" data-idx="${i}">il n'y en a pas</button>
      </div>
    </div>`;
}

function rendreSansPhoto() {
  return `<div class="photos-empty">Aucune photo pour cet objet.</div>`;
}

function rendreCartePhoto(p, n, idx) {
  const kindLabel = KINDS.find(k => k.key === p.kind)?.label || (p.kind === 'video' ? 'vidéo' : (p.kind || 'sans tag'));
  const isCover = p.couverture;
  const rot = p.rotation || 0;
  const hasRemarque = p.remarque_statut === 'en_attente' && p.remarque_ia;
  const modifie = p.updated_at && p.created_at !== p.updated_at;

  return `
    <div class="photos-card">
      <div class="photos-card-head">
        <span class="photos-card-title">Photo ${idx + 1} sur ${n}</span>
        <span class="photos-card-kind">· ${esc(kindLabel)}</span>
        <span class="photos-card-edited">${modifie ? 'modifiée' : ''}</span>
      </div>
      <div class="photos-viewer" oncontextmenu="return false">
        ${p.thumbUrl || p.url
          ? (isVideo(p)
              ? `<video src="${esc(p.url)}" controls preload="metadata"></video>`
              : `<img src="${esc(p.url || p.thumbUrl)}" alt="" style="transform: rotate(${rot}deg)" loading="eager" decoding="async" draggable="false">`)
          : `<div class="photos-viewer-placeholder">📷</div>`}
        <button class="photos-corner photos-corner-tl" data-action="modifier" title="Modifier la photo">✎ Modifier</button>
        <button class="photos-corner photos-corner-tr" data-action="supprimer" title="Supprimer">🗑</button>
        <button class="photos-corner photos-corner-bl ${isCover ? 'active' : ''}" data-action="couverture" title="Couverture">
          <span>★</span><span>Couverture</span>
        </button>
      </div>
      ${hasRemarque ? rendreRemarque(p) : ''}
      <div class="photos-tags">
        <div class="photos-tags-label">Ce que montre la photo</div>
        <div class="photos-tags-list" role="radiogroup" aria-label="Tag de la photo">
          ${KINDS.map(k => `
            <button type="button" class="photos-tag ${p.kind === k.key ? 'active' : ''}"
              data-action="tag" data-kind="${k.key}" role="radio" aria-checked="${p.kind === k.key}">
              ${esc(k.label)}
            </button>`).join('')}
        </div>
      </div>
      <div class="photos-comment">
        <div class="photos-comment-label">Commentaire</div>
        <div class="photos-comment-wrap">
          <textarea class="photos-comment-area" rows="2" placeholder="Décris ce qu'on voit…" data-action="commentaire">${esc(p.commentaire || '')}</textarea>
        </div>
      </div>
    </div>`;
}

function rendreRemarque(p) {
  return `
    <div class="photos-remarque">
      <div class="photos-remarque-head">
        <span class="photos-remarque-badge">à reprendre</span>
        <span class="photos-remarque-txt">${esc(p.remarque_ia)}</span>
      </div>
      <div class="photos-remarque-actions">
        <button class="photos-remarque-refuse" data-action="remarque-refuse">Non, elle me convient</button>
        <button class="photos-remarque-reprendre" data-action="remarque-reprendre">📷 reprendre</button>
      </div>
    </div>`;
}

function rendreGrille(photos, sel) {
  return `
    <div class="photos-grid-section">
      <div class="photos-grid-head">
        <span class="photos-grid-title">Les ${photos.length} photo${photos.length > 1 ? 's' : ''}</span>
        <span class="photos-grid-help">touche pour éditer · maintiens et glisse pour l'ordre</span>
      </div>
      <div class="photos-grid" role="list" oncontextmenu="return false">
        ${photos.map((p, i) => rendreThumb(p, i, sel?.id === p.id)).join('')}
      </div>
    </div>`;
}

function rendreThumb(p, i, selected) {
  const kindLabel = KINDS.find(k => k.key === p.kind)?.label || (p.kind === 'video' ? 'vidéo' : (p.kind || 'sans tag'));
  const hasAction = p.kind == null;
  const untagged = p.kind == null;
  return `
    <div class="photos-thumb ${selected ? 'selected' : ''} ${untagged ? 'untagged' : ''}" data-action="select" data-idx="${i}" role="listitem" tabindex="0" aria-label="Photo ${i + 1}, ${esc(kindLabel)}">
      ${p.thumbUrl
        ? (isVideo(p) ? '<span class="photos-thumb-vid">▶</span>' : `<img src="${esc(p.thumbUrl)}" alt="" loading="lazy" decoding="async" draggable="false">`)
        : '<span class="photos-thumb-placeholder">📷</span>'}
      ${p.couverture ? '<span class="photos-thumb-cover" aria-label="Couverture">★</span>' : ''}
      <span class="photos-thumb-num">${i + 1}</span>
      ${hasAction ? '<span class="photos-thumb-warn" aria-label="Action en attente">!</span>' : ''}
      ${untagged ? '<span class="photos-thumb-banner">à taguer</span>' : ''}
      <span class="photos-thumb-kind ${untagged ? 'warn' : ''}">${esc(kindLabel)}</span>
    </div>`;
}

// ─── Branchement des événements ─────────────────────────────────────────────

function onAjouter() { $('#file-add-photo').click(); }

function onEnregistrer() { toast('✓ Photos enregistrées'); hooks.naviguer('hub'); }

async function onRelancer(evt) {
  const btn = evt.target?.closest ? evt.target.closest('[data-ui-action]') : null;
  const o = S.currentObjet;
  if (!o) return;
  if (!confirm(`Relancer les recherches de #${o.id} ?\n\nR1 (Kimi, ~40 s) repart si des photos ont changé, puis R2 (Lens) est enfilée — le cron la prend sous ~2 min.`)) return;
  if (btn) btn.disabled = true;
  const { lancerRecherches, enqueueJobs } = await import('../../core/data.js');
  const force = o.statut === 'validee';
  const r = await lancerRecherches(o.id, { force });
  if (r.ok) {
    logEvent('relance', { force, certain: r.certain ?? null });
    toast(r.skip
      ? `R1 sautée (${r.skip}) — R2 (Lens) en file`
      : `R1 terminée${r.certain ? ' — auteur certain ✓' : ' — doute : analyse versée à la description'} · R2 (Lens) en file`);
  } else if (r.reseau) {
    const n = await enqueueJobs([o.id], 'r1');
    if (n) toast('R1 en file — le cron la prend sous ~2 min');
  }
  hooks.recharger(o.id);
}

function brancher(el) {
  // Coins de la carte photo
  el.querySelector('[data-action="modifier"]')?.addEventListener('click', () => {
    const p = photoCourante();
    if (!p) return;
    location.hash = `#/objet/${encodeURIComponent(S.currentObjet.id)}/photo/${encodeURIComponent(p.id)}/modifier`;
  });
  el.querySelector('[data-action="supprimer"]')?.addEventListener('click', () => supprimerPhoto());
  el.querySelector('[data-action="couverture"]')?.addEventListener('click', () => basculerCouverture());

  // Remarque IA
  el.querySelector('[data-action="remarque-refuse"]')?.addEventListener('click', () => refuserRemarque());
  el.querySelector('[data-action="remarque-reprendre"]')?.addEventListener('click', () => { openCamera('objet', { onClose: onCamClose }); });

  // Tags radio
  el.querySelectorAll('[data-action="tag"]').forEach(btn => { btn.addEventListener('click', () => changerTag(btn.dataset.kind)); });

  // Commentaire + dictée
  const ta = el.querySelector('[data-action="commentaire"]');
  if (ta) {
    const mic = micButton(ta);
    if (mic) ta.parentElement.append(mic);
    ta.addEventListener('change', () => sauverCommentaire(ta.value));
  }

  // Vues manquantes
  el.querySelectorAll('[data-action="vue-prendre"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openCamera('objet', { onClose: onCamClose });
    });
  });
  el.querySelectorAll('[data-action="vue-absente"]').forEach(btn => {
    btn.addEventListener('click', () => declarerVueAbsente(Number(btn.dataset.idx)));
  });
  el.querySelectorAll('[data-action="vue-annuler"]').forEach(btn => {
    btn.addEventListener('click', () => annulerVueAbsente(Number(btn.dataset.idx)));
  });

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

// ─── Helpers d'état ─────────────────────────────────────────────────────────

function photosTriees() {
  return O.photos.slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
}

function photoCourante() {
  return photosTriees()[currentIndex];
}

// ─── Actions unitaires ──────────────────────────────────────────────────────

async function supprimerPhoto() {
  const p = photoCourante();
  const o = S.currentObjet;
  if (!p || !o) return;
  if (!confirm('Supprimer cette photo ? (fichier + référence, définitif)')) return;
  if (!await deleteStoredPhoto('photos', p.id, [p.storage_path, p.thumb_path])) return;
  logEvent('photo_supprimee', { photo: p.storage_path });
  toast('Photo supprimée');
  currentIndex = 0;
  await hooks.recharger(o.id);
}

async function basculerCouverture() {
  const p = photoCourante();
  const o = S.currentObjet;
  if (!p || !o) return;
  const updates = O.photos.map(ph => ({
    id: ph.id,
    couverture: ph.id === p.id,
  }));
  for (const u of updates) {
    if (!await enregistrer(() => sb.from('photos').update({ couverture: u.couverture }).eq('owner_id', S.tenantId).eq('id', u.id), 'Photo de couverture', { silencieuxSiOk: true })) return;
  }
  O.photos.forEach(ph => { ph.couverture = ph.id === p.id; });
  toast('✓ Photo de couverture enregistré');
  logEvent('couverture', { photo: p.storage_path });
  hooks.rendre();
}

async function changerTag(kind) {
  const p = photoCourante();
  const o = S.currentObjet;
  if (!p || !o || p.kind === kind) return;
  if (!await enregistrer(() => sb.from('photos').update({ kind }).eq('owner_id', S.tenantId).eq('id', p.id), 'Tag de la photo')) return;
  p.kind = kind;
  logEvent('tag_photo', { photo: p.storage_path, kind });
  hooks.rendre();
}

async function sauverCommentaire(texte) {
  const p = photoCourante();
  const o = S.currentObjet;
  if (!p || !o) return;
  const commentaire = texte.trim() || null;
  if (!await enregistrer(() => sb.from('photos').update({ commentaire }).eq('owner_id', S.tenantId).eq('id', p.id), 'Commentaire de la photo', { silencieuxSiOk: false })) return;
  p.commentaire = commentaire;
  logEvent('commentaire_photo', { photo: p.storage_path });
}

async function refuserRemarque() {
  const p = photoCourante();
  const o = S.currentObjet;
  if (!p || !o) return;
  if (!await enregistrer(() => sb.from('photos').update({ remarque_statut: 'refusee' }).eq('owner_id', S.tenantId).eq('id', p.id), 'Remarque écartée')) return;
  p.remarque_statut = 'refusee';
  logEvent('remarque_refusee', { photo: p.storage_path });
  hooks.rendre();
}

// ─── Vues manquantes ────────────────────────────────────────────────────────

function vuesCourantes() {
  return Array.isArray(S.currentObjet.vues_manquantes) ? S.currentObjet.vues_manquantes : [];
}

async function declarerVueAbsente(idx) {
  const o = S.currentObjet;
  if (!o) return;
  const vues = vuesCourantes();
  const v = vues[idx];
  if (!v) return;
  const declaree_par = localStorage.getItem('iartcane-qui') ?? 'alain';
  const updated = [...vues];
  updated[idx] = { ...v, statut: 'absente', declaree_par, declaree_at: new Date().toISOString() };
  if (!await enregistrer(() => sb.from('objets').update({ vues_manquantes: updated }).eq('owner_id', S.tenantId).eq('id', o.id), 'Vue signalée absente')) return;
  o.vues_manquantes = updated;
  logEvent('vue_absente', { vue: v.vue });
  hooks.rendre();
}

async function annulerVueAbsente(idx) {
  const o = S.currentObjet;
  if (!o) return;
  const vues = vuesCourantes();
  const v = vues[idx];
  if (!v) return;
  const updated = [...vues];
  updated[idx] = { ...v, statut: 'a_faire', declaree_par: null, declaree_at: null };
  if (!await enregistrer(() => sb.from('objets').update({ vues_manquantes: updated }).eq('owner_id', S.tenantId).eq('id', o.id), 'Vue rétablie')) return;
  o.vues_manquantes = updated;
  logEvent('vue_absente_annulee', { vue: v.vue });
  hooks.rendre();
}

// ─── Caméra / upload ────────────────────────────────────────────────────────

async function onCamClose(n) {
  const o = S.currentObjet;
  if (!o || !n) return;
  const { purgeConsigne } = await import('../../core/data.js');
  await purgeConsigne(o, o.id);
  if (o.statut !== 'validee') toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} — « Relancer les recherches » quand tu es prêt`);
  await hooks.recharger(o.id);
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
  const grid = thumb.closest('.photos-grid');
  const thumbs = [...grid.querySelectorAll('.photos-thumb')];
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

  // Trouver la cible sous le curseur
  clone.style.visibility = 'hidden';
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.photos-thumb');
  clone.style.visibility = '';
  if (!target || target === dragState.thumbs[dragState.idx]) return;
  const newIdx = Number(target.dataset.idx);
  if (isNaN(newIdx)) return;

  // Réordonner visuellement
  const arr = [...dragState.thumbs];
  const [moved] = arr.splice(dragState.idx, 1);
  arr.splice(newIdx, 0, moved);
  arr.forEach((t, i) => {
    t.dataset.idx = i;
    const num = t.querySelector('.photos-thumb-num');
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

  const photos = photosTriees();
  const movedId = photos[currentIndex]?.id;
  const nouvelOrdre = thumbs.map(t => Number(t.dataset.idx));
  await persisterOrdre(photos, nouvelOrdre);

  // Recaler currentIndex sur la photo qui était en cours
  const nouvellesPhotos = photosTriees();
  const nouvelIdx = nouvellesPhotos.findIndex(p => p.id === movedId);
  if (nouvelIdx >= 0) currentIndex = nouvelIdx;
  hooks.rendre();
}

async function persisterOrdre(photos, nouvelOrdre) {
  const o = S.currentObjet;
  if (!o) return;
  const updates = photos.map((p, i) => ({ id: p.id, ordre: nouvelOrdre[i] }));
  for (const u of updates) {
    if (!await enregistrer(() => sb.from('photos').update({ ordre: u.ordre }).eq('owner_id', S.tenantId).eq('id', u.id), 'Ordre des photos', { silencieuxSiOk: true })) return;
  }
  O.photos.forEach(p => {
    const u = updates.find(u => u.id === p.id);
    if (u) p.ordre = u.ordre;
  });
  toast('✓ Ordre des photos enregistré');
  logEvent('ordre_photos', { n: updates.length });
}

// ─── Lightbox ───────────────────────────────────────────────────────────────

async function openLightbox(photo) {
  const titre = S.currentObjet?.titre || 'objet';
  openViewer({ src: photo.url, alt: `Photo plein écran — ${titre}`, video: isVideo(photo) });
}

// ─── Formatage ──────────────────────────────────────────────────────────────

function fmtShortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
