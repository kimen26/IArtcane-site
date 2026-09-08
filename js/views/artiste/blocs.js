// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/blocs.js : blocs « le dossier » de la fiche
// artiste (hero, cote, identité, signature, parcours, alertes, presse) +
// composition finale rendreFiche(), point d'entrée exporté.
//
// Extrait de index.js par HO-112, déplacement pur.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { cardHtml, fmtDate, fmtNum, mdToHtml } from '../../core/format.js';
import { A } from './etat.js';
import { rendreVentes, rendreChezToi, rendreExterne, rendreJournal } from './blocs-maison.js';
import { rendreIdentiteBloc } from './identite.js';

function dossier() {
  return A.artiste?.dossier ?? {};
}

// État local au bloc « Ses ventes aux enchères » (HO-162) — filtre par puce,
// pas de rechargement réseau. Module-local comme le reste de la vue (pas de
// framework réactif) : la puce déclenche hooks.rendre?.() (index.js), qui
// réinvoque rendreFiche() et relit cette variable.
let filtrePool = 'toutes'; // 'toutes' | 'vendues' | 'invendues'

/** Change le filtre du pool de ventes — appelé par index.js sur clic d'une puce. */
export function definirFiltrePool(v) {
  filtrePool = v;
}

function identite() {
  return dossier().identite ?? {};
}

// ─── Rendu HTML du hub 3a ───────────────────────────────────────────────────
export function rendreFiche() {
  const a = A.artiste;
  const d = dossier();
  const id = identite();

  const blocs = [
    rendreHero(a, d, id),
    rendreNoteCote(),
    rendreCote(d),
    rendreIdentiteBloc(a),
    rendreNotice(id),
    rendreSignature(d),
    rendreParcours(d),
    rendreVentesPool(),
    rendreVentes(),
    rendreAlertes(d),
    rendreChezToi(),
    rendreExterne(),
    rendrePresse(d),
    rendreJournal(),
  ].filter(Boolean);

  const objetsSection = `
    <section class="art-objets" id="art-objets">
      <div class="art-sec-title">Objets de la collection</div>
      ${A.objets.length
        ? `<div class="grid">${A.objets.map(cardHtml).join('')}</div>`
        : '<div class="art-empty">Aucun objet rattaché à cet artiste pour l\'instant.</div>'}
    </section>`;

  return `<div class="art-body">${blocs.join('')}${objetsSection}</div>`;
}

// 1. Hero identité
function rendreHero(a, d, id) {
  const portrait = A.images.find(p => p.zone === 'portrait');
  const imgHtml = portrait
    ? `<img src="${esc(portrait.thumbUrl || portrait.url)}" alt="" loading="eager" decoding="async">`
    : '';
  const metier = id.metier ? esc(id.metier) : '';
  const chips = [];
  if (d.cote) chips.push('coté en salle');
  const nMusees = Array.isArray(id.musees) ? id.musees.length : 0;
  if (nMusees) chips.push(`${nMusees} musée${nMusees > 1 ? 's' : ''}`);
  const portraitAction = portrait ? ' data-action="zoom-artiste-photo" data-pid="' + esc(portrait.id) + '"' : '';

  return `
    <section class="art-hero" aria-labelledby="art-hero-name">
      <div class="art-hero-portrait ${portrait ? '' : 'placeholder'}"${portraitAction}>
        ${imgHtml}
        ${!portrait ? '<span class="art-hero-placeholder-label">portrait d\'artiste</span>' : ''}
      </div>
      <div class="art-hero-text">
        <h1 class="art-hero-name" id="art-hero-name">${esc(a?.nom ?? A.nom)}</h1>
        ${metier ? `<div class="art-hero-meta">${metier}</div>` : ''}
        ${chips.length ? `<div class="art-hero-chips">${chips.map(c => `<span class="art-hero-chip">${esc(c)}</span>`).join('')}</div>` : ''}
      </div>
    </section>`;
}

// 1b. Note « € » dérivée du pool de ventes (HO-144) — la cote ARTISTE :
// « un marché existe-t-il, de quel ordre ? ». Calculée par la vue
// artistes_cote (médiane des lots marteau vendus, 5 lots minimum), jamais
// saisie. Le bloc éditorial « Cote du segment » (rendreCote ci-dessous) reste
// en dessous, inchangé — deux niveaux d'estimation distincts.
function rendreNoteCote() {
  const c = A.cote;
  if (!c) return '';
  const { n_marteau, mediane, prix_min, prix_max, n_invendus, n_total, note } = c;

  let ligneNote = '';
  if (note) {
    const pleins = '€'.repeat(note);
    const vides = '€'.repeat(5 - note);
    const meta = [
      `médiane ${fmtNum(Math.round(mediane))} €`,
      `${n_marteau} lot${n_marteau > 1 ? 's' : ''} au marteau`,
      `${fmtNum(prix_min)}–${fmtNum(prix_max)} €`,
    ];
    if (n_invendus > 0) meta.push(`${n_invendus} invendu${n_invendus > 1 ? 's' : ''}`);
    ligneNote = `
      <div class="art-note-head">
        <span class="art-note-euros" aria-label="note ${note} sur 5">${pleins}<span class="art-note-euros-off">${vides}</span></span>
      </div>
      <div class="art-note-meta">${esc(meta.join(' · '))}</div>`;
  } else if (n_marteau > 0) {
    const autres = n_total - n_marteau;
    const complement = autres > 0 ? ` (${autres} autre${autres > 1 ? 's' : ''} en convention non vérifiée, non comptés)` : '';
    ligneNote = `<div class="art-note-meta">${esc(`${n_marteau} lot${n_marteau > 1 ? 's' : ''} au marteau — 5 requis pour une note${complement}`)}</div>`;
  } else {
    return '';
  }

  const lots = A.lotsMarteau ?? [];
  const detailsHtml = lots.length ? `
    <details class="art-note-lots acc">
      <summary>les ${lots.length} lots qui fondent la note</summary>
      ${lots.map(ligneLotHtml).join('')}
    </details>` : '';

  return `
    <section class="art-note" aria-label="Cote">
      <div class="art-section-head"><span>Cote</span></div>
      ${ligneNote}
      ${detailsHtml}
    </section>`;
}

function ligneLotHtml(v) {
  const titre = (v.titre_lot ?? '').slice(0, 90);
  const prixTxt = v.invendu ? 'invendu' : (v.prix != null ? `${fmtNum(v.prix)} €` : '—');
  const meta = [fmtDate(v.date_vente), esc(v.maison ?? '')].filter(Boolean).join(' · ');
  return `
    <div class="art-note-lot-row">
      <div class="art-note-lot-main">
        <div class="art-note-lot-title">${esc(titre)}</div>
        <div class="art-note-lot-meta">${meta}</div>
      </div>
      <div class="art-note-lot-price">${esc(prixTxt)}</div>
      ${v.lien ? `<a class="art-note-lot-link" href="${esc(v.lien)}" target="_blank" rel="noopener">voir</a>` : ''}
    </div>`;
}

// 6b. Ses ventes aux enchères (HO-162) — TOUT le pool ventes_artiste, avec
// image, titre, maison, date, prix + type, technique/dimensions, lien. Placé
// avant « Ventes vérifiées » (blocs-maison.js, comparables rattachés aux
// objets de la maison — sujet différent, ne pas confondre). Repliage 8
// premières cartes visibles (même motif que blocs-maison.js:47), puces de
// filtre sans rechargement (état module-local `filtrePool`).
const TYPE_PRIX_LABEL = { marteau: 'au marteau', frais_compris: 'frais compris', non_verifie: 'type non vérifié' };

function rendreVentesPool() {
  const pool = A.pool ?? [];
  if (!pool.length) return '';

  const nTotal = pool.length;
  const nVendues = pool.filter(v => !v.invendu).length;
  const nInvendus = nTotal - nVendues;
  const nMarteau = pool.filter(v => v.prix_type === 'marteau' && !v.invendu).length;

  const vus = filtrePool === 'vendues' ? pool.filter(v => !v.invendu)
    : filtrePool === 'invendues' ? pool.filter(v => v.invendu)
    : pool;

  const affichees = vus.slice(0, 8);
  const cachees = vus.slice(8);

  const chip = (val, label, n) =>
    `<button type="button" class="filter-chip ${filtrePool === val ? 'active' : ''}" data-action="filtrer-pool" data-filtre-pool="${val}">${esc(label)} ${n}</button>`;

  const metaTotal = A.poolTotal > nTotal ? `${nTotal} des ${A.poolTotal} ventes` : `${nTotal} vente${nTotal > 1 ? 's' : ''}`;

  return `
    <section class="art-pool" aria-label="Ses ventes aux enchères">
      <div class="art-section-head">
        <span>Ses ventes aux enchères</span>
        <span class="art-section-meta">${esc(metaTotal)} · ${nMarteau} avec prix marteau · ${nInvendus} invendu${nInvendus > 1 ? 's' : ''}</span>
      </div>
      <div class="art-pool-filtres">
        ${chip('toutes', 'Toutes', nTotal)}
        ${chip('vendues', 'Vendues', nVendues)}
        ${chip('invendues', 'Invendues', nInvendus)}
      </div>
      ${vus.length ? `
        <div class="art-pool-liste">${affichees.map(lotPoolHtml).join('')}</div>
        ${cachees.length ? `<details class="art-pool-more acc"><summary>voir les ${vus.length} ventes</summary>${cachees.map(lotPoolHtml).join('')}</details>` : ''}
      ` : '<div class="art-empty">Aucune vente pour ce filtre.</div>'}
    </section>`;
}

function lotPoolHtml(v) {
  const img = v.imageSrc
    ? `<img src="${esc(v.imageSrc)}" alt="" loading="lazy" decoding="async">`
    : `<span class="art-pool-thumb-placeholder">🔨</span>`;
  const meta = [esc(v.maison ?? ''), v.date_vente ? fmtDate(v.date_vente) : ''].filter(Boolean).join(' · ');
  const typeLabel = TYPE_PRIX_LABEL[v.prix_type] ?? '';
  const prixHtml = v.invendu
    ? '<span class="art-pool-invendu">invendu</span>'
    : (v.prix != null
        ? `<span class="art-pool-prix-val">${fmtNum(v.prix)} ${esc(v.devise || '€')}</span>${typeLabel ? `<span class="art-pool-prix-type">${esc(typeLabel)}</span>` : ''}`
        : '—');
  const detail = [v.technique, v.dimensions].filter(Boolean).map(esc).join(' · ');

  return `
    <div class="art-pool-card">
      <div class="art-pool-thumb">${img}</div>
      <div class="art-pool-body">
        <div class="art-pool-titre">${esc(v.titre_lot || 'Lot sans titre')}</div>
        <div class="art-pool-meta">${meta}</div>
        ${detail ? `<div class="art-pool-detail">${detail}</div>` : ''}
        <div class="art-pool-prix">${prixHtml}</div>
      </div>
      ${v.lien ? `<a class="art-pool-lien" href="${esc(v.lien)}" target="_blank" rel="noopener">le lot ↗</a>` : ''}
    </div>`;
}

// 2. Cote du segment
function rendreCote(d) {
  const c = d.cote;
  if (!c) return '';
  const bas = c.bas != null ? fmtNum(c.bas) : '—';
  const haut = c.haut != null ? fmtNum(c.haut) : '—';
  const tendance = c.tendance === 'hausse' ? '↗ hausse' : c.tendance === 'baisse' ? '↘ baisse' : c.tendance === 'stable' ? '→ stable' : '';

  return `
    <section class="art-cote" aria-label="Cote du segment">
      <div class="art-cote-main">
        <div class="art-cote-label">Cote du segment</div>
        <div class="art-cote-value">${bas} – ${haut} €</div>
        ${c.segment ? `<div class="art-cote-note">${esc(c.segment)}</div>` : ''}
        ${c.note ? `<div class="art-cote-note">${esc(c.note)}</div>` : ''}
      </div>
      <div class="art-cote-trend">
        <span class="art-cote-trend-arrow">${tendance ? tendance.split(' ')[0] : '—'}</span>
        <span class="art-cote-trend-word">${tendance ? tendance.split(' ')[1] : 'stable'}</span>
        ${tendance ? '<span class="art-cote-trend-seg">segment</span>' : ''}
      </div>
    </section>`;
}

// 3. Notice (métier, formation, ateliers, musées, décors — éditorial, dossier IA/humain).
// Rebaptisée depuis « Identité » par HO-148 : ce titre désigne désormais le
// bloc structuré (type/pays/région/catégories, colonnes artistes) rendu par
// identite.js juste au-dessus — deux blocs « Identité » adjacents auraient
// prêté à confusion pour Alain.
function rendreNotice(id) {
  const keys = [
    { k: 'metier', label: 'Métier' },
    { k: 'formation', label: 'Formation' },
    { k: 'ateliers', label: 'Ateliers' },
    { k: 'musees', label: 'Musées' },
    { k: 'decors', label: 'Décors' },
  ];
  const lignes = keys.filter(({ k }) => {
    const v = id[k];
    return Array.isArray(v) ? v.length : (v != null && String(v).trim());
  });
  if (!lignes.length) return '';

  return `
    <section class="art-identite" aria-label="Notice">
      ${lignes.map(({ k, label }) => {
        const v = id[k];
        const val = Array.isArray(v)
          ? (k === 'decors'
              ? `<span class="art-id-chips">${v.map((d, i) => `<span class="art-id-chip ${i === 0 ? 'active' : ''}">${esc(d)}</span>`).join('')}</span>`
              : esc(v.join(' · ')))
          : esc(v);
        return `<div class="art-id-row"><span class="art-id-label">${esc(label)}</span><span class="art-id-value">${val}</span></div>`;
      }).join('')}
    </section>`;
}

// 4. Signature de référence
function rendreSignature(d) {
  const img = A.images.find(p => p.zone === 'signature') || A.signatures[0];
  const ref = d.signature_ref ?? {};
  const hasText = ref.transcription || (Array.isArray(ref.variantes) && ref.variantes.length);
  if (!img && !hasText) return '';

  return `
    <section class="art-signature" aria-label="Signature de référence">
      <div class="art-signature-head">
        <span>Signature de référence</span>
        <span class="art-signature-hint">à comparer au revers</span>
      </div>
      <div class="art-signature-body">
        ${img ? `<div class="art-signature-img" data-action="${img.objetId ? 'zoom-signature' : 'zoom-artiste-photo'}" data-pid="${esc(img.id)}" data-oid="${esc(img.objetId ?? '')}"><img src="${esc(img.thumbUrl || img.url)}" alt="" loading="lazy" decoding="async"></div>` : ''}
        <div class="art-signature-txt">
          ${ref.transcription ? `<div class="art-signature-trans">${esc(ref.transcription)}</div>` : ''}
          ${Array.isArray(ref.variantes) && ref.variantes.length ? `<div class="art-signature-var">Variantes d'atelier : ${ref.variantes.map(esc).join(' · ')}</div>` : ''}
        </div>
      </div>
    </section>`;
}

// 5. Parcours
function rendreParcours(d) {
  const bio = A.artiste?.bio_md ?? '';
  const reperes = d.reperes ?? [];
  if (!bio.trim() && !reperes.length) return '';
  const bioLong = bio.length > 600;

  return `
    <section class="art-parcours" aria-label="Parcours">
      ${bio
        ? (bioLong
            ? `<details class="art-bio acc"><summary><span>Parcours</span><span>▾</span></summary><div class="art-bio-body">${mdToHtml(bio)}</div></details>`
            : `<div class="art-bio-body">${mdToHtml(bio)}</div>`)
        : ''}
      ${reperes.length ? `<div class="art-frise">${reperes.map((r, i) => {
        const last = i === reperes.length - 1;
        return `<div class="art-frise-item">
          <div class="art-frise-year ${last ? 'last' : ''}">${esc(r.annee)}</div>
          <div class="art-frise-dot ${last ? 'last' : ''}"></div>
          <div class="art-frise-text ${last ? 'last' : ''}">${esc(r.texte)}</div>
        </div>`;
      }).join('')}</div>` : ''}
    </section>`;
}

// 7. Contrefaçons & confusions
function rendreAlertes(d) {
  const alertes = d.alertes ?? [];
  if (!alertes.length) return '';

  return `
    <section class="art-alertes" aria-label="Contrefaçons et confusions">
      <div class="art-alertes-puce"></div>
      <div class="art-alertes-body">
        <div class="art-alertes-head">
          <span>Contrefaçons &amp; confusions</span>
          <span class="art-alertes-pill">démarquer</span>
        </div>
        ${alertes.map(al => `<div class="art-alerte-text">${esc(al.texte)}</div>`).join('')}
      </div>
    </section>`;
}

// 10. Presse & références
function rendrePresse(d) {
  const presse = d.presse ?? [];
  if (!presse.length) return '';
  const aff = presse.slice(0, 3);
  const cache = presse.slice(3);

  function ligneHtml(p) {
    const meta = [esc(p.source ?? ''), p.date ? fmtDate(p.date) : ''].filter(Boolean).join(' · ');
    return `
      <div class="art-presse-row">
        <div class="art-presse-main">
          <div class="art-presse-title">${esc(p.titre)}</div>
          <div class="art-presse-meta">${meta}</div>
        </div>
        ${p.url
          ? `<a class="art-presse-link" href="${esc(p.url)}" target="_blank" rel="noopener">↗</a>`
          : `<span class="art-presse-link">note</span>`}
      </div>`;
  }

  return `
    <section class="art-presse" aria-label="Presse et références">
      <div class="art-section-head">
        <span>Presse &amp; références</span>
        <span class="art-section-meta">${presse.length}</span>
      </div>
      ${aff.map(ligneHtml).join('')}
      ${cache.length ? `<details class="art-presse-more acc"><summary>voir les ${presse.length}</summary>${cache.map(ligneHtml).join('')}</details>` : ''}
    </section>`;
}
