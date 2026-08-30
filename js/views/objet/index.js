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
import { enregistrer, withBusy, humaniser } from '../../core/feedback.js';
import { S, canWrite } from '../../core/state.js';
import {
  fmtNum, fmtDate, catCanon, catEmoji, infoSvg, isVideo, STATUTS,
} from '../../core/format.js';
import { sb, signPaths, logEvent, lancerRecherches, enqueueJobs } from '../../core/data.js';
import { loadViewCss } from '../../core/css.js';
import { page } from '../../ui/page.js';
import { O, hooks, CHAMPS_VALIDABLES, estValide, toggleValidation, chargerNLens } from './etat.js';
import { brancherUploads } from './uploads.js';

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
  // Fil d'Ariane (HO-104) : filDe('objet', …) fournit la forme (S.fil posé par
  // le shell avant mount()) sans connaître la catégorie — cette vue la complète.
  if (S.fil) {
    S.fil[1] = o.categorie
      ? { label: catCanon(o.categorie), hash: `#/rayon/${encodeURIComponent(catCanon(o.categorie))}` }
      : S.fil[1];
  }
  const [{ data: photos }, { data: comps }, { data: fiches }, { data: events }, { data: artiste }, { data: jobs }, nLens] = await Promise.all([
    sb.from('photos').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('ordre', { nullsFirst: false }).order('created_at'),
    sb.from('comparables').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('date_vente', { ascending: false, nullsFirst: false }),
    sb.from('fiches').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('version', { ascending: false }).limit(1),
    sb.from('evenements').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('created_at', { ascending: false }).limit(50),
    o.auteur ? sb.from('artistes').select('*').eq('owner_id', S.tenantId).eq('nom', o.auteur).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('jobs').select('type,statut').eq('owner_id', S.tenantId).eq('objet_id', id).in('statut', ['en_attente','en_cours']),
    chargerNLens(id),
  ]);
  const compPaths = (comps ?? []).map(c => c.image_path).filter(Boolean);
  const grand = p => (isVideo(p) ? p.storage_path : (p.moyen_path ?? p.storage_path)), urlByPath = await signPaths([...(photos ?? []).flatMap(p => [grand(p), p.thumb_path].filter(Boolean)), ...compPaths]); // grande zone 2048 : ex-`moyen` s'il existe, sinon la maîtresse (D-081)
  O.photos = (photos ?? []).map(p => ({ ...p, url: urlByPath[grand(p)] ?? urlByPath[p.thumb_path], thumbUrl: urlByPath[p.thumb_path] ?? urlByPath[grand(p)] }));
  O.comps = (comps ?? []).map(c => ({ ...c, imageSrc: c.image_path ? urlByPath[c.image_path] : null }));
  O.fiche = (fiches ?? [])[0] ?? null;
  O.events = events ?? [];
  O.artiste = artiste ?? null;
  O.jobs = jobs ?? [];
  O.nLens = nLens ?? 0;
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
  // La ligne d'abord : tant qu'elle résiste (RLS, droits), on ne touche PAS aux
  // fichiers — sinon un refus silencieux laisserait une fiche sans ses photos.
  const { valeur: supprime, annule } = await withBusy(async () => {
    const ok = await enregistrer(() => sb.from('objets').delete().eq('owner_id', S.tenantId).eq('id', o.id).select('id'),
      'Objet supprimé', { silencieuxSiOk: true, attendLignes: true });
    if (!ok) return false;
    const paths = O.photos.map(p => p.storage_path).filter(Boolean);
    if (paths.length) await sb.storage.from('photos').remove(paths);
    return true;
  }, { titre: 'Suppression de l\'objet…', annulable: false });
  if (annule || !supprime) return;
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
    renderHubEcran(body);
    return;
  }
  importerEcran(O.ecran).then(mod => {
    if (mod?.rendre) mod.rendre(body);
  });
}

// Chrome uniforme (HO-104) : titre + méta dans l'en-tête, fil d'Ariane au-dessus
// du bandeau photo — plus rien n'est posé sur la photo (arbitrage Yann 2026-08-29).
function renderHubEcran(body) {
  const o = S.currentObjet;
  let posMeta = '';
  if (S.collection?.length) {
    const idx = S.collection.findIndex(x => String(x.id) === String(o.id));
    if (idx >= 0) posMeta = ` · ${idx + 1}/${S.collection.length}`;
  }
  const corps = page(body, {
    titre: titreSansAuteur(o.titre, o.auteur) || 'Sans titre',
    meta: `#${o.id}${posMeta}`,
    fil: S.fil,
    barre: {
      actions: [
        { label: '✓ Valider la fiche', type: 'primaire', desactive: o.statut === 'validee', onClick: onValiderFiche },
        { label: '✎ Corriger', type: 'plat', onClick: () => naviguer('identification') },
        { label: '↻ Relancer les recherches', type: 'plat', onClick: onRelancerHub },
      ],
    },
  });
  corps.innerHTML = rendreHub(o);
  loadSimilar(o);
}

// ─── Hub ───────────────────────────────────────────────────────────────────

// Titre base = « quoi — qui » (HO-026), déjà repris par la ligne auteur : on
// masque ce suffixe à l'affichage seulement (o.titre n'est jamais réécrit).
function titreSansAuteur(titre, auteur) {
  if (!titre || !auteur) return titre;
  const t = titre.trim(), suf = `— ${auteur}`.trim().toLowerCase();
  return t.toLowerCase().endsWith(suf) ? t.slice(0, t.length - suf.length).replace(/[\s—]+$/, '').trim() : titre;
}

function rendreHub(o) {
  const cover = O.photos.find(p => p.couverture) ?? O.photos[0];
  const nVendus = O.comps.filter(c => !c.exclu && c.source_type !== 'en_vente').length;
  const nVente = O.comps.filter(c => !c.exclu && c.source_type === 'en_vente').length;

  const auteurHtml = o.auteur
    ? (O.artiste
      ? `<a class="obj-author" href="#/artiste/${encodeURIComponent(O.artiste.nom)}">${esc(o.auteur)}</a>`
      // Auteur renseigné mais AUCUNE fiche artiste : lecture de signature ou
      // piste non confirmée — l'indicateur (?) le dit avant la validation humaine.
      : `<span class="obj-author">${esc(o.auteur)} <span title="Artiste non identifié : pas de fiche artiste — à confirmer (validation humaine)" style="opacity:.55">(?)</span></span>`)
    : '';
  const titreAffiche = titreSansAuteur(o.titre, o.auteur);

  return `
  <div class="obj-hub">
    <div class="obj-photo-band" data-action="nav" data-ecran="photos">
      ${cover?.thumbUrl
        ? `<img src="${esc(cover.thumbUrl)}" alt="${esc(o.titre || 'objet')}" loading="eager" decoding="async">`
        : `<div class="obj-photo-band-placeholder">${catEmoji(o.categorie)}</div>`}
      <div class="obj-photo-band-voile-bottom">
        <h1 class="obj-title">${esc(titreAffiche || 'Sans titre')}</h1>
        ${auteurHtml}
      </div>
      ${rendreRuban(o)}
    </div>

    <div class="obj-hub-body">
      <div class="obj-thumb-row" data-action="nav" data-ecran="photos">
        ${O.photos.map(p => `<img class="obj-thumb-mini${p.id === cover?.id ? ' cover' : ''}" src="${esc(p.thumbUrl)}" alt="" loading="lazy" decoding="async">`).join('')}
        <span class="obj-thumb-mini obj-thumb-add">+</span>
      </div>
      <div class="obj-meta-row">
        <span class="obj-meta-comps">${nVendus} vendu${nVendus > 1 ? 's' : ''} · ${nVente} en vente</span>
        <span class="obj-meta-statut">${STATUTS[o.statut] ?? esc(o.statut)} · <span class="obj-meta-date">${fmtDate(o.updated_at)}</span></span>
      </div>

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
  </div>`;
}

function rendreRuban(o) {
  if (o.prix_bas == null || o.prix_haut == null) return '';
  return `
    <button class="obj-ruban" data-action="nav" data-ecran="ventes">${fmtNum(o.prix_bas)} – ${fmtNum(o.prix_haut)} €</button>`;
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
  const refus = o.alertes_refusees ?? {};
  const nRefus = Object.keys(refus).length;
  if (!alertes.length && !nRefus) return '';
  const titre = alertes.length ? `${alertes.length} chose${alertes.length > 1 ? 's' : ''} à faire avant de valider` : '0 chose à faire';
  return `
    <details class="obj-alertes">
      <summary class="obj-alertes-summary">
        <span class="obj-alertes-handle"></span>
        <div class="obj-alertes-head">
          <span class="warn-puce"></span>
          <span class="obj-alertes-title">${esc(titre)}</span>
          <span class="obj-alertes-chev">▾</span>
        </div>
      </summary>
      <div class="obj-alertes-list">
        ${alertes.map(a => `
          <div class="obj-alerte ${a.bloquant ? 'bloquant' : 'info'}" data-action="nav" data-ecran="${a.ecran}" ${a.focus ? `data-focus='${esc(JSON.stringify(a.focus))}'` : ''} role="button" tabindex="0">
            <span class="obj-alerte-bar"></span>
            <div class="obj-alerte-txt">
              <div class="obj-alerte-title">${esc(a.titre)}</div>
              <div class="obj-alerte-sub">${esc(a.sous)}</div>
            </div>
            <button class="obj-alerte-refuser" data-action="alerte-refuser" data-cle="${esc(a.cle)}" aria-label="Ignorer cette alerte">✕</button>
            <span class="obj-alerte-chev">›</span>
          </div>`).join('')}
        ${nRefus ? `
          <button class="obj-alerte-restaurer" data-action="alerte-restaurer">${nRefus} alerte${nRefus > 1 ? 's' : ''} ignorée${nRefus > 1 ? 's' : ''} · réafficher</button>` : ''}
      </div>
    </details>`;
}
function calculerAlertes(o) {
  const alertes = [];
  if (o.hauteur_cm == null) {
    alertes.push({ cle: 'dimensions', bloquant: true, ecran: 'identification', focus: { champ: 'dimensions' }, titre: 'Mesurer hauteur et diamètre', sous: 'indispensable pour chiffrer' });
  }
  const nVendus = O.comps.filter(c => !c.exclu && c.source_type !== 'en_vente').length;
  if (o.prix_bas == null || nVendus === 0) {
    alertes.push({ cle: 'comparables', bloquant: false, ecran: 'ventes', focus: null, titre: 'Pas encore de comparable vendu exploitable', sous: `${O.comps.filter(c => !c.exclu).length} vente${O.comps.filter(c => !c.exclu).length > 1 ? 's' : ''} relevée${O.comps.filter(c => !c.exclu).length > 1 ? 's' : ''}` });
  }
  const nonTaguees = O.photos.filter(p => p.kind == null).length;
  if (nonTaguees) {
    alertes.push({ cle: 'photos_sans_tag', bloquant: false, ecran: 'photos', focus: null, titre: `${nonTaguees} photo${nonTaguees > 1 ? 's' : ''} sans tag`, sous: 'taguer ce que montre chaque photo (signature, revers…) — ça guide l’analyse' });
  }
  // Artiste introuvable malgré Lens (HO-087) + photos en cause par l'IA (suggestions refusables — pas la corvée bloquante retirée en HO-085).
  if (O.nLens >= 2 && !o.auteur) alertes.push({ cle: 'artiste_introuvable', bloquant: false, ecran: 'photos', focus: null, titre: `Artiste toujours pas identifié après ${O.nLens} passes Lens`, sous: 'des photos plus nettes de la signature aideraient' });
  const nSignalees = O.photos.filter(p => p.remarque_statut === 'en_attente').length;
  if (nSignalees) alertes.push({ cle: 'photo_qualite', bloquant: false, ecran: 'photos', focus: null, titre: `${nSignalees} photo${nSignalees > 1 ? 's' : ''} signalée${nSignalees > 1 ? 's' : ''} par l'analyse`, sous: "l'IA pense qu'une reprise aiderait l'identification" });
  const refus = S.currentObjet.alertes_refusees ?? {};
  return alertes.filter(a => !refus[a.cle]);
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
  const grid = $('#similar-grid'); if (!grid || String(S.currentObjet?.id) !== String(o.id)) return; // écran changé pendant les 3 await (Photos ouvert, ou autre objet) : rien à peindre — 2026-08-30, fichier en dette, pas une ligne de plus
  panel.style.display = ''; grid.innerHTML = data.map(s => {
    const img = urls[first[s.id]];
    return `<div class="sim-card" data-action="similar" data-oid="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.titre || 'Objet similaire')} — fiche #${esc(s.id)}">
      <div class="sim-img">${img ? `<img src="${esc(img)}" alt="${esc(s.titre || 'Objet similaire')}" loading="lazy" decoding="async">` : catEmoji(s.categorie)}</div>
      <div><div class="sim-t">${esc(s.titre || 'Sans titre')}</div>
      <div class="sim-m">#${esc(s.id)}${s.prix_bas != null ? ` · ${fmtNum(s.prix_bas)}–${fmtNum(s.prix_haut)} €` : ''}</div></div>
    </div>`;
  }).join('');
}

// ─── Actions de la vue Objet (délégation) ───────────────────────────────────

const ACTIONS_MUTANTES = new Set(['del-objet', 'toggle-val']);
$('#objet-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (ACTIONS_MUTANTES.has(act) && !canWrite()) return;

  if (act === 'nav') {
    let focus = null;
    if (el.dataset.focus) {
      try { focus = JSON.parse(el.dataset.focus); } catch { focus = { champ: el.dataset.focus }; }
    }
    naviguer(el.dataset.ecran, focus);
  }
  else if (act === 'similar') {
    location.hash = '#/objet/' + encodeURIComponent(el.dataset.oid);
  }
  else if (act === 'toggle-val') {
    await toggleValidation(el.dataset.champ);
  }
  else if (act === 'del-objet') { deleteObjet(); }
  else if (act === 'alerte-refuser') {
    e.stopPropagation();
    await refuserAlerte(el.dataset.cle);
  }
  else if (act === 'alerte-restaurer') {
    await restaurerAlertes();
  }
});

// ─── Barre basse du hub (HO-104) : câblées via barreBasse(), plus par délégation ──
async function onValiderFiche() {
  const o = S.currentObjet;
  if (!o || !canWrite()) return;
  if (!await enregistrer(() => sb.from('objets').update({ statut: 'validee' }).eq('owner_id', S.tenantId).eq('id', o.id), 'Fiche validée', { silencieuxSiOk: true })) return;
  logEvent('validation', { note: 'confiance 4/4 (ground truth)' });
  toast(`#${o.id} validée ✓ — confiance 4/4 (ground truth)`);
  loadObjet(o.id);
  S.refreshHeader?.();
}
async function onRelancerHub(evt) {
  const o = S.currentObjet;
  if (!o || !canWrite()) return;
  if (!confirm(`Relancer les recherches de #${o.id} ?\n\nR1 (Kimi, ~40 s) repart si des photos ont changé, puis R2 (Lens) est enfilée — le cron la prend sous ~2 min.`)) return;
  const btn = evt?.target?.closest ? evt.target.closest('[data-ui-action]') : null;
  if (btn) btn.disabled = true;
  const force = o.statut === 'validee';
  // lancerRecherches est un fetch unique, non interruptible en cours de route
  // (pas de callback de progression comme uploadPhotosFor) : withBusy attend
  // sa fin réelle avant de résoudre, même après un clic Annuler. On agit donc
  // sur l'annulation via ctx.estAnnule() polé DANS fn, sans attendre le fetch.
  const { valeur: r, annule } = await withBusy(async ({ estAnnule }) => {
    const promesse = lancerRecherches(o.id, { force });
    while (!estAnnule()) {
      const gagnant = await Promise.race([promesse, new Promise(res => setTimeout(() => res('poll'), 150))]);
      if (gagnant !== 'poll') return gagnant;
    }
    const n = await enqueueJobs([o.id], 'r1');
    if (n) toast('Recherche remise en file — le cron la reprend sous ~2 min.');
    return null;
  }, { titre: 'Recherche R1 en cours…', seuilLent: 20000 });
  if (!annule && r?.ok) {
    logEvent('relance', { force, certain: r.certain ?? null });
    toast(r.skip
      ? `R1 sautée (${r.skip}) — R2 (Lens) en file`
      : `R1 terminée${r.certain ? ' — auteur certain ✓' : ' — doute : analyse versée à la description'} · R2 (Lens) en file`);
  } else if (!annule && r && !r.ok) { // HO-110 : lancerRecherches() se tait, le message dépend de si l'échec est rattrapé
    if (r.raison === 'delai') { await enqueueJobs([o.id], 'r1'); toast('Recherche trop longue — elle repart en file, la fiche se complétera plus tard. Rien à faire.'); }
    else if (r.raison === 'session') toast('Session expirée — reconnecte-toi pour continuer.', 'action');
    else toast(`L'IA n'a pas répondu (${humaniser(r.erreur ?? r)}) — rien n'a changé sur la fiche. Réessaie dans quelques minutes.`, 'action', { action: { label: 'Réessayer', onClick: () => onRelancerHub() } }); }
  if (btn) btn.disabled = false;
  loadObjet(o.id);
}
async function refuserAlerte(cle) {
  const o = S.currentObjet;
  if (!o || !cle) return;
  const qui = localStorage.getItem('iartcane-qui') ?? 'alain';
  const refus = { ...(o.alertes_refusees ?? {}), [cle]: { par: qui, at: new Date().toISOString() } };
  if (!await enregistrer(() => sb.from('objets').update({ alertes_refusees: refus }).eq('owner_id', S.tenantId).eq('id', o.id), 'Alerte ignorée', { silencieuxSiOk: true })) return;
  o.alertes_refusees = refus;
  logEvent('alerte_refusee', { cle });
  hooks.rendre();
}
async function restaurerAlertes() {
  const o = S.currentObjet;
  if (!o) return;
  if (!await enregistrer(() => sb.from('objets').update({ alertes_refusees: {} }).eq('owner_id', S.tenantId).eq('id', o.id), 'Alertes réaffichées', { silencieuxSiOk: true })) return;
  o.alertes_refusees = {};
  logEvent('alertes_restaurees', {});
  hooks.rendre();
}

brancherUploads(loadObjet);
// Branchement des hooks partagés.
hooks.recharger = loadObjet;
hooks.rendre = renderObjet;
hooks.naviguer = naviguer;
