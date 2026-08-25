// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/css.js : chargement du CSS d'une vue par la vue elle-même.
//
// Pourquoi (audit 2026-08-25) : tant que `index.html` listait le CSS de chaque
// écran, tout chantier de vue devait éditer un fichier TRANSVERSAL gelé (règle 3
// de docs/handoffs/README.md) — deux handoffs de vues en parallèle entraient
// mécaniquement en conflit. Désormais une vue possède son JS ET son CSS, et ne
// touche plus rien de partagé.
//
// Usage, en tête du module de vue (top-level await : le module ne résout
// qu'une fois la feuille appliquée, donc le routeur n'affiche jamais de vue nue) :
//
//     import { loadViewCss } from '../core/css.js';
//     await loadViewCss('sources');
// ═══════════════════════════════════════════════════════════════════════════
import { VERSION } from './version.js';

const charges = new Map(); // nom → Promise (une seule injection par vue)

export function loadViewCss(nom) {
  if (charges.has(nom)) return charges.get(nom);
  // URL résolue depuis ce module (site/js/core/) → site/styles/views/<nom>.css :
  // insensible au chemin de déploiement (racine, sous-dossier Pages, serveur local).
  const href = new URL(`../../styles/views/${nom}.css`, import.meta.url).href + `?v=${VERSION}`;
  const p = new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    // Résolution sur erreur aussi : une feuille manquante dégrade l'affichage,
    // elle ne doit jamais empêcher l'écran de s'ouvrir.
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => { console.warn(`CSS de vue introuvable : ${href}`); resolve(); }, { once: true });
    document.head.append(link);
  });
  charges.set(nom, p);
  return p;
}
