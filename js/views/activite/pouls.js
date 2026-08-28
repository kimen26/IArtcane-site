// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/activite/pouls.js : onglet A1 · Pouls (HO-057)
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import {
  A, FENETRES, CRON_ACTIONS, trancheKey,
  majCatalogue, majArtistes, lancerFileAttente,
} from './etat.js';

export function renderPouls(container) {
  const fen = FENETRES.find(f => f.id === A.fenetre) ?? FENETRES[2];

  // ─── Bandeau d'état ────────────────────────────────────────────────────────
  const lastProcessed = A.jobs.length
    ? Math.max(...A.jobs.map(j => new Date(j.processed_at || j.created_at).getTime()))
    : null;
  const lastCron = A.evts.filter(e => CRON_ACTIONS.has(e.action))[0]?.created_at;
  const lastRun = lastProcessed || lastCron;
  const nErr = A.jobs.filter(j => j.statut === 'erreur').length;
  const ok = nErr === 0;
  const statusTitle = ok ? 'Tout va bien' : `${nErr} erreur${nErr > 1 ? 's' : ''}`;
  const subLine = [
    lastRun ? `Dernier run ${since(lastRun)}` : 'Aucun run sur la période',
    `${nErr} erreur · ${fen.label}`,
  ].join(' · ');

  // ─── Passes IA : histogramme + compteurs ───────────────────────────────────
  const cronEvts = A.evts.filter(e => CRON_ACTIONS.has(e.action));
  const histogram = buildHistogram(cronEvts, fen);
  const kpiIdent = cronEvts.filter(e => e.action === 'identification').length;
  const kpiMarche = cronEvts.filter(e => e.action === 'passe_marche').length;
  const kpiHumain = A.evts.filter(e => !CRON_ACTIONS.has(e.action)).length;
  const maxH = Math.max(1, ...histogram.map(b => b.n));

  // ─── État du catalogue ────────────────────────────────────────────────────
  const total = A.objets.length;
  const withPhotos = new Set(A.photos.map(p => p.objet_id));
  const sansPhoto = A.objets.filter(o => !withPhotos.has(o.id)).length;
  const completes = A.objets.filter(o => o.statut === 'validee' || o.statut === 'analyse').length;
  const enAttente = A.objets.filter(o => o.statut === 'a_completer').length;
  const autre = total - completes - enAttente - sansPhoto;
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString();
  const plusCetteSemaine = A.objets.filter(o => (o.statut === 'validee' || o.statut === 'analyse') && o.updated_at && o.updated_at >= weekAgo).length;

  // File d'attente : objets sans estimation (prix_bas null) et non déjà en file
  const pendingIds = new Set(A.jobs.filter(j => ['en_attente', 'en_cours'].includes(j.statut)).map(j => j.objet_id));
  const fileAttente = A.objets.filter(o => o.prix_bas == null && !pendingIds.has(o.id));

  const html = `
    <div class="act-panels">
      ${bandeauHtml(statusTitle, subLine, ok)}
      ${passesHtml(histogram, maxH, kpiIdent, kpiMarche, kpiHumain)}
      ${catalogueHtml(total, completes, enAttente, sansPhoto, autre, plusCetteSemaine, fileAttente)}
      ${actionsHtml()}
    </div>`;

  container.innerHTML = html;
  bindActions(container, fileAttente);
}

function bandeauHtml(title, sub, ok) {
  return `
    <div class="act-status ${ok ? 'ok' : 'warn'}">
      <div class="act-status-icon">${ok ? '<span class="act-check"></span>' : '<span class="act-warn">!</span>'}</div>
      <div class="act-status-txt">
        <div class="act-status-title">${esc(title)}</div>
        <div class="act-status-sub">${esc(sub)}</div>
      </div>
    </div>`;
}

function passesHtml(histo, maxH, ident, marche, humain) {
  const bars = histo.map((b, i) => {
    const h = b.n ? Math.max(3, Math.round((b.n / maxH) * 74)) : 3;
    const cls = i === histo.length - 1 ? 'current' : (b.n ? 'fill' : 'empty');
    return `<div class="act-bar ${cls}" style="--h:${h}px" title="${esc(b.label)} : ${b.n}"></div>`;
  }).join('');
  const total = histo.reduce((s, b) => s + b.n, 0);
  return `
    <div class="act-card">
      <div class="act-card-head">
        <span class="act-card-title">Passes IA</span>
        <span class="act-card-meta">${total} au total</span>
      </div>
      <div class="act-histo">${bars}</div>
      <div class="act-histo-axis"><span>${histo[0]?.label ?? ''}</span><span>aujourd'hui</span></div>
      <div class="act-kpis">
        <div class="act-kpi"><div class="act-kpi-value">${ident}</div><div class="act-kpi-label">identifications</div></div>
        <div class="act-kpi"><div class="act-kpi-value">${marche}</div><div class="act-kpi-label">passes marché</div></div>
        <div class="act-kpi"><div class="act-kpi-value">${humain}</div><div class="act-kpi-label">gestes humains</div></div>
      </div>
    </div>`;
}

function catalogueHtml(total, completes, enAttente, sansPhoto, autre, plusSem, fileAttente) {
  const parts = [];
  if (completes) parts.push({ cls: 'complete', n: completes, label: 'fiche' + (completes > 1 ? 's' : '') + ' complète' + (completes > 1 ? 's' : '') });
  if (enAttente) parts.push({ cls: 'wait', n: enAttente, label: 'statut' + (enAttente > 1 ? 's' : '') + ' en attente' });
  if (sansPhoto) parts.push({ cls: 'nophoto', n: sansPhoto, label: 'sans photo' });
  if (autre > 0) parts.push({ cls: 'other', n: autre, label: 'autre' + (autre > 1 ? 's' : '') });
  const max = Math.max(1, total);
  const bar = parts.map(p => `<span class="act-stack-${p.cls}" style="width:${(p.n / max * 100).toFixed(2)}%"></span>`).join('');
  const legend = parts.map(p => `
    <div class="act-leg-item">
      <span class="act-dot ${p.cls}"></span>
      <span>${p.n} ${p.label}</span>
      ${p.cls === 'complete' && plusSem ? `<span class="act-plus">+${plusSem} cette semaine</span>` : ''}
    </div>`).join('');

  const fileHtml = fileAttente.length ? `
    <div class="act-file">
      <div class="act-file-txt"><strong>${fileAttente.length}</strong> objet${fileAttente.length > 1 ? 's' : ''} attendent une estimation. Une passe marché prend environ 4 minutes.</div>
      <button class="act-btn-navy" data-action="lancer-file">Lancer</button>
    </div>` : '';

  return `
    <div class="act-card">
      <div class="act-card-head">
        <span class="act-card-title">État du catalogue</span>
        <span class="act-card-meta">${total} objet${total > 1 ? 's' : ''}</span>
      </div>
      <div class="act-stackbar">${bar || '<span class="act-stack-empty"></span>'}</div>
      <div class="act-legend">${legend}</div>
      ${fileHtml}
    </div>`;
}

function actionsHtml() {
  return `
    <div class="act-card">
      <div class="act-card-head"><span class="act-card-title">Actions</span></div>
      <p class="act-actions-sub">Forcer des passes IA sans attendre le rythme du cron — les objets déjà en file sont ignorés.</p>
      <div class="act-actions-btns">
        <button class="act-btn-primary" data-action="maj-catalogue">MAJ générale</button>
        <button class="act-btn-outline" data-action="maj-artistes">Fiches artistes</button>
      </div>
    </div>`;
}

function buildHistogram(liste, fen) {
  const buckets = [];
  const now = new Date();
  const totalSlots = fen.tranches;
  for (let i = totalSlots - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * (fen.id === '24h' ? 4 * 3600e3 : 24 * 3600e3));
    const tk = trancheKey(t, fen.id);
    buckets.push({ key: tk.key, label: tk.label, n: 0, date: t });
  }
  for (const e of liste) {
    const tk = trancheKey(e.created_at, fen.id);
    const b = buckets.find(x => x.key === tk.key);
    if (b) b.n++;
  }
  return buckets;
}

function since(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(diff / 60000));
  if (m < 2) return 'il y a un instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

function bindActions(container, fileAttente) {
  container.querySelector('[data-action="maj-catalogue"]')?.addEventListener('click', majCatalogue);
  container.querySelector('[data-action="maj-artistes"]')?.addEventListener('click', majArtistes);
  container.querySelector('[data-action="lancer-file"]')?.addEventListener('click', () => lancerFileAttente(fileAttente));
}
