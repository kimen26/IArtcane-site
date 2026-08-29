// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/maison/etat.js : état partagé du territoire Maison.
//
// Deux onglets (identité / membres) sous une barre commune,
// navigation locale SANS changement de route (O.onglet + re-rendu).
// Même parti pris que views/objet/etat.js : on exporte un OBJET muté en place,
// jamais des `let`. `hooks` évite la dépendance circulaire index ↔ sous-onglets.
// ═══════════════════════════════════════════════════════════════════════════

/** État partagé du territoire Maison. */
export const M = {
  onglet: 'identite',      // 'identite' | 'membres'
  tenant: null,            // ligne `tenants` : { name, couleur }
  membres: [],             // [{ member_id, role, created_at, nom }]
  invitations: [],         // [{ id, email, role, created_at, relance_le }]
  nObjets: 0,              // count objets de la maison (sous-ligne du hero)
  nArtistes: 0,            // count distinct objets.auteur
  scroll: {},              // position de défilement mémorisée par onglet (best effort)
};

/** Valeur par défaut du ruban (fallback CSS + bouton « Revenir au défaut »). */
export const RUBAN_DEFAUT = '#35696c';

/** Branchés par views/maison/index.js au chargement du module. */
export const hooks = {
  recharger: null,  // ()            => Promise — recharge tout le territoire
  rendre: null,     // ()            => void    — re-rend l'onglet courant
  naviguer: null,   // (onglet)      => void    — pose M.onglet puis re-rend
};

// ─── Roue de teintes & luminance (repris de la maquette, README §M1) ─────────

/** '#abc' | '#aabbcc' | 'aabbcc' → [r,g,b] (0-255) ou null si invalide. */
export function hex2rgb(h) {
  let s = String(h).replace('#', '').trim();
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
}

/** Luminance relative WCAG d'une couleur hex (0 = noir, 1 = blanc). */
export function lum(hex) {
  const rgb = hex2rgb(hex) || [0, 0, 0];
  const [r, g, b] = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** HSL (h 0-360, s/l 0-100) → '#rrggbb'. */
export function hsl2hex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}

/** Seuil de bascule du texte du ruban vers le noir (teintes claires). */
export const SEUIL_TEXTE_CLAIR = 0.42;

/**
 * Depuis une couleur de ruban : le texte est CALCULÉ (jamais choisi).
 * @returns {{ texte: string, texteNom: 'noir'|'blanc', contraste: string }}
 */
export function rubanTexte(couleur) {
  const clair = lum(couleur) > SEUIL_TEXTE_CLAIR;
  const l = lum(couleur);
  // Ratio de contraste WCAG entre le ruban et le texte retenu.
  const ratio = clair
    ? (l + 0.05) / (0.05 + 0.02)      // texte quasi-noir
    : (1.0 + 0.05) / (l + 0.05);      // texte quasi-blanc
  return {
    texte: clair ? '#141414' : '#F4F7F6',
    texteNom: clair ? 'noir' : 'blanc',
    contraste: (Math.round(ratio * 10) / 10).toString().replace('.', ',') + ':1',
  };
}

/** 5 neutres proposés en barrettes (README §M1). */
export const NEUTRES = ['#F3F1EC', '#C2BDB3', '#7C7C7C', '#35696c', '#0D1B3E'];

/**
 * 36 teintes en 3 couronnes (claire / moyenne / sombre), 12 par couronne.
 * Rayons/dimensions repris de la maquette (lignes ~420-436).
 * @returns {{ hex:string, x:number, y:number, d:number, couronne:number }[]}
 */
export function roueTeintes() {
  const R = 76;
  const couronnes = [
    { r: 66, d: 14, s: 58, l: 68 },
    { r: 49, d: 14, s: 56, l: 48 },
    { r: 33, d: 13, s: 52, l: 31 },
  ];
  const out = [];
  couronnes.forEach((cfg, ci) => {
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 - 90) * Math.PI / 180;
      out.push({
        hex: hsl2hex(i * 30, cfg.s, cfg.l),
        x: R + Math.cos(a) * cfg.r,
        y: R + Math.sin(a) * cfg.r,
        d: cfg.d,
        couronne: ci,
      });
    }
  });
  return out;
}

/** Normalise un e-mail à l'écriture : trim + minuscules (unicité 0027 sensible à la casse). */
export const normEmail = e => String(e ?? '').trim().toLowerCase();
