// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/sources.js : coquille de la vue Sources (D-041, HO-059)
// Le territoire vit dans views/sources/ :
//   • index.js  écran S-A « Par besoin » (accordéon, rendement, déclencheurs)
//   • etat.js   chargement JSON + agrégats consultations + mesures
// S-B « Palmarès d'usage » : HO-060.
// ═══════════════════════════════════════════════════════════════════════════
import { mount as mountSA } from './sources/index.js';

export function mount() {
  mountSA();
}
