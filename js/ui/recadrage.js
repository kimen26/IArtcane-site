// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/recadrage.js : atelier de recadrage, brique pure (HO-115,
// docs/architecture-briques.md §2). Remplace openCutter (artiste/images.js)
// et openLocalCrop (capture/index.js) — même overlay, mêmes 8 poignées,
// même toRel/draw/gestes pointeur, même découpe canvas à 0.92 ; seules
// diffèrent la source (URL signée vs File) et la suite du blob, qui restent
// dans la vue. La brique n'ouvre PAS l'overlay (core/lightbox.js lui est
// interdit, règle de dépendance §2) : elle rend dans l'`el` d'un
// createOverlay déjà ouvert par l'appelant.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../core/dom.js';
import { loadViewCss } from '../core/css.js';

await loadViewCss('recadrage', 'ui');

/**
 * Atelier de sélection d'une zone à garder, dans un conteneur fourni par la
 * vue (typiquement l'`el` d'un createOverlay). Pure : props → HTML + gestes,
 * la suite remonte par `sur.valider`.
 * @param {HTMLElement} el
 * @param {object} opts
 *   src      {string}   URL (signée ou objectURL) de l'image à recadrer
 *   alt      {string=}
 *   sur      {{ valider:(sel:{x0,y0,x1,y1})=>Promise<void>, annuler:()=>void }}
 *            `valider` reçoit la sélection RELATIVE (0..1) ; la brique
 *            désactive le bouton et affiche « Recadrage… » pendant l'attente,
 *            puis le restaure (finally) — la vue gère ses erreurs elle-même
 *            (toast) et ne relance pas
 */
export function recadrage(el, opts = {}) {
  const { src = '', alt = '', sur = {} } = opts;
  el.classList.add('ui-recadrage');
  el.insertAdjacentHTML('afterbegin', `
    <img class="ui-recadrage-img" src="${esc(src)}" alt="${esc(alt)}" draggable="false">
    <div class="ui-recadrage-bar">
      <span class="ui-recadrage-hint">Tire les poignées (bords et coins) pour délimiter la zone à garder</span>
      <button type="button" class="btn primary small" data-role="valider" disabled>✂️ Recadrer</button>
      <button type="button" class="btn small" data-role="annuler">Annuler</button>
    </div>`);

  const img = el.querySelector('.ui-recadrage-img');
  const ok = el.querySelector('[data-role="valider"]');
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
      box.className = 'ui-recadrage-sel';
      box.innerHTML = Object.keys(H).map(h => `<i data-h="${h}" class="ui-recadrage-h ui-recadrage-h--${h}"></i>`).join('');
      el.append(box);
    }
    const r = img.getBoundingClientRect();
    box.style.left = `${r.left + sel.x0 * r.width}px`;
    box.style.top = `${r.top + sel.y0 * r.height}px`;
    box.style.width = `${(sel.x1 - sel.x0) * r.width}px`;
    box.style.height = `${(sel.y1 - sel.y0) * r.height}px`;
  };
  if (img.complete && img.naturalWidth) draw(); else img.addEventListener('load', draw, { once: true });
  el.addEventListener('pointerdown', e => {
    const h = e.target.dataset?.h;
    if (!h) return;
    e.preventDefault(); e.stopPropagation();
    drag = h;
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    sel = H[drag](sel, toRel(e));
    draw();
    ok.disabled = false;
  });
  el.addEventListener('pointerup', () => { drag = null; });
  el.querySelector('[data-role="annuler"]').addEventListener('click', e => { e.stopPropagation(); sur.annuler?.(); });
  ok.addEventListener('click', async e => {
    e.stopPropagation();
    ok.disabled = true; ok.textContent = 'Recadrage…';
    try {
      await sur.valider?.(sel);
    } finally {
      ok.disabled = false; ok.textContent = '✂️ Recadrer';
    }
  });
}

/**
 * Découpe canvas : source → Blob JPEG de la zone `sel`.
 * @param {Blob|File|ImageBitmapSource} source
 * @param {{x0,y0,x1,y1}} sel  relative (0..1)
 * @param {{ qualite?:number, minPx?:number }} [o]  défauts 0.92 et 20
 * @returns {Promise<Blob>}  rejette Error('zone trop petite') / Error('encodage impossible')
 */
export async function decouper(source, sel, o = {}) {
  const { qualite = 0.92, minPx = 20 } = o;
  const bmp = await createImageBitmap(source);
  const sx = Math.round(sel.x0 * bmp.width);
  const sy = Math.round(sel.y0 * bmp.height);
  const sw = Math.round((sel.x1 - sel.x0) * bmp.width);
  const sh = Math.round((sel.y1 - sel.y0) * bmp.height);
  if (sw < minPx || sh < minPx) throw new Error('zone trop petite');
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const out = await new Promise(res => c.toBlob(res, 'image/jpeg', qualite));
  if (!out) throw new Error('encodage impossible');
  return out;
}
