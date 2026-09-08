// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/ventes.js : écran Ventes & estimation (2d).
// ═══════════════════════════════════════════════════════════════════════════
import { esc, toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { fmtNum, fmtDate } from '../../core/format.js';
import { sb, logEvent } from '../../core/data.js';
import { enregistrer, humaniser } from '../../core/feedback.js';
import { marquerUtile } from '../../core/consultations.js';
import { loadViewCss } from '../../core/css.js';
import { page } from '../../ui/page.js';
import { O, hooks, pastilleHtml } from './etat.js';
import { ecarterPourObjet, ecarterDuPool, retablir as retablirPortee } from '../../services/pool.js';

await loadViewCss('objet-suivi');

let filtre = 'toutes';   // 'toutes' | 'vendues' | 'envente'
let toutVoir = false;
let confirmationPoolId = null; // id du comparable en attente de confirmation portée pool

// Motifs portant leur portée (doctrine-cotation.md §6) : « objet » (setExclu,
// inchangé) ou « pool » (retire le lot de TOUTES les fiches — irréversible
// depuis cet écran, demande une confirmation avant écriture).
const RAISONS_EXCLUSION_OBJET = [
  { value: 'format trop éloigné', label: 'Format trop éloigné' },
  { value: 'état trop différent', label: 'État trop différent' },
  { value: 'pas la même œuvre/pièce', label: 'Pas la même œuvre/pièce' },
  { value: 'période différente', label: 'Période différente' },
  { value: 'prix aberrant', label: 'Prix aberrant (autre catégorie de pièce)' },
];
const RAISONS_EXCLUSION_POOL = [
  { value: 'pas cet artiste', label: 'Pas cet artiste (homonyme) — retirer du pool' },
  { value: 'lot multiple', label: 'Lot de plusieurs objets — retirer du pool' },
];
const PORTEE_PAR_MOTIF = Object.fromEntries([
  ...RAISONS_EXCLUSION_OBJET.map(r => [r.value, 'objet']),
  ...RAISONS_EXCLUSION_POOL.map(r => [r.value, 'pool']),
]);

/** Tag de provenance de la fourchette des ventes (D-058, amendé HO-158) :
 * `prix_bas/prix_haut` n'est plus saisi à la main — la fourchette vient
 * toujours du dernier événement `passe_marche` (script Cote ou IA Valo). */
function tagFourchette() {
  const lastValo = O.events.find(e => e.action === 'passe_marche');
  const modele = lastValo?.detail?.modele ?? (lastValo ? 'script Cote' : null);
  return modele ? `calculée · ${modele}` : 'pas encore calculée';
}

function countComps(predicate) {
  return O.comps.filter(c => !c.exclu && predicate(c)).length;
}

export function rendre(el) {
  const o = S.currentObjet;
  const provenance = tagFourchette();
  const nToutes = O.comps.length;
  const nVendues = countComps(c => c.source_type !== 'en_vente');
  const nEnVente = countComps(c => c.source_type === 'en_vente');

  let liste = [...O.comps];
  if (filtre === 'vendues') liste = liste.filter(c => c.source_type !== 'en_vente');
  if (filtre === 'envente') liste = liste.filter(c => c.source_type === 'en_vente');
  const totalFiltre = liste.length;
  const visible = toutVoir ? liste : liste.slice(0, 4);
  const reste = totalFiltre - visible.length;

  const corps = page(el, {
    titre: 'Ventes',
    fil: [...S.fil, { label: 'Ventes' }],
  });

  corps.innerHTML = `
    <div class="suivi-body">
      <section class="fork-block">
        <div class="fork-header">
          <span class="fork-label">Fourchette retenue</span>
          <span class="fork-tag">${esc(provenance)}</span>
          ${pastilleHtml('prix')}
        </div>
        <div class="fork-inputs">
          <div class="fork-field">
            <span class="fork-num" id="fork-bas">${o.prix_bas != null ? fmtNum(o.prix_bas) : '—'}</span>
            <span class="fork-eur">€</span>
          </div>
          <span class="fork-dash">–</span>
          <div class="fork-field">
            <span class="fork-num" id="fork-haut">${o.prix_haut != null ? fmtNum(o.prix_haut) : '—'}</span>
            <span class="fork-eur">€</span>
          </div>
        </div>
        <div class="fork-meta">
          <span>${nVendues} adjudication${nVendues > 1 ? 's' : ''} · ${nEnVente} en vente · confiance ${esc(o.confiance || '—')}</span>
          <button class="fork-reload" data-action="recalculer">↻ recalculer</button>
        </div>
        ${o.estimation_bas != null && o.estimation_haut != null ? `
        <div class="fork-meta">
          <span>Estimation d'Alain : ${fmtNum(o.estimation_bas)} – ${fmtNum(o.estimation_haut)} €</span>
          <button type="button" class="fork-reload" data-action="nav" data-ecran="identification">modifier dans Identification</button>
        </div>` : ''}
        <div class="comp-filters">
          <button class="filter-chip ${filtre === 'toutes' ? 'active' : ''}" data-action="filtrer" data-filtre="toutes">Toutes ${nToutes}</button>
          <button class="filter-chip ${filtre === 'vendues' ? 'active' : ''}" data-action="filtrer" data-filtre="vendues">Vendues ${nVendues}</button>
          <button class="filter-chip ${filtre === 'envente' ? 'active' : ''}" data-action="filtrer" data-filtre="envente">En vente ${nEnVente}</button>
        </div>
      </section>

      <section class="comp-list">
        ${visible.map(c => carteComparable(c, o)).join('')}
        ${!visible.length ? '<div class="obj-stub">Aucun comparable à afficher.</div>' : ''}
      </section>

      ${reste > 0 ? `<button class="comp-more" data-action="voir-plus">Voir les ${reste} autre${reste > 1 ? 's' : ''}</button>` : ''}
    </div>`;

  corps.addEventListener('click', onClick);
}

/** Un lot marqué exclu avec un motif de portée pool n'a plus de bouton
 * rétablir (la ligne `pool_exclusions` est la mémoire du refus). */
function estExcluPool(c) {
  return c.exclu && PORTEE_PAR_MOTIF[c.raison_exclusion] === 'pool';
}

function carteComparable(c, o) {
  const isVente = c.source_type === 'en_vente';
  const badge = isVente
    ? '<span class="comp-badge comp-envente">en vente</span>'
    : '<span class="comp-badge comp-vendu">vendu</span>';
  const prix = c.prix != null
    ? `<span class="comp-prix">${fmtNum(c.prix)} €</span>`
    : (c.estimation_bas != null && c.estimation_haut != null
      ? `<span class="comp-prix">est. ${fmtNum(c.estimation_bas)}–${fmtNum(c.estimation_haut)} €</span>`
      : '<span class="comp-prix">—</span>');
  const date = isVente ? '' : `<span class="comp-date">${fmtDate(c.date_vente)}</span>`;
  const specs = ligneSpecs(c);
  const excluPool = estExcluPool(c);
  const exclu = c.exclu
    ? `<span class="comp-exclu">${excluPool ? 'retiré du pool' : 'écarté ici'}</span>`
    : '';
  const action = c.exclu
    ? (excluPool ? '' : `<button class="comp-link" data-action="retablir" data-cid="${esc(c.id)}">rétablir</button>`)
    : `<a class="comp-link" href="${esc(c.lien || '#')}" target="_blank" rel="noopener">le lot ↗</a>`;
  const enConfirmation = confirmationPoolId === c.id;
  const selectExclure = (c.exclu || enConfirmation) ? '' : `
    <select class="comp-exclure-select" data-action="ecarter" data-cid="${esc(c.id)}" aria-label="Écarter ce comparable">
      <option value="">écarter…</option>
      ${RAISONS_EXCLUSION_OBJET.map(r => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join('')}
      <optgroup label="Retirer de toutes les fiches">
        ${RAISONS_EXCLUSION_POOL.map(r => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join('')}
      </optgroup>
    </select>`;
  const confirmationHtml = enConfirmation ? `
    <div class="comp-confirm-pool">
      <p class="comp-confirm-txt">Retirer ce lot de toutes les fiches où il apparaît — geste irréversible depuis cet écran.</p>
      <div class="comp-confirm-actions">
        <button class="btn small" type="button" data-action="pool-annuler">Annuler</button>
        <button class="btn small danger" type="button" data-action="pool-confirmer" data-cid="${esc(c.id)}" data-motif="${esc(c._motifPoolChoisi || '')}">Retirer du pool</button>
      </div>
    </div>` : '';

  return `
    <article class="comp-card ${c.exclu ? 'exclu' : ''}">
      <div class="comp-thumb">
        ${c.imageSrc ? `<img src="${esc(c.imageSrc)}" alt="" loading="lazy" decoding="async">` : '<div class="comp-thumb-placeholder">🏺</div>'}
      </div>
      <div class="comp-body">
        <div class="comp-head">
          <span class="comp-house">${esc(c.maison || c.source || '—')}</span>
          ${badge}
          ${exclu}
        </div>
        <div class="comp-title">${esc(c.lot || c.titre || c.intitule || '—')}</div>
        <div class="comp-specs">${esc(specs)}</div>
        <div class="comp-foot">
          <div class="comp-price-row">${prix} ${date}</div>
          ${action}
        </div>
        ${selectExclure}
        ${confirmationHtml}
      </div>
    </article>`;
}

function ligneSpecs(c) {
  const parts = [];
  if (c.artiste) parts.push(c.artiste);
  if (c.date_vente && c.source_type !== 'en_vente') parts.push(fmtDate(c.date_vente));
  if (c.dimensions || (c.hauteur_cm != null)) {
    const dims = [];
    if (c.hauteur_cm != null) dims.push(`H ${c.hauteur_cm} cm`);
    if (c.largeur_cm != null) dims.push(`L ${c.largeur_cm} cm`);
    if (c.profondeur_cm != null) dims.push(`P ${c.profondeur_cm} cm`);
    parts.push(dims.join(' · ') || c.dimensions);
  }
  if (c.raison_exclusion) parts.push(c.raison_exclusion);
  return parts.join(' · ') || '—';
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;

  if (act === 'filtrer') {
    filtre = el.dataset.filtre;
    toutVoir = false;
    hooks.rendre?.();
    return;
  }
  if (act === 'voir-plus') {
    toutVoir = true;
    hooks.rendre?.();
    return;
  }
  if (act === 'recalculer') {
    await recalculer();
    return;
  }
  if (act === 'ecarter') {
    const motif = el.value;
    if (!motif) return;
    const cid = el.dataset.cid;
    if (PORTEE_PAR_MOTIF[motif] === 'pool') {
      // Portée pool : geste irréversible depuis cet écran — confirmation
      // inline (jamais de confirm() natif) avant toute écriture.
      const c = O.comps.find(x => x.id === cid);
      if (c) c._motifPoolChoisi = motif;
      confirmationPoolId = cid;
      hooks.rendre?.();
      return;
    }
    await ecarterObjet(cid, motif);
    return;
  }
  if (act === 'retablir') {
    const cid = el.dataset.cid;
    await retablirObjet(cid);
    return;
  }
  if (act === 'pool-annuler') {
    confirmationPoolId = null;
    hooks.rendre?.();
    return;
  }
  if (act === 'pool-confirmer') {
    const cid = el.dataset.cid;
    const motif = el.dataset.motif;
    await ecarterPool(cid, motif);
  }
}

async function recalculer() {
  const o = S.currentObjet;
  const ok = await enregistrer(() => sb.from('objets')
    .update({ valo_due: true, tentative_valo_at: null })
    .eq('owner_id', S.tenantId).eq('id', o.id), 'Relance de valorisation', { silencieuxSiOk: true });
  if (!ok) return;
  o.valo_due = true;
  o.tentative_valo_at = null;
  logEvent('relance', { type: 'valorisation' });
  toast('Valorisation en file — le cron la prend sous ~10 min');
  hooks.rendre?.();
}

// ─── Portée OBJET (setExclu ancien, inchangé côté comportement) ───────────
async function ecarterObjet(cid, motif) {
  const o = S.currentObjet;
  try {
    await ecarterPourObjet(o.id, cid, motif);
  } catch (err) {
    console.warn('ecarterObjet:', err);
    toast(`« Comparable écarté » non enregistré — ${humaniser(err)}.`, 'panne');
    return;
  }
  const c = O.comps.find(x => x.id === cid);
  if (c) { c.exclu = true; c.raison_exclusion = motif; }
  logEvent('comparable_exclu', { comparable_id: cid, raison: motif });
  toast('✓ Comparable écarté enregistré');
  hooks.rendre?.();
}

async function retablirObjet(cid) {
  const o = S.currentObjet;
  try {
    await retablirPortee(cid);
  } catch (err) {
    console.warn('retablirObjet:', err);
    toast(`« Comparable rétabli » non enregistré — ${humaniser(err)}.`, 'panne');
    return;
  }
  const c = O.comps.find(x => x.id === cid);
  if (c) { c.exclu = false; c.raison_exclusion = null; }
  logEvent('comparable_retabli', { comparable_id: cid });
  toast('✓ Comparable rétabli enregistré');
  marquerUtile({ objetId: o.id, besoin: 'comparables-prix' });
  hooks.rendre?.();
}

// ─── Portée POOL (irréversible depuis cet écran) ───────────────────────────
async function ecarterPool(cid, motif) {
  const o = S.currentObjet;
  const c = O.comps.find(x => x.id === cid);
  if (!c || !motif) return;
  confirmationPoolId = null;
  let resultat;
  try {
    resultat = await ecarterDuPool(c, o.auteur, motif);
  } catch (err) {
    console.warn('ecarterPool:', err);
    toast(`« Retrait du pool » non enregistré — ${humaniser(err)}.`, 'panne');
    hooks.rendre?.();
    return;
  }
  c.exclu = true;
  c.raison_exclusion = motif;
  logEvent('comparable_exclu_pool', {
    comparable_id: cid, raison: motif,
    comparables_touches: resultat.comparables_touches, retire_du_pool: resultat.retire_du_pool,
  });
  const autres = Math.max(0, resultat.comparables_touches - 1);
  toast(`Retiré du pool — écarté aussi sur ${autres} autre${autres > 1 ? 's' : ''} fiche${autres > 1 ? 's' : ''}`);
  hooks.rendre?.();
}
