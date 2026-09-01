// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/uploads.js : flux d'ajout de photos depuis la fiche
// (HO-076, extrait de index.js pour respecter le plafond de modularité).
// Branche le handler #file-add-photo sur withBusy (core/feedback.js, HO-075).
// HO-105 : la séquence envoi + variantes + insertion + purge + trace passe
// par services/photos.js::ajouter() — cette vue n'appelle plus la base.
// ═══════════════════════════════════════════════════════════════════════════
import { $, toast } from '../../core/dom.js';
import { withBusy, humaniser } from '../../core/feedback.js';
import { S, canWrite } from '../../core/state.js';
import { ajouter, cibleObjet } from '../../services/photos.js';
import { cibleVisee } from '../../core/cible-fichier.js';

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
    // Cible figée au clic par l'appelant, jamais relue ici (core/cible-fichier.js).
    const oid = cibleVisee(e.target);
    if (!files.length) return;
    if (!oid) { toast('Photos non ajoutées — rouvre la fiche et réessaie.', 'action'); return; }

    // withBusy jette la valeur de retour de fn quand on a annulé en cours de
    // route (elle rend undefined dans ce cas) — on capture donc le résultat
    // réel d'ajouter() par fermeture, pour conclure avec le vrai compteur
    // `done`, jamais un chiffre figé au moment du clic Annuler.
    let resultat = { done: 0, failed: [] };
    const { annule } = await withBusy(async ({ majMessage, estAnnule }) => {
      resultat = await ajouter(cibleObjet(oid), files, {
        onProgress: (sent, total) => {
          majMessage(`Envoi des photos — ${sent}/${total} terminée(s)`);
          return estAnnule() ? false : undefined;
        },
        evenement: { action: 'photo_ajoutee', detail: { via: 'fichier' } },
        purgerConsigne: true,
      });
      return resultat;
    }, { titre: `Envoi des photos — 0/${files.length}` });

    const { done, failed } = resultat;

    if (annule) {
      // Annulation volontaire : jamais une panne, même à 0 photo (HO-110).
      toast(done ? `Envoi interrompu — ${done}/${files.length} photo(s) ajoutée(s)` : 'Envoi interrompu — aucune photo ajoutée');
    } else if (failed.length > 0) {
      toast(`${done} photo(s) sur ${files.length} ajoutée(s) — ${humaniser(failed[0].reason)}. Les autres n'ont pas été envoyées : réessaie.`, 'action');
    } else if (done > 0) {
      // Le conseil « Relancer les recherches » ne vaut que si l'objet visé est
      // TOUJOURS celui affiché : sinon on ne sait rien de son statut, et on se
      // contente du fait — sans conseil trompeur sur une fiche qu'on ne voit pas.
      const memeObjet = String(S.currentObjet?.id ?? '') === String(oid);
      const combien = `${done} photo${done > 1 ? 's' : ''} ajoutée${done > 1 ? 's' : ''}`;
      toast(memeObjet && S.currentObjet.statut !== 'validee'
        ? `${combien} — « Relancer les recherches » quand tu es prêt`
        : `${combien} sur #${oid}`);
    }
    recharger(oid);
  });
}
