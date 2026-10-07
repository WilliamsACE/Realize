'use strict';
/* UI: sesión de estudio, ejercicios, resumen y quiz. */

/* ---------- Sesión de estudio ---------- */

const curWord = () => { const ex = state.ui.session?.ex; return ex ? findWord(ex.wordId) : null; };

/* Submenú de Estudiar: repaso diario (FSRS) o repaso de grupos (ui/groups.js). En el
   celular es la pantalla de la pestaña Estudiar; en escritorio también está en la barra lateral. */
function renderStudyHub() {
  const plan = dailyPlan();
  const s = state.ui.session;
  const resume = s && !s.dailyHard && !s.finished && s.done > 0 && s.queue.length > s.pos;
  const ready = groups().filter(canPractice);
  const daily = `<a class="hub-card hub-daily" href="#/estudiar/diario">
      <span class="hub-icon">${icon('repeat', 24)}</span>
      <span class="hub-kicker">Repaso diario</span>
      <span class="hub-title">${resume ? 'Sesión en curso' : plan.total ? plural(plan.total, 'palabra', 'palabras') : '¡Todo al día!'}</span>
      <span class="hub-sub">${resume ? `Llevas ${plural(s.done, 'ejercicio', 'ejercicios')}. Sigue donde lo dejaste.`
        : plan.total ? `Unos ${Math.max(1, Math.round(plan.total * 0.75))} min · ${plural(plan.newAvail, 'nueva', 'nuevas')}, ${plan.due} de repaso${plan.pinned ? `, ${plural(plan.pinned, 'fijada', 'fijadas')}` : ''}`
        : 'No tienes repasos pendientes. Puedes repasar de todas formas.'}</span>
    </a>`;
  const groupsCard = `<a class="hub-card hub-groups" href="${ready.length ? '#/estudiar/grupos' : '#/agregar/grupo'}">
      <span class="hub-deco" aria-hidden="true"><i class="t-meaning"></i><i class="t-spelling"></i><i></i></span>
      <span class="hub-icon">${icon('cards', 24)}</span>
      <span class="hub-kicker">Repaso de grupos</span>
      <span class="hub-title">${ready.length ? plural(ready.length, 'grupo', 'grupos') : 'Sin grupos aún'}</span>
      <span class="hub-sub">${ready.length ? `${plural(ready.length, 'grupo', 'grupos')} · elige uno o varios` : 'Junta palabras parecidas y practícalas juntas.'}</span>
    </a>`;
  return `
  <div class="page-head"><span class="muted small">Estudiar</span><h1>¿Qué practicamos hoy?</h1></div>
  <div class="hub">${daily}${groupsCard}${dailyHardCard()}</div>
  <section class="card hub-foot">
    <span class="icon-tile">${icon('link')}</span>
    <div class="stack-xs grow"><b>Grupos de palabras</b>
      <span class="muted small">Significado parecido → emparejar definiciones · Se escriben parecido → elegir entre cartas.</span></div>
    <div class="actions">
      <a class="btn btn-secondary btn-sm" href="#/grupos">Ver grupos</a>
      <a class="btn btn-secondary btn-sm" href="#/agregar/grupo">${icon('plus', 16)}<span>Nuevo grupo</span></a>
    </div>
  </section>`;
}

// Tarjeta de las difíciles del día (ver dailyHardIds en learning.js). Sin palabras no lleva a
// ningún lado: explica de dónde salen o celebra que ya se vencieron todas.
function dailyHardCard() {
  const ids = dailyHardIds();
  const beaten = dailyHardList().beaten.length;
  const head = `<span class="hub-icon">${icon('target', 24)}</span><span class="hub-kicker">Difíciles del día</span>`;
  if (!ids.length) {
    return `<div class="hub-card hub-hard is-empty">${head}
      <span class="hub-title">${beaten ? '¡Las venciste todas!' : 'Nada por ahora'}</span>
      <span class="hub-sub">${beaten ? `Hoy superaste ${plural(beaten, 'palabra difícil', 'palabras difíciles')}. Mañana empieza una lista nueva.`
        : 'Las palabras que falles o marques como «Difícil» en tu repaso aparecerán aquí para practicarlas otra vez antes de que acabe el día.'}</span>
    </div>`;
  }
  const words = ids.slice(0, 6).map(id => `<span class="chip">${esc(findWord(id).word)}</span>`).join('');
  return `<a class="hub-card hub-hard" href="#/estudiar/dificiles">${head}
      <span class="hub-title">${plural(ids.length, 'palabra', 'palabras')}</span>
      <span class="hub-sub">Las que más te costaron hoy. Repásalas otra vez para que no se te escapen.</span>
      <span class="hub-words">${words}${ids.length > 6 ? `<span class="chip">+${ids.length - 6}</span>` : ''}</span>
    </a>`;
}

// Estudiar es un submenú: estudiar → elegir; estudiar/diario → sesión del día;
// estudiar/dificiles → repaso de las difíciles del día (misma sesión, con dailyHard);
// estudiar/grupos y estudiar/practica → repaso de grupos (ui/groups.js).
function renderStudy(param) {
  if (param === 'grupos') return renderGroupPicker();
  if (param === 'practica') return renderGroupRun();
  if (param !== 'diario' && param !== 'dificiles') return renderStudyHub();
  const s = state.ui.session;
  if (!s) return '';
  if (s.betweenBlocks) return renderBlockBreak(s);
  if (s.finished || !s.ex) return s.quiz && !s.quiz.done ? renderQuiz(s.quiz) : renderSummary(s);
  const ex = s.ex;
  const w = findWord(ex.wordId);
  const body = {
    1: renderExposure, 2: renderRecognition, 3: renderTyped, 4: renderTyped, 5: renderProduction, 6: renderPronunciation,
    7: renderMeaning, 8: renderRescue,
  }[ex.type](w, ex);
  // Al preparar una lectura se cuenta dentro del bloque actual.
  const start = s.blockStart || 0;
  const total = s.queue.length - start, pos = s.pos - start;
  const seg = s.segId && segmentById(s.segId);
  const label = ex.optional ? 'Oración opcional'
    : ex.mode === 'relaxed' ? `Relajado · ${EXERCISES[ex.type]}`
    : ex.type === 6 || ex.type === 8 ? EXERCISES[ex.type]
    : `${ex.mode === 'intensive' ? 'Intensivo · ' : ''}Paso ${ex.type === 7 ? w.stage : ex.type} de 5 · ${EXERCISES[ex.type]}`;
  return `
  <div class="study-head">
    <div class="row between">
      <span class="small" style="font-weight:600;color:var(--muted)">${seg ? esc(seg.title) : s.dailyHard ? 'Difíciles del día' : 'Sesión de hoy'}${s.reviewing && !s.dailyHard ? ' · Las que más te costaron' : s.blocks ? ` · Bloque ${s.block + 1} de ${s.blocks.length}` : ''} · Palabra ${Math.min(pos + 1, total)} de ${total}</span>
      <span class="row gap-sm">
        <span class="chip chip-accent">${label}</span>
        <button type="button" class="btn-link" data-action="end-session">Terminar</button>
      </span>
    </div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${pos}"><div style="width:${Math.round((pos / Math.max(1, total)) * 100)}%"></div></div>
  </div>
  ${body}`;
}

// Pausa entre bloques al preparar una lectura: repaso rápido de lo que se acaba de ver.
function renderBlockBreak(s) {
  const seg = s.segId && segmentById(s.segId);
  const hard = hardIds(seg);
  if (s.block >= s.blocks.length - 1) {
    // Tras el último bloque: repasar al final las que más costaron ayuda a fijarlas.
    return `
  <div class="card stack-lg narrow">
    <div class="stack-xs">
      <span class="eyebrow">${seg ? `${esc(seg.title)} · ` : ''}Último paso</span>
      <h1 class="word-lg">¡Viste todas las palabras!</h1>
      <p class="muted">Para terminar, repasa las que más te costaron. Volver a ellas al final es lo que las fija antes de leer.</p>
    </div>
    <div class="sim-compare">${hard.map(id => { const w = findWord(id); return `<div><span class="row between"><b>${esc(w.word)}</b><span class="chip chip-warn">×${seg.hard[id]}</span></span><span>${esc(primaryMeaning(w) || w.definition)}</span></div>`; }).join('')}</div>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="next-block" data-autofocus>Repasar las difíciles (${hard.length})</button>
      <button type="button" class="btn btn-secondary" data-action="end-session">Terminar por ahora</button>
    </div>
  </div>`;
  }
  const words = s.blocks[s.block].map(findWord).filter(Boolean);
  const rest = s.blocks.slice(s.block + 1);
  const left = rest.reduce((n, b) => n + b.length, 0);
  return `
  <div class="card stack-lg narrow">
    <div class="stack-xs">
      <span class="eyebrow">${seg ? `${esc(seg.title)} · ` : ''}Bloque ${s.block + 1} de ${s.blocks.length}</span>
      <h1 class="word-lg">¡Bloque terminado!</h1>
      <p class="muted">Dale un último vistazo a estas palabras. Te ${left === 1 ? 'falta' : 'faltan'} ${plural(left, 'palabra', 'palabras')} en ${plural(rest.length, 'bloque', 'bloques')}.${hard.length ? ` Las ${plural(hard.length, 'que te costó', 'que te costaron')} las repasarás al final.` : ''}</p>
    </div>
    <div class="progress"><div style="width:${Math.round(((s.block + 1) / s.blocks.length) * 100)}%"></div></div>
    <div class="sim-compare">${words.map(w => `<div><b>${esc(w.word)}</b><span>${esc(primaryMeaning(w) || w.definition)}</span></div>`).join('')}</div>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="next-block" data-autofocus>Siguiente bloque</button>
      <button type="button" class="btn btn-secondary" data-action="end-session">Terminar por ahora</button>
    </div>
  </div>`;
}

function renderExposure(w) {
  const again = !!w.introducedAt;
  return `
  <div class="card stack-lg narrow">
    <div class="stack-xs"><span class="eyebrow">${again ? 'Repasa esta palabra' : 'Palabra nueva'}</span>${wordTitle(w)}</div>
    ${wordInfo(w)}
    <div class="actions"><button type="button" class="btn btn-primary" data-action="exposure-done" data-autofocus>Entendido, siguiente</button></div>
  </div>`;
}

// En modo relajado se puede practicar con una oración propia de forma opcional.
function optionalSentenceBtn(ex) {
  return ex.mode === 'relaxed' ? '<button type="button" class="btn btn-secondary" data-action="practice-sentence">Practicar con una oración</button>' : '';
}

function renderRecognition(w, ex) {
  const answered = ex.phase === 'answered';
  const right = ex.options.find(o => o.correct).text;
  const ctx = bookContexts(w)[0];
  return `
  <div class="stack-lg narrow">
    <div class="stack-xs"><span class="muted">¿Qué significa?</span>${wordTitle(w)}${w.pos ? `<span class="muted small">${esc(w.pos)}</span>` : ''}</div>
    ${ctx ? `<div class="card stack-xs"><span class="eyebrow">En el libro${ctx.loc ? ' · ' + esc(ctx.loc) : ''}</span><span class="lead">${highlightWord(ctx.text, w)}</span></div>` : ''}
    ${choiceOptions(ex.options.map(o => o.text), {
      action: 'choose', picked: ex.picked, chosen: answered ? ex.chosen : null, correct: ex.options.findIndex(o => o.correct),
    })}
    ${answered ? `
      ${ex.result.ok ? banner('ok', '¡Correcto!', ex.mode === 'relaxed' ? 'Un acierto más para reconocerla al leer.' : 'La palabra avanza al paso Recordar.') : banner('err', `Significa «${esc(w.translation || right)}»`, 'Volverás a verla pronto.')}
      <div class="card stack">${wordInfo(w, { examples: 1, family: false })}</div>
      ${actionBar(`${optionalSentenceBtn(ex)}<button type="button" class="btn btn-primary" data-action="next" data-autofocus>Continuar</button>`)}`
    : checkBar('confirm-choice', ex.picked)}
  </div>`;
}

/* Elección múltiple: tocar una opción solo la marca y «Comprobar» confirma, para que
   un toque en falso en el celular no cuente como respuesta. `chosen` es la respuesta
   ya confirmada (null mientras se pregunta) y `correct` el índice de la buena. */
function choiceOptions(texts, { action, picked, chosen, correct }) {
  const answered = chosen != null;
  return `<div class="options">${texts.map((t, i) => {
    const cls = answered ? (i === correct ? 'is-correct' : i === chosen ? 'is-wrong' : '') : i === picked ? 'is-selected' : '';
    return `<button type="button" class="option ${cls}" data-action="${action}" data-idx="${i}" ${answered ? 'disabled' : `aria-pressed="${i === picked}"`}><span class="key">${i + 1}</span><span>${esc(t)}</span></button>`;
  }).join('')}</div>`;
}
// Barra de acción: en el celular queda fija abajo y con botones a todo lo ancho.
const actionBar = html => `<div class="action-bar">${html}</div>`;
const checkBar = (action, picked) => actionBar(`<button type="button" class="btn btn-primary" data-action="${action}" data-confirm ${picked == null ? 'disabled' : 'data-autofocus'}>Comprobar</button>`);

function gradeButtons(w) {
  const grades = [['again', 'Otra vez'], ['hard', 'Difícil'], ['good', 'Bien'], ['easy', 'Fácil']];
  const profile = wordMode(w) === 'relaxed' ? 'relaxed' : 'standard';
  return `<div class="grade-row">${grades.map(([g, label]) => `
    <button type="button" class="grade grade-${g}" data-action="grade" data-grade="${g}" ${g === 'good' ? 'data-autofocus' : ''}>
      <span>${label}</span><small>${formatInterval(scheduleReview(w.srs, g, Date.now(), profile))}</small>
    </button>`).join('')}</div>`;
}

// Recuerdo (etapa 3) y cloze (etapa 4) comparten la mecánica de escribir la palabra.
function renderTyped(w, ex) {
  const cloze = ex.type === 4 ? ex.cloze : null;
  const answered = ex.phase === 'answered';
  const expected = cloze ? cloze.answer : w.word;
  const fromBook = cloze && bookContexts(w).some(c => c.text === cloze.sentence);
  const prompt = cloze
    ? `<span class="row gap-sm"><span class="muted">Completa la oración${fromBook ? ' del libro' : ''}</span>${pinBtn(w, 'hidden')}</span>
       <p class="sentence">${esc(cloze.before)}<span class="blank" style="min-width:${Math.max(4, expected.length)}ch">${answered ? esc(expected) : '&nbsp;'}</span>${esc(cloze.after)}</p>
       <p class="muted">Pista: ${esc(w.translation || w.definition)}</p>`
    : `<span class="muted">¿Cómo se dice en inglés?</span>
       <div class="word-title"><h1 class="word-xl">${esc(w.translation || w.definition || '—')}</h1>${pinBtn(w, 'hidden')}</div>
       ${w.translation && w.definition ? `<p class="lead muted">${esc(w.definition)}</p>` : ''}
       ${w.pos ? `<span class="chip" style="align-self:flex-start">${esc(w.pos)}</span>` : ''}`;

  let result = '';
  if (answered) {
    const r = ex.result;
    if (r.ok) {
      const note = r.kind === 'alt' ? `En esta oración la forma es <b>${esc(expected)}</b>.` : esc(fmtIpa(w.ipa));
      result = `${r.kind === 'typo' ? almostBanner(expected, ex.input) : banner('ok', '¡Correcto!', note)}
        <div class="row between"><span class="eyebrow">¿Qué tan fácil fue recordarla?</span>${speakBtn(cloze ? cloze.sentence : w.word, 'Escuchar', 'sm')}</div>
        ${gradeButtons(w)}
        ${ex.mode === 'relaxed' ? `<div class="actions">${optionalSentenceBtn(ex)}</div>` : ''}`;
    } else {
      result = `${banner('err', `La respuesta es «${esc(expected)}»`, `${ex.input ? `Escribiste: ${esc(ex.input)}. ` : ''}${ex.mode === 'relaxed' ? 'Volverás a verla pronto.' : 'La palabra baja una etapa y volverá en unos minutos.'}`)}
        <div class="row between"><span>${esc(cloze ? cloze.sentence : `${w.word} ${fmtIpa(w.ipa)}`)}</span>${speakBtn(cloze ? cloze.sentence : w.word, 'Escuchar', 'sm')}</div>
        <div class="actions"><button type="button" class="btn btn-primary" data-action="next" data-autofocus>Continuar</button>${optionalSentenceBtn(ex)}</div>`;
    }
  }

  return `
  <div class="stack-lg narrow">
    <div class="stack-sm">${prompt}</div>
    <form class="stack" data-submit="check-typed" autocomplete="off">
      <input class="input big ${answered && ex.result?.kind === 'typo' ? 'is-almost' : ''}" name="answer" aria-label="Tu respuesta" placeholder="Escribe la palabra en inglés" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(ex.input)}" ${answered ? 'disabled' : 'data-autofocus'}>
      ${answered ? '' : `<div class="actions"><button type="submit" class="btn btn-primary">Comprobar</button><button type="button" class="btn btn-secondary" data-action="give-up">No me acuerdo</button></div>`}
    </form>
    ${result}
  </div>`;
}

// Recuerdo del significado: ver la palabra y escribir qué significa en español.
function renderMeaning(w, ex) {
  const answered = ex.phase === 'answered';
  const r = ex.result;
  const ctx = bookContexts(w)[0];
  let result = '';
  if (answered && r.ok) {
    result = `${r.kind === 'typo' ? almostBanner(r.match, ex.input, `<br>Significa «${esc(w.translation)}»`)
      : banner('ok', r.kind === 'exact' || r.kind === 'self' ? '¡Correcto!' : '¡Bien!', `Significa «${esc(w.translation)}»${w.definition ? ` · ${esc(w.definition)}` : ''}`)}
      <span class="eyebrow">¿Qué tan fácil fue recordarlo?</span>
      ${gradeButtons(w)}
      ${ex.mode === 'relaxed' ? `<div class="actions">${optionalSentenceBtn(ex)}</div>` : ''}`;
  } else if (answered && ex.pending) {
    // Puede ser un sinónimo que la lista no tiene: decide el usuario.
    result = `${banner('warn', `Se esperaba «${esc(w.translation)}»`, `Escribiste «${esc(ex.input)}». Si significa lo mismo, cuéntala como correcta.`)}
      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="meaning-accept" data-autofocus>Es un sinónimo, la sabía</button>
        <button type="button" class="btn btn-secondary" data-action="meaning-wrong">Me equivoqué</button>
      </div>`;
  } else if (answered) {
    result = `${banner('err', `Significa «${esc(w.translation)}»`, `${ex.input ? `Escribiste «${esc(ex.input)}». ` : ''}Volverás a verla pronto.`)}
      <div class="card stack">${wordInfo(w, { examples: 1, family: false })}</div>
      <div class="actions"><button type="button" class="btn btn-primary" data-action="next" data-autofocus>Continuar</button>${optionalSentenceBtn(ex)}</div>`;
  }
  return `
  <div class="stack-lg narrow">
    <div class="stack-xs"><span class="muted">¿Qué significa? Escríbelo en español</span>${wordTitle(w)}${w.pos ? `<span class="muted small">${esc(w.pos)}</span>` : ''}</div>
    ${ctx && (ex.hint || answered) ? `<div class="card stack-xs"><span class="eyebrow">En el libro${ctx.loc ? ' · ' + esc(ctx.loc) : ''}</span><span class="lead">${highlightWord(ctx.text, w)}</span></div>` : ''}
    <form class="stack" data-submit="check-meaning" autocomplete="off">
      <input class="input big ${answered && r?.kind === 'typo' ? 'is-almost' : ''}" name="answer" aria-label="Significado en español" placeholder="Escribe el significado" spellcheck="false" value="${esc(ex.input)}" ${answered ? 'disabled' : 'data-autofocus'}>
      ${answered ? '' : `<div class="actions"><button type="submit" class="btn btn-primary">Comprobar</button><button type="button" class="btn btn-secondary" data-action="give-up">No me acuerdo</button>${ctx && !ex.hint ? '<button type="button" class="btn-link" data-action="meaning-hint">Ver la oración del libro</button>' : ''}</div>`}
    </form>
    ${result}
  </div>`;
}

// Rescate de una palabra difícil: ancla nueva, contraste con las que se confunde y práctica.
function renderRescue(w, ex) {
  const aid = w.rescueAid;
  if (ex.phase === 'contrast') {
    const q = ex.qs[ex.qpos];
    const answered = q.chosen != null;
    const ok = answered && q.options[q.chosen] === q.answer;
    const [before, ...rest] = q.sentence.split(/_{2,}/);
    const diff = aid.confusables.find(c => c.word === q.answer || c.word === q.options[q.chosen]);
    return `
    <div class="stack-lg narrow">
      <div class="stack-xs"><span class="eyebrow">Contraste ${ex.qpos + 1} de ${ex.qs.length}</span><span class="muted">¿Qué palabra completa la oración?</span></div>
      <p class="sentence">${esc(before)}<span class="blank" style="min-width:6ch">${answered ? esc(q.fill) : '&nbsp;'}</span>${esc(rest.join('___'))}</p>
      ${choiceOptions(q.options, { action: 'rescue-choose', picked: q.picked, chosen: q.chosen, correct: q.options.indexOf(q.answer) })}
      ${answered ? `${ok ? banner('ok', '¡Bien distinguida!') : banner('err', `Era «${esc(q.answer)}»`, diff ? esc(diff.difference) : '')}
        ${actionBar(`<button type="button" class="btn btn-primary" data-action="rescue-next" data-autofocus>${ex.qpos + 1 < ex.qs.length ? 'Siguiente' : `Practicar «${esc(w.word)}»`}</button>`)}`
      : checkBar('rescue-confirm', q.picked)}
    </div>`;
  }
  const ctx = bookContexts(w)[0];
  const aidHTML = ex.loading ? '<span class="row gap-sm"><span class="spinner"></span><span class="muted">Buscando otra forma de recordarla…</span></span>'
    : aid ? `${aid.why ? `<p class="muted">${esc(aid.why)}</p>` : ''}${aid.mnemonic ? `<div class="tip">${esc(aid.mnemonic)}</div>` : ''}`
    : ex.error ? `${banner('err', 'No se pudo generar la ayuda', esc(ex.error))}<button type="button" class="btn btn-secondary btn-sm" style="align-self:flex-start" data-action="rescue-ai">Reintentar</button>`
    : `${w.mnemonic ? `<div class="tip">${esc(w.mnemonic)}</div>` : ''}${aiBanner('Con una IA conectada recibirías un truco nuevo para esta palabra y las palabras con las que se confunde.', { short: 'Te daría un truco nuevo para recordarla.' })}`;
  const contrast = buildContrast(w).length;
  return `
  <div class="stack-lg narrow">
    <div class="rescue-head">
      <span class="rescue-icon">${icon('bolt', 24)}</span>
      <div class="stack-xs"><span class="eyebrow">Palabra difícil · ${plural(w.srs.lapses, 'fallo', 'fallos')}</span>
        <h1 class="word-lg">Vamos a rescatar esta palabra</h1>
        <p class="muted">Repetirla igual no está funcionando. Antes de seguir, dale un ancla nueva.</p></div>
    </div>
    <div class="card stack-sm">
      ${wordTitle(w)}
      <p class="lead"><b>${esc(w.translation || w.definition)}</b>${w.translation && w.definition ? ` <span class="muted">· ${esc(w.definition)}</span>` : ''}</p>
      ${ctx ? `<p class="muted">${highlightWord(ctx.text, w)}</p>` : ''}
    </div>
    <section class="card stack-sm"><span class="eyebrow">Otra forma de recordarla</span>${aidHTML || '<p class="hint">Inventa tu propio truco abajo.</p>'}</section>
    ${aid?.confusables?.length ? `<section class="card stack-sm"><span class="eyebrow">No la confundas con</span>
      ${aid.confusables.map(c => `<div class="confusable"><b>${esc(c.word)}</b><span class="muted">${esc(c.meaning)}</span><span class="small">${esc(c.difference)}</span></div>`).join('')}</section>` : ''}
    <section class="card stack-sm">
      <label class="eyebrow" for="rescue-note">Tu propio truco (opcional)</label>
      <textarea id="rescue-note" class="textarea" rows="2" data-bind="rescue-note" placeholder="Imagina una escena absurda que una cómo suena «${esc(w.word)}» con lo que significa…">${esc(ex.note)}</textarea>
      <p class="hint">Un truco que inventas tú se recuerda mejor que uno que solo lees.${aid?.mnemonic ? ' Si lo dejas vacío, se guarda el de arriba.' : ''}</p>
    </section>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="${contrast ? 'rescue-contrast' : 'rescue-done'}" ${ex.loading ? 'disabled' : ''}>${contrast ? `Practicar el contraste (${contrast})` : 'Listo, a practicar'}</button>
    </div>
  </div>`;
}

function renderPronunciation(w, ex) {
  const listening = ex.phase === 'listening';
  return `
  <div class="stack-lg narrow">
    <div class="stack-xs"><span class="muted">Pronuncia en voz alta</span>${wordTitle(w)}</div>
    <p class="muted">Escucha el modelo con el altavoz y luego graba tu pronunciación. Este ejercicio no cambia tu progreso.</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="pron-start" ${listening ? 'disabled' : ''}>${listening ? '<span class="spinner"></span><span>Escuchando…</span>' : `${icon('mic')}<span>${ex.heard ? 'Grabar otra vez' : 'Grabar'}</span>`}</button>
      <button type="button" class="btn btn-secondary" data-action="next">${ex.heard || ex.pronError ? 'Continuar' : 'Saltar'}</button>
    </div>
    ${ex.heard ? (ex.result?.ok ? banner('ok', '¡Se entendió bien!', `Escuché: «${esc(ex.heard)}»`) : banner('warn', 'No se reconoció la palabra', `Escuché: «${esc(ex.heard || '…')}». Escucha el modelo e inténtalo de nuevo.`)) : ''}
    ${ex.pronError ? banner('err', 'No se pudo grabar', esc(ex.pronError), '', true) : ''}
  </div>`;
}

/* Marca en la oración del usuario los fragmentos con error que devolvió la IA. */
function highlightErrors(sentence, errors) {
  const lower = sentence.toLowerCase();
  const ranges = [];
  for (const e of errors) {
    const frag = e.fragment.toLowerCase();
    let from = 0, idx;
    while ((idx = lower.indexOf(frag, from)) !== -1) {
      const end = idx + frag.length;
      if (!ranges.some(r => idx < r.end && end > r.start)) { ranges.push({ start: idx, end, title: e.correction }); break; }
      from = idx + 1;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let out = '', pos = 0;
  for (const r of ranges) {
    out += esc(sentence.slice(pos, r.start)) + `<mark class="err" title="${esc(r.title ? '→ ' + r.title : 'Error')}">${esc(sentence.slice(r.start, r.end))}</mark>`;
    pos = r.end;
  }
  return out + esc(sentence.slice(pos));
}

/* Resalta en negrita las palabras de la versión corregida que no estaban en la original. */
function diffHighlight(original, corrected) {
  const counts = {};
  for (const t of original.split(/\s+/)) { const k = normalize(t); counts[k] = (counts[k] || 0) + 1; }
  return corrected.split(/(\s+)/).map(t => {
    if (/^\s+$/.test(t)) return t;
    const k = normalize(t);
    if (counts[k] > 0) { counts[k]--; return esc(t); }
    return `<strong>${esc(t)}</strong>`;
  }).join('');
}

function renderProduction(w, ex) {
  let main;
  if (ex.phase === 'feedback') main = renderFeedback(w, ex);
  else if (ex.phase === 'self') main = renderSelfEval(w, ex);
  else {
    const loading = ex.phase === 'loading';
    const errBlock = ex.error ? banner('err', 'No se pudo revisar con IA', esc(ex.error),
      `<div class="actions">
        <button type="submit" class="btn btn-dark btn-sm">Reintentar</button>
        ${['NO_KEY', 'INVALID_KEY', 'MODEL'].includes(ex.errorCode) ? '<a class="btn btn-secondary btn-sm" href="#/ajustes">Ir a Ajustes</a>' : ''}
      </div>`, true) : '';
    main = `
    <form class="card stack" data-submit="submit-sentence">
      <label class="eyebrow" for="sentence">Tu oración</label>
      <textarea id="sentence" class="textarea big" rows="3" data-bind="sentence" data-ctrl-enter="submit-sentence" placeholder="Escribe una oración en inglés con «${esc(w.word)}»" ${loading ? 'readonly' : 'data-autofocus'}>${esc(ex.sentence)}</textarea>
      ${ex.warnMissing ? banner('warn', `No encuentro «${esc(w.word)}» en tu oración`, 'Inclúyela (o una de sus formas) para practicarla.', '<div class="actions"><button type="button" class="btn btn-dark btn-sm" data-action="submit-anyway">Enviar de todas formas</button></div>', true) : ''}
      ${errBlock}
      <div class="actions">
        ${hasKey() ? `<button type="submit" class="btn btn-primary" ${loading ? 'disabled' : ''}>${loading ? '<span class="spinner"></span><span>Revisando…</span>' : `${icon('sparkle')}<span>Revisar con IA</span>`}</button>` : ''}
        <button type="button" class="btn btn-secondary" data-action="self-eval" ${loading ? 'disabled' : ''}>Autoevaluar sin IA</button>
        ${ex.optional ? '<button type="button" class="btn-link" data-action="next-optional">Saltar</button>' : ''}
      </div>
      ${hasKey() ? `<p class="hint">Ctrl + Enter para enviar.${ignoredAspects().length ? ` No se corrigen ${ignoredAspects().map(x => x.split(' (')[0]).join(', ')} (<a href="#/ajustes">cambiar</a>).` : ''}</p>`
        : aiBanner('Con una IA conectada, tu oración se corrige al momento y te explica cómo mejorarla. Mientras, compárala tú con los ejemplos.', { short: 'Tu oración se corregiría al momento.' })}
    </form>`;
  }
  return `
  <div class="split">
    <div class="col-main stack-lg">
      <div class="stack-xs"><span class="muted">Escribe una oración con</span>${wordTitle(w)}</div>
      ${main}
    </div>
    ${reviewAside(w, ex)}
  </div>`;
}

/* Repaso de la palabra mientras escribes: empieza tapado para que primero intentes
   recordar qué significa y cómo se usa. Se destapa solo, al ver el resultado. */
function reviewAside(w, ex) {
  const covered = !ex.reveal && !['feedback', 'self'].includes(ex.phase);
  return `<aside class="card col-side stack review-peek ${covered ? 'is-covered' : ''}">
      <span class="eyebrow">Repaso de la palabra</span>
      <div class="peek-body" ${covered ? 'aria-hidden="true" inert' : ''}>${wordInfo(w, { examples: 1, family: false })}</div>
      ${covered ? `<div class="peek-cover">
        <span class="icon-tile">${icon('lock')}</span>
        <b>Primero intenta recordarla</b>
        <span class="hint">Piensa qué significa y cómo se usa. Si te atoras, puedes mirar.</span>
        <button type="button" class="btn btn-secondary btn-sm" data-action="reveal-review">Mostrar repaso</button>
      </div>` : ''}
    </aside>`;
}

const VERDICTS = {
  correcto: { kind: 'ok', title: '¡Correcto! Usaste bien la palabra' },
  casi: { kind: 'warn', title: 'Casi: usaste bien la palabra' },
  incorrecto: { kind: 'err', title: 'Todavía no: revisa el uso de la palabra' },
};

function renderFeedback(w, ex) {
  const fb = ex.feedback;
  const v = VERDICTS[fb.verdict];
  const n = fb.errors.length;
  const sub = n ? (n === 1 ? 'Hay un error para corregir.' : `Hay ${n} errores para corregir.`) : fb.verdict === 'correcto' ? 'Sin errores de gramática.' : '';
  const outcome = ex.optional ? 'Práctica opcional: no cambia tu progreso.' : {
    correcto: 'Cuenta como acierto para tu repaso.',
    casi: 'Si sigues así, la palabra se queda en esta etapa. Reescríbela para que cuente como acierto.',
    incorrecto: 'Si sigues así, cuenta como fallo y la palabra baja una etapa. Puedes reescribirla.',
  }[fb.verdict];
  return `
  <div class="card stack-sm">
    <span class="eyebrow">Tu oración</span>
    <p class="sentence">${highlightErrors(ex.submitted, fb.errors)}</p>
  </div>
  ${banner(v.kind, v.title, sub)}
  ${senseNote(w, ex)}
  ${n ? `<ul class="error-list">${fb.errors.map(e => `<li><s>${esc(e.fragment)}</s> → <b>${esc(e.correction)}</b>${e.explanation ? ` <span class="muted">· ${esc(e.explanation)}</span>` : ''}</li>`).join('')}</ul>` : ''}
  <div class="split-2">
    <div class="card stack-sm"><span class="eyebrow ok">Corregida</span><span class="sentence-md">${diffHighlight(ex.submitted, fb.corrected)}</span></div>
    <div class="card row between top nowrap">
      <div class="stack-sm"><span class="eyebrow accent">Más natural</span><span class="sentence-md">${esc(fb.natural)}</span></div>
      ${speakBtn(fb.natural, 'Escuchar oración')}
    </div>
  </div>
  ${fb.explanation ? `<div class="stack-xs" style="padding:0 4px"><span class="eyebrow">Por qué</span><p style="font-size:16px">${esc(fb.explanation).replace(/\n/g, '<br>')}</p></div>` : ''}
  <div class="actions">
    <button type="button" class="btn btn-secondary" data-action="rewrite">Reescribir</button>
    <button type="button" class="btn btn-primary" data-action="production-next" data-autofocus>Siguiente palabra</button>
  </div>
  <p class="hint">${outcome}</p>`;
}

// La usó con otro significado real (p. ej. «deslumbrar» cuando estudia «impresionar»):
// se le dice y puede guardarlo en la palabra.
function senseNote(w, ex) {
  const fb = ex.feedback;
  if (fb.sameSense || !fb.sense || fb.verdict === 'incorrecto') return '';
  const known = [w.translation, ...(w.otherMeanings || [])].some(m => normalize(m).includes(normalize(fb.sense.replace(/\(.*?\)/g, ''))));
  return banner('info', `Usaste «${esc(w.word)}» como «${esc(fb.sense)}»`,
    `Es otro significado válido de la palabra. El que estás estudiando es «${esc(primaryMeaning(w) || w.translation || w.definition)}».`,
    known || ex.senseSaved ? (ex.senseSaved ? '<span class="small" style="font-weight:600">Guardado en sus significados.</span>' : '')
      : `<div class="actions"><button type="button" class="btn btn-secondary btn-sm" data-action="save-sense">${icon('plus', 16)}<span>Guardar este significado</span></button></div>`);
}

function renderSelfEval(w, ex) {
  const examples = displayExamples(w);
  return `
  <div class="card stack-sm"><span class="eyebrow">Tu oración</span><p class="sentence">${esc(ex.submitted || '—')}</p></div>
  <div class="card stack-sm"><span class="eyebrow">Compárala con los ejemplos</span>
    ${examples.map(e => `<div class="example"><span>${esc(e)}</span>${speakBtn(e, 'Escuchar ejemplo', 'sm')}</div>`).join('') || '<p class="muted">Esta palabra no tiene ejemplos.</p>'}
  </div>
  ${ex.optional ? '<div class="actions"><button type="button" class="btn btn-primary" data-action="next-optional">Continuar</button></div>' : `<span class="eyebrow">¿La usaste bien?</span>${gradeButtons(w)}`}
  <button type="button" class="btn-link" style="align-self:flex-start" data-action="rewrite">Reescribir</button>`;
}

function renderSummary(s) {
  if (!state.data.words.length) {
    return `
    <div class="card stack narrow">
      <span class="icon-tile">${icon('plus')}</span>
      <h1 class="word-lg">Primero agrega palabras</h1>
      <p class="muted">Todavía no tienes palabras para estudiar. Escribe las que quieras aprender o sácalas de un libro que vayas a leer.</p>
      <div class="actions">
        <a class="btn btn-primary" href="#/agregar">${icon('plus', 18)}<span>Agregar palabras</span></a>
        <a class="btn btn-secondary" href="#/lecturas">Preparar una lectura</a>
      </div>
    </div>`;
  }
  if (!s.queue.length && s.dailyHard) {
    return `
    <div class="card stack narrow">
      <span class="icon-tile">${icon('target')}</span>
      <h1 class="word-lg">No tienes palabras difíciles hoy</h1>
      <p class="muted">Aquí aparecen las que falles o marques como «Difícil» en tus repasos de hoy.</p>
      <div class="actions">
        <a class="btn btn-primary" href="#/estudiar/diario">Ir al repaso diario</a>
        <a class="btn btn-secondary" href="#/estudiar">Volver a Estudiar</a>
      </div>
    </div>`;
  }
  if (!s.queue.length) {
    const waiting = state.data.words.filter(w => !isStudyReady(w) && (!s.segId || w.segIds.includes(s.segId))).length;
    return `
    <div class="card stack narrow">
      <h1 class="word-lg">¡Todo al día!</h1>
      <p class="muted">No tienes palabras pendientes para hoy${s.segId ? ' en esta lectura' : ''}${state.data.words.some(isNew) ? ' o ya alcanzaste tu meta de palabras nuevas' : ''}.</p>
      ${waiting && !isDismissed('studyWaiting', waiting) ? banner('warn', `${plural(waiting, 'palabra espera', 'palabras esperan')} su significado`, 'Enriquécelas con IA o complétalas a mano para estudiarlas.',
        '<div class="actions"><a class="btn btn-secondary btn-sm" href="#/palabras" data-action="filter-noai">Ver palabras</a></div>', 'studyWaiting', waiting) : ''}
      <div class="actions">
        ${s.segId ? `<a class="btn btn-primary" href="#/segmento/${s.segId}">Volver a la lectura</a>` : '<a class="btn btn-primary" href="#/lecturas">Preparar una lectura</a>'}
        ${state.data.words.length ? `<button type="button" class="btn btn-secondary" data-action="force-session">Repasar de todas formas</button>` : ''}
        ${!s.segId && groups().some(canPractice) ? `<a class="btn btn-secondary" href="#/estudiar/grupos">${icon('cards', 18)}<span>Repasar grupos</span></a>` : ''}
      </div>
    </div>`;
  }
  const mins = Math.max(1, Math.round(((s.endedAt || Date.now()) - s.startedAt) / MINUTE));
  const pending = state.data.words.filter(w => isDueToday(w) && isStudyReady(w) && (!s.segId || w.segIds.includes(s.segId))).length;
  const q = s.quiz?.done ? s.quiz : null;
  const tile = (n, label) => `<div class="stat" style="background:var(--surface-2)"><b>${n}</b><span>${label}</span></div>`;
  // Celebración: racha que sube, palabras aprendidas en la sesión y subida de nivel.
  const streakNow = currentStreak(state.data.stats);
  const streakUp = s.completed && streakNow > (s.streakBefore ?? streakNow);
  const learnedNow = state.data.words.filter(w => (w.learnedAt || 0) >= s.startedAt);
  const learnedTotal = state.data.words.filter(isLearned).length;
  const lvlNow = levelIndex(learnedTotal);
  const levelUp = lvlNow > levelIndex(learnedTotal - learnedNow.length);
  const answered = s.stats.correct + s.stats.almost + s.stats.wrong;
  const acc = answered ? s.stats.correct / answered : 1;
  const cheer = acc >= 0.9 ? '¡Sesión casi perfecta!' : acc >= 0.7 ? 'Vas muy bien, sigue así.' : 'Cada error te acerca a recordarlas mejor.';
  const hardLeft = dailyHardIds();
  return `
  <div class="card stack-lg narrow summary-card">
    ${s.completed ? `<div class="celebrate" data-celebrate>
      <span class="celebrate-badge" aria-hidden="true">${icon('trophy', 40)}</span>
      <span class="eyebrow">${s.timeUp ? `Llegaste a los ${Math.round(s.maxMs / MINUTE)} minutos` : 'Sesión terminada'}</span>
      <h1 class="word-lg">¡Buen trabajo!</h1>
      <p class="muted">${cheer}</p>
      ${streakUp ? `<div class="celebrate-streak">${icon('flame', 20)}<span><b>${plural(streakNow, 'día', 'días')}</b> de racha</span><span class="celebrate-plus">+1</span></div>` : ''}
    </div>` : `<div class="stack-xs">
      <span class="eyebrow">Sesión sin completar</span>
      <h1 class="word-lg">Tu avance quedó guardado</h1>
      <p class="muted">Lo que respondiste ya cuenta para tus palabras. Completa una sesión entera, sin pulsar «Terminar», para sumar un día a tu racha.</p>
    </div>`}
    ${levelUp ? `<a class="levelup" href="#/progreso">
      <span class="levelup-icon">${icon('star', 22)}</span>
      <span class="stack-xs grow"><span class="eyebrow">¡Subiste de nivel!</span><b>Ahora eres ${LEVELS[lvlNow].name}</b></span>
      <span class="levelup-go">Ver tu camino</span></a>` : ''}
    ${learnedNow.length ? `<div class="stack-sm"><span class="eyebrow ok">${learnedNow.length === 1 ? 'Palabra aprendida' : 'Palabras aprendidas'} en esta sesión</span>
      <div class="chips">${learnedNow.map(w => `<span class="chip chip-ok">${icon('check', 14)} ${esc(w.word)}</span>`).join('')}</div></div>` : ''}
    <div class="stat-grid" style="flex:none">
      ${tile(s.done, 'Ejercicios')}${tile(s.stats.correct, 'Aciertos')}${tile(s.stats.wrong, 'Fallos')}
      ${tile(s.stats.newWords, 'Nuevas')}${tile(mins, 'Minutos')}${tile(currentStreak(state.data.stats), 'Días de racha')}
    </div>
    ${dailyHardCallout(s, hardLeft)}
    ${q ? banner(quizScore(q) / q.questions.length >= 0.8 ? 'ok' : 'warn', `Mini prueba: ${quizScore(q)} de ${q.questions.length}`,
      q.questions.filter(x => !x.ok).map(x => esc(x.w.word)).join(', ') ? `Repasa: ${q.questions.filter(x => !x.ok).map(x => esc(x.w.word)).join(', ')}` : 'Recordaste todas las palabras de la sesión.') : ''}
    <div class="actions">
      ${s.segId ? `<a class="btn btn-primary" href="#/segmento/${s.segId}">Volver a la lectura</a>` : '<a class="btn btn-primary" href="#/inicio">Volver al inicio</a>'}
      ${pending && !s.dailyHard ? `<button type="button" class="btn btn-secondary" data-action="start-session" ${s.segId ? `data-seg="${s.segId}"` : ''}>Otra ronda (${pending})</button>` : ''}
    </div>
  </div>`;
}

// Al terminar: invita a repasar las difíciles del día o, tras repasarlas, dice cuántas se vencieron.
function dailyHardCallout(s, ids) {
  const words = list => list.slice(0, 8).map(id => `<span class="chip">${esc(findWord(id).word)}</span>`).join('') + (list.length > 8 ? `<span class="chip">+${list.length - 8}</span>` : '');
  if (s.dailyHard) {
    const beaten = (s.hardStart || []).filter(id => !ids.includes(id)).length;
    if (!ids.length) return banner('ok', '¡Venciste las difíciles de hoy!', `${plural(beaten, 'palabra salió', 'palabras salieron')} de la lista.`);
    return `<div class="dh-callout">
      <span class="icon-tile">${icon('target')}</span>
      <div class="stack-xs grow"><b>${beaten ? `Venciste ${beaten}. ` : ''}Aún ${ids.length === 1 ? 'te cuesta 1' : `te cuestan ${ids.length}`}</b>
        <div class="chips">${words(ids)}</div></div>
      <button type="button" class="btn btn-primary btn-sm" data-action="daily-hard">Otra vuelta</button>
    </div>`;
  }
  if (!ids.length) return '';
  return `<div class="dh-callout">
    <span class="icon-tile">${icon('target')}</span>
    <div class="stack-xs grow"><b>${ids.length === 1 ? 'Esta te costó' : `Estas ${ids.length} te costaron`} hoy</b>
      <div class="chips">${words(ids)}</div></div>
    <button type="button" class="btn btn-primary btn-sm" data-action="daily-hard">Repasar las difíciles</button>
  </div>`;
}

/* ---------- Quiz (minitest, prueba final, verificación) ---------- */

function activeQuiz() {
  const r = currentRoute();
  if (r.name !== 'estudiar') return state.ui.quiz;
  return r.param === 'diario' || r.param === 'dificiles' ? state.ui.session?.quiz : r.param === 'practica' ? curGroupStep()?.quiz : null;
}

function renderQuiz(q) {
  if (!q) return '';
  if (q.done) return QUIZ_RESULT[q.context]?.(q) || '';
  const item = q.questions[q.pos];
  const w = item.w;
  const n = q.questions.length;
  let body;
  if (item.kind === 'mc') {
    const head = item.prompt ? (item.answered && item.promptDone ? item.promptDone : item.prompt) : `<span class="muted">¿Qué significa?</span>${wordTitle(w)}`;
    body = `<div class="stack-xs">${head}</div>
      ${choiceOptions(item.options.map(o => o.text), {
        action: 'quiz-choose', picked: item.picked, chosen: item.answered ? item.chosen : null, correct: item.options.findIndex(o => o.correct),
      })}`;
  } else {
    const cloze = item.kind === 'cloze' ? item.cloze : null;
    const expected = cloze ? cloze.answer : w.word;
    body = `${cloze
      ? `<span class="muted">Completa la oración</span><p class="sentence">${esc(cloze.before)}<span class="blank" style="min-width:${Math.max(4, expected.length)}ch">${item.answered ? esc(expected) : '&nbsp;'}</span>${esc(cloze.after)}</p><p class="muted">Pista: ${esc(w.translation || w.definition)}</p>`
      : `<span class="muted">¿Cómo se dice en inglés?</span><h1 class="word-xl">${esc(w.translation || w.definition)}</h1>`}
      <form class="stack" data-submit="quiz-typed" autocomplete="off">
        <input class="input big" name="answer" aria-label="Tu respuesta" placeholder="Escribe la palabra en inglés" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(item.input)}" ${item.answered ? 'disabled' : 'data-autofocus'}>
        ${item.answered ? '' : '<div class="actions"><button type="submit" class="btn btn-primary">Comprobar</button><button type="button" class="btn btn-secondary" data-action="quiz-skip-q">No me acuerdo</button></div>'}
      </form>`;
  }
  const expectedText = item.answerText || (item.kind === 'mc' ? (w.translation || w.definition) : (item.cloze ? item.cloze.answer : w.word));
  return `
  <div class="study-head">
    <div class="row between">
      <span class="small" style="font-weight:600;color:var(--muted)">${esc(q.title)} · Pregunta ${q.pos + 1} de ${n}</span>
      ${q.context === 'minitest' ? '<button type="button" class="btn-link" data-action="quiz-abort">Saltar la mini prueba</button>' : '<button type="button" class="btn-link" data-action="quiz-abort">Salir</button>'}
    </div>
    <div class="progress"><div style="width:${Math.round((q.pos / n) * 100)}%"></div></div>
  </div>
  <div class="stack-lg narrow">
    ${body}
    ${item.answered ? `${item.ok ? banner('ok', '¡Correcto!') : banner('err', `La respuesta es «${esc(expectedText)}»`)}
      ${item.after || ''}
      ${actionBar(`<button type="button" class="btn btn-primary" data-action="quiz-next" data-autofocus>${q.pos + 1 < n ? 'Siguiente' : 'Ver resultado'}</button>`)}`
    : item.kind === 'mc' ? checkBar('quiz-confirm', item.picked) : ''}
  </div>`;
}

function quizResultCard(q, title, extra = '') {
  const score = quizScore(q);
  const n = q.questions.length;
  const pct = Math.round((score / Math.max(1, n)) * 100);
  const failed = q.questions.filter(x => !x.ok);
  return `
  <div class="card stack-lg narrow">
    <div class="stack-xs"><span class="eyebrow">${esc(q.title)}</span><h1 class="word-lg">${title}</h1></div>
    <div class="row"><span class="hero-number" style="color:var(--accent)">${pct}%</span><span class="muted">${score} de ${n} correctas</span></div>
    ${failed.length ? `<div class="stack-xs"><span class="eyebrow">Para repasar</span><div class="chips">${[...new Set(failed.map(x => x.w.word))].map(word => `<span class="chip">${esc(word)}</span>`).join('')}</div></div>` : banner('ok', '¡Perfecto!', 'Respondiste bien todas las preguntas.')}
    ${extra}
  </div>`;
}

// Pantallas de resultado por tipo de quiz (reading.js agrega "final" y "verify").
const QUIZ_RESULT = {
  minitest: () => '',
};
// Acciones al terminar un quiz, por tipo.
const QUIZ_DONE = {};
