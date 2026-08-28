// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/uploads.js : flux d'upload d'image d'artiste,
// partagé entre le hub (index.js) et l'écran Images (images.js). Extrait de
// la duplication existante (HO-078) pour absorber le débordement des deux
// fichiers, pile à leur plafond de modularité (infra/check-site.mjs).
// Toute écriture rend compte via enregistrer/withBusy (socle HO-075, D-068).
// ═══════════════════════════════════════════════════════════════════════════
import { S, canWrite } from '../../core/state.js';
import { sb, uploadImageWithThumb } from '../../core/data.js';
import { toast, enregistrer, withBusy } from '../../core/feedback.js';
import { A } from './etat.js';

/**
 * Assure l'existence de la fiche artiste (FK) puis envoie le fichier dans le
 * bucket. N'écrit PAS encore la ligne artistes_photos — voir insererArtistePhoto.
 * @returns { path, thumbPath } | null (échec déjà toasté par les couches internes)
 */
async function uploadArtistePhoto(file) {
  const nom = A.nom;
  if (!nom || !canWrite()) return null;
  const { data: a } = await sb.from('artistes').select('nom').eq('owner_id', S.tenantId).eq('nom', nom).maybeSingle();
  if (!a) {
    const ok = await enregistrer(() => sb.from('artistes').insert({ owner_id: S.tenantId, nom, bio_md: '' }), 'Fiche artiste créée');
    if (!ok) return null;
  }
  const up = await uploadImageWithThumb(`${S.tenantId}/artistes`, file);
  if (!up) return null;
  return { ...up, id: null };
}

async function insererLigne(up, zone) {
  const { data: rows, error } = await sb.from('artistes_photos').insert({
    owner_id: S.tenantId,
    artiste_nom: A.nom,
    storage_path: up.path,
    thumb_path: up.thumbPath,
    zone,
  }).select('id');
  return { rows, error };
}

/**
 * Upload complet (fichier → bucket → ligne artistes_photos), enveloppé dans
 * un overlay bloquant annulable (L-027) : l'ajout d'une image ne doit plus
 * rester muet 20-30 s.
 * @returns id de la ligne créée, ou null (échec ou annulation)
 */
export async function insererArtistePhoto(file, zone = null) {
  const { valeur, annule } = await withBusy(async () => {
    const up = await uploadArtistePhoto(file);
    if (!up) return null;
    const { rows, error } = await insererLigne(up, zone);
    if (error) {
      console.warn('insererArtistePhoto:', error);
      return { error };
    }
    return { id: rows?.[0]?.id ?? null };
  }, { titre: 'Envoi de la photo…' });

  if (annule || !valeur) return null;
  if (valeur.error) {
    toast(`Photo « ${file.name} » non envoyée — ${valeur.error.message ?? valeur.error}`, true);
    return null;
  }
  return valeur.id;
}
