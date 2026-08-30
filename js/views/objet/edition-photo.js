// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/objet/edition-photo.js : atelier « Modifier la photo »
// (HO-095, devenu une PAGE ROUTÉE en HO-099). Édition DESTRUCTIVE : recadrer
// et/ou pivoter, puis enregistrer écrase la brute (`storage_path`) et régénère
// les 3 dérivées. Renverse HO-091 (qui gardait la brute intacte via `crop_path`)
// — arbitrage Yann 2026-08-29 : « si la photo doit être tournée on la tourne,
// si elle doit être cropée on la crope » ; la « brute jamais perdue » porte sur
// la qualité des pixels conservés, pas sur la géométrie.
//
// HO-099 : ce n'est plus un overlay `createOverlay` (lightbox.js reste gelé —
// il sert encore la visionneuse et la fiche artiste) mais une vraie route,
// `mount(objetId, photoId)`, rendue dans `#objet-body` comme les autres
// sous-écrans de la fiche. Un « geste » (agrandir une image) reste un overlay ;
// un « état de travail à ne pas perdre » (cette édition destructive) est une
// page : URL propre, historique, bouton Retour d'Android qui referme l'atelier.
// HO-105 : le remplacement destructif (écrase storage_path, régénère les 3
// dérivées depuis la nouvelle brute, jamais en cascade — D-073/D-075) est
// déplacé tel quel dans services/photos.js::remplacer().
// ═══════════════════════════════════════════════════════════════════════════
import { $, toast } from '../../core/dom.js';
import { loadViewCss } from '../../core/css.js';
import { withBusy, humaniser } from '../../core/feedback.js';
import { S } from '../../core/state.js';
import { sb, logEvent, signPaths } from '../../core/data.js';
import { remplacer, cibleObjet } from '../../services/photos.js';
import { page } from '../../ui/page.js';
import { catCanon } from '../../core/format.js';

await loadViewCss('objet-photos');

// Point d'entrée de la route `#/objet/<id>/photo/<photoId>/modifier` (app.js).
// Arrivée directe par URL possible (rechargement de page) : ne dépend d'aucun
// état déjà chargé par views/objet/index.js, tout est relu depuis la base.
export async function mount(objetId, photoId) {
  const body = $('#objet-body');
  body.innerHTML = '<div class="skeleton" style="height:320px"></div>';

  const { data: photo, error } = await sb.from('photos').select('*')
    .eq('owner_id', S.tenantId).eq('objet_id', objetId).eq('id', photoId).maybeSingle();
  if (error || !photo) {
    toast('Photo introuvable', true);
    location.hash = `#/objet/${encodeURIComponent(objetId)}`;
    return;
  }
  // Pose l'objet courant si absent (arrivée directe) — logEvent/caméra en dépendent
  // ailleurs dans la fiche ; ce chantier passe de toute façon `objetId` explicitement.
  if (!S.currentObjet || String(S.currentObjet.id) !== String(objetId)) {
    const { data: o } = await sb.from('objets').select('*').eq('owner_id', S.tenantId).eq('id', objetId).maybeSingle();
    if (o) S.currentObjet = o;
  }

  // Fil d'Ariane (HO-104) : cet écran arrive par une VRAIE navigation de hash
  // (contrairement aux sous-écrans internes de la fiche) — le segment #<id>
  // peut donc porter un hash réel vers le hub, et la catégorie (inconnue de
  // filDe('objet', …) au moment du routage) est complétée ici.
  if (S.currentObjet?.categorie) {
    const cat = catCanon(S.currentObjet.categorie);
    S.fil[1] = { label: cat, hash: `#/rayon/${encodeURIComponent(cat)}` };
  }
  S.fil[2] = { label: `#${objetId}`, hash: `#/objet/${encodeURIComponent(objetId)}` };

  const retour = () => { location.hash = `#/objet/${encodeURIComponent(objetId)}`; };

  const bruteUrl = (await signPaths([photo.storage_path]))[photo.storage_path];
  if (!bruteUrl) { toast('Impossible de charger la brute pour l’édition', true); retour(); return; }
  const bmp = await createImageBitmap(await (await fetch(bruteUrl)).blob());

  let rotLocale = photo.rotation || 0;
  let straight, dw, dh;

  const redresser = () => {
    const swap = rotLocale === 90 || rotLocale === 270;
    dw = swap ? bmp.height : bmp.width; dh = swap ? bmp.width : bmp.height;
    if (!straight) {
      straight = document.createElement('canvas');
      straight.className = 'cut-canvas';
    }
    straight.width = dw; straight.height = dh;
    const sctx = straight.getContext('2d');
    sctx.translate(dw / 2, dh / 2); sctx.rotate(rotLocale * Math.PI / 180);
    sctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  };
  redresser();

  const corps = page(body, {
    titre: 'Modifier la photo',
    fil: [...S.fil, { label: 'Modifier la photo' }],
    barre: {
      actions: [
        { label: '↻ 90°', type: 'plat', onClick: onRotClick },
        { label: 'Enregistrer', type: 'primaire', plein: true, onClick: onSaveClick },
        { label: 'Annuler', type: 'plat', onClick: retour },
      ],
    },
  });
  corps.innerHTML = `
    <div class="obj-screen-body">
      <div class="obj-edit-hint">Recadre avec les poignées, ou pivote — puis enregistre</div>
      <div class="obj-edit-canvas"></div>
    </div>`;
  corps.querySelector('.obj-edit-canvas').append(straight);

  const img = straight;
  // barreBasse() rend les actions dans l'ordre : 0 = rotation, 1 = enregistrer, 2 = annuler.
  const ok = body.querySelector('[data-ui-action="1"]');
  ok.disabled = true; // rien à enregistrer tant qu'aucune modif (recadrage/rotation)
  let sel = { x0: 0, y0: 0, x1: 1, y1: 1 };
  let box = null;
  let drag = null;
  const MIN = 0.05;
  const canvasZone = corps.querySelector('.obj-edit-canvas');
  const toRel = e => {
    const r = img.getBoundingClientRect();
    return { x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1) };
  };
  const H = {
    nw: (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN), y0: Math.min(p.y, s.y1 - MIN) }),
    n:  (s, p) => ({ ...s, y0: Math.min(p.y, s.y1 - MIN) }),
    ne: (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN), y0: Math.min(p.y, s.y1 - MIN) }),
    e:  (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN) }),
    se: (s, p) => ({ ...s, x1: Math.max(p.x, s.x0 + MIN), y1: Math.max(p.y, s.y0 + MIN) }),
    s:  (s, p) => ({ ...s, y1: Math.max(p.y, s.y0 + MIN) }),
    sw: (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN), y1: Math.max(p.y, s.y0 + MIN) }),
    w:  (s, p) => ({ ...s, x0: Math.min(p.x, s.x1 - MIN) }),
  };
  const draw = () => {
    if (!box) {
      box = document.createElement('div');
      box.className = 'cut-sel';
      box.innerHTML = Object.keys(H).map(h => `<i data-h="${h}" class="h-${h}"></i>`).join('');
      canvasZone.append(box);
    }
    const r = img.getBoundingClientRect();
    box.style.left = `${r.left + sel.x0 * r.width}px`;
    box.style.top = `${r.top + sel.y0 * r.height}px`;
    box.style.width = `${(sel.x1 - sel.x0) * r.width}px`;
    box.style.height = `${(sel.y1 - sel.y0) * r.height}px`;
  };
  draw();
  canvasZone.addEventListener('pointerdown', e => {
    const h = e.target.dataset?.h;
    if (!h) return;
    e.preventDefault(); e.stopPropagation();
    drag = h;
  });
  canvasZone.addEventListener('pointermove', e => {
    if (!drag) return;
    sel = H[drag](sel, toRel(e));
    draw();
    ok.disabled = false;
  });
  canvasZone.addEventListener('pointerup', () => { drag = null; });

  function onRotClick() {
    rotLocale = (rotLocale + 90) % 360;
    redresser();
    sel = { x0: 0, y0: 0, x1: 1, y1: 1 };
    draw();
    ok.disabled = false;
  }

  async function onSaveClick() {
    if (!confirm("Enregistrer les modifications ?\n\nLa photo d'origine sera remplacée définitivement — cette action est irréversible.")) return;
    ok.disabled = true; ok.textContent = 'Enregistrement…';
    try {
      await withBusy(async () => {
        // straight est déjà la brute redressée (même repère que sel) — pas de refetch.
        const sx = Math.round(sel.x0 * dw), sy = Math.round(sel.y0 * dh);
        const sw = Math.round((sel.x1 - sel.x0) * dw), sh = Math.round((sel.y1 - sel.y0) * dh);
        if (sw < 20 || sh < 20) throw new Error('zone trop petite');
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        c.getContext('2d').drawImage(straight, sx, sy, sw, sh, 0, 0, sw, sh);
        // Qualité 0.95 (brute d'origine en q=0.85, camera.js) : la brute est
        // écrasée, tout ré-encodage est une génération de perte supplémentaire.
        const out = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.95));
        if (!out) throw new Error('encodage impossible');
        // HO-095 — renverse HO-091 : l'édition est destructive, `storage_path` est
        // réécrit, `crop_path` repasse à NULL et `rotation` à 0 (services/photos.js).
        const r = await remplacer(cibleObjet(objetId), photo, out);
        if (!r.ok) throw new Error(r.error);
        toast('✓ Photo modifiée — l’image d’origine a été remplacée');
        logEvent('photo_modifiee', { photo: photo.storage_path, rotation: rotLocale }, objetId);
        retour();
      }, { titre: 'Enregistrement — la photo d’origine est remplacée définitivement…' });
    } catch (err) {
      console.warn('edition-photo:', err); toast(`Enregistrement échoué — ${humaniser(err)}. Réessaie.`, 'action');
      ok.disabled = false; ok.textContent = 'Enregistrer';
    }
  }
}
