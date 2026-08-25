// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/capture.js : capture d'objet (photos + n° + localisation),
// réception « Partager avec » (share target PWA, D-013) et mode batch.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast } from '../core/dom.js';
import { S, canWrite } from '../core/state.js';
import { plur } from '../core/format.js';
import { sb, logEvent, queueAnalyse, uploadPhotosFor } from '../core/data.js';
import { openCamera } from '../core/camera.js';
import { loadViewCss } from '../core/css.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('capture');

export function mount() {
  initCapture();
  if (consumeShareFlag()) receiveSharedPhotos();
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

function addCapFiles(fileList) {
  for (const f of fileList) S.capFiles.push(f);
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
  S.capFiles.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'pv';
    if (/^image\//.test(f.type)) {
      const img = document.createElement('img');
      const u = URL.createObjectURL(f);
      pvUrls.push(u);
      img.src = u;
      d.append(img);
    } else {
      d.style.display = 'grid';
      d.style.placeItems = 'center';
      d.style.fontSize = '26px';
      d.textContent = '🎬';
    }
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = 'Retirer';
    x.addEventListener('click', () => { S.capFiles.splice(i, 1); renderPreviews(); });
    d.append(x);
    box.append(d);
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

$('#cap-save').addEventListener('click', async () => {
  if (!canWrite()) return;
  const mode = $('input[name="cap-mode"]:checked')?.value || 'single';
  const btn = $('#cap-save');
  const zone = $('#cap-zone').value.trim() || null;
  const contenant = $('#cap-contenant').value.trim() || null;
  btn.disabled = true;
  btn.textContent = mode === 'batch' ? 'Enregistrement des objets…' : 'Enregistrement…';
  try {
    if (mode === 'batch') {
      if (!S.capFiles.length) { toast('Aucune photo à enregistrer', true); return; }
      let ok = 0, fails = 0;
      const ids = [];
      const files = [...S.capFiles];
      for (const f of files) {
        const { data: newId, error: e0 } = await sb.rpc('next_objet_id', { p_owner: S.tenantId });
        if (e0 || !newId) { fails++; continue; }
        const { error: e1 } = await sb.from('objets').insert({
          owner_id: S.tenantId, id: newId, statut: 'en_file', zone, contenant, source_capture: 'site',
        });
        if (e1) { fails++; continue; }
        logEvent('capture', { n: 1, zone }, newId);
        const n = await uploadPhotosFor(newId, [f], true);
        if (n > 0) {
          await queueAnalyse(newId);
        } else {
          await sb.from('objets').update({ statut: 'a_completer' }).eq('owner_id', S.tenantId).eq('id', newId);
        }
        ids.push(newId); ok++;
      }
      S.capFiles = [];
      renderPreviews();
      toast(`${ok} objet${ok > 1 ? 's' : ''} créé${ok > 1 ? 's' : ''}${fails ? ` (${fails} échec)` : ''}`);
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
      source_capture: 'site',
    });
    if (e1) throw e1;
    logEvent('capture', { n: S.capFiles.length, zone }, newId);
    if (avecPhotos) {
      const n = await uploadPhotosFor(newId, S.capFiles, true);
      if (n > 0) {
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
    btn.textContent = mode === 'batch' ? 'Enregistrer les objets' : 'Enregistrer l\'objet';
  }
});
