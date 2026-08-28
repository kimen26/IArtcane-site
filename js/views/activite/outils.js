// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/activite/outils.js : onglet A2 · Par outil (HO-057)
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { A, CRON_ACTIONS, since } from './etat.js';

export function renderOutils(container) {
  const cronEvts = A.evts.filter(e => CRON_ACTIONS.has(e.action));

  // Qui a travaillé : groupement par "acteur + modèle"
  const outilMap = new Map();
  for (const e of cronEvts) {
    const modele = e.detail?.modele || '';
    const nom = modele ? `${e.acteur} ${modele}` : e.acteur;
    if (!outilMap.has(nom)) {
      outilMap.set(nom, { nom, acteur: e.acteur, modele, count: 0, last: e.created_at, role: roleFor(e) });
    }
    const o = outilMap.get(nom);
    o.count++;
    if (new Date(e.created_at) > new Date(o.last)) o.last = e.created_at;
  }
  const outils = [...outilMap.values()].sort((a, b) => b.count - a.count);
  const maxO = Math.max(1, ...outils.map(o => o.count));

  // Prompts en service
  const promptMap = new Map();
  for (const e of cronEvts) {
    const pv = e.detail?.prompt_version;
    if (!pv) continue;
    const name = e.detail?.prompt_name || '(nom inconnu)';
    const key = `${name}|${pv}`;
    if (!promptMap.has(key)) promptMap.set(key, { name, version: pv, objs: new Set() });
    if (e.objet_id) promptMap.get(key).objs.add(e.objet_id);
  }
  const prompts = [...promptMap.values()]
    .map(p => ({ ...p, n: p.objs.size }))
    .sort((a, b) => b.n - a.n);

  // Maisons de vente citées
  const maisonCount = new Map();
  for (const c of A.comps) {
    if (c.source_type === 'en_vente') continue;
    const m = c.maison || 'Inconnue';
    maisonCount.set(m, (maisonCount.get(m) || 0) + 1);
  }
  const maisons = [...maisonCount.entries()]
    .map(([n, v]) => ({ n, v }))
    .sort((a, b) => b.v - a.v);
  const maxM = Math.max(1, ...maisons.map(m => m.v));
  const totalComps = maisons.reduce((s, m) => s + m.v, 0);

  container.innerHTML = `
    <div class="act-panels">
      <div class="act-card">
        <div class="act-card-head"><span class="act-card-title">Qui a travaillé</span></div>
        <div class="act-outils-list">
          ${outils.map(o => outilRowHtml(o, maxO)).join('') || '<div class="act-empty-mini">Aucune action cron sur la période</div>'}
        </div>
      </div>

      <div class="act-card">
        <div class="act-card-head"><span class="act-card-title">Prompts en service</span></div>
        <p class="act-actions-sub">Les versions ne s'affichent plus dans le journal : elles se lisent ici, avec le nombre d'objets traités.</p>
        <div class="act-prompts">
          ${prompts.map(p => promptPillHtml(p)).join('') || '<div class="act-empty-mini">Aucune version de prompt sur la période</div>'}
        </div>
      </div>

      <div class="act-card">
        <div class="act-card-head">
          <span class="act-card-title">Maisons de vente citées</span>
          <span class="act-card-meta">${totalComps} comparable${totalComps > 1 ? 's' : ''}</span>
        </div>
        <div class="act-maisons">
          ${maisons.map(m => maisonRowHtml(m, maxM)).join('') || '<div class="act-empty-mini">Aucune maison sur la période</div>'}
        </div>
      </div>
    </div>`;
}

function roleFor(e) {
  switch (e.action) {
    case 'identification': return 'identification';
    case 'passe_marche': return 'valorisation';
    case 'lens':
    case 'lens R2': return 'recherche visuelle';
    case 'rewriting': return 'mise au propre des fiches';
    case 'artiste_maj': return 'fiches artistes';
    case 'photos_manquantes': return 'recommandations photos';
    default: return ACT_LABELS[e.action] || e.action;
  }
}

function outilRowHtml(o, max) {
  const pct = Math.round((o.count / max) * 100);
  const detail = o.modele
    ? `${o.count} appels · dernier ${since(o.last)}`
    : `${o.count} appel${o.count > 1 ? 's' : ''} · dernier ${since(o.last)}`;
  return `
    <div class="act-outil">
      <div class="act-outil-head">
        <span class="act-outil-name">${esc(o.nom)}</span>
        <span class="act-outil-role">${esc(o.role)}</span>
        <span class="act-outil-v">${o.count}</span>
      </div>
      <div class="act-outil-bar"><span style="width:${pct}%"></span></div>
      <div class="act-outil-detail">${esc(detail)}</div>
    </div>`;
}

function promptPillHtml(p) {
  return `
    <div class="act-prompt-pill">
      <span class="act-prompt-name">${esc(p.name)}</span>
      <span class="act-prompt-version">${esc(p.version)} · ${p.n} objet${p.n > 1 ? 's' : ''}</span>
    </div>`;
}

function maisonRowHtml(m, max) {
  const pct = Math.round((m.v / max) * 100);
  return `
    <div class="act-maison">
      <span class="act-maison-name">${esc(m.n)}</span>
      <span class="act-maison-bar"><span style="width:${pct}%"></span></span>
      <span class="act-maison-v">${m.v}</span>
    </div>`;
}
