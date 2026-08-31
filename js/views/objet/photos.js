// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/photos.js : écran Photos de la fiche (HO-047).
// Assemblage seul depuis HO-106 : galerie()/vignettes() (ui/) portent le
// rendu, services/photos.js (HO-105) porte les gestes.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast } from '../../core/dom.js';
import { enregistrer } from '../../core/feedback.js';
import { S } from '../../core/state.js';
import { isVideo } from '../../core/format.js';
import { loadViewCss } from '../../core/css.js';
import { sb, logEvent } from '../../core/data.js';
import { openCamera } from '../../core/camera.js';
import { page } from '../../ui/page.js';
import { galerie } from '../../ui/galerie.js';
import { micButton } from '../../ui/mic.js';
import { O, hooks } from './etat.js';
import { supprimer, taguer, definirCouverture, reordonner, cibleObjet } from '../../services/photos.js';

await loadViewCss('objet-photos');

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

export function rendre(el) {
  const o = S.currentObjet;
  const photos = photosTriees();

  if (O.focus?.photoId) {
    const idx = photos.findIndex(p => String(p.id) === String(O.focus.photoId));
    if (idx >= 0) currentIndex = idx;
    O.focus = null;
  } else if (!photos[currentIndex]) {
    currentIndex = 0;
  }

  const nActions = photos.filter(p => p.kind == null).length;
  const vues = Array.isArray(o.vues_manquantes) ? o.vues_manquantes : [];
  const vuesAFaire = vues.filter(v => v.statut !== 'absente');
  const sel = photos[currentIndex];

  const corps = page(el, {
    titre: 'Photos',
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
      ${rendreTiroirVues(vues, vuesAFaire, vues.filter(v => v.statut === 'absente'))}
      <div class="obj-photos-galerie" data-role="galerie"></div>
      ${sel?.remarque_statut === 'en_attente' && sel?.remarque_ia ? rendreRemarque(sel) : ''}
      <div class="obj-photos-status">${nActions ? `${nActions} photo${nActions > 1 ? 's' : ''} demandent encore une action` : 'Toutes les photos sont en ordre'}</div>
    </div>`;

  galerie(corps.querySelector('[data-role="galerie"]'), {
    images: photos.map(mapImage), courante: currentIndex, mode: 'edition',
    tags: KINDS, libelle: 'Photo', peutAjouter: false, peutReordonner: true,
    actions: ['modifier', 'couverture', 'supprimer'],
    sur: {
      choisir: onChoisir, reordonner: onReordonner, taguer: onTaguer, modifier: onModifier,
      supprimer: onSupprimer, couverture: onCouverture, commenter: onCommenter,
    },
  });

  brancher(corps);
}

function mapImage(p) {
  const kindLabel = KINDS.find(k => k.key === p.kind)?.label || (p.kind === 'video' ? 'vidéo' : null);
  return {
    id: p.id, url: p.url, thumbUrl: p.thumbUrl, tag: kindLabel, couverture: !!p.couverture,
    commentaire: p.commentaire, video: isVideo(p), rotation: p.rotation || 0,
    etat: p.updated_at && p.created_at !== p.updated_at ? 'modifiée' : '',
  };
}

function rendreTiroirVues(vues, aFaire, absente) {
  if (!vues.length) return '';
  const total = vues.length;
  const detail = aFaire.map(v => VUE_LABELS[v.vue] || v.vue).join(', ');
  return `
    <details class="photos-vues">
      <summary class="photos-vues-summary">
        <span class="warn-puce"></span>
        <span class="photos-vues-title">${total} vue${total > 1 ? 's' : ''} manquante${total > 1 ? 's' : ''}</span>
        ${detail ? `<span class="photos-vues-detail">${esc(detail)}</span>` : ''}
        <span class="photos-vues-chev">▸</span>
      </summary>
      <div class="photos-vues-list">${vues.map((v, i) => rendreLigneVue(v, i)).join('')}</div>
    </details>`;
}

function rendreLigneVue(v, i) {
  const label = VUE_LABELS[v.vue] || v.vue;
  const qui = localStorage.getItem('iartcane-qui') ?? 'alain';
  if (v.statut === 'absente') {
    const date = v.declaree_at ? fmtShortDate(v.declaree_at) : '';
    return `
      <div class="photos-vue absente" data-vue-idx="${i}">
        <span class="photos-vue-label">${esc(label)}</span>
        <span class="photos-vue-meta">déclarée absente — ${esc(v.declaree_par || qui)}${date ? ', ' + date : ''}</span>
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
  el.querySelector('[data-action="remarque-refuse"]')?.addEventListener('click', () => refuserRemarque());
  el.querySelector('[data-action="remarque-reprendre"]')?.addEventListener('click', () => { openCamera('objet', { onClose: onCamClose }); });

  const ta = el.querySelector('.ui-galerie-comment-area');
  if (ta) { const mic = micButton(ta); if (mic) ta.parentElement.append(mic); }

  el.querySelectorAll('[data-action="vue-prendre"]').forEach(btn => {
    btn.addEventListener('click', () => openCamera('objet', { onClose: onCamClose }));
  });
  el.querySelectorAll('[data-action="vue-absente"]').forEach(btn => {
    btn.addEventListener('click', () => declarerVueAbsente(Number(btn.dataset.idx)));
  });
  el.querySelectorAll('[data-action="vue-annuler"]').forEach(btn => {
    btn.addEventListener('click', () => annulerVueAbsente(Number(btn.dataset.idx)));
  });
}

function photosTriees() { return O.photos.slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)); }
function photoCourante() { return photosTriees()[currentIndex]; }

function onChoisir(i) { currentIndex = i; hooks.rendre(); }

function onModifier(img) {
  location.hash = `#/objet/${encodeURIComponent(S.currentObjet.id)}/photo/${encodeURIComponent(img.id)}/modifier`;
}

async function onSupprimer() {
  const p = photoCourante();
  const o = S.currentObjet;
  if (!p || !o) return;
  if (!confirm('Supprimer cette photo ? (fichier + référence, définitif)')) return;
  if (!await supprimer(cibleObjet(o.id), p)) return;
  logEvent('photo_supprimee', { photo: p.storage_path });
  toast('Photo supprimée');
  currentIndex = 0;
  await hooks.recharger(o.id);
}

async function onCouverture() {
  const p = photoCourante();
  const o = S.currentObjet;
  if (!p || !o) return;
  if (!await definirCouverture(cibleObjet(o.id), p)) { toast('Photo de couverture non enregistrée', true); return; }
  O.photos.forEach(ph => { ph.couverture = ph.id === p.id; });
  toast('✓ Photo de couverture enregistré');
  logEvent('couverture', { photo: p.storage_path });
  hooks.rendre();
}

async function onTaguer(kind) {
  const p = photoCourante();
  const o = S.currentObjet;
  if (!p || !o || p.kind === kind) return;
  if (!await taguer(cibleObjet(o.id), p, kind)) { toast('Tag de la photo non enregistré', true); return; }
  p.kind = kind;
  logEvent('tag_photo', { photo: p.storage_path, kind });
  hooks.rendre();
}

async function onCommenter(texte) {
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

async function onReordonner(ordre) {
  const o = S.currentObjet;
  if (!o) return;
  const photos = photosTriees();
  const movedId = photos[currentIndex]?.id;
  const { updates, echecs, ok } = await reordonner(cibleObjet(o.id), photos, ordre);
  if (!ok) {
    toast(echecs.length === updates.length
      ? 'Ordre des photos non enregistré'
      : `Ordre des photos partiellement enregistré — ${echecs.length}/${updates.length} échec(s)`, true);
  } else {
    toast('✓ Ordre des photos enregistré');
  }
  O.photos.forEach(p => { const u = updates.find(u => u.id === p.id); if (u) p.ordre = u.ordre; });
  logEvent('ordre_photos', { n: updates.length });
  const nouvelIdx = photosTriees().findIndex(p => p.id === movedId);
  if (nouvelIdx >= 0) currentIndex = nouvelIdx;
  hooks.rendre();
}

async function patchVue(idx, patch, msg, evenement) {
  const o = S.currentObjet;
  if (!o) return;
  const vues = Array.isArray(o.vues_manquantes) ? o.vues_manquantes : [];
  const v = vues[idx];
  if (!v) return;
  const updated = [...vues];
  updated[idx] = { ...v, ...patch };
  if (!await enregistrer(() => sb.from('objets').update({ vues_manquantes: updated }).eq('owner_id', S.tenantId).eq('id', o.id), msg)) return;
  o.vues_manquantes = updated;
  logEvent(evenement, { vue: v.vue });
  hooks.rendre();
}
function declarerVueAbsente(idx) {
  const declaree_par = localStorage.getItem('iartcane-qui') ?? 'alain';
  return patchVue(idx, { statut: 'absente', declaree_par, declaree_at: new Date().toISOString() }, 'Vue signalée absente', 'vue_absente');
}
function annulerVueAbsente(idx) {
  return patchVue(idx, { statut: 'a_faire', declaree_par: null, declaree_at: null }, 'Vue rétablie', 'vue_absente_annulee');
}

async function onCamClose(n) {
  const o = S.currentObjet;
  if (!o || !n) return;
  const { purgeConsigne } = await import('../../core/data.js');
  await purgeConsigne(o, o.id);
  if (o.statut !== 'validee') toast(`${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} — « Relancer les recherches » quand tu es prêt`);
  await hooks.recharger(o.id);
}

function fmtShortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
