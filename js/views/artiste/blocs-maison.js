// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/blocs-maison.js : blocs « ce que la maison sait »
// de la fiche artiste (ventes, chez toi, galerie externe, journal).
//
// Extrait de index.js par HO-112, déplacement pur.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import { fmtDate, fmtNum } from '../../core/format.js';
import { A } from './etat.js';

// 6. Ventes vérifiées
export function rendreVentes() {
  if (!A.ventes.length) return '';
  const focusId = A.focus?.objetId;
  const affichees = A.ventes.slice(0, 3);
  const cachees = A.ventes.slice(3);

  function ligneHtml(v, highlighted = false) {
    const prix = v.prix != null ? `${fmtNum(v.prix)} €` : '';
    const estim = (v.estimation_bas != null && v.estimation_haut != null)
      ? `est. ${fmtNum(v.estimation_bas)}–${fmtNum(v.estimation_haut)}`
      : '';
    const dateStr = v.date_vente ? fmtDate(v.date_vente) : '—';
    const lot = v.lot ? esc(v.lot) : 'Lot sans titre';
    const meta = [esc(v.maison ?? ''), dateStr].filter(Boolean).join(' · ');
    return `
      <div class="art-vente-row ${highlighted ? 'highlight' : ''}">
        <div class="art-vente-main">
          <div class="art-vente-title">${lot}</div>
          <div class="art-vente-meta">${meta}</div>
        </div>
        <div class="art-vente-price">
          <div>${prix}</div>
          ${estim ? `<div class="art-vente-est">${estim}</div>` : ''}
        </div>
      </div>`;
  }

  return `
    <section class="art-ventes" aria-label="Ventes vérifiées">
      <div class="art-section-head">
        <span>Ventes vérifiées</span>
        <span class="art-section-meta">${A.ventes.length} · liens au procès-verbal</span>
      </div>
      ${affichees.map(v => ligneHtml(v, focusId && v.objet_id === focusId)).join('')}
      ${cachees.length ? `<details class="art-ventes-more acc"><summary>voir les ${A.ventes.length}</summary>${cachees.map(v => ligneHtml(v, focusId && v.objet_id === focusId)).join('')}</details>` : ''}
    </section>`;
}

// 8. Chez toi
export function rendreChezToi() {
  const objetsAffiches = A.objets.slice(0, 2);
  const avecPrix = A.objets.filter(o => o.prix_bas != null);
  let estimHtml = '';
  if (avecPrix.length) {
    const bas = avecPrix.reduce((s, o) => s + Number(o.prix_bas), 0);
    const haut = avecPrix.reduce((s, o) => s + Number(o.prix_haut ?? o.prix_bas), 0);
    estimHtml = `<div class="art-chez-estim"><div class="art-chez-estim-value">${fmtNum(bas)}–${fmtNum(haut)} €</div><div class="art-chez-estim-label">estimation cumulée</div></div>`;
  }

  const objetsHtml = objetsAffiches.map(o => {
    const img = S.photoMap[o.id];
    return `<div class="art-chez-obj" data-action="nav-objet" data-oid="${esc(o.id)}">
      ${img?.url ? `<img src="${esc(img.url)}" alt="" loading="lazy" decoding="async">` : `<span class="art-chez-noimg">${o.categorie ? esc(o.categorie.charAt(0)) : '•'}</span>`}
      <div class="art-chez-obj-id">#${esc(o.id)} · ${esc(o.titre || 'objet')}</div>
    </div>`;
  }).join('');

  const objetsSansSig = A.objets.filter(o => !A.signatures.some(s => s.objetId === o.id));
  const signaturesHtml = A.signatures.map(s => `
    <div class="art-chez-sigcase" data-action="zoom-signature" data-pid="${esc(s.id)}" data-oid="${esc(s.objetId)}">
      <img src="${esc(s.thumbUrl || s.url)}" alt="" loading="lazy" decoding="async">
      <div class="art-chez-sigcode">#${esc(s.objetId)}<br>${esc(s.transcription || '')}</div>
    </div>`).join('');

  const releverHtml = objetsSansSig.length ? `
    <div class="art-chez-relever-wrap">
      <button class="art-chez-relever" data-action="show-relever">
        <span>＋</span><span>relever</span>
      </button>
      <div class="art-chez-relever-menu hidden">
        ${objetsSansSig.map(o => `<button data-action="nav-objet" data-oid="${esc(o.id)}">#${esc(o.id)} · ${esc(o.titre || 'objet')}</button>`).join('')}
      </div>
    </div>` : '';

  return `
    <section class="art-cheztoi" aria-label="Chez toi">
      <div class="art-section-head">
        <span>Chez toi</span>
        <span class="art-section-meta">${A.objets.length} objet${A.objets.length > 1 ? 's' : ''}${avecPrix.length ? ` · ${avecPrix.length} à valider` : ''}</span>
      </div>
      <div class="art-chez-objets">
        ${objetsHtml}
        ${estimHtml}
      </div>
      ${A.signatures.length || objetsSansSig.length ? `
        <div class="art-chez-sigs">
          <div class="art-chez-sigs-head">
            <span>Signatures relevées chez toi</span>
            ${A.signatures.length ? `<button class="art-chez-sigs-compare" data-action="comparer-signatures">comparer ›</button>` : ''}
          </div>
          <div class="art-chez-siggrid">
            ${signaturesHtml}${releverHtml}
          </div>
        </div>` : ''}
    </section>`;
}

// 9. Galerie externe
export function rendreExterne() {
  const imgs = A.images.filter(p => p.zone === 'externe');
  if (!imgs.length) return '';

  return `
    <section class="art-externe" aria-label="Galerie externe">
      <div class="art-section-head">
        <span>Galerie externe</span>
        <span class="art-section-meta">ni vente, ni chez toi · ${imgs.length}</span>
      </div>
      <div class="art-ext-grid">
        ${imgs.map(p => `
          <div class="art-ext-item" data-action="zoom-artiste-photo" data-pid="${esc(p.id)}">
            <img src="${esc(p.thumbUrl || p.url)}" alt="" loading="lazy" decoding="async">
            <div class="art-ext-caption">${esc(p.caption || p.commentaire || '')}</div>
          </div>`).join('')}
      </div>
    </section>`;
}

// 11. Notes & journal — les entrées et le composeur sont des coquilles vides
// ici (texte() a besoin d'éléments DOM réels pour se brancher) : voir
// brancherJournal(), appelé juste après l'insertion de ce HTML.
export function rendreJournal() {
  const composer = canWrite() ? `
    <div class="art-composer" id="art-composer">
      <div id="art-composer-texte"></div>
      <button class="art-composer-photo" type="button" title="Joindre une photo" data-action="attach-photo">📷</button>
    </div>` : '';

  const pendingThumbs = A.pendingPhotos.map(pid => {
    const p = A.images.find(i => i.id === pid);
    return p ? `<div class="art-pending-thumb"><img src="${esc(p.thumbUrl || p.url)}" alt=""></div>` : `<div class="art-pending-thumb art-pending-loading"></div>`;
  }).join('');

  const notesHtml = A.notes.length
    ? A.notes.map((n, i) => `<div class="art-note-slot" data-note-idx="${i}"></div>`).join('')
    : '<div class="art-empty-note">Aucune note pour l\'instant.</div>';

  return `
    <section class="art-journal" aria-label="Notes et journal">
      <div class="art-section-head"><span>Notes &amp; journal</span><span class="art-section-meta">jamais réécrit par l'IA</span></div>
      <div class="art-notes">${notesHtml}</div>
      ${composer}
      ${pendingThumbs ? `<div class="art-pending-photos">${pendingThumbs}</div>` : ''}
    </section>`;
}
