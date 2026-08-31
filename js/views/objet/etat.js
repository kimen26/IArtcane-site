// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/etat.js : état local de la fiche produit.
//
// Territoire découpé en sous-écrans (index / photos / identification / ventes /
// description / historique) qui partagent les mêmes données chargées. Cet
// objet en est la source unique — même parti pris que core/state.js pour l'app :
// on exporte un OBJET dont on mute les champs, jamais des `let` exportés.
//
// `hooks` évite toute dépendance circulaire entre les modules : index.js y
// branche ses fonctions de rechargement/rendu/navigation ; les sous-écrans les
// appellent sans importer index.js.
// ═══════════════════════════════════════════════════════════════════════════
import { S } from '../../core/state.js';
import { sb, logEvent } from '../../core/data.js';
import { enregistrer } from '../../core/feedback.js';
import { marquerUtile } from '../../core/consultations.js';

export const O = {
  photos: [],     // [{ ...photo, url, thumbUrl }] — sans `sel` (galerie déplacée)
  comps: [],      // comparables de l'objet
  fiche: null,    // dernière fiche IA (version max)
  events: [],     // changelog (table evenements, 50 derniers)
  artiste: null,  // fiche artiste rattachée (table artistes) ou null
  pipe: null,     // état R1/R2/R3/Valo (computePipe)
  jobs: [],       // jobs en attente/en cours
  ecran: 'hub',   // 'hub' | 'photos' | 'identification' | 'ventes' | 'description' | 'historique'
  focus: null,    // { champ } | { photoId } — consommé par l'écran cible puis remis à null
  nLens: 0,       // nb de passes R2 Lens (evenements action='lens R2', HO-087) — 0 par défaut
};

/** Compte les passes R2 (Lens) d'un objet — même échouées (le runbook trace
 * toujours, cf. infra/cron/prompt-enrichment.md l. 166). 0 si la requête
 * échoue : une alerte manquante est préférable à une fiche cassée. */
export async function chargerNLens(id) {
  const { count, error } = await sb.from('evenements')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', S.tenantId).eq('objet_id', id).eq('action', 'lens R2');
  if (error) { console.warn('chargerNLens:', error.message); return 0; }
  return count ?? 0;
}

/** Photo actuellement affichée dans la galerie (à défaut : la première). */
export const selPhoto = () => O.photos[0];

/** Branchés par views/objet/index.js au chargement du module. */
export const hooks = {
  recharger: null,  // (id) => Promise — recharge toute la fiche depuis la base
  rendre: null,     // ()   => void    — re-rend la fiche depuis l'état courant
  naviguer: null,   // (ecran, focus?) => void — index.js pose O.ecran/O.focus puis re-rend
};

// ─── Vocabulaire des tags photo (partagé écran Photos ↔ hub, revue HO-116) ──
export const KINDS = [
  { key: 'face', label: 'face' }, { key: 'profil', label: 'profil' },
  { key: 'revers', label: 'revers' }, { key: 'signature', label: 'signature' },
  { key: 'poincon', label: 'marque / poinçon' }, { key: 'detail', label: 'détail décor' },
  { key: 'defaut', label: 'défaut' }, { key: 'echelle', label: 'échelle' },
  { key: 'infos', label: 'infos' }, { key: 'autre', label: 'autre' },
  { key: 'sans_tag', label: '✕ pas de tag' },
];
/** Libellé du tag d'une photo (`kind` → label), `null` = à taguer. */
export const libelleTag = p => KINDS.find(k => k.key === p.kind)?.label || (p.kind === 'video' ? 'vidéo' : null);

// ─── Validation par champ (motif central HO-046) ────────────────────────────

export const CHAMPS_VALIDABLES = ['titre','categorie','auteur','technique','periode','ecole','etat','marques','dimensions','prix','description'];
// 'dimensions' = triplet hauteur/largeur/profondeur_cm ; 'prix' = prix_bas+prix_haut.

/** Champs OBLIGATOIRES d'une fiche (tranché par Yann, 2026-08-31) : ce que le hub compte
 *  dans « N à valider ». `prix` est produit par la valorisation, `description`/`periode`/
 *  `ecole`/`marques` sont utiles mais pas bloquants.
 *  Constante montée dans core/format.js par HO-118 (transverse) pour que
 *  services/journal.js (HO-119) puisse la lire sans importer une vue — ré-exportée
 *  ici telle quelle, aucun appelant ne change (objet/index.js importe toujours ./etat.js). */
export { CHAMPS_OBLIGATOIRES } from '../../core/format.js';

/** Renvoie true si le champ est validé dans objets.validation_champs. */
export const estValide = (champ) => Boolean(S.currentObjet?.validation_champs?.[champ]);

/** Pastille ronde 20 px : validé = plein --ok + ✓ ; sinon cercle vide. */
export function pastilleHtml(champ) {
  const ok = estValide(champ);
  const title = ok ? 'Validé par un humain' : 'À valider';
  const cls = ok ? 'pastille ok' : 'pastille';
  return `<span class="${cls}" data-action="toggle-val" data-champ="${champ}" title="${title}" role="button" aria-label="${title}">${ok ? '✓' : ''}</span>`;
}

/** Bascule validation_champs[champ] = { par, at } ou suppression de la clé. */
export async function toggleValidation(champ) {
  const o = S.currentObjet;
  if (!o) return;
  const qui = localStorage.getItem('iartcane-qui') ?? 'alain';
  const vc = { ...(o.validation_champs || {}) };
  const actuel = vc[champ];
  if (actuel) {
    delete vc[champ];
  } else {
    vc[champ] = { par: qui, at: new Date().toISOString() };
  }
  const label = actuel ? 'Validation retirée' : 'Champ validé';
  const ok = await enregistrer(() => sb.from('objets').update({ validation_champs: vc }).eq('owner_id', S.tenantId).eq('id', o.id), label);
  if (!ok) return;
  o.validation_champs = vc;
  logEvent('validation_champ', { champ, valide: !actuel });
  if (champ === 'auteur' && !actuel && o.auteur) {
    marquerUtile({ objetId: o.id, artiste: o.auteur, besoin: 'referentiels-artistes' });
  }
  hooks.rendre?.();
}
