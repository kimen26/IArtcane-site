// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/format.js : taxonomie, formats, markdown, libellés (D-039)
// Présentation pure (+ cardHtml, composant carte partagé collection/artistes).
// ═══════════════════════════════════════════════════════════════════════════
import { esc, norm } from './dom.js';
import { S } from './state.js';

// Taxonomie canonique v1 (Q15) — la même liste est imposée aux prompts IA
// (Edge Function identify-photo + runbook cron). catCanon() rabat les variantes
// du LLM (« ceramiques », « Céramique »…) sur la forme canonique d'affichage.
const CATS_CANON = {
  tableau: 'Tableau', peinture: 'Tableau', gravure: 'Gravure / estampe', estampe: 'Gravure / estampe',
  dessin: 'Dessin', photographie: 'Photographie', photo: 'Photographie', sculpture: 'Sculpture',
  ceramique: 'Céramique', verrerie: 'Verrerie', verre: 'Verrerie', mobilier: 'Mobilier',
  montre: 'Montre / horlogerie', horlogerie: 'Montre / horlogerie', bijou: 'Bijou',
  argenterie: 'Argenterie / métal', metal: 'Argenterie / métal', luminaire: 'Luminaire',
  textile: 'Textile / tapisserie', tapisserie: 'Textile / tapisserie', livre: 'Livre / document',
  monnaie: 'Monnaie / médaille', medaille: 'Monnaie / médaille', instrument: 'Instrument',
  jouet: 'Jouet', curiosite: 'Curiosité', 'art asiatique': 'Art asiatique', 'art tribal': 'Art tribal', autre: 'Autre',
};
export function catCanon(c) {
  const k = norm(c).trim().replace(/s$/, '');
  if (!k) return c;
  return CATS_CANON[k] ?? (String(c).trim().charAt(0).toUpperCase() + String(c).trim().slice(1));
}

// Rattachement objet ↔ fiche artiste : l'auteur saisi par l'IA n'est presque
// jamais le nom canonique exact (« Atelier Roger Capron (signé) », « attribué
// à Alain Maunier », « Signé « DODIK » (…) ») — on matche (normalisé, sans
// accents) sur le nom complet OU sur le nom de cœur (avant parenthèses).
export const auteurMatch = (auteur, nom) => {
  if (!auteur || !nom) return false;
  const a = norm(auteur), n = norm(nom);
  if (a === n || a.includes(n)) return true;
  const core = n.split(/[("«]/)[0].trim();
  return core.length >= 5 && a.includes(core);
};

export const fmtNum = n => Number(n).toLocaleString('fr-FR');
export const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
export const plur = (n, s, p) => `${n} ${n > 1 ? p : s}`;
export const pinSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';
export const infoSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>';

export const STATUTS = {
  capture: 'Capturé', en_file: 'En file', analyse: 'Analyse…', fiche_prete: 'Fiche prête',
  a_completer: 'À compléter', validee: 'Validée', contestee: 'Contestée',
};
export const ST_COLOR = {
  capture: '#9A6B1A', en_file: '#2456E0', analyse: '#2456E0', fiche_prete: '#6D4AC8',
  a_completer: '#9A6B1A', validee: '#1E7A46', contestee: '#B3261E',
};
// Confiance comptée 0–4 : 4/4 = validée par un humain (ground truth), sinon 1-3 selon l'IA.
export const confMarks = o => o.statut === 'validee' ? 4 : ({ haute: 3, moyenne: 2, basse: 1 }[o.confiance] ?? 0);
export const confHtml = n => `<span class="conf">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}<span class="conf-label">${n}/4</span></span>`;

export function catEmoji(cat) {
  const c = norm(cat);
  if (/peint|tableau|huile|aquarel/.test(c)) return '🖼️';
  if (/montre|horlog|gousset/.test(c)) return '⌚';
  if (/ceram|porcel|faience|vase|terre cuite/.test(c)) return '🏺';
  if (/bijou|bague|broche|collier|bracelet/.test(c)) return '💍';
  if (/grav|estamp|litho|dessin|encre/.test(c)) return '📜';
  if (/meuble|mobilier/.test(c)) return '🪑';
  if (/livre|manuscrit/.test(c)) return '📖';
  if (/verre|verrerie|cristal/.test(c)) return '🥃';
  return '🏺';
}
export const prixHtml = o => (o.prix_bas != null && o.prix_haut != null)
  ? `<span class="price">${fmtNum(o.prix_bas)}–${fmtNum(o.prix_haut)} €</span>`
  : '<span class="price none">à estimer</span>';
export const isVideo = p => p.kind === 'video' || /\.(mp4|mov|webm)$/i.test(p.storage_path || '');
export const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);

// ─── Carte objet (composant partagé : listing collection + objets d'un artiste) ─
export function cardHtml(o) {
  const img = S.photoMap[o.id];
  const marks = confMarks(o);
  const loc = (o.zone || o.contenant)
    ? esc([o.zone, o.contenant].filter(Boolean).join(' / '))
    : '<em>non localisé</em>';
  const meta = [catCanon(o.categorie), o.periode, o.ecole].filter(Boolean).map(esc).join(' · ') || '<em>à identifier</em>';
  const visuel = img?.url
    ? `<img src="${esc(img.url)}" alt="${esc(o.titre || 'Objet de la collection')}" loading="lazy" decoding="async" style="object-position:${img.fx ?? 50}% ${img.fy ?? 50}%">`
    : catEmoji(o.categorie); // pas de visuel : placeholder emoji (+ badge ▶ si vidéo)
  const badgeVid = img?.vid ? '<span class="card-vid" title="Vidéo" aria-label="Vidéo">▶</span>' : '';
  return `<article class="card" data-oid="${esc(o.id)}" tabindex="0" role="button" aria-label="${esc(o.titre || 'Objet')} — fiche #${esc(o.id)}">
    <div class="card-img">${visuel}<span class="card-id">#${esc(o.id)}</span><span class="card-status" style="background:${ST_COLOR[o.statut] || '#8A94B8'}"></span>${badgeVid}</div>
    <div class="card-body">
      <div class="card-title">${esc(o.titre || 'Sans titre')}</div>
      <div class="card-meta">${meta}</div>
      <div class="card-loc">${pinSvg}${loc}</div>
      <div class="card-foot">${prixHtml(o)}${confHtml(marks)}</div>
    </div>
  </article>`;
}

// ─── Libellés & détails du changelog (table `evenements`, D-025) ─────────────
// Partagés entre l'historique de la fiche objet et l'écran Activité.
export const ACT_LABELS = {
  capture: 'Objet capturé', photo_ajoutee: 'Photo ajoutée', photo_supprimee: 'Photo supprimée',
  recadrage: 'Recadrage', centrage: 'Centrage', localisation: 'Localisation',
  correction: 'Correction', validation: 'Fiche validée', relance: 'Estimation relancée',
  identification: 'Identification IA', passe_marche: 'Recherche de comparables',
  lens: 'Google Lens (signature)', artiste_maj: 'Fiche artiste', photos_manquantes: 'Photos recommandées',
  artiste_photo_ajoutee: 'Photo artiste ajoutée', artiste_photo_supprimee: 'Photo artiste supprimée',
  comparable_supprime: 'Comparable retiré',
};
// Détail utile d'un événement (modèle, prompt, comparables, sources, champs
// avant→après, note) — rendu HTML échappé, partagé fiche objet + Activité.
export function evDetailBits(d = {}) {
  const bits = [];
  if (d.modele) bits.push(esc(d.modele));
  if (d.prompt_version) bits.push('prompt ' + esc(d.prompt_version));
  if (d.n != null) bits.push(d.n + ' photo' + (d.n > 1 ? 's' : ''));
  if (d.comps != null) bits.push(d.comps + ' comparable' + (d.comps > 1 ? 's' : ''));
  if (Array.isArray(d.sources) && d.sources.length) bits.push(esc(d.sources.join(', ')));
  if (d.champs && typeof d.champs === 'object') {
    bits.push(Object.entries(d.champs).map(([c, v]) =>
      `${esc(c)} : « ${esc(v?.avant ?? '—')} » → « ${esc(v?.apres ?? '—')} »`).join(' · '));
  }
  if (d.note) bits.push(esc(d.note));
  return bits;
}

// ─── Mini rendu markdown (fiches IA, bios artiste, prompts) ─────────────────
function mdInline(s) {
  return s
    // Liens AVANT gras/italique ; http(s) uniquement — tout autre schéma
    // (javascript:…) ne matche pas et reste du texte échappé, inoffensif.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
export function mdToHtml(md) {
  // Assainissement d'entrée : les bios/fiches LLM arrivent souvent avec des
  // backslash-échappements (\_ \* \#), des espaces doubles ou des espaces
  // avant la ponctuation — on nettoie avant l'échappement HTML.
  const clean = String(md ?? '')
    .replace(/\\([_*#`[\]])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .replace(/ +([,.;:!?»])/g, '$1');
  const lines = esc(clean).split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (/^\s*\|.*\|\s*$/.test(L)) {
      closeList();
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const row = lines[i];
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(row)) {
          const cells = row.split('|').slice(1, -1).map(c => mdInline(c.trim()));
          tbl.push(cells);
        }
        i++;
      }
      i--;
      if (tbl.length) {
        out.push('<table><thead><tr>' + tbl[0].map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
          + tbl.slice(1).map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('')
          + '</tbody></table>');
      }
      continue;
    }
    const h = L.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); continue; }
    if (/^\s*---+\s*$/.test(L)) { closeList(); out.push('<hr>'); continue; }
    const ul = L.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${mdInline(ul[1])}</li>`); continue; }
    const ol = L.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${mdInline(ol[1])}</li>`); continue; }
    if (L.trim() === '') { closeList(); continue; }
    closeList();
    out.push(`<p>${mdInline(L)}</p>`);
  }
  closeList();
  return out.join('');
}
