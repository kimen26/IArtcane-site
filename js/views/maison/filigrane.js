// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/maison/filigrane.js : M2 — Filigrane.
//
// Interrupteur actif · aperçu manipulable (photo 4:3, marque = disque initiale +
// nom, placement au doigt via pointer capture) · lettrage (3 choix) · taille &
// discrétion (range) · alignements (5 raccourcis) · cibles (3 cases, l'original
// jamais marqué). Persistance : tenants.filigrane (jsonb entier), debounce 400 ms
// sur drag/sliders. Le rendu à l'export est HORS périmètre (aucun export n'existe).
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc } from '../../core/dom.js';
import { enregistrer } from '../../core/feedback.js';
import { S, canWrite } from '../../core/state.js';
import { sb, signPaths } from '../../core/data.js';
import { M } from './etat.js';

// 3 lettrages. Le design system ne charge que Fraunces + Inter (index.html gelé) :
// on offre 3 familles réellement disponibles, en gardant les clés de la migration
// 0027 ('fraunces' | 'spectral' | 'franklin') pour la compat de persistance.
// Cf. rapport d'exécution (écart lettrage).
const LETTRAGES = {
  fraunces: { label: 'Fraunces', css: 'var(--serif)', poids: 700, track: '.06em', sample: 'Aa' },
  spectral: { label: 'Serif', css: 'Georgia, "Times New Roman", serif', poids: 500, track: '.12em', sample: 'Aa' },
  franklin: { label: 'Sans', css: 'var(--sans)', poids: 600, track: '.18em', sample: 'AA' },
};

const SNAPS = [
  { n: 'Haut g.', x: 22, y: 12 }, { n: 'Haut d.', x: 78, y: 12 },
  { n: 'Centre', x: 50, y: 50 },
  { n: 'Bas g.', x: 22, y: 88 }, { n: 'Bas d.', x: 78, y: 88 },
];

let coverUrl = null;      // URL signée de la photo de couverture
let coverUrlPath = null;  // storage_path correspondant (invalide le cache si la maison change)
let saveTimer = null;

export async function rendre(zone) {
  const lecture = !canWrite();
  const f = M.tenant.filigrane;
  const initiale = (M.tenant.name.trim().charAt(0) || '·').toUpperCase();

  // Résolution paresseuse de l'URL de couverture ; recalculée si M.coverPath a changé
  // (bascule de maison → remount avec un autre premier objet).
  if (M.coverPath && coverUrlPath !== M.coverPath) {
    const urls = await signPaths([M.coverPath]);
    coverUrl = urls[M.coverPath] ?? null;
    coverUrlPath = M.coverPath;
  } else if (!M.coverPath) {
    coverUrl = null;
    coverUrlPath = null;
  }

  zone.innerHTML = `
    <div class="ms-card">
      <div class="ms-sec-title">
        <span>Filigrane</span><span class="ms-rule"></span>
        <button class="ms-switch ${f.actif ? 'is-on' : ''}" id="ms-fili-actif" role="switch"
                aria-checked="${f.actif}" ${lecture ? 'disabled' : ''} aria-label="Activer le filigrane">
          <span class="ms-switch-knob"></span>
        </button>
      </div>
      <p class="ms-note">Marque la maison sur les photos partagées hors de l'application. Faites glisser la marque sur l'aperçu pour la placer.</p>

      <div class="ms-fili-preview ${f.actif ? '' : 'is-off'}" id="ms-fili-preview">
        ${coverUrl
          ? `<img src="${esc(coverUrl)}" alt="" class="ms-fili-photo" draggable="false">`
          : '<div class="ms-fili-photo ms-fili-placeholder">photo de couverture</div>'}
        <div class="ms-fili-mark" id="ms-fili-mark">
          <div class="ms-fili-mark-disc">${esc(initiale)}</div>
          <div class="ms-fili-mark-name">${esc(M.tenant.name || 'Maison')}</div>
        </div>
        <div class="ms-fili-legend">glisser pour placer</div>
      </div>

      <div class="ms-mini-block">
        <div class="ms-mini-label">Lettrage</div>
        <div class="ms-lettrages" id="ms-lettrages">${rendreLettrages(f)}</div>
      </div>

      <div class="ms-fili-sliders">
        <label class="ms-slider">
          <span class="ms-slider-head"><span class="ms-mini-label">Taille</span><span id="ms-lbl-scale">${f.scale} %</span></span>
          <input type="range" min="60" max="220" value="${f.scale}" id="ms-scale" ${lecture ? 'disabled' : ''}>
        </label>
        <label class="ms-slider">
          <span class="ms-slider-head"><span class="ms-mini-label">Discrétion</span><span id="ms-lbl-op">${f.opacite} %</span></span>
          <input type="range" min="8" max="90" value="${f.opacite}" id="ms-op" ${lecture ? 'disabled' : ''}>
        </label>
      </div>

      <div class="ms-fili-snaps">
        <span class="ms-mini-label">Aligner</span>
        ${SNAPS.map(s => `<button class="ms-snap" data-x="${s.x}" data-y="${s.y}" ${lecture ? 'disabled' : ''}>${esc(s.n)}</button>`).join('')}
      </div>
    </div>

    <div class="ms-card">
      <div class="ms-sec-title"><span>Appliqué à</span><span class="ms-rule"></span></div>
      <div class="ms-cibles">
        ${cible('partagePublic', 'Liens de partage publics', f.cibles.partagePublic, false)}
        ${cible('exportPdf', 'Exports PDF et fiches imprimées', f.cibles.exportPdf, false)}
        ${cible('telechargementOriginal', "Téléchargement d'une photo d'origine", false, true)}
      </div>
      <p class="ms-note ms-note-faint">L'original n'est jamais marqué.</p>
    </div>`;

  appliquerMark();
  if (!lecture) brancher(zone);
}

function rendreLettrages(f) {
  return Object.entries(LETTRAGES).map(([k, d]) => `
    <button class="ms-lettrage ${f.font === k ? 'is-sel' : ''}" data-font="${k}">
      <span style="font-family:${d.css};font-weight:${d.poids};letter-spacing:${d.track}">${esc(d.sample)}</span>
      <span class="ms-lettrage-n">${esc(d.label)}</span>
    </button>`).join('');
}

function cible(key, label, coche, desactive) {
  return `
    <label class="ms-cible ${desactive ? 'is-disabled' : ''}">
      <input type="checkbox" data-cible="${key}" ${coche ? 'checked' : ''} ${desactive || !canWrite() ? 'disabled' : ''}>
      <span class="ms-cible-box"></span>
      <span>${esc(label)}</span>
    </label>`;
}

// Position / échelle / opacité / police de la marque sur l'aperçu.
function appliquerMark() {
  const mark = $('#ms-fili-mark');
  if (!mark) return;
  const f = M.tenant.filigrane;
  const d = LETTRAGES[f.font] ?? LETTRAGES.fraunces;
  mark.style.left = f.x + '%';
  mark.style.top = f.y + '%';
  mark.style.transform = `translate(-50%,-50%) scale(${f.scale / 100})`;
  mark.style.opacity = String(f.opacite / 100);
  mark.style.fontFamily = d.css;
  mark.style.fontWeight = String(d.poids);
  mark.style.letterSpacing = d.track;
}

// ─── Persistance (jsonb entier, debounce 800 ms) ──────────────────────────
// Debounce allongé de 400 à 800 ms (écart assumé, cf. rapport d'exécution) :
// le toast de confirmation doit accompagner la fin du geste sur les sliders,
// pas chaque pixel du glissement.
function planifierSauvegarde() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(sauvegarder, 800);
}

async function sauvegarder() {
  await enregistrer(() => sb.from('tenants').upsert({ owner_id: S.tenantId, filigrane: M.tenant.filigrane }), 'Filigrane');
}

// Applique un patch en mémoire + planifie la sauvegarde ; immediate=true pour
// les gestes discrets (toggle, lettrage, cible) qui n'ont pas besoin de debounce.
function patch(delta, immediate = false) {
  M.tenant.filigrane = {
    ...M.tenant.filigrane,
    ...delta,
    cibles: { ...M.tenant.filigrane.cibles, ...(delta.cibles ?? {}) },
  };
  if (immediate) { clearTimeout(saveTimer); sauvegarder(); }
  else planifierSauvegarde();
}

// ─── Branchements ─────────────────────────────────────────────────────────
function brancher(zone) {
  // Interrupteur actif.
  $('#ms-fili-actif').addEventListener('click', () => {
    const actif = !M.tenant.filigrane.actif;
    patch({ actif }, true);
    $('#ms-fili-actif').classList.toggle('is-on', actif);
    $('#ms-fili-actif').setAttribute('aria-checked', String(actif));
    $('#ms-fili-preview').classList.toggle('is-off', !actif);
  });

  // Placement au doigt (pointer capture, bornes x 4-96 % / y 6-94 %).
  const preview = $('#ms-fili-preview');
  preview.addEventListener('pointerdown', e => {
    if (e.target.closest('.ms-fili-legend')) return;
    try { preview.setPointerCapture(e.pointerId); } catch { /* pas de capture : dégradé */ }
    const bouger = ev => {
      const r = preview.getBoundingClientRect();
      const x = Math.max(4, Math.min(96, ((ev.clientX - r.left) / r.width) * 100));
      const y = Math.max(6, Math.min(94, ((ev.clientY - r.top) / r.height) * 100));
      patch({ x: Math.round(x), y: Math.round(y) });
      appliquerMark();
    };
    bouger(e);
    const fin = () => {
      preview.removeEventListener('pointermove', bouger);
      preview.removeEventListener('pointerup', fin);
      preview.removeEventListener('pointercancel', fin);
    };
    preview.addEventListener('pointermove', bouger);
    preview.addEventListener('pointerup', fin);
    preview.addEventListener('pointercancel', fin);
  });

  // Lettrage.
  zone.querySelectorAll('#ms-lettrages .ms-lettrage').forEach(b => {
    b.addEventListener('click', () => {
      patch({ font: b.dataset.font }, true);
      zone.querySelectorAll('#ms-lettrages .ms-lettrage').forEach(x => x.classList.toggle('is-sel', x === b));
      appliquerMark();
    });
  });

  // Sliders taille / discrétion.
  const scale = $('#ms-scale');
  scale.addEventListener('input', () => {
    $('#ms-lbl-scale').textContent = scale.value + ' %';
    patch({ scale: Number(scale.value) });
    appliquerMark();
  });
  const op = $('#ms-op');
  op.addEventListener('input', () => {
    $('#ms-lbl-op').textContent = op.value + ' %';
    patch({ opacite: Number(op.value) });
    appliquerMark();
  });

  // Alignements.
  zone.querySelectorAll('.ms-snap').forEach(b => {
    b.addEventListener('click', () => {
      patch({ x: Number(b.dataset.x), y: Number(b.dataset.y) }, true);
      appliquerMark();
    });
  });

  // Cibles (téléchargementOriginal reste toujours false, case désactivée).
  zone.querySelectorAll('.ms-cible input[data-cible]').forEach(c => {
    c.addEventListener('change', () => {
      const key = c.dataset.cible;
      if (key === 'telechargementOriginal') { c.checked = false; return; }
      patch({ cibles: { [key]: c.checked } }, true);
    });
  });
}
