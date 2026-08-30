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
import { texte } from '../../ui/texte.js';
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
      <div class="desc-carte-ia"></div>
      <div class="desc-carte-maison"></div>
    </div>`;

  // Carte IA — un verrou humain est posé à l'enregistrement (voir saveIa).
  texte(corps.querySelector('.desc-carte-ia'), {
    titre: 'Rédigé par l’IA',
    tag: modele,
    contenu: o.description,
    vide: 'Pas encore de description générée.',
    mode: editIa ? 'edition' : 'lecture',
    lignes: 8,
    meta: `généré le ${ficheDate}${relu}`,
    actions: [
      { label: '↻ Régénérer', onClick: onRegenerer },
      { label: '✎', onClick: () => { editIa = true; hooks.rendre?.(); } },
    ],
    sur: { enregistrer: saveIa, annuler: () => { editIa = false; hooks.rendre?.(); } },
  });

  // Carte maison — IMMORTELLE (D-042 amendée) : jamais réécrite par l'IA. À
  // la différence de la carte IA ci-dessus, saveMaison ne pose aucun verrou —
  // la brique ne connaît pas cette distinction, c'est la vue qui la porte.
  texte(corps.querySelector('.desc-carte-maison'), {
    titre: 'Description maison',
    tag: 'jamais réécrite par l’IA',
    contenu: o.commentaire,
    vide: 'Aucune description maison.',
    mode: editMaison ? 'edition' : 'lecture',
    micro: true,
    lignes: 6,
    meta: o.commentaire ? 'Modifiée le ' + fmtDate(o.updated_at) : '—',
    actions: [{ label: '✎ Modifier', onClick: () => { editMaison = true; hooks.rendre?.(); } }],
    sur: { enregistrer: saveMaison, annuler: () => { editMaison = false; hooks.rendre?.(); } },
  });
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

// `texteSaisi` n'arrive ici QUE si `texte()` a détecté un changement réel par
// rapport à `o.description` (contrat de la brique) — plus besoin de comparer
// avant/après localement.
async function saveIa(texteSaisi) {
  const o = S.currentObjet;
  const avant = o.description;

  const verrous = new Set(Array.isArray(o.verrous_humains) ? o.verrous_humains : []);
  verrous.add('description');

  const ok = await enregistrer(() => sb.from('objets')
    .update({ description: texteSaisi, verrous_humains: [...verrous] })
    .eq('owner_id', S.tenantId).eq('id', o.id), 'Description');
  if (!ok) return;

  o.description = texteSaisi;
  o.verrous_humains = [...verrous];
  logEvent('correction', { champs: { description: { avant, apres: texteSaisi } } });
  editIa = false;
  hooks.rendre?.();
}

async function saveMaison(texteSaisi) {
  const o = S.currentObjet;
  const ok = await enregistrer(() => sb.from('objets')
    .update({ commentaire: texteSaisi })
    .eq('owner_id', S.tenantId).eq('id', o.id), 'Note de la maison');
  if (!ok) return;

  o.commentaire = texteSaisi;
  logEvent('note_maison', { n: texteSaisi.length });
  editMaison = false;
  hooks.rendre?.();
}
