// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/capture/photos.js : carte d'édition + grille de la
// création d'objet (HO-054). Pas d'import d'une autre vue.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { isVideo } from '../../core/format.js';
import { KINDS, kindLabel } from './etat.js';

// ─── Carte d'édition photo ──────────────────────────────────────────────────

export function renderCarte(item, idx, n) {
  const label = kindLabel(item.kind) || 'sans tag';
  const isCover = !!item.cover;
  const url = item.url || (item.file ? URL.createObjectURL(item.file) : null);
  if (url && !item.url) item.url = url; // mémorise le blob pour éviter les doubles

  return `
    <div class="cap-card" data-role="card">
      <div class="cap-card-head">
        <span class="cap-card-title">Photo ${idx + 1} sur ${n}</span>
        <span class="cap-card-kind">· ${esc(label)}</span>
        <span class="cap-card-state">non enregistrée</span>
      </div>
      <div class="cap-viewer">
        ${item.file
          ? (isVideo(item.file)
              ? `<video src="${esc(url)}" controls preload="metadata"></video>`
              : `<img src="${esc(url)}" alt="">`)
          : `<div class="cap-viewer-placeholder">📷</div>`}
        <button class="cap-corner cap-corner-tl" data-action="recadrer" title="Recadrer">✂</button>
        <button class="cap-corner cap-corner-tr" data-action="retirer" title="Retirer">🗑</button>
        <button class="cap-corner cap-corner-bl ${isCover ? 'active' : ''}" data-action="couverture" title="Couverture">
          <span>★</span><span>Couverture</span>
        </button>
        <button class="cap-corner cap-corner-br" data-action="rotater" title="Pivoter de 90°">↻ 90°</button>
      </div>
      ${renderTags(item)}
      ${renderCommentaire(item)}
    </div>`;
}

function renderTags(item) {
  return `
    <div class="cap-tags">
      <div class="cap-tags-label">Ce que montre la photo</div>
      <div class="cap-tags-list" role="radiogroup" aria-label="Tag de la photo">
        ${KINDS.map(k => `
          <button type="button" class="cap-tag ${item.kind === k.key ? 'active' : ''}"
            data-action="tag" data-kind="${k.key}" role="radio" aria-checked="${item.kind === k.key}">
            ${esc(k.label)}
          </button>`).join('')}
      </div>
    </div>`;
}

function renderCommentaire(item) {
  return `
    <div class="cap-comment">
      <div class="cap-comment-label">Commentaire</div>
      <div class="cap-comment-wrap">
        <textarea class="cap-comment-area" rows="2" placeholder="Ce que tu vois, ce que tu sais de l'objet…" data-action="commentaire">${esc(item.comment ?? '')}</textarea>
      </div>
    </div>`;
}

// ─── Grille des photos ──────────────────────────────────────────────────────

export function renderGrille(files, currentIndex) {
  return `
    <div class="cap-grid-section">
      <div class="cap-grid-head">
        <span class="cap-grid-title">Les ${files.length} photo${files.length > 1 ? 's' : ''}</span>
        <span class="cap-grid-help">touche pour éditer · maintiens et glisse pour l'ordre</span>
      </div>
      <div class="cap-grid" role="list">
        ${files.map((item, i) => renderThumb(item, i, i === currentIndex)).join('')}
      </div>
    </div>`;
}

function renderThumb(item, i, selected) {
  const label = kindLabel(item.kind) || '';
  const isCover = !!item.cover;
  let url = null;
  if (item.file && /^image\//.test(item.file.type)) {
    url = item.url || URL.createObjectURL(item.file);
    if (!item.url) item.url = url;
  }
  return `
    <div class="cap-thumb ${selected ? 'selected' : ''}" data-action="select" data-idx="${i}" role="listitem" tabindex="0" aria-label="Photo ${i + 1}${label ? ', ' + esc(label) : ''}">
      ${url
        ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">`
        : `<span class="cap-thumb-placeholder">📷</span>`}
      ${isCover ? '<span class="cap-thumb-cover" aria-label="Couverture">★</span>' : ''}
      <span class="cap-thumb-num">${i + 1}</span>
      <span class="cap-thumb-kind">${esc(label)}</span>
    </div>`;
}
