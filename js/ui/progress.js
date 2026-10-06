'use strict';
/* UI: Tu camino (nivel, historia, roadmap y logros). */

/* ---------- Progreso: tu camino ---------- */

// Niveles del roadmap según las palabras aprendidas (umbral `at`).
const LEVELS = [
  { at: 0, name: 'First Steps', desc: 'Todo gran camino empieza con una palabra.' },
  { at: 5, name: 'Spark', desc: 'Tus primeras palabras ya son tuyas.' },
  { at: 15, name: 'Explorer', desc: 'Empiezas a reconocer palabras por todas partes.' },
  { at: 30, name: 'Word Collector', desc: 'Tu vocabulario empieza a tomar forma.' },
  { at: 60, name: 'Rising Reader', desc: 'Los textos se sienten un poco más claros cada semana.' },
  { at: 100, name: 'Storyteller', desc: 'Cien palabras: ya tienes material para contar historias.' },
  { at: 250, name: 'Conversationalist', desc: 'Más palabras para charlar con soltura.' },
  { at: 500, name: 'Fluent Mind', desc: 'Lees con menos pausas y más disfrute.' },
  { at: 1000, name: 'Word Master', desc: 'Mil palabras aprendidas. Impresionante.' },
  { at: 2000, name: 'Legend', desc: 'Tu inglés juega en otra liga.' },
];
const levelIndex = n => LEVELS.reduce((idx, l, i) => (n >= l.at ? i : idx), 0);
const shortDate = ts => new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });

// Racha más larga en el historial guardado (para datos de antes de que existiera bestStreak).
function longestRun(history) {
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(history).filter(k => history[k] > 0).sort()) {
    run = prev && dateKey(addDays(new Date(`${prev}T12:00`).getTime(), 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

function progressData() {
  const { words, stats, settings } = state.data;
  const now = Date.now();
  const learnedWords = words.filter(isLearned);
  const learnedDates = learnedWords.map(w => w.learnedAt || w.masteredAt).filter(Boolean).sort((a, b) => a - b);
  // Días estudiados: historial (últimos 60 días) + días con aciertos de cada palabra.
  const days = new Set(Object.keys(stats.history).filter(k => stats.history[k] > 0));
  for (const w of words) w.successDays.forEach(d => days.add(d));
  return {
    now, learnedDates,
    learned: learnedWords.length,
    mastered: words.filter(isMastered).length,
    introduced: words.filter(w => !isNew(w)).length,
    sentences: words.reduce((n, w) => n + w.sentences.length, 0),
    studyDays: days.size,
    bestStreak: Math.max(stats.bestStreak || 0, currentStreak(stats, now), longestRun(stats.history)),
    segments: state.lib.segments.length,
    readySegs: state.lib.segments.filter(seg => segmentCoverage(seg) >= settings.coverageTarget).length,
  };
}

function achievementList(p) {
  return [
    { icon: 'sparkle', name: 'Primer paso', desc: 'Estudia tu primera palabra', cur: p.introduced, goal: 1 },
    { icon: 'flame', name: 'En llamas', desc: 'Racha de 3 días', cur: p.bestStreak, goal: 3 },
    { icon: 'check', name: 'Diez de diez', desc: 'Aprende 10 palabras', cur: p.learned, goal: 10 },
    { icon: 'edit', name: 'Escritor', desc: 'Escribe 10 oraciones', cur: p.sentences, goal: 10 },
    { icon: 'book', name: 'Lector', desc: 'Prepara tu primera lectura', cur: p.segments, goal: 1 },
    { icon: 'flame', name: 'Semana perfecta', desc: 'Racha de 7 días', cur: p.bestStreak, goal: 7 },
    { icon: 'target', name: 'Listo para leer', desc: 'Conoce casi todas las palabras de una lectura antes de leerla', cur: p.readySegs, goal: 1 },
    { icon: 'star', name: 'Dominio', desc: 'Domina 10 palabras', cur: p.mastered, goal: 10 },
    { icon: 'bolt', name: 'Constancia', desc: 'Estudia 30 días distintos', cur: p.studyDays, goal: 30 },
    { icon: 'flame', name: 'Imparable', desc: 'Racha de 30 días', cur: p.bestStreak, goal: 30 },
    { icon: 'trophy', name: 'Centenario', desc: 'Aprende 100 palabras', cur: p.learned, goal: 100 },
    { icon: 'crown', name: 'Leyenda', desc: 'Aprende 1000 palabras', cur: p.learned, goal: 1000 },
  ];
}

/* ---------- Tu historia: momentos con fecha ---------- */

const LEARN_MARKS = [1, 10, 25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000];
const MASTER_MARKS = [1, 10, 25, 50, 100, 250, 500];
const LEECH_MARKS = [1, 5, 10, 25, 50];
const SENTENCE_MARKS = [1, 10, 50, 100, 250];
const READING_MARKS = [1, 5, 10, 25];
const STREAK_TEXT = { 3: 'Tres días seguidos: ya es un hábito en marcha.', 7: 'Una semana entera sin fallar.', 14: 'Dos semanas de constancia.', 30: 'Un mes completo. Impresionante.' };

/* Hitos sacados de las palabras, las lecturas y los logros guardados.
   Cada uno: { at, kind, icon, title, detail?, words? }. Orden cronológico. */
function storyEvents() {
  const { words, stats } = state.data;
  const ev = [];
  const chips = ws => ws.map(w => ({ word: w.word, meaning: firstMeaning(w.translation) }));
  // Hitos de conteo: el n-ésimo elemento pone la fecha; `items` son los del tramo desde el hito anterior.
  const marks = (list, at, steps, make) => {
    const sorted = list.filter(x => at(x)).sort((a, b) => at(a) - at(b));
    let prev = 0;
    for (const n of steps) {
      if (sorted.length < n) break;
      ev.push({ at: at(sorted[n - 1]), ...make(n, sorted.slice(prev, n), sorted[n - 1]) });
      prev = n;
    }
  };

  // Primer día (las palabras de ejemplo traen una fecha anterior a su creación y no cuentan).
  const real = words.filter(w => w.introducedAt && w.introducedAt >= w.createdAt - MINUTE);
  const starts = [...real.map(w => w.introducedAt), ...state.lib.segments.map(sg => sg.createdAt)].filter(Boolean);
  if (!starts.length) return ev;
  const first = Math.min(...starts);
  const firstWords = real.filter(w => dateKey(w.introducedAt) === dateKey(first));
  ev.push({ at: first, kind: 'start', icon: 'sparkle', title: 'Tu primer día en Realize',
    detail: firstWords.length ? `Conociste ${plural(firstWords.length, 'palabra nueva', 'palabras nuevas')}. Aquí empezó todo.` : 'Aquí empezó todo.',
    words: chips(firstWords) });

  marks(words, w => w.learnedAt, LEARN_MARKS, (n, ws, last) => (n === 1
    ? { kind: 'learn', icon: 'check', title: `Aprendiste tu primera palabra: «${last.word}»`, detail: 'La reconociste en dos días distintos. Ya es tuya.' }
    : { kind: 'learn', icon: 'check', title: `Aprendiste ${n} palabras`, detail: `${plural(ws.length, 'palabra nueva', 'palabras nuevas')} desde tu último hito.`, words: chips(ws) }));

  marks(words, w => w.masteredAt, MASTER_MARKS, (n, ws, last) => (n === 1
    ? { kind: 'master', icon: 'star', title: `Dominaste tu primera palabra: «${last.word}»`, detail: 'Ya no solo la reconoces: la usas.' }
    : { kind: 'master', icon: 'star', title: `Dominaste ${n} palabras`, detail: 'Las recuerdas y las usas sin pensarlo.', words: chips(ws) }));

  // Palabras difíciles (leech) vencidas; las de antes de guardar la fecha cuentan al dominarlas.
  marks(words, w => w.leechBeatenAt || (isLeech(w) && w.masteredAt) || 0, LEECH_MARKS, (n, ws, last) => (n === 1
    ? { kind: 'leech', icon: 'bolt', title: `Venciste tu primera palabra difícil: «${last.word}»`, detail: `Te costó ${plural(last.srs.lapses, 'intento fallido', 'intentos fallidos')}, pero no te rendiste.` }
    : { kind: 'leech', icon: 'bolt', title: `Te deshiciste de ${n} palabras difíciles`, detail: 'Palabras que se te resistían y que ahora aciertas.', words: chips(ws) }));

  const sentences = words.flatMap(w => w.sentences.filter(x => x.at));
  marks(sentences, x => x.at, SENTENCE_MARKS, (n, xs, last) => (n === 1
    ? { kind: 'write', icon: 'edit', title: 'Escribiste tu primera oración en inglés', detail: `«${last.text}»` }
    : { kind: 'write', icon: 'edit', title: `Escribiste ${n} oraciones`, detail: 'Cada oración fija mejor las palabras en tu memoria.' }));

  marks(state.lib.segments, sg => sg.createdAt, READING_MARKS, (n, sgs, last) => (n === 1
    ? { kind: 'read', icon: 'book', title: `Preparaste tu primera lectura: «${last.title}»`, detail: 'Elegiste algo real para leer en inglés.' }
    : { kind: 'read', icon: 'book', title: `Preparaste ${n} lecturas`, detail: sgs.map(sg => `«${sg.title}»`).join(', ') }));

  // Pruebas finales de lectura sin errores (la primera de cada segmento).
  for (const sg of state.lib.segments) {
    const t = (sg.tests || []).find(x => x.total >= 5 && x.score === x.total);
    if (t) ev.push({ at: t.at, kind: 'read', icon: 'target', title: `Completaste «${sg.title}» sin errores`, detail: `${t.score} de ${t.total} en la prueba final de la lectura.` });
  }

  for (const [key, at] of Object.entries(stats.feats || {})) {
    const [type, num] = key.split('-');
    const n = Number(num);
    if (type === 'streak') ev.push({ at, kind: 'streak', icon: 'flame', title: `Racha de ${n} días`, detail: STREAK_TEXT[n] || `${n} días seguidos estudiando.` });
    else if (type === 'sessions') ev.push({ at, kind: 'session', icon: 'trophy', title: n === 1 ? 'Completaste tu primera sesión' : `Completaste ${n} sesiones`, detail: n === 1 ? 'De principio a fin, sin atajos.' : 'Sesión tras sesión, sin dejarlas a medias.' });
    else if (key === 'perfect-session') ev.push({ at, kind: 'master', icon: 'crown', title: 'Sesión perfecta', detail: '10 o más ejercicios sin un solo fallo.' });
    else if (key === 'freeze-earned') ev.push({ at, kind: 'streak', icon: 'shield', title: 'Ganaste tu primer protector de racha', detail: `${FREEZE_EVERY} días seguidos. Si un día fallas, tu racha sigue a salvo.` });
    else if (key === 'freeze-used') ev.push({ at, kind: 'streak', icon: 'shield', title: 'Tu protector salvó tu racha', detail: 'Un día sin estudiar no borró todo tu esfuerzo.' });
  }
  return ev.sort((a, b) => a.at - b.at);
}

function storyHTML(p) {
  const ev = storyEvents();
  const next = LEARN_MARKS.find(n => n > p.learned);
  const nextNode = i => `<li class="story-node is-next" style="--i:${i}">
      <span class="story-dot">${icon('route', 18)}</span>
      <div class="story-body"><span class="story-meta">Lo que sigue</span>
        <b class="story-title">${!ev.length ? 'Tu historia empieza con tu primera sesión' : next ? `Aprende ${plural(next - p.learned, 'palabra más', 'palabras más')} para llegar a ${next}` : 'Sigue escribiendo tu historia'}</b>
        ${!ev.length ? '<a class="btn btn-primary btn-sm" style="align-self:flex-start;margin-top:8px" href="#/estudiar/diario">Empezar ahora</a>' : ''}
      </div>
    </li>`;
  const first = ev[0]?.at;
  const nodes = ev.map((e, i) => {
    const day = Math.round((startOfDay(e.at) - startOfDay(first)) / DAY) + 1;
    const n = e.words?.length || 0;
    return `<li class="story-node${i === ev.length - 1 ? ' is-latest' : ''}" data-kind="${e.kind}" style="--i:${i}">
      <span class="story-dot">${icon(e.icon, 18)}</span>
      <div class="story-body">
        <span class="story-meta">Día ${day} · ${shortDate(e.at)}</span>
        <b class="story-title">${esc(e.title)}</b>
        ${e.detail ? `<span class="story-detail">${esc(e.detail)}</span>` : ''}
        ${n ? `<button type="button" class="story-peek" data-action="toggle-story" aria-expanded="false">${icon('list', 14)}<span>${n === 1 ? 'Ver la palabra' : `Ver las ${n} palabras`}</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="story-words"><div class="story-words-inner">${e.words.slice(0, 40).map((w, j) => `<span class="story-chip" style="--j:${j}"><b>${esc(w.word)}</b>${w.meaning ? `<span>${esc(w.meaning)}</span>` : ''}</span>`).join('')}${n > 40 ? `<span class="story-chip" style="--j:40">y ${n - 40} más</span>` : ''}</div></div>` : ''}
      </div>
    </li>`;
  }).join('');
  return `<section class="card stack">
      <div class="row between"><h2>Tu historia</h2>${ev.length ? `<span class="muted small">${plural(ev.length, 'momento', 'momentos')}</span>` : ''}</div>
      <ol class="story">${nodes}${nextNode(ev.length)}</ol>
    </section>`;
}

function renderProgress() {
  const p = progressData();
  const li = levelIndex(p.learned);
  const lvl = LEVELS[li], next = LEVELS[li + 1];
  const pct = next ? (p.learned - lvl.at) / (next.at - lvl.at) : 1;
  const C = 2 * Math.PI * 52;
  const ach = achievementList(p);
  const unlocked = ach.filter(a => a.cur >= a.goal).length;
  const tile = (n, label) => `<div class="journey-stat"><b data-count="${n}">${n}</b><span>${label}</span></div>`;

  const nodes = LEVELS.map((l, i) => {
    const st = i < li ? 'done' : i === li ? 'current' : 'locked';
    const reached = l.at === 0 ? p.learnedDates[0] || null : p.learnedDates[l.at - 1];
    const seg = i < li ? 1 : i === li ? pct : 0;   // tramo de línea hacia el siguiente nivel
    const meta = st === 'locked' ? `${plural(l.at, 'palabra', 'palabras')} · faltan ${l.at - p.learned}`
      : `${l.at ? plural(l.at, 'palabra', 'palabras') : 'Inicio'}${reached && st === 'done' ? ` · ${shortDate(reached)}` : ''}`;
    return `<li class="rm-node ${st}" style="--i:${i};--seg:${seg.toFixed(3)}">
      <span class="rm-dot">${icon(st === 'done' ? 'check' : st === 'current' ? 'star' : 'lock', st === 'current' ? 22 : 18)}</span>
      <div class="rm-body">
        <span class="rm-meta">${meta}</span>
        <b class="rm-name">${l.name}</b>
        <span class="rm-desc">${l.desc}</span>
        ${st === 'current' ? `<span class="rm-here">Estás aquí</span>${next ? `<div class="rm-bar"><div style="width:${Math.round(pct * 100)}%"></div></div>` : ''}` : ''}
      </div>
    </li>`;
  }).join('');

  return `
  <div class="page-head"><span class="muted small">Tu aprendizaje</span><h1>Tu camino</h1></div>

  <section class="journey-hero">
    <div class="journey-stars" aria-hidden="true"></div>
    <div class="journey-ring">
      <svg width="140" height="140" viewBox="0 0 120 120" aria-hidden="true">
        <defs><linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style="stop-color:var(--fire-1)"/><stop offset="1" style="stop-color:#F472B6"/>
        </linearGradient></defs>
        <circle cx="60" cy="60" r="52" class="ring-track"/>
        <circle cx="60" cy="60" r="52" class="ring-fill" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - pct)).toFixed(1)}"/>
      </svg>
      <div class="journey-ring-text"><b data-count="${p.learned}">${p.learned}</b><span>aprendidas</span></div>
    </div>
    <div class="journey-info">
      <span class="journey-level">Nivel ${li + 1} de ${LEVELS.length}</span>
      <h2 class="journey-name">${lvl.name}</h2>
      <p class="journey-desc">${lvl.desc}</p>
      <p class="journey-next">${next ? `Te ${next.at - p.learned === 1 ? 'falta' : 'faltan'} <b>${plural(next.at - p.learned, 'palabra', 'palabras')}</b> para <b>${next.name}</b>` : 'Llegaste a la cima del camino.'}</p>
    </div>
    <div class="journey-stats">
      ${tile(p.studyDays, 'Días estudiando')}${tile(p.bestStreak, 'Mejor racha')}${tile(p.sentences, 'Oraciones escritas')}${tile(p.mastered, 'Dominadas')}
    </div>
  </section>

  <div class="split tight">
    <div class="col-main stack-lg">
      ${storyHTML(p)}
      <section class="card stack">
        <div class="row between"><h2>Tu roadmap</h2><span class="chip chip-accent">${icon('route', 14)} Nivel ${li + 1}</span></div>
        <ol class="roadmap">${nodes}</ol>
      </section>
    </div>
    <div class="col-side stack-lg">
      <section class="card stack">
        <div class="row between"><h2>Logros</h2><span class="muted small">${unlocked} de ${ach.length}</span></div>
        <div class="badges">${ach.map((a, i) => {
          const on = a.cur >= a.goal;
          return `<div class="badge ${on ? 'on' : ''}" style="--i:${i}" title="${a.desc}">
            <span class="badge-icon">${icon(on ? a.icon : 'lock', 22)}</span>
            <b>${a.name}</b>
            <span>${on ? a.desc : `${Math.min(a.cur, a.goal)} / ${a.goal}`}</span>
          </div>`;
        }).join('')}</div>
      </section>
    </div>
  </div>`;
}
