// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/description.js : écran Description (2e).
// ═══════════════════════════════════════════════════════════════════════════
import { esc, toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { fmtDate } from '../../core/format.js';
import { sb, logEvent, enqueueJobs } from '../../core/data.js';
import { enregistrer } from '../../core/feedback.js';
import { loadViewCss } from '../../core/css.js';
import { page } from '../../ui/page.js';
import { micButton } from '../mic.js';
import { O, hooks, estValide, toggleValidation } from './etat.js';

await loadViewCss('objet-suivi');

let editIa = false;
let editMaison = false;

export function rendre(el) {
  const o = S.currentObjet;
  const cover = O.photos.find(p => p.couverture) ?? O.photos[0];
  const signes = (o.description || '').length;
  const ficheDate = O.fiche?.created_at ? fmtDate(O.fiche.created_at) : fmtDate(o.updated_at);
  const relu = estValide('description') ? ' · relu' : '';
  const modele = O.fiche?.modele || 'IA';

  const corps = page(el, {
    titre: 'Description',
    meta: `${signes} signe${signes > 1 ? 's' : ''}`,
    fil: [...S.fil, { label: 'Description' }],
    barre: { actions: [{ label: '✓ Textes validés', type: 'primaire', plein: true, onClick: onValiderTextes }] },
  });

  corps.innerHTML = `
    <div class="suivi-body">
      <div class="desc-reminder">
        <div class="desc-reminder-thumb">
          ${cover?.thumbUrl
            ? `<img src="${esc(cover.thumbUrl)}" alt="" loading="lazy" decoding="async">`
            : '<div class="desc-reminder-placeholder">🏺</div>'}
        </div>
        <p class="desc-reminder-txt">Texte de catalogue. Il reprend ce qui est déjà dans l’identification, ne le contredit jamais : les champs restent la source.</p>
      </div>

      <section class="desc-card desc-ia">
        <div class="desc-card-head">
          <span class="desc-card-label">Rédigé par l’IA</span>
          <span class="desc-card-tag">${esc(modele)}</span>
        </div>
        ${editIa ? renderIaEditor(o) : renderIaText(o)}
        ${!editIa ? `
          <div class="desc-card-foot">
            <span class="desc-card-meta">généré le ${ficheDate}${relu}</span>
            <button class="desc-action" data-action="regenerer">↻ Régénérer</button>
            <button class="desc-action" data-action="edit-ia">✎</button>
          </div>
        ` : ''}
      </section>

      <section class="desc-card desc-maison">
        <div class="desc-card-head">
          <span class="desc-card-label">Description maison</span>
          <span class="desc-card-hint">jamais réécrite par l’IA</span>
        </div>
        ${editMaison ? renderMaisonEditor(o) : renderMaisonText(o)}
        ${!editMaison ? `
          <div class="desc-card-foot">
            <span class="desc-card-meta">${o.commentaire ? 'Modifiée le ' + fmtDate(o.updated_at) : '—'}</span>
            <button class="desc-action" data-action="edit-maison">✎ Modifier</button>
          </div>
        ` : ''}
      </section>
    </div>`;

  // Actions fixes
  corps.querySelector('[data-action="regenerer"]')?.addEventListener('click', onRegenerer);
  corps.querySelector('[data-action="edit-ia"]')?.addEventListener('click', () => { editIa = true; hooks.rendre?.(); });
  corps.querySelector('[data-action="edit-maison"]')?.addEventListener('click', () => { editMaison = true; hooks.rendre?.(); });

  // Édition IA
  corps.querySelector('[data-action="save-ia"]')?.addEventListener('click', saveIa);
  corps.querySelector('[data-action="cancel-ia"]')?.addEventListener('click', () => { editIa = false; hooks.rendre?.(); });

  // Édition maison : dictée + sauvegarde au change
  const maisonTa = corps.querySelector('#desc-maison-ta');
  if (maisonTa) {
    maisonTa.addEventListener('change', saveMaison);
    const wrap = maisonTa.closest('.desc-maison-editor');
    if (wrap) {
      const mic = micButton(maisonTa);
      if (mic) wrap.appendChild(mic);
    }
    corps.querySelector('[data-action="save-maison"]')?.addEventListener('click', saveMaison);
    corps.querySelector('[data-action="cancel-maison"]')?.addEventListener('click', () => { editMaison = false; hooks.rendre?.(); });
  }
}

function renderIaText(o) {
  if (!o.description) return '<div class="desc-text miss">Pas encore de description générée.</div>';
  return `<div class="desc-text">${esc(o.description)}</div>`;
}

function renderIaEditor(o) {
  return `
    <div class="desc-ia-editor">
      <textarea id="desc-ia-ta" class="desc-textarea" rows="8">${esc(o.description || '')}</textarea>
      <div class="desc-editor-actions">
        <button class="btn-outline" data-action="cancel-ia">Annuler</button>
        <button class="btn-primary" data-action="save-ia">Enregistrer</button>
      </div>
    </div>`;
}

function renderMaisonText(o) {
  if (!o.commentaire) return '<div class="desc-text miss">Aucune description maison.</div>';
  return `<div class="desc-text">${esc(o.commentaire)}</div>`;
}

function renderMaisonEditor(o) {
  return `
    <div class="desc-maison-editor mic-wrap">
      <textarea id="desc-maison-ta" class="desc-textarea" rows="6">${esc(o.commentaire || '')}</textarea>
      <div class="desc-editor-actions">
        <button class="btn-outline" data-action="cancel-maison">Annuler</button>
        <button class="btn-primary" data-action="save-maison">Enregistrer</button>
      </div>
    </div>`;
}

async function onRegenerer() {
  const o = S.currentObjet;
  const n = await enqueueJobs([o.id], 'r3');
  if (n) toast('R3 en file — le cron la prend sous ~2 min');
  else toast('Job R3 déjà en file');
}

async function onValiderTextes() {
  await toggleValidation('description');
  hooks.naviguer('hub');
}

async function saveIa() {
  const o = S.currentObjet;
  const ta = document.querySelector('#desc-ia-ta');
  const texte = ta?.value ?? '';
  const avant = o.description;
  if (avant === texte) { editIa = false; hooks.rendre?.(); return; }

  const verrous = new Set(Array.isArray(o.verrous_humains) ? o.verrous_humains : []);
  verrous.add('description');

  const ok = await enregistrer(() => sb.from('objets')
    .update({ description: texte, verrous_humains: [...verrous] })
    .eq('owner_id', S.tenantId).eq('id', o.id), 'Description');
  if (!ok) return;

  o.description = texte;
  o.verrous_humains = [...verrous];
  logEvent('correction', { champs: { description: { avant, apres: texte } } });
  editIa = false;
  hooks.rendre?.();
}

async function saveMaison() {
  const o = S.currentObjet;
  const ta = document.querySelector('#desc-maison-ta');
  const texte = ta?.value ?? '';
  const avant = o.commentaire;
  if (avant === texte) { editMaison = false; hooks.rendre?.(); return; }

  const ok = await enregistrer(() => sb.from('objets')
    .update({ commentaire: texte })
    .eq('owner_id', S.tenantId).eq('id', o.id), 'Note de la maison');
  if (!ok) return;

  o.commentaire = texte;
  logEvent('note_maison', { n: texte.length });
  editMaison = false;
  hooks.rendre?.();
}
