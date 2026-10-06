'use strict';
/* UI: acciones de clics y formularios. */

/* ---------- Acciones (clics y envíos de formularios) ---------- */

function advance() {
  const s = state.ui.session;
  s.pos++;
  s.done++;
  prepareExercise();
  render();
  animateView();
  window.scrollTo(0, 0);
}

function startSession(segId = null, all = false, hard = false) {
  state.ui.session = buildSession(state.data, { segId, all, hard });
  prepareExercise();
  go('estudiar/diario');
}

const actions = {
  speak: el => speak(el.dataset.text),

  /* Sesión */
  'start-session': el => startSession(el.dataset.seg || null, el.dataset.all === '1', el.dataset.hard === '1'),
  'next-block': () => {
    const s = state.ui.session;
    if (!s?.betweenBlocks) return;
    s.betweenBlocks = false;
    s.blockStart = s.queue.length;
    if (s.block < s.blocks.length - 1) {
      s.block++;
      s.queue.push(...s.blocks[s.block]);
    } else {
      s.reviewing = true;   // tras el último bloque: repaso de las que más costaron
      s.queue.push(...hardIds(segmentById(s.segId)));
    }
    prepareExercise();
    render();
    animateView();
    window.scrollTo(0, 0);
  },
  'force-session': () => {
    const segId = state.ui.session?.segId || null;
    state.ui.session = buildSession(state.data, { force: true, segId });
    prepareExercise();
    render();
  },
  'end-session': () => {
    const s = state.ui.session;
    if (!s) return;
    // Terminar en la pausa entre bloques cuenta como sesión completa: los bloques hechos se terminaron.
    const atBreak = !!s.betweenBlocks;
    s.betweenBlocks = false;
    finishSession(s, atBreak);
    render();
    animateView();
  },
  'exposure-done': () => {
    const s = state.ui.session, w = curWord();
    if (!w || s.ex.done) return;
    s.ex.done = true;
    const now = Date.now();
    markIntroduced(w, now);
    // Tras verla, pasa a Reconocimiento y vuelve a aparecer en esta misma sesión.
    w.stage = Math.max(2, w.stage);
    w.srs = { ...w.srs, due: now };
    recordActivity(state.data.stats, now);
    persist();
    requeueWord(s, w.id, wordMode(w) === 'intensive' ? 1 : 2);
    advance();
  },
  // Elección múltiple: tocar una opción solo la marca; «Comprobar» la confirma.
  choose: el => {
    const ex = state.ui.session?.ex;
    if (!curWord() || ex.phase !== 'ask') return;
    ex.picked = Number(el.dataset.idx);
    render();
  },
  'confirm-choice': () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex.phase !== 'ask' || ex.picked == null) return;
    ex.chosen = ex.picked;
    ex.result = { ok: ex.options[ex.chosen].correct };
    ex.phase = 'answered';
    if (ex.result.ok) finishItem(w, 'good', +1, { exType: 2 });
    else finishItem(w, 'again', -1, { requeue: true, exType: 2 });
    render();
  },
  'check-typed': form => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex.phase !== 'ask') return;
    const input = form.elements.answer.value;
    if (!input.trim()) { toast('Escribe tu respuesta o pulsa "No me acuerdo".'); return; }
    ex.input = input;
    const alts = [w.word, w.lemma, ...w.forms].filter(Boolean);
    ex.result = ex.cloze ? checkAnswer(input, ex.cloze.answer, alts) : checkAnswer(input, w.word, alts);
    ex.phase = 'answered';
    // Si acierta, la calificación la elige con los 4 botones; si falla, cuenta como "Otra vez".
    if (!ex.result.ok) {
      const m = input.trim().toLowerCase();
      w.mistakes = [m, ...(w.mistakes || []).filter(x => x !== m)].slice(0, 5);   // pistas para el rescate
      finishItem(w, 'again', -1, { requeue: true, exType: ex.type });
    }
    render();
  },
  'check-meaning': form => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex.type !== 7 || ex.phase !== 'ask') return;
    const input = form.elements.answer.value;
    if (!input.trim()) { toast('Escribe el significado o pulsa "No me acuerdo".'); return; }
    ex.input = input.trim();
    ex.result = checkMeaning(input, w);
    ex.pending = !ex.result.ok;   // si no coincide, el usuario decide si era un sinónimo
    ex.phase = 'answered';
    render();
  },
  'meaning-accept': () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || !ex?.pending) return;
    const k = normalize(ex.input);
    if (k && !w.acceptedMeanings.includes(k)) w.acceptedMeanings = [...w.acceptedMeanings, k].slice(-10);
    ex.pending = false;
    ex.result = { ok: true, kind: 'self' };
    persist();
    render();
  },
  'meaning-wrong': () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || !ex?.pending) return;
    ex.pending = false;
    finishItem(w, 'again', -1, { requeue: true, exType: 7 });
    render();
  },
  'meaning-hint': () => {
    const ex = state.ui.session?.ex;
    if (ex?.type !== 7 || ex.phase !== 'ask') return;
    ex.hint = true;
    render();
  },

  /* Rescate de palabras difíciles */
  'rescue-ai': () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex?.type !== 8 || ex.loading) return;
    loadRescueAid(w, ex);
    render();
  },
  'rescue-contrast': () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex?.type !== 8) return;
    ex.qs = buildContrast(w);
    ex.qpos = 0;
    if (!ex.qs.length) { actions['rescue-done'](); return; }
    ex.phase = 'contrast';
    render();
    animateView();
  },
  'rescue-choose': el => {
    const ex = state.ui.session?.ex;
    const q = ex?.type === 8 && ex.qs[ex.qpos];
    if (!q || q.chosen != null) return;
    q.picked = Number(el.dataset.idx);
    render();
  },
  'rescue-confirm': () => {
    const ex = state.ui.session?.ex;
    const q = ex?.type === 8 && ex.qs[ex.qpos];
    if (!q || q.chosen != null || q.picked == null) return;
    q.chosen = q.picked;
    render();
  },
  'rescue-next': () => {
    const ex = state.ui.session?.ex;
    if (ex?.type !== 8 || ex.qs[ex.qpos]?.chosen == null) return;
    ex.qpos++;
    if (ex.qpos < ex.qs.length) { render(); return; }
    actions['rescue-done']();
  },
  'rescue-done': () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex?.type !== 8 || ex.loading) return;
    finishRescue(w, ex);
    toast('Palabra rescatada. Ahora, a practicarla.');
    render();
    animateView();
    window.scrollTo(0, 0);
  },
  'give-up': () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex.phase !== 'ask') return;
    ex.input = '';
    ex.result = { ok: false, kind: 'giveup' };
    ex.phase = 'answered';
    finishItem(w, 'again', -1, { requeue: true, exType: ex.type });
    render();
  },
  grade: el => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex.done) return;
    const okTyped = ex.phase === 'answered' && ex.result?.ok;
    if (!okTyped && ex.phase !== 'self') return;
    ex.done = true;
    const g = el.dataset.grade;
    if (ex.phase === 'self') saveSentence(w, ex.submitted, 'autoevaluada');
    finishItem(w, g, g === 'again' ? -1 : +1, { requeue: g === 'again', exType: ex.phase === 'self' ? 5 : ex.type });
    advance();
  },
  next: () => {
    const ex = state.ui.session?.ex;
    if ((ex?.phase === 'answered' && !ex.pending) || ex?.type === 6) advance();
  },
  'practice-sentence': () => {
    const s = state.ui.session, ex = s?.ex, w = curWord();
    if (!w || ex.mode !== 'relaxed') return;
    // Si aún no calificó un recuerdo correcto, lo cuenta como "Bien" antes de practicar.
    if (ex.phase === 'answered' && ex.result?.ok && [3, 4, 7].includes(ex.type) && !ex.done) finishItem(w, 'good', +1, { exType: ex.type });
    s.ex = { ...makeExercise(w), type: 5, mode: 'relaxed', optional: true, sentence: '', submitted: '', feedback: null, error: null, attempts: 0, warnMissing: false };
    render();
  },
  'next-optional': () => {
    const ex = state.ui.session?.ex;
    if (!ex?.optional) return;
    const w = curWord();
    if (w && ex.submitted) { saveSentence(w, ex.submitted, ex.feedback?.verdict || 'autoevaluada', ex.feedback?.natural); persist(); }
    advance();
  },
  'pron-start': async () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex.type !== 6 || ex.phase === 'listening') return;
    ex.phase = 'listening'; ex.pronError = null;
    render();
    try {
      const heard = await listenOnce();
      ex.heard = heard[0] || '';
      const target = [w.word, ...w.forms].map(normalize);
      ex.result = { ok: heard.some(h => {
        const said = normalize(h);
        // Las expresiones se buscan completas dentro de lo que se dijo.
        return target.some(x => (x.includes(' ') ? ` ${said} `.includes(` ${x} `) : said.split(' ').some(t => t === x || (x.length >= 4 && levenshtein(t, x) <= 1))));
      }) };
      if (!ex.heard) ex.pronError = SPEECH_ERRORS['no-speech'];
    } catch (e) {
      ex.pronError = SPEECH_ERRORS[e] || `No se pudo usar el micrófono (${e}).`;
    }
    ex.phase = 'ask';
    if (state.ui.session?.ex === ex) refreshIfOn('estudiar');
  },

  /* Producción con feedback de IA */
  'submit-sentence': () => submitSentence(false),
  'submit-anyway': () => submitSentence(true),
  rewrite: () => {
    const ex = state.ui.session?.ex;
    if (!ex) return;
    ex.phase = 'write';
    ex.sentence = ex.submitted || ex.sentence;
    ex.error = null;
    render();
  },
  // Destapa el repaso sin repintar, para no perder lo que se está escribiendo.
  'reveal-review': el => {
    const ex = state.ui.session?.ex;
    if (!ex) return;
    ex.reveal = true;
    ex.peeked = true;
    const box = el.closest('.review-peek');
    box?.classList.remove('is-covered');
    box?.querySelector('.peek-body')?.removeAttribute('inert');
    box?.querySelector('.peek-body')?.removeAttribute('aria-hidden');
    el.closest('.peek-cover')?.remove();
    $('#sentence')?.focus();
  },
  'self-eval': () => {
    const ex = state.ui.session?.ex;
    if (!ex) return;
    if (!ex.sentence.trim()) { toast('Escribe primero tu oración.'); return; }
    ex.submitted = ex.sentence.trim();
    ex.phase = 'self';
    render();
  },
  'save-sense': () => {
    const ex = state.ui.session?.ex, w = curWord();
    const sense = ex?.feedback?.sense;
    if (!w || !sense || ex.senseSaved) return;
    w.otherMeanings = [sense, ...(w.otherMeanings || []).filter(m => normalize(m) !== normalize(sense))].slice(0, 4);
    ex.senseSaved = true;
    persist();
    toast(`«${sense}» se guardó como otro significado de «${w.word}»`);
    render();
  },
  'production-next': () => {
    const ex = state.ui.session?.ex, w = curWord();
    if (!w || ex.done || !ex.feedback) return;
    ex.done = true;
    const v = ex.feedback.verdict;
    saveSentence(w, ex.submitted, v, ex.feedback.natural);
    if (ex.optional) { persist(); advance(); return; }
    // correcto = acierto (más difícil si necesitó reescribir); casi = se queda; incorrecto = fallo.
    if (v === 'correcto') {
      if (wordMode(w) === 'intensive' && w.stage === 5) w.passedFinal = true;
      // Si necesitó reescribir o mirar el repaso, cuenta como «Difícil».
      finishItem(w, ex.attempts > 1 || ex.peeked ? 'hard' : 'good', +1, { exType: 5 });
    } else if (v === 'casi') finishItem(w, 'hard', 0, { exType: 5 });
    else finishItem(w, 'again', -1, { requeue: true, exType: 5 });
    advance();
  },

  /* Quiz */
  'quiz-choose': el => {
    const q = activeQuiz(), item = q?.questions[q.pos];
    if (!item || item.answered) return;
    item.picked = Number(el.dataset.idx);
    render();
  },
  'quiz-confirm': () => {
    const q = activeQuiz(), item = q?.questions[q.pos];
    if (!item || item.answered || item.picked == null) return;
    item.chosen = item.picked;
    item.ok = !!item.options[item.chosen].correct;
    item.answered = true;
    render();
  },
  'quiz-typed': form => {
    const q = activeQuiz(), item = q?.questions[q.pos];
    if (!item || item.answered) return;
    const input = form.elements.answer.value;
    if (!input.trim()) { toast('Escribe tu respuesta.'); return; }
    item.input = input;
    const w = item.w;
    const alts = [w.word, w.lemma, ...(w.forms || [])].filter(Boolean);
    item.ok = checkAnswer(input, item.cloze ? item.cloze.answer : w.word, alts).ok;
    item.answered = true;
    render();
  },
  'quiz-skip-q': () => {
    const q = activeQuiz(), item = q?.questions[q.pos];
    if (!item || item.answered) return;
    item.ok = false; item.answered = true;
    render();
  },
  'quiz-next': () => {
    const q = activeQuiz();
    if (!q || !q.questions[q.pos]?.answered) return;
    q.pos++;
    if (q.pos >= q.questions.length) { q.done = true; QUIZ_DONE[q.context]?.(q); }
    render();
    window.scrollTo(0, 0);
  },
  'quiz-abort': () => {
    const q = activeQuiz();
    if (!q) return;
    if (q.context === 'minitest') { state.ui.session.quiz = null; render(); return; }
    if (q.context === 'groups') { actions['group-exit'](); return; }
    state.ui.quiz = null;
    go(q.segId ? `segmento/${q.segId}` : 'lecturas');
  },

  /* Agregar palabras */
  enrich: () => enrichAction(),
  'manual-drafts': () => {
    const u = state.ui;
    const list = uniqueLines(u.addText);
    u.drafts = (list.length ? list : [{ word: '' }]).map(p => cleanContent(p));
    u.expanded = 0; u.editingDraft = true; u.addError = null;
    render();
  },
  'continue-manual': () => {
    const u = state.ui;
    u.drafts = u.pendingWords.map(p => cleanContent(p));
    u.expanded = 0; u.editingDraft = true; u.addError = null;
    render();
  },
  'expand-draft': el => { state.ui.expanded = Number(el.dataset.idx); render(); },
  'toggle-edit-draft': () => { state.ui.editingDraft = !state.ui.editingDraft; render(); },
  'remove-draft': el => {
    const u = state.ui;
    u.drafts.splice(Number(el.dataset.idx), 1);
    u.expanded = Math.min(u.expanded, Math.max(0, u.drafts.length - 1));
    render();
  },
  'discard-drafts': () => { state.ui.drafts = []; state.ui.addError = null; render(); },
  'save-drafts': () => {
    const u = state.ui;
    const existing = new Set(state.data.words.map(w => normalize(w.word)));
    let added = 0, skipped = 0;
    for (const d of u.drafts) {
      const c = cleanContent(d);
      if (!c.word) continue;
      const k = normalize(c.word);
      if (existing.has(k)) { skipped++; continue; }
      existing.add(k);
      state.data.words.push(createWord(c));
      added++;
    }
    persist();
    u.drafts = []; u.addText = ''; u.addError = null; u.pendingWords = [];
    toast(`${plural(added, 'palabra guardada', 'palabras guardadas')}${skipped ? ` · ${skipped} repetida(s) omitida(s)` : ''}`);
    render();
  },
  'enrich-pending': async () => {
    if (state.ui.enrichBusy) return;
    const words = state.data.words.filter(w => !isStudyReady(w));
    if (!words.length) return;
    state.ui.enrichBusy = 'Completando…';
    render();
    const { done, error } = await enrichStudyWords(words, { onProgress: (i, n) => { state.ui.enrichBusy = `Completando ${i} de ${n}…`; refreshIfOn('inicio'); refreshIfOn('palabras'); } });
    state.ui.enrichBusy = '';
    toast(error ? `${errorText(error)}${done ? ` (se completaron ${done})` : ''}` : `Se completaron ${plural(done, 'palabra', 'palabras')}`, error ? 'err' : '');
    render();
  },
  'filter-noai': () => { state.ui.filter = 'noai'; go('palabras'); },
  'show-noai': () => { state.ui.filter = 'noai'; render(); },
  'toggle-pin': el => {
    const w = findWord(el.dataset.id);
    if (!w) return;
    w.pinned = !w.pinned;
    persist();
    state.ui.justPinned = w.pinned ? w.id : null;
    // En recuerdo y cloze la palabra es la respuesta: el aviso no la nombra.
    const name = el.dataset.variant === 'hidden' ? 'Palabra' : `«${w.word}»`;
    toast(w.pinned ? `${name} fijada: saldrá en cada sesión hasta que la aprendas` : `${name} ya no está fijada`);
    // Solo se repinta la lista (para no perder la búsqueda ni el scroll) o, en las
    // sesiones, el propio botón (para no perder lo que se está respondiendo).
    const list = $('#word-list');
    if (list) list.innerHTML = wordListHTML();
    else view.querySelectorAll(`.pin-btn[data-id="${CSS.escape(w.id)}"]`).forEach(b => { b.outerHTML = pinBtn(w, b.dataset.variant); });
    state.ui.justPinned = null;
  },
  'enrich-word': async el => {
    const w = findWord(el.dataset.id);
    if (!w || state.ui.enrichBusy || state.ui.enriching?.has(w.id)) return;
    if (!hasKey()) { toast('Conecta la IA en Ajustes para buscar significados.'); go('ajustes'); return; }
    state.ui.enriching = new Set([...(state.ui.enriching || []), w.id]);
    render();
    const { done, error } = await enrichStudyWords([w]);
    state.ui.enriching.delete(w.id);
    toast(error ? errorText(error) : done ? `«${w.word}» ya tiene significado` : 'La IA no devolvió un significado. Inténtalo de nuevo.', error ? 'err' : '');
    refreshIfOn('palabras');
  },

  /* Mis palabras / editar */
  'delete-word': el => {
    const w = findWord(el.dataset.id);
    if (!w || !confirm(`¿Borrar «${w.word}»? Esta acción no se puede deshacer.`)) return;
    state.data.words = state.data.words.filter(x => x.id !== w.id);
    persist();
    toast('Palabra borrada');
    if (currentRoute().name === 'editar') go('palabras'); else render();
  },
  'save-edit': () => {
    const d = state.ui.editDraft, w = d && findWord(d.id);
    if (!w) return;
    const c = cleanContent(d);
    if (!c.word) { toast('La palabra no puede estar vacía.', 'err'); return; }
    if (wordExists(c.word, w.id)) { toast(`Ya tienes «${c.word}» en tu lista.`, 'err'); return; }
    Object.assign(w, c);
    if (d.stage !== w.stage) {
      w.stage = d.stage;
      // Si se adelanta una palabra nueva a mano, pasa a repasarse desde hoy.
      if (d.stage > 1 && !w.introducedAt) { w.introducedAt = Date.now(); w.srs.due = Date.now(); }
    }
    persist();
    state.ui.editDraft = null;
    toast('Cambios guardados');
    go('palabras');
  },
  'reset-progress': () => {
    const d = state.ui.editDraft, w = d && findWord(d.id);
    if (!w || !confirm(`¿Reiniciar el progreso de «${w.word}»? Volverá a ser una palabra nueva.`)) return;
    Object.assign(w, { stage: 1, srs: newSrs(), introducedAt: null, lastReviewedAt: null, recogDays: [], successDays: [], passedFinal: false, learnedAt: null, masteredAt: null });
    d.stage = 1;
    persist();
    toast('Progreso reiniciado');
    render();
  },
  'enrich-edit': async () => {
    const u = state.ui, d = u.editDraft;
    if (!d || u.editBusy) return;
    if (!d.word.trim()) { toast('Escribe la palabra primero.'); return; }
    const w = findWord(d.id);
    u.editBusy = true; render();
    const lemma = enrichKey(normalize(d.word), d.note);
    const { results, error } = await enrichCached([{ word: d.word.trim(), note: d.note, lemma, context: w?.contexts[0]?.text || '' }]);
    const c = results.get(lemma);
    if (c) {
      let filled = 0;
      for (const k of CARD_FIELDS) {
        if (k === 'word') continue;
        const empty = Array.isArray(d[k]) ? !d[k].length : !String(d[k] || '').trim();
        if (empty && (Array.isArray(c[k]) ? c[k].length : c[k])) { d[k] = c[k]; filled++; }
      }
      toast(filled ? `Se completaron ${filled} campo(s). Revisa y guarda.` : 'No había campos vacíos para completar.');
    } else {
      toast(error ? errorText(error) : 'La IA no devolvió datos para esta palabra.', 'err');
    }
    u.editBusy = false;
    refreshIfOn('editar');
  },
  'export-csv-all': () => {
    const words = state.data.words.filter(isStudyReady);
    if (!words.length) { toast('No hay palabras con significado para exportar.'); return; }
    downloadFile(`vocabulario-anki-${dateKey(Date.now())}.csv`, exportCSV(words), 'text/csv;charset=utf-8');
  },

  /* Tu camino */
  // Despliega o pliega las palabras de un momento de «Tu historia» (sin re-render, para animarlo).
  'toggle-story': el => {
    const open = el.closest('.story-node').classList.toggle('is-open');
    el.setAttribute('aria-expanded', open);
  },

  /* Ajustes */
  'dismiss-banner': el => {
    const key = el.dataset.banner;
    const box = el.closest('.banner');
    const done = () => {
      // Aviso temporal: solo se quita de la vista (el de «conecta la IA» deja de forzarse).
      if (!key) {
        state.ui.needAi = false;
        if (state.ui.groupDraft) state.ui.groupDraft.needAi = false;
        box?.remove();
        return;
      }
      const s = state.data.settings;
      const value = el.dataset.seen != null ? Number(el.dataset.seen) : key === 'backup' ? Date.now() : true;
      s.dismissedBanners = { ...s.dismissedBanners, [key]: value };
      persist();
      render();
    };
    if (!box || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    // Fija la altura actual para que el aviso pueda colapsar con transición (ver .banner.is-leaving).
    box.style.height = `${box.offsetHeight}px`;
    box.getBoundingClientRect();
    box.classList.add('is-leaving');
    setTimeout(done, 380);
  },
  'set-provider': el => {
    const id = el.dataset.provider;
    if (!AI_PROVIDERS[id] || state.data.settings.provider === id) return;
    state.data.settings.provider = id;
    persist();
    render();
  },
  'toggle-key': el => {
    const input = $('#api-key');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? 'Ocultar' : 'Mostrar';
  },
  'test-ai': async el => {
    const out = $('#ai-status');
    out.className = 'status';
    out.textContent = 'Probando…';
    el.disabled = true;
    try {
      await callAI({
        system: 'You are a connection test. Reply only with JSON.',
        prompt: 'Return {"ok": true}.',
        schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      });
      out.textContent = `Conexión correcta con ${aiProvider().name} (${providerModel()}).`;
      out.classList.add('ok');
    } catch (e) {
      out.textContent = errorText(e);
      out.classList.add('err');
    } finally {
      el.disabled = false;
    }
  },
  export: async () => {
    try {
      downloadFile(`vocabulario-${dateKey(Date.now())}.json`, await exportAll());
      state.data.stats.lastExportAt = Date.now();
      persist();
      toast('Respaldo descargado. Guárdalo en un lugar seguro.');
      if (['inicio', 'ajustes'].includes(currentRoute().name)) render();
    } catch (e) {
      toast(`No se pudo exportar: ${e.message || e}`, 'err');
    }
  },
  'restore-samples': () => {
    const missing = sampleWords().filter(w => !wordExists(w.word));
    if (!missing.length) { toast('Las palabras de ejemplo ya están en tu lista.'); return; }
    state.data.words.push(...missing);
    persist();
    toast(`Se agregaron ${plural(missing.length, 'palabra', 'palabras')} de ejemplo`);
  },
  'wipe-all': () => {
    if (!confirm('¿Borrar TODAS tus palabras y estadísticas? Tus lecturas y el vocabulario global se conservan. Antes se guarda una copia que puedes restaurar en Ajustes → Tus datos.')) return;
    saveCopy('Antes de borrar todo');
    state.data = { ...state.data, words: [], stats: defaultStats(), captures: [], groups: [] };
    state.ui.session = null;
    persist();
    toast('Se borraron todas las palabras');
  },
};

async function submitSentence(skipWordCheck) {
  const s = state.ui.session, ex = s?.ex, w = curWord();
  if (!w || ex.type !== 5 || ex.phase === 'loading') return;
  const text = ex.sentence.trim();
  if (!text) { toast('Escribe tu oración primero.'); return; }
  if (!hasKey()) { actions['self-eval'](); return; }
  if (!skipWordCheck && !containsWord(text, w)) { ex.warnMissing = true; render(); return; }
  ex.warnMissing = false;
  ex.error = null;
  ex.phase = 'loading';
  render();
  try {
    const fb = await evaluateSentence(w, text);
    ex.feedback = fb;
    ex.submitted = text;
    ex.attempts++;
    ex.phase = 'feedback';
  } catch (e) {
    ex.error = errorText(e);
    ex.errorCode = e.code;
    ex.phase = 'write';
  }
  // Solo repinta si el usuario sigue en este mismo ejercicio.
  if (state.ui.session?.ex === ex && currentRoute().name === 'estudiar') render();
}

async function enrichAction() {
  const u = state.ui;
  if (u.addBusy) return;
  const list = uniqueLines(u.addText);
  if (!list.length) { toast('Escribe al menos una palabra.'); return; }
  u.pendingWords = list;
  if (!hasKey()) {
    u.needAi = true;   // muestra el aviso de conectar la IA aunque se haya cerrado
    render();
    return;
  }
  u.addBusy = true; u.addError = null; u.addProgress = 'Completando…';
  refreshIfOn('agregar');
  const { results, error } = await enrichCached(list.map(p => ({ ...p, lemma: enrichKey(normalize(p.word), p.note) })), {
    onProgress: (i, n) => { u.addProgress = n > ENRICH_BATCH ? `Completando ${i} de ${n}…` : 'Completando…'; refreshIfOn('agregar'); },
  });
  if (error) u.addError = errorText(error);
  // Lo que no se pudo completar queda como borrador vacío para completar a mano.
  const drafts = list.map(p => {
    const c = results.get(enrichKey(normalize(p.word), p.note));
    return c ? cleanContent({ ...c, note: p.note }) : { ...cleanContent(p), _aiMissing: true };
  });
  u.addBusy = false; u.addProgress = '';
  if (results.size) { u.drafts = drafts; u.expanded = 0; u.editingDraft = false; }
  refreshIfOn('agregar');
}
