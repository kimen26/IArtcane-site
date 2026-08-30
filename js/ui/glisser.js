// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/glisser.js : réordonnancement par appui long + glissé, une
// fois pour toutes (HO-106, docs/architecture-briques.md §2.2). Extrait des
// 3 blocs quasi identiques (objet/photos.js, artiste/images.js, capture/
// index.js — 95-102 l. chacun) en repartant de la version artiste, la plus
// complète (renumérotation en direct des vignettes), rendue optionnelle via
// `surNumero`. Constantes de terrain (400 ms, seuil 8 px) conservées telles
// quelles — tests « gros doigts » avec Alain, HO-027/HO-047, pas des valeurs
// arbitraires.
//
// ⚠️ Correction au passage (constatée en écrivant ce fichier, pas cherchée) :
// les 3 copies calculaient `nouvelOrdre` en réécrivant `dataset.idx` de
// chaque vignette pour qu'il vaille sa PROPRE position d'affichage, puis
// relisaient ce même attribut dans le même ordre — un calcul qui rend
// toujours [0,1,…,n-1], quel que soit le glissé réellement effectué (vérifié
// par simulation). Conséquence mesurée : objet/photos.js et artiste/images.js
// persistaient un ordre inchangé après un glissé — la vignette « revenait »
// visuellement à sa place au rendu suivant. Seule la version capture
// (reorderCapFiles(from,to), un déplacement direct) était correcte. En
// unifiant les trois dans une seule fonction, ce bloc calcule désormais la
// permutation réelle : `dataset.idx` posé UNE FOIS par l'appelant (identité
// stable, jamais réécrite ici), la position d'affichage se lit sur l'ordre
// du tableau interne. Signalé dans le rapport HO-106 — ce n'est pas une
// simple extraction, c'est corrigé, donc à valider par le cerveau.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Active le réordonnancement par appui long + glissé sur une grille de
 * vignettes. Chaque vignette doit porter `data-idx` = son index STABLE dans
 * l'ordre d'origine (posé par l'appelant au rendu, jamais modifié ici).
 * @param {HTMLElement} grille conteneur direct des items (`selecteurItem`)
 * @param {object} opts
 *   selecteurItem {string}              sélecteur CSS d'un item (ex. '.ui-vign')
 *   delaiMs       {number=400}          appui long avant activation du glissé
 *   seuilPx       {number=8}            mouvement au-delà duquel l'appui long est annulé
 *   surFin        {(ordre:number[])=>void}  ordre[i] = nouveau rang de l'item originellement en i
 *   surNumero     {(el:HTMLElement, i:number)=>void=}  appelé pour chaque item à sa nouvelle position i (renumérotation live, optionnelle)
 * @returns {Function} détache tous les listeners posés (démontage propre — HO-066)
 */
export function activerGlisser(grille, opts) {
  const { selecteurItem, delaiMs = 400, seuilPx = 8, surFin, surNumero } = opts;
  if (typeof surFin !== 'function') throw new Error('activerGlisser: surFin obligatoire');

  let drag = null;
  const detacheurs = [];

  function attacher(item) {
    let timer = null;
    let startX = 0, startY = 0;

    const start = e => {
      if (e.button !== 0) return;
      startX = e.clientX; startY = e.clientY;
      timer = setTimeout(() => demarrer(item, e), delaiMs);
      item.setPointerCapture?.(e.pointerId);
    };
    const move = e => {
      if (!timer && !drag) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (timer && (Math.abs(dx) > seuilPx || Math.abs(dy) > seuilPx)) {
        clearTimeout(timer); timer = null;
      }
      if (drag) deplacer(e);
    };
    const end = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (drag) terminer();
    };

    item.addEventListener('pointerdown', start);
    item.addEventListener('pointermove', move);
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', end);
    detacheurs.push(() => {
      item.removeEventListener('pointerdown', start);
      item.removeEventListener('pointermove', move);
      item.removeEventListener('pointerup', end);
      item.removeEventListener('pointercancel', end);
    });
  }

  function demarrer(item, e) {
    // Ordre de DÉPART, jamais muté : sert de référence stable pour calculer
    // la permutation finale (original[i] = l'item qui était en position i).
    const original = [...grille.querySelectorAll(selecteurItem)];
    const rect = item.getBoundingClientRect();
    const clone = item.cloneNode(true);
    clone.classList.add('dragging');
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    document.body.append(clone);
    item.classList.add('drag-ghost');

    drag = {
      item, original, courant: [...original], clone,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top,
      moved: false,
    };
  }

  function deplacer(e) {
    const { clone, offsetX, offsetY, courant, item } = drag;
    clone.style.left = `${e.clientX - offsetX}px`;
    clone.style.top = `${e.clientY - offsetY}px`;
    drag.moved = true;

    clone.style.visibility = 'hidden';
    const cible = document.elementFromPoint(e.clientX, e.clientY)?.closest(selecteurItem);
    clone.style.visibility = '';
    if (!cible || cible === item) return;

    const posActuelle = courant.indexOf(item);
    const posCible = courant.indexOf(cible);
    if (posActuelle < 0 || posCible < 0 || posActuelle === posCible) return;

    courant.splice(posActuelle, 1);
    courant.splice(posCible, 0, item);
    courant.forEach((t, i) => { grille.append(t); surNumero?.(t, i); });
  }

  function terminer() {
    const { item, original, courant, moved } = drag;
    drag.clone.remove();
    courant.forEach(t => t.classList.remove('drag-ghost'));
    drag = null;

    // Le pointerup qui vient de finir le glissé fait souvent naître un
    // 'click' juste après (comportement natif du navigateur). Un écouteur
    // capture posé sur `grille` (ancêtre de `item`) intercepte ce click
    // AVANT qu'il n'atteigne le listener 'select' de l'appelant, une seule
    // fois — évite qu'un glissé ne déclenche aussi une sélection.
    if (moved) grille.addEventListener('click', bloquerClicSuivant, { capture: true, once: true });

    // ordre[i] = nouveau rang de `original[i]` — directement consommable par
    // reordonner(cible, imagesOriginales, ordre) côté service.
    const ordre = original.map(el => courant.indexOf(el));
    surFin(ordre);
  }

  function bloquerClicSuivant(e) { e.stopPropagation(); }

  grille.querySelectorAll(selecteurItem).forEach(attacher);

  return () => detacheurs.forEach(f => f());
}
