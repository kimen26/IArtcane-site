// IArtcane — views/collection/listes.js : listes prédéfinies de la collection,
// définies UNE fois (prédicat, libellé, couleur) — HO-125. Les trois du journal
// partagent leurs prédicats avec services/journal.js : un objet « à traiter »
// sur l'accueil est exactement un objet de la liste.
import { S } from '../../core/state.js';
import { sb } from '../../core/data.js';
import { photosParObjet, objetAvecPhotoSansTag, objetSansArtiste, objetInfosNonValidees } from '../../services/journal.js';

let parObjet = new Map();          // objet_id → [kind…], chargé par chargerContexteListes()

export async function chargerContexteListes() {
  const { data } = await sb.from('photos').select('objet_id,kind').eq('owner_id', S.tenantId);
  parObjet = photosParObjet(data ?? []);
}

export const LISTES = [
  { cle: 'a_localiser',         label: 'À localiser',         couleur: 'var(--amber)',  match: o => !o.zone || !o.zone.trim() },
  { cle: 'a_valider',           label: 'Fiches à valider',    couleur: 'var(--violet)', match: o => o.statut === 'analyse' },
  { cle: 'chere',               label: '> 1 000 €',           couleur: 'var(--green)',  match: o => o.prix_haut >= 1000, pastille: '≥ 1 000 €' },
  { cle: 'photos_a_taguer',     label: 'Photos à taguer',     couleur: 'var(--amber)',  match: o => objetAvecPhotoSansTag(o, parObjet) },
  { cle: 'artistes_a_chercher', label: 'Artistes à chercher', couleur: 'var(--violet)', match: objetSansArtiste },
  { cle: 'infos_a_valider',     label: 'Infos à valider',     couleur: 'var(--blue)',   match: objetInfosNonValidees },
];
export const listeDe   = cle => LISTES.find(l => l.cle === cle) ?? null;
export const matchListe = (cle, o) => !cle || (listeDe(cle)?.match(o) ?? true);
export const libelleListe = cle => { const l = listeDe(cle); return l ? (l.pastille ?? l.label) : cle; };
