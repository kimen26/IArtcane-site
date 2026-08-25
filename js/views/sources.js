// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/sources.js : écran Sources (cartographie des accès, D-028)
// Miroir structuré de docs/cartographie-sources.md (site/data/sources.json).
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, emptyHtml } from '../core/dom.js';
import { loadViewCss } from '../core/css.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('sources');

let sourcesCache = null;

export function mount() {
  loadSources();
}

async function loadSources() {
  const body = $('#sources-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  try {
    sourcesCache ??= await (await fetch('data/sources.json')).json();
  } catch {
    body.innerHTML = emptyHtml('Sources indisponibles', 'data/sources.json introuvable ou invalide.');
    return;
  }
  const s = sourcesCache;
  const unBadge = code => (code && s.legende[code])
    ? `<span class="src-badge acc-${esc(code.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" title="${esc(s.legende[code])}">${esc(code)}</span>`
    : '';
  // Une source peut cumuler deux modes d'accès (ex. « API/NAV-AUTO » pour RKD) :
  // un badge par mode, comme dans docs/cartographie-sources.md.
  const badge = codes => String(codes ?? '').split('/').map(c => unBadge(c.trim())).filter(Boolean).join(' ');
  body.innerHTML = `
    <details class="panel panel-pad acc">
      <summary class="sec-title">Légende des accès</summary>
      <div class="src-legende">${Object.entries(s.legende).map(([k, v]) =>
        `<div class="src-leg-row">${badge(k)}<span>${esc(v)}</span></div>`).join('')}</div>
    </details>
    ${(s.sections ?? []).map(sec => `
      <div class="panel panel-pad" style="margin-top:18px">
        <div class="sec-title">${esc(sec.titre)}</div>
        ${sec.intro ? `<div class="value-sub" style="margin-bottom:12px">${esc(sec.intro)}</div>` : ''}
        <table class="src-table">
          <thead><tr><th>Source</th><th>Accès</th><th>Coût</th><th>Usage</th></tr></thead>
          <tbody>${(sec.entrees ?? []).map(e => `<tr>
            <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener"><b>${esc(e.nom)}</b> ↗</a>` : `<b>${esc(e.nom)}</b>`}</td>
            <td>${badge(e.acces)}</td>
            <td>${esc(e.cout ?? '—')}</td>
            <td>${esc(e.usage ?? '')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`).join('')}`;
}
