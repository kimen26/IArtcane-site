// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/maj.js : mise à jour de l'app (HO-117). Enregistre sw.js,
// détecte une version qui attend, l'annonce au niveau `action` et recharge
// la page entière quand l'utilisateur le demande — un onglet ne mélange
// jamais deux versions (cause de « l'horreur au pied de la fiche », 2026-08-31).
// ═══════════════════════════════════════════════════════════════════════════
import { toast } from './feedback.js';

const MSG = 'Nouvelle version disponible';

function annoncer(reg) {
  toast(MSG, 'action', { action: { label: 'Recharger', onClick: () => reg.waiting?.postMessage({ type: 'SKIP_WAITING' }) } });
}

export function surveillerMiseAJour() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  let rechargement = false;
  // Le contrôleur change UNIQUEMENT après notre SKIP_WAITING (plus de claim) :
  // on recharge une fois, jamais en boucle.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (rechargement) return;
    rechargement = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) annoncer(reg);
    reg.addEventListener('updatefound', () => {
      const neuf = reg.installing;
      neuf?.addEventListener('statechange', () => {
        if (neuf.state === 'installed' && navigator.serviceWorker.controller) annoncer(reg);
      });
    });
  }).catch(() => {}); // pas de SW (file://, navigateur ancien) : l'app marche sans
}
