// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/index.js : hub fiche objet + navigation interne
// vers les sous-écrans (photos, identification, ventes, description, historique).
// Point d'entrée de la vue (`mount(id)`), appelé par le routeur de app.js.
//
// Territoire découpé (D-041) :
//   • index.js          ce fichier — chargement, hub, délégation, actions
//   • photos.js         stub → galerie éditable (HO-047)
//   • identification.js stub → champs + pastilles (HO-048)
//   • ventes.js         stub → comparables + fourchette (HO-049)
//   • description.js    stub → textes IA / maison (HO-049)
//   • historique.js     journal minimal → historique enrichi (HO-049)
//   • etat.js           état partagé + helpers validation
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast, emptyHtml } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import {
  fmtNum, fmtDate, catCanon, catEmoji, infoSvg, STATUTS,
} from '../../core/format.js';
import { sb, signPaths, logEvent, lancerRecherches, enqueueJobs, purgeConsigne, uploadPhotosFor } from '../../core/data.js';
import { loadViewCss } from '../../core/css.js';
import { O, hooks, CHAMPS_VALIDABLES, estValide, toggleValidation } from './etat.js';

await loadViewCss('objet');

export function mount(id) {
  loadObjet(id);
}

async function loadObjet(id) {
  const body = $('#objet-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';
  const { data: o, error } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).eq('id', id).maybeSingle();
  if (error || !o) {
    body.innerHTML = emptyHtml('Objet introuvable', `Aucun objet #${id} dans ta collection.`);
    return;
  }
  S.currentObjet = o;
  O.ecran = 'hub';
  O.focus = null;
  const [{ data: photos }, { data: comps }, { data: fiches }, { data: events }, { data: artiste }, { data: jobs }] = await Promise.all([
    sb.from('photos').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('ordre', { nullsFirst: false }).order('created_at'),
    sb.from('comparables').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('date_vente', { ascending: false, nullsFirst: false }),
    sb.from('fiches').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('version', { ascending: false }).limit(1),
    sb.from('evenements').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('created_at', { ascending: false }).limit(50),
    o.auteur ? sb.from('artistes').select('*').eq('owner_id', S.tenantId).eq('nom', o.auteur).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('jobs').select('type,statut').eq('owner_id', S.tenantId).eq('objet_id', id).in('statut', ['en_attente','en_cours']),
  ]);
  const compPaths = (comps ?? []).map(c => c.image_path).filter(Boolean);
  const urlByPath = await signPaths([...(photos ?? []).flatMap(p => [p.storage_path, p.thumb_path].filter(Boolean)), ...compPaths]);
  O.photos = (photos ?? []).map(p => ({ ...p, url: urlByPath[p.storage_path], thumbUrl: urlByPath[p.thumb_path] ?? urlByPath[p.storage_path] }));
  O.comps = (comps ?? []).map(c => ({ ...c, imageSrc: c.image_path ? urlByPath[c.image_path] : null }));
  O.fiche = (fiches ?? [])[0] ?? null;
  O.events = events ?? [];
  O.artiste = artiste ?? null;
  O.jobs = jobs ?? [];
  O.pipe = computePipe(O.events, O.jobs, S.currentObjet);
  renderObjet();
  loadSimilar(o);
}

// Suppression d'un objet : fichiers storage puis ligne `objets` — les FK
// on delete cascade emportent photos/comparables/fiches/jobs/evenements.
async function deleteObjet() {
  const o = S.currentObjet;
  if (!o) return;
  if (!confirm(`Supprimer l'objet #${o.id} ?\n${O.photos.length} photo(s), fiche, comparables et historique partent avec — définitif.`)) return;
  const paths = O.photos.map(p => p.storage_path);
  if (paths.length) await sb.storage.from('photos').remove(paths);
  const { error } = await sb.from('objets').delete().eq('owner_id', S.tenantId).eq('id', o.id);
  if (error) { toast(error.message, true); return; }
  toast(`Objet #${o.id} supprimé`);
  location.hash = '#/';
}

// Indicateur d'avancement R1/R2/R3/Valorisation (D-057)
const R2_ACTIONS = ['lens', 'lens R2', 'grok', 'gpt', 'grok R2', 'gpt R2', 'llm_appoint'];
function computePipe(events, jobs, o) {
  const last = action => events.find(e => e.action === action)?.created_at ?? null;
  const lastR2 = events.find(e => R2_ACTIONS.includes(e.action))?.created_at ?? null;
  const pendingJob = types => jobs.some(j => types.includes(j.type) && ['en_attente', 'en_cours'].includes(j.statut));
  const r1Done = last('identification') !== null;
  const r2Done = lastR2 !== null;
  const r3Done = last('rewriting') !== null;
  const valoDone = last('passe_marche') !== null;
  return {
    r1: { state: r1Done ? 'done' : (pendingJob(['r1']) ? 'pending' : 'todo'), date: last('identification') },
    r2: { state: pendingJob(['r2', 'r2_force']) ? 'pending' : (r2Done ? 'done' : 'todo'), date: lastR2 },
    r3: { state: pendingJob(['r3']) ? 'pending' : (r3Done ? 'done' : 'todo'), date: last('rewriting') },
    valo: { state: (o?.valo_due === true || pendingJob(['valo'])) ? 'pending' : (valoDone ? 'done' : 'todo'), date: last('passe_marche') },
  };
}

function pipeBadge(short, long, { state, date }) {
  const icon = state === 'done' ? '✓' : (state === 'pending' ? '⏳' : '—');
  const cls = state === 'done' ? 'pipe-done' : (state === 'pending' ? 'pipe-pending' : 'pipe-todo');
  const title = date
    ? `${long} — ${state === 'done' ? 'terminé' : state === 'pending' ? 'en cours / en file' : 'pas encore'} le ${fmtDate(date)}`
    : `${long} — ${state === 'done' ? 'terminé' : state === 'pending' ? 'en cours / en file' : 'pas encore'}`;
  return `<span class="pipe-badge ${cls}" role="listitem" title="${esc(title)}">${icon} ${esc(short)}</span>`;
}

// Dimensions (conservé de l'ancienne fiche, D-053).
function fmtDims(o) {
  const parts = [];
  if (o.hauteur_cm != null) parts.push(`H ${o.hauteur_cm}`);
  if (o.largeur_cm != null) parts.push(`L ${o.largeur_cm}`);
  if (o.profondeur_cm != null) parts.push(`P ${o.profondeur_cm}`);
  return parts.length ? parts.join(' × ') + ' cm' : null;
}

// ─── Navigation interne ────────────────────────────────────────────────────

async function importerEcran(ecran) {
  if (ecran === 'photos') return import('./photos.js');
  if (ecran === 'identification') return import('./identification.js');
  if (ecran === 'ventes') return import('./ventes.js');
  if (ecran === 'description') return import('./description.js');
  if (ecran === 'historique') return import('./historique.js');
  return null;
}

function naviguer(ecran, focus = null) {
  O.ecran = ecran;
  O.focus = focus;
  renderObjet();
}

function renderObjet() {
  const body = $('#objet-body');
  if (O.ecran === 'hub') {
    body.innerHTML = rendreHub();
    loadSimilar(S.currentObjet);
    return;
  }
  importerEcran(O.ecran).then(mod => {
    if (mod?.rendre) mod.rendre(body);
  });
}

// ─── Hub ───────────────────────────────────────────────────────────────────

function rendreHub() {
  const o = S.currentObjet;
  const cover = O.photos.find(p => p.couverture) ?? O.photos[0];
  const alertePhoto = O.photos.some(p => p.remarque_statut === 'en_attente' || p.kind === 'autre');
  const nPhotos = O.photos.length;

  // Position dans la collection triée created_at (si S.collection chargée).
  let posMeta = '';
  if (S.collection?.length) {
    const idx = S.collection.findIndex(x => String(x.id) === String(o.id));
    if (idx >= 0) posMeta = ` · ${idx + 1}/${S.collection.length}`;
  }

  const auteurHtml = o.auteur
    ? (O.artiste
      ? `<a class="obj-author" href="#/artiste/${encodeURIComponent(O.artiste.nom)}">${esc(o.auteur)}</a>`
      // Auteur renseigné mais AUCUNE fiche artiste : lecture de signature ou
      // piste non confirmée — l'indicateur (?) le dit avant la validation humaine.
      : `<span class="obj-author">${esc(o.auteur)} <span title="Artiste non identifié : pas de fiche artiste — à confirmer (validation humaine)" style="opacity:.55">(?)</span></span>`)
    : '';

  return `
  <div class="obj-hub">
    <nav class="obj-nav">
      <button class="obj-nav-back" data-action="nav-back">← ${o.categorie ? esc(catCanon(o.categorie)) : 'Accueil'}</button>
      <span class="obj-nav-meta">#${esc(o.id)}${esc(posMeta)}</span>
    </nav>

    <div class="obj-hub-body">
      <section class="obj-header">
        <div class="obj-thumb" data-action="nav" data-ecran="photos">
          ${cover?.thumbUrl
            ? `<img src="${esc(cover.thumbUrl)}" alt="${esc(o.titre || 'objet')}" loading="eager" decoding="async">`
            : `<div class="obj-thumb-placeholder">${catEmoji(o.categorie)}</div>`}
          <div class="obj-thumb-voile"></div>
          <span class="obj-thumb-id">#${esc(o.id)}</span>
          <div class="obj-thumb-bar">${nPhotos} photo${nPhotos > 1 ? 's' : ''} ›${alertePhoto ? '<span class="warn-dot">!</span>' : ''}</div>
        </div>
        <div class="obj-header-txt">
          <h1 class="obj-title">${esc(o.titre || 'Sans titre')}</h1>
          ${auteurHtml}
        </div>
      </section>

      <section class="obj-estim-row">
        ${rendrePaveEstimation(o)}
        <button class="obj-status-card" data-action="nav" data-ecran="historique">
          <span class="obj-status-label">${STATUTS[o.statut] ?? esc(o.statut)}</span>
          <span class="obj-status-date">${fmtDate(o.updated_at)}</span>
        </button>
      </section>

      ${rendreCarteIdentification(o)}
      ${rendreTiroirAlertes(o)}
      ${rendreCarteDescription(o)}

      <section class="obj-panel" id="similar-panel" style="display:none">
        <div class="obj-sec-title">Objets qui s'en rapprochent</div>
        <div class="similar" id="similar-grid"></div>
      </section>

      <button class="obj-del" data-action="del-objet">🗑 Supprimer l'objet</button>

      <div class="disclaimer">${infoSvg}
        Aide à l'estimation et au catalogage — ne constitue pas une expertise certifiée. Au-delà de 2 000 € estimés, une expertise humaine est recommandée (CNES/CNE, commissaire-priseur).
      </div>
    </div>

    <div class="obj-actions">
      <button class="obj-action-primary" data-action="valider" ${o.statut === 'validee' ? 'disabled' : ''}>✓ Valider la fiche</button>
      <button class="obj-action-outline" data-action="nav" data-ecran="identification">✎ Corriger</button>
      <button class="obj-action-ia" data-action="relancer" title="Relancer les recherches">
        <span>↻</span><span class="obj-action-ia-logo"><span class="ia-i">I</span><img src="assets/logo-glyph.png" alt="AR"></span>
      </button>
    </div>
  </div>`;
}

function rendrePaveEstimation(o) {
  const nVendus = O.comps.filter(c => !c.exclu && c.source_type !== 'en_vente').length;
  const nVente = O.comps.filter(c => !c.exclu && c.source_type === 'en_vente').length;
  const valeur = (o.prix_bas != null && o.prix_haut != null)
    ? `<div class="obj-estim-value">${fmtNum(o.prix_bas)}–${fmtNum(o.prix_haut)} €</div>`
    : `<div class="obj-estim-none">Pas encore d'estimation</div>`;
  return `
    <button class="obj-estim" data-action="nav" data-ecran="ventes">
      <div><div class="obj-estim-label">Estimation</div>${valeur}</div>
      <span class="obj-estim-sep"></span>
      <div class="obj-estim-counts"><strong>${nVendus}</strong> vendu${nVendus > 1 ? 's' : ''} · <strong>${nVente}</strong> en vente</div>
    </button>`;
}

function rendreCarteIdentification(o) {
  const aValider = CHAMPS_VALIDABLES.filter(ch => champRempli(ch, o) && !estValide(ch)).length;
  const dims = fmtDims(o);
  const rangement = [o.zone, o.contenant].filter(Boolean).join(' · ');
  return `
    <section class="obj-card" data-action="nav" data-ecran="identification">
      <div class="obj-card-head">
        <span class="obj-sec-title">Identification</span>
        <span class="obj-card-meta">
          ${aValider ? `<span class="pill-warn">${aValider} à valider</span>` : ''}
          <span>›</span>
        </span>
      </div>
      <div class="obj-id-grid">
        <div><div class="obj-field-label">Catégorie</div><div class="obj-field-value">${o.categorie ? esc(catCanon(o.categorie)) + (o.sous_categorie ? ` · ${esc(o.sous_categorie)}` : '') : '<span class="miss">—</span>'}</div></div>
        <div><div class="obj-field-label">Période</div><div class="obj-field-value">${o.periode ? esc(o.periode) : '<span class="miss">—</span>'}</div></div>
        <div><div class="obj-field-label">Région</div><div class="obj-field-value">${o.ecole ? esc(o.ecole) : '<span class="miss">—</span>'}</div></div>
        <div><div class="obj-field-label ${dims ? '' : 'warn'}">Dimensions</div><div class="obj-field-value ${dims ? '' : 'warn'}">${dims ? esc(dims) : 'à mesurer'}</div></div>
        <div><div class="obj-field-label">État</div><div class="obj-field-value">${o.etat ? esc(o.etat) : '<span class="miss">—</span>'}</div></div>
        <div><div class="obj-field-label">Rangement</div><div class="obj-field-value">${rangement ? `📍 ${esc(rangement)}` : '<span class="miss">—</span>'}</div></div>
      </div>
      <div class="obj-card-more">voir plus <span>▾</span></div>
    </section>`;
}

function champRempli(champ, o) {
  if (champ === 'dimensions') return o.hauteur_cm != null || o.largeur_cm != null || o.profondeur_cm != null;
  if (champ === 'prix') return o.prix_bas != null && o.prix_haut != null;
  if (champ === 'categorie') return Boolean(o.categorie);
  return Boolean(o[champ]);
}

function rendreTiroirAlertes(o) {
  const alertes = calculerAlertes(o);
  if (!alertes.length) return '';
  const bloquantes = alertes.filter(a => a.bloquant);
  return `
    <details class="obj-alertes">
      <summary class="obj-alertes-summary">
        <span class="obj-alertes-handle"></span>
        <div class="obj-alertes-head">
          <span class="warn-puce"></span>
          <span class="obj-alertes-title">${alertes.length} chose${alertes.length > 1 ? 's' : ''} à faire avant de valider</span>
          <span class="obj-alertes-chev">▾</span>
        </div>
      </summary>
      <div class="obj-alertes-list">
        ${alertes.map(a => `
          <button class="obj-alerte ${a.bloquant ? 'bloquant' : 'info'}" data-action="nav" data-ecran="${a.ecran}" ${a.focus ? `data-focus='${esc(JSON.stringify(a.focus))}'` : ''}>
            <span class="obj-alerte-bar"></span>
            <div class="obj-alerte-txt">
              <div class="obj-alerte-title">${esc(a.titre)}</div>
              <div class="obj-alerte-sub">${esc(a.sous)}</div>
            </div>
            <span class="obj-alerte-chev">›</span>
          </button>`).join('')}
      </div>
    </details>`;
}

function calculerAlertes(o) {
  const alertes = [];
  if (o.hauteur_cm == null) {
    alertes.push({ bloquant: true, ecran: 'identification', focus: { champ: 'dimensions' }, titre: 'Mesurer hauteur et diamètre', sous: 'indispensable pour chiffrer' });
  }
  const hasEchelle = O.photos.some(p => p.kind === 'echelle');
  const vuesManquantes = Array.isArray(o.vues_manquantes) ? o.vues_manquantes : [];
  const echelleAbsente = vuesManquantes.some(v => v.vue === 'echelle' && v.statut === 'absente');
  if (!hasEchelle && !echelleAbsente) {
    const nRemarque = O.photos.filter(p => p.remarque_statut === 'en_attente').length;
    alertes.push({ bloquant: true, ecran: 'photos', focus: null, titre: 'Photo avec règle ou repère d’échelle', sous: nRemarque ? `${nRemarque} photo${nRemarque > 1 ? 's' : ''} à reprendre` : 'manque une vue échelle' });
  }
  const nVendus = O.comps.filter(c => !c.exclu && c.source_type !== 'en_vente').length;
  if (o.prix_bas == null || nVendus === 0) {
    alertes.push({ bloquant: false, ecran: 'ventes', focus: null, titre: 'Pas encore de comparable vendu exploitable', sous: `${O.comps.filter(c => !c.exclu).length} vente${O.comps.filter(c => !c.exclu).length > 1 ? 's' : ''} relevée${O.comps.filter(c => !c.exclu).length > 1 ? 's' : ''}` });
  }
  const photosAction = O.photos.filter(p => p.remarque_statut === 'en_attente' || p.kind === 'autre');
  if (photosAction.length) {
    const remarques = photosAction.filter(p => p.remarque_statut === 'en_attente').length;
    alertes.push({ bloquant: remarques > 0, ecran: 'photos', focus: null, titre: `${photosAction.length} photo${photosAction.length > 1 ? 's' : ''} demandent une action`, sous: remarques ? `${remarques} remarque${remarques > 1 ? 's' : ''} en attente` : `${photosAction.length} sans tag pertinent` });
  }
  return alertes;
}

function rendreCarteDescription(o) {
  return `
    <section class="obj-card" data-action="nav" data-ecran="description">
      <div class="obj-card-head">
        <span class="obj-sec-title">Description</span>
        <span>›</span>
      </div>
      <div class="obj-desc">${o.description ? esc(o.description) : '<span class="miss">Pas encore de description</span>'}</div>
    </section>`;
}

async function loadSimilar(o) {
  const panel = $('#similar-panel');
  if (!panel) return;
  if (!o.categorie) return;
  const { data } = await sb.from('objets').select('*')
    .eq('owner_id', S.tenantId).eq('categorie', o.categorie).neq('id', o.id)
    .order('created_at', { ascending: false }).limit(3);
  if (!data?.length) return;
  const { data: ph } = await sb.from('photos').select('objet_id,storage_path,thumb_path')
    .eq('owner_id', S.tenantId).in('objet_id', data.map(s => s.id)).order('ordre', { nullsFirst: false }).order('created_at');
  const first = {};
  for (const p of ph ?? []) if (!first[p.objet_id]) first[p.objet_id] = p.thumb_path ?? p.storage_path;
  const urls = await signPaths(Object.values(first));
  panel.style.display = '';
  $('#similar-grid').innerHTML = data.map(s => {
    const img = urls[first[s.id]];
    return `<div class="sim-card" data-action="similar" data-oid="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.titre || 'Objet similaire')} — fiche #${esc(s.id)}">
      <div class="sim-img">${img ? `<img src="${esc(img)}" alt="${esc(s.titre || 'Objet similaire')}" loading="lazy" decoding="async">` : catEmoji(s.categorie)}</div>
      <div><div class="sim-t">${esc(s.titre || 'Sans titre')}</div>
      <div class="sim-m">#${esc(s.id)}${s.prix_bas != null ? ` · ${fmtNum(s.prix_bas)}–${fmtNum(s.prix_haut)} €` : ''}</div></div>
    </div>`;
  }).join('');
}

// ─── Actions de la vue Objet (délégation) ───────────────────────────────────

const ACTIONS_MUTANTES = new Set([
  'valider', 'relancer', 'del-objet', 'toggle-val',
]);

$('#objet-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (ACTIONS_MUTANTES.has(act) && !canWrite()) return;
  const o = S.currentObjet;

  if (act === 'nav') {
    let focus = null;
    if (el.dataset.focus) {
      try { focus = JSON.parse(el.dataset.focus); } catch { focus = { champ: el.dataset.focus }; }
    }
    naviguer(el.dataset.ecran, focus);
  }
  else if (act === 'nav-back') {
    location.hash = o?.categorie ? `#/rayon/${encodeURIComponent(catCanon(o.categorie))}` : '#/';
  }
  else if (act === 'similar') {
    location.hash = '#/objet/' + encodeURIComponent(el.dataset.oid);
  }
  else if (act === 'toggle-val') {
    await toggleValidation(el.dataset.champ);
  }
  else if (act === 'valider') {
    const { error } = await sb.from('objets').update({ statut: 'validee' }).eq('owner_id', S.tenantId).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    logEvent('validation', { note: 'confiance 4/4 (ground truth)' });
    toast(`#${o.id} validée ✓ — confiance 4/4 (ground truth)`);
    loadObjet(o.id);
    S.refreshHeader?.();
  }
  else if (act === 'relancer') {
    if (!confirm(`Relancer les recherches de #${o.id} ?\n\nR1 (Kimi, ~40 s) repart si des photos ont changé, puis R2 (Lens) est enfilée — le cron la prend sous ~2 min.`)) return;
    el.disabled = true;
    const force = o.statut === 'validee';
    const r = await lancerRecherches(o.id, { force });
    if (r.ok) {
      logEvent('relance', { force, certain: r.certain ?? null });
      toast(r.skip
        ? `R1 sautée (${r.skip}) — R2 (Lens) en file`
        : `R1 terminée${r.certain ? ' — auteur certain ✓' : ' — doute : analyse versée à la description'} · R2 (Lens) en file`);
    } else if (r.reseau) {
      const n = await enqueueJobs([o.id], 'r1');
      if (n) toast('R1 en file — le cron la prend sous ~2 min');
    }
    loadObjet(o.id);
  }
  else if (act === 'del-objet') { deleteObjet(); }
});

// Overlay bloquant de progression d'upload (HO-032).
function uploadOverlay(total) {
  const el = document.createElement('div');
  el.className = 'upl-overlay';
  el.innerHTML = `<div class="upl-card" role="alert" aria-live="polite">
    <div class="upl-spin" aria-hidden="true"></div>
    <div class="upl-msg">Envoi des photos — 0/${total}</div>
    <button class="btn small" data-annuler>Annuler</button>
  </div>`;
  document.body.append(el);
  const ui = {
    annule: false,
    progress(sent, tot) {
      const msg = el.querySelector('.upl-msg');
      if (msg) msg.textContent = `Envoi des photos — ${sent}/${tot} terminée${sent > 1 ? 's' : ''}`;
      return ui.annule ? false : undefined;
    },
    close() { el.remove(); },
  };
  el.querySelector('[data-annuler]').addEventListener('click', () => {
    ui.annule = true;
    ui.close();
  });
  return ui;
}

$('#file-add-photo').addEventListener('change', async e => {
  if (!canWrite()) { e.target.value = ''; return; }
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !S.currentObjet) return;
  const oid = S.currentObjet.id;
  const o = S.currentObjet;
  const ui = uploadOverlay(files.length);
  const { done, failed } = await uploadPhotosFor(oid, files, false, (sent, total) => ui.progress(sent, total));
  ui.close();
  if (done > 0) {
    logEvent('photo_ajoutee', { n: done, ...(failed.length ? { echecs: failed.length } : {}), via: 'fichier' }, oid);
    await purgeConsigne(o, oid);
  }
  if (ui.annule) {
    toast(done ? `Envoi interrompu — ${done}/${files.length} photo(s) ajoutée(s)` : 'Envoi interrompu — aucune photo ajoutée', !done);
  } else if (failed.length > 0) {
    toast(`${done}/${files.length} photo(s) ajoutée(s) — ${failed.length} en échec (${failed[0].reason}). Réessayez.`, true);
  } else if (done > 0) {
    toast(S.currentObjet.statut !== 'validee'
      ? `${done} photo${done > 1 ? 's' : ''} ajoutée${done > 1 ? 's' : ''} — « Relancer les recherches » quand tu es prêt`
      : `${done} photo${done > 1 ? 's' : ''} ajoutée${done > 1 ? 's' : ''}`);
  }
  loadObjet(oid);
});

// Branchement des hooks partagés.
hooks.recharger = loadObjet;
hooks.rendre = renderObjet;
hooks.naviguer = naviguer;
