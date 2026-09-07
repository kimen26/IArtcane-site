// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/categorie.js : le couple catégorie / sous-catégorie.
//
// Extrait de `identification.js` (2026-09-07) qui butait sur son plafond de
// modularité. Le regroupement n'est pas qu'une question de lignes : ces trois
// fonctions forment un tout — traduire une graphie vers la taxonomie
// (`canonPair`), en déduire les sous-catégories offertes (`sousOptions`), et
// tenir la cascade quand la catégorie change (`brancherCascade`).
//
// Les deux selects sont rendus par `ui/champs.js` en `type:'groupe'`, une
// seule pastille au bout de la rangée. Avant, la sous-catégorie était injectée
// après coup DANS la carte du champ `categorie` : la pastille se retrouvait
// derrière elle et semblait valider son « — » vide (retour Yann, fiche #0029).
// Même correctif que HO-139 pour les dimensions.
// ═══════════════════════════════════════════════════════════════════════════
import { esc } from '../../core/dom.js';
import { catCanon } from '../../core/format.js';
import { SOUS, CATS_CANON, CATS_PROMPT } from '../../core/taxonomie.js';

/**
 * Les deux visages d'une catégorie : la forme `prompt` (celle qu'écrivent la
 * R1 et le cron, « gravure/estampe ») et la forme `display` (celle qu'on lit,
 * « Gravure / estampe »). Une valeur inconnue de la taxonomie est rendue telle
 * quelle plutôt qu'écrasée — on n'invente pas une catégorie.
 */
export function canonPair(c) {
  if (!c) return { prompt: '', display: '' };
  const i = CATS_PROMPT.indexOf(c);
  if (i >= 0) return { prompt: c, display: CATS_CANON[i] };
  const display = catCanon(c);
  const j = CATS_CANON.indexOf(display);
  if (j >= 0) return { prompt: CATS_PROMPT[j], display };
  return { prompt: c, display: c };
}

/** Les catégories offertes, la valeur courante ajoutée si elle est hors liste. */
export function categorieOptions(courantPrompt) {
  const options = CATS_PROMPT.map((p, i) => ({ valeur: p, label: CATS_CANON[i] }));
  if (courantPrompt && !CATS_PROMPT.includes(courantPrompt)) options.push({ valeur: courantPrompt, label: courantPrompt });
  return options;
}

/** Les sous-catégories d'une catégorie d'AFFICHAGE, prêtes pour un select. */
export function sousOptions(display) {
  return (SOUS[display] ?? []).map(s => ({ valeur: s, label: s }));
}

/**
 * La cascade — le seul métier qu'aucune brique générique ne peut porter :
 * changer la catégorie recalcule les sous-catégories offertes et vide celle
 * qui appartenait à l'ancienne (D-085 : sinon la fiche garde en base une
 * sous-catégorie d'une catégorie qu'elle n'a plus).
 * @param {Element} corps        le conteneur rendu par `champs()`
 * @param {string}  categorie    la catégorie courante de l'objet
 * @param {Function} surVidage   appelée quand la sous-catégorie doit être vidée
 */
export function brancherCascade(corps, categorie, surVidage) {
  const catSel = corps.querySelector('select[data-champ="categorie"]');
  const sousSel = corps.querySelector('select[data-champ="sous_categorie"]');
  if (!catSel || !sousSel) return;
  sousSel.disabled = (SOUS[canonPair(categorie).display] ?? []).length === 0;
  catSel.addEventListener('change', () => {
    const sous = SOUS[canonPair(catSel.value).display] ?? [];
    sousSel.innerHTML = '<option value="">—</option>' + sous.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    sousSel.disabled = sous.length === 0;
    surVidage();
  });
}
