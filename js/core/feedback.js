// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/feedback.js : socle de retour utilisateur (HO-075, D-068)
// Trois primitives : toast (confirmation légère), enregistrer (écriture
// Supabase qui rend TOUJOURS compte, règle Yann 2026-08-28), withBusy
// (opération longue visible et annulable, L-027). Ne dépend PAS de dom.js
// (dom.js re-exporte toast depuis ici, pas l'inverse — pas de cycle).
//
// HO-110 : toast() prend un NIVEAU (info/action/panne, ex-booléen isErr) et
// humaniser(err) traduit toute erreur technique en une phrase pour Alain —
// aucun message brut (TypeError, HTTP 4xx, nom de classe JS) n'atteint
// l'écran. Le détail brut, lui, reste en console (console.warn) au point
// d'appel : jamais perdu, jamais affiché.
// ═══════════════════════════════════════════════════════════════════════════

const $ = sel => document.querySelector(sel);
const MAX_TOASTS = 3;
const DUREE_SUCCES = 7000;

/**
 * Affiche un toast en haut d'écran. Les messages identiques déjà visibles
 * sont regroupés (« ×2 ») plutôt que dupliqués (L-022 : une rafale de toasts
 * identiques passe inaperçue) — le regroupement se fait sur le COUPLE
 * (message, niveau) : deux messages identiques de niveaux différents restent
 * deux toasts. Au-delà de MAX_TOASTS visibles, le plus ancien sort.
 * @typedef {'info'|'action'|'panne'} Niveau
 * @param msg      texte du toast
 * @param niveau   'info' (neutre, auto-fermeture 7 s, role="status" — le
 *                 système a géré) · 'action' (fond ambre, persistant,
 *                 role="status" — un geste reste à faire, le message le dit)
 *                 · 'panne' (fond rouge, persistant, role="alert"/assertive —
 *                 rien ne rattrape). Défaut 'info'.
 * @param opts     { action: { label, onClick } | null, duree: <ms> | 0 (jamais) }
 */
export function toast(msg, niveau = 'info', opts = {}) {
  const box = $('#toasts');
  if (!box) return;
  // Compat : `toast(msg, true)` / `toast(msg, false)` — encore appelés 94
  // fois hors périmètre HO-110 (18 fichiers non migrés). Acceptés en entrée,
  // convertis en interne, mais jamais documentés comme forme valide ci-dessus :
  // à supprimer quand ces appels seront migrés aux 3 niveaux nommés.
  if (niveau === true) niveau = 'panne';
  else if (niveau === false || niveau == null) niveau = 'info';

  const persistant = niveau !== 'info';
  const duree = opts.duree ?? (persistant ? 0 : DUREE_SUCCES);
  const action = opts.action ?? null;
  const role = niveau === 'panne' ? 'alert' : 'status';
  const ariaLive = niveau === 'panne' ? 'assertive' : 'polite';

  // Doublon d'un toast déjà affiché (même message ET même niveau) →
  // incrémente son compteur et relance le minuteur.
  const existant = [...box.children].find(t => t.dataset.msg === msg && t.dataset.niveau === niveau);
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
  t.className = 'toast' + (niveau !== 'info' ? ' ' + niveau : '');
  t.dataset.msg = msg;
  t.dataset.niveau = niveau;
  t.dataset.n = '1';
  t.setAttribute('role', role);
  t.setAttribute('aria-live', ariaLive);

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

// Motifs testés du plus spécifique au plus général (HO-110) : « HTTP 413 »
// doit rendre « fichier trop lourd », pas « service d'IA occupé » — d'où le
// motif 413 placé AVANT le motif générique « http 4 ». Comparaison sur texte
// déjà passé en minuscules (pas besoin du flag /i sur chaque motif).
const REGLES_HUMANISER = [
  { motifs: [/failed to fetch/, /networkerror/, /err_internet/], phrase: 'connexion perdue' },
  { motifs: [/aborterror/, /aborted/], phrase: 'opération interrompue' },
  { motifs: [/payload too large/, /\b413\b/], phrase: 'fichier trop lourd' },
  { motifs: [/kimi http 4/, /http 401/, /http 403/, /http 429/], phrase: "service d'IA occupé" },
  { motifs: [/http 5\d\d/, /\b502\b/, /\b503\b/, /\b504\b/], phrase: 'service momentanément indisponible' },
  { motifs: [/jwt/, /session/, /token/], phrase: 'session expirée' },
  { motifs: [/duplicate key/, /23505/], phrase: 'déjà enregistré' },
];

/**
 * Traduit une erreur technique en UNE phrase pour Alain (HO-110) — jamais de
 * code, de nom de classe JS (`TypeError`, `AbortError`…) ni de statut HTTP
 * brut à l'écran. Ne jette JAMAIS : toute entrée dégénérée (null, objet vide,
 * nombre) rend la phrase par défaut. Le détail brut reste la responsabilité
 * de l'APPELANT (`console.warn` au point d'appel) — humaniser() ne journalise
 * rien lui-même.
 * @param err  une Error, une chaîne, ou n'importe quoi — comparaison
 *             insensible à la casse sur `err.message ?? String(err)`
 * @returns {string} une phrase, jamais de code technique
 */
export function humaniser(err) {
  let texte;
  try {
    texte = String(err?.message ?? err ?? '').toLowerCase();
  } catch {
    texte = '';
  }
  for (const { motifs, phrase } of REGLES_HUMANISER) {
    if (motifs.some(re => re.test(texte))) return phrase;
  }
  return 'problème technique';
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
export async function enregistrer(requete, label, { silencieuxSiOk = false, attendLignes = false } = {}) {
  let error, data;
  try {
    ({ error, data } = await (typeof requete === 'function' ? requete() : requete));
  } catch (err) {
    error = err;
  }
  // Un DELETE/UPDATE que la RLS bloque rend `error: null` et 0 ligne : sans ce
  // garde, on annonce « enregistré » alors que la base n'a pas bougé (panne muette
  // constatée en prod — Yann, 2026-08-28). L'appelant qui ajoute `.select()` à sa
  // requête peut demander la vérification par `attendLignes: true`.
  if (!error && attendLignes && !data?.length) {
    error = new Error('aucune ligne modifiée — droits insuffisants ou élément déjà supprimé');
  }
  if (error) {
    console.warn('enregistrer:', label, error);
    const rejouable = typeof requete === 'function';
    toast(`« ${label} » non enregistré — ${humaniser(error)}.`, 'panne', rejouable ? {
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

  // DOM construit noeud par noeud, jamais par innerHTML : `titre` vient des appelants
  // et portera des donnees (titre d'objet, nom d'artiste, nom de fichier) des que les
  // vues consommeront withBusy — une interpolation ici serait une injection HTML.
  const el = document.createElement('div');
  el.className = 'busy-overlay';
  const carte = document.createElement('div');
  carte.className = 'busy-card';
  carte.setAttribute('role', 'alertdialog');
  carte.setAttribute('aria-live', 'polite');

  const spin = document.createElement('div');
  spin.className = 'busy-spin';
  spin.setAttribute('aria-hidden', 'true');

  const msg = document.createElement('div');
  msg.className = 'busy-msg';
  msg.textContent = titre ?? '';

  const sub = document.createElement('div');
  sub.className = 'busy-sub hidden';

  carte.append(spin, msg, sub);
  if (annulable) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.type = 'button';
    b.setAttribute('data-annuler', '');
    b.textContent = 'Annuler';
    carte.append(b);
  }
  el.append(carte);
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
