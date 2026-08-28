// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/identification.js : écran Identification (2c).
// Champs de catalogage regroupés par ce qu'ils débloquent, avec pastilles de
// validation explicite (motif central, HO-046).
// ═══════════════════════════════════════════════════════════════════════════
import { loadViewCss } from '../../core/css.js';
await loadViewCss('objet-identification');
import { esc, toast } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { sb, logEvent } from '../../core/data.js';
import { enregistrer } from '../../core/feedback.js';
import { catCanon } from '../../core/format.js';
import { SOUS, CATS_CANON, CATS_PROMPT } from '../../core/taxonomie.js';
import { openCamera } from '../../core/camera.js';
import { O, hooks, pastilleHtml, toggleValidation, estValide } from './etat.js';

const LABELS = {
  categorie: 'Catégorie', auteur: 'Auteur / atelier', technique: 'Technique',
  titre: 'Titre', etat: 'État', dimensions: 'Dimensions',
  periode: 'Période', ecole: 'Région / école', marques: 'Marques / poinçons',
  zone: 'Zone', contenant: 'Contenant', position: 'Position',
};

const ETATS = ['Neuf / comme neuf', 'Bon état', 'Usagé', 'Accidenté / restauré'];

const BLOC1 = ['categorie', 'auteur', 'technique'];
const BLOC2 = ['titre', 'etat', 'dimensions'];
const BLOC3 = ['periode', 'ecole', 'marques'];

// Champs dont une correction humaine ajoute un verrou + event 'correction'.
const CHAMPS_VERROUILLABLES = new Set([
  'titre', 'categorie', 'sous_categorie', 'auteur', 'technique',
  'periode', 'ecole', 'marques', 'etat', 'etat_detail',
  'hauteur_cm', 'largeur_cm', 'profondeur_cm',
]);

let artistSuggestions = null; // cache promesse [{ nom, count }]

export function rendre(el) {
  const o = S.currentObjet;
  if (!o) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="obj-screen obj-id-screen">
      <nav class="obj-nav">
        <button class="obj-nav-back" data-action="nav" data-ecran="hub">← Fiche</button>
        <span class="obj-nav-title">Identification</span>
        <span class="obj-nav-meta">#${esc(o.id)}</span>
      </nav>
      <div class="obj-screen-body obj-id-body">
        ${renderBloc('Indispensable pour valoriser', BLOC1, o)}
        ${renderBloc('Indispensable pour valider', BLOC2, o)}
        ${renderComplements(o)}
      </div>
    </div>`;

  attachListeners(el);
  loadArtistSuggestions().then(() => refreshAuthorSuggestions(el));

  if (O.focus?.champ) {
    const target = el.querySelector(`[data-champ="${O.focus.champ}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('focus-target');
      setTimeout(() => target.classList.remove('focus-target'), 2200);
    }
    O.focus = null;
  }
}

// ─── Rendu des blocs colorés ────────────────────────────────────────────────

function isBlocValid(champs, o) {
  return champs.every(ch => estValide(ch));
}

function renderBloc(title, champs, o) {
  const valid = isBlocValid(champs, o);
  const cls = valid ? 'obj-id-bloc ok' : 'obj-id-bloc warn';
  return `
    <section class="${cls}">
      <h2 class="obj-id-bloc-title">${esc(title)}</h2>
      <div class="obj-id-bloc-fields">
        ${champs.map(ch => fieldHtml(ch, o)).join('')}
      </div>
    </section>`;
}

function renderComplements(o) {
  const hasTechnique = Boolean(o.technique);
  const champs = [...BLOC3];
  return `
    <details class="obj-id-complements" open>
      <summary>
        <span class="obj-id-complements-title">Compléments</span>
        <span class="obj-id-complements-sub">technique, période, école, marques…</span>
        <span class="obj-id-complements-chev">▾</span>
      </summary>
      <div class="obj-id-complements-body">
        ${!hasTechnique ? fieldHtml('technique', o, { forceInBloc3: true }) : ''}
        ${champs.map(ch => fieldHtml(ch, o)).join('')}
        <div class="obj-id-rangement">
          <div class="obj-field-label">Rangement</div>
          <div class="obj-id-rangement-row">
            ${['zone', 'contenant', 'position'].map(ch => `
              <input type="text" class="obj-input" data-champ="${ch}"
                placeholder="${esc(LABELS[ch])}" value="${esc(o[ch] ?? '')}">`).join('')}
          </div>
        </div>
      </div>
    </details>`;
}

function fieldHtml(champ, o, opts = {}) {
  if (champ === 'categorie') return categorieFieldHtml(o);
  if (champ === 'auteur') return auteurFieldHtml(o);
  if (champ === 'technique') return textFieldHtml('technique', o, opts.forceInBloc3);
  if (champ === 'titre') return textFieldHtml('titre', o, false, true);
  if (champ === 'etat') return etatFieldHtml(o);
  if (champ === 'dimensions') return dimensionsFieldHtml(o);
  if (['periode', 'ecole', 'marques'].includes(champ)) return textFieldHtml(champ, o);
  return '';
}

// ─── Champs individuels ─────────────────────────────────────────────────────

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

function categorieFieldHtml(o) {
  const cur = canonPair(o.categorie);
  const options = CATS_PROMPT.map((p, i) => ({ valeur: p, label: CATS_CANON[i] }));
  if (cur.prompt && !CATS_PROMPT.includes(cur.prompt)) options.push({ valeur: cur.prompt, label: cur.prompt });
  const sous = SOUS[cur.display] ?? [];
  const sousVal = o.sous_categorie ?? '';
  return `
    <div class="obj-id-field" data-champ="categorie">
      <div class="obj-field-label obj-id-label">${esc(LABELS.categorie)}</div>
      <div class="obj-id-cat-row">
        <div class="obj-id-input-wrap obj-id-cat-wrap">
          <select class="obj-input obj-id-cat" data-champ="categorie" data-initial="${esc(cur.prompt)}">
            <option value="">—</option>
            ${options.map(c => `<option value="${esc(c.valeur)}" ${c.valeur === cur.prompt ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="obj-id-input-wrap obj-id-sous-wrap">
          <select class="obj-input obj-id-sous" data-champ="sous_categorie" data-initial="${esc(sousVal)}" ${sous.length ? '' : 'disabled'}>
            <option value="">—</option>
            ${sous.map(s => `<option value="${esc(s)}" ${s === sousVal ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
        </div>
        ${pastilleHtml('categorie')}
      </div>
    </div>`;
}

function auteurFieldHtml(o) {
  const inconnu = estValide('auteur') && !o.auteur;
  return `
    <div class="obj-id-field" data-champ="auteur">
      <div class="obj-id-label-row">
        <span class="obj-field-label">${esc(LABELS.auteur)}</span>
        <label class="obj-id-check">
          <input type="checkbox" data-action="auteur-inconnu" ${inconnu ? 'checked' : ''}>
          <span>auteur inconnu</span>
        </label>
      </div>
      <div class="obj-id-input-row">
        <div class="obj-id-input-wrap obj-id-auteur-wrap">
          <input type="text" class="obj-input" data-champ="auteur" data-initial="${esc(o.auteur ?? '')}"
            placeholder="Atelier, artiste, signature…"
            value="${esc(o.auteur ?? '')}" ${inconnu ? 'disabled' : ''}
            autocomplete="off">
          <div class="obj-id-suggestions" hidden></div>
        </div>
        ${pastilleHtml('auteur')}
      </div>
    </div>`;
}

function textFieldHtml(champ, o, forceInBloc3 = false, pleineLargeur = false) {
  const val = o[champ] ?? '';
  return `
    <div class="obj-id-field" data-champ="${champ}">
      <div class="obj-field-label obj-id-label">${esc(LABELS[champ])}</div>
      <div class="obj-id-input-row ${pleineLargeur ? 'full' : ''}">
        <div class="obj-id-input-wrap">
          <input type="text" class="obj-input" data-champ="${champ}" data-initial="${esc(val)}"
            value="${esc(val)}" ${champ === 'titre' ? 'placeholder="Petit pot cylindrique en faïence…"' : ''}>
        </div>
        ${pastilleHtml(champ)}
      </div>
    </div>`;
}

function etatFieldHtml(o) {
  const etat = o.etat ?? '';
  const detail = o.etat_detail ?? '';
  return `
    <div class="obj-id-field" data-champ="etat">
      <div class="obj-field-label obj-id-label">${esc(LABELS.etat)}</div>
      <div class="obj-id-input-row">
        <div class="obj-id-input-wrap">
          <select class="obj-input" data-champ="etat" data-initial="${esc(etat)}">
            <option value="">—</option>
            ${ETATS.map(e => `<option value="${esc(e)}" ${e === etat ? 'selected' : ''}>${esc(e)}</option>`).join('')}
          </select>
        </div>
        ${pastilleHtml('etat')}
      </div>
      <input type="text" class="obj-input obj-id-etat-detail" data-champ="etat_detail" data-initial="${esc(detail)}"
        placeholder="petits éclats sur le talon…" value="${esc(detail)}">
    </div>`;
}

function dimensionsFieldHtml(o) {
  return `
    <div class="obj-id-field" data-champ="dimensions">
      <div class="obj-id-label-row">
        <span class="obj-field-label">${esc(LABELS.dimensions)}</span>
        <button type="button" class="obj-id-cam-link" data-action="camera-dims">📷 avec règle</button>
      </div>
      <div class="obj-id-input-row">
        <div class="obj-id-dims">
          <input type="text" inputmode="decimal" class="obj-input" data-champ="hauteur_cm" data-initial="${esc(o.hauteur_cm ?? '')}" placeholder="H cm" value="${esc(o.hauteur_cm ?? '')}">
          <input type="text" inputmode="decimal" class="obj-input" data-champ="largeur_cm" data-initial="${esc(o.largeur_cm ?? '')}" placeholder="L / Ø cm" value="${esc(o.largeur_cm ?? '')}">
          <input type="text" inputmode="decimal" class="obj-input" data-champ="profondeur_cm" data-initial="${esc(o.profondeur_cm ?? '')}" placeholder="P cm" value="${esc(o.profondeur_cm ?? '')}">
        </div>
        ${pastilleHtml('dimensions')}
      </div>
    </div>`;
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

// ─── Listeners & persistance ────────────────────────────────────────────────

function attachListeners(el) {
  // Navigation
  el.querySelectorAll('[data-action="nav"]').forEach(b =>
    b.addEventListener('click', () => hooks.naviguer(b.dataset.ecran)));

  // Pastilles
  el.querySelectorAll('[data-action="toggle-val"]').forEach(b =>
    b.addEventListener('click', () => toggleValidation(b.dataset.champ)));

  // Champs : enregistrement au change
  el.querySelectorAll('input[data-champ], select[data-champ]').forEach(inp => {
    inp.addEventListener('change', () => onFieldChange(inp));
    if (inp.dataset.champ === 'auteur') {
      inp.addEventListener('focus', () => showSuggestions(el));
      inp.addEventListener('blur', () => setTimeout(() => hideSuggestions(el), 180));
    }
  });

  // Catégorie → met à jour les sous-catégories
  const catSel = el.querySelector('select[data-champ="categorie"]');
  if (catSel) catSel.addEventListener('change', () => updateSousCategories(el, catSel.value));

  // Auteur inconnu
  const inconnu = el.querySelector('[data-action="auteur-inconnu"]');
  if (inconnu) inconnu.addEventListener('change', () => toggleAuteurInconnu(el, inconnu.checked));

  // Suggestions
  const suggList = el.querySelector('[data-champ="auteur"] .obj-id-suggestions');
  if (suggList) {
    suggList.addEventListener('mousedown', e => {
      const btn = e.target.closest('.obj-id-suggest');
      if (btn) { pickAuthor(el, btn.dataset.nom); e.preventDefault(); }
      else if (e.target.closest('[data-action="suggest-close"]')) { hideSuggestions(el); e.preventDefault(); }
    });
  }

  // Caméra dimensions
  const cam = el.querySelector('[data-action="camera-dims"]');
  if (cam) cam.addEventListener('click', () => openCamera('objet', { onClose: () => hooks.recharger?.(S.currentObjet.id) }));
}

async function onFieldChange(inp) {
  const champ = inp.dataset.champ;
  const initial = inp.dataset.initial;
  let valeur = inp.value.trim();
  if (valeur === '') valeur = null;

  // Conversion numérique pour les dimensions
  let col = champ;
  if (['hauteur_cm', 'largeur_cm', 'profondeur_cm'].includes(champ)) {
    valeur = valeur == null ? null : parseFloat(valeur.replace(',', '.'));
    if (!Number.isFinite(valeur)) valeur = null;
  }

  // Si la valeur n'a pas changé, ne rien faire
  const initialNorm = normalizeInitial(champ, initial);
  if (valeur === initialNorm) return;

  const o = S.currentObjet;
  const updates = { [col]: valeur };
  const corrections = { [col]: { avant: initialNorm, apres: valeur } };

  // Verrou humain + event correction si applicable
  if (CHAMPS_VERROUILLABLES.has(col)) {
    const verrous = new Set(o.verrous_humains || []);
    if (!verrous.has(col)) {
      verrous.add(col);
      updates.verrous_humains = Array.from(verrous);
    }
  }

  const { error } = await sb.from('objets').update(updates).eq('owner_id', S.tenantId).eq('id', o.id);
  if (error) { toast(error.message, true); return; }

  // Met à jour l'objet local
  Object.assign(o, updates);
  inp.dataset.initial = String(valeur ?? '');

  // Log correction (même event que l'ancien edition.js)
  if (CHAMPS_VERROUILLABLES.has(col)) {
    logEvent('correction', { champs: corrections });
  } else if (['zone', 'contenant', 'position'].includes(col)) {
    logEvent('localisation', { champ: col, avant: initialNorm, apres: valeur });
  }

  toast(`✓ ${LABELS[col] ?? col} enregistré`);
}

function normalizeInitial(champ, initial) {
  if (initial == null || initial === '') return null;
  if (['hauteur_cm', 'largeur_cm', 'profondeur_cm'].includes(champ)) {
    const n = parseFloat(String(initial).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return initial;
}

async function toggleAuteurInconnu(el, checked) {
  const o = S.currentObjet;
  const vc = { ...(o.validation_champs || {}) };
  const inp = el.querySelector('input[data-champ="auteur"]');
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

function updateSousCategories(el, cat) {
  const sous = SOUS[canonPair(cat).display] ?? [];
  const sel = el.querySelector('select[data-champ="sous_categorie"]');
  if (!sel) return;
  sel.innerHTML = '<option value="">—</option>' + sous.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.disabled = sous.length === 0;
}

function showSuggestions(el) {
  const list = el.querySelector('[data-champ="auteur"] .obj-id-suggestions');
  if (list) list.hidden = false;
}
function hideSuggestions(el) {
  const list = el.querySelector('[data-champ="auteur"] .obj-id-suggestions');
  if (list) list.hidden = true;
}
function pickAuthor(el, nom) {
  const inp = el.querySelector('input[data-champ="auteur"]');
  if (inp) { inp.value = nom; inp.dataset.initial = ''; hideSuggestions(el); onFieldChange(inp); }
}
