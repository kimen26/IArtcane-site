// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/ventes.js : écran Ventes & estimation (2d).
// ═══════════════════════════════════════════════════════════════════════════
import { esc, toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { fmtNum, fmtDate } from '../../core/format.js';
import { sb, logEvent } from '../../core/data.js';
import { enregistrer } from '../../core/feedback.js';
import { marquerUtile } from '../../core/consultations.js';
import { loadViewCss } from '../../core/css.js';
import { page } from '../../ui/page.js';
import { O, hooks, pastilleHtml } from './etat.js';

await loadViewCss('objet-suivi');

let filtre = 'toutes';   // 'toutes' | 'vendues' | 'envente'
let toutVoir = false;

const RAISONS_EXCLUSION = [
  { value: 'format trop éloigné', label: 'Format trop éloigné' },
  { value: 'état trop différent', label: 'État trop différent' },
  { value: 'pas la même œuvre/pièce', label: 'Pas la même œuvre/pièce' },
];

/** Tag de provenance de la fourchette (D-058). */
function tagFourchette(o) {
  const verrous = Array.isArray(o.verrous_humains) ? o.verrous_humains : [];
  if (verrous.includes('prix_bas') || verrous.includes('prix_haut')) {
    return 'fixée à la main';
  }
  const lastValo = O.events.find(e => e.action === 'passe_marche');
  const modele = lastValo?.detail?.modele ?? 'IA';
  return `calculée · ${modele}`;
}

function countComps(predicate) {
  return O.comps.filter(c => !c.exclu && predicate(c)).length;
}

export function rendre(el) {
  const o = S.currentObjet;
  const provenance = tagFourchette(o);
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
            <input type="text" inputmode="decimal" class="fork-num" id="fork-bas" value="${o.prix_bas != null ? fmtNum(o.prix_bas) : ''}" aria-label="Prix bas">
            <span class="fork-eur">€</span>
          </div>
          <span class="fork-dash">–</span>
          <div class="fork-field">
            <input type="text" inputmode="decimal" class="fork-num" id="fork-haut" value="${o.prix_haut != null ? fmtNum(o.prix_haut) : ''}" aria-label="Prix haut">
            <span class="fork-eur">€</span>
          </div>
        </div>
        <div class="fork-meta">
          <span>${nVendues} adjudication${nVendues > 1 ? 's' : ''} · ${nEnVente} en vente · confiance ${esc(o.confiance || '—')}</span>
          <button class="fork-reload" data-action="recalculer">↻ recalculer</button>
        </div>
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

  corps.querySelector('#fork-bas')?.addEventListener('change', e => onForkChange(e, 'prix_bas'));
  corps.querySelector('#fork-haut')?.addEventListener('change', e => onForkChange(e, 'prix_haut'));
  corps.addEventListener('click', onClick);
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
  const exclu = c.exclu
    ? `<span class="comp-exclu">écarté</span>`
    : '';
  const action = c.exclu
    ? `<button class="comp-link" data-action="retablir" data-cid="${esc(c.id)}">rétablir</button>`
    : `<a class="comp-link" href="${esc(c.lien || '#')}" target="_blank" rel="noopener">le lot ↗</a>`;
  const selectExclure = c.exclu ? '' : `
    <select class="comp-exclure-select" data-action="ecarter" data-cid="${esc(c.id)}" aria-label="Écarter ce comparable">
      <option value="">écarter…</option>
      ${RAISONS_EXCLUSION.map(r => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join('')}
    </select>`;

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

async function onForkChange(e, champ) {
  const o = S.currentObjet;
  const raw = e.target.value.replace(/\s/g, '').replace(',', '.');
  const valeur = raw === '' ? null : parseFloat(raw);
  if (valeur != null && !Number.isFinite(valeur)) {
    toast('Valeur numérique attendue', 'action');
    hooks.rendre?.();
    return;
  }
  const avant = o[champ];
  if (avant === valeur) return;

  const verrous = new Set(Array.isArray(o.verrous_humains) ? o.verrous_humains : []);
  verrous.add('prix_bas');
  verrous.add('prix_haut');

  const label = champ === 'prix_bas' ? 'Prix bas' : 'Prix haut';
  const ok = await enregistrer(() => sb.from('objets')
    .update({ [champ]: valeur, verrous_humains: [...verrous] })
    .eq('owner_id', S.tenantId).eq('id', o.id), label);
  if (!ok) return;

  o[champ] = valeur;
  o.verrous_humains = [...verrous];
  logEvent('correction', { champs: { [champ]: { avant, apres: valeur } } });
  hooks.rendre?.();
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
    const raison = el.value;
    if (!raison) return;
    const cid = el.dataset.cid;
    await setExclu(cid, true, raison);
    return;
  }
  if (act === 'retablir') {
    const cid = el.dataset.cid;
    await setExclu(cid, false, null);
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

async function setExclu(cid, exclu, raison) {
  const o = S.currentObjet;
  const label = exclu ? 'Comparable écarté' : 'Comparable rétabli';
  const ok = await enregistrer(() => sb.from('comparables')
    .update({ exclu, raison_exclusion: raison })
    .eq('owner_id', S.tenantId).eq('objet_id', o.id).eq('id', cid), label);
  if (!ok) return;
  const c = O.comps.find(x => x.id === cid);
  if (c) {
    c.exclu = exclu;
    c.raison_exclusion = raison;
  }
  logEvent(exclu ? 'comparable_exclu' : 'comparable_retabli', { comparable_id: cid, ...(raison ? { raison } : {}) });
  if (!exclu) marquerUtile({ objetId: o.id, besoin: 'comparables-prix' });
  hooks.rendre?.();
}
