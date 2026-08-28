// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/uploads.js : flux d'ajout de photos depuis la fiche
// (HO-076, extrait de index.js pour respecter le plafond de modularité).
// Branche le handler #file-add-photo sur withBusy (core/feedback.js, HO-075).
// ═══════════════════════════════════════════════════════════════════════════
import { $, toast } from '../../core/dom.js';
import { withBusy } from '../../core/feedback.js';
import { S, canWrite } from '../../core/state.js';
import { logEvent, purgeConsigne, uploadPhotosFor } from '../../core/data.js';

/**
 * Branche le handler d'ajout de photos par fichier sur l'overlay bloquant
 * withBusy. `recharger` est appelé avec l'id de l'objet une fois l'ajout
 * conclu (succès, échec partiel ou annulation).
 * @param recharger  (oid) => void — hook de rechargement de la fiche
 */
export function brancherUploads(recharger) {
  $('#file-add-photo').addEventListener('change', async e => {
    if (!canWrite()) { e.target.value = ''; return; }
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length || !S.currentObjet) return;
    const oid = S.currentObjet.id;
    const o = S.currentObjet;

    // withBusy jette la valeur de retour de fn quand on a annulé en cours de
    // route (elle rend undefined dans ce cas) — on capture donc le résultat
    // réel d'uploadPhotosFor par fermeture, pour conclure avec le vrai
    // compteur `done`, jamais un chiffre figé au moment du clic Annuler.
    let resultat = { done: 0, failed: [] };
    const { annule } = await withBusy(async ({ majMessage, estAnnule }) => {
      resultat = await uploadPhotosFor(oid, files, false, (sent, total) => {
        majMessage(`Envoi des photos — ${sent}/${total} terminée(s)`);
        return estAnnule() ? false : undefined;
      });
      return resultat;
    }, { titre: `Envoi des photos — 0/${files.length}` });

    const { done, failed } = resultat;

    if (done > 0) {
      logEvent('photo_ajoutee', { n: done, ...(failed.length ? { echecs: failed.length } : {}), via: 'fichier' }, oid);
      await purgeConsigne(o, oid);
    }
    if (annule) {
      toast(done ? `Envoi interrompu — ${done}/${files.length} photo(s) ajoutée(s)` : 'Envoi interrompu — aucune photo ajoutée', !done);
    } else if (failed.length > 0) {
      toast(`${done}/${files.length} photo(s) ajoutée(s) — ${failed.length} en échec (${failed[0].reason}). Réessayez.`, true);
    } else if (done > 0) {
      toast(S.currentObjet.statut !== 'validee'
        ? `${done} photo${done > 1 ? 's' : ''} ajoutée${done > 1 ? 's' : ''} — « Relancer les recherches » quand tu es prêt`
        : `${done} photo${done > 1 ? 's' : ''} ajoutée${done > 1 ? 's' : ''}`);
    }
    recharger(oid);
  });
}
