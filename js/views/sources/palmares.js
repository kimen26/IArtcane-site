// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/sources/palmares.js : écran S-B « Palmarès d'usage » (HO-060)
//
// Pilotage de l'usage : qu'est-ce qui sert vraiment, qu'est-ce qui ne sert à
// rien, qu'est-ce qui déclencherait un achat. Miroir de S-A (index.js), lien
// mutuel via le hash #/sources ↔ #/sources/palmares (dispatch dans index.js).
// Écran en lecture seule — aucune écriture, tout dérivé de SRC.consultations
// et des métadonnées de sources.json (rien saisi à la main, règle d'or).
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc } from '../../core/dom.js';
import { SRC } from './etat.js';
import { badges, trouverSource, candidatsDeclencheurs, ETAT_BADGE, nomNu } from './index.js';

const CHIPS = [
  { id: 'tous', label: 'Tous besoins' },
  { id: 'prix', label: 'Prix' },
  { id: 'artiste', label: 'Artistes' },
  { id: 'marques', label: 'Marques' },
];

const RATIO_FAIBLE = 0.3;   // en-dessous : « consultées pour rien »
const VUES_MIN_FAIBLE = 5;  // ... à condition d'avoir un minimum de vues
const CLASSEMENT_VISIBLE = 5;

// État propre à l'écran (survit à la navigation S-A ↔ S-B tant que le module
// reste chargé — pas de persistance, juste l'état de session courant).
const ETAT = {
  fenetre: '30j',       // '30j' | 'tout'
  besoin: 'tous',
  classementDeplie: false,
};

const JOURS_30 = 30 * 24 * 3600 * 1000;

// ─── Filtrage des consultations brutes selon fenêtre + besoin ─────────────
function consultationsFiltrees() {
  const seuil = ETAT.fenetre === '30j' ? Date.now() - JOURS_30 : 0;
  return SRC.consultations.filter(c => {
    if (ETAT.fenetre === '30j' && new Date(c.created_at).getTime() < seuil) return false;
    if (ETAT.besoin !== 'tous' && c.besoin !== ETAT.besoin) return false;
    return true;
  });
}

// ─── Agrégat par source à partir des consultations filtrées ───────────────
function agregerParSource(consultations) {
  const parSource = new Map();
  for (const c of consultations) {
    const a = parSource.get(c.source_nom) ?? { vues: 0, utiles: 0, objets: new Set() };
    a.vues++;
    if (c.a_nourri) a.utiles++;
    if (c.a_nourri && c.objet_id) a.objets.add(c.objet_id);
    parSource.set(c.source_nom, a);
  }
  return parSource;
}

// ─── Bilan (bandeau navy) ──────────────────────────────────────────────────
function bilan(consultations, parSource) {
  const total = consultations.length;
  const utiles = consultations.filter(c => c.a_nourri).length;
  const pct = total ? Math.round((utiles / total) * 100) : 0;
  const objetsValorises = new Set(
    consultations.filter(c => c.a_nourri && c.objet_id).map(c => c.objet_id)
  ).size;
  return `
    <div class="pal-bilan">
      <div class="pal-bilan-sur">${ETAT.fenetre === '30j' ? '30 derniers jours' : 'Depuis le début'}</div>
      <div class="pal-bilan-chiffres">
        <div class="pal-bilan-item">
          <span class="pal-bilan-val">${total}</span>
          <span class="pal-bilan-lbl">consultation${total > 1 ? 's' : ''}</span>
        </div>
        <div class="pal-bilan-item">
          <span class="pal-bilan-val vert">${pct}&nbsp;%</span>
          <span class="pal-bilan-lbl">jugées utiles</span>
        </div>
        <div class="pal-bilan-item">
          <span class="pal-bilan-val ambre">${objetsValorises}</span>
          <span class="pal-bilan-lbl">objet${objetsValorises > 1 ? 's' : ''} valorisé${objetsValorises > 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="pal-bilan-def">« Utile » = la consultation a nourri une fiche : attribution, datation ou fourchette de prix.</div>
    </div>`;
}

// ─── « Ce qui sert vraiment » — classement par nombre d'utiles ────────────
function perimetreResumeSource(e) {
  const doms = e?.perimetre?.domaines ?? [];
  const zones = e?.perimetre?.zones ?? [];
  const bits = [...doms.slice(0, 2), ...zones.slice(0, 1)];
  return bits.join(' · ');
}

function classement(parSource) {
  const lignes = [...parSource.entries()]
    .filter(([, a]) => a.utiles > 0)
    .sort((a, b) => b[1].utiles - a[1].utiles);
  if (!lignes.length) {
    return `
      <div class="pal-carte">
        <div class="pal-carte-tete"><span class="pal-carte-titre">Ce qui sert vraiment</span><span class="pal-filet"></span><span class="pal-carte-sur">utiles</span></div>
        <div class="pal-vide">Aucune consultation utile sur cette période.</div>
      </div>`;
  }
  const max = lignes[0][1].utiles;
  const affichees = ETAT.classementDeplie ? lignes : lignes.slice(0, CLASSEMENT_VISIBLE);
  const rows = affichees.map(([nom, a]) => {
    const e = trouverSource(nom);
    const pct = max ? Math.round((a.utiles / max) * 100) : 0;
    const peri = perimetreResumeSource(e);
    return `
      <div class="pal-ligne">
        <div class="pal-ligne-tete">
          <span class="pal-nom">${esc(nom)}</span>
          ${e ? badges(e.acces) : ''}
          <span class="pal-valeur">${a.utiles}</span>
        </div>
        <div class="pal-jauge-row">
          <span class="pal-jauge"><span class="pal-jauge-fill" style="width:${pct}%"></span></span>
          <span class="pal-jauge-txt">${esc(peri)}${peri ? ' · ' : ''}${a.objets.size} objet${a.objets.size > 1 ? 's' : ''}</span>
        </div>
      </div>`;
  }).join('');
  const reste = lignes.length - affichees.length;
  return `
    <div class="pal-carte">
      <div class="pal-carte-tete"><span class="pal-carte-titre">Ce qui sert vraiment</span><span class="pal-filet"></span><span class="pal-carte-sur">utiles</span></div>
      ${rows}
      ${reste > 0 ? `<button class="pal-plus" data-action="classement-plus">Classement complet (${lignes.length})</button>` : ''}
    </div>`;
}

// ─── « Consultées pour rien » — mauvais ratio, ≥ seuil de vues ────────────
function consulteesPourRien(parSource) {
  const mauvaises = [...parSource.entries()]
    .filter(([, a]) => a.vues >= VUES_MIN_FAIBLE && (a.utiles / a.vues) < RATIO_FAIBLE)
    .sort((a, b) => (a[1].utiles / a[1].vues) - (b[1].utiles / b[1].vues));

  const toutesConnues = new Set([...SRC.data.sections.flatMap(s => s.entrees ?? [])]
    .filter(e => e.statut !== 'ecartee').map(e => e.nom));
  const consultees = new Set(parSource.keys());
  const jamaisOuvertes = [...toutesConnues].filter(n => !consultees.has(n)).length;

  const rows = mauvaises.map(([nom, a]) => {
    const e = trouverSource(nom);
    const peri = perimetreResumeSource(e);
    return `
      <div class="pal-rien-ligne">
        <span class="pal-rien-nom">${esc(nom)}</span>
        <span class="pal-rien-peri">${esc(peri)}</span>
        <span class="pal-rien-mesure">${a.vues} vue${a.vues > 1 ? 's' : ''} · ${a.utiles} utile${a.utiles > 1 ? 's' : ''}</span>
      </div>`;
  }).join('');

  return `
    <div class="pal-carte">
      <div class="pal-carte-tete"><span class="pal-carte-titre">Consultées pour rien</span><span class="pal-filet"></span><span class="pal-carte-sur ambre">à revoir</span></div>
      ${rows || '<div class="pal-vide">Rien à élaguer sur cette période.</div>'}
      <div class="pal-rien-jamais">${jamaisOuvertes} source${jamaisOuvertes > 1 ? 's' : ''} jamais ouverte${jamaisOuvertes > 1 ? 's' : ''} ${ETAT.fenetre === '30j' ? 'en 30 jours' : ''}.</div>
    </div>`;
}

// ─── Déclencheurs — mêmes candidats/mesures que S-A, triés par proximité ──
function declencheurs() {
  const candidates = candidatsDeclencheurs();
  if (!candidates.length) return '';

  const avecProximite = candidates.map(e => {
    const t = e.trigger;
    const mesure = SRC.mesures[t.mesure];
    const connue = typeof mesure === 'number';
    const proximite = connue && t.seuil ? mesure / t.seuil : -1;
    return { e, t, mesure, connue, proximite };
  });

  const actives = avecProximite.filter(x => x.t.etat === 'arme' || x.t.etat === 'atteint')
    .sort((a, b) => b.proximite - a.proximite);
  const pied = avecProximite.filter(x => x.t.etat === 'ajourne' || x.t.etat === 'dormant')
    .sort((a, b) => b.proximite - a.proximite);

  const procheDuSeuil = actives.filter(x => x.proximite >= 0.5).length;

  const ligneActive = ({ e, t, mesure, connue }) => {
    const pct = connue && t.seuil ? Math.min(100, Math.round((mesure / t.seuil) * 100)) : 0;
    const badge = ETAT_BADGE[t.etat] ?? ETAT_BADGE.dormant;
    return `
      <div class="pal-decl">
        <div class="pal-decl-tete">
          <span class="pal-decl-nom">${esc(nomNu(e.nom))} ${esc(e.cout ?? '')}</span>
          <span class="pal-decl-mesure">${connue ? `${mesure} / ${t.seuil}` : `— / ${t.seuil}`}</span>
          <span class="pal-etat ${badge.cls}">${badge.txt}</span>
        </div>
        <div class="pal-decl-si">${esc(t.regle.replace(/^SI\s+/i, 'SI '))}</div>
        <span class="pal-decl-jauge"><span class="pal-decl-fill" style="width:${pct}%"></span></span>
      </div>`;
  };

  const lignePied = ({ e, t, mesure, connue }) => {
    const badge = ETAT_BADGE[t.etat] ?? ETAT_BADGE.dormant;
    return `
      <div class="pal-decl pied">
        <span class="pal-decl-nom">${esc(nomNu(e.nom))} ${esc(e.cout ?? '')}</span>
        <span class="pal-decl-mesure">${connue ? `${mesure} / ${t.seuil}` : `0 / ${t.seuil}`}</span>
        <span class="pal-etat ${badge.cls}">${badge.txt}</span>
      </div>`;
  };

  return `
    <div class="pal-carte-ambre">
      <div class="pal-carte-tete"><span class="pal-carte-titre">Déclencheurs</span><span class="pal-filet ambre"></span><span class="pal-carte-sur ambre">${procheDuSeuil} proche${procheDuSeuil > 1 ? 's' : ''} du seuil</span></div>
      <div class="pal-decl-intro">Mesurés sur les trous des passes IA. Seuil atteint → décision, jamais achat automatique.</div>
      ${actives.map(ligneActive).join('')}
      ${pied.length ? `<div class="pal-decl-pied">${pied.map(lignePied).join('')}</div>` : ''}
    </div>`;
}

// ─── Journal des décisions — triggers ajournés + sources écartées ─────────
function journalDecisions() {
  const entrees = [];
  for (const sec of SRC.data.sections) {
    for (const e of sec.entrees ?? []) {
      if (e.trigger?.etat === 'ajourne') {
        entrees.push({
          titre: `${esc(nomNu(e.nom))} — achat ajourné`,
          detail: [e.trigger.decisionRef, e.date].filter(Boolean).join(' · ') || 'décision cerveau',
          couleur: 'ambre',
        });
      }
      if (e.statut === 'ecartee' && e.motifEcart) {
        entrees.push({
          titre: `${esc(nomNu(e.nom))} — écartée`,
          detail: esc(e.motifEcart),
          couleur: 'neutre',
        });
      }
    }
  }
  // Dédoublonnage : même triplet titre+détail vu plusieurs fois dans le JSON
  // (Akoun/Lotz apparaissent à la fois en catalogue et en stratégie d'achat).
  const vues = new Set();
  const uniques = entrees.filter(x => {
    const cle = x.titre + '|' + x.detail;
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });

  if (!uniques.length) {
    return `
      <div class="pal-carte">
        <div class="pal-carte-tete"><span class="pal-carte-titre">Journal des décisions</span><span class="pal-filet"></span></div>
        <div class="pal-vide">Aucune décision enregistrée.</div>
      </div>`;
  }

  const rows = uniques.map(x => `
    <div class="pal-journal-ligne">
      <span class="pal-journal-filet ${x.couleur}"></span>
      <div class="pal-journal-corps">
        <span class="pal-journal-titre">${x.titre}</span>
        <span class="pal-journal-detail">${x.detail}</span>
      </div>
    </div>`).join('');

  return `
    <div class="pal-carte">
      <div class="pal-carte-tete"><span class="pal-carte-titre">Journal des décisions</span><span class="pal-filet"></span></div>
      ${rows}
    </div>`;
}

// ─── Rendu ─────────────────────────────────────────────────────────────
function render() {
  const body = $('#sources-body');
  if (!SRC.data) { body.innerHTML = '<div class="skeleton" style="height:220px"></div>'; return; }

  const consultations = consultationsFiltrees();
  const parSource = agregerParSource(consultations);

  body.innerHTML = `
    <div class="pal-wrap">
      <div class="pal-barre">
        <div class="pal-barre-tete">
          <a class="pal-retour" href="#/sources">‹ Par besoin</a>
          <h1 class="pal-titre">Sources</h1>
          <div class="pal-bascule">
            <button class="pal-bascule-opt ${ETAT.fenetre === '30j' ? 'actif' : ''}" data-action="fenetre" data-val="30j">30 j</button>
            <button class="pal-bascule-opt ${ETAT.fenetre === 'tout' ? 'actif' : ''}" data-action="fenetre" data-val="tout">tout</button>
          </div>
        </div>
        <div class="pal-chips">
          ${CHIPS.map(c => `<button class="pal-chip ${ETAT.besoin === c.id ? 'actif' : ''}" data-action="besoin" data-val="${esc(c.id)}">${esc(c.label)}</button>`).join('')}
        </div>
      </div>

      <div class="pal-corps">
        ${bilan(consultations, parSource)}
        ${classement(parSource)}
        ${consulteesPourRien(parSource)}
        ${declencheurs()}
        ${journalDecisions()}
      </div>
    </div>`;
}

// ─── Délégation d'événements (une seule fois, comme S-A) ──────────────────
let branche = false;
function brancher() {
  const body = $('#sources-body');
  body.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'fenetre') { ETAT.fenetre = btn.dataset.val; render(); }
    else if (act === 'besoin') { ETAT.besoin = btn.dataset.val; render(); }
    else if (act === 'classement-plus') { ETAT.classementDeplie = true; render(); }
  });
}

export async function mount() {
  if (!branche) { brancher(); branche = true; }
  render();
}
