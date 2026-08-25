// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/activite.js : actions manuelles + digest « quoi de neuf » (D-025)
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast, emptyHtml } from '../core/dom.js';
import { S, canWrite } from '../core/state.js';
import { plur, capFirst, ACT_LABELS, evDetailBits } from '../core/format.js';
import { sb, ensureCollection, enqueueJobs } from '../core/data.js';
import { loadViewCss } from '../core/css.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('activite');

export function mount() {
  loadActivite();
}

async function majCatalogue() {
  if (!canWrite()) return;
  await ensureCollection();
  if (!S.collection.length) { toast('Aucun objet dans le catalogue', true); return; }
  if (!confirm(`Rejouer la passe complète (identification + comparables) sur les ${S.collection.length} objets du catalogue ?\n\nLes objets déjà en file sont ignorés. Le cron traitera ~5 objets par run de 10 min.`)) return;
  const n = await enqueueJobs(S.collection.map(o => o.id), 'maj');
  toast(n
    ? `${plur(n, 'objet mis', 'objets mis')} en file — le cron les traitera ~5 par run de 10 min.`
    : 'Tous les objets sont déjà en file');
}

async function majArtistes() {
  if (!canWrite()) return;
  await ensureCollection();
  const objs = S.collection.filter(o => o.auteur && o.auteur.trim());
  const artistes = [...new Set(objs.map(o => o.auteur))];
  if (!objs.length) { toast('Aucun objet avec un auteur renseigné', true); return; }
  if (!confirm(`Mettre à jour les fiches des ${plur(artistes.length, 'artiste', 'artistes')} (${plur(objs.length, 'objet concerné', 'objets concernés')}) ?\n\nLe cron traitera ~5 objets par run de 10 min.`)) return;
  const n = await enqueueJobs(objs.map(o => o.id), 'artiste_maj');
  toast(n
    ? `${plur(n, 'objet mis', 'objets mis')} en file (${plur(artistes.length, 'artiste', 'artistes')}) — le cron les traitera ~5 par run de 10 min.`
    : 'Ces objets sont déjà tous en file');
}

// Actions écrites par le cron (vs actions du site) — détermine le groupe du digest.
const CRON_ACTIONS = new Set(['identification', 'passe_marche', 'lens', 'artiste_maj', 'photos_manquantes']);
const SITE_PLUR = {
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

// Phrase synthétique d'un groupe d'événements cron : compteurs par action,
// modèles / versions de prompt distincts, comparables cumulés, sources distinctes.
function resumeCron(list) {
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
  if (am.length) parts.push(plur(am.length, 'fiche artiste mise à jour', 'fiches artistes mises à jour'));
  const lens = by('lens');
  if (lens.length) parts.push(plur(lens.length, 'analyse Lens (signature)', 'analyses Lens (signatures)'));
  const ph = by('photos_manquantes');
  if (ph.length) parts.push(plur(ph.length, 'recommandation photos', 'recommandations photos'));
  return parts.join(', ');
}

// Phrase synthétique d'un groupe d'événements site : compteurs par action +
// acteurs distincts entre parenthèses (« 1 correction (Yann) »).
function resumeSite(list) {
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

// Ligne unitaire du digest : heure, action, acteur, objet (lien fiche) + détail.
function evRowActivite(ev, titres) {
  const h = new Date(ev.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const obj = ev.objet_id
    ? `<a class="link-lot" href="#/objet/${encodeURIComponent(ev.objet_id)}">#${esc(ev.objet_id)}${titres[ev.objet_id] ? ' ' + esc(titres[ev.objet_id]) : ''}</a>`
    : '';
  return `<div class="ev-row">
    <span class="ev-date">${h}</span>
    <span class="ev-act">${esc(ACT_LABELS[ev.action] ?? ev.action)}</span>
    <span class="ev-qui">${esc(ev.acteur ?? '')}</span>
    <span class="ev-det">${[obj, ...evDetailBits(ev.detail ?? {})].filter(Boolean).join(' · ')}</span>
  </div>`;
}

async function loadActivite() {
  const body = $('#activite-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const depuis = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: evts, error }] = await Promise.all([
    sb.from('evenements').select('id,objet_id,created_at,acteur,action,detail')
      .eq('owner_id', S.tenantId).gte('created_at', depuis)
      .order('created_at', { ascending: false }).limit(500),
    ensureCollection(),
  ]);
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  // Titres d'objets : cache collection d'abord, appoint pour les absents.
  const titres = Object.fromEntries(S.collection.map(o => [o.id, o.titre]));
  const manquants = [...new Set((evts ?? []).map(e => e.objet_id).filter(id => id && !(id in titres)))];
  if (manquants.length) {
    const { data: plus } = await sb.from('objets').select('id,titre').eq('owner_id', S.tenantId).in('id', manquants);
    for (const o of plus ?? []) titres[o.id] = o.titre;
  }

  const actionsPanel = `
    <div class="panel panel-pad hide-lecteur">
      <div class="sec-title">Actions</div>
      <div class="value-sub">Forcer des passes IA sans attendre le rythme du cron — les objets déjà en file sont ignorés.</div>
      <div class="actions" style="margin-top:12px">
        <button class="btn primary" id="act-maj-catalogue">↻ MAJ générale du catalogue</button>
        <button class="btn" id="act-maj-artistes">🎨 MAJ des fiches artistes</button>
      </div>
    </div>
    <div class="sec-title" style="margin-top:28px">Quoi de neuf — 30 derniers jours</div>`;

  if (!evts?.length) {
    body.innerHTML = actionsPanel
      + emptyHtml('Rien à signaler sur 30 jours', 'Les runs du cron et les actions du site apparaîtront ici, digérés par jour.');
  } else {
    // Groupement par jour (ordre desc conservé) puis par type d'activité.
    const jours = new Map();
    for (const ev of evts) {
      const d = new Date(ev.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!jours.has(key)) {
        jours.set(key, {
          label: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          list: [],
        });
      }
      jours.get(key).list.push(ev);
    }
    const digRow = (titre, resume, list) => `
      <details class="acc dig-row">
        <summary><span class="dig-sum"><b>${esc(titre)}</b> — ${esc(resume)}</span><span class="chip dig-count">${list.length}</span></summary>
        <div class="ev-list">${list.map(e => evRowActivite(e, titres)).join('')}</div>
      </details>`;
    body.innerHTML = actionsPanel + [...jours.values()].map(({ label, list }) => {
      const cron = list.filter(e => CRON_ACTIONS.has(e.action));
      const site = list.filter(e => !CRON_ACTIONS.has(e.action));
      const rows = [];
      if (cron.length) rows.push(digRow('Run cron', resumeCron(cron), cron));
      if (site.length) rows.push(digRow('Site', resumeSite(site), site));
      return `<div class="dig-day">${esc(label)}</div><div class="panel dig-panel">${rows.join('')}</div>`;
    }).join('');
  }
  $('#act-maj-catalogue').addEventListener('click', majCatalogue);
  $('#act-maj-artistes').addEventListener('click', majArtistes);
}
