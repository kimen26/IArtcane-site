// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/camera.js : modale caméra en direct (getUserMedia), brique
// TRANSVERSE partagée par la vue Capturer (nouvel objet → capFiles) et la fiche
// objet (upload direct sur l'objet ouvert). Vit dans core/ et non dans views/ :
// deux vues en dépendent, et « une vue n'importe jamais une autre vue » (D-039).
// L'input capture="environment" passe la main à l'app photo du téléphone : sur
// Android le navigateur est souvent tué en arrière-plan pendant le cliché → la
// page se recharge et la photo se perd (« rien n'arrive »). Le flux getUserMedia
// garde la page au premier plan : plus de handoff, et ça marche aussi sur PC
// (webcam). Fallback : l'input fichier si la caméra est indisponible/refusée.
//
// Contrat : openCamera('capture', { addFiles }) — chaque cliché est passé à
// addFiles([file]) ; openCamera('objet', { onClose }) — upload direct et
// onClose(nbUploadés) à la fermeture (la fiche se recharge / relance l'analyse).
// ═══════════════════════════════════════════════════════════════════════════
import { $, toast } from './dom.js';
import { S } from './state.js';
import { logEvent, uploadPhotosFor } from './data.js';
import { withBusy, humaniser } from './feedback.js';

let camStream = null;
let camTarget = 'capture'; // 'capture' → addFiles (nouvel objet) · 'objet' → upload direct sur S.currentObjet
let camUploaded = 0;       // nb de clichés uploadés en mode 'objet' (pour le hook onClose)
let hooks = {};

export async function openCamera(target = 'capture', h = {}) {
  camTarget = target;
  hooks = h;
  const fallback = () => (target === 'objet' ? $('#file-add-photo') : $('#file-camera')).click();
  if (!navigator.mediaDevices?.getUserMedia) { fallback(); return; }
  try {
    // Résolution raisonnable : un flux pleine résolution (3000×3000) gonfle la mémoire
    // (canvas ≈ 36 Mo par cliché) → l'onglet peut être tué sur mobile = photos perdues.
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 2048 }, height: { ideal: 2048 } },
      audio: false,
    });
  } catch (err) {
    toast(`Caméra indisponible (${err.name}) — sélecteur de fichiers à la place`);
    fallback();
    return;
  }
  $('#camera-video').srcObject = camStream;
  $('#camera-modal').classList.remove('hidden');
}

export function closeCamera() {
  camStream?.getTracks().forEach(t => t.stop());
  camStream = null;
  $('#camera-video').srcObject = null;
  $('#camera-modal').classList.add('hidden');
  // Mode fiche objet : la vue appelante décide quoi faire des clichés uploadés
  // (recharger la fiche, relancer l'analyse) via le hook onClose.
  hooks.onClose?.(camUploaded);
  camTarget = 'capture';
  camUploaded = 0;
  hooks = {};
}

$('#camera-close').addEventListener('click', closeCamera);
$('#camera-shot').addEventListener('click', () => {
  const v = $('#camera-video');
  if (!v.videoWidth) { toast('Flux caméra pas encore prêt — réessaie', true); return; }
  // Plafond 2048 px : largement assez pour l'identification IA, et évite les crashs
  // mémoire mobile (chaque cliché reste en RAM jusqu'à l'enregistrement).
  const MAX = 2048;
  const scale = Math.min(1, MAX / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  c.toBlob(async b => {
    if (!b) { toast('Capture impossible', true); return; }
    const file = new File([b], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    if (camTarget === 'objet' && S.currentObjet) {
      const { valeur } = await withBusy(
        () => uploadPhotosFor(S.currentObjet.id, [file]),
        { titre: 'Envoi de la photo…' },
      );
      const { done, failed } = valeur ?? { done: 0, failed: [] };
      if (done > 0) { camUploaded += done; logEvent('photo_ajoutee', { n: done, via: 'camera' }); toast('Photo ajoutée à la fiche — tu peux enchaîner ou Terminer'); }
      // Même forme que uploads.js (HO-110) : un cliché = 1 photo tentée.
      else if (failed.length) { toast(`${done} photo(s) sur 1 ajoutée(s) — ${humaniser(failed[0].reason)}. Les autres n'ont pas été envoyées : réessaie.`, 'action'); }
    } else {
      hooks.addFiles?.([file]);
      toast('Photo ajoutée — enchaîne ou « Enregistrer l\'objet »');
    }
  }, 'image/jpeg', 0.85);
});
