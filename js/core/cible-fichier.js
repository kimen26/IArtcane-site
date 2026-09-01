// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/cible-fichier.js : figer l'objet visé par un `<input type=file>`
// GLOBAL avant de l'ouvrir, et le relire au retour des fichiers.
//
// Pourquoi ce module existe (retour Alain, 2026-09-01 : « les photos de ce matin
// allaient dans d'autres objets à chaque fois » — 12 photos parasites sur #0065,
// supprimées à la main) : les inputs fichier vivent dans `index.html`, ils sont
// donc UNIQUES et partagés par tous les écrans. Sur Android, en ouvrir un lance
// la galerie système et fait passer l'app en arrière-plan ; entre le clic et le
// retour des fichiers, l'utilisateur peut avoir changé de fiche. Un handler qui
// lit `S.currentObjet` À CE MOMENT-LÀ écrit dans l'objet affiché au retour, pas
// dans celui qu'on visait.
//
// Règle : la cible se décide au CLIC (`viser`), se consomme au retour
// (`cibleVisee`), et une cible absente fait REFUSER l'écriture — une photo
// perdue se reprend, une photo rangée dans la mauvaise fiche se découvre des
// semaines plus tard.
// ═══════════════════════════════════════════════════════════════════════════

/** Fige `objetId` sur l'input puis l'ouvre. `objetId` absent → rien n'est ouvert. */
export function viser(input, objetId) {
  if (!input) return false;
  const id = String(objetId ?? '');
  if (!id) return false;
  input.dataset.objetId = id;
  input.click();
  return true;
}

/** Relit la cible figée et la consomme (l'input est remis à neuf au passage). */
export function cibleVisee(input) {
  const id = input?.dataset?.objetId || '';
  if (input) {
    input.value = '';
    input.dataset.objetId = '';
  }
  return id;
}

// ─── Écoute unique d'un input global ────────────────────────────────────────
// Deuxième visage du même piège : une vue qui rebranche ses écouteurs à CHAQUE
// rendu (capture/index.js appelle `brancher()` en fin de `render()`) empile un
// `change` de plus par rendu sur ces inputs partagés — une photo choisie était
// alors ajoutée 2, 3, 6 fois. `ecouterUneFois` garantit un seul écouteur par
// input, quel que soit le nombre de rendus.
const dejaEcoutes = new WeakSet();
export function ecouterUneFois(input, surFichiers) {
  if (!input || dejaEcoutes.has(input)) return;
  dejaEcoutes.add(input);
  input.addEventListener('change', e => {
    // Copie AVANT de vider l'input : `files` est une FileList vivante, la
    // remettre à '' la viderait sous les pieds de l'appelant.
    const fichiers = [...e.target.files];
    e.target.value = '';
    surFichiers(fichiers);
  });
}
