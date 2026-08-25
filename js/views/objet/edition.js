// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/edition.js : mode « Corriger » de la fiche produit.
// Liste des champs éditables, rendu d'une ligne de définition, enregistrement
// des corrections (chaque diff devient un événement 'correction' — Alain est la
// ground truth, D-025). Territoire dédié : un chantier « champs de la fiche »
// ne touche que ce fichier.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { sb, logEvent } from '../../core/data.js';
import { O, hooks } from './etat.js';

// Champs éditables en mode « Corriger » (chaque diff → événement 'correction' = leçon PMO)
export const CHAMPS_EDIT = [
  ['titre', 'Titre'], ['categorie', 'Catégorie'], ['technique', 'Technique'],
  ['periode', 'Période'], ['ecole', 'Région / école'], ['auteur', 'Auteur'],
  ['marques', 'Marques / poinçons'], ['etat', 'État'],
  ['prix_bas', 'Prix bas (€)'], ['prix_haut', 'Prix haut (€)'],
];

export function dlRow(label, val, editField, type = 'text') {
  const v = (val ?? '') === '' ? null : String(val);
  if (O.editing && editField) {
    return `<dt>${label}</dt><dd><input id="edit-${editField}" type="${type}" value="${esc(v ?? '')}"></dd>`;
  }
  return `<dt>${label}</dt><dd>${v ? esc(v) : '<span class="miss">—</span>'}</dd>`;
}

export async function saveCorrections() {
  const o = S.currentObjet;
  const auteur = $('#corr-qui')?.value ?? 'alain';
  localStorage.setItem('iartcane-qui', auteur);
  const updates = {};
  const rows = [];
  for (const [champ] of [...CHAMPS_EDIT, ['description', 'Description']]) {
    const inp = $('#edit-' + champ);
    if (!inp) continue;
    let nv = inp.value.trim();
    const av = o[champ] == null ? '' : String(o[champ]);
    if (champ.startsWith('prix_')) {
      nv = nv === '' ? null : Number(nv.replace(',', '.'));
      if (nv !== null && !Number.isFinite(nv)) { toast(`Prix invalide (${champ})`, true); return; }
    } else {
      nv = nv === '' ? null : nv;
    }
    if (av !== String(nv ?? '')) {
      updates[champ] = nv;
      rows.push({ champ, avant: av || null, apres: nv == null ? null : String(nv) });
    }
  }
  if (!rows.length) { toast('Aucune modification'); O.editing = false; hooks.rendre(); return; }
  updates.statut = 'contestee';
  const { error } = await sb.from('objets').update(updates).eq('owner_id', S.tenantId).eq('id', o.id);
  if (error) { toast(error.message, true); return; }
  // Ground truth tracée dans evenements (corrections absorbée, D-027) — le cron la relit là.
  logEvent('correction', { champs: Object.fromEntries(rows.map(r => [r.champ, { avant: r.avant, apres: r.apres }])) });
  toast(`${rows.length} correction${rows.length > 1 ? 's' : ''} gravée${rows.length > 1 ? 's' : ''} — leçons pour l'IA`);
  hooks.recharger(o.id);
}
