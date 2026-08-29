// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/version.js : SOURCE UNIQUE du cache-buster du site (L-013).
//
// ⚠️ NE PAS ÉDITER À LA MAIN. Écrit par `node infra/bump-version.mjs <version>`,
// qui met à jour d'un seul coup ce fichier, `site/index.html` et `site/sw.js`.
// `node infra/bump-version.mjs --check` vérifie que les trois concordent
// (appelé par infra/deploy-site.sh — le déploiement échoue s'ils divergent).
//
// Convention de version : AAAA-MM-JJ<lettre>[-hoNNN] — ex. 2026-08-26a-ho014.
// ═══════════════════════════════════════════════════════════════════════════
export const VERSION = '2026-08-29x-ho103';
