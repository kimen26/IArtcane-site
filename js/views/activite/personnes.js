// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/activite/personnes.js : onglet A3 · Par personne (HO-057)
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { ACT_LABELS } from '../../core/format.js';
import { A, CRON_ACTIONS, SITE_PLUR, kindOf, since, setOnglet, setFiltreActeur } from './etat.js';

export function renderPersonnes(container) {
  // Groupement par acteur
  const map = new Map();
  // Le cron est un "acteur" synthétique
  for (const e of A.evts) {
    const actor = e.acteur || 'site';
    const isCron = CRON_ACTIONS.has(e.action);
    const key = isCron ? 'cron' : actor;
    const nom = isCron ? 'Run cron' : actor;
    if (!map.has(key)) {
      map.set(key, {
        key,
        nom,
        isCron,
        gestes: new Map(),
        total: 0,
        last: e.created_at,
      });
    }
    const p = map.get(key);
    p.total++;
    if (new Date(e.created_at) > new Date(p.last)) p.last = e.created_at;
    const label = plurLabel(e.action);
    p.gestes.set(label, (p.gestes.get(label) || 0) + 1);
  }

  const personnes = [...map.values()].map(p => ({
    ...p,
    gestes: [...p.gestes.entries()].map(([n, v]) => ({ n, v })).sort((a, b) => b.v - a.v),
    role: p.isCron ? 'machine' : 'humain',
    avatar: p.isCron ? '↻' : (p.nom.charAt(0).toUpperCase() || '?'),
  }));

  // Rythme de la semaine
  const sem = buildSemaine();

  container.innerHTML = `
    <div class="act-panels">
      ${personnes.map(p => cartePersonneHtml(p)).join('') || '<div class="act-empty">Aucune activité humaine ou cron sur la période</div>'}
      ${rythmeHtml(sem)}
    </div>`;

  container.querySelectorAll('[data-action="filtrer-acteur"]').forEach(btn => {
    btn.addEventListener('click', () => {
      setFiltreActeur(btn.dataset.acteur);
      setOnglet('objets');
    });
  });
}

function cartePersonneHtml(p) {
  const maxG = Math.max(1, ...p.gestes.map(g => g.v));
  const ini = esc(p.avatar);
  return `
    <div class="act-card act-personne">
      <div class="act-personne-head">
        <div class="act-avatar ${p.isCron ? 'cron' : 'humain'}">${ini}</div>
        <div class="act-personne-meta">
          <div class="act-personne-name">${esc(p.nom)}</div>
          <div class="act-personne-role">${p.role} · ${p.total} geste${p.total > 1 ? 's' : ''}</div>
        </div>
        <div class="act-personne-last">${since(p.last)}</div>
      </div>
      <div class="act-personne-gestes">
        ${p.gestes.map(g => `
          <div class="act-geste">
            <span class="act-geste-name">${esc(g.n)}</span>
            <span class="act-geste-bar"><span style="width:${Math.round((g.v / maxG) * 100)}%"></span></span>
            <span class="act-geste-v">${g.v}</span>
          </div>
        `).join('')}
      </div>
      <button class="act-personne-link" data-action="filtrer-acteur" data-acteur="${esc(p.key)}">
        Voir ses ${p.total} modification${p.total > 1 ? 's' : ''} <span class="act-chevron"></span>
      </button>
    </div>`;
}

function rythmeHtml(sem) {
  const max = Math.max(1, ...sem.map(d => d.hum + d.ia));
  return `
    <div class="act-card">
      <div class="act-card-head"><span class="act-card-title">Rythme de la semaine</span></div>
      <div class="act-semaine">
        ${sem.map(d => `
          <div class="act-jour">
            <div class="act-jour-bars">
              <span class="hum" style="height:${Math.round((d.hum / max) * 40)}px"></span>
              <span class="ia" style="height:${Math.round((d.ia / max) * 40)}px"></span>
            </div>
            <div class="act-jour-label">${esc(d.label)}</div>
          </div>
        `).join('')}
      </div>
      <div class="act-semaine-leg">
        <span><i class="act-dot hum"></i>humain</span>
        <span><i class="act-dot ia"></i>IA</span>
      </div>
    </div>`;
}

function buildSemaine() {
  const jours = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400e3);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString();
    const dayEvts = A.evts.filter(e => e.created_at >= start && e.created_at < end);
    const hum = dayEvts.filter(e => kindOf(e.acteur) === 'humain').length;
    const ia = dayEvts.filter(e => kindOf(e.acteur) !== 'humain').length;
    out.push({ label: jours[d.getDay()], hum, ia });
  }
  return out;
}

function plurLabel(action) {
  if (CRON_ACTIONS.has(action)) {
    return ACT_LABELS[action] || action;
  }
  const [s] = SITE_PLUR[action] ?? [ACT_LABELS[action] ?? action];
  return s;
}
