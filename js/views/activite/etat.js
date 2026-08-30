// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/activite/etat.js : état partagé de l'écran Activité (HO-057)
// Données brutes, dérivations temporelles, fonctions de synthèse du fil.
// ═══════════════════════════════════════════════════════════════════════════
import { sb, ensureCollection, enqueueJobs, signPaths } from '../../core/data.js';
import { S, canWrite } from '../../core/state.js';
import { toast } from '../../core/dom.js';
import { withBusy } from '../../core/feedback.js';
import { capFirst, plur, ACT_LABELS } from '../../core/format.js';

// ─── État mutable partagé entre les quatre onglets ─────────────────────────
export const A = {
  fenetre: '30j',          // '24h' | '7j' | '30j'
  onglet: 'pouls',         // 'pouls' | 'outils' | 'personnes' | 'objets'
  scrolls: {},             // { pouls: n, outils: n, ... }
  loading: false,
  // Données brutes
  evts: [],                // evenements de la fenêtre
  jobs: [],                // jobs de la fenêtre
  objets: [],              // objets du tenant
  photos: [],              // photos du tenant
  comps: [],               // comparables du tenant
  profiles: [],            // profiles utilisateurs
  titres: {},              // objet_id -> titre
  photoMap: {},            // objet_id -> { url, thumbUrl }
  filtreActeur: null,      // pour le lien "Voir ses modifications" (A3 -> A4)
};

// Fenêtres disponibles (valeur, libellé, tranches)
export const FENETRES = [
  { id: '24h', label: '24 h', tranches: 6, pasH: 4 },
  { id: '7j', label: '7 j', tranches: 7, pasH: 24 },
  { id: '30j', label: '30 j', tranches: 30, pasH: 24 },
];

export const Onglets = [
  { id: 'pouls', label: 'Pouls' },
  { id: 'outils', label: 'Outils' },
  { id: 'personnes', label: 'Personnes' },
  { id: 'objets', label: 'Objets' },
];

// ─── Constantes de synthèse (reprises de l'ancienne vue, D-025) ────────────
export const CRON_ACTIONS = new Set([
  'identification', 'passe_marche', 'lens', 'lens R2', 'rewriting',
  'artiste_maj', 'photos_manquantes',
]);

export const SITE_PLUR = {
  capture: ['capture', 'captures'],
  photo_ajoutee: ['photo ajoutée', 'photos ajoutées'],
  photo_supprimee: ['photo supprimée', 'photos supprimées'],
  recadrage: ['recadrage', 'recadrages'],
  centrage: ['centrage', 'centrages'],
  localisation: ['localisation', 'localisations'],
  correction: ['correction', 'corrections'],
  validation: ['validation', 'validations'],
  relance: ['relance', 'relances'],
};

const HUMAN_ACTORS = new Set(['yann', 'alain']);

/** Catégorise un acteur : 'cron' | 'outil' | 'humain'. */
export function kindOf(actor) {
  if (!actor) return 'outil';
  const a = actor.toLowerCase();
  if (a === 'cron' || CRON_ACTIONS.has(a)) return 'cron';
  if (HUMAN_ACTORS.has(a)) return 'humain';
  if (/^passe0|site$/.test(a)) return 'outil';
  return 'outil';
}

/** Couleur de puce/tag selon l'auteur. */
export function colorOf(actor, action) {
  const k = kindOf(actor, action);
  if (k === 'humain') return 'var(--act-blue)';
  if (k === 'outil') return 'var(--act-amber)';
  return 'var(--act-green)';
}

/** Phrase synthétique d'un groupe d'événements cron. */
export function resumeCron(list) {
  const by = a => list.filter(e => e.action === a);
  const uniq = arr => [...new Set(arr.filter(Boolean))];
  const parts = [];
  const ids = by('identification');
  if (ids.length) {
    const modeles = uniq(ids.map(e => e.detail?.modele));
    const prompts = uniq(ids.map(e => e.detail?.prompt_version));
    const meta = [modeles.join(', '), prompts.length ? 'prompts ' + prompts.join(', ') : ''].filter(Boolean).join(' · ');
    parts.push(plur(ids.length, 'identification', 'identifications') + (meta ? ` (${meta})` : ''));
  }
  const pm = by('passe_marche');
  if (pm.length) {
    const comps = pm.reduce((s, e) => s + (Number(e.detail?.comps) || 0), 0);
    const srcs = uniq(pm.flatMap(e => Array.isArray(e.detail?.sources) ? e.detail.sources : []));
    const meta = [comps ? plur(comps, 'comparable trouvé', 'comparables trouvés') : '', srcs.join(', ')].filter(Boolean).join(' · ');
    parts.push(plur(pm.length, 'passe marché', 'passes marché') + (meta ? ` (${meta})` : ''));
  }
  const am = by('artiste_maj');
  if (am.length) parts.push(plur(am.length, 'fiche artiste (R9)', 'fiches artistes (R9)'));
  const lens = by('lens').length + by('lens R2').length;
  if (lens) parts.push(plur(lens, 'recherche Lens (R2)', 'recherches Lens (R2)'));
  const rw = by('rewriting');
  if (rw.length) parts.push(plur(rw.length, 'rewriting (R3)', 'rewritings (R3)'));
  const ph = by('photos_manquantes');
  if (ph.length) parts.push(plur(ph.length, 'recommandation photos', 'recommandations photos'));
  return parts.join(', ');
}

/** Phrase synthétique d'un groupe d'événements site. */
export function resumeSite(list) {
  const counts = new Map();
  for (const e of list) {
    const c = counts.get(e.action) ?? { n: 0, acteurs: new Set() };
    c.n++;
    if (e.acteur && e.acteur !== 'site') c.acteurs.add(capFirst(e.acteur));
    counts.set(e.action, c);
  }
  return [...counts].map(([a, c]) => {
    const [s, p] = SITE_PLUR[a] ?? [ACT_LABELS[a] ?? a, (ACT_LABELS[a] ?? a) + 's'];
    return plur(c.n, s, p) + (c.acteurs.size ? ` (${[...c.acteurs].join(', ')})` : '');
  }).join(', ');
}

// ─── Helpers temporels ───────────────────────────────────────────────────────
export function debutFenetre(id) {
  const now = Date.now();
  if (id === '24h') return new Date(now - 24 * 3600e3);
  if (id === '7j') return new Date(now - 7 * 86400e3);
  return new Date(now - 30 * 86400e3);
}

export function trancheKey(date, id) {
  const d = new Date(date);
  if (id === '24h') {
    const h = d.getHours();
    const slot = Math.floor(h / 4) * 4;
    const label = `${slot}h-${slot + 4}h`;
    return { key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${slot}`, label, date: d };
  }
  return {
    key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
    label: d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }),
    date: d,
  };
}

export function since(iso) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.max(0, Math.floor(diff / 60000));
  if (m < 2) return 'il y a un instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  return `il y a ${j} j`;
}

export function fmtHeure(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Chargement des données ─────────────────────────────────────────────────
export async function loadActiviteData() {
  A.loading = true;
  const fen = FENETRES.find(f => f.id === A.fenetre) ?? FENETRES[2];
  const debut = debutFenetre(fen.id).toISOString();

  await ensureCollection();
  const ids = S.collection.map(o => o.id);

  const proms = [
    sb.from('evenements').select('*').eq('owner_id', S.tenantId).gte('created_at', debut).order('created_at', { ascending: false }).limit(2000),
    sb.from('jobs').select('*').eq('owner_id', S.tenantId).gte('created_at', debut).order('created_at', { ascending: false }),
    sb.from('photos').select('objet_id,storage_path,thumb_path,couverture').eq('owner_id', S.tenantId).order('couverture', { ascending: false }).order('created_at'),
    sb.from('comparables').select('objet_id,maison,prix,source_type').eq('owner_id', S.tenantId),
    sb.from('profiles').select('id,display_name'),
  ];

  const [{ data: evts, error: eEvts }, { data: jobs, error: eJobs }, { data: photos, error: ePh }, { data: comps, error: eComp }, { data: profiles, error: eProf }] = await Promise.all(proms);

  A.evts = evts ?? [];
  A.jobs = jobs ?? [];
  A.photos = photos ?? [];
  A.comps = comps ?? [];
  A.profiles = profiles ?? [];
  A.objets = S.collection;

  if (eEvts) console.warn('activité événements:', eEvts.message);
  if (eJobs) console.warn('activité jobs:', eJobs.message);
  if (ePh) console.warn('activité photos:', ePh.message);
  if (eComp) console.warn('activité comps:', eComp.message);
  if (eProf) console.warn('activité profiles:', eProf.message);

  // Titres d'objets : cache collection
  A.titres = Object.fromEntries(A.objets.map(o => [o.id, o.titre]));
  const manquants = [...new Set(A.evts.map(e => e.objet_id).filter(id => id && !(id in A.titres)))];
  if (manquants.length) {
    const { data: plus } = await sb.from('objets').select('id,titre').eq('owner_id', S.tenantId).in('id', manquants);
    for (const o of plus ?? []) A.titres[o.id] = o.titre;
  }

  // Photo de couverture (ou première) par objet, avec URLs signées
  A.photoMap = {};
  for (const p of A.photos) {
    if (!A.photoMap[p.objet_id]) A.photoMap[p.objet_id] = p;
    else if (p.couverture) A.photoMap[p.objet_id] = p;
  }
  // Vignettes seulement — la brute (2 Mo pièce) ne sort plus du bucket pour
  // une liste (quota egress crevé le 2026-08-31 ; toutes les photos ont un thumb).
  const toSign = Object.values(A.photoMap).map(p => p.thumb_path).filter(Boolean);
  const signed = await signPaths(toSign);
  for (const [oid, p] of Object.entries(A.photoMap)) {
    A.photoMap[oid] = { ...p, url: null, thumbUrl: signed[p.thumb_path] || null };
  }

  A.loading = false;
  return A;
}

// ─── Actions MAJ générale / Fiches artistes (reprises telles quelles, D-064) ─
export async function majCatalogue() {
  if (!canWrite()) return;
  await ensureCollection();
  if (!A.objets.length) { toast('Aucun objet dans le catalogue', true); return; }

  const ids = A.objets.map(o => o.id);
  const { data: idsR1 } = await sb.from('evenements')
    .select('objet_id')
    .eq('owner_id', S.tenantId)
    .eq('action', 'identification')
    .in('objet_id', ids);
  const avecR1 = new Set((idsR1 ?? []).map(e => e.objet_id));
  const sansR1 = A.objets.filter(o => !avecR1.has(o.id));
  const avecMaj = A.objets.filter(o => avecR1.has(o.id));

  const lines = [`Mettre à jour les ${A.objets.length} objets du catalogue ?`];
  if (sansR1.length) lines.push(`• ${plur(sansR1.length, 'objet jamais identifié', 'objets jamais identifiés')} → R1 (Kimi) d'abord`);
  if (avecMaj.length) lines.push(`• ${plur(avecMaj.length, 'objet déjà identifié', 'objets déjà identifiés')} → R2 (Lens) + R3`);
  lines.push('Les objets déjà en file sont ignorés. Le cron traitera ~5 objets par run de 2 min.');
  if (!confirm(lines.join('\n'))) return;

  // Compteur externe : withBusy jette `valeur` en cas d'annulation (elle rend
  // `undefined`), or le toast final doit rester honnête sur ce qui est
  // RÉELLEMENT parti même si l'utilisateur a annulé en cours de route (L-022).
  let enfiles = 0;
  const { annule } = await withBusy(async ({ estAnnule }) => {
    if (sansR1.length) enfiles += await enqueueJobs(sansR1.map(o => o.id), 'r1');
    if (estAnnule()) return;
    if (avecMaj.length) enfiles += await enqueueJobs(avecMaj.map(o => o.id), 'maj');
  }, { titre: 'Mise en file du catalogue…', annulable: true });

  if (annule) { toast(`${plur(enfiles, 'objet mis', 'objets mis')} en file avant annulation.`); return; }
  toast(enfiles
    ? `${plur(enfiles, 'objet mis', 'objets mis')} en file — le cron les traitera ~5 par run de 2 min.`
    : 'Tous les objets sont déjà en file');
}

export async function majArtistes() {
  if (!canWrite()) return;
  await ensureCollection();
  const objs = A.objets.filter(o => o.auteur && o.auteur.trim());
  const artistes = [...new Set(objs.map(o => o.auteur))];
  if (!objs.length) { toast('Aucun objet avec un auteur renseigné', true); return; }
  if (!confirm(`Mettre à jour les fiches des ${plur(artistes.length, 'artiste', 'artistes')} (${plur(objs.length, 'objet concerné', 'objets concernés')}) ?\n\nLe cron traitera ~5 objets par run de 2 min.`)) return;

  // Pas d'« Annuler » : enqueueJobs fait UN insert en lot, il n'y a aucun point
  // d'interruption — le bouton ne pourrait rien arrêter, et un bouton qui ne
  // fait rien est pire que pas de bouton. L'overlay reste utile pour l'attente.
  let enfiles = 0;
  await withBusy(async () => { enfiles = await enqueueJobs(objs.map(o => o.id), 'r9'); },
    { titre: 'Mise en file des fiches artistes…', annulable: false },
  );

  toast(enfiles
    ? `${plur(enfiles, 'objet mis', 'objets mis')} en file (${plur(artistes.length, 'artiste', 'artistes')}) — le cron les traitera ~5 par run de 2 min.`
    : 'Ces objets sont déjà tous en file');
}

/** Lancer une passe marché sur les objets en attente d'estimation. */
export async function lancerFileAttente(liste) {
  if (!canWrite() || !liste.length) return;

  // Pas d'« Annuler » : un seul insert en lot, aucun point d'interruption (cf. majArtistes).
  let enfiles = 0;
  await withBusy(async () => { enfiles = await enqueueJobs(liste.map(o => o.id), 'valo'); },
    { titre: 'Mise en file des estimations…', annulable: false },
  );

  toast(enfiles
    ? `${plur(enfiles, 'objet mis', 'objets mis')} en file pour estimation — le cron les traitera ~5 par run de 2 min.`
    : 'Ces objets sont déjà tous en file');
}

export function setOnglet(id) {
  A.onglet = id;
}

export function setFiltreActeur(actor) {
  A.filtreActeur = actor;
}

export function setFenetre(id) {
  A.fenetre = id;
}
