// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — services/historique.js : regroupement des évènements par rafale
// (HO-137, données → données, docs/architecture-briques.md §2). Aucun HTML,
// aucun toast, aucun accès à core/data ni core/state — pur calcul sur le
// tableau reçu en argument, testable hors-ligne (infra/test-historique.mjs),
// motif de services/journal.js.
// ═══════════════════════════════════════════════════════════════════════════

/** Fenêtre glissante de regroupement : deux évènements consécutifs de même
 * action et même acteur, séparés de moins de 5 minutes, rejoignent le même
 * groupe (demande Yann, recette 2026-08-31). */
export const FENETRE_MS = 5 * 60 * 1000;

/**
 * Regroupe les évènements d'une même rafale : même `action`, même `acteur`, et
 * moins de FENETRE_MS entre deux évènements CONSÉCUTIFS du groupe.
 * @param {Array} evts  évènements, du plus récent au plus ancien (ordre de la base)
 * @returns {Array<{action, acteur, debut, fin, n, evts}>}  n = evts.length
 */
export function grouperEvenements(evts) {
  if (!Array.isArray(evts) || evts.length === 0) return [];

  const groupes = [];
  let courant = null; // { action, acteur, evts: [...], dernierTs: number|null }

  for (const ev of evts) {
    const ts = ev?.created_at ? Date.parse(ev.created_at) : NaN;
    const groupable = Number.isFinite(ts);

    const rejoint = courant
      && groupable
      && courant.dernierTs != null
      && ev.action === courant.action
      && ev.acteur === courant.acteur
      // evts triés du plus récent au plus ancien : l'écart se mesure entre le
      // dernier absorbé (plus récent) et le candidat courant (plus ancien).
      && (courant.dernierTs - ts) < FENETRE_MS;

    if (rejoint) {
      courant.evts.push(ev);
      courant.dernierTs = ts;
    } else {
      if (courant) groupes.push(courant);
      courant = {
        action: ev.action,
        acteur: ev.acteur,
        evts: [ev],
        dernierTs: groupable ? ts : null,
      };
    }
  }
  if (courant) groupes.push(courant);

  return groupes.map(g => ({
    action: g.action,
    acteur: g.acteur,
    // evts[0] = plus récent (ordre reçu) → fin ; le dernier = le plus ancien → debut.
    fin: g.evts[0].created_at,
    debut: g.evts[g.evts.length - 1].created_at,
    n: g.evts.length,
    evts: g.evts,
  }));
}
