'use strict';
/* UI: agregar, listar y editar palabras. */

/* ---------- Agregar palabras ---------- */

// Líneas del cuadro de Agregar → [{ word, note }], sin viñetas ni repetidas.
function uniqueLines(text) {
  const seen = new Set();
  return linesToArray(text)
    .map(l => parseWordLine(l.replace(/^(\d+[.)]|[-*•])\s*/, '')))  // quita viñetas o numeración
    .filter(p => { const k = normalize(p.word); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 60);
}

function inlineKeyCard() {
  const p = aiProvider();
  return `<form class="card stack-sm" data-submit="save-inline-key" autocomplete="off">
    <div class="row gap-sm"><span class="icon-tile">${icon('key')}</span><div class="stack-xs"><b>Conecta ${p.name}</b><span class="hint">Pega tu API key para completar con IA. Sin key puedes agregarlas a mano.</span></div></div>
    <div class="input-group">
      <input class="input" name="key" type="password" spellcheck="false" placeholder="${p.keyPlaceholder}" aria-label="${p.keyLabel}">
      <button class="btn btn-dark btn-sm" type="submit" style="min-height:48px">Guardar</button>
    </div>
    <p class="hint">Se guarda solo en este navegador. <a href="${p.keyUrl}" target="_blank" rel="noopener">Obtener una key</a> · <a href="#/ajustes">Cambiar de proveedor</a></p>
  </form>`;
}

function draftCard(d, i) {
  const u = state.ui;
  const dup = d.word && wordExists(d.word);
  if (i !== u.expanded) {
    return `<button type="button" class="card draft-summary" data-action="expand-draft" data-idx="${i}">
      <span class="draft-word">${esc(d.word || '(sin palabra)')}${d.note ? ` <span class="muted small">· ${esc(d.note)}</span>` : ''}</span>
      <span class="row gap-sm">${dup ? '<span class="chip chip-warn">Ya existe</span>' : ''}<span class="muted small">${esc([d.translation, d.pos].filter(Boolean).join(' · ') || 'Sin completar')}</span></span>
    </button>`;
  }
  const notes = (dup ? banner('warn', 'Ya está en tu lista', 'No se guardará de nuevo.', '', true) : '')
    + (d._aiMissing ? banner('warn', 'Sin datos de la IA', 'Complétala a mano con el botón Editar.', '', true) : '');
  if (u.editingDraft) {
    return `<div class="card stack">
      <div class="row between"><span class="eyebrow">Editando</span><button type="button" class="icon-btn" data-action="remove-draft" data-idx="${i}" aria-label="Quitar de la lista">${icon('x')}</button></div>
      ${notes}${wordFields(d, 'draft:' + i)}
    </div>`;
  }
  return `<div class="card stack">
    <div class="row between baseline">
      <span class="row gap-sm"><span class="word-lg">${esc(d.word || '(sin palabra)')}</span>${speakBtn(d.word, 'Escuchar pronunciación', 'sm')}</span>
      <span class="row gap-sm"><span class="muted small">${esc([fmtIpa(d.ipa), d.pos].filter(Boolean).join(' · '))}</span>
      <button type="button" class="icon-btn" data-action="remove-draft" data-idx="${i}" aria-label="Quitar de la lista">${icon('x')}</button></span>
    </div>
    ${notes}
    ${d.note ? `<span class="chip chip-accent" style="align-self:flex-start">${icon('edit', 14)} Tu comentario: ${esc(d.note)}</span>` : ''}
    ${wordInfo(d, { examples: 3 }) || '<p class="muted">Aún no tiene contenido. Usa Editar para completarla.</p>'}
  </div>`;
}

// Pestañas de Agregar: palabras sueltas o un grupo (ui/groups.js). El indicador se
// desliza solo al cambiar de pestaña, no en cada repintado.
function addTabs(tab) {
  const u = state.ui;
  const slide = u.addTab && u.addTab !== tab;
  u.addTab = tab;
  const t = (id, href, ic, label) => `<a class="seg-tab" role="tab" href="${href}" aria-selected="${tab === id}">${icon(ic, 18)}<span>${label}</span></a>`;
  return `<nav class="seg-tabs ${slide ? 'slide' : ''}" role="tablist" aria-label="Qué agregar" data-active="${tab === 'grupo' ? 1 : 0}">
    ${t('palabras', '#/agregar', 'list', 'Palabras')}${t('grupo', '#/agregar/grupo', 'cards', 'Grupo')}</nav>`;
}

function renderAdd(param) {
  if (param === 'grupo') return renderAddGroup();
  const u = state.ui;
  const busy = u.addBusy;
  const saveCount = u.drafts.filter(d => d.word && !wordExists(d.word)).length;

  const preview = u.drafts.length ? `
    ${u.drafts.map(draftCard).join('')}
    <div class="actions" style="padding-top:6px">
      <button type="button" class="btn btn-secondary" data-action="toggle-edit-draft">${u.editingDraft ? 'Listo' : 'Editar'}</button>
      <button type="button" class="btn btn-dark" data-action="save-drafts" ${saveCount ? '' : 'disabled'}>${saveCount === 1 ? 'Guardar la palabra' : `Guardar las ${saveCount}`}</button>
      <button type="button" class="btn-link" data-action="discard-drafts">Descartar</button>
    </div>`
    : `<div class="card card-dashed">${icon('sparkle', 28)}<b>La vista previa aparecerá aquí</b><span class="small">Podrás revisar y editar cada palabra antes de guardarla.</span></div>`;

  return `
  <div class="add-head"><div class="page-head"><span class="muted small">Vocabulario</span><h1>Agregar palabras</h1></div>${addTabs('palabras')}</div>
  <div class="split">
    <div class="col-input stack">
      <label for="words-input" class="label">Una palabra por línea</label>
      <textarea id="words-input" class="textarea big" rows="6" data-bind="addText" placeholder="reluctant&#10;lads ((amigos))&#10;overwhelm" autocapitalize="off" spellcheck="false" ${busy ? 'readonly' : ''}>${esc(u.addText)}</textarea>
      <button type="button" class="btn btn-primary btn-block" data-action="enrich" ${busy ? 'disabled' : ''}>
        ${busy ? '<span class="spinner"></span>' : icon('sparkle')}<span>${busy ? esc(u.addProgress || 'Completando…') : 'Completar con IA'}</span>
      </button>
      <button type="button" class="btn btn-secondary btn-block" data-action="manual-drafts" ${busy ? 'disabled' : ''}>Agregar a mano</button>
      ${!hasKey() ? inlineKeyCard() : ''}
    </div>
    <div class="col-preview stack">
      ${u.addError ? banner('err', 'No se pudo completar con IA', esc(u.addError),
        !u.drafts.length && u.pendingWords.length ? '<div class="actions"><button type="button" class="btn btn-dark btn-sm" data-action="continue-manual">Continuar a mano</button></div>' : '', true) : ''}
      ${preview}
    </div>
  </div>`;
}

/* ---------- Mis palabras ---------- */

const FILTERS = [
  ['all', 'Todas'], ['due', 'Para hoy'], ['new', 'Nuevas'], ['noai', 'Esperan significado'], ['reading', 'De lecturas'],
  ['s1', 'Exposición'], ['s2', 'Reconocimiento'], ['s3', 'Recuerdo'], ['s4', 'Cloze'], ['s5', 'Producción'],
  ['learned', 'Aprendidas'], ['mastered', 'Dominadas'], ['leech', 'Leeches'], ['pinned', 'Fijadas ★'],
];

function filteredWords() {
  const { search, filter } = state.ui;
  const q = normalize(search);
  const now = Date.now();
  return state.data.words.filter(w => {
    if (q && !normalize(w.word).includes(q) && !normalize(w.translation).includes(q)) return false;
    if (filter === 'due') return isDueToday(w, now) && isStudyReady(w);
    if (filter === 'new') return isNew(w);
    if (filter === 'noai') return !isStudyReady(w);
    if (filter === 'reading') return w.segIds.length > 0;
    if (filter === 'leech') return isLeech(w);
    if (filter === 'pinned') return w.pinned;
    if (filter === 'learned') return isLearned(w);
    if (filter === 'mastered') return isMastered(w);
    if (/^s\d$/.test(filter)) return w.stage === Number(filter[1]);
    return true;
  }).sort((a, b) => pinnedFirst(b) - pinnedFirst(a) || a.word.localeCompare(b.word));
}
// Las fijadas van primero, pero según cómo estaban la primera vez que se dibujó la lista
// al entrar a Mis palabras: así una palabra no salta de lugar al fijarla; se reacomoda
// al volver a entrar o recargar.
function pinnedFirst(w) {
  if (!state.ui.pinOrder) state.ui.pinOrder = new Set(state.data.words.filter(x => x.pinned).map(x => x.id));
  return Number(state.ui.pinOrder.has(w.id));
}

function wordListHTML() {
  const list = filteredWords();
  if (!state.data.words.length) return '<p class="empty">Aún no tienes palabras. <a href="#/agregar">Agrega la primera</a> o <a href="#/lecturas">prepara una lectura</a>.</p>';
  if (!list.length) return '<p class="empty">No hay palabras que coincidan.</p>';
  const now = Date.now();
  return list.map(w => {
    const mode = wordMode(w);
    return `
    <div class="list-row">
      <div class="stack-xs">
        <span class="row gap-sm"><span class="list-word">${esc(w.word)}</span>${leechBadge(w)}${isMastered(w) ? '<span class="chip chip-ok">Dominada</span>' : isLearned(w) ? '<span class="chip chip-ok">Aprendida</span>' : ''}</span>
        <span class="muted small">${isStudyReady(w) ? esc(w.translation || w.definition) : '<i>Sin significado todavía</i>'}</span>
      </div>
      <div class="list-meta">
        <span class="chip ${isDueToday(w, now) ? 'chip-accent' : ''}">${mode === 'relaxed' ? 'Relajado' : `${w.stage} · ${STAGES[w.stage]}`}</span>
        <span class="muted small">Repaso: ${formatDue(w, now)}</span>
      </div>
      <div class="list-actions">
        ${speakBtn(w.word, 'Escuchar pronunciación', 'sm')}
        ${pinBtn(w)}
        ${isStudyReady(w) ? '' : aiWordBtn(w)}
        <a class="icon-btn" href="#/editar/${encodeURIComponent(w.id)}" aria-label="Editar ${esc(w.word)}" title="Editar">${icon('edit')}</a>
        <button type="button" class="icon-btn" data-action="delete-word" data-id="${esc(w.id)}" aria-label="Borrar ${esc(w.word)}" title="Borrar">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');
}

// Botón ✦ para buscar con IA el significado de una sola palabra.
function aiWordBtn(w) {
  const busy = state.ui.enriching?.has(w.id) || !!state.ui.enrichBusy;
  return `<button type="button" class="icon-btn icon-btn-ai" data-action="enrich-word" data-id="${esc(w.id)}" aria-label="Buscar el significado de ${esc(w.word)} con IA" title="Buscar significado con IA" ${busy ? 'disabled' : ''}>
    ${state.ui.enriching?.has(w.id) ? '<span class="spinner"></span>' : icon('sparkle')}</button>`;
}

// Aviso de palabras sin significado; al cerrarlo vuelve solo si aparecen más.
function waitingBanner() {
  const waiting = state.data.words.filter(w => !isStudyReady(w)).length;
  if (!waiting || isDismissed('wordsWaiting', waiting)) return '';
  const busy = state.ui.enrichBusy;
  return banner('warn', `${plural(waiting, 'palabra no tiene', 'palabras no tienen')} significado`,
    hasKey() ? 'No entran a las sesiones hasta tenerlo. La IA puede buscarlo por ti, o usa ✦ en cada palabra.' : 'No entran a las sesiones hasta tenerlo. Conecta la IA para buscarlo automáticamente o complétalo a mano.',
    `<div class="actions">${hasKey()
      ? `<button type="button" class="btn btn-dark btn-sm" data-action="enrich-pending" ${busy ? 'disabled' : ''}>${busy ? `<span class="spinner"></span><span>${esc(busy)}</span>` : `${icon('sparkle', 18)}<span>Buscar ${waiting === 1 ? 'su significado' : 'todos los significados'}</span>`}</button>`
      : '<a class="btn btn-dark btn-sm" href="#/ajustes">Conectar la IA</a>'}
      ${state.ui.filter !== 'noai' ? '<button type="button" class="btn btn-secondary btn-sm" data-action="show-noai">Ver solo esas</button>' : ''}</div>`, 'wordsWaiting', waiting);
}

function renderWords() {
  const u = state.ui;
  return `
  <div class="row between">
    <div class="page-head"><span class="muted small">${plural(state.data.words.length, 'palabra', 'palabras')}</span><h1>Mis palabras</h1></div>
    <div class="actions">
      <a class="btn btn-secondary btn-sm btn-icon-m" href="#/grupos" aria-label="Grupos de palabras" title="Grupos de palabras">${icon('cards', 18)}<span>Grupos${groups().length ? ` · ${groups().length}` : ''}</span></a>
      <button type="button" class="btn btn-secondary btn-sm btn-icon-m" data-action="export-csv-all" aria-label="Exportar CSV para Anki" title="Exportar CSV para Anki">${icon('download', 18)}<span>CSV para Anki</span></button>
      <a class="btn btn-primary btn-sm only-desktop" href="#/agregar">${icon('plus', 18)}<span>Agregar</span></a>
    </div>
  </div>
  ${waitingBanner()}
  <div class="toolbar">
    <input type="search" class="input" placeholder="Buscar palabra o traducción" aria-label="Buscar" data-bind="search" value="${esc(u.search)}">
    <select class="input" aria-label="Filtrar" data-bind="filter">
      ${FILTERS.map(([k, l]) => `<option value="${k}" ${u.filter === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
  </div>
  <div class="card list" id="word-list">${wordListHTML()}</div>`;
}

/* ---------- Editar palabra ---------- */

function renderEdit(id) {
  const w = findWord(id);
  const d = state.ui.editDraft;
  if (!w || !d) return `<div class="page-head"><h1>Palabra no encontrada</h1></div><a class="btn btn-secondary" href="#/palabras">Volver a Mis palabras</a>`;
  const busy = state.ui.editBusy;
  const segs = w.segIds.map(segmentById).filter(Boolean);
  return `
  <div class="page-head"><a class="btn-link" style="align-self:flex-start;padding-left:0" href="#/palabras">← Mis palabras</a><h1>Editar «${esc(w.word)}»</h1></div>
  <div class="split">
    <div class="card stack col-main">
      ${wordFields(d, 'edit')}
      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="save-edit">Guardar cambios</button>
        <a class="btn btn-secondary" href="#/palabras">Cancelar</a>
        ${hasKey() ? `<button type="button" class="btn btn-secondary" data-action="enrich-edit" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : icon('sparkle')}<span>${busy ? 'Completando…' : 'Completar vacíos con IA'}</span></button>` : ''}
      </div>
    </div>
    <aside class="col-side stack">
      <div class="card stack-sm">
        <h2>Progreso</h2>
        <label class="label" for="edit-stage">Etapa</label>
        <select id="edit-stage" class="input" data-bind="edit-stage">
          ${[1, 2, 3, 4, 5].map(st => `<option value="${st}" ${d.stage === st ? 'selected' : ''}>${st} · ${STAGES[st]}</option>`).join('')}
        </select>
        <div class="kv"><span>Modo</span><b style="color:var(--text)">${MODES[wordMode(w)]}</b></div>
        <div class="kv"><span>Próximo repaso</span><b>${formatDue(w)}</b></div>
        <div class="kv"><span>Intervalo actual</span><b>${w.srs.interval} d</b></div>
        ${recallChance(w.srs) != null ? `<div class="kv"><span>Probabilidad de recordarla hoy</span><b>${Math.round(recallChance(w.srs) * 100)} %</b></div>
        <div class="kv"><span>Estabilidad · dificultad</span><b>${w.srs.stability >= 1 ? Math.round(w.srs.stability) : w.srs.stability.toFixed(1)} d · ${Math.round(w.srs.difficulty * 10) / 10} / 10</b></div>` : ""}
        <div class="kv"><span>Días con acierto</span><b>${w.successDays.length}</b></div>
        <div class="kv"><span>Fallos</span><span class="row gap-sm"><b style="color:var(--text)">${w.srs.lapses}</b>${leechBadge(w)}</span></div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="reset-progress">Reiniciar progreso</button>
      </div>
      ${w.contexts.length ? `<div class="card stack-sm"><h2>Del libro</h2>
        ${segs.map(s => `<a class="hint" href="#/segmento/${s.id}">${esc(s.title)}</a>`).join(' · ')}
        ${w.contexts.map(c => `<div class="history-item"><span>${highlightWord(c.text, w)}</span><span class="hint">${esc(c.loc || '')}</span></div>`).join('')}</div>` : ''}
      ${w.sentences.length ? `<div class="card stack-sm"><h2>Tus oraciones</h2>${w.sentences.map(s => `
        <div class="history-item"><span>${esc(s.text)}</span>
          <span class="row gap-sm"><span class="chip ${s.verdict === 'correcto' ? 'chip-ok' : s.verdict === 'casi' ? 'chip-warn' : ''}">${esc(s.verdict)}</span><span class="hint">${new Date(s.at).toLocaleDateString('es')}</span></span>
          ${s.natural && s.natural !== s.text ? `<span class="hint">Más natural: ${esc(s.natural)}</span>` : ''}
        </div>`).join('')}</div>` : ''}
      <button type="button" class="btn-link danger" style="align-self:flex-start" data-action="delete-word" data-id="${esc(w.id)}">Borrar palabra</button>
    </aside>
  </div>`;
}
