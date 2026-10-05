'use strict';
/* Scheduler de repetición espaciada (función pura). */

/* ===================== 4. Scheduler: FSRS ===================== */

/* FSRS-5 (Free Spaced Repetition Scheduler, el que usa Anki moderno) con sus
   parámetros por defecto. Cada palabra tiene:
   - estabilidad S: días hasta que la probabilidad de recordarla baja al 90 %;
   - dificultad D: de 1 (fácil) a 10 (difícil);
   y el siguiente repaso se agenda cuando la retención estimada baja a la deseada. */
const FSRS_W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const FSRS_DECAY = -0.5;
const FSRS_FACTOR = 19 / 81;   // con este factor, la retención a los S días es exactamente 90 %
const FSRS_MAX_INTERVAL = 3650;
// Retención deseada: el modo relajado acepta olvidar un poco más a cambio de menos repasos.
const FSRS_RETENTION = { standard: 0.9, relaxed: 0.87 };
const GRADE_N = { again: 1, hard: 2, good: 3, easy: 4 };

const round4 = n => Math.round(n * 1e4) / 1e4;
const clampD = d => Math.min(10, Math.max(1, d));
// Probabilidad de recordar tras `days` días con estabilidad s.
const fsrsRetrievability = (days, s) => Math.pow(1 + (FSRS_FACTOR * days) / s, FSRS_DECAY);
const fsrsInterval = (s, retention) =>
  Math.min(FSRS_MAX_INTERVAL, Math.max(1, Math.round((s / FSRS_FACTOR) * (Math.pow(retention, 1 / FSRS_DECAY) - 1))));
const initStability = g => Math.max(0.1, FSRS_W[g - 1]);
const initDifficulty = g => clampD(FSRS_W[4] - Math.exp(FSRS_W[5] * (g - 1)) + 1);

function nextDifficulty(d, g) {
  const next = d - FSRS_W[6] * (g - 3) * ((10 - d) / 9);                 // cambio amortiguado cerca de 10
  return clampD(FSRS_W[7] * initDifficulty(4) + (1 - FSRS_W[7]) * next); // ligera vuelta a la media
}
function stabilityAfterRecall(d, s, r, g) {
  const hard = g === 2 ? FSRS_W[15] : 1, easy = g === 4 ? FSRS_W[16] : 1;
  return s * (1 + Math.exp(FSRS_W[8]) * (11 - d) * Math.pow(s, -FSRS_W[9]) * (Math.exp(FSRS_W[10] * (1 - r)) - 1) * hard * easy);
}
function stabilityAfterLapse(d, s, r) {
  const forget = FSRS_W[11] * Math.pow(d, -FSRS_W[12]) * (Math.pow(s + 1, FSRS_W[13]) - 1) * Math.exp(FSRS_W[14] * (1 - r));
  return Math.min(forget, s);
}
// Repasos del mismo día (pasos de aprendizaje y fallos recientes).
const stabilityShortTerm = (s, g) => s * Math.exp(FSRS_W[17] * (g - 3 + FSRS_W[18]));

// Datos guardados con el scheduler anterior (SM-2: ease/interval) → estabilidad y dificultad.
function fromLegacy(srs, now) {
  if (srs.stability > 0) return srs;
  if (!srs.reps && !srs.interval && !srs.lapses && srs.last == null) return { ...srs, stability: 0 };
  const interval = srs.interval || 0;
  return {
    ...srs,
    stability: Math.max(0.5, interval),
    difficulty: clampD(5 + (2.5 - (srs.ease ?? 2.5)) * 3.3),
    last: srs.last ?? (srs.due != null ? srs.due - interval * DAY : now),
  };
}

/**
 * Calcula el siguiente estado de repetición espaciada. Función PURA: no lee ni
 * modifica nada fuera de sus argumentos.
 *
 * @param {{stability:number, difficulty:number, interval:number, reps:number, lapses:number, due:number|null, last:number|null}} srs
 * @param {'again'|'hard'|'good'|'easy'} grade
 * @param {number} now  timestamp en ms
 * @param {'standard'|'relaxed'} profile  "relaxed" es la versión suave: un fallo no
 *        hace repetir en minutos sino mañana, y apunta a una retención algo menor.
 */
function scheduleReview(srs, grade, now = Date.now(), profile = 'standard') {
  const cur = fromLegacy({ ...newSrs(), ...srs }, now);
  const g = GRADE_N[grade] || 3;
  const relaxed = profile === 'relaxed';
  let s, d;
  if (!cur.stability) {
    s = initStability(g);
    d = initDifficulty(g);
  } else {
    const last = cur.last ?? now;
    d = nextDifficulty(cur.difficulty, g);
    if (startOfDay(now) === startOfDay(last)) {
      s = stabilityShortTerm(cur.stability, g);
    } else {
      const r = fsrsRetrievability(Math.max(0, (now - last) / DAY), cur.stability);
      s = g === 1 ? stabilityAfterLapse(cur.difficulty, cur.stability, r) : stabilityAfterRecall(cur.difficulty, cur.stability, r, g);
    }
  }
  const base = { stability: round4(Math.max(0.1, s)), difficulty: round4(d), reps: cur.reps + 1, last: now };
  if (g === 1) {
    return { ...base, interval: relaxed ? 1 : 0, lapses: cur.lapses + 1, due: relaxed ? startOfDay(addDays(now, 1)) : now + 10 * MINUTE };
  }
  const interval = fsrsInterval(base.stability, FSRS_RETENTION[profile] || 0.9);
  // La palabra vence al inicio del día correspondiente, no a la hora exacta.
  return { ...base, interval, lapses: cur.lapses, due: startOfDay(addDays(now, interval)) };
}

// Probabilidad estimada de recordar la palabra ahora (0-1), o null si nunca se repasó.
function recallChance(srs, now = Date.now()) {
  const cur = fromLegacy({ ...newSrs(), ...srs }, now);
  if (!cur.stability || cur.last == null) return null;
  return fsrsRetrievability(Math.max(0, (now - cur.last) / DAY), cur.stability);
}
