'use strict';
/* UI: Inicio y tarjeta de racha. */

/* ---------- Inicio ---------- */

// Muchas palabras nuevas esperando su turno: se avisa cuántos días tardarán a tu ritmo, para que
// no parezca que "debes" hacerlo todo ya. Vuelve a salir solo si la cola crece.
const BACKLOG_MIN = 40;
function backlogBanner(now = Date.now()) {
  const queued = state.data.words.filter(w => isNew(w) && isStudyReady(w));
  if (queued.length < BACKLOG_MIN || isDismissed('backlog', queued.length)) return '';
  const perMode = {};
  for (const w of queued) perMode[wordMode(w)] = (perMode[wordMode(w)] || 0) + 1;
  const days = Math.max(...Object.entries(perMode).map(([m, n]) => Math.ceil(n / Math.max(1, dailyLimit(m)))));
  return banner('info', `Tienes ${plural(queued.length, 'palabra nueva', 'palabras nuevas')} en espera`,
    `Con tu ritmo diario tardarás unos ${plural(days, 'día', 'días')} en verlas todas. No hace falta apurarse: lo importante es repasar cada día. En una lectura puedes elegir solo las más importantes.`,
    '<div class="actions"><a class="btn btn-secondary btn-sm" href="#/palabras" data-action="filter-new">Ver las nuevas</a></div>', 'backlog', queued.length);
}

// Lo que trae la sesión de hoy: repasos pendientes, nuevas que caben en la meta y fijadas extra.
function dailyPlan(now = Date.now()) {
  const ready = state.data.words.filter(isStudyReady);
  const dueIds = ready.filter(w => isDueToday(w, now)).map(w => w.id);
  const slots = { classic: remainingNew('classic', now), relaxed: remainingNew('relaxed', now), intensive: remainingNew('intensive', now) };
  const freshIds = new Set();
  for (const w of ready.filter(isNew)) { const m = wordMode(w); if (slots[m] > 0) { slots[m]--; freshIds.add(w.id); } }
  const pinned = pinnedExtra(ready, new Set([...dueIds, ...freshIds])).length;
  return { due: dueIds.length, newAvail: freshIds.size, pinned, total: dueIds.length + freshIds.size + pinned };
}

function renderHome() {
  const { words, settings, stats } = state.data;
  const now = Date.now();
  const ready = words.filter(isStudyReady);
  const { due, newAvail, pinned, total } = dailyPlan(now);
  const waiting = words.filter(w => !isStudyReady(w)).length;
  const backup = backupReminder(now);
  const learning = words.filter(w => !isNew(w) && !isLearned(w)).length;
  const learnedCount = words.filter(isLearned).length;
  const leeches = words.filter(isLeech).length;
  const mastered = words.filter(isMastered).length;
  const upcoming = ready.filter(w => !isNew(w)).sort((a, b) => (a.srs.due ?? Infinity) - (b.srs.due ?? Infinity)).slice(0, 5);
  const segs = state.lib.segments.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);

  const days = Array.from({ length: 7 }, (_, i) => {
    const ts = addDays(now, i - 6);
    return { label: 'DLMXJVS'[new Date(ts).getDay()], count: stats.history[dateKey(ts)] || 0, today: i === 6 };
  });
  const max = Math.max(1, ...days.map(d => d.count));

  return `
  <div class="home">
  <div class="home-main">
  <div class="page-head"><span class="muted small">Hoy</span><h1>Tu práctica</h1></div>

  ${aiBanner()}
  ${backup ? banner('info', backup.never ? 'Haz tu primer respaldo' : `Hace ${backup.days} días de tu último respaldo`,
    backup.never ? 'Tu progreso solo vive en este navegador: si se borran sus datos, se pierde. Descarga una copia en un archivo.' : 'Descarga una copia nueva para no perder lo que avanzaste desde entonces.',
    `<div class="actions"><button type="button" class="btn btn-dark btn-sm" data-action="export">${icon('download', 18)}<span>Descargar respaldo</span></button></div>`, 'backup') : ''}
  ${backlogBanner(now)}
  ${waiting && !isDismissed('waiting', waiting) ? banner('warn', `${plural(waiting, 'palabra espera', 'palabras esperan')} su significado`,
    'No entran a las sesiones hasta tener traducción o definición.',
    `<div class="actions">${hasKey() ? `<button type="button" class="btn btn-dark btn-sm" data-action="enrich-pending" ${state.ui.enrichBusy ? 'disabled' : ''}>${state.ui.enrichBusy ? `<span class="spinner"></span><span>${esc(state.ui.enrichBusy)}</span>` : `${icon('sparkle', 18)}<span>Enriquecer con IA</span>`}</button>` : ''}
      <a class="btn btn-secondary btn-sm" href="#/palabras" data-action="filter-noai">Ver palabras</a></div>`, 'waiting', waiting) : ''}

  <div class="split tight">
    <div class="hero">
      <div class="stack-xs hero-text">
        <span class="hero-label">Para repasar hoy</span>
        <span class="hero-number">${total ? plural(total, 'palabra', 'palabras') : '¡Todo al día!'}</span>
        <span class="hero-sub">${total ? `Unos ${Math.max(1, Math.round(total * 0.75))} minutos · ${plural(newAvail, 'nueva', 'nuevas')}, ${due} de repaso${pinned ? `, ${plural(pinned, 'fijada', 'fijadas')}` : ''}` : 'No tienes repasos pendientes. Agrega palabras o prepara una lectura.'}</span>
      </div>
      ${total
        ? '<button class="btn btn-hero" data-action="start-session">Estudiar</button>'
        : '<a class="btn btn-hero" href="#/lecturas">Preparar una lectura</a>'}
    </div>
    <div class="stat-grid four">
      <div class="stat"><b>${words.filter(isNew).length}</b><span>Nuevas</span></div>
      <div class="stat"><b>${learning}</b><span>Aprendiendo</span></div>
      <div class="stat ok"><b>${learnedCount}</b><span>Aprendidas</span></div>
      <div class="stat leech" title="Palabras que has fallado 5 veces o más"><b>${leeches}</b><span>Difíciles</span></div>
    </div>
  </div>

  ${segs.length ? `<div class="card stack-sm">
    <div class="row between"><h2>Tus lecturas</h2><a class="btn-link" href="#/lecturas">Ver todas</a></div>
    ${segs.map(seg => {
      const book = state.lib.books.find(b => b.id === seg.bookId);
      const p = segmentCoverage(seg);
      return `<a class="seg-row" href="#/segmento/${seg.id}">
        <span class="stack-xs grow"><b>${esc(seg.title)}</b><span class="muted small">${esc(book?.title || '')}</span></span>
        <span class="seg-cov">${p >= settings.coverageTarget ? '<span class="chip chip-ok">Listo para leer</span>' : ''}<b>${fmtPct(p)}</b></span>
        <span class="seg-bar">${coverageBar(seg, { compact: true })}</span>
      </a>`;
    }).join('')}
  </div>` : ''}

  <div class="split tight">
    <div class="card col-main stack-xs">
      <div class="row between" style="padding-bottom:8px"><h2>Próximos repasos</h2><span class="muted small">${plural(words.length, 'palabra', 'palabras')} · ${mastered} dominadas</span></div>
      ${upcoming.length ? upcoming.map(w => `
        <div class="upcoming-row">
          <div class="stack-xs"><span class="row gap-sm"><span class="list-word">${esc(w.word)}</span>${leechBadge(w)}</span><span class="muted small">${esc(w.translation)}</span></div>
          <span class="chip ${isDueToday(w, now) ? 'chip-accent' : ''}">${STAGES[w.stage]} · ${formatDue(w, now)}</span>
        </div>`).join('') : '<p class="muted">Todavía no has empezado a estudiar ninguna palabra.</p>'}
    </div>
    <div class="card col-side stack">
      <h2>Palabras repasadas esta semana</h2>
      <div class="chart" role="img" aria-label="Repasos de los últimos 7 días: ${days.map(d => d.count).join(', ')}">
        ${days.map(d => `<div class="bar ${d.today ? 'today' : ''} ${d.count ? '' : 'empty'}" style="height:${Math.max(6, (d.count / max) * 100)}%" title="${d.count} repasos"></div>`).join('')}
      </div>
      <div class="chart-labels">${days.map(d => `<span class="${d.today ? 'today' : ''}">${d.label}</span>`).join('')}</div>
    </div>
  </div>
  </div>
  <aside class="home-aside">${streakCard(stats, now)}</aside>
  </div>`;
}

/* ---------- Racha ---------- */

// Frases que acompañan la racha. Se elige una por día para que no cambie en cada render.
const START_QUOTES = [
  'Every big journey starts with a single step.',
  'Today is a great day to start a new streak.',
  'Every expert was once a beginner.',
  'One word today, one conversation tomorrow.',
  'You don’t have to be great to start, but you have to start to be great.',
  'The best time to start was yesterday. The next best time is now.',
  'Small steps still take you far.',
  'Every language is learned one word at a time.',
];
const KEEP_QUOTES = [
  'Consistency beats talent when talent isn’t consistent.',
  'A little every day adds up to a lot.',
  'Your future self will thank you.',
  'Don’t break the chain. Every day counts.',
  'Discipline is choosing what you want most over what you want now.',
  'Step by step, you’ll go a long way.',
  'What you do every day matters more than what you do once in a while.',
  'Learning a language is a marathon, and you’re keeping a great pace.',
  'Every review is one more brick in your English.',
  'Motivation gets you started. Habit keeps you going.',
];
const FLAME_PATH = 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z';

const dailyPick = (list, now) => list[Math.floor(new Date(now).setHours(0, 0, 0, 0) / 864e5) % list.length];

function streakCheer(n) {
  if (!n) return 'Let’s get started!';
  if (n === 1) return 'Great start!';
  if (n < 7) return 'Keep going!';
  if (n < 30) return 'You’re on fire!';
  return 'Unstoppable!';
}

function streakCard(stats, now) {
  const streak = currentStreak(stats, now);
  const quote = dailyPick(streak ? KEEP_QUOTES : START_QUOTES, now);
  return `<section class="card streak-card ${streak ? 'is-on' : 'is-off'}" aria-label="Tu racha">
    <div class="streak-hero">
      <span class="streak-flame" aria-hidden="true">
        <svg width="54" height="62" viewBox="5.5 2 13 17">
          <defs><linearGradient id="fire-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" style="stop-color:var(--fire-2)"/><stop offset="1" style="stop-color:var(--fire-1)"/>
          </linearGradient></defs>
          <path d="${FLAME_PATH}" fill="url(#fire-grad)"/>
          <path class="flame-core" d="M12 12.5c.5 1.3 2.2 2.2 2.2 4a2.2 2.2 0 0 1-4.4 0c0-1.1.7-1.8 1.2-2.3.1.9.5 1.3 1 1.3 0-1-.4-1.8 0-3z"/>
        </svg>
      </span>
      <span class="streak-num" data-count="${streak}">${streak}</span>
      <span class="streak-label">${streak === 1 ? 'día de racha' : 'días de racha'}</span>
      <span class="streak-cheer">${streakCheer(streak)}</span>
    </div>
    <p class="streak-quote">${quote}</p>
    ${streakShield(stats, streak, now)}
  </section>`;
}

// Estado del protector de racha (se gana uno cada 14 días seguidos).
function streakShield(stats, streak, now) {
  const freezes = stats.freezes || 0;
  const toNext = FREEZE_EVERY - (streak % FREEZE_EVERY);
  const text = streakProtected(stats, now) ? 'Tu protector cubre el día de ayer. Completa una sesión hoy para mantener la racha.'
    : freezes ? `${freezes === 1 ? 'Tienes 1 protector' : `Tienes ${freezes} protectores`} de racha${freezes < FREEZE_MAX ? ` · otro en ${plural(toNext, 'día', 'días')}` : ''}`
    : `Ganas un protector de racha en ${plural(toNext, 'día', 'días')}`;
  return `<div class="streak-shield ${streakProtected(stats, now) ? 'is-active' : freezes ? 'is-ready' : ''}" title="Si un día no estudias, el protector salva tu racha. Se gana uno cada ${FREEZE_EVERY} días seguidos (máximo ${FREEZE_MAX}).">
    ${icon('shield', 18)}<span>${text}</span></div>`;
}
