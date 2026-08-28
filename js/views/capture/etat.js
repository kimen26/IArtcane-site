// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/capture/etat.js : helpers d'état autour de S.capFiles
// (sélection courante, vues conseillées dérivées, réordonnancement).
// HO-054 · territoire views/capture/ — ne pas importer une autre vue.
// ═══════════════════════════════════════════════════════════════════════════
import { S } from '../../core/state.js';

// ─── Kinds radio (9 hors video) ─────────────────────────────────────────────

export const KINDS = [
  { key: 'face', label: 'face' },
  { key: 'profil', label: 'profil' },
  { key: 'revers', label: 'revers' },
  { key: 'signature', label: 'signature' },
  { key: 'poincon', label: 'marque / poinçon' },
  { key: 'detail', label: 'détail décor' },
  { key: 'defaut', label: 'défaut' },
  { key: 'echelle', label: 'échelle' },
  { key: 'autre', label: 'autre' },
];

export function kindLabel(key) {
  return KINDS.find(k => k.key === key)?.label || (key === 'video' ? 'vidéo' : '');
}

// ─── Sélection courante dans S.capFiles ─────────────────────────────────────

let currentIndex = 0;

export function getCurrentIndex() { return currentIndex; }
export function setCurrentIndex(i) {
  currentIndex = Math.max(0, Math.min(i, S.capFiles.length - 1));
}
export function ensureCurrentIndex() {
  if (!S.capFiles[currentIndex]) currentIndex = 0;
}

// ─── Vues conseillées dérivées des kinds tagués ─────────────────────────────

export const SUGGESTED_VIEWS = [
  { key: 'face', label: 'Face', hint: 'la vue qui servira de couverture', kind: 'face' },
  { key: 'detail', label: 'Gros plan', hint: 'décor, matière, défauts', kinds: ['detail', 'defaut'] },
  { key: 'signature', label: 'Signature / revers', hint: 'c\'est elle qui donne l\'auteur', kinds: ['signature', 'revers', 'poincon'] },
];

export function suggestedViews() {
  return SUGGESTED_VIEWS.map(v => ({
    ...v,
    done: hasSuggestedKind(v),
  }));
}

function hasSuggestedKind(v) {
  if (v.kind) return S.capFiles.some(item => item.kind === v.kind);
  return S.capFiles.some(item => v.kinds.includes(item.kind));
}

export function countDoneViews() {
  return suggestedViews().filter(v => v.done).length;
}

// ─── Couverture (une seule) ─────────────────────────────────────────────────

export function setCover(idx) {
  S.capFiles.forEach((item, i) => { item.cover = (i === idx); });
}

// ─── Réordonnancement local de S.capFiles ───────────────────────────────────

export function reorderCapFiles(fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
  const arr = S.capFiles;
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
  // Recalcule l'ordre (1-based)
  arr.forEach((item, i) => { item.ordre = i + 1; });
  // Recalibrer la sélection
  if (currentIndex === fromIdx) currentIndex = toIdx;
  else if (fromIdx < currentIndex && currentIndex <= toIdx) currentIndex--;
  else if (toIdx <= currentIndex && currentIndex < fromIdx) currentIndex++;
}
