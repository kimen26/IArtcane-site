// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — ui/mic.js : brique ui/ pure, HO-111. Bouton de dictée (Web
// Speech API) pour zones de commentaire libre. Réutilisable — fiche artiste
// (HO-021) et toute zone de commentaire libre.
// ═══════════════════════════════════════════════════════════════════════════
import { loadViewCss } from '../core/css.js';
await loadViewCss('mic', 'ui');

/**
 * Crée et retourne un bouton 🎙 associé à une <textarea>.
 * Retourne `null` si la Web Speech API n'est pas disponible.
 * @param {HTMLTextAreaElement} textarea
 * @returns {HTMLButtonElement|null}
 */
export function micButton(textarea) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-mic';
  btn.setAttribute('aria-label', 'Dicter le commentaire');
  btn.title = 'Dicter le commentaire';
  btn.textContent = '🎙';

  const rec = new SpeechRecognition();
  rec.lang = 'fr-FR';
  rec.interimResults = true;
  rec.continuous = true;

  let baseText = '';
  let finalText = '';

  function appendTranscript(interim) {
    const existing = baseText;
    const needsSpace = existing && !existing.endsWith(' ') && (finalText || interim);
    const value = existing + (needsSpace ? ' ' : '') + finalText + interim;
    if (textarea.value !== value) {
      textarea.value = value;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  btn.addEventListener('click', () => {
    if (btn.classList.contains('ui-mic--recording')) {
      rec.stop();
    } else {
      rec.start();
    }
  });

  rec.addEventListener('start', () => {
    baseText = textarea.value;
    finalText = '';
    btn.classList.add('ui-mic--recording');
    btn.title = 'Arrêter la dictée';
  });

  rec.addEventListener('end', () => {
    btn.classList.remove('ui-mic--recording');
    btn.title = 'Dicter le commentaire';
  });

  rec.addEventListener('result', (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += transcript;
      } else {
        interim += transcript;
      }
    }
    appendTranscript(interim);
  });

  rec.addEventListener('error', (event) => {
    if (event.error === 'not-allowed') {
      btn.disabled = true;
      btn.classList.remove('ui-mic--recording');
      btn.title = 'Microphone non autorisé — activez le micro dans les permissions du navigateur';
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn('Speech recognition error:', event.error);
    }
    btn.classList.remove('ui-mic--recording');
  });

  return btn;
}
