// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/lightbox.js : superposition plein écran, brique TRANSVERSE.
//
// Deux implémentations coexistaient (fiche objet et fiche artiste) avec la même
// mécanique overlay/fermeture et des comportements légèrement différents —
// factorisées ici (audit 2026-08-25). Styles partagés : styles/components.css
// (.lightbox, .lightbox.zoomed, body.lb-open) ; les surcouches spécifiques
// (recadrage, centrage) restent dans styles/views/objet.css.
//
//   createOverlay({...})  → overlay nu + close() : socle des modes spéciaux
//                           de la fiche objet (centrage focal, recadrage).
//   openViewer({...})     → visionneuse simple image/vidéo, zoom au clic.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from './dom.js';

/**
 * Overlay plein écran monté sur <body>, fermable par Échap.
 * @param {{ className?: string, html?: string, onClose?: () => void }} opts
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function createOverlay({ className = '', html = '', onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'lightbox' + (className ? ` ${className}` : '');
  el.innerHTML = html + `<button class="lb-close" aria-label="Fermer" title="Fermer">✕</button>`;

  let ferme = false;
  const close = () => {
    if (ferme) return; // Échap + clic peuvent tomber ensemble
    ferme = true;
    document.removeEventListener('keydown', onKey);
    el.remove();
    document.body.classList.remove('lb-open');
    onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };

  el.querySelector('.lb-close').addEventListener('click', e => { e.stopPropagation(); close(); });

  document.addEventListener('keydown', onKey);
  document.body.classList.add('lb-open');
  document.body.append(el);
  return { el, close };
}

/**
 * Visionneuse simple : image (zoom au clic) ou vidéo (contrôles natifs).
 * Clic hors du média = fermeture.
 * @param {{ src: string, alt?: string, video?: boolean, zoomable?: boolean, className?: string, hintHtml?: string }} opts
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function openViewer({ src, alt = '', video = false, zoomable = true, className = '', hintHtml = '' }) {
  const media = video
    ? `<video src="${esc(src)}" controls autoplay></video>`
    : `<img src="${esc(src)}" alt="${esc(alt)}" loading="eager">`;
  const vue = createOverlay({ className, html: media + hintHtml });

  vue.el.addEventListener('click', e => {
    const img = e.target.closest('img');
    // Sur l'image : zoom/dézoom. Ailleurs (ou sur une vidéo) : fermeture.
    if (img && zoomable && !video) { e.stopPropagation(); vue.el.classList.toggle('zoomed'); return; }
    if (video && e.target.closest('video')) return; // ne pas fermer en manipulant les contrôles
    vue.close();
  });
  return vue;
}
