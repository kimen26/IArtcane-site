// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artistes.js : fiches artistes (table `artistes`, migration 0008)
// Deux écrans : liste (#/artistes) + détail (#/artiste/:nom) avec objets liés,
// photos/signature attachées (table `artistes_photos`) et bio markdown.
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast, emptyHtml } from '../core/dom.js';
import { S, canWrite } from '../core/state.js';
import { auteurMatch, cardHtml, fmtDate, mdToHtml } from '../core/format.js';
import { sb, signPaths, logEvent, makeThumbBlob, ensureCollection, loadPhotoMap } from '../core/data.js';

let currentArtisteNom = null;
let currentArtistePhotos = [];

export function mountList() {
  loadArtistes();
}

export function mountDetail(nom) {
  loadArtiste(nom);
}

// ─── Artistes : liste des fiches ─────────────────────────────────────────────
async function loadArtistes() {
  const body = $('#artistes-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const [{ data, error }] = await Promise.all([
    sb.from('artistes').select('*').eq('owner_id', S.tenantId).order('nom'),
    ensureCollection(),
  ]);
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  if (!data?.length) {
    body.innerHTML = emptyHtml('Aucune fiche artiste pour l\'instant', 'Le cron les crée lors des passes d\'identification.');
    return;
  }
  const nbObjets = nom => S.collection.filter(o => auteurMatch(o.auteur, nom)).length;
  body.innerHTML = `<div class="grid">${data.map(a => {
    // Extrait texte brut : on démarque le markdown SANS toucher aux tirets
    // intra-mots (« hauts-de-Seine ») — seuls les tirets de puce en début de
    // ligne sont supprimés. Coupe propre à ~220 car. (pas de mot tronqué).
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
  $$('.card', body).forEach(c => c.addEventListener('click', () => {
    location.hash = '#/artiste/' + encodeURIComponent(c.dataset.nom);
  }));
}

// ─── Artiste (détail) : bio complète + objets liés de la collection ─────────
async function loadArtiste(nom) {
  const body = $('#artiste-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  currentArtisteNom = nom;
  await ensureCollection();
  const { data: a, error } = await sb.from('artistes').select('*').eq('owner_id', S.tenantId).eq('nom', nom).maybeSingle();
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  if (S.collection.length && !Object.keys(S.photoMap).length) await loadPhotoMap();
  // Photos attachées à la fiche artiste (portrait, signature, œuvre, fiche…)
  const { data: apRows } = await sb.from('artistes_photos')
    .select('*').eq('owner_id', S.tenantId).eq('artiste_nom', nom).order('created_at');
  const apPaths = (apRows ?? []).flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean));
  const apUrls = await signPaths(apPaths);
  currentArtistePhotos = (apRows ?? []).map(p => ({
    ...p,
    url: apUrls[p.storage_path],
    thumbUrl: apUrls[p.thumb_path ?? p.storage_path],
  }));
  const objets = S.collection.filter(o => auteurMatch(o.auteur, nom));
  // Galerie « œuvres » : miniatures (thumb_path via photoMap) des objets liés,
  // en rangée scrollable sous l'en-tête — la reconnaissance visuelle d'abord.
  const oeuvres = objets.filter(o => S.photoMap[o.id]?.url);
  const galerie = oeuvres.length ? `
    <div class="art-gal">${oeuvres.map(o => {
      const img = S.photoMap[o.id];
      return `<button class="art-gal-item" data-oid="${esc(o.id)}" title="${esc(o.titre || 'Objet')} — fiche #${esc(o.id)}" aria-label="${esc(o.titre || 'Objet')} — fiche #${esc(o.id)}">
        <img src="${esc(img.url)}" alt="${esc(o.titre || 'Œuvre de la collection')}" loading="lazy" decoding="async" style="object-position:${img.fx ?? 50}% ${img.fy ?? 50}%">
      </button>`;
    }).join('')}</div>` : '';
  const photosPanel = `
    <div class="panel panel-pad">
      <div class="sec-title">Fichiers & images</div>
      ${canWrite() ? `<div class="actions" style="margin-bottom:12px"><button class="btn small" data-action="add-artiste-photo">🖼️ Ajouter une photo</button></div>` : ''}
      ${currentArtistePhotos.length ? `<div class="art-gal art-gal-files">${currentArtistePhotos.map(p => `
        <div class="art-gal-item" data-action="zoom-artiste-photo" data-pid="${esc(p.id)}" tabindex="0" role="button" title="${esc(p.kind)}${p.caption ? ' — ' + esc(p.caption) : ''}">
          <img src="${esc(p.thumbUrl || p.url)}" alt="${esc(p.kind)}" loading="lazy" decoding="async">
          ${canWrite() ? `<button class="art-gal-del" data-action="del-artiste-photo" data-pid="${esc(p.id)}" title="Supprimer">✕</button>` : ''}
        </div>
      `).join('')}</div>` : '<div class="value-sub">Aucune photo, signature ou fiche pour cet artiste.</div>'}
    </div>`;
  const bioPanel = a ? `
    <details class="panel panel-pad acc" open>
      <summary class="sec-title">Biographie</summary>
      <div class="md-body">${mdToHtml(a.bio_md ?? '')}</div>
    </details>` : `
    <div class="panel panel-pad">
      <div class="sec-title">Biographie</div>
      <div class="value-sub">Pas encore de fiche artiste — le cron la crée lors des passes d'identification.</div>
    </div>`;
  // En-tête structuré : nom + badges méta (objets liés, fraîcheur de la fiche)
  body.innerHTML = `
    <div class="art-head">
      <h1 class="obj-title">🎨 ${esc(a?.nom ?? nom)}</h1>
      <div class="art-badges">
        <span class="badge-soft">${objets.length} objet${objets.length > 1 ? 's' : ''} lié${objets.length > 1 ? 's' : ''}</span>
        ${a ? `<span class="badge-soft">Fiche maj le ${fmtDate(a.updated_at)}</span>` : ''}
      </div>
    </div>
    ${photosPanel}
    ${galerie ? `<div class="sec-title" style="margin-top:26px">Œuvres de la collection</div>${galerie}` : ''}
    ${bioPanel}
    <div class="sec-title" style="margin-top:26px">Objets de la collection <span style="font-family:var(--mono);font-size:.8125rem;color:var(--ink-3);font-weight:400">${objets.length}</span></div>
    ${objets.length
      ? `<div class="grid">${objets.map(cardHtml).join('')}</div>`
      : '<div class="value-sub">Aucun objet rattaché à cet artiste pour l\'instant.</div>'}`;
  $$('.art-gal-item[data-oid]', body).forEach(b => b.addEventListener('click', () => {
    location.hash = '#/objet/' + encodeURIComponent(b.dataset.oid);
  }));
  $$('.card', body).forEach(c => {
    const go = () => { location.hash = '#/objet/' + encodeURIComponent(c.dataset.oid); };
    c.addEventListener('click', go);
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// ─── Photos attachées à une fiche artiste (portrait, signature, œuvre, fiche) ─
async function uploadArtistePhoto(file) {
  if (!currentArtisteNom || !canWrite()) return;
  const nom = currentArtisteNom;
  // La fiche artiste doit exister pour la FK — on la crée si besoin.
  const { data: a } = await sb.from('artistes').select('nom').eq('owner_id', S.tenantId).eq('nom', nom).maybeSingle();
  if (!a) {
    const { error: ec } = await sb.from('artistes').insert({ owner_id: S.tenantId, nom, bio_md: '' });
    if (ec) { toast(`Création fiche artiste : ${ec.message}`, true); return; }
  }
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const id = crypto.randomUUID();
  const path = `${S.tenantId}/artistes/${id}.${ext}`;
  const { error: e1 } = await sb.storage.from('photos').upload(path, file, { contentType: file.type || undefined });
  if (e1) { toast(`Upload : ${e1.message}`, true); return; }
  const tb = await makeThumbBlob(file);
  let thumbPath = null;
  if (tb) {
    thumbPath = `${S.tenantId}/artistes/${id}.thumb.jpg`;
    const { error: et } = await sb.storage.from('photos').upload(thumbPath, tb, { contentType: 'image/jpeg' });
    if (et) thumbPath = null;
  }
  const { error: e2 } = await sb.from('artistes_photos').insert({
    owner_id: S.tenantId,
    artiste_nom: nom,
    storage_path: path,
    thumb_path: thumbPath,
    kind: 'autre',
  });
  if (e2) { toast(e2.message, true); return; }
  logEvent('artiste_photo_ajoutee', { artiste: nom }, null);
  toast('Photo ajoutée à la fiche artiste');
  await loadArtiste(nom);
}

async function deleteArtistePhoto(pid) {
  if (!currentArtisteNom || !canWrite()) return;
  const p = currentArtistePhotos.find(x => String(x.id) === String(pid));
  if (!p) return;
  if (!confirm('Supprimer cette photo de la fiche artiste ?')) return;
  const { error } = await sb.from('artistes_photos').delete()
    .eq('owner_id', S.tenantId).eq('id', pid);
  if (error) { toast(error.message, true); return; }
  await sb.storage.from('photos').remove([p.storage_path, p.thumb_path].filter(Boolean));
  logEvent('artiste_photo_supprimee', { artiste: currentArtisteNom }, null);
  toast('Photo supprimée');
  await loadArtiste(currentArtisteNom);
}

// ─── Actions de la vue Artiste (délégation) ─────────────────────────────────
function openArtistePhotoLightbox(pid) {
  const p = currentArtistePhotos.find(x => String(x.id) === String(pid));
  if (!p?.url) return;
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${esc(p.url)}" alt="${esc(p.kind)}" loading="eager">`;
  const close = () => { lb.remove(); document.body.classList.remove('lb-open'); };
  lb.addEventListener('click', close);
  document.body.classList.add('lb-open');
  document.body.append(lb);
}

$('#artiste-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if ((act === 'add-artiste-photo' || act === 'del-artiste-photo') && !canWrite()) return;
  if (act === 'add-artiste-photo') {
    $('#file-artiste-photo').click();
  } else if (act === 'del-artiste-photo') {
    e.stopPropagation();
    await deleteArtistePhoto(el.dataset.pid);
  } else if (act === 'zoom-artiste-photo') {
    openArtistePhotoLightbox(el.dataset.pid);
  }
});

$('#file-artiste-photo').addEventListener('change', async e => {
  if (!canWrite()) { e.target.value = ''; return; }
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) await uploadArtistePhoto(f);
});
