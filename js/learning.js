'use strict';
/* Lógica de aprendizaje: modos, etapas, racha, sesión y quiz. */

/* ===================== 5. Lógica de aprendizaje ===================== */

const findWord = id => state.data.words.find(w => w.id === id);
const findWordByLemma = lemma => state.data.words.find(w => lemmaOf(w) === lemma);
const isNew = w => !w.introducedAt;
const isLeech = w => (w.srs?.lapses || 0) >= LEECH_LAPSES;
const isMastered = w => !!w.masteredAt || (wordMode(w) === 'classic' && w.stage === 5 && w.srs.interval >= MASTERED_INTERVAL);
const isLearned = w => !!w.learnedAt || isMastered(w);
const isStudyReady = w => !!(w.translation || w.definition);   // sin significado no se puede estudiar
const isDueToday = (w, now = Date.now()) => !isNew(w) && w.srs.due != null && w.srs.due <= endOfDay(now);
const wordExists = (text, exceptId) => state.data.words.some(w => w.id !== exceptId && normalize(w.word) === normalize(text));
const segmentById = id => state.lib.segments.find(s => s.id === id);

// Modo de una palabra según su segmento; las palabras agregadas a mano usan el modo clásico.
function segmentModeFor(seg, lemma) {
  if (seg.mode === 'auto') return (seg.autoTop || []).includes(lemma) ? 'intensive' : 'relaxed';
  return seg.mode === 'intensive' ? 'intensive' : 'relaxed';
}
function wordMode(w) {
  let found = false;
  for (const id of w.segIds || []) {
    const seg = segmentById(id);
    if (!seg) continue;
    found = true;
    if (segmentModeFor(seg, lemmaOf(w)) === 'intensive') return 'intensive';
  }
  return found ? 'relaxed' : 'classic';
}

/* Variantes simples de un lema (plural, -ed, -ing) para reconocer la misma palabra
   entre libros aunque se haya agrupado con otra forma ("goblins" / "goblin"). */
function lemmaVariants(l) {
  const v = new Set([l, l + 's', l + 'es', l + 'd', l + 'ed', l + 'ing']);
  if (l.endsWith('s')) v.add(l.slice(0, -1));
  if (l.endsWith('es')) v.add(l.slice(0, -2));
  if (l.endsWith('ed')) { v.add(l.slice(0, -2)); v.add(l.slice(0, -1)); }
  if (l.endsWith('ing')) { v.add(l.slice(0, -3)); v.add(l.slice(0, -3) + 'e'); }
  if (l.endsWith('e')) v.add(l.slice(0, -1) + 'ing');
  return [...v];
}
function knownRecord(lemma) {
  const k = state.lib.known;
  if (k.has(lemma)) return k.get(lemma);
  for (const v of lemmaVariants(lemma)) if (k.has(v)) return k.get(v);
  return null;
}

// Cobertura de lectura: ocurrencias conocidas / ocurrencias totales. Las palabras
// comunes, los nombres propios y el vocabulario global cuentan como sabidas.
function segmentCoverage(seg) {
  if (!seg.totalTokens) return 100;
  let known = seg.baseKnown;
  for (const [lemma, f] of Object.entries(seg.rare || {})) if (knownRecord(lemma)) known += f;
  return Math.min(100, (known / seg.totalTokens) * 100);
}
const fmtPct = p => `${(Math.floor(p * 10) / 10).toLocaleString('es')}%`;

function dailyLimit(mode, settings = state.data.settings) {
  return mode === 'relaxed' ? settings.dailyNewRelaxed : mode === 'intensive' ? settings.dailyNewIntensive : settings.dailyNew;
}
function newIntroducedToday(stats, mode = 'classic', now = Date.now()) {
  return stats.newIntroduced.date === dateKey(now) ? (stats.newIntroduced[mode] || 0) : 0;
}
const remainingNew = (mode, now = Date.now()) => Math.max(0, dailyLimit(mode) - newIntroducedToday(state.data.stats, mode, now));

// Un acierto avanza una etapa y un fallo la regresa una (delta = +1 / -1 / 0).
function nextStage(stage, delta) { return clampStage(stage + delta); }

// Registra actividad del día para la gráfica. La racha no cambia aquí (ver recordStreak).
function recordActivity(stats, now = Date.now()) {
  const today = dateKey(now);
  stats.history[today] = (stats.history[today] || 0) + 1;
  const cutoff = dateKey(addDays(now, -60));
  for (const k of Object.keys(stats.history)) if (k < cutoff) delete stats.history[k];
}

// Logros con fecha para «Tu historia»: solo se guarda la primera vez.
function recordFeat(stats, key, now = Date.now()) {
  if (!stats.feats[key]) stats.feats[key] = now;
}

/* Protector de racha: se gana uno cada 14 días seguidos (se guardan hasta 2) y
   cubre un solo día sin estudiar. Se gasta al completar la siguiente sesión. */
const FREEZE_EVERY = 14;
const FREEZE_MAX = 2;
const missedOneDay = (stats, now) => stats.lastStudyDate === dateKey(addDays(now, -2));
// ¿Ayer no se estudió y hay un protector que lo cubre?
const streakProtected = (stats, now = Date.now()) => missedOneDay(stats, now) && (stats.freezes || 0) > 0;

// Suma el día a la racha (una vez por día). Solo se llama al completar una sesión.
const STREAK_FEATS = [3, 7, 14, 30, 60, 100, 200, 365];
function recordStreak(stats, now = Date.now()) {
  const today = dateKey(now);
  if (stats.lastStudyDate !== today) {
    const yesterday = dateKey(addDays(now, -1));
    if (stats.lastStudyDate === yesterday) stats.streak++;
    else if (streakProtected(stats, now)) {
      stats.freezes--;
      stats.frozenDays = [...(stats.frozenDays || []), yesterday].slice(-30);
      recordFeat(stats, 'freeze-used', now);
      stats.streak++;
    } else stats.streak = 1;
    stats.lastStudyDate = today;
    if (stats.streak % FREEZE_EVERY === 0 && (stats.freezes || 0) < FREEZE_MAX) {
      stats.freezes = (stats.freezes || 0) + 1;
      recordFeat(stats, 'freeze-earned', now);
    }
    if (STREAK_FEATS.includes(stats.streak)) recordFeat(stats, `streak-${stats.streak}`, now);
  }
  stats.bestStreak = Math.max(stats.bestStreak || 0, stats.streak);
}

// La racha guardada cuenta si se estudió hoy o ayer, o si un protector cubre el día de ayer.
function currentStreak(stats, now = Date.now()) {
  const d = stats.lastStudyDate;
  return d === dateKey(now) || d === dateKey(addDays(now, -1)) || streakProtected(stats, now) ? stats.streak : 0;
}

/* Ejemplos a mostrar: primero las oraciones del libro (salvo con "sin spoilers")
   y luego los ejemplos genéricos de la IA. */
const bookContexts = w => (state.data.settings.noSpoilers ? [] : w.contexts || []);
function displayExamples(w) {
  const seen = new Set();
  return [...bookContexts(w).map(c => c.text), ...w.examples].filter(t => {
    const k = normalize(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* Busca en una oración la forma de la palabra (thrive → thriving, thrives…).
   Prueba primero las formas vistas en el libro y luego un "tallo" simple.
   Las expresiones aceptan la primera palabra conjugada y, en medio, un objeto
   corto: "kick off" → "kicked off", "put off" → "put the meeting off". */
function findForm(sentence, word, forms = []) {
  for (const f of forms) {
    if (!f) continue;
    const pat = f.split(/[\s-]+/).map(escapeRe).join('[\\s-]+').replace(/'/g, "['’]");
    const m = new RegExp(`(^|[^\\p{L}])(${pat})(?![\\p{L}])`, 'iu').exec(sentence);
    if (m) { const start = m.index + m[1].length; return { start, end: start + m[2].length, token: m[2] }; }
  }
  const target = String(word || '').trim().toLowerCase();
  if (!target) return null;
  if (/\s/.test(target)) {
    const [first, ...rest] = target.split(/\s+/);
    const head = first.length >= 4 && /[ey]$/.test(first) ? first.slice(0, -1) : first;
    const tail = rest.map(r => (r === "one's" ? "[\\p{L}'’]+" : escapeRe(r))).join('[\\s-]+');
    const m = new RegExp(`(^|[^\\p{L}])(${escapeRe(head)}\\p{L}*(?:\\s+[\\p{L}'’]+){0,3}?[\\s-]+${tail})(?![\\p{L}])`, 'iu').exec(sentence);
    if (!m) return null;
    const start = m.index + m[1].length;
    return { start, end: start + m[2].length, token: m[2] };
  }
  const stem = target.length > 4 && /[ey]$/.test(target) ? target.slice(0, -1) : target;
  for (const m of sentence.matchAll(/[\p{L}][\p{L}'-]*/gu)) {
    const tok = m[0].toLowerCase();
    if (tok.startsWith(stem) && tok.length <= target.length + 4) return { start: m.index, end: m.index + m[0].length, token: m[0] };
  }
  return null;
}

// Resalta la palabra dentro de una oración (para mostrar contextos del libro).
function highlightWord(sentence, w) {
  const f = findForm(sentence, w.word, w.forms);
  if (!f) return esc(sentence);
  return esc(sentence.slice(0, f.start)) + `<b class="hl">${esc(sentence.slice(f.start, f.end))}</b>` + esc(sentence.slice(f.end));
}

// ¿La oración del usuario contiene la palabra o alguna forma de su familia?
function containsWord(sentence, w) {
  if (findForm(sentence, w.word, w.forms)) return true;
  return w.family.some(f => {
    const base = f.split(/[\s(/]/)[0];
    return base && base.length > 2 && findForm(sentence, base);
  });
}

// Cloze: usa la oración del libro si se permite; si no, los ejemplos genéricos.
function buildCloze(w) {
  const sources = [...bookContexts(w).map(c => c.text), ...shuffle(w.examples)];
  for (const ex of sources) {
    const f = findForm(ex, w.word, w.forms);
    if (f) return { before: ex.slice(0, f.start), after: ex.slice(f.end), answer: f.token, sentence: ex };
  }
  return null; // sin ejemplo útil: se usa un ejercicio de recuerdo
}

const GENERIC_DISTRACTORS = ['olvidar', 'brillante', 'temprano', 'esconder', 'ruidoso', 'prestar', 'débil', 'apurarse'];

// Primer significado de una traducción ("delgado, fino" → "delgado").
const firstMeaning = t => String(t || '').split(/\s*[,;/]\s*/)[0].trim();

// Significado principal: el de la traducción más parecido al comentario del usuario
// ("lads ((amigos))" → "amigos" antes que "chicos"); sin comentario, el primero.
function primaryMeaning(w) {
  const parts = String(w.translation || '').split(/\s*[,;/]\s*/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  const notes = String(w.note || '').split(/\s*[,;/]\s*/).map(normalize).filter(Boolean);
  if (!notes.length) return parts[0];
  const dist = p => {
    const k = normalize(p);
    return Math.min(...notes.map(n => (k === n ? 0 : k.includes(n) || n.includes(k) ? 0.5 : 1 + levenshtein(k, n) / Math.max(k.length, n.length))));
  };
  return parts.reduce((best, p) => (dist(p) < dist(best) ? p : best));
}

/* Opciones de opción múltiple. Todas muestran un solo significado: si la correcta
   trajera varios ("delgado, fino") y los distractores uno, se adivinaría por la forma. */
function buildOptions(w) {
  const correct = w.translation ? primaryMeaning(w) : w.definition || '(sin traducción)';
  const used = new Set([normalize(correct)]);
  const picks = [];
  const take = list => {
    for (const t of list) {
      if (picks.length >= 3) return;
      const k = normalize(t);
      if (t && !used.has(k)) { used.add(k); picks.push(t); }
    }
  };
  take(shuffle(w.distractors || []).map(firstMeaning));
  // Si la IA no dio suficientes distractores, usa traducciones de otras palabras.
  take(shuffle(state.data.words.filter(o => o.id !== w.id).map(o => firstMeaning(o.translation))));
  take(shuffle(GENERIC_DISTRACTORS));
  return shuffle([{ text: correct, correct: true }, ...picks.map(text => ({ text, correct: false }))]);
}

/* Compara la respuesta escrita: exacta, forma alternativa aceptada o error de
   una letra (tipeo) en palabras de 4+ letras. */
function checkAnswer(input, expected, alternatives = []) {
  const a = normalize(input);
  if (!a) return { ok: false, kind: 'empty' };
  const exp = normalize(expected);
  const all = [exp, ...alternatives.map(normalize)];
  if (a === exp) return { ok: true, kind: 'exact' };
  if (all.includes(a)) return { ok: true, kind: 'alt' };
  if (all.some(t => t.length >= 4 && levenshtein(a, t) === 1)) return { ok: true, kind: 'typo' };
  return { ok: false, kind: 'wrong' };
}

/* Arma la cola de la sesión: repasos vencidos + nuevas según la meta diaria de
   cada modo, intercaladas (una nueva cada dos repasos). Con `segId` solo usa
   las palabras de ese segmento; `force` permite repasar por adelantado. */
/* Preparar una lectura: todas las palabras del segmento (salvo las dominadas), sin
   límite diario, en bloques. Primero las que no se repasaron hoy (para retomar donde
   se dejó) y, entre ellas, las más frecuentes en el texto. */
const PREP_BLOCK = 10;
// random: tras completar una vuelta entera, el orden es al azar (si siempre fuera el
// mismo, solo se aprenderían bien las primeras).
function prepBlocks(pool, now = Date.now(), random = false) {
  const today = startOfDay(now);
  const doneToday = w => (w.lastReviewedAt || 0) >= today;
  const rest = pool.filter(w => !isMastered(w));
  const ids = (random
    ? [...shuffle(rest.filter(w => !doneToday(w))), ...shuffle(rest.filter(doneToday))]
    : rest.sort((a, b) => doneToday(a) - doneToday(b) || (b.freq || 0) - (a.freq || 0) || a.createdAt - b.createdAt))
    .map(w => w.id);
  const blocks = [];
  for (let i = 0; i < ids.length; i += PREP_BLOCK) blocks.push(ids.slice(i, i + PREP_BLOCK));
  return blocks;
}

/* Palabras que costaron en las sesiones de un segmento ({ wordId: veces }): se guardan
   en el segmento y se repasan al final de «Estudiar todas» (o cuando se quiera). */
function hardIds(seg) {
  return Object.entries(seg?.hard || {})
    .filter(([id]) => { const w = findWord(id); return w && isStudyReady(w); })
    .sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
// Un fallo o un «Difícil» la suma a la lista; acertarla en el repaso final la saca.
function trackHard(s, w, grade) {
  const seg = s?.segId && segmentById(s.segId);
  if (!seg) return;
  const hard = { ...(seg.hard || {}) };
  if (grade === 'again' || grade === 'hard') hard[w.id] = (hard[w.id] || 0) + 1;
  else if (s.reviewing && hard[w.id]) delete hard[w.id];
  else return;
  seg.hard = hard;
  libSaveSegment(seg);
}

/* Palabras fijadas (★ en Mis palabras): entran a todas las sesiones aunque no les toque
   repaso y sin contar para la meta de nuevas, y vuelven una vez más en la sesión tras
   acertarlas. Al aprenderse se desfijan solas. */
const PIN_MAX = 10;   // fijadas extra por sesión
function pinnedExtra(pool, taken) {
  return pool.filter(w => w.pinned && !taken.has(w.id)).slice(0, PIN_MAX);
}

function buildSession(data, { force = false, segId = null, all = false, hard = false } = {}) {
  const now = Date.now();
  const pool = data.words.filter(w => isStudyReady(w) && (!segId || w.segIds.includes(segId)));
  const newOrder = (a, b) => (b.freq || 0) - (a.freq || 0) || a.createdAt - b.createdAt;
  const blocks = all && segId ? prepBlocks(pool, now, !!segmentById(segId)?.prepPasses) : null;
  const hardQueue = hard && segId ? hardIds(segmentById(segId)) : null;
  let reviews = [], fresh = [];
  if (blocks || hardQueue) {
    // la cola se llena bloque a bloque (ver prepareExercise y la acción next-block)
  } else if (force) {
    reviews = pool.filter(w => !isNew(w)).sort((a, b) => (a.srs.due ?? 0) - (b.srs.due ?? 0)).slice(0, 10);
    fresh = pool.filter(isNew).sort(newOrder).slice(0, 3);
  } else {
    reviews = pool.filter(w => isDueToday(w, now)).sort((a, b) => a.srs.due - b.srs.due).slice(0, SESSION_MAX_REVIEWS);
    const slots = { classic: remainingNew('classic', now), relaxed: remainingNew('relaxed', now), intensive: remainingNew('intensive', now) };
    fresh = [];
    for (const w of pool.filter(isNew).sort(newOrder)) {
      const m = wordMode(w);
      if (slots[m] > 0) { slots[m]--; fresh.push(w); }
    }
  }
  if (!blocks && !hardQueue) {
    const taken = new Set([...reviews, ...fresh].map(w => w.id));
    for (const w of pinnedExtra(pool, taken)) {
      if (isNew(w)) fresh.unshift(w);
      else reviews.push(w);
    }
  }
  const r = shuffle(reviews.map(w => w.id));
  const n = fresh.map(w => w.id);
  const queue = blocks ? [...(blocks[0] || [])] : hardQueue ? [...hardQueue] : [];
  while (r.length || n.length) {
    for (let i = 0; i < 2 && r.length; i++) queue.push(r.shift());
    if (n.length) queue.push(n.shift());
  }
  const seg = segId && segmentById(segId);
  return {
    queue, pos: 0, done: 0, startedAt: now, endedAt: null, finished: false, timeUp: false,
    blocks, block: 0, betweenBlocks: false,
    reviewing: !!hardQueue,   // repaso de las que más costaron (al final de los bloques o por separado)
    // Preparando una lectura no hay límite de tiempo: se para entre bloques.
    segId, maxMs: blocks || hardQueue ? Infinity : seg?.mode === 'relaxed' ? RELAXED_SESSION_MS : SESSION_MAX_MS,
    seen: {}, learn: {}, intensiveSeen: {}, rescued: {}, pinAgain: {},
    stats: { correct: 0, almost: 0, wrong: 0, newWords: 0 }, ex: null, quiz: null,
    streakBefore: currentStreak(data.stats, now), celebrated: false,   // para la celebración final
  };
}

// Vuelve a poner la palabra más adelante en la sesión (tras un fallo, una exposición o un paso de aprendizaje).
function requeueWord(s, id, gap = 3) {
  const w = findWord(id);
  const max = w && wordMode(w) === 'intensive' ? 7 : 3;
  if ((s.seen[id] || 0) >= max) return;
  s.queue.splice(Math.min(s.pos + 1 + gap, s.queue.length), 0, id);
}

// Prepara el ejercicio del elemento actual; el tipo depende del modo y la etapa.
function prepareExercise() {
  const s = state.ui.session;
  s.ex = null;
  while (s.pos < s.queue.length) {
    if (Date.now() - s.startedAt > s.maxMs) { s.timeUp = true; break; }
    const w = findWord(s.queue[s.pos]);
    if (w && isStudyReady(w)) {
      s.seen[w.id] = (s.seen[w.id] || 0) + 1;
      // Una palabra difícil pasa primero por el rescate (una vez por sesión).
      s.ex = needsRescue(w) && !s.rescued[w.id] ? makeRescue(w) : makeExercise(w);
      return;
    }
    s.pos++; // la palabra se borró durante la sesión
  }
  // Terminar el último bloque cuenta como una vuelta completa a la lectura.
  if (s.blocks && !s.reviewing && !s.passCounted && s.block === s.blocks.length - 1) {
    s.passCounted = true;
    const seg = segmentById(s.segId);
    if (seg) { seg.prepPasses = (seg.prepPasses || 0) + 1; libSaveSegment(seg); }
  }
  // Preparar lectura: al terminar un bloque hay una pausa antes del siguiente y, tras el
  // último, antes del repaso de las que más costaron.
  if (s.blocks && !s.timeUp && !s.reviewing && (s.block < s.blocks.length - 1 || hardIds(segmentById(s.segId)).length)) {
    s.betweenBlocks = true;
    return;
  }
  finishSession(s);
}

/* completed = false cuando se pulsa «Terminar»: el avance de las palabras se
   guarda, pero no hay celebración ni suma a la racha. */
const SESSION_FEATS = [1, 10, 25, 50, 100, 250, 500];
function finishSession(s, completed = true) {
  if (s.finished) return;
  s.finished = true;
  s.endedAt = Date.now();
  s.ex = null;
  s.completed = completed && s.done > 0;
  if (s.completed) {
    const st = state.data.stats;
    recordStreak(st, s.endedAt);
    st.sessionsDone = (st.sessionsDone || 0) + 1;
    if (SESSION_FEATS.includes(st.sessionsDone)) recordFeat(st, `sessions-${st.sessionsDone}`, s.endedAt);
    if (s.stats.correct + s.stats.almost >= 10 && !s.stats.wrong) recordFeat(st, 'perfect-session', s.endedAt);
    persist();
  }
  // Modo intensivo: minitest mezclado con las palabras vistas en la sesión.
  if (!s.quiz) {
    const words = Object.keys(s.intensiveSeen).map(findWord).filter(w => w && isStudyReady(w));
    if (words.length >= 2) s.quiz = buildQuiz(words, { size: 8, context: 'minitest', title: 'Mini prueba de la sesión' });
  }
}

function makeExercise(w) {
  const mode = wordMode(w);
  let type = w.stage;
  if (mode === 'relaxed') {
    // Relajado: tarjeta y opción múltiple; cuando ya la reconoce, también escribir el significado o la palabra.
    const r = Math.random();
    type = w.stage <= 1 ? 1 : !w.recogDays.length ? 2 : r < 0.4 ? 7 : r < 0.6 ? 3 : 2;
  } else if (mode === 'intensive' && type === 5 && w.passedFinal && SpeechRec && Math.random() < 0.3) {
    type = 6; // pronunciación, si el navegador la soporta
  } else if ((type === 2 && w.recogDays.length) || (type === 3 && Math.random() < 0.35)) {
    type = 7; // recordar el significado: más exigente (y más eficaz) que elegirlo entre opciones
  }
  if (type === 7 && !w.translation) type = mode === 'relaxed' ? 2 : w.stage;
  const ex = { wordId: w.id, type, mode, phase: 'ask', input: '', result: null, done: false };
  if (type === 2) ex.options = buildOptions(w);
  if (type === 4) ex.cloze = buildCloze(w);
  if (type === 5) Object.assign(ex, { sentence: '', submitted: '', feedback: null, error: null, attempts: 0, warnMissing: false });
  return ex;
}

/* ---------- Recuerdo del significado (ejercicio 7) ----------
   Ver la palabra en inglés y escribir qué significa: es lo que pide la lectura,
   y recordar sin opciones fija más que reconocer entre opciones. */
const ES_LEAD = /^(el|la|los|las|lo|un|una|unos|unas|ser|estar)\s+/;
// Significados aceptados: { text: como se escribe, key: normalizado para comparar }.
function meaningEntries(w) {
  return [...String(w.translation || '').split(/[,;/]/), ...String(w.note || '').split(/[,;/]/), ...(w.acceptedMeanings || [])]
    .map(t => { const text = t.replace(/\(.*?\)/g, '').trim(); return { text: text.replace(new RegExp(ES_LEAD.source, 'i'), ''), key: normalize(text).replace(ES_LEAD, '') }; })
    .filter(e => e.key);
}
const meaningKeys = w => meaningEntries(w).map(e => e.key);
// Acepta cualquier traducción o sinónimo ya aceptado, sin artículos, acentos ni errores de tipeo.
function checkMeaning(input, w) {
  const a = normalize(input).replace(ES_LEAD, '');
  if (!a) return { ok: false, kind: 'empty' };
  const entries = meaningEntries(w);
  const keys = entries.map(e => e.key);
  if (keys.includes(a)) return { ok: true, kind: 'exact' };
  const near = entries.find(e => levenshtein(a, e.key) <= (e.key.length >= 8 ? 2 : e.key.length >= 4 ? 1 : 0));
  if (near) return { ok: true, kind: 'typo', match: near.text };
  // "muy delgado" contiene "delgado"; "esfuerzo" está en "esfuerzo grande".
  if (keys.some(k => k.length >= 4 && (` ${a} `.includes(` ${k} `) || (a.length >= 4 && ` ${k} `.includes(` ${a} `))))) return { ok: true, kind: 'close' };
  return { ok: false, kind: 'wrong' };
}

/* ---------- Rescate de palabras difíciles (ejercicio 8) ----------
   Cuando una palabra se vuelve leech, repetirla igual no funciona: se le da un
   ancla nueva (truco propio o de la IA), se contrasta con las palabras con las
   que se confunde y se practica enseguida. Se repite si vuelve a fallar 3 veces. */
const needsRescue = w => isLeech(w) && (!w.rescue || w.srs.lapses >= w.rescue.lapses + 3);

function makeRescue(w) {
  const ex = { wordId: w.id, type: 8, mode: wordMode(w), phase: 'intro', note: '', loading: false, error: null, qs: [], qpos: 0, done: false };
  if (hasKey() && !w.rescueAid) loadRescueAid(w, ex);
  return ex;
}

async function loadRescueAid(w, ex) {
  ex.loading = true;
  ex.error = null;
  try {
    w.rescueAid = await fetchRescueAid(w);
    persist();
  } catch (e) {
    ex.error = errorText(e);
  }
  ex.loading = false;
  if (state.ui.session?.ex === ex) refreshIfOn('estudiar');
}

// Preguntas de contraste: oraciones con hueco donde va la palabra o una de las que se confunden.
function buildContrast(w) {
  const aid = w.rescueAid;
  if (!aid?.confusables?.length) return [];
  const words = [w.word, ...aid.confusables.map(c => c.word)];
  const stem = x => { const n = normalize(x); return n.length > 4 && /[ey]$/.test(n) ? n.slice(0, -1) : n; };
  return shuffle((aid.contrast || []).map(c => {
    const a = normalize(c.answer);
    const answer = words.find(x => normalize(x) === a) || words.find(x => a.startsWith(stem(x)));
    return answer ? { sentence: c.sentence, fill: c.answer, answer, options: shuffle(words), chosen: null } : null;
  }).filter(Boolean));
}

// Termina el rescate: guarda el truco (el propio tiene prioridad) y practica la palabra enseguida.
function finishRescue(w, ex) {
  const s = state.ui.session;
  const note = (ex.note || '').trim();
  if (note) w.mnemonic = note;
  else if (w.rescueAid?.mnemonic) w.mnemonic = w.rescueAid.mnemonic;
  w.rescue = { at: Date.now(), lapses: w.srs.lapses, own: !!note };
  persist();
  s.rescued[w.id] = true;
  s.ex = makeExercise(w);
}

// Primera vez que se estudia: cuenta para la meta diaria de su modo.
function markIntroduced(w, now = Date.now()) {
  if (w.introducedAt) return;
  w.introducedAt = now;
  const mode = wordMode(w);
  const st = state.data.stats;
  const today = dateKey(now);
  if (st.newIntroduced.date !== today) st.newIntroduced = emptyIntroduced(today);
  st.newIntroduced[mode] = (st.newIntroduced[mode] || 0) + 1;
  const s = state.ui.session;
  if (s) {
    s.stats.newWords++;
    if (mode === 'intensive') s.learn[w.id] = 0; // entra en pasos de aprendizaje
  }
}

/* Aplica el resultado de un ejercicio a la palabra: pasos de aprendizaje,
   scheduler, etapa, días de acierto y estado aprendida/dominada. */
function finishItem(w, grade, delta, { requeue = false, exType = 0 } = {}) {
  const now = Date.now();
  const s = state.ui.session;
  const mode = wordMode(w);
  const success = grade !== 'again';
  markIntroduced(w, now);
  if (s && mode === 'intensive') s.intensiveSeen[w.id] = true;

  if (s && mode === 'intensive' && s.learn[w.id] !== undefined) {
    if (success) {
      const step = s.learn[w.id];
      if (step < LEARNING_GAPS.length) {
        s.learn[w.id] = step + 1;
        w.srs = { ...w.srs, due: now };
        requeueWord(s, w.id, LEARNING_GAPS[step]);
      } else {
        delete s.learn[w.id]; // terminó los pasos: pasa a repeticiones por días
        w.srs = scheduleReview(w.srs, grade, now);
      }
    } else {
      s.learn[w.id] = 0;
      w.srs = scheduleReview(w.srs, 'again', now);
      requeueWord(s, w.id, 2);
    }
    requeue = false;
  } else {
    w.srs = scheduleReview(w.srs, grade, now, mode === 'relaxed' ? 'relaxed' : 'standard');
  }

  // En relajado la palabra no baja de reconocimiento: el objetivo es reconocerla al leer.
  w.stage = mode === 'relaxed' ? Math.max(2, w.stage) : nextStage(w.stage, delta);
  if (success) {
    addDay(w.successDays, now);
    if (exType === 2 || exType === 3 || exType === 7) addDay(w.recogDays, now);
  }
  if (isLeech(w) && !w.leechAt) w.leechAt = now;
  trackHard(s, w, grade);
  updateLearnedStatus(w);
  w.lastReviewedAt = now;
  recordActivity(state.data.stats, now);
  persist();
  if (s) {
    s.stats[delta > 0 ? 'correct' : delta < 0 ? 'wrong' : 'almost']++;
    if (requeue) requeueWord(s, w.id);
    // Fijada: tras acertarla vuelve una vez más en la sesión.
    else if (success && w.pinned && !s.pinAgain[w.id]) { s.pinAgain[w.id] = true; requeueWord(s, w.id, 5); }
  }
}

/* Aprendida = 2 aciertos de reconocimiento en días distintos (sube la cobertura).
   Dominada: intensivo = superó todas las etapas con aciertos en 2+ días;
   clásico = etapa 5 con intervalo de 21+ días. Ambas pasan al vocabulario global. */
function updateLearnedStatus(w) {
  // Se marca el lema del libro y la forma de diccionario (pueden diferir: "thriving" / "thrive").
  const keys = [...new Set([lemmaOf(w), normalize(w.word)])];
  if (!w.learnedAt && w.recogDays.length >= 2) {
    w.learnedAt = Date.now();
    keys.forEach(k => libMarkKnown(k, 'learned', 'study'));
    if (w.pinned) {
      w.pinned = false;   // cumplió su objetivo: ya está aprendida
      toast(`«${w.word}» ya está aprendida: se quitó de fijadas ★`);
    }
  }
  const mode = wordMode(w);
  const mastered = mode === 'intensive' ? w.passedFinal && w.successDays.length >= 2
    : mode === 'classic' ? w.stage === 5 && w.srs.interval >= MASTERED_INTERVAL : false;
  if (!w.masteredAt && mastered) {
    w.masteredAt = Date.now();
    keys.forEach(k => libMarkKnown(k, 'mastered', 'study'));
  }
  // Palabra difícil vencida: acertada en 2 días distintos después de volverse leech.
  if (w.leechAt && !w.leechBeatenAt && w.successDays.filter(d => d > dateKey(w.leechAt)).length >= 2) w.leechBeatenAt = Date.now();
}

function saveSentence(w, text, verdict, natural = '') {
  if (!text) return;
  w.sentences.unshift({ text, verdict, natural, at: Date.now() });
  w.sentences = w.sentences.slice(0, 10);
}

/* ---------- Quiz: minitest de sesión, prueba final y verificación ---------- */

// Cada pregunta guarda la palabra completa (puede ser temporal, como en la verificación).
function buildQuiz(words, { size = 10, context = 'final', title = 'Prueba', segId = null, kinds = ['mc', 'typed', 'cloze'] } = {}) {
  const questions = shuffle(words).slice(0, size).map(w => {
    const q = { w, kind: kinds[Math.floor(Math.random() * kinds.length)], input: '', answered: false, ok: null };
    if (q.kind === 'cloze') { q.cloze = buildCloze(w); if (!q.cloze) q.kind = 'typed'; }
    if (q.kind === 'typed' && !w.translation) q.kind = 'mc';
    if (q.kind === 'mc') q.options = buildOptions(w);
    return q;
  });
  return { questions, pos: 0, done: false, context, title, segId, startedAt: Date.now() };
}
const quizScore = q => q.questions.filter(x => x.ok).length;
