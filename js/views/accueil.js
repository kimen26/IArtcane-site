// IArtcane — views/accueil.js : accueil PROVISOIRE (HO-118) — le journal
// arrive en HO-119 dans ce même fichier. Route `#/`.
import { $ } from '../core/dom.js';
import { S, canWrite } from '../core/state.js';
import { page } from '../ui/page.js';

export function mount() {
  const corps = page($('#accueil-body'), {
    titre: 'Accueil', fil: S.fil,
    barre: canWrite() ? { actions: [{ label: '+ Capturer un objet', type: 'primaire', onClick: () => { location.hash = '#/capture'; } }] } : { actions: [] },
  });
  corps.innerHTML = `<p class="ui-texte-vide">Le journal arrive ici (HO-119).</p>`;
}
