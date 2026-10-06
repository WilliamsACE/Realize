'use strict';
/* Constantes y utilidades generales (fechas, texto, descargas). */

/* ===================== 1. Constantes y utilidades ===================== */

const STORAGE_KEY = 'vocab-app:v1';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const MODEL_SUGGESTIONS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';
const DEEPSEEK_MODEL_SUGGESTIONS = ['deepseek-chat', 'deepseek-reasoner'];
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const OPENAI_DEFAULT_MODEL = 'gpt-6-luna';
const OPENAI_MODEL_SUGGESTIONS = ['gpt-6-luna'];
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
// Proveedores de IA: la key y el modelo de cada uno se guardan por separado en los ajustes.
const AI_PROVIDERS = {
  gemini: {
    name: 'Gemini', keySetting: 'apiKey', modelSetting: 'model',
    defaultModel: DEFAULT_MODEL, models: MODEL_SUGGESTIONS,
    keyLabel: 'clave de Google Gemini', keyPlaceholder: 'Clave de Google AI Studio',
    keyUrl: 'https://aistudio.google.com/apikey', keySite: 'Google AI Studio', keyOwner: 'Google',
  },
  deepseek: {
    name: 'DeepSeek', keySetting: 'deepseekKey', modelSetting: 'deepseekModel',
    defaultModel: DEEPSEEK_DEFAULT_MODEL, models: DEEPSEEK_MODEL_SUGGESTIONS,
    keyLabel: 'clave de DeepSeek', keyPlaceholder: 'Clave de DeepSeek (sk-…)',
    keyUrl: 'https://platform.deepseek.com/api_keys', keySite: 'DeepSeek Platform', keyOwner: 'DeepSeek',
  },
  openai: {
    name: 'OpenAI', keySetting: 'openaiKey', modelSetting: 'openaiModel',
    defaultModel: OPENAI_DEFAULT_MODEL, models: OPENAI_MODEL_SUGGESTIONS,
    keyLabel: 'clave de OpenAI', keyPlaceholder: 'Clave de OpenAI (sk-…)',
    keyUrl: 'https://platform.openai.com/api-keys', keySite: 'OpenAI Platform', keyOwner: 'OpenAI',
  },
};
const AI_TIMEOUT_MS = 60000;
const ENRICH_BATCH = 15;           // palabras por petición de enriquecimiento (10-20)

// Pasos por los que avanza cada palabra (nombres pensados para cualquiera, no para expertos).
const STAGES = ['', 'Conocer', 'Reconocer', 'Recordar', 'En contexto', 'Usarla'];
const EXERCISES = { 1: 'Conocer', 2: 'Reconocer', 3: 'Recordar', 4: 'En contexto', 5: 'Usarla', 6: 'Pronunciación', 7: 'Significado', 8: 'Rescate' };
const MODES = { classic: 'Clásico', relaxed: 'Relajado', intensive: 'Intensivo', auto: 'Automático' };
const LEECH_LAPSES = 5;            // fallos acumulados para marcar "leech"
const MASTERED_INTERVAL = 21;      // modo clásico: días de intervalo para considerar una palabra dominada
const SESSION_MAX_MS = 15 * 60 * 1000;
const RELAXED_SESSION_MS = 8 * 60 * 1000;
const SESSION_MAX_REVIEWS = 30;
// Modo intensivo: tras cada acierto en su primera sesión, la palabra vuelve
// a aparecer después de 2, 5 y 9 tarjetas (≈ 1, 5 y 15 minutos) antes de pasar a días.
const LEARNING_GAPS = [2, 5, 9];
const AUTO_INTENSIVE_TOP = 10;     // modo automático: intensivo para las 10 más frecuentes

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const $ = (sel, root = document) => root.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function endOfDay(ts) { const d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime(); }
// Suma días de calendario (no 24 h fijas) para no romperse con los cambios de horario.
function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }
function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDay(list, ts) { const k = dateKey(ts); if (!list.includes(k)) list.push(k); }
// Normaliza para comparar respuestas: minúsculas, sin acentos ni signos, apóstrofos rectos.
function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s-]/gu, '').replace(/\s+/g, ' ').trim();
}
const lemmaOf = w => w.lemma || normalize(w.word);
// "lads ((amigos))" → { word: 'lads', note: 'amigos' }. Lo que va entre (( )) es un
// comentario para la IA (qué significado quieres recordar); no forma parte de la palabra.
function parseWordLine(line) {
  const notes = [];
  const word = String(line ?? '').replace(/\(\((.*?)\)\)/g, (_, n) => { if (n.trim()) notes.push(n.trim()); return ' '; })
    .replace(/\s+/g, ' ').trim();
  return { word, note: notes.join('; ') };
}
function linesToArray(v) { return String(v ?? '').split('\n').map(s => s.trim()).filter(Boolean); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
function fmtIpa(ipa) { const s = String(ipa || '').trim(); return !s ? '' : /^[/[]/.test(s) ? s : `/${s}/`; }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function fmtNum(n) { return Number(n || 0).toLocaleString('es'); }
function cleanModel(v) { return String(v || '').trim().replace(/^models\//, ''); }
function slug(s) { return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lectura'; }

function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
