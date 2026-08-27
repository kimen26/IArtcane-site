// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/rayon.js : un rayon (catégorie) en plein écran (HO-043)
// Grille masonry de tous les objets du rayon, filtre courant appliqué
// (recherche + bornes prix — copie locale du prédicat, core gelé).
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, norm, emptyHtml } from '../core/dom.js';
import { S } from '../core/state.js';
import { catCanon, cardHtml } from '../core/format.js';
import { sb, loadPhotoMap } from '../core/data.js';
import { loadViewCss } from '../core/css.js';

// CSS de la vue chargé par la vue (D-041).
await loadViewCss('rayon');

export async function mount(cat) {
  const body = $('#rayon-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  // Arrivée directe par lien : le cache n'est pas encore là — mêmes requêtes
  // que collection.js (copie assumée, core gelé).
  if (!S.collection?.length) {
    const { data, error } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).order('created_at', { ascending: false });
    if (error) { body.innerHTML = ''; return; }
    S.collection = data ?? [];
    await loadPhotoMap();
  }
  const q = S.filters?.q ?? '';
  const match = o => {
    if (q) {
      const hay = norm([o.id, o.titre, o.auteur, o.categorie, o.sous_categorie, o.zone].filter(Boolean).join(' '));
      if (!q.split(/\s+/).filter(Boolean).every(tok => hay.includes(tok))) return false;
    }
    if (S.filters?.prixMin != null || S.filters?.prixMax != null) {
      if (o.prix_bas == null || o.prix_haut == null) return false;
      if (o.prix_haut < (S.filters.prixMin ?? -Infinity) || o.prix_bas > (S.filters.prixMax ?? Infinity)) return false;
    }
    return true;
  };
  const items = S.collection.filter(o => (catCanon(o.categorie) || 'Sans catégorie') === cat && match(o));
  if (!items.length) {
    body.innerHTML = emptyHtml(`Rien dans le rayon « ${esc(cat)} »`, 'Essaie un autre rayon, ou retire les filtres actifs.');
    return;
  }
  body.innerHTML = `<div class="sec-title page-title">${esc(cat)} <span class="n rayon-n-titre">${items.length}</span></div>
    <div class="grid">${items.map(cardHtml).join('')}</div>`;
  $$('.card', body).forEach(c => {
    const go = () => { location.hash = '#/objet/' + encodeURIComponent(c.dataset.oid); };
    c.addEventListener('click', go);
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}
