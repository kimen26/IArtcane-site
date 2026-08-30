// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/images.js : écran Images de la fiche artiste (3b).
// Assemblage seul depuis HO-106 : galerie()/vignettes() (ui/) portent le
// rendu commun, services/photos.js (HO-105) porte les gestes. Zone/objet
// source/tags libres/transcription restent propres à l'artiste (hors
// contrat de la brique) et sont rendus à part, sous la galerie.
//
// Modifier remplace désormais ✂ recadrer + 🗑 supprimer + ↻ 90° pivoter
// (D-073/HO-095, unification demandée par le brief HO-106) : `sur.modifier`
// ouvre `openCutter`, gardé tel quel faute d'équivalent routé côté artiste
// (contrairement à l'objet). Conséquence assumée : la rotation instantanée
// (pivoterImage) n'a plus de bouton et disparaît — signalé au rapport.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import { loadViewCss } from '../../core/css.js';
import { sb, logEvent } from '../../core/data.js';
import { toast, enregistrer, withBusy } from '../../core/feedback.js';
import { createOverlay } from '../../core/lightbox.js';
import { page } from '../../ui/page.js';
import { galerie } from '../../ui/galerie.js';
import { micButton } from '../mic.js';
import { A, hooks } from './etat.js';
import { insererArtistePhoto } from './uploads.js';
import { supprimer, taguer, remplacer, reordonner, cibleArtiste } from '../../services/photos.js';

await loadViewCss('artistes');

const ZONES = [
  { key: 'portrait', label: 'Portrait de l\'artiste' },
  { key: 'signature', label: 'Signatures relevées' },
  { key: 'externe', label: 'Galerie externe' },
  { key: 'vrac', label: 'En vrac' },
];
const ZONE_LABELS = { portrait: 'portrait', signature: 'signature', externe: 'galerie externe', vrac: 'en vrac' };
const TAG_SUGGESTIONS = ['sous la base', 'peinte', 'en creux', 'au revers', 'étiquette'];

let currentIndex = 0;
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
      <div class="art-images-galerie" data-role="galerie"></div>
      ${sel ? rendreExtra(sel) : ''}
      ${sansZone ? `<div class="art-images-status">${sansZone} image${sansZone > 1 ? 's' : ''} attendent leur zone d'apparition</div>` : ''}
    </div>`;

  galerie(corps.querySelector('[data-role="galerie"]'), {
    images: images.map(mapImage), courante: currentIndex, mode: 'edition',
    tags: ZONES, libelle: 'Image', peutAjouter: false, peutReordonner: true,
    actions: ['modifier', 'supprimer'],
    sur: { choisir: onChoisir, reordonner: onReordonner, taguer: onZone, modifier: onModifier, supprimer: onSupprimer, commenter: onCommenter },
  });

  brancherExtra(corps);
}

function onAjouter() { if (canWrite()) fileInput.click(); }
function onEnregistrer() { toast('✓ Images enregistrées'); hooks.naviguer('fiche'); }

function imagesTriees() {
  return A.images.slice().sort((a, b) => {
    const d = (a.ordre ?? 0) - (b.ordre ?? 0);
    return d !== 0 ? d : new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
}
function imageCourante() { return imagesTriees()[currentIndex]; }

function mapImage(p) {
  const modifie = p.updated_at && p.created_at !== p.updated_at;
  return {
    id: p.id, url: p.url, thumbUrl: p.thumbUrl, tag: p.zone ? (ZONE_LABELS[p.zone] || p.zone) : null,
    commentaire: p.commentaire, video: false, rotation: p.rotation || 0,
    etat: modifie ? 'modifiée' : (p.created_at ? `importée le ${fmtShortDate(p.created_at)}` : ''),
  };
}

// ─── Zone / objet source / tags libres / transcription (propre à l'artiste) ─

function rendreExtra(p) {
  return `
    <div class="art-images-extra">
      ${p.zone === 'signature' ? rendreSelectObjet(p.objet_id) : ''}
      <div class="art-images-tags">
        <div class="art-images-label">Tags libres</div>
        <div class="art-images-tags-list" role="listbox" aria-label="Tags libres de l'image">${rendreTagsLibres(p)}</div>
      </div>
      ${p.zone === 'signature' ? rendreTranscription(p) : ''}
    </div>`;
}

function rendreSelectObjet(objetId) {
  const options = (A.objets || []).map(o =>
    `<option value="${esc(o.id)}" ${String(o.id) === String(objetId || '') ? 'selected' : ''}>#${esc(o.id)} — ${esc(o.titre || 'objet')}</option>`
  ).join('');
  return `
    <div class="art-images-objsrc">
      <div class="art-images-label">Objet source de la signature</div>
      <select class="art-images-objet-select" data-action="objet-source" aria-label="Objet source de la signature">
        <option value="" ${!objetId ? 'selected' : ''}>aucun</option>${options}
      </select>
    </div>`;
}

function rendreTagsLibres(p) {
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const all = [...new Set([...TAG_SUGGESTIONS, ...tags])];
  const chips = all.map(t => {
    const active = tags.includes(t);
    return `<button type="button" class="art-images-tag ${active ? 'active' : ''}" data-action="tag" data-tag="${esc(t)}" role="option" aria-selected="${active}">${esc(t)}</button>`;
  }).join('');
  const add = tagInputVisible
    ? '<input type="text" class="art-images-tag-input" data-action="tag-input" placeholder="tag…" maxlength="30">'
    : '<button type="button" class="art-images-tag art-images-tag-add" data-action="add-tag">+ tag</button>';
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

function brancherExtra(el) {
  el.querySelector('[data-action="objet-source"]')?.addEventListener('change', e => changerObjetSource(e.target.value || null));

  el.querySelectorAll('[data-action="tag"]').forEach(btn => btn.addEventListener('click', () => basculerTag(btn.dataset.tag)));
  el.querySelector('[data-action="add-tag"]')?.addEventListener('click', () => { tagInputVisible = true; hooks.rendre(); });
  const tagInput = el.querySelector('[data-action="tag-input"]');
  if (tagInput) {
    tagInput.focus();
    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const v = tagInput.value.trim(); if (v) ajouterTag(v); tagInputVisible = false; }
      else if (e.key === 'Escape') { tagInputVisible = false; hooks.rendre(); }
    });
    tagInput.addEventListener('blur', () => { const v = tagInput.value.trim(); if (v) ajouterTag(v); tagInputVisible = false; hooks.rendre(); });
  }

  const tt = el.querySelector('[data-action="transcription"]');
  if (tt) { const mic = micButton(tt); if (mic) tt.parentElement.append(mic); tt.addEventListener('change', () => sauverTranscription(tt.value)); }

  const ta = el.querySelector('.ui-galerie-comment-area');
  if (ta) { const mic = micButton(ta); if (mic) ta.parentElement.append(mic); }
}

// ─── Actions de la galerie ──────────────────────────────────────────────────

function onChoisir(i) { currentIndex = i; hooks.rendre(); }

function onModifier() {
  const p = imageCourante();
  if (!p) return;
  if (p.rotation && p.rotation !== 0) { toast('Remets l\'image droite (0°) avant de recadrer', true); return; }
  openCutter(p);
}

async function onSupprimer() {
  const p = imageCourante();
  if (!p) return;
  if (!confirm('Supprimer cette image ? (fichier + référence, définitif)')) return;
  if (!await supprimer(cibleArtiste(A.nom), p)) return;
  logEvent('artiste_image_supprimee', { image: p.storage_path });
  toast('Image supprimée');
  currentIndex = 0;
  await hooks.recharger(A.nom);
}

async function onZone(zone) {
  const p = imageCourante();
  if (!p || p.zone === zone) return;
  if (!await taguer(cibleArtiste(A.nom), p, zone)) { toast("Zone de l'image non enregistrée", true); return; }
  p.zone = zone;
  if (zone !== 'signature') p.objet_id = null;
  logEvent('artiste_image_zone', { zone, objet_id: p.objet_id });
  hooks.rendre();
}

async function changerObjetSource(objetId) {
  const p = imageCourante();
  if (!p || p.zone !== 'signature' || p.objet_id === objetId) return;
  if (!await enregistrer(() => sb.from('artistes_photos').update({ objet_id: objetId }).eq('owner_id', S.tenantId).eq('id', p.id), 'Objet source')) return;
  p.objet_id = objetId;
  logEvent('artiste_image_zone', { zone: p.zone, objet_id: objetId });
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
  if (tags.includes(normalise)) { hooks.rendre(); return; }
  tags.push(normalise);
  if (!await enregistrer(() => sb.from('artistes_photos').update({ tags }).eq('owner_id', S.tenantId).eq('id', p.id), 'Tag ajouté')) return;
  p.tags = tags;
  logEvent('artiste_image_tag', { tag: normalise });
  hooks.rendre();
}

async function onCommenter(texte) {
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

async function onReordonner(ordre) {
  const images = imagesTriees();
  const movedId = images[currentIndex]?.id;
  const { updates, echecs, ok } = await reordonner(cibleArtiste(A.nom), images, ordre);
  logEvent('artiste_images_ordre', { n: updates.length, echecs: echecs.length });
  if (!ok) {
    console.warn('onReordonner:', echecs);
    toast(`Ordre des images non enregistré — ${echecs.length}/${updates.length} échec${echecs.length > 1 ? 's' : ''} : ${echecs[0].message}`, true,
      { action: { label: 'Réessayer', onClick: () => onReordonner(ordre) } });
    if (echecs.length === updates.length) return; // rien écrit en mémoire, sinon le rendu suivant "confirme" un ordre que la base n'a pas
  } else {
    toast('✓ Ordre des images enregistré');
  }
  A.images.forEach(p => { const u = updates.find(u => u.id === p.id); if (u) p.ordre = u.ordre; });
  const nouvelIdx = imagesTriees().findIndex(p => p.id === movedId);
  if (nouvelIdx >= 0) currentIndex = nouvelIdx;
  hooks.rendre();
}

// ─── Recadrage (overlay, gardé faute d'équivalent routé — cf. tête de fichier) ─

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

function fmtShortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
