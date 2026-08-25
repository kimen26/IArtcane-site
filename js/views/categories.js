// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/categories.js : Catégories & familles de prompts (D-030)
// Consultation de la taxonomie canonique + blocs prompts (site/data/familles.json,
// généré par infra/build-site-data.py). Édition = chantier table `prompts`.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, emptyHtml } from '../core/dom.js';
import { catEmoji, mdToHtml } from '../core/format.js';
import { loadViewCss } from '../core/css.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('categories');

let famillesCache = null;

export function mount() {
  loadCategories();
}

async function loadCategories() {
  const body = $('#categories-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  try {
    famillesCache ??= await (await fetch('data/familles.json')).json();
  } catch {
    body.innerHTML = emptyHtml('Données indisponibles', 'data/familles.json introuvable — lancer infra/build-site-data.py pour le régénérer.');
    return;
  }
  const d = famillesCache;
  body.innerHTML = `
    <div class="note" style="margin-bottom:18px">Consultation — l'édition des prompts arrivera avec le menu admin (table <code>prompts</code>).</div>
    <div class="panel panel-pad">
      <div class="sec-title">Taxonomie — ${(d.categories_canon ?? []).length} catégories canoniques</div>
      <div class="fam-list">${(d.categories_canon ?? []).map(cat => {
        const fam = d.mapping?.[cat];
        const b = fam ? d.familles?.[fam] : null;
        return `<details class="acc fam-row">
          <summary><span class="fam-emoji">${catEmoji(cat)}</span><span class="fam-cat">${esc(cat)}</span>
          ${b ? `<span class="chip fam-chip">${esc(fam)} · ${esc(b.version)}</span>` : '<span class="chip fam-chip">—</span>'}</summary>
          ${b ? `<div class="md-body fam-md">${mdToHtml(b.contenu_md)}</div>` : '<div class="fam-md value-sub">Aucun bloc famille ne couvre cette catégorie.</div>'}
        </details>`;
      }).join('')}</div>
    </div>
    <div class="panel panel-pad" style="margin-top:18px">
      <div class="sec-title">Troncs communs</div>
      <div class="fam-list">${Object.values(d.bases ?? {}).map(b => `
        <details class="acc fam-row">
          <summary><span class="fam-emoji">📐</span><span class="fam-cat">${esc(b.nom)}</span><span class="chip fam-chip">${esc(b.version)}</span></summary>
          <div class="md-body fam-md">${mdToHtml(b.contenu_md)}</div>
        </details>`).join('')}</div>
    </div>`;
}
