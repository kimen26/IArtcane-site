// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/artiste/uploads.js : flux d'upload d'image d'artiste,
// partagé entre le hub (index.js) et l'écran Images (images.js). Extrait de
// la duplication existante (HO-078) pour absorber le débordement des deux
// fichiers, pile à leur plafond de modularité (infra/check-site.mjs).
// Toute écriture rend compte via enregistrer/withBusy (socle HO-075, D-068).
// HO-105 : l'envoi + variantes + insertion passe par services/photos.js::
// ajouter() — seule la garantie de la fiche artiste (FK) reste ici, propre à
// la table `artistes`, hors du périmètre du service photos.
// ⚠️ `insererArtistePhoto(file, zone)` garde EXACTEMENT sa signature et son
// contrat de retour (id de la ligne créée, ou null) : views/artiste/index.js
// (hors périmètre de ce chantier) en dépend telle quelle.
// ═══════════════════════════════════════════════════════════════════════════
import { S, canWrite } from '../../core/state.js';
import { sb } from '../../core/data.js';
import { toast, enregistrer, withBusy } from '../../core/feedback.js';
import { A } from './etat.js';
import { ajouter, cibleArtiste } from '../../services/photos.js';

// Assure l'existence de la fiche artiste (FK) avant l'insertion de la photo.
async function assurerFicheArtiste(nom) {
  const { data: a } = await sb.from('artistes').select('nom').eq('owner_id', S.tenantId).eq('nom', nom).maybeSingle();
  if (a) return true;
  return enregistrer(() => sb.from('artistes').insert({ owner_id: S.tenantId, nom, bio_md: '' }), 'Fiche artiste créée');
}

/**
 * Upload complet (fiche artiste garantie → fichier → bucket → ligne
 * artistes_photos), enveloppé dans un overlay bloquant annulable (L-027) :
 * l'ajout d'une image ne doit plus rester muet 20-30 s.
 * @returns id de la ligne créée, ou null (échec ou annulation)
 */
export async function insererArtistePhoto(file, zone = null) {
  const nom = A.nom;
  if (!nom || !canWrite()) return null;

  const { valeur, annule } = await withBusy(async () => {
    if (!await assurerFicheArtiste(nom)) return null;
    const { done, failed, ids } = await ajouter(cibleArtiste(nom), [{ file, zone }]);
    if (done > 0) return { id: ids?.[0] ?? null };
    return { error: failed[0]?.reason ?? 'échec inconnu' };
  }, { titre: 'Envoi de la photo…' });

  if (annule || !valeur) return null;
  if (valeur.error) {
    console.warn('insererArtistePhoto:', valeur.error);
    toast(`Photo « ${file.name} » non envoyée — ${valeur.error}`, true);
    return null;
  }
  return valeur.id;
}
