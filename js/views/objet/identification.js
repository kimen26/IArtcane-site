// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/identification.js : écran Identification (2c).
// Champs de catalogage regroupés par ce qu'ils débloquent, avec pastilles de
// validation explicite (motif central, HO-046). La mise en page (blocs,
// grille, pastilles, contrôles de saisie) est déléguée à ui/champs.js
// (HO-107) ; cet écran ne fait plus que construire les listes de champs et
// porter le métier qui ne peut pas être générique : cascade catégorie →
// sous-catégorie, suggestions d'artiste, verrous humains, auteur inconnu.
// ═══════════════════════════════════════════════════════════════════════════
import { loadViewCss } from '../../core/css.js';
await loadViewCss('objet-identification');
import { esc, toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { sb, logEvent } from '../../core/data.js';
import { enregistrer, humaniser } from '../../core/feedback.js';
import { catCanon } from '../../core/format.js';
import { SOUS, CATS_CANON, CATS_PROMPT } from '../../core/taxonomie.js';
import { openCamera } from '../../core/camera.js';
import { page } from '../../ui/page.js';
import { champs } from '../../ui/champs.js';
import { O, hooks, toggleValidation, estValide } from './etat.js';

const LABELS = {
  categorie: 'Catégorie', auteur: 'Auteur / atelier', technique: 'Technique',
  titre: 'Titre', etat: 'État', dimensions: 'Dimensions',
  periode: 'Période', ecole: 'Région / école', marques: 'Marques / poinçons',
  zone: 'Zone', contenant: 'Contenant', position: 'Position',
};

const ETATS = ['Neuf / comme neuf', 'Bon état', 'Usagé', 'Accidenté / restauré'];

// Champs dont une correction humaine ajoute un verrou + event 'correction'.
const CHAMPS_VERROUILLABLES = new Set([
  'titre', 'categorie', 'sous_categorie', 'auteur', 'technique',
  'periode', 'ecole', 'marques', 'etat', 'etat_detail',
  'hauteur_cm', 'largeur_cm', 'profondeur_cm',
]);

const etatDe = champ => (estValide(champ) ? 'valide' : 'a-valider');

let artistSuggestions = null; // cache promesse [{ nom, count }]

export function rendre(el) {
  const o = S.currentObjet;
  if (!o) { el.innerHTML = ''; return; }

  const corps = page(el, {
    titre: 'Identification',
    fil: [...S.fil, { label: 'Identification' }],
  });

  corps.innerHTML = `
    <div class="obj-id-body">
      <div id="obj-id-bloc1"></div>
      <div id="obj-id-bloc2"></div>
      <details class="obj-id-complements" open>
        <summary>
          <span class="obj-id-complements-title">Compléments</span>
          <span class="obj-id-complements-sub">technique, période, école, marques…</span>
          <span class="obj-id-complements-chev">▾</span>
        </summary>
        <div class="obj-id-complements-body">
          <div id="obj-id-complements"></div>
          <div class="obj-id-rangement">
            <div class="obj-field-label">Rangement</div>
            <div class="obj-id-rangement-row">
              ${['zone', 'contenant', 'position'].map(ch => `
                <input type="text" class="obj-input" data-champ="${ch}"
                  placeholder="${esc(LABELS[ch])}" value="${esc(o[ch] ?? '')}">`).join('')}
            </div>
          </div>
        </div>
      </details>
    </div>`;

  const sur = { changer: onFieldChange, basculerValidation: toggleValidation };
  champs(corps.querySelector('#obj-id-bloc1'), { titre: 'Indispensable pour valoriser', liste: bloc1Liste(o), sur });
  champs(corps.querySelector('#obj-id-bloc2'), { titre: 'Indispensable pour valider', liste: bloc2Liste(o), sur });
  champs(corps.querySelector('#obj-id-complements'), { liste: complementsListe(o), sur });

  augmentCategorie(corps, o);
  augmentAuteur(corps, o);
  augmentDimensions(corps);
  attachRangement(corps);

  loadArtistSuggestions().then(() => refreshAuthorSuggestions(corps));

  if (O.focus?.champ) {
    const target = corps.querySelector(`[data-champ="${O.focus.champ}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('focus-target');
      setTimeout(() => target.classList.remove('focus-target'), 2200);
    }
    O.focus = null;
  }
}

// ─── Construction des listes de champs (métier : valeurs, etat, options) ───

// Catégorie stockée = forme prompt (CATS_PROMPT, D-059) ; l'UI affiche la forme
// canonique (CATS_CANON). Rabat n'importe quelle forme (prompt, display, variante
// LLM) sur la paire { prompt, display } ; hors liste = conservé tel quel.
function canonPair(c) {
  if (!c) return { prompt: '', display: '' };
  const i = CATS_PROMPT.indexOf(c);
  if (i >= 0) return { prompt: c, display: CATS_CANON[i] };
  const display = catCanon(c);
  const j = CATS_CANON.indexOf(display);
  if (j >= 0) return { prompt: CATS_PROMPT[j], display };
  return { prompt: c, display: c };
}

function bloc1Liste(o) {
  const cur = canonPair(o.categorie);
  const options = CATS_PROMPT.map((p, i) => ({ valeur: p, label: CATS_CANON[i] }));
  if (cur.prompt && !CATS_PROMPT.includes(cur.prompt)) options.push({ valeur: cur.prompt, label: cur.prompt });
  return [
    { cle: 'categorie', titre: LABELS.categorie, valeur: cur.prompt, editable: true, type: 'select', options, etat: etatDe('categorie'), pleineLargeur: true },
    { cle: 'auteur', titre: LABELS.auteur, valeur: o.auteur ?? '', editable: true, type: 'texte', placeholder: 'Atelier, artiste, signature…', etat: etatDe('auteur'), pleineLargeur: true },
    { cle: 'technique', titre: LABELS.technique, valeur: o.technique ?? '', editable: true, type: 'texte', etat: etatDe('technique') },
  ];
}

function bloc2Liste(o) {
  return [
    { cle: 'titre', titre: LABELS.titre, valeur: o.titre ?? '', editable: true, type: 'texte', placeholder: 'Petit pot cylindrique en faïence…', etat: etatDe('titre'), pleineLargeur: true },
    { cle: 'etat', titre: LABELS.etat, valeur: o.etat ?? '', editable: true, type: 'select', options: ETATS, etat: etatDe('etat'), pleineLargeur: true },
    { cle: 'etat_detail', valeur: o.etat_detail ?? '', editable: true, type: 'texte', placeholder: 'petits éclats sur le talon…', pleineLargeur: true },
    { cle: 'hauteur_cm', titre: 'H (cm)', valeur: o.hauteur_cm ?? '', editable: true, type: 'nombre', placeholder: 'H cm' },
    { cle: 'largeur_cm', titre: 'L / Ø (cm)', valeur: o.largeur_cm ?? '', editable: true, type: 'nombre', placeholder: 'L / Ø cm' },
    { cle: 'profondeur_cm', titre: 'P (cm)', valeur: o.profondeur_cm ?? '', editable: true, type: 'nombre', placeholder: 'P cm', etat: etatDe('dimensions') },
  ];
}

function complementsListe(o) {
  const liste = [];
  if (!o.technique) liste.push({ cle: 'technique', titre: LABELS.technique, valeur: '', editable: true, type: 'texte', etat: etatDe('technique') });
  for (const ch of ['periode', 'ecole', 'marques']) {
    liste.push({ cle: ch, titre: LABELS[ch], valeur: o[ch] ?? '', editable: true, type: 'texte', etat: etatDe(ch) });
  }
  return liste;
}

// ─── Augmentations : la partie non générique de categorie/auteur/dimensions ─
// champs() rend le champ générique (label, pastille, contrôle principal) ;
// ces fonctions y ajoutent ce qu'aucune brique générique ne peut représenter
// (sous-liste dérivée, suggestions, bouton caméra) sans rien retirer de ce
// que champs() a déjà posé (le contrôle principal garde son écouteur
// sur.changer, posé par champs() lui-même).

function updateSousCategories(carte, cat) {
  const sous = SOUS[canonPair(cat).display] ?? [];
  const sel = carte.querySelector('.obj-id-sous');
  if (!sel) return;
  sel.innerHTML = '<option value="">—</option>' + sous.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.disabled = sous.length === 0;
}

function augmentCategorie(corps, o) {
  const carte = corps.querySelector('[data-champ="categorie"]');
  const catSel = carte?.querySelector('.ui-champs-input');
  if (!carte || !catSel) return;
  const cur = canonPair(o.categorie);
  const sous = SOUS[cur.display] ?? [];
  const sousVal = o.sous_categorie ?? '';
  catSel.insertAdjacentHTML('afterend', `
    <select class="ui-champs-input obj-id-sous" data-champ="sous_categorie" ${sous.length ? '' : 'disabled'}>
      <option value="">—</option>
      ${sous.map(s => `<option value="${esc(s)}" ${s === sousVal ? 'selected' : ''}>${esc(s)}</option>`).join('')}
    </select>`);
  const sousSel = carte.querySelector('.obj-id-sous');
  catSel.addEventListener('change', () => updateSousCategories(carte, catSel.value));
  sousSel.addEventListener('change', () => onFieldChange('sous_categorie', sousSel.value));
}

function augmentAuteur(corps, o) {
  const carte = corps.querySelector('[data-champ="auteur"]');
  const inp = carte?.querySelector('.ui-champs-input');
  const entete = carte?.querySelector('.ui-champs-entete');
  if (!carte || !inp || !entete) return;
  const inconnu = estValide('auteur') && !o.auteur;
  entete.insertAdjacentHTML('beforeend', `
    <label class="obj-id-check">
      <input type="checkbox" data-action="auteur-inconnu" ${inconnu ? 'checked' : ''}>
      <span>auteur inconnu</span>
    </label>`);
  inp.setAttribute('autocomplete', 'off');
  if (inconnu) inp.disabled = true;
  inp.insertAdjacentHTML('afterend', '<div class="obj-id-suggestions" hidden></div>');

  entete.querySelector('[data-action="auteur-inconnu"]').addEventListener('change', (e) => toggleAuteurInconnu(carte, e.target.checked));
  inp.addEventListener('focus', () => showSuggestions(carte));
  inp.addEventListener('blur', () => setTimeout(() => hideSuggestions(carte), 180));
  carte.querySelector('.obj-id-suggestions').addEventListener('mousedown', e => {
    const btn = e.target.closest('.obj-id-suggest');
    if (btn) { pickAuthor(carte, btn.dataset.nom); e.preventDefault(); }
    else if (e.target.closest('[data-action="suggest-close"]')) { hideSuggestions(carte); e.preventDefault(); }
  });
}

function augmentDimensions(corps) {
  const carte = corps.querySelector('[data-champ="hauteur_cm"]');
  const entete = carte?.querySelector('.ui-champs-entete');
  if (!entete) return;
  entete.insertAdjacentHTML('beforeend', '<button type="button" class="obj-id-cam-link" data-action="camera-dims">📷 avec règle</button>');
  entete.querySelector('[data-action="camera-dims"]').addEventListener('click',
    () => openCamera('objet', { onClose: () => hooks.recharger?.(S.currentObjet.id) }));
}

function attachRangement(corps) {
  corps.querySelectorAll('.obj-id-rangement-row input[data-champ]').forEach(inp =>
    inp.addEventListener('change', () => onFieldChange(inp.dataset.champ, inp.value)));
}

// ─── Suggestions artistes ───────────────────────────────────────────────────

async function loadArtistSuggestions() {
  if (artistSuggestions) return artistSuggestions;
  const [{ data: artistes }, { data: objs }] = await Promise.all([
    sb.from('artistes').select('nom').eq('owner_id', S.tenantId).order('nom'),
    sb.from('objets').select('auteur').eq('owner_id', S.tenantId).not('auteur', 'is', null),
  ]);
  const counts = {};
  for (const o of objs ?? []) counts[o.auteur] = (counts[o.auteur] || 0) + 1;
  const noms = new Set((artistes ?? []).map(a => a.nom));
  for (const aut of Object.keys(counts)) noms.add(aut);
  artistSuggestions = [...noms].sort().map(nom => ({ nom, count: counts[nom] || 0 }));
  return artistSuggestions;
}

function refreshAuthorSuggestions(el) {
  const list = el.querySelector('[data-champ="auteur"] .obj-id-suggestions');
  if (!list || artistSuggestions == null) return;
  const items = artistSuggestions.map(({ nom, count }) => `
    <button type="button" class="obj-id-suggest" data-nom="${esc(nom)}">
      <span>${esc(nom)}</span><span>${count} objet${count > 1 ? 's' : ''}</span>
    </button>`).join('');
  list.innerHTML = `
    <div class="obj-id-suggest-header">Déjà dans ta collection</div>
    ${items}
    <button type="button" class="obj-id-suggest-new" data-action="suggest-close">+ saisir un autre nom / alias</button>`;
}

function showSuggestions(el) {
  const list = el.querySelector('.obj-id-suggestions');
  if (list) list.hidden = false;
}
function hideSuggestions(el) {
  const list = el.querySelector('.obj-id-suggestions');
  if (list) list.hidden = true;
}
function pickAuthor(carte, nom) {
  const inp = carte.querySelector('.ui-champs-input');
  if (inp) { inp.value = nom; hideSuggestions(carte); onFieldChange('auteur', nom); }
}

async function toggleAuteurInconnu(carte, checked) {
  const o = S.currentObjet;
  const vc = { ...(o.validation_champs || {}) };
  const inp = carte.querySelector('.ui-champs-input');
  const updates = { validation_champs: vc };
  if (checked) {
    vc.auteur = { par: localStorage.getItem('iartcane-qui') ?? 'alain', at: new Date().toISOString() };
    if (inp) { inp.value = ''; inp.disabled = true; }
    if (o.auteur) {
      updates.auteur = null;
      const verrous = new Set(o.verrous_humains || []);
      verrous.add('auteur');
      updates.verrous_humains = Array.from(verrous);
    }
  } else {
    delete vc.auteur;
    if (inp) inp.disabled = false;
  }
  const ok = await enregistrer(() => sb.from('objets').update(updates).eq('owner_id', S.tenantId).eq('id', o.id), checked ? 'Auteur inconnu' : 'Auteur à renseigner');
  if (!ok) return;
  Object.assign(o, updates);
  logEvent('validation_champ', { champ: 'auteur', valide: checked, inconnu: true });
  hooks.rendre?.();
}

// ─── Persistance (métier — reste dans la vue) ───────────────────────────────

function normalizeInitial(champ, valeur) {
  if (valeur == null || valeur === '') return null;
  if (['hauteur_cm', 'largeur_cm', 'profondeur_cm'].includes(champ)) {
    const n = parseFloat(String(valeur).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return valeur;
}

async function onFieldChange(champ, valeurBrute) {
  let valeur = typeof valeurBrute === 'string' ? valeurBrute.trim() : valeurBrute;
  if (valeur === '') valeur = null;

  const col = champ;
  if (['hauteur_cm', 'largeur_cm', 'profondeur_cm'].includes(col)) {
    valeur = valeur == null ? null : parseFloat(String(valeur).replace(',', '.'));
    if (!Number.isFinite(valeur)) valeur = null;
  }

  const o = S.currentObjet;
  const avant = normalizeInitial(col, o[col]);
  if (valeur === avant) return;

  const updates = { [col]: valeur };
  const corrections = { [col]: { avant, apres: valeur } };

  if (CHAMPS_VERROUILLABLES.has(col)) {
    const verrous = new Set(o.verrous_humains || []);
    if (!verrous.has(col)) { verrous.add(col); updates.verrous_humains = Array.from(verrous); }
  }

  const { error } = await sb.from('objets').update(updates).eq('owner_id', S.tenantId).eq('id', o.id);
  if (error) { console.warn('identification:', error); toast(`« ${LABELS[col] ?? col} » non enregistré — ${humaniser(error)}.`, 'panne'); return; } // LABELS : Alain lit « Catégorie » (HO-110)

  Object.assign(o, updates);

  if (CHAMPS_VERROUILLABLES.has(col)) {
    logEvent('correction', { champs: corrections });
  } else if (['zone', 'contenant', 'position'].includes(col)) {
    logEvent('localisation', { champ: col, avant, apres: valeur });
  }

  toast(`✓ ${LABELS[col] ?? col} enregistré`);
}
