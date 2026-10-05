'use strict';
/* Audio: síntesis y reconocimiento de voz. */

/* ===================== 7. Audio ===================== */

const speech = { supported: 'speechSynthesis' in window, voice: null };
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const en = voices.filter(v => /^en[-_]/i.test(v.lang));
  speech.voice = en.find(v => /en[-_]US/i.test(v.lang) && /Google|Natural|Samantha|Aria|Jenny/i.test(v.name))
    || en.find(v => /en[-_]US/i.test(v.lang)) || en[0] || null;
}

function speak(text) {
  if (!speech.supported) { toast('Tu navegador no permite reproducir audio.'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (speech.voice) u.voice = speech.voice;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

// Escucha una vez y devuelve las transcripciones alternativas.
function listenOnce() {
  return new Promise((resolve, reject) => {
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.maxAlternatives = 5;
    rec.interimResults = false;
    let got = false;
    rec.onresult = e => { got = true; resolve([...e.results[0]].map(a => a.transcript)); };
    rec.onerror = e => reject(e.error || 'error');
    rec.onend = () => { if (!got) resolve([]); };
    rec.start();
  });
}
const SPEECH_ERRORS = {
  'not-allowed': 'Permite el uso del micrófono para practicar la pronunciación.',
  'service-not-allowed': 'El navegador no permite el reconocimiento de voz aquí.',
  'no-speech': 'No te escuché. Intenta de nuevo, más cerca del micrófono.',
  'audio-capture': 'No se encontró un micrófono.',
  network: 'El reconocimiento de voz necesita conexión a internet.',
};
