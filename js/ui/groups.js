'use strict';
/* Grupos de palabras. Hay dos tipos, cada uno con el ejercicio que mejor le va:
   - «Significado parecido» (bawl, blubber, gloom → tristeza): se emparejan las palabras
     con definiciones cortas que marcan el matiz de cada una.
   - «Se escriben parecido» (dazzled, gazed): opción múltiple entre las mismas palabras;
     elegir una y otra vez entre ellas obliga a pensar justo la diferencia.
   Se crean en Agregar → Grupo (con palabras nuevas o ya guardadas), se gestionan en
   Mis palabras → Grupos y se repasan desde Estudiar → Repaso de grupos (uno o varios a la vez).
   Usa el quiz de session.js y se registra en el router y en las acciones. */

const GROUP_TYPES = {
  meaning: {
    label: 'Significado parecido', short: 'Significado', icon: 'link', max: 8, exercise: 'Emparejar',
    desc: 'Significan casi lo mismo, como <b>bawl</b>, <b>blubber</b> y <b>gloom</b>. Se practican uniendo cada una con su definición.',
  },
  spelling: {
    label: 'Se escriben parecido', short: 'Escritura', icon: 'twin', max: 4, exercise: 'Elegir',
    desc: 'Se escriben o suenan parecido, como <b>dazzled</b> y <b>gazed</b>. Se practican eligiendo la correcta entre cartas.',
  },
};
const GROUP_GAPS = [1, 3, 7, 14, 30];   // días hasta volver a repasar un grupo que salió bien
const DEF_MAX_WORDS = 8;

// En el celular la vista previa queda debajo del formulario: la acerca al terminar.
function revealPreview() {
  if (matchMedia('(min-width: 900px)').matches) return;
  view.querySelector('.col-preview > .card')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

const groups = () => state.data.groups || [];
const findGroup = id => groups().find(g => g.id === id);
const groupWords = g => g.ids.map(findWord).filter(Boolean);
const typeOf = t => GROUP_TYPES[t] || GROUP_TYPES.spelling;
const gtype = g => typeOf(g?.type);
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const wordCount = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/* Definición corta de respaldo (sin IA): la definición de la palabra si es breve, si no
   su primera cláusula; y si no hay definición, la traducción. */
function shortDefinition(w) {
  if (!w) return '';
  const d = String(w.definition || '').trim().replace(/\.$/, '');
  if (!d) return primaryMeaning(w) || firstMeaning(w.translation);
  const n = wordCount(d);
  if (n <= 12) return d;
  const clause = d.split(/\s*[;,(—–]\s*/)[0].trim();
  return wordCount(clause) >= 3 && wordCount(clause) <= 12 ? clause : `${d.split(/\s+/).slice(0, 10).join(' ')}…`;
}
const groupDef = (g, w) => g.defs?.[w.id] || shortDefinition(w);
const groupTitle = g => (g.name ? cap(g.name) : groupWords(g).map(w => w.word).join(' · '));

// Palabras del grupo con las que se puede practicar: para emparejar basta una definición.
function groupPlayable(g) {
  const ws = groupWords(g);
  return g.type === 'meaning' ? ws.filter(w => groupDef(g, w)) : ws.filter(isStudyReady);
}
const canPractice = g => groupPlayable(g).length >= 2;

// ¿Toca repasarlo? Nunca practicado, salió mal la última vez (y fue otro día) o ya pasó su intervalo.
function groupDue(g, now = Date.now()) {
  if (!canPractice(g)) return false;
  if (!g.lastAt) return true;
  if ((g.last ?? g.best) < 80) return startOfDay(g.lastAt) < startOfDay(now);
  return now >= addDays(startOfDay(g.lastAt), GROUP_GAPS[Math.min(Math.max(1, g.runs), GROUP_GAPS.length) - 1]);
}

function agoText(ts, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  return days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`;
}

// Busca en tus palabras por la palabra o su lema ("lads ((amigos))" → lads).
function findMyWord(text) {
  const k = normalize(parseWordLine(text).word);
  return k ? state.data.words.find(x => normalize(x.word) === k || lemmaOf(x) === k) : null;
}

function addGroup({ type, name = '', ids, defs = {} }) {
  const g = normalizeGroup({ id: uid(), type, name, ids, defs, createdAt: Date.now() });
  state.data.groups = [...groups(), g];
  persist();
  return g;
}

/* Pares de tu lista que se escriben parecido, más los que la IA marcó como
   confundibles en un rescate. Los más parecidos primero. */
function spellingSuggestions(limit = 6) {
  const ws = state.data.words.filter(isStudyReady).slice(-600);
  const grouped = groups().map(g => new Set(g.ids));
  const found = new Map();
  const add = (a, b, d) => {
    const key = [a.id, b.id].sort().join('|');
    if (a === b || grouped.some(s => s.has(a.id) && s.has(b.id))) return;
    if (!found.has(key) || found.get(key).d > d) found.set(key, { a, b, d });
  };
  const byWord = new Map(ws.map(w => [normalize(w.word), w]));
  for (const w of ws) for (const c of w.rescueAid?.confusables || []) { const o = byWord.get(normalize(c.word)); if (o) add(w, o, 0); }
  const norm = ws.map(w => normalize(w.word));
  for (let i = 0; i < ws.length; i++) {
    const a = norm[i];
    if (a.length < 4 || a.includes(' ')) continue;
    for (let j = i + 1; j < ws.length; j++) {
      const b = norm[j];
      if (b.length < 4 || a === b || Math.abs(a.length - b.length) > 3 || b.includes(' ')) continue;
      const d = levenshtein(a, b);
      if (d <= 2 || (d <= 3 && Math.max(a.length, b.length) >= 7)) add(ws[i], ws[j], d);
    }
  }
  return [...found.values()].sort((x, y) => x.d - y.d).slice(0, limit);
}

/* Preguntas de contraste para un grupo de escritura (opción múltiple entre sus palabras):
   1) oración del libro o de un ejemplo con hueco → qué palabra va;
   2) significado → qué palabra es;
   3) palabra → qué significa (si los significados no se repiten). */
function spellingQuestions(ws, max = 12) {
  const meaning = w => primaryMeaning(w) || w.definition;
  const compare = `<div class="sim-compare">${ws.map(x => `<div><b>${esc(x.word)}</b><span>${esc(meaning(x))}</span></div>`).join('')}</div>`;
  const wordOpts = w => shuffle(ws.map(x => ({ text: x.word, correct: x === w })));
  const distinctMeanings = new Set(ws.map(x => normalize(meaning(x)))).size === ws.length;
  const base = { kind: 'mc', input: '', answered: false, ok: null, after: compare };
  const qs = [];
  for (const w of ws) {
    for (const s of [...bookContexts(w).map(c => c.text), ...shuffle(w.examples)]) {
      const f = findForm(s, w.word, w.forms);
      if (!f) continue;
      const sentence = fill => `<span class="muted">¿Qué palabra completa la oración?</span>
        <p class="sentence">${esc(s.slice(0, f.start))}<span class="blank" style="min-width:6ch">${fill}</span>${esc(s.slice(f.end))}</p>`;
      qs.push({ ...base, w, prompt: sentence('&nbsp;'), promptDone: sentence(esc(f.token)), options: wordOpts(w), answerText: w.word });
      break;
    }
    qs.push({ ...base, w, prompt: `<span class="muted">¿Qué palabra significa…?</span><h1 class="word-xl">${esc(meaning(w))}</h1>`, options: wordOpts(w), answerText: w.word });
    if (distinctMeanings) {
      qs.push({ ...base, w, prompt: `<span class="muted">¿Qué significa?</span>${wordTitle(w, { pin: false })}`,
        options: shuffle(ws.map(x => ({ text: meaning(x), correct: x === w }))), answerText: meaning(w) });
    }
  }
  return shuffle(qs).slice(0, max);
}

/* ---------- Piezas de vista ---------- */

const typeBadge = (type, text = typeOf(type).label) => `<span class="type-badge t-${type}">${icon(typeOf(type).icon, 14)}<span>${text}</span></span>`;

function typePicker(type, action) {
  return `<div class="gtype-picker" role="radiogroup" aria-label="Tipo de grupo">${Object.entries(GROUP_TYPES).map(([id, t]) => `
    <button type="button" class="gtype t-${id} ${type === id ? 'on' : ''} ${type === id && state.ui.justType ? 'just' : ''}" role="radio" aria-checked="${type === id}" data-action="${action}" data-type="${id}">
      <span class="gtype-icon">${icon(t.icon, 22)}</span>
      <span class="stack-xs grow"><b>${t.label}</b><span>${t.desc}</span></span>
      <span class="gtype-radio" aria-hidden="true"></span>
    </button>`).join('')}</div>`;
}

function filterChips(f, all, action) {
  const n = k => all.filter(g => k === 'all' || g.type === k).length;
  return `<div class="filter-chips" role="tablist" aria-label="Filtrar grupos">${[['all', 'Todos'], ['meaning', 'Significado'], ['spelling', 'Escritura']].map(([k, l]) => `
    <button type="button" class="fchip ${k === 'all' ? '' : 't-' + k} ${f === k ? 'on' : ''}" role="tab" aria-selected="${f === k}" data-action="${action}" data-filter="${k}">${k === 'all' ? '' : icon(GROUP_TYPES[k].icon, 14)}<span>${l}</span><span class="n">${n(k)}</span></button>`).join('')}</div>`;
}

// Contenido del grupo: definiciones (significado) o palabras enfrentadas (escritura).
function groupBody(g, ws = groupWords(g)) {
  if (g.type === 'meaning') {
    return `<div class="gdefs">${ws.map(w => `<div><b>${esc(w.word)}</b><span>${esc(groupDef(g, w) || 'sin definición')}</span></div>`).join('')}</div>`;
  }
  return `<div class="sim-words">${ws.map((w, i) => `${i ? '<span class="sim-vs">vs</span>' : ''}<span class="sim-word"><b>${esc(w.word)}</b><span>${esc(primaryMeaning(w) || w.definition || 'sin significado')}</span></span>`).join('')}</div>`;
}

function groupStats(g) {
  const due = groupDue(g) ? '<span class="due-dot" title="Toca repasarlo"></span>' : '';
  if (!g.runs) return `<span class="group-stats">${due}<span>Sin practicar</span></span>`;
  const p = g.last ?? g.best;
  return `<span class="group-stats">${due}<span>${cap(agoText(g.lastAt))}</span><span class="mini-bar" aria-hidden="true"><i style="width:${p}%"></i></span><b>${p} %</b></span>`;
}

/* ---------- Agregar → Grupo ---------- */

function groupDraft() {
  return (state.ui.groupDraft ||= { type: 'meaning', theme: '', text: '', items: null, busy: false, error: null, saved: null });
}

// Ilustración animada del ejercicio que tendrá el grupo.
function exerciseMock(type) {
  if (type === 'meaning') {
    const pairs = [['bawl', 'cry loudly, like a child'], ['blubber', 'cry noisily and messily'], ['gloom', 'a heavy, dark sadness']];
    return `<div class="mock mock-match" aria-hidden="true">
      <div class="mock-col">${pairs.map(([w], i) => `<i style="--d:${i * 2}s">${w}</i>`).join('')}</div>
      <div class="mock-col">${[2, 0, 1].map(i => `<i class="d" style="--d:${i * 2}s">${pairs[i][1]}</i>`).join('')}</div>
    </div>`;
  }
  return `<div class="mock mock-cards" aria-hidden="true">
    <span class="mock-prompt">«deslumbrado»</span>
    <div class="mock-grid">${['gazed', 'dazzled', 'dazed', 'glazed'].map((w, i) => `<i class="${i === 1 ? 'ok' : i === 2 ? 'bad' : ''}">${w}</i>`).join('')}</div>
  </div>`;
}

function draftPreview(d) {
  const newCount = d.items.filter(it => !it.existingId).length;
  return `<section class="card stack gd-preview t-${d.type} ${d.fresh ? 'fresh' : ''}">
    <div class="row between top nowrap">
      <div class="stack-xs" style="min-width:0">${typeBadge(d.type)}<h2 class="group-title">${esc(d.theme.trim() ? cap(d.theme.trim()) : 'Tu grupo')}</h2></div>
      <button type="button" class="icon-btn" data-action="gd-discard" aria-label="Descartar grupo" title="Descartar">${icon('x')}</button>
    </div>
    <p class="hint">${d.type === 'meaning'
      ? 'Revisa las definiciones: cortas y con el matiz de cada palabra, para que al emparejar no haya dudas.'
      : 'Estos significados aparecen en las cartas. Puedes ajustarlos.'}</p>
    <div class="gd-list">${d.items.map((it, i) => {
      const w = it.existingId && findWord(it.existingId);
      const tr = w ? primaryMeaning(w) : firstMeaning(it.content?.translation);
      const n = wordCount(it.def);
      return `<div class="gd-row" style="--i:${i}">
        <div class="gd-word"><b>${esc(w ? w.word : it.content?.word || it.word)}</b>${speakBtn(it.word, 'Escuchar', 'sm')}
          <span class="chip ${w ? '' : 'chip-accent'}">${w ? 'En tu lista' : 'Nueva'}</span>${tr ? `<span class="muted small">${esc(tr)}</span>` : ''}</div>
        <button type="button" class="icon-btn gd-x" data-action="gd-remove" data-idx="${i}" aria-label="Quitar ${esc(it.word)}" title="Quitar">${icon('x', 18)}</button>
        <div class="gd-def-wrap">
          <input class="input gd-def" data-bind="gd-def" data-idx="${i}" value="${esc(it.def)}" placeholder="Definición corta, máx. ${DEF_MAX_WORDS} palabras" aria-label="Definición de ${esc(it.word)}" autocomplete="off" spellcheck="false">
          <span class="gd-count ${n > DEF_MAX_WORDS ? 'over' : ''}" aria-hidden="true">${n}/${DEF_MAX_WORDS}</span>
        </div>
      </div>`;
    }).join('')}</div>
    ${d.items.some(it => it.content?._aiMissing) ? banner('warn', 'Faltan datos de la IA para alguna palabra', 'Se guardará con la definición del grupo; puedes completarla después en Mis palabras.') : ''}
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="gd-save" ${d.items.length >= 2 ? '' : 'disabled'}>${icon('check', 18)}<span>Guardar grupo${newCount ? ` y ${plural(newCount, 'palabra nueva', 'palabras nuevas')}` : ''}</span></button>
      <button type="button" class="btn-link" data-action="gd-discard">Descartar</button>
    </div>
  </section>`;
}

function savedCard(g) {
  return `<section class="card stack-lg gd-saved t-${g.type}">
    <div class="gd-saved-head">
      <span class="gd-saved-icon">${icon('tick', 28)}</span>
      <div class="stack-xs" style="min-width:0"><span class="eyebrow">¡Grupo creado!</span><h2 class="group-title">${esc(groupTitle(g))}</h2></div>
    </div>
    ${groupBody(g)}
    <div class="actions">
      ${canPractice(g) ? `<button type="button" class="btn btn-primary" data-action="group-practice" data-id="${esc(g.id)}">${icon(gtype(g).icon, 18)}<span>Practicar ahora</span></button>` : ''}
      <button type="button" class="btn btn-secondary" data-action="gd-reset">Crear otro</button>
      <a class="btn-link" href="#/grupos">Ver mis grupos</a>
    </div>
  </section>`;
}

function renderAddGroup() {
  const d = groupDraft();
  const t = typeOf(d.type);
  const saved = d.saved && findGroup(d.saved);
  const busy = d.busy;
  const right = saved ? savedCard(saved) : d.items ? draftPreview(d)
    : `<div class="card card-dashed gd-empty t-${d.type}">
        ${exerciseMock(d.type)}
        <b>Así lo practicarás</b>
        <span class="small">${d.type === 'meaning' ? 'Unirás cada palabra con su definición corta.' : 'Verás una pista y elegirás la palabra correcta entre cartas.'}</span>
      </div>`;
  return `
  <div class="add-head"><div class="page-head"><span class="muted small">Vocabulario</span><h1>Crear un grupo</h1></div>${addTabs('grupo')}</div>
  <div class="split">
    <div class="col-input stack">
      <span class="label">Tipo de grupo</span>
      ${typePicker(d.type, 'gd-type')}
      <div class="field">
        <label for="gd-text" class="label">Palabras, una por línea <span class="hint">· de 2 a ${t.max}</span></label>
        <textarea id="gd-text" class="textarea big" rows="5" data-bind="gd-text" placeholder="${d.type === 'meaning' ? 'bawl&#10;blubber&#10;gloom' : 'dazzled&#10;gazed&#10;dazed'}" autocapitalize="off" spellcheck="false" ${busy ? 'readonly' : ''}>${esc(d.text)}</textarea>
      </div>
      <div class="field">
        <label for="gd-theme" class="label">Tema <span class="hint">· opcional${hasKey() && d.type === 'meaning' ? ', la IA lo sugiere' : ''}</span></label>
        <input id="gd-theme" class="input" data-bind="gd-theme" value="${esc(d.theme)}" placeholder="${d.type === 'meaning' ? 'tristeza' : 'mirar y deslumbrar'}" autocomplete="off" ${busy ? 'readonly' : ''}>
      </div>
      <p class="hint">Pueden ser palabras nuevas o que ya tengas. Las nuevas también se guardan en Mis palabras.</p>
      <button type="button" class="btn btn-primary btn-block" data-action="gd-ai" ${busy ? 'disabled' : ''}>
        ${busy ? '<span class="spinner"></span>' : icon('sparkle')}<span>${busy ? 'Creando el grupo…' : 'Crear con IA'}</span>
      </button>
      <button type="button" class="btn btn-secondary btn-block" data-action="gd-manual" ${busy ? 'disabled' : ''}>Escribir las definiciones a mano</button>
      ${!hasKey() ? inlineKeyCard() : ''}
    </div>
    <div class="col-preview stack">
      ${d.error ? banner('err', 'No se pudo completar con IA', esc(d.error), '', true) : ''}
      ${right}
    </div>
  </div>`;
}

// Líneas del cuadro → elementos del borrador, enlazados a tus palabras si ya existen.
function parseGroupLines(d) {
  const max = typeOf(d.type).max;
  const seen = new Set();
  const items = uniqueLines(d.text).map(p => {
    const w = findMyWord(p.word);
    return { word: w ? w.word : p.word, note: p.note, existingId: w?.id || null, content: null, def: '' };
  }).filter(it => !it.existingId || (!seen.has(it.existingId) && seen.add(it.existingId)));
  if (items.length < 2) { toast('Escribe al menos 2 palabras, una por línea.'); return null; }
  if (items.length > max) { toast(`Un grupo de este tipo admite hasta ${max} palabras.`); return null; }
  return items;
}

/* ---------- Mis palabras → Grupos ---------- */

function groupEditCard(g, ed) {
  const ws = ed.ids.map(findWord).filter(Boolean);
  return `<section class="card stack group-card is-editing t-${g.type}">
    <div class="row between">${typeBadge(g.type)}<span class="eyebrow">Editando</span></div>
    <div class="field"><label class="label" for="ge-name">Tema</label>
      <input id="ge-name" class="input" data-bind="ge-name" value="${esc(ed.name)}" placeholder="Opcional" autocomplete="off"></div>
    <div class="stack-sm">
      <span class="label">${g.type === 'meaning' ? 'Definiciones cortas' : 'Significados'} <span class="hint">· vacío = el de la palabra</span></span>
      ${ws.map(w => `<div class="ge-line">
        <label class="ge-word" for="ge-${esc(w.id)}">${esc(w.word)}</label>
        <input id="ge-${esc(w.id)}" class="input" data-bind="ge-def" data-id="${esc(w.id)}" value="${esc(ed.defs[w.id] ?? '')}" placeholder="${esc(shortDefinition(w))}" autocomplete="off" spellcheck="false">
        <button type="button" class="icon-btn" data-action="ge-drop" data-id="${esc(w.id)}" aria-label="Quitar ${esc(w.word)} del grupo" title="Quitar del grupo">${icon('x', 18)}</button>
      </div>`).join('')}
    </div>
    <div class="actions">
      <button type="button" class="btn btn-primary btn-sm" data-action="ge-save">Guardar</button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="ge-cancel">Cancelar</button>
      ${hasKey() ? `<button type="button" class="btn btn-secondary btn-sm" data-action="ge-ai" ${ed.busy ? 'disabled' : ''}>${ed.busy ? '<span class="spinner"></span>' : icon('sparkle', 16)}<span>${ed.busy ? 'Escribiendo…' : 'Definiciones con IA'}</span></button>` : ''}
    </div>
  </section>`;
}

function groupCard(g, i) {
  const ed = state.ui.groupEdit;
  if (ed?.id === g.id) return groupEditCard(g, ed);
  const ws = groupWords(g);
  return `<section class="card stack group-card t-${g.type}" style="--i:${i}">
    <div class="row between top nowrap">
      <div class="stack-xs" style="min-width:0">${typeBadge(g.type)}${g.name ? `<h2 class="group-title">${esc(cap(g.name))}</h2>` : ''}</div>
      <div class="row nowrap" style="gap:2px">
        <button type="button" class="icon-btn" data-action="ge-start" data-id="${esc(g.id)}" aria-label="Editar grupo" title="Editar">${icon('edit')}</button>
        <button type="button" class="icon-btn" data-action="group-delete" data-id="${esc(g.id)}" aria-label="Borrar grupo" title="Borrar grupo">${icon('trash')}</button>
      </div>
    </div>
    ${groupBody(g, ws)}
    <div class="row between">
      ${groupStats(g)}
      ${canPractice(g) ? `<button type="button" class="btn btn-primary btn-sm" data-action="group-practice" data-id="${esc(g.id)}">${icon(gtype(g).icon, 16)}<span>Practicar</span></button>`
        : `<span class="hint">${ws.length < 2 ? 'Faltan palabras' : 'Faltan significados para practicar'}</span>`}
    </div>
  </section>`;
}

function renderGroups() {
  const f = state.ui.groupFilter || 'all';
  const all = groups();
  const list = all.filter(g => f === 'all' || g.type === f);
  const sugg = spellingSuggestions();
  return `
  <div class="row between">
    <div class="page-head"><a class="btn-link" style="align-self:flex-start;padding-left:0" href="#/palabras">← Mis palabras</a><h1>Grupos</h1></div>
    <div class="actions">
      <a class="btn btn-secondary btn-sm btn-icon-m" href="#/agregar/grupo" aria-label="Nuevo grupo" title="Nuevo grupo">${icon('plus', 18)}<span>Nuevo grupo</span></a>
      ${all.some(canPractice) ? `<a class="btn btn-primary btn-sm" href="#/estudiar/grupos">${icon('cards', 18)}<span>Repasar</span></a>` : ''}
    </div>
  </div>
  <p class="muted" style="max-width:66ch">Junta palabras que <b>significan casi lo mismo</b> (bawl, blubber, gloom) o que <b>se escriben parecido</b> (dazzled, gazed) y practícalas juntas: así aprendes justo lo que las distingue.</p>
  <div class="split" style="gap:20px">
    <div class="col-main stack">
      ${all.length ? filterChips(f, all, 'group-filter') : ''}
      ${list.length ? list.map(groupCard).join('')
        : all.length ? '<p class="empty">No hay grupos de este tipo todavía.</p>'
        : `<div class="card card-dashed">${icon('cards', 28)}<b>Aún no tienes grupos</b><span class="small">Crea uno con palabras que se parezcan en significado o en escritura.</span>
            <a class="btn btn-primary btn-sm" style="margin-top:10px" href="#/agregar/grupo">${icon('plus', 16)}<span>Crear un grupo</span></a></div>`}
    </div>
    ${sugg.length ? `<div class="col-side stack-lg">
      <section class="card stack-sm">
        <h2>Se escriben parecido en tu lista</h2>
        <span class="hint">Palabras de tu lista que se suelen confundir.</span>
        ${sugg.map(({ a, b }) => `<div class="row between sim-sugg"><span><b>${esc(a.word)}</b> <span class="sim-vs">vs</span> <b>${esc(b.word)}</b></span>
          <button type="button" class="btn btn-secondary btn-sm" data-action="group-suggest" data-ids="${esc(a.id)}|${esc(b.id)}">Crear grupo</button></div>`).join('')}
      </section>
    </div>` : ''}
  </div>`;
}

/* ---------- Estudiar → Repaso de grupos: elegir ---------- */

function initGroupPick() {
  if (!state.ui.groupPick) state.ui.groupPick = new Set(groups().filter(g => groupDue(g)).map(g => g.id));
  for (const id of state.ui.groupPick) { const g = findGroup(id); if (!g || !canPractice(g)) state.ui.groupPick.delete(id); }
  return state.ui.groupPick;
}

function pickTile(g, i) {
  const ok = canPractice(g), on = state.ui.groupPick.has(g.id), due = groupDue(g);
  const meta = !ok ? 'Faltan significados'
    : `${due ? '<span class="due-dot"></span><span>Toca repasarlo</span><span class="sep">·</span>' : ''}<span>${g.runs ? `${cap(agoText(g.lastAt))} · ${g.last ?? g.best} %` : 'Nuevo'}</span>`;
  return `<button type="button" class="gpick-tile t-${g.type} ${on ? 'is-on' : ''}" style="--i:${i}" data-action="pick-toggle" data-id="${esc(g.id)}" aria-pressed="${on}" ${ok ? '' : 'disabled'}>
    <span class="gpick-check" aria-hidden="true">${icon('tick', 16)}</span>
    ${typeBadge(g.type, typeOf(g.type).short)}
    <span class="gpick-title">${esc(groupTitle(g))}</span>
    ${g.name ? `<span class="gpick-words">${groupWords(g).map(w => esc(w.word)).join(' · ')}</span>` : ''}
    <span class="gpick-meta">${meta}</span>
  </button>`;
}

function pickBarHTML() {
  const gs = [...state.ui.groupPick].map(findGroup).filter(Boolean);
  const words = new Set(gs.flatMap(g => groupPlayable(g).map(w => w.id))).size;
  return `<span class="stack-xs" style="min-width:0">
      <b>${gs.length ? plural(gs.length, 'grupo elegido', 'grupos elegidos') : 'Ningún grupo elegido'}</b>
      <span class="muted small">${gs.length ? `${plural(words, 'palabra', 'palabras')} · unos ${Math.max(1, Math.round(gs.length * 1.5))} min` : 'Toca los grupos que quieras repasar'}</span>
    </span>
    <button type="button" class="btn btn-primary" data-action="pick-start" ${gs.length ? '' : 'disabled'}><span>Empezar</span>${icon('arrow', 18)}</button>`;
}

function renderGroupPicker() {
  const all = groups();
  const head = `<div class="page-head"><a class="btn-link" style="align-self:flex-start;padding-left:0" href="#/estudiar">← Estudiar</a><h1>Repaso de grupos</h1></div>`;
  if (!all.length) {
    return `${head}
    <div class="card card-dashed gd-empty">${exerciseMock('meaning')}
      <b>Todavía no tienes grupos</b>
      <span class="small" style="max-width:46ch">Junta palabras que significan casi lo mismo o que se escriben parecido, y repásalas aquí juntas.</span>
      <div class="actions" style="justify-content:center;margin-top:10px">
        <a class="btn btn-primary btn-sm" href="#/agregar/grupo">${icon('plus', 16)}<span>Crear un grupo</span></a>
      </div>
    </div>`;
  }
  initGroupPick();
  const f = state.ui.pickFilter || 'all';
  const list = all.filter(g => f === 'all' || g.type === f);
  const due = all.filter(g => groupDue(g)).length;
  return `${head}
  <p class="muted" style="max-width:66ch">Elige uno o varios grupos. Los de <b>significado</b> se practican emparejando definiciones; los de <b>escritura</b>, eligiendo entre cartas.</p>
  <div class="gpick-tools">
    ${filterChips(f, all, 'pick-filter')}
    <div class="row gap-sm">
      ${due ? `<button type="button" class="btn-link" data-action="pick-due">Pendientes (${due})</button>` : ''}
      <button type="button" class="btn-link" data-action="pick-all">Todos</button>
      <button type="button" class="btn-link" data-action="pick-none">Ninguno</button>
    </div>
  </div>
  <div class="gpick">${list.map(pickTile).join('') || '<p class="empty">No hay grupos de este tipo.</p>'}</div>
  <div class="gpick-bar" id="gpick-bar">${pickBarHTML()}</div>`;
}

/* ---------- Estudiar → Repaso de grupos: práctica ---------- */

const curGroupStep = () => { const r = state.ui.groupRun; return r && !r.finished ? r.steps[r.pos] : null; };

function groupStep(g, multi) {
  const ws = shuffle(groupPlayable(g));
  if (g.type === 'meaning') {
    const pairs = ws.slice(0, GROUP_TYPES.meaning.max).map(w => ({ id: w.id, word: w.word, def: groupDef(g, w) }));
    const ids = pairs.map(p => p.id);
    let defs = shuffle(ids);
    for (let k = 0; k < 6 && defs.every((id, i) => id === ids[i]); k++) defs = shuffle(ids);   // que no queden en fila
    return { kind: 'match', groupId: g.id, pairs, words: ids, defs, matched: [], missed: [], pick: null, done: false, score: null };
  }
  return {
    kind: 'quiz', groupId: g.id, done: false, score: null,
    quiz: { questions: spellingQuestions(ws, multi ? 6 : 12), pos: 0, done: false, context: 'groups', title: g.name ? cap(g.name) : 'Se escriben parecido', groupId: g.id, startedAt: Date.now() },
  };
}

function startGroupRun(ids) {
  const gs = ids.map(findGroup).filter(g => g && canPractice(g));
  if (!gs.length) { toast('Elige al menos un grupo con 2 palabras listas.'); return; }
  const multi = gs.length > 1;
  const steps = gs.map(g => groupStep(g, multi));
  if (multi) steps.forEach((st, i) => { if (st.quiz) st.quiz.title = `Grupo ${i + 1} de ${steps.length}`; });
  state.ui.groupRun = { ids: gs.map(g => g.id), steps, pos: 0, startedAt: Date.now(), finished: false, celebrated: false };
  go('estudiar/practica');
}

function finishGroupStep(st, pct) {
  const run = state.ui.groupRun;
  st.done = true;
  st.score = pct;
  const g = findGroup(st.groupId);
  if (g) { g.runs++; g.best = Math.max(g.best, pct); g.last = pct; g.lastAt = Date.now(); persist(); }
  if (run.pos >= run.steps.length - 1) { run.finished = true; run.endedAt = Date.now(); }
}

const scoreCheer = p => (p === 100 ? '¡Perfecto, ya no las confundes!' : p >= 80 ? '¡Muy bien!' : p >= 50 ? 'Vas por buen camino' : 'Todavía se te mezclan');

function groupRunHead(run, label = '') {
  const n = run.steps.length;
  const st = run.steps[run.pos];
  const frac = st.done ? 1 : st.kind === 'match' ? st.matched.length / st.pairs.length : 0;
  return `<div class="study-head">
    <div class="row between nowrap">
      <span class="small" style="font-weight:600;color:var(--muted)">Repaso de grupos${n > 1 ? ` · Grupo ${run.pos + 1} de ${n}` : ''}${label ? ` · <span data-match-count>${label}</span>` : ''}</span>
      <button type="button" class="btn-link" data-action="group-exit">Salir</button>
    </div>
    <div class="progress"><div data-run-progress style="width:${Math.round(((run.pos + frac) / n) * 100)}%"></div></div>
  </div>`;
}

function renderMatch(st, run) {
  const g = findGroup(st.groupId);
  const byId = new Map(st.pairs.map(p => [p.id, p]));
  const card = (side, id, i) => {
    const m = st.matched.indexOf(id);
    const sel = st.pick?.side === side && st.pick.id === id;
    const p = byId.get(id);
    return `<button type="button" class="match-card match-${side} ${m >= 0 ? 'is-matched' : ''} ${sel ? 'is-selected' : ''}" style="--i:${i}" data-action="match-pick" data-side="${side}" data-id="${esc(id)}" ${m >= 0 ? 'disabled' : `aria-pressed="${sel}"`}>
      ${m >= 0 ? `<span class="match-num">${m + 1}</span>` : ''}<span class="match-text">${esc(side === 'w' ? p.word : p.def)}</span></button>`;
  };
  return `${groupRunHead(run, `Emparejadas ${st.matched.length} de ${st.pairs.length}`)}
  <div class="stack-lg match-wrap">
    <div class="stack-xs">
      ${typeBadge('meaning', g?.name ? esc(cap(g.name)) : 'Significado parecido')}
      <h1 class="word-lg">Une cada palabra con su definición</h1>
      <p class="muted small">Toca una palabra y luego la definición que le corresponde (o al revés).</p>
    </div>
    <div class="match">
      <div class="match-col" role="group" aria-label="Palabras">${st.words.map((id, i) => card('w', id, i)).join('')}</div>
      <div class="match-col" role="group" aria-label="Definiciones">${st.defs.map((id, i) => card('d', id, i)).join('')}</div>
    </div>
  </div>`;
}

// Las palabras del paso con su definición y traducción; las que fallaste, marcadas.
function groupCompare(g, st) {
  if (!g) return '';
  const ids = st.kind === 'match' ? st.pairs.map(p => p.id) : [...new Set(st.quiz.questions.map(q => q.w.id))];
  const missed = new Set(st.kind === 'match' ? st.missed : st.quiz.questions.filter(q => !q.ok).map(q => q.w.id));
  return `<div class="gcmp">${ids.map(findWord).filter(Boolean).map((w, i) => `
    <div class="${missed.has(w.id) ? 'missed' : ''}" style="--i:${i}">
      <span class="row between nowrap"><b>${esc(w.word)}</b><span class="row gap-sm nowrap">${missed.has(w.id) ? '<span class="chip chip-warn">Repásala</span>' : ''}${speakBtn(w.word, 'Escuchar', 'sm')}</span></span>
      <span>${esc(groupDef(g, w))}</span>
      ${w.translation ? `<span class="gcmp-tr">${esc(primaryMeaning(w) || w.translation)}</span>` : ''}
    </div>`).join('')}</div>`;
}

function renderStepDone(st, run) {
  const g = findGroup(st.groupId);
  return `${groupRunHead(run)}
  <div class="card stack-lg narrow step-done">
    <div class="row between top nowrap">
      <div class="stack-xs">${typeBadge(g?.type || 'spelling', g ? esc(groupTitle(g)) : 'Grupo')}<h1 class="word-lg">${scoreCheer(st.score)}</h1></div>
      <span class="score-pill ${st.score >= 80 ? 'good' : ''}">${st.score}%</span>
    </div>
    ${groupCompare(g, st)}
    ${actionBar(`<button type="button" class="btn btn-primary" data-action="group-next" data-autofocus><span>Siguiente grupo</span>${icon('arrow', 18)}</button>`)}
  </div>`;
}

function renderGroupSummary(run) {
  const avg = Math.round(run.steps.reduce((a, s) => a + (s.score ?? 0), 0) / run.steps.length);
  const words = new Set(run.steps.flatMap(st => (st.kind === 'match' ? st.pairs.map(p => p.id) : st.quiz.questions.map(q => q.w.id)))).size;
  const mins = Math.max(1, Math.round((run.endedAt - run.startedAt) / MINUTE));
  const single = run.steps.length === 1;
  const weak = run.steps.filter(s => s.score < 100).length;
  const title = `<span class="eyebrow">Repaso de grupos terminado</span><h1 class="word-lg">${scoreCheer(avg)}</h1>`;
  return `
  <div class="card stack-lg narrow summary-card group-summary">
    ${avg >= 80 ? `<div class="celebrate" data-celebrate="groups"><span class="celebrate-badge" aria-hidden="true">${icon('trophy', 40)}</span>${title}</div>`
      : `<div class="stack-xs">${title}<p class="muted">Mira las diferencias de abajo y vuelve a intentarlo: así se fijan.</p></div>`}
    <div class="gsum-score"><span class="hero-number"><span data-count="${avg}">${avg}</span>%</span>
      <span class="muted small">${plural(run.steps.length, 'grupo', 'grupos')} · ${plural(words, 'palabra', 'palabras')} · ${plural(mins, 'minuto', 'minutos')}</span></div>
    ${single ? groupCompare(findGroup(run.steps[0].groupId), run.steps[0]) : `<div class="gsum">${run.steps.map((st, i) => {
      const g = findGroup(st.groupId);
      return `<div class="gsum-row t-${g?.type || 'spelling'}" style="--i:${i}">
        <span class="gsum-icon">${icon(gtype(g).icon, 18)}</span>
        <span class="stack-xs" style="min-width:0"><b>${esc(g ? groupTitle(g) : 'Grupo borrado')}</b><span class="gsum-bar"><i style="width:${st.score}%"></i></span></span>
        <span class="gsum-pct">${st.score}%</span>
      </div>`;
    }).join('')}</div>`}
    <div class="gsum-actions">
      ${!single && weak && weak < run.steps.length
        ? `<button type="button" class="btn btn-primary" data-action="group-retry">Repetir los que fallaste (${weak})</button>`
        : `<button type="button" class="btn btn-primary" data-action="group-again">Practicar otra vez</button>`}
      <a class="btn btn-secondary" href="#/estudiar/grupos">Elegir otros grupos</a>
    </div>
  </div>`;
}

function renderGroupRun() {
  const run = state.ui.groupRun;
  if (!run) {
    return `<div class="card stack narrow"><p class="muted">No hay ningún repaso de grupos en curso.</p>
      <a class="btn btn-primary" style="align-self:flex-start" href="#/estudiar/grupos">Elegir grupos</a></div>`;
  }
  if (run.finished) return renderGroupSummary(run);
  const st = run.steps[run.pos];
  if (!st.done) return st.kind === 'match' ? renderMatch(st, run) : renderQuiz(st.quiz);
  return renderStepDone(st, run);
}

// Avance del emparejado sin repintar (para no cortar las animaciones de las tarjetas).
function matchProgress(st, run) {
  const bar = view.querySelector('[data-run-progress]');
  if (bar) bar.style.width = `${Math.round(((run.pos + st.matched.length / st.pairs.length) / run.steps.length) * 100)}%`;
  const c = view.querySelector('[data-match-count]');
  if (c) c.textContent = `Emparejadas ${st.matched.length} de ${st.pairs.length}`;
}

function finishMatch(st) {
  if (curGroupStep() !== st) return;
  const missed = st.pairs.filter(p => st.missed.includes(p.id)).length;
  finishGroupStep(st, Math.round(((st.pairs.length - missed) / st.pairs.length) * 100));
  if (currentRoute().param !== 'practica') return;
  render();
  animateView();
  window.scrollTo(0, 0);
}

/* ---------- Registro en el router, el quiz, los enlaces y las acciones ---------- */

ROUTES.grupos = renderGroups;
ROUTES.parecidas = renderGroups;   // dirección anterior de los grupos
NAV_PARENT.grupos = 'palabras';
NAV_PARENT.parecidas = 'palabras';
ROUTE_ENTER.grupos = () => { state.ui.groupEdit = null; };
const enterStudy = ROUTE_ENTER.estudiar;
ROUTE_ENTER.estudiar = param => {
  enterStudy(param);
  if (param === 'grupos') state.ui.groupPick = null;   // se vuelven a preseleccionar los pendientes
};

QUIZ_DONE.groups = q => {
  const st = curGroupStep();
  if (st?.quiz !== q) return;
  finishGroupStep(st, Math.round((quizScore(q) / Math.max(1, q.questions.length)) * 100));
  animateView();
};
QUIZ_RESULT.groups = () => '';

Object.assign(bindings, {
  'gd-text': el => { groupDraft().text = el.value; },
  'gd-theme': el => {
    groupDraft().theme = el.value;
    const h = view.querySelector('.gd-preview .group-title');
    if (h) h.textContent = el.value.trim() ? cap(el.value.trim()) : 'Tu grupo';
  },
  'gd-def': el => {
    const it = groupDraft().items?.[Number(el.dataset.idx)];
    if (!it) return;
    it.def = el.value;
    const c = el.parentElement.querySelector('.gd-count');
    const n = wordCount(el.value);
    if (c) { c.textContent = `${n}/${DEF_MAX_WORDS}`; c.classList.toggle('over', n > DEF_MAX_WORDS); }
  },
  'ge-name': el => { if (state.ui.groupEdit) state.ui.groupEdit.name = el.value; },
  'ge-def': el => { if (state.ui.groupEdit) state.ui.groupEdit.defs[el.dataset.id] = el.value; },
});

Object.assign(actions, {
  /* Agregar → Grupo */
  'gd-type': el => {
    const d = groupDraft();
    if (d.type === el.dataset.type) return;
    d.type = el.dataset.type;
    state.ui.justType = true;
    render();
    state.ui.justType = false;
  },
  'gd-ai': async () => {
    const d = groupDraft();
    if (d.busy) return;
    const items = parseGroupLines(d);
    if (!items) return;
    if (!hasKey()) {
      d.error = `Falta la ${aiProvider().keyLabel}. Pégala abajo o en Ajustes, o escribe las definiciones a mano.`;
      render();
      return;
    }
    d.busy = true; d.error = null; d.saved = null;
    render();
    const fresh = items.filter(it => !it.existingId).map(it => ({ word: it.word, note: it.note, lemma: enrichKey(normalize(it.word), it.note) }));
    const meaningOf = it => { const w = it.existingId && findWord(it.existingId); return w ? primaryMeaning(w) || w.definition : it.note; };
    const [enriched, group] = await Promise.all([
      fresh.length ? enrichCached(fresh) : { results: new Map(), error: null },
      fetchGroupDefs(items.map(it => ({ word: it.word, meaning: meaningOf(it) })), d.type).catch(error => ({ error })),
    ]);
    for (const it of items) {
      if (it.existingId) continue;
      const c = enriched.results.get(enrichKey(normalize(it.word), it.note));
      it.content = c ? cleanContent({ ...c, note: it.note }) : { ...cleanContent({ word: it.word, note: it.note }), _aiMissing: true };
    }
    items.forEach((it, i) => { it.def = group.defs?.[i] || shortDefinition(it.existingId ? findWord(it.existingId) : it.content) || ''; });
    if (group.theme && !d.theme.trim()) d.theme = group.theme;
    const err = group.error || enriched.error;
    Object.assign(d, { items, busy: false, fresh: true, error: err ? errorText(err) : null });
    if (currentRoute().name === 'agregar' && currentRoute().param === 'grupo') { render(); revealPreview(); }
    d.fresh = false;
  },
  'gd-manual': () => {
    const d = groupDraft();
    if (d.busy) return;
    const items = parseGroupLines(d);
    if (!items) return;
    for (const it of items) {
      const w = it.existingId && findWord(it.existingId);
      if (!w) it.content = cleanContent({ word: it.word, note: it.note });
      it.def = w ? shortDefinition(w) : '';
    }
    Object.assign(d, { items, error: null, saved: null, fresh: true });
    render();
    d.fresh = false;
    revealPreview();
    view.querySelector('.gd-def[value=""]')?.focus({ preventScroll: true });
  },
  'gd-remove': el => {
    const d = groupDraft();
    d.items?.splice(Number(el.dataset.idx), 1);
    if (!d.items?.length) d.items = null;
    render();
  },
  'gd-discard': () => { Object.assign(groupDraft(), { items: null, error: null }); render(); },
  'gd-reset': () => { groupDraft().saved = null; render(); $('#gd-text')?.focus(); },
  'gd-save': () => {
    const d = groupDraft();
    if (!d.items || d.items.length < 2) return;
    const empty = d.items.findIndex(it => !it.def.trim());
    if (empty !== -1) {
      toast(`Escribe la definición de «${d.items[empty].word}».`, 'err');
      view.querySelector(`.gd-def[data-idx="${empty}"]`)?.focus();
      return;
    }
    const ids = [], defs = {};
    let added = 0;
    for (const it of d.items) {
      let w = it.existingId && findWord(it.existingId);
      if (!w) {
        const c = cleanContent(it.content || { word: it.word, note: it.note });
        w = state.data.words.find(x => normalize(x.word) === normalize(c.word));
        if (!w) {
          w = createWord(c);
          // Sin datos de la IA, la definición del grupo es lo que la hace estudiable.
          if (!w.definition && !w.translation) w.definition = it.def.trim();
          state.data.words.push(w);
          added++;
        }
      }
      if (ids.includes(w.id)) continue;
      ids.push(w.id);
      defs[w.id] = it.def.trim();
    }
    if (ids.length < 2) { toast('El grupo necesita al menos 2 palabras distintas.', 'err'); return; }
    const g = addGroup({ type: d.type, name: d.theme.trim(), ids, defs });
    Object.assign(d, { items: null, text: '', theme: '', error: null, saved: g.id });
    toast(`Grupo creado${added ? ` · ${plural(added, 'palabra nueva', 'palabras nuevas')} en Mis palabras` : ''}`);
    render();
    revealPreview();
  },

  /* Mis palabras → Grupos */
  'group-filter': el => { state.ui.groupFilter = el.dataset.filter; render(); },
  'group-practice': el => startGroupRun([el.dataset.id]),
  'group-delete': el => {
    const g = findGroup(el.dataset.id);
    if (!g || !confirm(`¿Borrar el grupo «${groupTitle(g)}»? Las palabras se quedan en tu lista.`)) return;
    state.data.groups = groups().filter(x => x.id !== g.id);
    persist();
    toast('Grupo borrado');
    render();
  },
  'ge-start': el => {
    const g = findGroup(el.dataset.id);
    if (!g) return;
    state.ui.groupEdit = { id: g.id, name: g.name, defs: { ...g.defs }, ids: [...g.ids], busy: false };
    render();
    $('#ge-name')?.focus();
  },
  'ge-cancel': () => { state.ui.groupEdit = null; render(); },
  'ge-drop': el => {
    const ed = state.ui.groupEdit;
    if (!ed) return;
    ed.ids = ed.ids.filter(id => id !== el.dataset.id);
    render();
  },
  'ge-save': () => {
    const ed = state.ui.groupEdit, g = ed && findGroup(ed.id);
    if (!g) return;
    const ids = ed.ids.filter(id => findWord(id));
    if (ids.length < 2) { toast('Un grupo necesita al menos 2 palabras. Si ya no lo quieres, bórralo.', 'err'); return; }
    g.name = ed.name.trim();
    g.ids = ids;
    g.defs = Object.fromEntries(ids.map(id => [id, String(ed.defs[id] ?? '').trim()]).filter(([, v]) => v));
    state.ui.groupEdit = null;
    persist();
    toast('Grupo guardado');
    render();
  },
  'ge-ai': async () => {
    const ed = state.ui.groupEdit, g = ed && findGroup(ed.id);
    if (!g || ed.busy) return;
    const ws = ed.ids.map(findWord).filter(Boolean);
    ed.busy = true;
    render();
    try {
      const { theme, defs } = await fetchGroupDefs(ws.map(w => ({ word: w.word, meaning: primaryMeaning(w) || w.note })), g.type);
      ws.forEach((w, i) => { if (defs[i]) ed.defs[w.id] = defs[i]; });
      if (!ed.name.trim() && theme) ed.name = theme;
    } catch (e) {
      toast(errorText(e), 'err');
    }
    ed.busy = false;
    if (state.ui.groupEdit === ed) refreshIfOn('grupos');
  },
  'group-suggest': el => {
    addGroup({ type: 'spelling', ids: el.dataset.ids.split('|') });
    toast('Grupo creado');
    render();
  },

  /* Estudiar → Repaso de grupos */
  'pick-filter': el => { state.ui.pickFilter = el.dataset.filter; render(); },
  'pick-toggle': el => {
    const p = initGroupPick(), id = el.dataset.id;
    const on = !p.has(id);
    if (on) p.add(id); else p.delete(id);
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-pressed', on);
    el.classList.remove('just');
    void el.offsetWidth;   // reinicia la animación del check
    el.classList.add('just');
    $('#gpick-bar').innerHTML = pickBarHTML();
  },
  'pick-due': () => { state.ui.groupPick = new Set(groups().filter(g => groupDue(g)).map(g => g.id)); render(); },
  'pick-all': () => {
    const f = state.ui.pickFilter || 'all';
    state.ui.groupPick = new Set(groups().filter(g => canPractice(g) && (f === 'all' || g.type === f)).map(g => g.id));
    render();
  },
  'pick-none': () => { state.ui.groupPick = new Set(); render(); },
  'pick-start': () => {
    const p = initGroupPick();
    startGroupRun(groups().filter(g => p.has(g.id)).map(g => g.id));
  },
  'match-pick': el => {
    const run = state.ui.groupRun, st = curGroupStep();
    if (!st || st.kind !== 'match' || st.done || st.lock) return;
    const side = el.dataset.side, id = el.dataset.id;
    if (st.matched.includes(id)) return;
    const box = el.closest('.match');
    const cardOf = (s, i) => box.querySelector(`.match-card[data-side="${s}"][data-id="${CSS.escape(i)}"]`);
    const select = (c, on) => { c?.classList.toggle('is-selected', on); c?.setAttribute('aria-pressed', on); };
    // Misma columna: cambia (o quita) la selección.
    if (!st.pick || st.pick.side === side) {
      const same = st.pick?.id === id;
      if (st.pick) select(cardOf(st.pick.side, st.pick.id), false);
      st.pick = same ? null : { side, id };
      if (!same) select(el, true);
      return;
    }
    const other = cardOf(st.pick.side, st.pick.id);
    const wordId = side === 'w' ? id : st.pick.id, defId = side === 'd' ? id : st.pick.id;
    st.pick = null;
    select(other, false);
    select(el, false);
    if (wordId === defId) {
      st.matched.push(wordId);
      const k = st.matched.length;
      for (const c of [el, other]) {
        c.classList.add('is-matched');
        c.disabled = true;
        c.removeAttribute('aria-pressed');
        c.insertAdjacentHTML('afterbegin', `<span class="match-num">${k}</span>`);
      }
      matchProgress(st, run);
      if (k === st.pairs.length) { st.lock = true; setTimeout(() => finishMatch(st), 750); }
    } else {
      // Las dos palabras implicadas se confundieron: cuentan como falladas.
      for (const x of [wordId, defId]) if (!st.missed.includes(x)) st.missed.push(x);
      for (const c of [el, other]) { c.classList.remove('is-wrong'); void c.offsetWidth; c.classList.add('is-wrong'); }
      setTimeout(() => [el, other].forEach(c => c.classList.remove('is-wrong')), 650);
    }
  },
  'group-next': () => {
    const run = state.ui.groupRun;
    if (!run || run.finished || !run.steps[run.pos]?.done) return;
    run.pos++;
    render();
    animateView();
    window.scrollTo(0, 0);
  },
  'group-exit': () => {
    state.ui.groupRun = null;
    go('estudiar/grupos');
  },
  'group-again': () => { const run = state.ui.groupRun; if (run) startGroupRun(run.ids); },
  'group-retry': () => {
    const run = state.ui.groupRun;
    if (run) startGroupRun(run.steps.filter(s => s.score < 100).map(s => s.groupId));
  },
});
