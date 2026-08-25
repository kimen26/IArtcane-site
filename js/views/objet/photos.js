// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/photos.js : galerie de la fiche produit —
// suppression, caméra, et lightbox à 3 modes (agrandissement, centrage focal,
// recadrage réel aux pixels natifs).
// Territoire dédié : un chantier « photos de la fiche » ne touche que ce
// fichier (+ styles/views/objet.css). Ne rend PAS la fiche : il demande le
// rendu/rechargement via `hooks` de ./etat.js — aucune dépendance circulaire.
// ═══════════════════════════════════════════════════════════════════════════
import { esc, toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { isVideo } from '../../core/format.js';
import { sb, logEvent, queueAnalyse, makeThumbBlob, deleteStoredPhoto } from '../../core/data.js';
import { createOverlay, openViewer } from '../../core/lightbox.js';
import { selPhoto, hooks } from './etat.js';

// Suppression d'une photo (fichier storage + ligne) — policy storage delete : migration 0007.
export async function deletePhoto() {
  const sel = selPhoto();
  if (!sel || !S.currentObjet) return;
  if (!confirm('Supprimer cette photo ? (fichier + référence, définitif)')) return;
  if (!await deleteStoredPhoto('photos', sel.id, [sel.storage_path, sel.thumb_path])) return;
  logEvent('photo_supprimee', { photo: sel.storage_path });
  toast('Photo supprimée');
  await hooks.recharger(S.currentObjet.id);
}

// Caméra depuis la fiche : les clichés ont été uploadés au fil de l'eau →
// on relance l'analyse si besoin (même règle que l'ajout par fichier) et on
// recharge la fiche à la fermeture (hook passé au module caméra partagé).
export function onCamClose(n) {
  const o = S.currentObjet;
  if (!o || !n) return;
  if (['capture', 'a_completer'].includes(o.statut)) queueAnalyse(o.id);
  hooks.recharger(o.id);
}

// ─── Lightbox ───────────────────────────────────────────────────────────────
// Lightbox plein écran, 3 modes (règle Yann 2026-08-24 : par défaut l'image
// prend la place dispo, PAS PLUS — pas d'ascenseurs ; clic image = zoom 100 %).
//  - null   : agrandissement ajusté à l'écran (clic image = zoom, clic à côté = fermer)
//  - 'focal': le clic sur l'image définit le point focal de CETTE photo (la boîte
//             de l'<img> EST l'image entière → calcul exact, pas de letterbox)
//  - 'cut'  : recadrage RÉEL — cadre à poignées (bords/coins, comme Paint) :
//             rognage aux pixels natifs, la source est remplacée
export function openLightbox(photo, mode = null) {
  const titre = S.currentObjet?.titre || 'objet';
  // Mode simple : la visionneuse commune (core/lightbox.js) suffit — zoom au
  // clic, fermeture au clic à côté ou par Échap.
  if (!mode) {
    openViewer({ src: photo.url, alt: `Photo plein écran — ${titre}`, video: isVideo(photo) });
    return;
  }
  // Modes spécifiques à la fiche : overlay commun + surcouche locale.
  const { el: lb, close } = createOverlay({
    className: mode,
    html: mode === 'cut'
      ? `<img src="${esc(photo.url)}" alt="Photo à recadrer — ${esc(titre)}">
      <div class="cut-bar"><span class="cut-hint">Tire les poignées (bords et coins) pour délimiter la zone à garder</span>
      <button class="btn primary small" data-ok disabled>✂️ Recadrer</button>
      <button class="btn small" data-cancel>Annuler</button></div>`
      : `<img src="${esc(photo.url)}" alt="Photo plein écran — ${esc(titre)}">
      <div class="crop-hint">Cliquer au centre de l’objet — centrage de <b>cette photo</b> uniquement · clic à côté = annuler</div>`,
  });

  if (mode === 'cut') {
    const img = lb.querySelector('img');
    const ok = lb.querySelector('[data-ok]');
    let sel = { x0: 0, y0: 0, x1: 1, y1: 1 }; // cadre initial = image entière
    let box = null;
    let drag = null;
    const MIN = 0.05; // zone minimale 5 %
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
        const blob = await (await fetch(photo.url)).blob();
        const bmp = await createImageBitmap(blob);
        const sx = Math.round(sel.x0 * bmp.width);
        const sy = Math.round(sel.y0 * bmp.height);
        const sw = Math.round((sel.x1 - sel.x0) * bmp.width);
        const sh = Math.round((sel.y1 - sel.y0) * bmp.height);
        if (sw < 20 || sh < 20) throw new Error('zone trop petite');
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;                       // pixels natifs : pas de perte
        c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
        const out = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
        if (!out) throw new Error('encodage impossible');
        const newPath = photo.storage_path.replace(/[^/]+$/, `${crypto.randomUUID()}.jpg`);
        const { error: e1 } = await sb.storage.from('photos').upload(newPath, out, { contentType: 'image/jpeg' });
        if (e1) throw e1;
        // miniature régénérée depuis la version rognée + centrage remis à zéro
        const tb = await makeThumbBlob(out);
        let thumbPath = null;
        if (tb) {
          thumbPath = newPath.replace(/\.jpg$/, '.thumb.jpg');
          const { error: et } = await sb.storage.from('photos').upload(thumbPath, tb, { contentType: 'image/jpeg' });
          if (et) thumbPath = null;
        }
        const { error: e2 } = await sb.from('photos')
          .update({ storage_path: newPath, thumb_path: thumbPath, focal_x: null, focal_y: null })
          .eq('owner_id', S.tenantId).eq('id', photo.id);
        if (e2) throw e2;
        await sb.storage.from('photos').remove([photo.storage_path, photo.thumb_path].filter(Boolean));
        close();
        toast('✓ Photo recadrée — résolution d’origine conservée');
        logEvent('recadrage', { photo: newPath });
        await hooks.recharger(S.currentObjet.id);
      } catch (err) {
        toast(`Recadrage échoué : ${err.message ?? err}`, true);
        ok.disabled = false; ok.textContent = '✂️ Recadrer';
      }
    });
  } else {
    // mode 'focal' : le clic sur l'image fixe le point de centrage de CETTE photo
    lb.addEventListener('click', async e => {
      const img = e.target.closest('img');
      if (!img) { close(); return; }
      e.stopPropagation();
      const r = img.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { close(); return; }
      const fx = Math.round((e.clientX - r.left) / r.width * 100);
      const fy = Math.round((e.clientY - r.top) / r.height * 100);
      const { error } = await sb.from('photos').update({ focal_x: fx, focal_y: fy }).eq('owner_id', S.tenantId).eq('id', photo.id);
      if (error) { toast(error.message, true); close(); return; }
      photo.focal_x = fx; photo.focal_y = fy;
      close();
      hooks.rendre();
      toast('✓ Centrage enregistré pour cette photo — la carte de la collection le suivra');
      logEvent('centrage', { photo: photo.storage_path, fx, fy });
    });
  }
}
