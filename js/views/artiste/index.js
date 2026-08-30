// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/index.js : hub fiche artiste (écran 3a).
//
// Point d'entrée de la vue artiste. Charge son propre CSS, exporte mountList()
// (liste conservée) et mountDetail(nom) (hub 3a). Navigation interne posée
// pour les sous-écrans futurs (HO-053). Délégation data-action sur #artiste-body.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, emptyHtml } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import { auteurMatch, cardHtml, fmtDate, fmtNum, mdToHtml } from '../../core/format.js';
import { sb, signPaths, logEvent, ensureCollection, loadPhotoMap } from '../../core/data.js';
import { toast, enregistrer } from '../../core/feedback.js';
import { openViewer } from '../../core/lightbox.js';
import { loadViewCss } from '../../core/css.js';
import { page } from '../../ui/page.js';
import { texte } from '../../ui/texte.js';
import { A, hooks } from './etat.js';
import { insererArtistePhoto } from './uploads.js';

await loadViewCss('artistes');

// Photos jointées en cours de rédaction dans le composeur de notes.
let pendingPhotos = [];
let filePickerTarget = 'note'; // 'note' | 'quick'

export function mountList() {
  loadArtistesList();
}

export function mountDetail(nom) {
  loadArtiste(nom);
}

// ─── Liste des fiches artistes (#/artistes) ─────────────────────────────────
async function loadArtistesList() {
  const el = $('#artistes-body');
  el.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const [{ data, error }] = await Promise.all([
    sb.from('artistes').select('*').eq('owner_id', S.tenantId).order('nom'),
    ensureCollection(),
  ]);
  const corps = page(el, { titre: 'Artistes', fil: S.fil });
  if (error) { toast(error.message, true); corps.innerHTML = ''; return; }
  if (!data?.length) {
    corps.innerHTML = emptyHtml('Aucune fiche artiste pour l\'instant', 'Le cron les crée lors des passes d\'identification.');
    return;
  }
  const nbObjets = nom => S.collection.filter(o => auteurMatch(o.auteur, nom)).length;
  corps.innerHTML = `<div class="grid">${data.map(a => {
    const extrait = String(a.bio_md ?? '')
      .replace(/^\s*#{1,4}\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/[*`>_]/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ').trim();
    const court = extrait.length > 220 ? extrait.slice(0, 220).replace(/\s+\S*$/, '') + '…' : extrait;
    const n = nbObjets(a.nom);
    return `<article class="card" data-nom="${esc(a.nom)}">
      <div class="card-body">
        <div class="card-title">🎨 ${esc(a.nom)}</div>
        <div class="card-meta art-extrait">${esc(court)}</div>
        <div class="card-foot"><span class="price none">${n} objet${n > 1 ? 's' : ''} lié${n > 1 ? 's' : ''}</span><span class="conf-label">maj ${fmtDate(a.updated_at)}</span></div>
      </div>
    </article>`;
  }).join('')}</div>`;
  $$('.card', corps).forEach(c => c.addEventListener('click', () => {
    location.hash = '#/artiste/' + encodeURIComponent(c.dataset.nom);
  }));
}

// ─── Détail artiste (hub 3a) ───────────────────────────────────────────────
async function loadArtiste(nom) {
  const body = $('#artiste-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  // Si on change d'artiste, on abandonne les photos en cours de composition.
  if (A.nom && A.nom !== nom) pendingPhotos = [];
  A.nom = nom;
  A.ecran = 'fiche';
  A.focus = null;
  // pendingPhotos n'est pas réinitialisé ici : il survit au rechargement après
  // l'ajout d'une photo jointe, jusqu'à l'envoi de la note.

  await ensureCollection();
  if (S.collection.length && !Object.keys(S.photoMap).length) await loadPhotoMap();

  const { data: a, error } = await sb.from('artistes').select('*').eq('owner_id', S.tenantId).eq('nom', nom).maybeSingle();
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }

  const objets = S.collection.filter(o => auteurMatch(o.auteur, nom));
  const idsObjets = objets.map(o => o.id);

  // Requêtes parallèles
  const [apRes, compRes, sigRes, notesRes] = await Promise.all([
    sb.from('artistes_photos').select('*').eq('owner_id', S.tenantId).eq('artiste_nom', nom)
      .order('ordre', { nullsFirst: false }).order('created_at'),
    idsObjets.length
      ? sb.from('comparables').select('*').eq('owner_id', S.tenantId).in('objet_id', idsObjets)
          .eq('source_type', 'adjudication').eq('exclu', false)
          .order('date_vente', { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    idsObjets.length
      ? sb.from('photos').select('id,objet_id,storage_path,thumb_path,kind,created_at')
          .eq('owner_id', S.tenantId).in('objet_id', idsObjets).eq('kind', 'signature')
          .order('created_at')
      : Promise.resolve({ data: [] }),
    sb.from('artistes_notes').select('*').eq('owner_id', S.tenantId).eq('artiste_nom', nom)
      .order('created_at', { ascending: true }),
  ]);

  const apRows = apRes.data ?? [];
  const compRows = compRes.data ?? [];
  const sigRows = sigRes.data ?? [];

  const allPaths = [
    ...apRows.flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean)),
    ...compRows.map(c => c.image_path).filter(Boolean),
    ...sigRows.flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean)),
  ];
  const urlByPath = allPaths.length ? await signPaths(allPaths) : {};

  A.artiste = a;
  A.images = apRows.map(p => ({
    ...p,
    url: urlByPath[p.storage_path],
    thumbUrl: urlByPath[p.thumb_path ?? p.storage_path],
  }));
  A.objets = objets;
  A.ventes = compRows;
  A.signatures = sigRows.map(p => ({
    ...p,
    url: urlByPath[p.storage_path],
    thumbUrl: urlByPath[p.thumb_path ?? p.storage_path],
    objetId: p.objet_id,
  }));
  A.notes = notesRes.data ?? [];

  renderArtiste();
}

// ─── Rendu du hub ───────────────────────────────────────────────────────────
function renderArtiste() {
  const body = $('#artiste-body');
  if (A.ecran === 'fiche') {
    const a = A.artiste;
    const corps = page(body, {
      titre: a?.nom ?? A.nom,
      meta: `${A.objets.length} objet${A.objets.length > 1 ? 's' : ''}`,
      fil: S.fil,
      barre: {
        actions: [
          { label: `Voir les ${A.objets.length} objet${A.objets.length > 1 ? 's' : ''}`, type: 'primaire', onClick: () => $('#art-objets')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
          ...(canWrite() ? [
            { label: '✎ Note', type: 'plat', onClick: () => { $('#art-composer-texte')?.querySelector('.ui-texte-textarea')?.focus(); $('#art-composer')?.classList.add('focused'); } },
            { label: `🖼 Images · ${A.images.length}`, type: 'plat', onClick: () => hooks.naviguer('images') },
          ] : []),
        ],
      },
    });
    corps.innerHTML = rendreFiche();
    brancherJournal(corps);
    // Les cartes objet rendues par cardHtml n’ont pas de data-action ; on les
    // rend cliquables ici (même comportement que l’ancien artistes.js).
    $$('.card[data-oid]', corps).forEach(c => {
      const go = () => { location.hash = '#/objet/' + encodeURIComponent(c.dataset.oid); };
      c.addEventListener('click', go);
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    return;
  }
  // Sous-écrans (HO-053) : chargement dynamique de la vue interne.
  if (A.ecran === 'images') {
    import('./images.js').then(m => m.rendre()).catch(err => {
      console.error('HO-053 images.js:', err);
      toast('Écran Images injoignable', true);
    });
    return;
  }
}

// Branche les entrées du journal et le composeur sur ui/texte.js — appelé
// après l'insertion HTML (rendreFiche()), texte() a besoin d'éléments DOM
// réels pour s'y brancher (mic, boutons Annuler/Enregistrer).
function brancherJournal(corps) {
  A.notes.forEach((n, i) => {
    const slot = corps.querySelector(`.art-note-slot[data-note-idx="${i}"]`);
    if (!slot) return;
    const imgs = (n.photos ?? []).map(pid => A.images.find(im => im.id === pid)).filter(Boolean);
    texte(slot, {
      titre: fmtDate(n.created_at), tag: n.auteur === 'humain' ? 'toi' : 'IA',
      contenu: n.texte ?? '', vide: imgs.length ? 'Photo jointe.' : 'Note vide.', mode: 'lecture',
    });
    if (imgs.length) slot.insertAdjacentHTML('beforeend', `<div class="art-note-photos">${imgs.map(p =>
      `<button class="art-note-thumb" data-action="zoom-note-photo" data-pid="${esc(p.id)}"><img src="${esc(p.thumbUrl || p.url)}" alt="" loading="lazy" decoding="async"></button>`
    ).join('')}</div>`);
  });

  const cible = corps.querySelector('#art-composer-texte');
  if (cible) texte(cible, {
    contenu: '', mode: 'edition', micro: true, lignes: 2,
    enregistrerSiIdentique: true, // composeur : une note « photo seule » (rien tapé) doit partir — ajouterNote() garde « ni texte ni photo »
    sur: { enregistrer: ajouterNote, annuler: () => { pendingPhotos = []; hooks.rendre?.(); } },
  });
}

// ─── Navigation interne ─────────────────────────────────────────────────────
function naviguer(ecran, focus = null) {
  A.ecran = ecran;
  A.focus = focus;
  if (ecran === 'fiche') {
    // Retour depuis un sous-écran : recharger pour refléter les zones fraîches.
    loadArtiste(A.nom);
    return;
  }
  renderArtiste();
}

hooks.recharger = loadArtiste;
hooks.naviguer = naviguer;
hooks.rendre = renderArtiste;

// ─── Helpers de données ─────────────────────────────────────────────────────
function dossier() {
  return A.artiste?.dossier ?? {};
}

function identite() {
  return dossier().identite ?? {};
}

// ─── Rendu HTML du hub 3a ───────────────────────────────────────────────────
function rendreFiche() {
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

// 6. Ventes vérifiées
function rendreVentes() {
  if (!A.ventes.length) return '';
  const focusId = A.focus?.objetId;
  const affichees = A.ventes.slice(0, 3);
  const cachees = A.ventes.slice(3);

  function ligneHtml(v, highlighted = false) {
    const prix = v.prix != null ? `${fmtNum(v.prix)} €` : '';
    const estim = (v.estimation_bas != null && v.estimation_haut != null)
      ? `est. ${fmtNum(v.estimation_bas)}–${fmtNum(v.estimation_haut)}`
      : '';
    const dateStr = v.date_vente ? fmtDate(v.date_vente) : '—';
    const lot = v.lot ? esc(v.lot) : 'Lot sans titre';
    const meta = [esc(v.maison ?? ''), dateStr].filter(Boolean).join(' · ');
    return `
      <div class="art-vente-row ${highlighted ? 'highlight' : ''}">
        <div class="art-vente-main">
          <div class="art-vente-title">${lot}</div>
          <div class="art-vente-meta">${meta}</div>
        </div>
        <div class="art-vente-price">
          <div>${prix}</div>
          ${estim ? `<div class="art-vente-est">${estim}</div>` : ''}
        </div>
      </div>`;
  }

  return `
    <section class="art-ventes" aria-label="Ventes vérifiées">
      <div class="art-section-head">
        <span>Ventes vérifiées</span>
        <span class="art-section-meta">${A.ventes.length} · liens au procès-verbal</span>
      </div>
      ${affichees.map(v => ligneHtml(v, focusId && v.objet_id === focusId)).join('')}
      ${cachees.length ? `<details class="art-ventes-more acc"><summary>voir les ${A.ventes.length}</summary>${cachees.map(v => ligneHtml(v, focusId && v.objet_id === focusId)).join('')}</details>` : ''}
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

// 8. Chez toi
function rendreChezToi() {
  const objetsAffiches = A.objets.slice(0, 2);
  const avecPrix = A.objets.filter(o => o.prix_bas != null);
  let estimHtml = '';
  if (avecPrix.length) {
    const bas = avecPrix.reduce((s, o) => s + Number(o.prix_bas), 0);
    const haut = avecPrix.reduce((s, o) => s + Number(o.prix_haut ?? o.prix_bas), 0);
    estimHtml = `<div class="art-chez-estim"><div class="art-chez-estim-value">${fmtNum(bas)}–${fmtNum(haut)} €</div><div class="art-chez-estim-label">estimation cumulée</div></div>`;
  }

  const objetsHtml = objetsAffiches.map(o => {
    const img = S.photoMap[o.id];
    return `<div class="art-chez-obj" data-action="nav-objet" data-oid="${esc(o.id)}">
      ${img?.url ? `<img src="${esc(img.url)}" alt="" loading="lazy" decoding="async">` : `<span class="art-chez-noimg">${o.categorie ? esc(o.categorie.charAt(0)) : '•'}</span>`}
      <div class="art-chez-obj-id">#${esc(o.id)} · ${esc(o.titre || 'objet')}</div>
    </div>`;
  }).join('');

  const objetsSansSig = A.objets.filter(o => !A.signatures.some(s => s.objetId === o.id));
  const signaturesHtml = A.signatures.map(s => `
    <div class="art-chez-sigcase" data-action="zoom-signature" data-pid="${esc(s.id)}" data-oid="${esc(s.objetId)}">
      <img src="${esc(s.thumbUrl || s.url)}" alt="" loading="lazy" decoding="async">
      <div class="art-chez-sigcode">#${esc(s.objetId)}<br>${esc(s.transcription || '')}</div>
    </div>`).join('');

  const releverHtml = objetsSansSig.length ? `
    <div class="art-chez-relever-wrap">
      <button class="art-chez-relever" data-action="show-relever">
        <span>＋</span><span>relever</span>
      </button>
      <div class="art-chez-relever-menu hidden">
        ${objetsSansSig.map(o => `<button data-action="nav-objet" data-oid="${esc(o.id)}">#${esc(o.id)} · ${esc(o.titre || 'objet')}</button>`).join('')}
      </div>
    </div>` : '';

  return `
    <section class="art-cheztoi" aria-label="Chez toi">
      <div class="art-section-head">
        <span>Chez toi</span>
        <span class="art-section-meta">${A.objets.length} objet${A.objets.length > 1 ? 's' : ''}${avecPrix.length ? ` · ${avecPrix.length} à valider` : ''}</span>
      </div>
      <div class="art-chez-objets">
        ${objetsHtml}
        ${estimHtml}
      </div>
      ${A.signatures.length || objetsSansSig.length ? `
        <div class="art-chez-sigs">
          <div class="art-chez-sigs-head">
            <span>Signatures relevées chez toi</span>
            ${A.signatures.length ? `<button class="art-chez-sigs-compare" data-action="comparer-signatures">comparer ›</button>` : ''}
          </div>
          <div class="art-chez-siggrid">
            ${signaturesHtml}${releverHtml}
          </div>
        </div>` : ''}
    </section>`;
}

// 9. Galerie externe
function rendreExterne() {
  const imgs = A.images.filter(p => p.zone === 'externe');
  if (!imgs.length) return '';

  return `
    <section class="art-externe" aria-label="Galerie externe">
      <div class="art-section-head">
        <span>Galerie externe</span>
        <span class="art-section-meta">ni vente, ni chez toi · ${imgs.length}</span>
      </div>
      <div class="art-ext-grid">
        ${imgs.map(p => `
          <div class="art-ext-item" data-action="zoom-artiste-photo" data-pid="${esc(p.id)}">
            <img src="${esc(p.thumbUrl || p.url)}" alt="" loading="lazy" decoding="async">
            <div class="art-ext-caption">${esc(p.caption || p.commentaire || '')}</div>
          </div>`).join('')}
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

// 11. Notes & journal — les entrées et le composeur sont des coquilles vides
// ici (texte() a besoin d'éléments DOM réels pour se brancher) : voir
// brancherJournal(), appelé juste après l'insertion de ce HTML.
function rendreJournal() {
  const composer = canWrite() ? `
    <div class="art-composer" id="art-composer">
      <div id="art-composer-texte"></div>
      <button class="art-composer-photo" type="button" title="Joindre une photo" data-action="attach-photo">📷</button>
    </div>` : '';

  const pendingThumbs = pendingPhotos.map(pid => {
    const p = A.images.find(i => i.id === pid);
    return p ? `<div class="art-pending-thumb"><img src="${esc(p.thumbUrl || p.url)}" alt=""></div>` : `<div class="art-pending-thumb art-pending-loading"></div>`;
  }).join('');

  const notesHtml = A.notes.length
    ? A.notes.map((n, i) => `<div class="art-note-slot" data-note-idx="${i}"></div>`).join('')
    : '<div class="art-empty-note">Aucune note pour l\'instant.</div>';

  return `
    <section class="art-journal" aria-label="Notes et journal">
      <div class="art-section-head"><span>Notes &amp; journal</span><span class="art-section-meta">jamais réécrit par l'IA</span></div>
      <div class="art-notes">${notesHtml}</div>
      ${composer}
      ${pendingThumbs ? `<div class="art-pending-photos">${pendingThumbs}</div>` : ''}
    </section>`;
}

// ─── Actions de la vue Artiste (délégation) ─────────────────────────────────
function openArtistePhoto(pid) {
  const p = A.images.find(i => String(i.id) === String(pid));
  if (!p?.url) return;
  openViewer({ src: p.url, alt: `Photo — ${A.nom ?? 'artiste'}` });
}

function openSignature(pid) {
  const p = A.signatures.find(s => String(s.id) === String(pid));
  if (!p?.url) return;
  openViewer({ src: p.url, alt: `Signature relevée sur #${p.objetId}` });
}

$('#artiste-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (!act) return;

  // Actions mutantes protégées en lecture seule
  if ((['attach-photo', 'quick-photo'].includes(act)) && !canWrite()) return;

  if (act === 'nav-objet') {
    location.hash = '#/objet/' + encodeURIComponent(el.dataset.oid);
  } else if (act === 'zoom-artiste-photo') {
    e.stopPropagation();
    openArtistePhoto(el.dataset.pid);
  } else if (act === 'zoom-signature') {
    e.stopPropagation();
    openSignature(el.dataset.pid);
  } else if (act === 'zoom-note-photo') {
    e.stopPropagation();
    openArtistePhoto(el.dataset.pid);
  } else if (act === 'comparer-signatures') {
    e.stopPropagation();
    const first = A.signatures[0];
    if (first) openSignature(first.id);
  } else if (act === 'show-relever') {
    e.stopPropagation();
    const menu = el.closest('.art-chez-relever-wrap')?.querySelector('.art-chez-relever-menu');
    if (menu) menu.classList.toggle('hidden');
  } else if (act === 'attach-photo') {
    filePickerTarget = 'note';
    $('#file-artiste-photo').click();
  } else if (act === 'quick-photo') {
    filePickerTarget = 'quick';
    $('#file-artiste-photo').click();
  }

  // Clic sur une carte objet de la collection (cardHtml n'ajoute pas data-action).
  const card = el.closest('.card[data-oid]');
  if (card) {
    location.hash = '#/objet/' + encodeURIComponent(card.dataset.oid);
  }
});

// ─── Upload d'une photo (note ou image rapide) ───────────────────────────────
// uploadArtistePhoto/insererArtistePhoto vivent dans uploads.js (HO-078) —
// duplication avec images.js absorbée là, sous withBusy.

async function ajouterNote(saisie) {
  const texteNote = (saisie ?? '').trim();
  if (!texteNote && !pendingPhotos.length) {
    toast('Tape une note ou ajoute une photo', true);
    return;
  }
  if (!await enregistrer(() => sb.from('artistes_notes').insert({
    owner_id: S.tenantId,
    artiste_nom: A.nom,
    auteur: 'humain',
    texte: texteNote || null,
    photos: pendingPhotos,
  }), 'Note')) return;
  logEvent('artiste_note', { artiste: A.nom }, null);
  pendingPhotos = [];
  await loadArtiste(A.nom);
}

// Input file caché #file-artiste-photo existe déjà dans index.html.
$('#file-artiste-photo').addEventListener('change', async e => {
  if (!canWrite()) { e.target.value = ''; return; }
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;

  if (filePickerTarget === 'quick') {
    const id = await insererArtistePhoto(files[0], null);
    if (id) {
      toast('Image ajoutée — à ranger dans Images');
      await loadArtiste(A.nom);
    }
  } else {
    const id = await insererArtistePhoto(files[0], null);
    if (id) {
      pendingPhotos.push(id);
      await loadArtiste(A.nom);
    }
  }
});
