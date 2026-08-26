// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/capture.js : capture d'objet (photos + n° + localisation),
// réception « Partager avec » (share target PWA, D-013) et mode batch.
// HO-013 : guidage photo, crop local, commentaire par photo + commentaire objet.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast } from '../core/dom.js';
import { S, canWrite } from '../core/state.js';
import { plur } from '../core/format.js';
import { sb, logEvent, queueAnalyse, uploadPhotosFor } from '../core/data.js';
import { openCamera } from '../core/camera.js';
import { loadViewCss } from '../core/css.js';
import { createOverlay } from '../core/lightbox.js';
import { micButton } from './mic.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('capture');

export function mount() {
  initCapCommentaireMic();
  initCapture();
  if (consumeShareFlag()) receiveSharedPhotos();
}

// ─── Dictée micro dans le commentaire objet (HO-020) ─────────────────────────
// Le bouton est injecté dynamiquement pour ne pas toucher à index.html (transverse gelé).
function initCapCommentaireMic() {
  const ta = $('#cap-commentaire');
  if (!ta || ta.dataset.micReady) return;
  const btn = micButton(ta);
  if (!btn) return;
  ta.dataset.micReady = '1';
  const wrap = document.createElement('div');
  wrap.className = 'mic-wrap';
  ta.replaceWith(wrap);
  wrap.append(ta, btn);
}

// ─── Web Share Target (D-013) : photos reçues via « Partager avec » Android ─
// Le SW (sw.js) stocke les images du POST share-target dans le cache
// 'share-inbox' et redirige vers ./?partage=1#/capture — ici on reconstruit
// des File et on alimente la capture en cours. iOS Safari ne supporte pas
// l'API (limite admise) : le flag n'apparaît alors jamais.
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
      files.push(new File([blob],
        res.headers.get('x-name') || 'partage.jpg',
        { type: res.headers.get('x-type') || blob.type || 'image/jpeg' }));
    }
    await caches.delete('share-inbox'); // inbox consommée : on vide pour le prochain partage
    if (files.length) {
      addCapFiles(files);
      toast(`${plur(files.length, 'photo reçue', 'photos reçues')} par partage`);
    }
  } catch (err) {
    console.warn('share-inbox :', err);
  }
}

async function initCapture() {
  // NE PAS vider capFiles ici (audit 2026-08-24) : naviguer Capturer → Collection →
  // Capturer ne doit pas perdre les clichés non enregistrés. capFiles n'est vidé
  // qu'après un enregistrement réussi (cap-save).
  renderPreviews();
  $('#cap-num').value = '…';
  const [{ data: next }, { data: lieux }] = await Promise.all([
    sb.rpc('peek_objet_id', { p_owner: S.tenantId }),
    sb.from('objets').select('zone,contenant').eq('owner_id', S.tenantId),
  ]);
  $('#cap-num').value = next ?? '';
  const zones = [...new Set((lieux ?? []).map(r => r.zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const conts = [...new Set((lieux ?? []).map(r => r.contenant).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  $('#zones').innerHTML = zones.map(z => `<option>${esc(z)}</option>`).join('');
  $('#contenants').innerHTML = conts.map(z => `<option>${esc(z)}</option>`).join('');
}

// capFiles : [{ file, comment }] — HO-013
function addCapFiles(fileList) {
  for (const f of fileList) {
    S.capFiles.push(f instanceof File ? { file: f, comment: '' } : { file: f?.file ?? f, comment: f?.comment ?? '' });
  }
  renderPreviews();
}

// Les clichés attendent dans capFiles tant que « Enregistrer l'objet » n'est pas cliqué :
// on prévient avant tout rechargement/fermeture qui les perdrait silencieusement.
window.addEventListener('beforeunload', e => {
  if (S.capFiles.length) { e.preventDefault(); e.returnValue = ''; }
});

let pvUrls = [];
function renderPreviews() {
  const box = $('#previews');
  pvUrls.forEach(u => URL.revokeObjectURL(u));
  pvUrls = [];
  box.innerHTML = '';
  S.capFiles.forEach((item, i) => {
    const f = item.file;
    const d = document.createElement('div');
    d.className = 'pv';
    if (/^image\//.test(f.type)) {
      const wrap = document.createElement('div');
      wrap.className = 'imgwrap';
      const img = document.createElement('img');
      const u = URL.createObjectURL(f);
      pvUrls.push(u);
      img.src = u;
      wrap.append(img);
      const cut = document.createElement('button');
      cut.className = 'cut-btn';
      cut.textContent = '✂️';
      cut.title = 'Recadrer';
      cut.addEventListener('click', (e) => { e.stopPropagation(); openLocalCrop(f, i); });
      wrap.append(cut);
      d.append(wrap);
    } else {
      d.style.display = 'grid';
      d.style.placeItems = 'center';
      d.style.fontSize = '26px';
      d.textContent = '🎬';
    }
    const imgWrap = d.querySelector('.imgwrap') || d;
    const x = document.createElement('button');
    x.className = 'del-btn';
    x.textContent = '✕';
    x.title = 'Retirer';
    x.addEventListener('click', () => { S.capFiles.splice(i, 1); renderPreviews(); });
    imgWrap.append(x);
    const note = document.createElement('textarea');
    note.className = 'pv-note';
    note.rows = 2;
    note.placeholder = 'Note sur cette photo…';
    note.value = item.comment ?? '';
    note.addEventListener('input', () => { item.comment = note.value; });
    const mic = micButton(note);
    if (mic) {
      const wrap = document.createElement('div');
      wrap.className = 'mic-wrap';
      wrap.append(note, mic);
      d.append(wrap);
    } else {
      d.append(note);
    }
    box.append(d);
  });
}

// ─── Recadrage local avant envoi (HO-013) ────────────────────────────────────
// Sur le fichier local, cadre à poignées (bords/coins), canvas aux pixels natifs,
// JPEG 0.92 — le cliché rogné remplace l'entrée dans S.capFiles.
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
      if (S.capFiles[index]) S.capFiles[index].file = cropped;
      close();
      toast('✓ Photo recadrée');
      renderPreviews();
    } catch (err) {
      toast(`Recadrage échoué : ${err.message ?? err}`, true);
      ok.disabled = false; ok.textContent = '✂️ Recadrer';
    }
  });
}

const dz = $('#dropzone');
dz.addEventListener('click', () => $('#file-gallery').click());
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('over');
  addCapFiles(e.dataTransfer.files);
});

$('#btn-camera').addEventListener('click', () => openCamera('capture', { addFiles: addCapFiles }));
$('#btn-gallery').addEventListener('click', () => $('#file-gallery').click());
$('#file-camera').addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });
$('#file-gallery').addEventListener('change', e => { addCapFiles(e.target.files); e.target.value = ''; });

$$('input[name="cap-mode"]').forEach(r => r.addEventListener('change', () => {
  $('#cap-save').textContent = r.value === 'batch' ? 'Enregistrer les objets' : 'Enregistrer l\'objet';
}));

let pendingObjetId = null;

function capSaveLabel(mode) {
  if (mode === 'single' && pendingObjetId && S.capFiles.length) {
    return `Renvoyer les ${S.capFiles.length} photo(s)`;
  }
  return mode === 'batch' ? 'Enregistrer les objets' : 'Enregistrer l\'objet';
}

$('#cap-save').addEventListener('click', async () => {
  if (!canWrite()) return;
  const mode = $('input[name="cap-mode"]:checked')?.value || 'single';
  const btn = $('#cap-save');
  const zone = $('#cap-zone').value.trim() || null;
  const contenant = $('#cap-contenant').value.trim() || null;
  const commentaire = $('#cap-commentaire').value.trim() || null;
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  try {
    // Retry sur l'objet déjà créé (single uniquement)
    if (mode === 'single' && pendingObjetId && S.capFiles.length) {
      const total = S.capFiles.length;
      const onProgress = (sent, tot) => { btn.textContent = `Envoi photo ${sent + 1}/${tot}…`; };
      const { done, failed } = await uploadPhotosFor(pendingObjetId, S.capFiles, true, onProgress);
      S.capFiles = failed.map(({ item }) => item);
      renderPreviews();
      if (done > 0) await queueAnalyse(pendingObjetId);
      if (!S.capFiles.length) {
        const rid = pendingObjetId;
        pendingObjetId = null;
        toast('Photos envoyées — analyse en file');
        S.refreshHeader?.();
        location.hash = '#/objet/' + encodeURIComponent(rid);
      } else {
        toast(`Objet #${pendingObjetId} enregistré — ${done}/${total} photos envoyées. ${failed.length} en échec : renvoyez-les depuis cet écran.`, true);
      }
      return;
    }
    if (mode === 'batch') {
      if (!S.capFiles.length) { toast('Aucune photo à enregistrer', true); return; }
      let ok = 0, fails = 0, sansPhoto = 0;
      const ids = [];
      const files = [...S.capFiles];
      for (const item of files) {
        const { data: newId, error: e0 } = await sb.rpc('next_objet_id', { p_owner: S.tenantId });
        if (e0 || !newId) { fails++; continue; }
        const { error: e1 } = await sb.from('objets').insert({
          owner_id: S.tenantId, id: newId, statut: 'en_file', zone, contenant, commentaire, source_capture: 'site',
        });
        if (e1) { fails++; continue; }
        logEvent('capture', { n: 1, zone }, newId);
        const { done } = await uploadPhotosFor(newId, [item], true);
        if (done > 0) {
          await queueAnalyse(newId);
        } else {
          sansPhoto++;
          await sb.from('objets').update({ statut: 'a_completer' }).eq('owner_id', S.tenantId).eq('id', newId);
        }
        ids.push(newId); ok++;
      }
      S.capFiles = [];
      renderPreviews();
      toast(`${ok} objet${ok > 1 ? 's' : ''} créé${ok > 1 ? 's' : ''}${sansPhoto ? ` (${sansPhoto} sans leur photo — rouvrez leur fiche pour la rajouter)` : ''}${fails ? ` (${fails} échec)` : ''}`);
      S.refreshHeader?.();
      if (ids.length) location.hash = '#/objet/' + encodeURIComponent(ids[0]);
      return;
    }
    const { data: newId, error: e0 } = await sb.rpc('next_objet_id', { p_owner: S.tenantId });
    if (e0 || !newId) throw (e0 ?? new Error('numérotation impossible'));
    const avecPhotos = S.capFiles.length > 0;
    const { error: e1 } = await sb.from('objets').insert({
      owner_id: S.tenantId,
      id: newId,
      statut: avecPhotos ? 'en_file' : 'a_completer',
      zone,
      contenant,
      commentaire,
      source_capture: 'site',
    });
    if (e1) throw e1;
    logEvent('capture', { n: S.capFiles.length, zone }, newId);
    if (avecPhotos) {
      const total = S.capFiles.length;
      const onProgress = (sent, tot) => { btn.textContent = `Envoi photo ${sent + 1}/${tot}…`; };
      const { done, failed } = await uploadPhotosFor(newId, S.capFiles, true, onProgress);
      if (failed.length > 0) {
        pendingObjetId = newId;
        S.capFiles = failed.map(({ item }) => item);
        renderPreviews();
        if (done > 0) {
          await queueAnalyse(newId);
        } else {
          await sb.from('objets').update({ statut: 'a_completer' }).eq('owner_id', S.tenantId).eq('id', newId);
        }
        toast(`Objet #${newId} enregistré — ${done}/${total} photos envoyées. ${failed.length} en échec : renvoyez-les depuis cet écran.`, true);
        return;
      }
      if (done > 0) {
        await queueAnalyse(newId);
      } else {
        await sb.from('objets').update({ statut: 'a_completer' }).eq('owner_id', S.tenantId).eq('id', newId);
      }
    }
    S.capFiles = [];
    renderPreviews();
    toast(`Objet #${newId} enregistré${avecPhotos ? ' — analyse en file' : ''}`);
    S.refreshHeader?.();
    location.hash = '#/objet/' + encodeURIComponent(newId);
  } catch (err) {
    toast(err.message ?? String(err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = capSaveLabel(mode);
  }
});
