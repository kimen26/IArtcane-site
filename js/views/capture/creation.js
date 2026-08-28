// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/capture/creation.js : enregistrement / création de la
// fiche depuis l'écran de capture (HO-079, extrait de index.js — plafond
// 651 lignes atteint, D-041). Overlay bloquant + annulation (core/feedback.js,
// HO-075) sur la création, JAMAIS sur lancerR1EnFond (arbitrage F-capture,
// la R1 dure 1-3 min et la fiche doit s'ouvrir tout de suite).
// ═══════════════════════════════════════════════════════════════════════════
import { $, toast } from '../../core/dom.js';
import { withBusy } from '../../core/feedback.js';
import { S, canWrite } from '../../core/state.js';
import { sb, logEvent, lancerRecherches, enqueueJobs, uploadPhotosFor } from '../../core/data.js';

let pendingObjetId = null;
let renderer = null; // injecté par index.js (évite un import circulaire)

/** Branche le render() de l'écran — appelé une fois par index.js au mount. */
export function setRenderer(fn) { renderer = fn; }

// ─── Création de la fiche ───────────────────────────────────────────────────

export async function creerFiche() {
  if (!canWrite()) return;
  const categorie = $('#cap-categorie')?.value || '';
  const zone = $('#cap-zone')?.value.trim() || null;
  const contenant = $('#cap-contenant')?.value.trim() || null;
  const commentaire = $('#cap-commentaire')?.value.trim() || null;

  if (!categorie) {
    toast('Choisis d\'abord la catégorie', true);
    $('#cap-categorie')?.focus();
    return;
  }

  const btn = $('#cap-save');
  btn.disabled = true;
  btn.textContent = 'Création…';
  const qui = localStorage.getItem('iartcane-qui') ?? 'alain';

  try {
    await withBusy(async ({ majMessage, estAnnule }) => {
      if (pendingObjetId) {
        if (!S.capFiles.length) {
          toast('Aucune photo en attente à renvoyer', true);
          return;
        }
        // Retry d'upload sur un objet déjà créé
        await envoyerPhotos(pendingObjetId, true, majMessage, estAnnule);
        return;
      }

      majMessage('Création de la fiche…');
      const { data: newId, error: e0 } = await sb.rpc('next_objet_id', { p_owner: S.tenantId });
      if (e0 || !newId) throw (e0 ?? new Error('numérotation impossible'));

      const { error: e1 } = await sb.from('objets').insert({
        owner_id: S.tenantId,
        id: newId,
        statut: 'nouveau',
        categorie,
        zone,
        contenant,
        commentaire,
        source_capture: 'site',
        verrous_humains: ['categorie'],
        validation_champs: { categorie: { par: qui, at: new Date().toISOString() } },
      });
      if (e1) throw e1;

      logEvent('capture', { n: S.capFiles.length, zone, categorie }, newId);

      if (S.capFiles.length) {
        majMessage(`Fiche #${newId} créée — envoi des photos…`);
        await envoyerPhotos(newId, false, majMessage, estAnnule);
        // si des échecs restent, pendingObjetId a été positionné dans envoyerPhotos
        if (pendingObjetId) return;
      }

      finaliserCreation(newId);
    }, { titre: 'Création de la fiche…', annulable: true });
  } catch (err) {
    toast(err.message ?? String(err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Créer la fiche';
  }
}

// R1 en tâche de fond (F-capture, 2026-08-28) : on ne bloque PLUS la navigation
// sur les 2 appels Kimi vision (1-3 min mesurées). La fiche s'ouvre tout de
// suite, la recherche continue derrière et se signale par un toast. Si elle
// échoue ou dépasse le plafond (A9), on bascule sur un job `r1` que le cron
// reprendra — l'utilisateur n'attend jamais devant un écran figé (L-027).
// ⚠️ Ne JAMAIS envelopper dans withBusy — non bloquante par construction.
function lancerR1EnFond(oid) {
  lancerRecherches(oid)
    .then(async r => {
      if (r.ok) {
        if (!r.skip) toast(`Objet #${oid} — recherche R1 terminée, recharge pour voir.`);
        return;
      }
      await enqueueJobs([oid], 'r1');
      toast(`Recherche de #${oid} remise en file — le cron la reprend sous ~2 min.`);
    })
    .catch(async () => {
      await enqueueJobs([oid], 'r1');
      toast(`Recherche de #${oid} remise en file — le cron la reprend sous ~2 min.`);
    });
}

async function envoyerPhotos(oid, isRetry, majMessage, estAnnule) {
  const total = S.capFiles.length;
  const enAttente = [...S.capFiles]; // copie, dans l'ordre passé à uploadPhotosFor
  let arretee = false;
  const onProgress = (sent, tot) => {
    if (estAnnule?.()) { arretee = true; return false; } // stoppe la boucle d'upload
    majMessage(`Envoi des photos — ${sent}/${tot} terminée(s)`);
  };
  const { done, failed } = await uploadPhotosFor(oid, S.capFiles, true, onProgress);

  if (arretee) {
    // Annulation en cours d'upload : le contrat de reprise (L-022) s'applique
    // à l'identique — la fiche reste créée, TOUTES les photos non encore
    // confirmées en base (échecs + jamais tentées) restent en main pour
    // renvoi. Jamais de suppression de la fiche à l'annulation.
    const echouees = new Set(failed.map(({ item }) => item));
    const nonTentees = enAttente.slice(done + failed.length);
    S.capFiles = enAttente.filter(item => echouees.has(item) || nonTentees.includes(item));
    pendingObjetId = oid;
    renderer?.();
    if (done > 0) lancerR1EnFond(oid);
    toast(`Fiche #${oid} créée — ${done}/${total} photos envoyées, les autres restent ici à renvoyer.`, true);
    return;
  }

  if (failed.length > 0) {
    pendingObjetId = oid;
    S.capFiles = failed.map(({ item }) => item);
    renderer?.();
    if (done > 0) lancerR1EnFond(oid);
    toast(`Objet #${oid} créé — ${done}/${total} photos envoyées. ${failed.length} en échec : renvoyez-les depuis cet écran.`, true);
    return;
  }

  if (done > 0) lancerR1EnFond(oid);

  if (!isRetry) finaliserCreation(oid);
}

function finaliserCreation(oid) {
  S.capFiles = [];
  pendingObjetId = null;
  renderer?.();
  toast(`Objet #${oid} créé — recherches en cours en arrière-plan (R1 · R2 suit)`);
  S.refreshHeader?.();
  location.hash = '#/objet/' + encodeURIComponent(oid);
}
