// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/edition-photo.js : atelier « Modifier la photo »
// (HO-095, devenu une PAGE ROUTÉE en HO-099). Édition DESTRUCTIVE : recadrer
// et/ou pivoter, puis enregistrer écrase la brute (`storage_path`) et régénère
// les 3 dérivées. Renverse HO-091 (qui gardait la brute intacte via `crop_path`)
// — arbitrage Yann 2026-08-29 : « si la photo doit être tournée on la tourne,
// si elle doit être cropée on la crope » ; la « brute jamais perdue » porte sur
// la qualité des pixels conservés, pas sur la géométrie.
//
// HO-099 : ce n'est plus un overlay `createOverlay` (lightbox.js reste gelé —
// il sert encore la visionneuse et la fiche artiste) mais une vraie route,
// `mount(objetId, photoId)`, rendue dans `#objet-body` comme les autres
// sous-écrans de la fiche. Un « geste » (agrandir une image) reste un overlay ;
// un « état de travail à ne pas perdre » (cette édition destructive) est une
// page : URL propre, historique, bouton Retour d'Android qui referme l'atelier.
// HO-105 : le remplacement destructif (écrase storage_path, régénère les 3
// dérivées depuis la nouvelle brute, jamais en cascade — D-073/D-075) est
// déplacé tel quel dans services/photos.js::remplacer().
// HO-120 : l'atelier maison (canvas + poignées de recadrage) est remplacé par
// la brique `ui/recadrage` (HO-115, docs/architecture-briques.md §2) — même
// modèle que artiste/images.js::openCutter et capture/index.js::openLocalCrop.
// La rotation reste appliquée AVANT recadrage() : le bitmap est redressé sur
// un canvas caché, converti en blob objectURL, passé en `src` — la brique ne
// connaît que le rectangle déjà droit. Le retour ramène à l'écran d'origine
// (O.ecranRetour, etat.js) au lieu du hub systématique.
// ═══════════════════════════════════════════════════════════════════════════
import { $, toast } from '../../core/dom.js';
import { loadViewCss } from '../../core/css.js';
import { withBusy, humaniser } from '../../core/feedback.js';
import { S } from '../../core/state.js';
import { sb, logEvent, signPaths } from '../../core/data.js';
import { remplacer, cibleObjet } from '../../services/photos.js';
import { page } from '../../ui/page.js';
import { catCanon } from '../../core/format.js';
import { recadrage, decouper } from '../../ui/recadrage.js';
import { O } from './etat.js';

await loadViewCss('objet-photos');

// Point d'entrée de la route `#/objet/<id>/photo/<photoId>/modifier` (app.js).
// Arrivée directe par URL possible (rechargement de page) : ne dépend d'aucun
// état déjà chargé par views/objet/index.js, tout est relu depuis la base.
export async function mount(objetId, photoId) {
  const body = $('#objet-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';

  // Écran d'origine à restaurer au retour (HO-120) — lu AVANT que cet atelier
  // ne prenne la main : si O.ecran porte encore l'écran courant du même objet
  // (Photos ou hub), c'est de là qu'on vient. Ouverture directe de l'URL sans
  // passer par la fiche → hub, pas d'exception.
  O.ecranRetour = (String(S.currentObjet?.id) === String(objetId) && O.ecran === 'photos') ? 'photos' : 'hub';

  const { data: photo, error } = await sb.from('photos').select('*')
    .eq('owner_id', S.tenantId).eq('objet_id', objetId).eq('id', photoId).maybeSingle();
  if (error || !photo) {
    toast('Photo introuvable', 'panne');
    location.hash = `#/objet/${encodeURIComponent(objetId)}`;
    return;
  }
  // Pose l'objet courant si absent (arrivée directe) — logEvent/caméra en dépendent
  // ailleurs dans la fiche ; ce chantier passe de toute façon `objetId` explicitement.
  if (!S.currentObjet || String(S.currentObjet.id) !== String(objetId)) {
    const { data: o } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).eq('id', objetId).maybeSingle();
    if (o) S.currentObjet = o;
  }

  // Fil d'Ariane (HO-104) : cet écran arrive par une VRAIE navigation de hash
  // (contrairement aux sous-écrans internes de la fiche) — le segment #<id>
  // peut donc porter un hash réel vers le hub, et la catégorie (inconnue de
  // filDe('objet', …) au moment du routage) est complétée ici.
  // Segments repérés par libellé, pas par index (HO-118 a mis « Accueil » en tête).
  const iCat = S.fil.findIndex(seg => seg.label === 'Objet');
  if (iCat >= 0 && S.currentObjet?.categorie) {
    const cat = catCanon(S.currentObjet.categorie);
    S.fil[iCat] = { label: cat, hash: `#/rayon/${encodeURIComponent(cat)}` };
  }
  const iId = S.fil.findIndex(seg => seg.label === `#${objetId}`);
  S.fil[iId >= 0 ? iId : S.fil.length - 1] = { label: `#${objetId}`, hash: `#/objet/${encodeURIComponent(objetId)}` };

  const retour = () => { location.hash = `#/objet/${encodeURIComponent(objetId)}`; };

  const bruteUrl = (await signPaths([photo.storage_path]))[photo.storage_path];
  if (!bruteUrl) { toast('Impossible de charger la brute pour l’édition', 'panne'); retour(); return; }
  const bmp = await createImageBitmap(await (await fetch(bruteUrl)).blob());

  let rotLocale = photo.rotation || 0;
  let straightBlob;

  // Redresse le bitmap selon rotLocale sur un canvas caché → blob → objectURL,
  // pour que `recadrage()` (ui/recadrage.js) ne voie qu'un rectangle déjà droit.
  const redresser = async () => {
    const swap = rotLocale === 90 || rotLocale === 270;
    const dw = swap ? bmp.height : bmp.width, dh = swap ? bmp.width : bmp.height;
    const c = document.createElement('canvas');
    c.width = dw; c.height = dh;
    const cctx = c.getContext('2d');
    cctx.translate(dw / 2, dh / 2); cctx.rotate(rotLocale * Math.PI / 180);
    cctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    straightBlob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.95));
  };
  await redresser();

  const corps = page(body, {
    titre: 'Modifier la photo',
    fil: [...S.fil, { label: 'Modifier la photo' }],
    barre: {
      actions: [
        { label: '↻ 90°', type: 'plat', onClick: onRotClick },
        { label: 'Annuler', type: 'plat', onClick: retour },
      ],
    },
  });
  corps.innerHTML = `
    <div class="obj-screen-body">
      <div class="obj-edit-zone"></div>
    </div>`;
  const zone = corps.querySelector('.obj-edit-zone');

  let urlCourante = null;
  const monterAtelier = () => {
    zone.innerHTML = '';
    if (urlCourante) URL.revokeObjectURL(urlCourante);
    urlCourante = URL.createObjectURL(straightBlob);
    recadrage(zone, {
      src: urlCourante,
      alt: 'Photo à modifier',
      sur: { annuler: retour, valider: onValider },
    });
  };
  monterAtelier();

  async function onRotClick() {
    rotLocale = (rotLocale + 90) % 360;
    await redresser();
    monterAtelier();
    // La brique n'active « Recadrer » que sur un geste de poignée (pointermove,
    // ui/recadrage.js) — une rotation seule, sans recadrage, doit rester
    // enregistrable (comportement identique à avant HO-120).
    zone.querySelector('[data-role="valider"]').disabled = false;
  }

  async function onValider(sel) {
    if (!confirm("Enregistrer les modifications ?\n\nLa photo d'origine sera remplacée définitivement — cette action est irréversible.")) return;
    try {
      await withBusy(async () => {
        // straightBlob est déjà la brute redressée (même repère que sel) — pas de refetch.
        // Qualité 0.95 (brute d'origine en q=0.85, camera.js) : la brute est
        // écrasée, tout ré-encodage est une génération de perte supplémentaire.
        const out = await decouper(straightBlob, sel, { qualite: 0.95 });
        // HO-095 — renverse HO-091 : l'édition est destructive, `storage_path` est
        // réécrit, `crop_path` repasse à NULL et `rotation` à 0 (services/photos.js).
        const r = await remplacer(cibleObjet(objetId), photo, out);
        if (!r.ok) throw new Error(r.error);
        toast('✓ Photo modifiée — l’image d’origine a été remplacée');
        logEvent('photo_modifiee', { photo: photo.storage_path, rotation: rotLocale }, objetId);
        retour();
      }, { titre: 'Enregistrement — la photo d’origine est remplacée définitivement…' });
    } catch (err) {
      console.warn('edition-photo:', err); toast(`Enregistrement échoué — ${humaniser(err)}. Réessaie.`, 'action');
    }
  }
}
