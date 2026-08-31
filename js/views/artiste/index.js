// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/index.js : hub fiche artiste (écran 3a).
//
// Point d'entrée de la vue artiste. Charge son propre CSS, exporte mountList()
// (liste conservée) et mountDetail(nom) (hub 3a). Navigation interne posée
// pour les sous-écrans futurs (HO-053). Délégation data-action sur #artiste-body.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, emptyHtml } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import { auteurMatch, fmtDate } from '../../core/format.js';
import { sb, signPaths, logEvent, ensureCollection, loadPhotoMap } from '../../core/data.js';
import { toast, enregistrer, humaniser } from '../../core/feedback.js';
import { openViewer } from '../../core/lightbox.js';
import { loadViewCss } from '../../core/css.js';
import { page } from '../../ui/page.js';
import { texte } from '../../ui/texte.js';
import { A, hooks } from './etat.js';
import { insererArtistePhoto } from './uploads.js';
import { rendreFiche } from './blocs.js';

await loadViewCss('artistes');

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
  if (error) { console.warn('artiste:', error); toast(`Fiche artiste non chargée — ${humaniser(error)}.`, 'panne'); corps.innerHTML = ''; return; }
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
  if (A.nom && A.nom !== nom) A.pendingPhotos = [];
  A.nom = nom;
  A.ecran = 'fiche';
  A.focus = null;
  // pendingPhotos n'est pas réinitialisé ici : il survit au rechargement après
  // l'ajout d'une photo jointe, jusqu'à l'envoi de la note.

  await ensureCollection();
  if (S.collection.length && !Object.keys(S.photoMap).length) await loadPhotoMap();

  const { data: a, error } = await sb.from('artistes').select('*').eq('owner_id', S.tenantId).eq('nom', nom).maybeSingle();
  if (error) { console.warn('artiste:', error); toast(`Fiche artiste non chargée — ${humaniser(error)}.`, 'panne'); body.innerHTML = ''; return; }

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
    sur: { enregistrer: ajouterNote, annuler: () => { A.pendingPhotos = []; hooks.rendre?.(); } },
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
  if (!texteNote && !A.pendingPhotos.length) {
    toast('Tape une note ou ajoute une photo', true);
    return;
  }
  if (!await enregistrer(() => sb.from('artistes_notes').insert({
    owner_id: S.tenantId,
    artiste_nom: A.nom,
    auteur: 'humain',
    texte: texteNote || null,
    photos: A.pendingPhotos,
  }), 'Note')) return;
  logEvent('artiste_note', { artiste: A.nom }, null);
  A.pendingPhotos = [];
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
      A.pendingPhotos.push(id);
      await loadArtiste(A.nom);
    }
  }
});
