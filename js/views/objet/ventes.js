// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/ventes.js : écran Ventes & estimation (stub HO-046).
// Version complète avec comparables, fourchette, écarté/rétabli : HO-049.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { fmtNum, fmtDate } from '../../core/format.js';
import { O, hooks } from './etat.js';

export function rendre(el) {
  const o = S.currentObjet;
  const n = O.comps.filter(c => !c.exclu).length;
  el.innerHTML = `
    <div class="obj-screen">
      <nav class="obj-nav">
        <button class="obj-nav-back" data-action="nav" data-ecran="hub">← Fiche</button>
        <span class="obj-nav-title">Ventes</span>
        <span class="obj-nav-meta">#${esc(o.id)}</span>
      </nav>
      <div class="obj-screen-body">
        <div class="obj-stub">Écran en chantier — HO-049</div>
        <div class="obj-vente-count">${n} comparable${n > 1 ? 's' : ''}</div>
        ${O.comps.filter(c => !c.exclu).map(c => `
          <div class="obj-comp-line">
            <span class="obj-comp-house">${esc(c.maison ?? '—')}</span>
            <span class="obj-comp-lot">${esc(c.lot ?? '—')}</span>
            <span class="obj-comp-prix">${c.prix != null ? fmtNum(c.prix) + ' €' : '—'}</span>
            <span class="obj-comp-date">${fmtDate(c.date_vente)}</span>
          </div>`).join('')}
      </div>
    </div>`;
  el.querySelector('[data-action="nav"]')?.addEventListener('click', () => hooks.naviguer('hub'));
}
