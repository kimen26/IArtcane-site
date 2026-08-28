// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/demandes.js : écran de tri des demandes (D-072)
// Squelette posé par HO-082 — contenu rempli par HO-084.
// Contrat : mount() rend l'écran dans #demandes-body.
// ═══════════════════════════════════════════════════════════════════════════
import { $ } from '../core/dom.js';
import { S } from '../core/state.js';
import { sb } from '../core/data.js';

export function mount() {
  $('#demandes-body').innerHTML = '<div class="panel">Écran en cours de construction (HO-084).</div>';
}

// Demandes encore ouvertes de la maison (D-072) : compteur + pastille d'en-tête,
// appelé par le shell (app.js) via import dynamique — logique déportée ici plutôt
// que dans app.js, au plafond de modularité en cliquet (infra/check-site.mjs).
export async function refreshCompteur() {
  const { count } = await sb.from('demandes')
    .select('*', { count: 'exact', head: true })
    .eq('owner_id', S.tenantId)
    .in('statut', ['nouvelle', 'acceptee']);
  S.demandesOuvertes = count ?? 0;
  const pastille = $('#demandes-count');
  pastille.textContent = S.demandesOuvertes || '';
  pastille.classList.toggle('hidden', !S.demandesOuvertes);
}
