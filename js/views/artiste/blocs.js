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

function dossier() {
  return A.artiste?.dossier ?? {};
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
    rendreCote(d),
    rendreIdentite(id),
    rendreSignature(d),
    rendreParcours(d),
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

// 3. Identité
function rendreIdentite(id) {
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
    <section class="art-identite" aria-label="Identité">
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
