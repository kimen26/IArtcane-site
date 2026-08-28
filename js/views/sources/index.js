// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/sources/index.js : écran S-A « Sources — par besoin » (HO-059)
//
// Où chercher maintenant : accordéon par besoin (un volet ouvert), rendement
// en filigrane, conditions de déclenchement des payantes. Point d'entrée de la
// vue (`mount()`), appelé par la coquille views/sources.js.
//
// Territoire (D-041) :
//   • index.js     ce fichier — rendu S-A + délégation d'actions + dispatch S-A/S-B
//   • etat.js      chargement JSON + agrégats consultations + mesures
//   • palmares.js  écran S-B « Palmarès d'usage » (HO-060)
// `sources.js` (coquille, hors périmètre) appelle mount() sans lire le hash —
// le dispatch #/sources vs #/sources/palmares se fait ici, sur hashchange.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast } from '../../core/dom.js';
import { enregistrer } from '../../core/feedback.js';
import { loadViewCss } from '../../core/css.js';
import { SRC, hooks, chargerTout, marquerConsultee } from './etat.js';
import { mount as mountPalmares } from './palmares.js';

await loadViewCss('sources');

// Les 4 besoins = sections « métier » du JSON. Les autres sections
// (référentiels régionaux, stratégie d'acquisition, sites écartés) sont
// traitées à part : régionaux fondus dans « artiste », candidates de la
// stratégie servent la carte déclencheurs, écartées ont leur propre volet.
const BESOINS = [
  { id: 'artiste', titre: 'Identifier un artiste', sections: ['referentiels-artistes', 'referentiels-regionaux'] },
  { id: 'marques', titre: 'Marques, poinçons, estampilles', sections: ['marques-poincons'] },
  { id: 'prix', titre: 'Comparables & prix', sections: ['comparables-prix'] },
  { id: 'images', titre: 'Corpus images', sections: ['corpus-images'] },
];

const LIGNES_VISIBLES = 4;     // lignes dépliées par défaut dans un volet ouvert

// Badge d'accès — mapping multi-codes repris de l'ancienne vue (« API/NAV-AUTO »
// = deux badges). Le libellé long vient de la légende du JSON. Exporté : réutilisé
// tel quel par palmares.js (S-B) — même vocabulaire visuel que S-A.
export function badges(codes) {
  const leg = SRC.data?.legende ?? {};
  return String(codes ?? '').split('/').map(c => c.trim()).filter(Boolean).map(code => {
    const cls = 'acc-' + code.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<span class="src-acc ${cls}" title="${esc(leg[code] ?? code)}">${esc(code)}</span>`;
  }).join(' ');
}

// Pastilles de périmètre : domaines puis zones.
function perimetrePastilles(p) {
  const items = [...(p?.domaines ?? []), ...(p?.zones ?? [])];
  return items.map(d => `<span class="src-peri">${esc(d)}</span>`).join('');
}

// Résumé de périmètre pour un volet replié : union des domaines, abrégée.
function perimetreResume(entrees) {
  const doms = [...new Set(entrees.flatMap(e => e.perimetre?.domaines ?? []))];
  if (!doms.length) return '';
  const court = doms.slice(0, 5);
  return esc(court.join(' · ') + (doms.length > court.length ? '…' : ''));
}

// ─── Rendement d'une source (barre + N vues · N utiles) ────────────────────
function rendementLigne(nom) {
  const r = SRC.rendement[nom];
  if (!r || !r.vues) return `<div class="src-rendement vide">jamais consultée</div>`;
  const ratio = r.utiles / r.vues;
  const faible = ratio < 0.3 && r.vues >= 5;
  const pct = Math.round(ratio * 100);
  return `
    <div class="src-rendement">
      <span class="src-jauge"><span class="src-jauge-fill ${faible ? 'faible' : ''}" style="width:${pct}%"></span></span>
      <span class="src-rendement-txt ${faible ? 'faible' : ''}">${r.vues} vue${r.vues > 1 ? 's' : ''} · ${r.utiles} utile${r.utiles > 1 ? 's' : ''}</span>
    </div>`;
}

// ─── Une ligne de source dans un volet ouvert ─────────────────────────────
function ligneSource(e, besoinId) {
  const nomHtml = e.url
    ? `<a class="src-nom" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.nom)} ↗</a>`
    : `<span class="src-nom">${esc(e.nom)}</span>`;
  const outil = e.outil ? `<span class="src-outil">${esc(e.outil)}</span>` : '';
  return `
    <div class="src-ligne" data-src="${esc(e.nom)}" data-besoin="${esc(besoinId)}" role="button" tabindex="0">
      <div class="src-ligne-tete">
        ${nomHtml}
        <span class="src-cout">${esc(e.cout ?? '—')}</span>
      </div>
      <div class="src-ligne-acc">${badges(e.acces)}${outil}</div>
      ${e.usage ? `<div class="src-usage">${esc(e.usage)}</div>` : ''}
      <div class="src-peri-row">${perimetrePastilles(e.perimetre)}</div>
      ${rendementLigne(e.nom)}
    </div>`;
}

// ─── Un volet de l'accordéon ─────────────────────────────────────────────
function volet(besoin) {
  const entrees = besoin.sections
    .flatMap(id => SRC.data.sections.find(s => s.id === id)?.entrees ?? [])
    .filter(e => e.statut !== 'ecartee');
  const q = SRC.q.trim().toLowerCase();
  const filtrees = q ? entrees.filter(e => e.nom.toLowerCase().includes(q)) : entrees;
  const ouvert = SRC.ouvert === besoin.id || (q && filtrees.length > 0);
  const utilisees = entrees.filter(e => (SRC.rendement[e.nom]?.vues ?? 0) > 0).length;

  const plus = SRC.plusDeplie[besoin.id];
  const affichees = ouvert && !plus ? filtrees.slice(0, LIGNES_VISIBLES) : filtrees;
  const reste = filtrees.length - affichees.length;

  return `
    <section class="src-volet ${ouvert ? 'ouvert' : ''}" data-volet="${esc(besoin.id)}">
      <button class="src-volet-tete" data-action="toggle-volet" data-id="${esc(besoin.id)}" aria-expanded="${ouvert}">
        <span class="src-caret">▸</span>
        <span class="src-volet-titre">${esc(besoin.titre)}</span>
        <span class="src-volet-compte">${utilisees} / ${entrees.length}</span>
        ${!ouvert ? `<span class="src-volet-peri">${perimetreResume(entrees)}</span>` : ''}
      </button>
      ${ouvert ? `
        <div class="src-volet-corps">
          ${affichees.map(e => ligneSource(e, besoin.id)).join('') || '<div class="src-vide-q">Aucune source ne correspond.</div>'}
          ${reste > 0 ? `<button class="src-plus" data-action="plus" data-id="${esc(besoin.id)}">Voir les ${reste} autre${reste > 1 ? 's' : ''}</button>` : ''}
        </div>` : ''}
    </section>`;
}

// ─── Carte « Payantes — conditions de déclenchement » ─────────────────────
// Une entrée par source candidate portant un trigger. Avancement = mesure
// calculée (etat.js) / seuil. Badge d'état selon trigger.etat.
export const ETAT_BADGE = {
  arme: { txt: 'ARMÉ', cls: 'arme' },
  atteint: { txt: 'ARMÉ', cls: 'arme' },
  ajourne: { txt: 'AJOURNÉ', cls: 'ajourne' },
  dormant: { txt: 'DORMANT', cls: 'dormant' },
};

// Nom de source « nu » : on retire la parenthèse de précision pour rapprocher
// « Akoun en ligne (380 000 artistes) », « Akoun en ligne illimité »…
export const nomNu = nom => String(nom).replace(/\s*\(.*$/, '').replace(/\s+(illimité|en ligne)$/i, '').trim();

// Une entrée par condition de déclenchement, dédoublonnée sur l'identité du
// déclencheur (mesure + seuil) — la section « stratégie d'acquisition » du JSON
// reprend des sources déjà listées ailleurs, souvent sous un libellé différent.
// Garde la 1re occurrence et son libellé le plus court. Exporté : source unique
// pour S-A (carte déclencheurs) et S-B (palmares.js) — ne pas dupliquer.
export function candidatsDeclencheurs() {
  const parCle = new Map();
  for (const sec of SRC.data.sections) {
    for (const e of sec.entrees ?? []) {
      if (!e.trigger) continue;
      const cle = `${e.trigger.mesure}|${e.trigger.seuil}`;
      const gardee = parCle.get(cle);
      if (!gardee || nomNu(e.nom).length < nomNu(gardee.nom).length) parCle.set(cle, e);
    }
  }
  return [...parCle.values()];
}

function carteDeclencheurs() {
  const candidates = candidatsDeclencheurs();
  if (!candidates.length) return '';

  const lignes = candidates.map(e => {
    const t = e.trigger;
    const mesure = SRC.mesures[t.mesure];
    const connue = typeof mesure === 'number';
    const pct = connue && t.seuil ? Math.min(100, Math.round((mesure / t.seuil) * 100)) : 0;
    const atteint = connue && mesure >= t.seuil;
    const badge = ETAT_BADGE[t.etat] ?? ETAT_BADGE.dormant;
    return `
      <div class="src-decl">
        <div class="src-decl-tete">
          <span class="src-decl-nom">${esc(e.nom)}</span>
          ${badges(e.acces)}
          <span class="src-decl-cout">${esc(e.cout ?? '')}</span>
        </div>
        <div class="src-decl-si"><span class="src-si">SI</span> ${esc(t.regle.replace(/^SI\s+/i, ''))}${t.decisionRef ? ` <span class="src-decl-ref">(${esc(t.decisionRef)})</span>` : ''}</div>
        <div class="src-decl-jauge-row">
          <span class="src-decl-jauge"><span class="src-decl-fill ${atteint ? 'atteint' : ''}" style="width:${pct}%"></span></span>
          <span class="src-decl-mesure">${connue ? `${mesure} / ${t.seuil}` : `— / ${t.seuil}`}</span>
          <span class="src-etat ${badge.cls}">${badge.txt}</span>
        </div>
      </div>`;
  }).join('');

  return `
    <section class="src-carte-decl">
      <div class="src-carte-decl-titre">Payantes — conditions de déclenchement</div>
      <p class="src-carte-decl-intro">On n'achète pas « au cas où » : chaque source attend une condition chiffrée, mesurée sur les passes IA. Atteinte, elle ouvre une entrée dans DECISIONS.md — jamais d'achat automatique.</p>
      ${lignes}
      ${SRC.ecarts.length ? `<p class="src-carte-decl-ecart">Mesures approchées : ${SRC.ecarts.map(esc).join(' ')}</p>` : ''}
    </section>`;
}

// ─── Volet « Écartées » ─────────────────────────────────────────────────
function voletEcartees() {
  const ecartees = SRC.data.sections.flatMap(s => s.entrees ?? []).filter(e => e.statut === 'ecartee');
  if (!ecartees.length) return '';
  const ouvert = SRC.ouvert === '__ecartees';
  return `
    <section class="src-volet ecartees ${ouvert ? 'ouvert' : ''}">
      <button class="src-volet-tete" data-action="toggle-volet" data-id="__ecartees" aria-expanded="${ouvert}">
        <span class="src-caret">▸</span>
        <span class="src-volet-titre">Écartées</span>
        <span class="src-volet-compte">${ecartees.length}</span>
      </button>
      ${ouvert ? `<div class="src-volet-corps">${ecartees.map(e => `
        <div class="src-ligne ecartee">
          <div class="src-ligne-tete"><span class="src-nom">${esc(e.nom)}</span></div>
          ${e.motifEcart ? `<div class="src-motif">${esc(e.motifEcart)}</div>` : ''}
        </div>`).join('')}</div>` : ''}
    </section>`;
}

// ─── Actions au clic sur une source ─────────────────────────────────────
// Exportée : palmares.js (S-B) résout badge d'accès / périmètre par nom.
export function trouverSource(nom) {
  for (const sec of SRC.data.sections) {
    const e = (sec.entrees ?? []).find(x => x.nom === nom);
    if (e) return e;
  }
  return null;
}

async function ouvrirActions(nom, besoinId) {
  const e = trouverSource(nom);
  if (!e) return;
  const choix = [];
  if (e.url) choix.push('1 — Ouvrir le site ↗');
  if (e.outil) choix.push('2 — Voir l\'outil');
  choix.push('3 — Marquer consultée…');
  const rep = prompt(`${e.nom}\n\n${choix.join('\n')}\n\nNuméro :`);
  if (rep === null) return;
  const n = rep.trim();
  if (n === '1' && e.url) {
    window.open(e.url, '_blank', 'noopener');
  } else if (n === '2' && e.outil) {
    alert(`Outil maison : ${e.outil}\n\n(commande à lancer côté infra — pas d'exécution depuis le site)`);
  } else if (n === '3') {
    const note = prompt('Note (facultatif) :') || '';
    const ok = await enregistrer(() => marquerConsultee(e.nom, besoinId, note.trim()), `Consultation de « ${e.nom} »`, { silencieuxSiOk: true });
    if (!ok) return;
    toast(`Consultation de « ${e.nom} » enregistrée`);
    await hooks.recharger();
  }
}

// ─── Rendu ─────────────────────────────────────────────────────────────
function sousLigne() {
  const sections = SRC.data.sections ?? [];
  const toutes = sections.flatMap(s => s.entrees ?? []);
  const branchees = toutes.filter(e => e.statut === 'branchee');
  const nAcces = branchees.length;
  const nUtilises = new Set(
    Object.entries(SRC.rendement).filter(([, r]) => r.vues > 0).map(([nom]) => nom)
  ).size;
  // « branchés » ≈ sources dont l'accès est direct (API / navigateur auto).
  const nBranches = branchees.filter(e => /API|NAV-AUTO/.test(e.acces ?? '')).length;
  return `${nAcces} accès · ${nBranches} branchés · ${nUtilises} utilisé${nUtilises > 1 ? 's' : ''} ce mois`;
}

function render() {
  const body = $('#sources-body');
  if (!SRC.data) { body.innerHTML = '<div class="skeleton" style="height:220px"></div>'; return; }
  body.innerHTML = `
    <div class="panel src-wrap">
      <div class="src-barre">
        <div class="src-barre-tete">
          <h1 class="src-titre">Sources</h1>
          <a class="src-vers-palmares" href="#/sources/palmares">Palmarès →</a>
        </div>
        <input class="src-recherche" type="search" placeholder="Filtrer par nom…" value="${esc(SRC.q)}" aria-label="Filtrer les sources par nom">
        <div class="src-sousligne">${esc(sousLigne())}</div>
      </div>

      <div class="src-accordeon">
        ${BESOINS.map(volet).join('')}
      </div>

      ${carteDeclencheurs()}
      ${voletEcartees()}
    </div>`;
}

// ─── Délégation d'événements ───────────────────────────────────────────
function brancher() {
  const body = $('#sources-body');

  body.addEventListener('input', e => {
    const inp = e.target.closest('.src-recherche');
    if (!inp) return;
    SRC.q = inp.value;
    render();
    // Rendre le focus au champ après re-render.
    const f = $('#sources-body .src-recherche');
    if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  });

  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      const act = btn.dataset.action;
      if (act === 'toggle-volet') {
        const id = btn.dataset.id;
        SRC.ouvert = SRC.ouvert === id ? null : id;
        render();
      } else if (act === 'plus') {
        SRC.plusDeplie[btn.dataset.id] = true;
        render();
      }
      return;
    }
    const ligne = e.target.closest('.src-ligne:not(.ecartee)');
    if (ligne && !e.target.closest('a')) {
      await ouvrirActions(ligne.dataset.src, ligne.dataset.besoin);
    }
  });

  body.addEventListener('keydown', e => {
    const ligne = e.target.closest('.src-ligne:not(.ecartee)');
    if (ligne && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      ouvrirActions(ligne.dataset.src, ligne.dataset.besoin);
    }
  });
}

hooks.rendre = render;
hooks.recharger = async () => { await chargerTout(); render(); };

let branche = false;

// Dispatch S-A / S-B : la coquille views/sources.js (hors périmètre HO-060)
// appelle mount() sans lire le hash — les deux écrans du territoire partagent
// donc le hashchange global (window.addEventListener côté app.js) pour savoir
// lequel afficher, sans re-remonter tout le territoire.
const estPalmares = () => /^#\/sources\/palmares/.test(location.hash);

async function afficherEcranCourant() {
  const body = $('#sources-body');
  if (estPalmares()) {
    await mountPalmares();
  } else {
    body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
    if (!branche) { brancher(); branche = true; }
    render();
  }
}

window.addEventListener('hashchange', () => {
  if (/^#\/sources/.test(location.hash) && SRC.data) afficherEcranCourant();
});

export async function mount() {
  const body = $('#sources-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  try {
    await chargerTout();
  } catch (err) {
    console.warn('sources:', err);
    body.innerHTML = '<div class="empty"><div class="big">🗃️</div><h2>Sources indisponibles</h2><p>data/sources.json introuvable ou invalide.</p></div>';
    return;
  }
  await afficherEcranCourant();
}
