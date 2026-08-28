// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/feedback.js : socle de retour utilisateur (HO-075, D-068)
// Trois primitives : toast (confirmation légère), enregistrer (écriture
// Supabase qui rend TOUJOURS compte, règle Yann 2026-08-28), withBusy
// (opération longue visible et annulable, L-027). Ne dépend PAS de dom.js
// (dom.js re-exporte toast depuis ici, pas l'inverse — pas de cycle).
// ═══════════════════════════════════════════════════════════════════════════

const $ = sel => document.querySelector(sel);
const MAX_TOASTS = 3;
const DUREE_SUCCES = 7000;

/**
 * Affiche un toast en haut d'écran. Les messages identiques déjà visibles
 * sont regroupés (« ×2 ») plutôt que dupliqués (L-022 : une rafale de toasts
 * identiques passe inaperçue). Au-delà de MAX_TOASTS visibles, le plus ancien
 * sort. Erreur = persistant par défaut (pas d'auto-fermeture) : jamais de
 * panne qui disparaît toute seule avant d'être vue.
 * @param msg      texte du toast
 * @param isErr    true = style erreur, role="alert"/assertive, persistant par défaut
 * @param opts     { action: { label, onClick } | null, duree: <ms> | 0 (jamais) }
 */
export function toast(msg, isErr = false, opts = {}) {
  const box = $('#toasts');
  if (!box) return;
  const duree = opts.duree ?? (isErr ? 0 : DUREE_SUCCES);
  const action = opts.action ?? null;

  // Doublon d'un toast déjà affiché → incrémente son compteur et relance le minuteur.
  const existant = [...box.children].find(t => t.dataset.msg === msg && t.dataset.err === String(isErr));
  if (existant) {
    const n = Number(existant.dataset.n || '1') + 1;
    existant.dataset.n = String(n);
    let pastille = existant.querySelector('.toast-n');
    if (!pastille) {
      pastille = document.createElement('span');
      pastille.className = 'toast-n';
      existant.prepend(pastille);
    }
    pastille.textContent = '×' + n;
    relancerMinuteur(existant, duree);
    return;
  }

  while (box.children.length >= MAX_TOASTS) box.firstElementChild.remove();

  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.dataset.msg = msg;
  t.dataset.err = String(isErr);
  t.dataset.n = '1';
  t.setAttribute('role', isErr ? 'alert' : 'status');
  t.setAttribute('aria-live', isErr ? 'assertive' : 'polite');

  const texte = document.createElement('span');
  texte.className = 'toast-msg';
  texte.textContent = msg;
  t.append(texte);

  if (action) {
    const btnAction = document.createElement('button');
    btnAction.className = 'toast-action';
    btnAction.type = 'button';
    btnAction.textContent = action.label;
    btnAction.addEventListener('click', () => { action.onClick?.(); t.remove(); });
    t.append(btnAction);
  }

  const fermer = document.createElement('button');
  fermer.className = 'toast-close';
  fermer.type = 'button';
  fermer.setAttribute('aria-label', 'Fermer');
  fermer.textContent = '✕';
  fermer.addEventListener('click', () => t.remove());
  t.append(fermer);

  box.append(t);
  relancerMinuteur(t, duree);
}

function relancerMinuteur(t, duree) {
  if (t._minuteur) clearTimeout(t._minuteur);
  if (duree > 0) t._minuteur = setTimeout(() => t.remove(), duree);
}

/**
 * Exécute une écriture Supabase et EN REND COMPTE, toujours (règle Yann 2026-08-28).
 * @param requete  thenable supabase-js ({ data, error }) OU fonction () => thenable
 *                 (une fonction est requise pour que « Réessayer » puisse rejouer :
 *                 un query-builder supabase-js n'est consommable qu'une seule fois)
 * @param label    ce qui est enregistré, du point de vue de l'utilisateur (« Rotation »,
 *                 « Prix bas », « Couleur de la maison ») — sert aux DEUX messages
 * @param opts.silencieuxSiOk  true = pas de toast de succès (réservé aux gestes implicites)
 * @returns true si l'écriture a réussi, false sinon — l'appelant s'arrête sur false
 */
export async function enregistrer(requete, label, { silencieuxSiOk = false } = {}) {
  let error;
  try {
    ({ error } = await (typeof requete === 'function' ? requete() : requete));
  } catch (err) {
    error = err;
  }
  if (error) {
    console.warn('enregistrer:', label, error);
    const rejouable = typeof requete === 'function';
    toast(`« ${label} » non enregistré — ${error.message ?? error}`, true, rejouable ? {
      action: { label: 'Réessayer', onClick: () => enregistrer(requete, label, { silencieuxSiOk }) },
    } : {});
    return false;
  }
  if (!silencieuxSiOk) toast('✓ ' + label + ' enregistré');
  return true;
}

/**
 * Rend une opération longue VISIBLE et ANNULABLE (L-027).
 * Affiche un overlay bloquant immédiatement, le retire dans un finally
 * (aucun chemin de sortie ne laisse l'écran figé).
 * @param fn    async ({ signal, majMessage, estAnnule }) => T
 * @param opts.titre      message principal (« Envoi des photos… »)
 * @param opts.annulable  défaut true — affiche le bouton « Annuler »
 * @param opts.seuilLent  ms avant le sous-message de patience — défaut 15000
 * @returns { valeur, annule }  valeur = ce que rend fn (undefined si annulé)
 */
export async function withBusy(fn, { titre, annulable = true, seuilLent = 15000 } = {}) {
  const focusAvant = document.activeElement;
  const ctrl = new AbortController();
  let annule = false;

  const el = document.createElement('div');
  el.className = 'busy-overlay';
  el.innerHTML = `<div class="busy-card" role="alertdialog" aria-live="polite">
    <div class="busy-spin" aria-hidden="true"></div>
    <div class="busy-msg">${titre}</div>
    <div class="busy-sub hidden"></div>
    ${annulable ? '<button class="btn small" type="button" data-annuler>Annuler</button>' : ''}
  </div>`;
  document.body.append(el);

  const btnAnnuler = el.querySelector('[data-annuler]');
  btnAnnuler?.addEventListener('click', () => {
    annule = true;
    ctrl.abort();
    demonter();
  });
  btnAnnuler?.focus();

  const minuteurLent = setTimeout(() => {
    const sub = el.querySelector('.busy-sub');
    if (sub) {
      sub.textContent = 'Ça prend plus de temps que prévu — tu peux annuler, l\'opération en cours peut aboutir en tâche de fond.';
      sub.classList.remove('hidden');
    }
  }, seuilLent);

  let demontee = false;
  function demonter() {
    if (demontee) return;
    demontee = true;
    clearTimeout(minuteurLent);
    el.remove();
    if (focusAvant instanceof HTMLElement) focusAvant.focus();
  }

  const ctx = {
    signal: ctrl.signal,
    majMessage(txt) { const msg = el.querySelector('.busy-msg'); if (msg) msg.textContent = txt; },
    estAnnule: () => annule,
  };

  if (annule) return { valeur: undefined, annule: true };

  try {
    const valeur = await fn(ctx);
    return { valeur: annule ? undefined : valeur, annule };
  } finally {
    demonter();
  }
}
