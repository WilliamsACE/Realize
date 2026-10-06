'use strict';
/* Persistencia: localStorage (palabras, ajustes, estadísticas) e IndexedDB
   (lecturas, vocabulario global y caché de IA). No toca la UI. */

/* ===================== 3. Persistencia ===================== */

// Estado FSRS (ver srs.js): stability 0 = nunca repasada.
function newSrs() { return { stability: 0, difficulty: 0, interval: 0, reps: 0, lapses: 0, due: null, last: null }; }

// Solo los campos de contenido de una palabra, limpios y con tipos correctos.
function cleanContent(d = {}) {
  const str = v => (v == null ? '' : String(v)).trim();
  const arr = (v, max = 10) => (Array.isArray(v) ? v : typeof v === 'string' ? linesToArray(v) : [])
    .map(str).filter(Boolean).slice(0, max);
  return {
    word: str(d.word), definition: str(d.definition), translation: str(d.translation),
    ipa: str(d.ipa), pos: str(d.pos),
    examples: arr(d.examples), collocations: arr(d.collocations), family: arr(d.family),
    mnemonic: str(d.mnemonic), distractors: arr(d.distractors, 6),
    note: str(d.note),                        // comentario del usuario: "lads ((amigos))" → "amigos"
    otherMeanings: arr(d.otherMeanings, 4),   // otros significados que sugiere la IA
    noteFeedback: str(d.noteFeedback),        // lo que opina la IA del comentario
  };
}

function createWord(content = {}) {
  const c = cleanContent(content);
  return {
    id: uid(), ...c,
    lemma: normalize(content.lemma || c.word),
    forms: [],          // formas vistas en el libro (thrived, thriving…)
    contexts: [],       // oraciones del libro: [{ text, loc, segId }]
    segIds: [],         // segmentos de lectura a los que pertenece
    freq: 0,            // frecuencia máxima en un segmento
    source: 'manual',   // manual | reading | capture
    stage: 1, srs: newSrs(), introducedAt: null,
    createdAt: Date.now(), lastReviewedAt: null, sentences: [],
    recogDays: [],      // días con acierto de reconocimiento/recuerdo
    successDays: [],    // días con cualquier acierto
    passedFinal: false, // superó la etapa de producción (modo intensivo)
    pinned: false,      // fijada (★): entra a cada sesión hasta aprenderla
    learnedAt: null, masteredAt: null,
    leechAt: null, leechBeatenAt: null,   // cuándo se volvió difícil y cuándo se venció
    mistakes: [],         // últimas respuestas equivocadas en inglés (pistas para el rescate)
    acceptedMeanings: [], // sinónimos en español que el usuario dio por buenos
    rescue: null,         // último rescate de palabra difícil: { at, lapses, own }
    rescueAid: null,      // ayuda de la IA para el rescate: { mnemonic, why, confusables, contrast }
  };
}

function clampStage(n) { return Math.min(5, Math.max(1, Math.round(Number(n) || 1))); }

function normalizeWord(raw) {
  const base = createWord(raw);
  const arr = v => (Array.isArray(v) ? v : []);
  return {
    ...base,
    id: raw.id || base.id,
    lemma: raw.lemma || base.lemma,
    forms: arr(raw.forms).slice(0, 12),
    contexts: arr(raw.contexts).filter(c => c && c.text).slice(0, 4),
    segIds: arr(raw.segIds),
    freq: Number(raw.freq) || 0,
    source: raw.source || 'manual',
    stage: clampStage(raw.stage ?? 1),
    srs: fromLegacy({ ...base.srs, ...(raw.srs || {}) }, Date.now()),   // datos de SM-2 → FSRS
    introducedAt: raw.introducedAt ?? null,
    createdAt: raw.createdAt ?? base.createdAt,
    lastReviewedAt: raw.lastReviewedAt ?? null,
    sentences: arr(raw.sentences).slice(0, 10),
    recogDays: arr(raw.recogDays), successDays: arr(raw.successDays),
    passedFinal: !!raw.passedFinal, learnedAt: raw.learnedAt ?? null, masteredAt: raw.masteredAt ?? null, pinned: !!raw.pinned,
    leechAt: raw.leechAt ?? null, leechBeatenAt: raw.leechBeatenAt ?? null,
    mistakes: arr(raw.mistakes).slice(0, 5), acceptedMeanings: arr(raw.acceptedMeanings).slice(0, 10),
    rescue: raw.rescue ?? null, rescueAid: raw.rescueAid ?? null,
  };
}

function defaultSettings() {
  return {
    provider: 'gemini',
    apiKey: '', model: DEFAULT_MODEL,
    deepseekKey: '', deepseekModel: DEEPSEEK_DEFAULT_MODEL,
    openaiKey: '', openaiModel: OPENAI_DEFAULT_MODEL,
    dailyNew: 5,                // palabras agregadas a mano (modo clásico)
    dailyNewRelaxed: 10, dailyNewIntensive: 25,
    coverageTarget: 96, noSpoilers: false, verifyKnown: true, blockWords: 3000,
    // Qué no se corrige al revisar oraciones con IA
    ignoreCase: true, ignorePunct: true, ignoreApostrophes: false,
    dismissedBanners: {},        // avisos cerrados en Inicio: { ai: true, waiting: <palabras al cerrarlo> }
    // Sincronización entre dispositivos (js/sync.js): repositorio privado de GitHub del usuario.
    syncRepo: '', syncToken: '', syncAuto: true, syncLastAt: null,
    welcomeDone: true,           // false solo en una instalación nueva: muestra la bienvenida (ui/welcome.js)
  };
}
function emptyIntroduced(date = null) { return { date, classic: 0, relaxed: 0, intensive: 0 }; }
function defaultStats() {
  return {
    streak: 0, bestStreak: 0, lastStudyDate: null, history: {}, newIntroduced: emptyIntroduced(),
    sessionsDone: 0,   // sesiones completadas sin pulsar «Terminar»
    feats: {},         // logros con fecha para «Tu historia»: { 'streak-7': ts, ... }
    freezes: 0,        // protectores de racha guardados (ver recordStreak)
    frozenDays: [],    // días cubiertos por un protector
    lastExportAt: null,
  };
}
function defaultData() { return { version: 2, words: sampleWords(), settings: { ...defaultSettings(), welcomeDone: false }, stats: defaultStats(), captures: [], groups: [] }; }

/* Grupo de palabras (ver ui/groups.js). type: 'meaning' (significan casi lo mismo, se
   practican emparejando definiciones cortas) o 'spelling' (se escriben parecido, se
   practican eligiendo entre cartas). defs: definición corta por id de palabra. */
function normalizeGroup(g) {
  const defs = {};
  for (const [k, v] of Object.entries(g.defs && typeof g.defs === 'object' ? g.defs : {})) if (String(v ?? '').trim()) defs[k] = String(v).trim();
  return {
    id: g.id, type: g.type === 'meaning' ? 'meaning' : 'spelling', name: String(g.name ?? '').trim(),
    ids: g.ids.filter(id => typeof id === 'string'), defs,
    createdAt: g.createdAt ?? Date.now(), runs: Number(g.runs) || 0, best: Number(g.best) || 0,
    last: g.last ?? null, lastAt: g.lastAt ?? null,
  };
}

// Valida y completa datos (de localStorage o de un JSON importado).
function migrateData(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.words)) throw new Error('Formato inválido');
  const stats = { ...defaultStats(), ...(raw.stats || {}) };
  stats.history = { ...(raw.stats?.history || {}) };
  stats.feats = { ...(raw.stats?.feats || {}) };
  const ni = raw.stats?.newIntroduced || {};
  // v1 guardaba { date, count }: pasa a contadores por modo.
  stats.newIntroduced = { ...emptyIntroduced(ni.date ?? null), ...ni, classic: ni.classic ?? ni.count ?? 0 };
  return {
    version: 2,
    words: raw.words.filter(w => w && typeof w === 'object').map(normalizeWord).filter(w => w.word),
    settings: { ...defaultSettings(), ...(raw.settings || {}) },
    stats,
    captures: (Array.isArray(raw.captures) ? raw.captures : []).filter(c => c && c.text),
    captureSeg: typeof raw.captureSeg === 'string' ? raw.captureSeg : '',
    // Grupos de palabras; antes se guardaban como «similar» (todos de escritura parecida).
    groups: (Array.isArray(raw.groups) ? raw.groups : Array.isArray(raw.similar) ? raw.similar : [])
      .filter(g => g && g.id && Array.isArray(g.ids)).map(normalizeGroup),
  };
}

function loadData() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrateData(JSON.parse(raw)) : defaultData();
  } catch (e) {
    console.warn('No se pudieron leer los datos guardados; se usan los de ejemplo.', e);
    // Guarda una copia de lo que hubiera para no perderlo al sobrescribir.
    try { if (raw) localStorage.setItem(STORAGE_KEY + ':backup', raw); } catch { /* sin acceso */ }
    return defaultData();
  }
}

function saveLocal(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(`${STORAGE_KEY}:at`, String(Date.now()));
    return true;
  } catch (e) { console.error('No se pudo guardar', e); return false; }
}

/* Dónde viven los datos: al cargar la página se leen de localStorage (para pintar al
   instante) y en el arranque se mudan a IndexedDB (ver loadAppData), que no tiene el límite
   de ~5 MB de localStorage. Desde entonces se guardan solo ahí. */
const DATA_RECORD = 'appData';
const dataStore = { idb: false, writing: null, again: false };

function saveData(data) {
  if (!dataStore.idb) return saveLocal(data);
  // Las escrituras se encadenan: si hay una en curso, al terminar se guarda el estado más reciente.
  if (dataStore.writing) { dataStore.again = true; return true; }
  dataStore.writing = idbPut('meta', { key: DATA_RECORD, data, at: Date.now() })
    .catch(e => {
      console.error('No se pudo guardar en IndexedDB', e);
      if (!saveLocal(data)) toast('No se pudo guardar en este navegador (almacenamiento lleno o bloqueado).', 'err');
    })
    .finally(() => {
      dataStore.writing = null;
      if (dataStore.again) { dataStore.again = false; saveData(state.data); }
    });
  return true;
}

// Arranque: carga los datos de IndexedDB o, la primera vez, los muda ahí desde localStorage.
async function loadAppData() {
  if (!state.lib.available) return;   // sin IndexedDB se quedan en localStorage
  try {
    const rec = await idbGet('meta', DATA_RECORD);
    let localAt = 0, hasLocal = false;
    try { hasLocal = localStorage.getItem(STORAGE_KEY) != null; localAt = Number(localStorage.getItem(`${STORAGE_KEY}:at`)) || 0; } catch { /* sin acceso */ }
    // Gana lo más reciente: si un guardado no pudo ir a IndexedDB y cayó a localStorage, se usa ese.
    // (state.data ya trae lo de localStorage: se cargó al abrir la página.)
    if (rec?.data && !(hasLocal && localAt > (rec.at || 0))) state.data = migrateData(rec.data);
    else await idbPut('meta', { key: DATA_RECORD, data: state.data, at: Date.now() });
    dataStore.idb = true;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(`${STORAGE_KEY}:at`); } catch { /* sin acceso */ }
  } catch (e) {
    console.warn('Los datos siguen en localStorage', e);
  }
}

// Pide al navegador que no borre los datos solo (por falta de espacio o por no usar el sitio).
// Se pide en cuanto hay progreso real; antes no vale la pena.
async function protectStorage(force = false) {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    if (!force && !state.data.stats.lastStudyDate && !state.data.words.some(w => w.introducedAt)) return false;
    return await navigator.storage.persist();
  } catch { return null; }
}

/* ---------- IndexedDB: lecturas, vocabulario global y caché de IA ---------- */

const IDB_NAME = 'vocab-app';
const IDB_VERSION = 2;
const IDB_STORES = { books: 'id', texts: 'id', segments: 'id', known: 'lemma', aiCache: 'lemma' };
// Almacenes internos que no entran en los respaldos (v2: estado de la última sincronización).
const IDB_INTERNAL = { meta: 'key' };
let idbPromise = null;

function idbOpen() {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB no disponible')); return; }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, keyPath] of Object.entries({ ...IDB_STORES, ...IDB_INTERNAL })) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return idbPromise;
}

async function idbRun(store, mode, fn) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result;
    const req = fn(tx.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const idbGetAll = store => idbRun(store, 'readonly', os => os.getAll());
const idbGet = (store, key) => idbRun(store, 'readonly', os => os.get(key));
const idbPut = (store, value) => idbRun(store, 'readwrite', os => os.put(value));
const idbDelete = (store, key) => idbRun(store, 'readwrite', os => os.delete(key));
const idbClear = store => idbRun(store, 'readwrite', os => os.clear());
const idbPutMany = (store, values) => idbRun(store, 'readwrite', os => { for (const v of values) os.put(v); });

async function loadLib() {
  try {
    const [books, segments, known, cache] = await Promise.all(['books', 'segments', 'known', 'aiCache'].map(idbGetAll));
    state.lib.books = books;
    state.lib.segments = segments;
    state.lib.known = new Map(known.map(k => [k.lemma, k]));
    state.lib.aiCache = new Map(cache.map(c => [c.lemma, c]));
  } catch (e) {
    console.warn('IndexedDB no disponible; las lecturas no se guardarán.', e);
    state.lib.available = false;
  }
  state.lib.ready = true;
}

/* Avisos de cambios en los datos (los usa la sincronización para subirlos). */
const dataChangeListeners = new Set();
const notifyDataChange = () => dataChangeListeners.forEach(fn => fn());

function libSave(store, value) {
  notifyDataChange();
  if (!state.lib.available) return Promise.resolve();
  return idbPut(store, value).catch(e => { console.error(e); toast('No se pudo guardar en IndexedDB.', 'err'); });
}
function libDelete(store, key) {
  notifyDataChange();
  if (!state.lib.available) return Promise.resolve();
  return idbDelete(store, key).catch(e => console.error(e));
}

const KNOWN_RANK = { known: 1, learned: 2, mastered: 3 };
// Vocabulario global: palabras sabidas (triage) o aprendidas/dominadas (estudio).
function libMarkKnown(lemma, status, source) {
  if (!lemma) return;
  const prev = state.lib.known.get(lemma);
  if (prev && KNOWN_RANK[prev.status] >= KNOWN_RANK[status]) return;
  const rec = { lemma, status, source, at: Date.now() };
  state.lib.known.set(lemma, rec);
  libSave('known', rec);
}
function libUnmarkKnown(lemma) { if (state.lib.known.delete(lemma)) libDelete('known', lemma); }
function libCachePut(lemma, content) {
  const rec = { lemma, content, at: Date.now() };
  state.lib.aiCache.set(lemma, rec);
  libSave('aiCache', rec);
}
const libSaveSegment = seg => libSave('segments', seg);

// Aviso de respaldo: a los 7 días de uso sin ningún respaldo, o 14 días después del último.
// Al cerrarlo se pospone una semana.
function backupReminder(now = Date.now()) {
  const { words, stats, settings } = state.data;
  const snoozed = settings.dismissedBanners?.backup;
  if (typeof snoozed === 'number' && now - snoozed < 7 * DAY) return null;
  const starts = words.filter(w => w.introducedAt && w.introducedAt >= w.createdAt - MINUTE).map(w => w.introducedAt);
  if (!starts.length) return null;
  const last = stats.lastExportAt;
  const days = Math.floor((now - (last || Math.min(...starts))) / DAY);
  return days >= (last ? 14 : 7) ? { days, never: !last } : null;
}

// Exportación completa: localStorage + IndexedDB. Las API keys no se incluyen.
async function exportAll() {
  const { apiKey, deepseekKey, openaiKey, syncToken, ...settings } = state.data.settings;
  let lib = null;
  if (state.lib.available) {
    lib = {};
    for (const store of Object.keys(IDB_STORES)) lib[store] = await idbGetAll(store);
  }
  return JSON.stringify({ app: 'vocab-app', version: 2, exportedAt: new Date().toISOString(), ...state.data, settings, lib }, null, 2);
}

async function importAll(raw) {
  const data = migrateData(raw);
  if (raw.lib && typeof raw.lib === 'object' && state.lib.available) {
    for (const store of Object.keys(IDB_STORES)) {
      await idbClear(store);
      const vals = Array.isArray(raw.lib[store]) ? raw.lib[store] : [];
      if (vals.length) await idbPutMany(store, vals);
    }
    await loadLib();
  }
  return data;
}

// CSV compatible con Anki (cabeceras de archivo de Anki 2.1.55+).
function exportCSV(words, tag = '') {
  const field = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['#separator:Comma', '#html:true', '#tags column:3', '#columns:Front,Back,Tags'];
  for (const w of words) {
    const front = esc(w.word) + (w.ipa ? `<br><small>${esc(fmtIpa(w.ipa))}</small>` : '');
    const ex = displayExamples(w)[0];
    const back = [
      w.translation && `<b>${esc(w.translation)}</b>`, w.pos && `<i>${esc(w.pos)}</i>`, w.definition && esc(w.definition),
      ex && `<i>${esc(ex)}</i>`, w.mnemonic && `Truco: ${esc(w.mnemonic)}`,
    ].filter(Boolean).join('<br>');
    lines.push([front, back, ['vocab', tag && slug(tag)].filter(Boolean).join(' ')].map(field).join(','));
  }
  return lines.join('\n');
}

/* Estado único de la app: `data` se persiste en localStorage, `lib` en IndexedDB y
   `ui` es estado temporal de pantalla. */
const state = {
  data: loadData(),
  lib: { ready: false, available: true, books: [], segments: [], known: new Map(), aiCache: new Map() },
  ui: {
    addText: '', drafts: [], expanded: 0, editingDraft: false,
    addBusy: false, addProgress: '', addError: null, pendingWords: [],
    search: '', filter: 'all',
    editDraft: null, editBusy: false,
    session: null, quiz: null, enrichBusy: '',
  },
};

function persist() {
  if (!saveData(state.data)) toast('No se pudo guardar en este navegador (almacenamiento lleno o bloqueado).', 'err');
  notifyDataChange();
}
