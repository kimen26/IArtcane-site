// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/maison/identite.js : M1 — Identité & ruban.
//
// Hero navy (initiale, nom, sous-ligne dérivée) · renommage (tenants.name) ·
// couleur du ruban : roue 36 teintes + 5 neutres + saisie hexadécimale, texte
// du ruban CALCULÉ par luminance, aperçu en direct sur une vignette carte objet.
// Choix immédiat et global : update tenants.couleur + propagation --ruban.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast } from '../../core/dom.js';
import { enregistrer } from '../../core/feedback.js';
import { S, canWrite } from '../../core/state.js';
import { sb } from '../../core/data.js';
import { champs } from '../../ui/champs.js';
import {
  M, hooks, RUBAN_DEFAUT, roueTeintes, NEUTRES, rubanTexte, hex2rgb,
} from './etat.js';

/** Couleur de ruban effective (choix maison ou défaut). */
const rubanCourant = () => M.tenant?.couleur || RUBAN_DEFAUT;

export function rendre(zone) {
  const t = M.tenant;
  const initiale = (t.name.trim().charAt(0) || '·').toUpperCase();
  const lecture = !canWrite();

  zone.innerHTML = `
    <div class="ms-card ms-hero-card">
      <div class="ms-hero">
        <div class="ms-hero-ring ms-hero-ring-a"></div>
        <div class="ms-hero-ring ms-hero-ring-b"></div>
        <div class="ms-hero-row">
          <div class="ms-hero-disc">${esc(initiale)}</div>
          <div class="ms-hero-txt">
            <div class="ms-hero-name">${esc(t.name || 'Maison')}</div>
            <div class="ms-hero-sub">Maison · ${M.nObjets} objet${M.nObjets > 1 ? 's' : ''} · ${M.nArtistes} artiste${M.nArtistes > 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>
      <div class="ms-hero-body">
        <div class="ms-sec-title"><span>Nom de la maison</span><span class="ms-rule"></span></div>
        <p class="ms-note">Affiché dans l'en-tête et dans le switcher du menu.</p>
        <div class="ms-field-row">
          <div class="ms-field-row-champ" id="ms-nom-champ"></div>
          <button class="ms-btn ms-btn-primary" id="ms-rename" ${lecture ? 'disabled' : ''}>Renommer</button>
        </div>
      </div>
    </div>

    <div class="ms-card">
      <div class="ms-sec-title"><span>Couleur du ruban d'estimation</span><span class="ms-rule"></span></div>
      <p class="ms-note">Une seule couleur pour toute la maison. Le texte du bandeau passe en blanc ou en noir selon la teinte choisie.</p>

      <div class="ms-ruban-grid">
        <div class="ms-wheel" id="ms-wheel">${rendreRoue()}</div>
        <div class="ms-ruban-side">
          <div class="ms-mini-block">
            <div class="ms-mini-label">Neutres</div>
            <div class="ms-neutres" id="ms-neutres">${rendreNeutres()}</div>
          </div>
          <div class="ms-mini-block">
            <div class="ms-mini-label">Code hexadécimal</div>
            <input id="ms-hex" class="ms-hex" value="${esc(rubanCourant().toUpperCase())}" placeholder="#AAFF44" ${lecture ? 'disabled' : ''} autocomplete="off" spellcheck="false">
          </div>
          <div class="ms-ruban-etat" id="ms-ruban-etat">${rendreEtat()}</div>
        </div>
      </div>

      <div class="ms-ruban-apercu">
        <div class="ms-vignette" id="ms-vignette">${rendreVignette()}</div>
        <div class="ms-apercu-txt">
          <p class="ms-note">Aperçu en direct sur une carte. Une teinte très claire reste possible : le chiffre bascule alors en noir.</p>
          <button class="ms-btn ms-btn-ghost" id="ms-ruban-defaut" ${lecture ? 'disabled' : ''}>Revenir au défaut</button>
        </div>
      </div>
    </div>`;

  // Champ « Nom » via ui/champs.js (HO-107) : pas de sur.changer — cette
  // fiche persiste sur clic explicite du bouton Renommer (comportement
  // inchangé), pas à la saisie ; champs() ne fait ici que la mise en page.
  champs($('#ms-nom-champ'), {
    liste: [{ cle: 'nom', valeur: t.name, editable: !lecture, type: 'texte', placeholder: 'PONAIRE…', autocomplete: 'off' }],
  });

  if (lecture) return;
  brancher(zone);
}

// ─── Rendu des morceaux qui bougent ────────────────────────────────────────

function rendreRoue() {
  const courant = rubanCourant().toLowerCase();
  const pastilles = roueTeintes().map(w => {
    const sel = w.hex.toLowerCase() === courant;
    return `<button class="ms-wheel-dot ${sel ? 'is-sel' : ''}" data-hex="${w.hex}" title="${w.hex}"
      style="left:${w.x}px;top:${w.y}px;width:${w.d}px;height:${w.d}px;margin-left:${-w.d / 2}px;margin-top:${-w.d / 2}px;background:${w.hex}"></button>`;
  }).join('');
  const rt = rubanTexte(rubanCourant());
  return `${pastilles}
    <div class="ms-wheel-core" style="background:${rubanCourant()};color:${rt.texte}">
      ${esc(rubanCourant().toUpperCase().replace('#', ''))}
    </div>`;
}

function rendreNeutres() {
  const courant = rubanCourant().toLowerCase();
  return NEUTRES.map(hex => {
    const sel = hex.toLowerCase() === courant;
    return `<button class="ms-neutre ${sel ? 'is-sel' : ''}" data-hex="${hex}" style="background:${hex}" aria-label="${hex}"></button>`;
  }).join('');
}

function rendreEtat() {
  const rt = rubanTexte(rubanCourant());
  return `<span class="ms-etat-chip" style="background:${rubanCourant()}"></span>
    <span>Texte <b>${rt.texteNom}</b> · contraste ${esc(rt.contraste)}</span>`;
}

function rendreVignette() {
  const rt = rubanTexte(rubanCourant());
  return `
    <div class="ms-vig-veil"></div>
    <div class="ms-vig-id">N° 041</div>
    <div class="ms-vig-ruban" style="background:${rubanCourant()};color:${rt.texte}">4 200 €</div>`;
}

// Re-rend uniquement les zones dépendantes de la couleur (pas de rechargement).
function rafraichir() {
  const w = $('#ms-wheel'); if (w) w.innerHTML = rendreRoue();
  const n = $('#ms-neutres'); if (n) n.innerHTML = rendreNeutres();
  const e = $('#ms-ruban-etat'); if (e) e.innerHTML = rendreEtat();
  const v = $('#ms-vignette'); if (v) v.innerHTML = rendreVignette();
  brancherPastilles();
}

// ─── Persistance ───────────────────────────────────────────────────────────

// Choix immédiat et global : update tenants.couleur + propagation --ruban.
// null = retour au défaut (propriété CSS retirée → fallback #35696c).
async function enregistrerCouleur(couleur) {
  const ok = await enregistrer(() => sb.from('tenants').upsert({ owner_id: S.tenantId, couleur }), 'Couleur de la maison');
  if (!ok) return false;
  M.tenant.couleur = couleur;
  const mienne = S.mesTenants.find(x => x.id === S.tenantId);
  if (mienne) mienne.couleur = couleur;
  // Propagation visuelle globale : même mécanisme qu'app.js applyRuban().
  // NB : la COULEUR DU TEXTE du ruban n'est pas propagée globalement (components.css
  // fige color:#eef6f5 sur .card-ribbon) — cf. rapport d'exécution (écart).
  document.documentElement.style.setProperty('--ruban', couleur || '');
  return true;
}

const normHex = h => (h.startsWith('#') ? h : '#' + h);

// Choix confirmé (pastille, saisie hexa validée, bouton défaut) → persiste + re-rend.
async function choisir(hex) {
  const norm = normHex(hex.trim());
  if (!hex2rgb(norm)) return;
  if (await enregistrerCouleur(norm)) {
    const hexInput = $('#ms-hex'); if (hexInput) hexInput.value = norm.toUpperCase();
    rafraichir();
  }
}

// Aperçu instantané pendant la frappe hexa — SANS écrire en base (l'écriture se
// fait au `change`, quand la valeur est stabilisée). On ne touche que le fond du
// disque central et la variable --ruban ; le recalcul complet (texte, contraste,
// pastille sélectionnée) a lieu au `change` via choisir()→rafraichir().
function apercuLocal(hex) {
  const norm = normHex(hex.trim());
  if (!hex2rgb(norm)) return;
  document.documentElement.style.setProperty('--ruban', norm);
  const core = $('#ms-wheel')?.querySelector('.ms-wheel-core');
  if (core) core.style.background = norm;
}

// ─── Branchements ──────────────────────────────────────────────────────────

function brancherPastilles() {
  document.querySelectorAll('#ms-wheel .ms-wheel-dot, #ms-neutres .ms-neutre').forEach(b => {
    b.addEventListener('click', () => choisir(b.dataset.hex));
  });
}

function brancher(zone) {
  $('#ms-rename').addEventListener('click', async () => {
    const name = $('#ms-nom-champ .ui-champs-input').value.trim();
    if (!name) { toast('Nom vide', true); return; }
    const ok = await enregistrer(() => sb.from('tenants').upsert({ owner_id: S.tenantId, name }), 'Nom de la maison', { silencieuxSiOk: true });
    if (!ok) return;
    M.tenant.name = name;
    const mienne = S.mesTenants.find(x => x.id === S.tenantId);
    if (mienne) mienne.name = name;
    S.tenantName = name;
    S.refreshMenu?.();
    S.refreshHeader?.();
    toast(`✓ Maison renommée « ${name} »`);
    hooks.rendre?.();
  });

  brancherPastilles();

  const hex = $('#ms-hex');
  hex.addEventListener('input', () => apercuLocal(hex.value));
  hex.addEventListener('change', () => choisir(hex.value));

  $('#ms-ruban-defaut').addEventListener('click', async () => {
    if (await enregistrerCouleur(null)) {
      const hexInput = $('#ms-hex'); if (hexInput) hexInput.value = RUBAN_DEFAUT.toUpperCase();
      rafraichir();
    }
  });
}
