// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/index.js : fiche produit — chargement, rendu et
// délégation des actions. Point d'entrée de la vue (`mount(id)`), appelé par le
// routeur de app.js.
//
// Territoire découpé en trois (D-041, la fiche dépassait 650 lignes et était le
// point de conflit n°1 entre chantiers parallèles) :
//   • index.js   ce fichier — chargement, rendu, actions, localisation, similaires
//   • photos.js  galerie : suppression, caméra, lightbox (zoom / centrage / recadrage)
//   • edition.js mode « Corriger » : champs éditables et enregistrement
//   • etat.js    état partagé des trois (objet O) + hooks de rechargement/rendu
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, norm, toast, emptyHtml } from '../../core/dom.js';
import { S, canWrite } from '../../core/state.js';
import {
  fmtNum, fmtDate, fmtDateTime, confMarks, confHtml, catCanon, catEmoji, isVideo, infoSvg,
  STATUTS, ACT_LABELS, actorBadge, evDetailBits, mdToHtml,
} from '../../core/format.js';
import { SOUS } from '../../core/taxonomie.js';
import { sb, signPaths, logEvent, lancerRecherches, enqueueJobs, purgeConsigne, uploadPhotosFor } from '../../core/data.js';
import { openCamera } from '../../core/camera.js';
import { loadViewCss } from '../../core/css.js';
import { O, selPhoto, hooks } from './etat.js';
import { deletePhoto, onCamClose, openLightbox } from './photos.js';
import { CHAMPS_EDIT, dlRow, saveCorrections, srcBadge } from './edition.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
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
  O.editing = false;
  const [{ data: photos }, { data: comps }, { data: fiches }, { data: events }, { data: artiste }, { data: jobs }] = await Promise.all([
    sb.from('photos').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('created_at'),
    sb.from('comparables').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('date_vente', { ascending: false, nullsFirst: false }),
    sb.from('fiches').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('version', { ascending: false }).limit(1),
    sb.from('evenements').select('*').eq('owner_id', S.tenantId).eq('objet_id', id).order('created_at', { ascending: false }).limit(50),
    // Fiche artiste (migration 0008) : match exact sur objets.auteur, 0 ligne tolérée
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

async function deleteComp(cid) {
  if (!S.currentObjet || !canWrite()) return;
  const c = O.comps.find(x => String(x.id) === String(cid));
  if (!c) return;
  if (!confirm('Retirer ce comparable de l’estimation ?')) return;
  const { error } = await sb.from('comparables').delete().eq('owner_id', S.tenantId).eq('id', cid);
  if (error) { toast(error.message, true); return; }
  logEvent('comparable_supprime', { comparable_id: cid, lot: c.lot, maison: c.maison }, S.currentObjet.id);
  toast('Comparable retiré');
  await loadObjet(S.currentObjet.id);
}

// Indicateur d'avancement R1/R2/R3/Valorisation (D-057)
// Données : événements déjà chargés + jobs en attente/en cours + flag valo_due.
// R2 compte TOUTES les actions d'enrichissement réelles (D-051) : la base
// contient lens, lens R2, grok, gpt, grok R2, gpt R2, llm_appoint (hérités).
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

// Dimensions saisies à la main (D-053) — ligne combinée, valeurs absentes omises.
// Ex. « H 30 × L 20 cm », « P 2 cm », null si rien → dlRow affiche « — ».
function fmtDims(o) {
  const parts = [];
  if (o.hauteur_cm != null) parts.push(`H ${o.hauteur_cm}`);
  if (o.largeur_cm != null) parts.push(`L ${o.largeur_cm}`);
  if (o.profondeur_cm != null) parts.push(`P ${o.profondeur_cm}`);
  return parts.length ? parts.join(' × ') + ' cm' : null;
}

function renderObjet() {
  const o = S.currentObjet;
  const marks = confMarks(o);
  const selIdx = Math.max(0, O.photos.findIndex(p => p.sel));
  const sel = O.photos[selIdx];

  const gallery = O.photos.length ? `
    <div class="panel">
      <div class="gallery-main" data-action="zoom" title="Agrandir">
        ${sel && sel.url ? (isVideo(sel) ? `<video src="${esc(sel.url)}" controls></video>` : `<img src="${esc(sel.url)}" alt="photo de l'objet">`) : catEmoji(o.categorie)}
        ${sel && sel.url && !isVideo(sel) ? `<button class="crop-btn cut-btn hide-lecteur" data-action="cut-photo" title="Recadrer : rogne définitivement la photo (résolution d'origine conservée)">✂️ Recadrer</button>` : ''}
        ${sel && sel.url ? `<button class="crop-btn del-photo hide-lecteur" data-action="del-photo" title="Supprimer cette photo">🗑</button>` : ''}
        ${sel && sel.url && !isVideo(sel) ? `<button class="crop-btn cover-btn hide-lecteur ${sel.couverture ? 'active' : ''}" data-action="cover-photo" title="Couverture : cette photo illustre l'objet dans la collection">${sel.couverture ? '★ Couverture ✓' : '★ Couverture'}</button>` : ''}
      </div>
      <div class="thumbs">
        ${O.photos.map((p, i) => `
          <div class="thumb-wrap">
            <div class="thumb ${i === selIdx ? 'sel' : ''}" data-action="thumb" data-idx="${i}" title="${esc(p.kind)}" tabindex="0" role="button" aria-label="Photo ${i + 1} — ${esc(p.kind)}">
              ${p.url ? (isVideo(p) ? '🎬' : `<img src="${esc(p.thumbUrl || p.url)}" alt="${esc(p.kind)} — ${esc(o.titre || 'objet')}" loading="lazy" decoding="async">`) : '📷'}
              <span class="kind">${esc(p.kind)}</span>
            </div>
            ${p.commentaire ? `<div class="thumb-comment">${esc(p.commentaire)}</div>` : ''}
          </div>`).join('')}
        <div class="thumb-wrap"><div class="thumb add hide-lecteur" data-action="add-photo" title="Ajouter une photo" tabindex="0" role="button" aria-label="Ajouter une photo">＋</div></div>
      </div>
    </div>` : `
    <div class="panel">
      <div class="gallery-main" ${canWrite() ? 'data-action="add-photo" title="Ajouter la première photo" style="cursor:pointer"' : ''}>${catEmoji(o.categorie)}</div>
      <div class="thumbs"><div class="thumb-wrap"><div class="thumb add hide-lecteur" data-action="add-photo">＋</div></div></div>
    </div>`;

  const rebounds = [o.categorie, o.periode, o.ecole].filter(Boolean)
    .map(v => `<button class="rebound" data-action="rebound" data-val="${esc(v)}">${esc(v)}</button>`).join('');

  const identification = O.editing
    ? `<dl class="dl editing">
        ${CHAMPS_EDIT.map(([f, label]) => {
          if (f === 'sous_categorie') {
            const opts = SOUS[catCanon(o.categorie)] ?? [];
            return dlRow(label, o[f], f, 'select', opts);
          }
          if (f.endsWith('_cm')) return dlRow(label, o[f], f, 'number');
          return dlRow(label, o[f], f, f.startsWith('prix_') ? 'number' : 'text');
        }).join('')}
        <dt>Description ${srcBadge('description')}</dt><dd><textarea id="edit-description" rows="6">${esc(o.description ?? '')}</textarea></dd>
        ${o.commentaire ? `<dt>💬 Note <span class="fld-src hum" title="écrit par un humain — l'IA ne reprendra jamais ce champ">🔒 Humain · figé</span></dt><dd class="human-note">${esc(o.commentaire)}</dd>` : ''}
       </dl>`
    : `<dl class="dl">
        ${dlRow('Catégorie', o.sous_categorie ? `${o.categorie} · ${o.sous_categorie}` : o.categorie)}
        ${dlRow('Technique', o.technique)}
        ${dlRow('Période', o.periode)}
        ${dlRow('Région / école', o.ecole)}
        ${dlRow('Auteur', o.auteur)}
        ${dlRow('Marques / poinçons', o.marques)}
        ${dlRow('État', o.etat)}
        ${dlRow('Dimensions', fmtDims(o), null)}
        ${o.description ? `<dt>Description</dt><dd><em>${esc(o.description)}</em></dd>` : ''}
        ${o.commentaire ? `<dt>💬 Note</dt><dd class="human-note">${esc(o.commentaire)}</dd>` : ''}
      </dl>`;

  // Règle d'or : seules les adjudications nourrissent la fourchette — les
  // annonces « en vente » sont du contexte et sont affichées à part (badge ambre).
  const nVendus = O.comps.filter(c => c.source_type !== 'en_vente').length;
  const valeur = (o.prix_bas != null && o.prix_haut != null) ? `
      <div class="value-big">${fmtNum(o.prix_bas)}–${fmtNum(o.prix_haut)} €</div>
      <div class="value-sub">fourchette issue de ${nVendus} adjudication${nVendus > 1 ? 's' : ''} réelle${nVendus > 1 ? 's' : ''} — jamais d'estimation « de mémoire »</div>`
    : `<div class="value-sub">Pas encore d'estimation. La règle d'or : <b>jamais un chiffre sans comparables vendus affichés</b>.</div>`;

  // Comparables visuels : cartes avec image du lot. Adjudications d'abord,
  // « en vente » ensuite (tri stable : la date descendante de la requête est
  // conservée à l'intérieur de chaque groupe).
  const compsSorted = [...O.comps].sort((a, b) =>
    (a.source_type === 'en_vente' ? 1 : 0) - (b.source_type === 'en_vente' ? 1 : 0));
  const compsList = compsSorted.length ? `
    <div class="comps-list">
      ${compsSorted.map(c => {
        const enVente = c.source_type === 'en_vente';
        const imgSrc = c.imageSrc ?? c.image_url;
        const img = imgSrc
          ? `<img src="${esc(imgSrc)}" alt="${esc(c.lot ?? 'lot comparable')}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
          : '<span class="comp-noimg">🖼️</span>';
        const thumb = c.lien
          ? `<a class="comp-thumb" href="${esc(c.lien)}" target="_blank" rel="noopener" title="Voir le lot">${img}</a>`
          : `<div class="comp-thumb">${img}</div>`;
        return `<div class="comp-card">
          ${thumb}
          <div class="comp-info">
            <div class="comp-top">
              <span class="comp-maison">${esc(c.maison ?? '')}</span>
              <span class="mono comp-date">${fmtDate(c.date_vente)}</span>
              <span class="comp-badge ${enVente ? 'vente' : 'vendu'}">${enVente ? 'En vente — contexte' : 'Vendu'}</span>
            </div>
            <div class="comp-lot">${esc(c.lot ?? '—')}</div>
            <div class="comp-bot">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="comp-prix">${c.prix != null ? fmtNum(c.prix) + ' ' + esc(c.devise === 'EUR' ? '€' : c.devise) : '—'}</span>
                ${c.estimation_bas != null && c.estimation_haut != null ? `<span class="comp-est">est. ${fmtNum(c.estimation_bas)}–${fmtNum(c.estimation_haut)} ${esc(c.devise === 'EUR' ? '€' : c.devise)}</span>` : ''}
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                ${c.lien ? `<a class="link-lot" href="${esc(c.lien)}" target="_blank" rel="noopener">Voir le lot ↗</a>` : ''}
                ${canWrite() ? `<button class="btn small danger" data-action="del-comp" data-cid="${esc(c.id)}">Retirer</button>` : ''}
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  const actions = O.editing ? `
    <div class="corr-bar">
      ✏️ <b>Mode correction</b> — chaque différence est gravée comme leçon (ground truth).
      Je suis :
      <select id="corr-qui">
        <option value="alain" ${localStorage.getItem('iartcane-qui') !== 'yann' ? 'selected' : ''}>Alain</option>
        <option value="yann" ${localStorage.getItem('iartcane-qui') === 'yann' ? 'selected' : ''}>Yann</option>
      </select>
      <button class="btn primary small" data-action="corr-save">Enregistrer les corrections</button>
      <button class="btn small" data-action="corr-cancel">Annuler</button>
    </div>` : `
    <div class="actions hide-lecteur">
      <button class="btn primary" data-action="valider" ${o.statut === 'validee' ? 'disabled' : ''}>✓ Valider la fiche</button>
      <button class="btn" data-action="corriger">✏️ Corriger</button>
      <button class="btn" data-action="relancer">↻ Relancer les recherches</button>
      ${o.auteur && o.prix_bas == null ? '<button class="btn" data-action="valo" title="Recherche de comparables vendus (batch dédié, ~10 min)">💶 Lancer la valorisation</button>' : ''}
      <button class="btn" data-action="take-photo">📸 Prendre une photo</button>
      <button class="btn" data-action="add-photo">🖼️ Ajouter depuis la galerie</button>
      <button class="btn danger" data-action="del-objet">🗑 Supprimer l'objet</button>
    </div>`;

  // Fiche artiste (table `artistes`, migration 0008) — rien affiché si pas de fiche
  const artistePanel = O.artiste ? `
    <details class="panel panel-pad acc" open>
      <summary class="sec-title">🎨 Artiste — ${esc(O.artiste.nom)}</summary>
      <div class="md-body">${mdToHtml(O.artiste.bio_md ?? '')}</div>
      <a class="link-lot" style="display:inline-block;margin-top:12px" href="#/artiste/${encodeURIComponent(O.artiste.nom)}">Voir la fiche artiste →</a>
    </details>` : '';

  // Étude de spécialiste (colonne objets.etude, HO-023) — regard d'expert,
  // distinct de la description factuelle.
  const etudePanel = o.etude ? `
    <details class="panel panel-pad acc" open>
      <summary class="sec-title">Étude de spécialiste</summary>
      <div class="md-body">${mdToHtml(o.etude)}</div>
    </details>` : '';

  const fichePanel = O.fiche ? `
    <details class="panel panel-pad acc">
      <summary class="sec-title">Fiche IA <span style="font-size:12px;font-family:var(--mono);color:var(--ink-3);font-weight:400">v${O.fiche.version}${O.fiche.modele ? ' · ' + esc(O.fiche.modele) : ''} · ${fmtDate(O.fiche.created_at)}</span></summary>
      <div class="md-body">${mdToHtml(O.fiche.contenu_md)}</div>
    </details>` : `
    <div class="panel panel-pad">
      <div class="sec-title">Fiche IA</div>
      <div class="value-sub">${O.jobs.length
        ? '⏳ Recherches en file — le cron les traitera et la fiche apparaîtra ici.'
        : 'Pas encore de fiche. Ajoute des photos puis « Relancer les recherches ».'}</div>
    </div>`;

  // Changelog objet (D-025) : qui a fait quoi, quand, avec quel outil —
  // actions du site (photos, corrections, validation…) + passes IA du cron
  // (identification, marché, Lens…), champs avant→après quand dispo.
  const evRows = O.events.map(ev => {
    const bits = evDetailBits(ev.detail ?? {});
    return `<div class="ev-row">
      <span class="ev-date">${fmtDateTime(ev.created_at)}</span>
      <span class="ev-act">${esc(ACT_LABELS[ev.action] ?? ev.action)}</span>
      ${actorBadge(ev.acteur ?? '')}
      <div class="ev-det">${bits.map(b => `<div class="ev-bit">${b}</div>`).join('')}</div>
    </div>`;
  }).join('');
  const historyPanel = `
    <details class="panel panel-pad acc">
      <summary class="sec-title">Historique <span style="font-size:12px;font-family:var(--mono);color:var(--ink-3);font-weight:400">${O.events.length} événement${O.events.length > 1 ? 's' : ''}</span></summary>
      <div class="ev-list">${evRows || '<div class="value-sub">Aucun événement tracé pour l\'instant.</div>'}</div>
    </details>`;

  const consigneAlert = o.consigne_humain
    ? `<div class="panel panel-pad alert-gentle">📷 Photos à refaire : <span>${esc(o.consigne_humain)}</span></div>`
    : '';

  const pipeBadges = O.pipe ? `
    <div class="pipe-row" role="list" aria-label="Avancement des recherches">
      ${pipeBadge('R1', 'R1 · Identification Kimi', O.pipe.r1)}
      ${pipeBadge('R2', 'R2 · Recherche artiste (Lens)', O.pipe.r2)}
      ${pipeBadge('R3', 'R3 · Rewriting', O.pipe.r3)}
      ${pipeBadge('Valo', 'Valorisation · comparables vendus', O.pipe.valo)}
    </div>` : '';

  $('#objet-body').innerHTML = `
  <div class="obj-layout">
    <div class="obj-main">
      ${consigneAlert}
      ${gallery}
      <div class="panel panel-pad">
        <h1 class="obj-title">${esc(o.titre || 'Sans titre')}</h1>
        ${rebounds ? `<div class="rebounds" style="margin-top:12px">${rebounds}</div>` : ''}
      </div>
      <details class="panel panel-pad acc" open>
        <summary class="sec-title">Identification</summary>
        ${identification}
      </details>
      ${artistePanel}
      ${etudePanel}
      <details class="panel panel-pad acc" open>
        <summary class="sec-title">Vente / estimation</summary>
        ${valeur}
        ${compsList}
      </details>
      ${actions}
      ${fichePanel}
      ${historyPanel}
      <div class="panel panel-pad" id="similar-panel" style="display:none">
        <div class="sec-title">Objets qui s'en rapprochent</div>
        <div class="similar" id="similar-grid"></div>
      </div>
      <div class="disclaimer">${infoSvg}
        Aide à l'estimation et au catalogage — ne constitue pas une expertise certifiée. Au-delà de 2 000 € estimés, une expertise humaine est recommandée (CNES/CNE, commissaire-priseur).
      </div>
    </div>
    <aside class="obj-side">
      <div class="panel panel-pad">
        <div class="side-row">
          <span class="side-id">#${esc(o.id)}</span>
          <span class="st st-${esc(o.statut)}">${STATUTS[o.statut] ?? esc(o.statut)}</span>
        </div>
        <div style="margin-top:14px;display:flex;align-items:center;gap:10px">
          ${confHtml(marks)}
        </div>
        ${pipeBadges}
      </div>
      <div class="loc-card" id="loc-card"></div>
      <div class="panel panel-pad side-dates">
        <div>Capturé le ${fmtDate(o.created_at)} · ${esc(o.source_capture)}</div>
        <div>Modifié le ${fmtDate(o.updated_at)}</div>
        <div>${O.photos.length} photo${O.photos.length > 1 ? 's' : ''}${O.photos.length === 0 ? ' — à prendre' : ''}</div>
      </div>
    </aside>
  </div>`;
  renderLocCard(false);
}

// Carte localisation (lecture / édition inline — simple attribut, pas gravé en correction)
function renderLocCard(edit) {
  const o = S.currentObjet;
  const el = $('#loc-card');
  if (!el) return;
  if (!edit) {
    el.innerHTML = `
      <div class="loc-line"><span class="k">Zone</span><span class="v">${o.zone ? esc(o.zone) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line"><span class="k">Contenant</span><span class="v">${o.contenant ? esc(o.contenant) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line"><span class="k">Position</span><span class="v">${o.position ? esc(o.position) : '<span style="color:var(--ink-3)">—</span>'}</span></div>
      <div class="loc-line" style="justify-content:flex-end;margin-top:6px"><button class="edit-btn hide-lecteur" data-action="loc-edit">✏️ modifier</button></div>`;
  } else {
    el.innerHTML = `
      <div class="loc-line"><span class="k">Zone</span><input id="loc-zone" value="${esc(o.zone ?? '')}" placeholder="Garage…"></div>
      <div class="loc-line"><span class="k">Contenant</span><input id="loc-contenant" value="${esc(o.contenant ?? '')}" placeholder="Carton 33…"></div>
      <div class="loc-line"><span class="k">Position</span><input id="loc-position" value="${esc(o.position ?? '')}" placeholder="étagère haute…"></div>
      <div class="loc-line" style="justify-content:flex-end;gap:6px;margin-top:8px">
        <button class="edit-btn" data-action="loc-cancel">annuler</button>
        <button class="edit-btn" data-action="loc-save" style="font-weight:700">✓ enregistrer</button>
      </div>`;
  }
}

async function loadSimilar(o) {
  const panel = $('#similar-panel');
  if (!panel) return;
  if (!o.categorie) return;
  const { data } = await sb.from('objets').select('*')
    .eq('owner_id', S.tenantId).eq('categorie', o.categorie).neq('id', o.id)
    .order('created_at', { ascending: false }).limit(3);
  if (!data?.length) return;
  // Miniatures 480 px (plusieurs Mo → ~30 Ko par vignette — audit 2026-08-24)
  const { data: ph } = await sb.from('photos').select('objet_id,storage_path,thumb_path')
    .eq('owner_id', S.tenantId).in('objet_id', data.map(s => s.id)).order('created_at');
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

// Activation clavier des vignettes/cartes non-boutons (div role="button") :
// Enter/Espace déclenche le même handler que le clic (délégation ci-dessous).
$('#objet-body').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.thumb[data-action], .sim-card[data-action]');
  if (!el || el !== e.target) return; // ne pas voler l'activation des vrais boutons internes
  e.preventDefault();
  el.click();
});

// Actions qui modifient des données — bloquées pour un lecteur (double garde
// avec la RLS 0012 ; l'UI est déjà masquée via .hide-lecteur).
const ACTIONS_MUTANTES = new Set([
  'cut-photo', 'del-photo', 'del-objet', 'add-photo', 'take-photo',
  'loc-edit', 'loc-save', 'valider', 'corriger', 'corr-save', 'relancer',
  'del-comp', 'cover-photo', 'valo',
]);

$('#objet-body').addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (ACTIONS_MUTANTES.has(act) && !canWrite()) return;
  const o = S.currentObjet;

  if (act === 'thumb') {
    O.photos.forEach((p, i) => { p.sel = i === Number(el.dataset.idx); });
    renderObjet();
  }
  else if (act === 'zoom') {
    const sel = selPhoto();
    if (!sel?.url) return;
    openLightbox(sel);
  }
  else if (act === 'cut-photo') {
    const sel = selPhoto();
    if (!sel?.url) return;
    openLightbox(sel, 'cut');
  }
  else if (act === 'cover-photo') {
    const sel = selPhoto();
    if (!sel?.url || sel.couverture || isVideo(sel)) return;
    await sb.from('photos').update({ couverture: false }).eq('owner_id', S.tenantId).eq('objet_id', o.id);
    const { error } = await sb.from('photos').update({ couverture: true }).eq('owner_id', S.tenantId).eq('id', sel.id);
    if (error) { toast(error.message, true); return; }
    logEvent('couverture', { photo: sel.storage_path });
    toast('✓ Photo de couverture');
    S.photoMap = {};
    await hooks.recharger(o.id);
  }
  else if (act === 'del-photo') { deletePhoto(); }
  else if (act === 'del-objet') { deleteObjet(); }
  else if (act === 'del-comp') { deleteComp(el.dataset.cid); }
  else if (act === 'add-photo') { $('#file-add-photo').click(); }
  else if (act === 'take-photo') { openCamera('objet', { onClose: onCamClose }); }
  else if (act === 'rebound') {
    S.filters.q = norm(el.dataset.val); S.filters.cats = []; S.filters.list = '';
    S.filters.prixMin = null; S.filters.prixMax = null;
    $('#search').value = el.dataset.val;
    $('#prix-min').value = ''; $('#prix-max').value = '';
    location.hash = '#/';
  }
  else if (act === 'similar') { location.hash = '#/objet/' + encodeURIComponent(el.dataset.oid); }
  else if (act === 'loc-edit') { renderLocCard(true); }
  else if (act === 'loc-cancel') { renderLocCard(false); }
  else if (act === 'loc-save') {
    const updates = {
      zone: $('#loc-zone').value.trim() || null,
      contenant: $('#loc-contenant').value.trim() || null,
      position: $('#loc-position').value.trim() || null,
    };
    const { error } = await sb.from('objets').update(updates).eq('owner_id', S.tenantId).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    Object.assign(S.currentObjet, updates);
    logEvent('localisation', { champs: Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, { apres: v }])) });
    renderLocCard(false);
    toast('Localisation mise à jour');
  }
  else if (act === 'valider') {
    const { error } = await sb.from('objets').update({ statut: 'validee' }).eq('owner_id', S.tenantId).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    logEvent('validation', { note: 'confiance 4/4 (ground truth)' });
    toast(`#${o.id} validée ✓ — confiance 4/4 (ground truth)`);
    loadObjet(o.id); S.refreshHeader?.();
  }
  else if (act === 'corriger') { O.editing = true; renderObjet(); }
  else if (act === 'corr-cancel') { O.editing = false; renderObjet(); }
  else if (act === 'corr-save') { saveCorrections(); }
  else if (act === 'relancer') {
    if (!confirm(`Relancer les recherches de #${o.id} ?\n\nR1 (Kimi, ~40 s) repart si des photos ont changé, puis R2 (Lens) est enfilée — le cron la prend sous ~2 min.`)) return;
    el.disabled = true;
    el.textContent = '⏳ R1 en cours…';
    const force = o.statut === 'validee';
    const r = await lancerRecherches(o.id, { force });
    if (r.ok) {
      logEvent('relance', { force, certain: r.certain ?? null });
      toast(r.skip
        ? `R1 sautée (${r.skip}) — R2 (Lens) en file`
        : `R1 terminée${r.certain ? ' — auteur certain ✓' : ' — doute : analyse versée à la description'} · R2 (Lens) en file`);
    } else if (r.reseau) {
      // Edge injoignable (crash worker, hors-ligne…) : repli cron, comme à la capture.
      const n = await enqueueJobs([o.id], 'r1');
      if (n) toast('R1 en file — le cron la prend sous ~2 min');
    }
    loadObjet(o.id);
  }
  else if (act === 'valo') {
    const { error } = await sb.from('objets').update({ valo_due: true, tentative_valo_at: null })
      .eq('owner_id', S.tenantId).eq('id', o.id);
    if (error) { toast(error.message, true); return; }
    logEvent('relance', { type: 'valorisation' });
    toast('Valorisation en file — batch dédié (~10 min)');
    loadObjet(o.id);
  }
});

// Overlay bloquant de progression d'upload (retour terrain Alain/Yann 2026-08-27 :
// sur mobile en réseau lent, 20-30 s SANS aucun retour visuel → on croit que ça
// a planté, on quitte, la photo « n'arrive jamais »). L'écran est bloqué le temps
// de l'envoi ; « Annuler » rend la main immédiatement : le fichier en cours peut
// encore aboutir, les suivants sont abandonnés (onProgress → false stoppe la
// boucle d'uploadPhotosFor).
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
    ui.close(); // rend la main tout de suite : l'envoi en cours finit en tâche de fond
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
    // D-057 : aucune relance automatique — l'humain clique « Relancer les
    // recherches » quand sa session de photos est terminée.
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

// Branchement des hooks partagés : photos.js et edition.js déclenchent le
// rechargement/rendu sans importer ce module (pas de cycle d'imports).
hooks.recharger = loadObjet;
hooks.rendre = renderObjet;
