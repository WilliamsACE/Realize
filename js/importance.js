'use strict';
/* Importancia de las palabras de una lectura: qué conviene estudiar y qué dejar pasar.

   Cada palabra candidata recibe una puntuación de 0 a 100 que mezcla dos cosas:
   - importancia para el idioma: qué tan usada es en inglés (datos de wordfreq, js/freq.js,
     que se cargan solo al entrar a una lectura);
   - importancia para el texto: cuántas veces aparece en él (más veces = más útil y más
     probable que se te quede).
   Además se marcan las que normalmente NO vale la pena estudiar: tan raras que casi nadie las
   usa, anticuadas, sonidos o gritos, y posibles nombres propios o palabras de una sola aparición.
   Con eso la revisión muestra primero las más importantes, y el usuario fija una meta por
   lectura (cantidad de palabras, porcentaje de las nuevas o comprensión del texto) para
   saber cuándo parar. Se apoya en reading.js (candidatas, triage) y se registra en las acciones. */

/* ---------- Datos de frecuencia (carga perezosa) ---------- */

const freqData = { map: null, state: 'idle', version: 0, loading: null };
const FREQ_BAND = 0.5;                // cada banda cubre media unidad de Zipf (ver tools/make-freq.py)
const FREQ_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const freqLoading = () => freqData.state === 'loading';

function buildFreqMap() {
  const map = new Map();
  for (const [band, packed] of Object.entries(window.WORD_FREQ.bands)) {
    const zipf = Number(band) * FREQ_BAND + FREQ_BAND / 2;
    let prev = '';
    for (const tok of packed.split(' ')) {
      const word = prev.slice(0, FREQ_DIGITS.indexOf(tok[0])) + tok.slice(1);
      map.set(word, zipf);
      prev = word;
    }
  }
  window.WORD_FREQ = null;   // ya está en el mapa: se libera el original
  freqData.map = map;
}

// Carga js/freq.js una sola vez. Sin conexión o si falla, todo sigue funcionando sin el dato
// de idioma (solo con las veces que aparece en el texto) y se reintenta más tarde.
function ensureFreq() {
  if (freqData.state !== 'idle') return freqData.loading;
  freqData.state = 'loading';
  freqData.loading = new Promise(resolve => {
    const finish = ok => {
      try { if (ok) buildFreqMap(); } catch (e) { console.warn('Datos de frecuencia inválidos', e); ok = false; }
      freqData.state = ok ? 'ready' : 'failed';
      if (!ok) setTimeout(() => { if (freqData.state === 'failed') freqData.state = 'idle'; }, 30000);
      freqData.version++;
      resolve();
      const r = currentRoute().name;
      if (['segmento', 'triage', 'glosario'].includes(r) || (r === 'palabras' && state.ui.filter === 'lowvalue')) render();
    };
    if (window.WORD_FREQ) { finish(true); return; }
    const s = document.createElement('script');
    s.src = 'js/freq.js';
    s.async = true;
    s.onload = () => finish(!!window.WORD_FREQ);
    s.onerror = () => finish(false);
    document.head.appendChild(s);
  });
  return freqData.loading;
}

/* ---------- Puntuación ---------- */

// Formas antiguas (Biblia, Shakespeare…): son frecuentes en los datos pero no se usan al hablar.
const ARCHAIC = new Set(('thou thee thy thine thyself ye hath doth dost hast hadst didst wilt shalt wert wast canst wouldst shouldst couldst art '
  + 'whence whither hither thither thence wherefore hitherto henceforth forsooth prithee methinks nay yea ere yonder betwixt verily perchance mayhap '
  + 'quoth anon erstwhile whilom wherein thereof therein thereunto aught').split(' '));
// Sonidos y gritos («aaah», «hmm», «brr»): tres letras iguales seguidas o sin ninguna vocal.
const SOUND_WORD = /(.)\1\1|^[^aeiouy]+$/;

const clamp01 = n => Math.min(1, Math.max(0, n));
const infoCache = new WeakMap();

// Zipf de la palabra: número = frecuencia; null = más rara de lo que registran los datos;
// undefined = no se sabe (datos sin cargar, expresiones o texto con símbolos).
function zipfOf(c) {
  if (!freqData.map || c.phrase || !/^[a-z]+$/.test(c.lemma)) return undefined;
  let best = null;
  for (const f of [c.lemma, ...c.forms]) {
    const z = freqData.map.get(f);
    if (z != null && (best == null || z > best)) best = z;
  }
  return best;
}

const IMP_TIERS = [
  { min: 55, key: 'high', label: 'Muy importante' },
  { min: 38, key: 'mid', label: 'Importante' },
  { min: 22, key: 'low', label: 'Útil' },
  { min: 0, key: 'min', label: 'Poco útil' },
];

const langText = z => (z === undefined ? '' : z === null ? 'Casi no se usa en inglés' : z >= 4.5 ? 'Se usa muchísimo en inglés'
  : z >= 3.5 ? 'Se usa bastante en inglés' : z >= 3 ? 'Se usa de vez en cuando en inglés' : z >= 2.5 ? 'Es poco usada en inglés' : 'Es muy poco usada en inglés');

/* { score, tier, flags, skip, lang }. `skip`: hay un motivo firme para no estudiarla (los motivos
   «suaves» solo se muestran). Se calcula al pedirlo y se recuerda hasta que lleguen los datos. */
function infoOf(c) {
  const hit = infoCache.get(c);
  if (hit && hit.v === freqData.version) return hit;
  const z = zipfOf(c);
  const language = z === undefined ? 0.5 : z === null ? 0 : clamp01((z - 2) / 2.3);   // 2 = rara, 4.3 o más = muy común
  const text = 1 - Math.exp(-c.freq / 3);                                           // 1 vez ≈ .28 · 3 ≈ .63 · 10 ≈ .96
  const score = Math.round(100 * (c.noText ? language : 0.5 * language + 0.5 * text));   // noText: palabra sin texto de origen
  const flags = [];
  if (!c.phrase) {
    if (ARCHAIC.has(c.lemma) || c.forms.some(f => ARCHAIC.has(f))) {
      flags.push({ key: 'archaic', label: 'Anticuada', hard: c.freq < 6, why: 'Es una forma antigua que ya casi no se usa al hablar.' });
    }
    if (SOUND_WORD.test(c.lemma)) flags.push({ key: 'sound', label: 'Sonido o grito', hard: true, why: 'Parece un sonido o un grito, no una palabra para aprender.' });
    if (z === null && c.freq < 4) flags.push({ key: 'rare', label: 'Casi no se usa', hard: true, why: 'Es tan rara que casi ni los hablantes nativos la usan.' });
    if (c.capOnly && c.freq <= 3 && (z == null || z < 3.5)) flags.push({ key: 'name', label: 'Posible nombre', hard: false, why: 'Siempre aparece con mayúscula: puede ser un nombre propio.' });
    if (c.freq === 1 && typeof z === 'number' && z < 2.7) flags.push({ key: 'once', label: 'Una sola vez', hard: false, why: 'Aparece una sola vez y es poco común.' });
  }
  const info = {
    v: freqData.version, score, lang: langText(z), flags,
    tier: IMP_TIERS.find(t => score >= t.min),
    skip: flags.some(f => f.hard),
  };
  infoCache.set(c, info);
  return info;
}

// Candidatas de la lectura, de más a menos importantes (el orden de la revisión de palabras).
const rankCache = new WeakMap();
function rankedCands(seg) {
  const hit = rankCache.get(seg);
  if (hit && hit.v === freqData.version && hit.n === seg.candidates.length) return hit.list;
  const list = seg.candidates.slice().sort((a, b) => infoOf(b).score - infoOf(a).score || b.freq - a.freq || a.lemma.localeCompare(b.lemma));
  rankCache.set(seg, { v: freqData.version, n: seg.candidates.length, list });
  return list;
}

/* ---------- Mis palabras: buscar las poco útiles ---------- */

// Una palabra de tu lista vista como candidata. Las que vienen de una lectura traen cuántas veces
// aparecieron; las que escribiste tú no tienen texto, así que solo cuenta su uso en el idioma.
function wordInfo(w) {
  const forms = [...new Set([normalize(w.word), lemmaOf(w), ...(w.forms || [])])];
  return infoOf({
    lemma: normalize(w.word), forms, freq: Math.max(1, w.freq || 0), noText: !w.freq,
    phrase: /\s/.test(w.word.trim()),
  });
}

// Poco útil: hay un motivo firme (rara, anticuada, sonido) o casi no se usa en inglés (importancia < 22).
// No cuentan las que ya aprendiste ni las que fijaste: esas las elegiste tú.
const LOW_VALUE_BELOW = 22;
function isLowValue(w) {
  if (w.pinned || isLearned(w) || !freqData.map) return false;
  const i = wordInfo(w);
  return i.skip || i.score < LOW_VALUE_BELOW;
}

/* ---------- Meta de la lectura ---------- */

const PLAN_MODES = {
  count: { label: 'Cantidad', def: 15, min: 1, max: 300, presets: [10, 15, 25, 40] },
  share: { label: 'Porcentaje', def: 50, min: 5, max: 100, presets: [25, 50, 75, 100] },
  coverage: { label: 'Comprensión', def: 96, min: 80, max: 100, presets: [95, 96, 98] },
};
const STUDYING_KEYS = ['familiar', 'unknown', 'studying'];

/* Qué se necesita para cumplir la meta. Las palabras se toman en orden de importancia y las
   descartadas o con motivo firme para no estudiarlas no cuentan.
   chosen: ya elegidas · K: total que pide la meta · take: las que faltan · cur → proj: comprensión. */
function planFor(seg) {
  const plan = seg.plan || { mode: 'count', value: PLAN_MODES.count.def };
  const idx = studyIndex();
  const tokens = seg.totalTokens || 1;
  let chosen = 0, chosenFreq = 0, skipped = 0;
  const pending = [];
  for (const c of rankedCands(seg)) {
    const key = candState(c, idx).key;
    if (STUDYING_KEYS.includes(key)) { chosen++; chosenFreq += c.freq; }
    else if (key === 'skipped') skipped++;
    else if (key === 'pending') { if (infoOf(c).skip) skipped++; else pending.push(c); }
  }
  const cur = Math.min(100, segmentCoverage(seg) + (chosenFreq / tokens) * 100);
  const pool = chosen + pending.length;
  let K, reachable = true;
  if (plan.mode === 'share') K = Math.ceil((plan.value / 100) * pool);
  else if (plan.mode === 'coverage') {
    let acc = cur;
    K = chosen;
    for (const c of pending) { if (acc >= plan.value) break; acc += (c.freq / tokens) * 100; K++; }
    reachable = acc >= plan.value;
  } else K = plan.value;
  K = Math.min(K, pool);
  const take = pending.slice(0, Math.max(0, K - chosen));
  const proj = Math.min(100, cur + (take.reduce((n, c) => n + c.freq, 0) / tokens) * 100);
  return { plan, chosen, K, need: take.length, take, cur, proj, pool, reachable, skipped };
}

const planPace = seg => Math.max(1, dailyLimit(seg.mode === 'intensive' ? 'intensive' : 'relaxed') || 1);

function savePlan(seg) {
  libSaveSegment(seg);
  state.ui.planContinue?.delete(seg.id);
}

// Barra de comprensión: lo que ya sabes, lo que sumarías con tu meta y el objetivo general.
function planBar(p) {
  const target = state.data.settings.coverageTarget;
  return `<div class="plan-bar" role="img" aria-label="Comprensión actual ${fmtPct(p.cur)}, con tu meta ${fmtPct(p.proj)}">
    <i class="proj" style="width:${p.proj}%"></i><i class="now" style="width:${p.cur}%"></i><b class="goal" style="left:${target}%" title="Objetivo ${target}%"></b></div>`;
}

function planSummaryHTML(seg) {
  const p = planFor(seg);
  const per = planPace(seg);
  const rows = [];
  if (!p.pool) return '<p class="hint">No quedan palabras por estudiar en esta lectura.</p>';
  rows.push(`<div class="kv"><span>Palabras para estudiar</span><b>${p.K}${p.chosen ? ` <span class="muted">· ya llevas ${p.chosen}</span>` : ''}</b></div>`);
  rows.push(`<div class="kv"><span>Comprensión del texto</span><b>${fmtPct(p.cur)} → <span style="color:var(--accent-text)">${fmtPct(p.proj)}</span></b></div>`);
  if (p.need) rows.push(`<div class="kv"><span>A tu ritmo (${per} nuevas al día)</span><b>unos ${plural(Math.max(1, Math.ceil(p.need / per)), 'día', 'días')}</b></div>`);
  const note = p.plan.mode === 'coverage' && !p.reachable
    ? `<p class="hint">Sin las palabras descartadas llegas como máximo al ${fmtPct(p.proj)}. Si quieres más, baja la meta.</p>` : '';
  const next = p.take.length ? `<div class="stack-xs"><span class="eyebrow">Las más importantes que te faltan</span>
      <div class="chips">${p.take.slice(0, 12).map(c => `<span class="chip chip-accent">${esc(c.lemma)}</span>`).join('')}${p.take.length > 12 ? `<span class="chip">+${p.take.length - 12}</span>` : ''}</div></div>` : '';
  return `${planBar(p)}${rows.join('')}${note}${next}`;
}

function planCard(seg) {
  const p = planFor(seg);
  const m = p.plan.mode, def = PLAN_MODES[m];
  const lead = { count: ['Quiero aprender', 'palabras'], share: ['Quiero aprender el', '% de las palabras nuevas'], coverage: ['Quiero entender el', '% del texto'] }[m];
  const idx = Object.keys(PLAN_MODES).indexOf(m);
  return `<div class="card stack plan-card">
    <div class="row nowrap"><span class="icon-tile">${icon('target')}</span>
      <div class="stack-xs grow"><h2>Tu meta para esta lectura</h2>
        <span class="hint">No necesitas estudiar todas las palabras. Te mostramos primero las más importantes: las que más se usan en inglés y más aparecen en este texto.</span></div></div>
    <div class="seg-tabs n3 ${state.ui.justPlanMode ? 'slide' : ''}" role="radiogroup" aria-label="Tipo de meta" data-active="${idx}">
      ${Object.entries(PLAN_MODES).map(([k, d]) => `<button type="button" class="seg-tab" role="radio" aria-checked="${k === m}" aria-selected="${k === m}" data-action="plan-mode" data-mode="${k}">${d.label}</button>`).join('')}
    </div>
    <div class="plan-input">
      <label class="plan-lead" for="plan-value">${lead[0]}</label>
      <input id="plan-value" class="input" type="number" inputmode="numeric" min="${def.min}" max="${def.max}" value="${p.plan.value}" data-bind="plan-value" aria-describedby="plan-unit">
      <span class="plan-unit" id="plan-unit">${lead[1]}</span>
    </div>
    <div class="chips plan-presets">${def.presets.map(v => `<button type="button" class="chip ${v === p.plan.value ? 'chip-accent' : ''}" data-action="plan-preset" data-value="${v}">${v}${m === 'count' ? '' : '%'}</button>`).join('')}</div>
    <div class="stack-sm" id="plan-summary">${planSummaryHTML(seg)}</div>
    ${p.skipped ? `<div class="plan-skip"><span class="stack-xs grow"><b>${plural(p.skipped, 'palabra no vale', 'palabras no valen')} la pena</b>
      <span class="hint">Muy poco comunes, anticuadas, sonidos o nombres. No cuentan para tu meta y puedes recuperarlas en el Glosario.</span></span>
      ${rankedCands(seg).some(c => c.status === 'pending' && infoOf(c).skip) ? `<button type="button" class="btn btn-secondary btn-sm" data-action="plan-discard" data-seg="${seg.id}">Descartarlas</button>` : ''}</div>` : ''}
  </div>`;
}

function goalReachedCard(seg, p) {
  const left = rankedCands(seg).filter(c => c.status === 'pending').length;
  return `<div class="card stack-lg narrow plan-done">
    <div class="stack-xs"><span class="eyebrow">${esc(seg.title)} · Revisar palabras</span>
      <h1 class="word-lg">${p.K ? '¡Meta alcanzada!' : 'Ya llegas a tu meta'}</h1></div>
    ${planBar({ ...p, proj: p.cur })}
    <p class="lead">${p.K ? `Elegiste ${plural(p.chosen, 'palabra', 'palabras')} para estudiar y ya entiendes el <b>${fmtPct(p.cur)}</b> del texto cuando las aprendas.`
      : `Ya entiendes el <b>${fmtPct(p.cur)}</b> del texto sin estudiar nada más.`}
      Las ${plural(left, 'palabra que queda', 'palabras que quedan')} son las menos importantes: puedes dejarlas pasar.</p>
    <div class="gsum-actions">
      <a class="btn btn-primary" href="#/segmento/${seg.id}" data-autofocus>Terminar y ver la lectura</a>
      <button type="button" class="btn btn-secondary" data-action="plan-continue" data-seg="${seg.id}">Seguir revisando</button>
    </div>
    <button type="button" class="btn-link" style="align-self:center" data-action="plan-discard-rest" data-seg="${seg.id}">Descartar las ${left} que quedan y terminar</button>
  </div>`;
}

// Lo que se muestra bajo la palabra en la revisión: importancia, motivos y por qué.
function triageInsights(c) {
  const i = infoOf(c);
  const reasons = i.flags.map(f => f.why);
  return `<div class="imp-row"><span class="imp-badge t-${i.tier.key}">${i.tier.label}</span>
      ${i.flags.map(f => `<span class="imp-flag ${f.hard ? 'hard' : ''}">${f.label}</span>`).join('')}</div>
    ${i.lang ? `<span class="muted small">${i.lang}.</span>` : ''}
    ${i.skip ? `<div class="tip skip-tip">${icon('alert', 18)}<span><b>Probablemente no vale la pena estudiarla.</b> ${esc(reasons.join(' '))} Puedes saltarla.</span></div>` : ''}`;
}

/* ---------- Registro ---------- */

Object.assign(bindings, {
  'plan-value': el => {
    const seg = currentSeg();
    if (!seg) return;
    const def = PLAN_MODES[(seg.plan ||= { mode: 'count', value: PLAN_MODES.count.def }).mode];
    const n = parseInt(el.value, 10);
    if (!Number.isFinite(n)) return;
    seg.plan.value = Math.min(def.max, Math.max(def.min, n));
    savePlan(seg);
    const box = $('#plan-summary');
    if (box) box.innerHTML = planSummaryHTML(seg);
    view.querySelectorAll('.plan-presets .chip').forEach(b => b.classList.toggle('chip-accent', Number(b.dataset.value) === seg.plan.value));
  },
});

Object.assign(actions, {
  'plan-mode': el => {
    const seg = currentSeg(), mode = el.dataset.mode;
    if (!seg || !PLAN_MODES[mode] || seg.plan?.mode === mode) return;
    seg.plan = { mode, value: PLAN_MODES[mode].def };
    savePlan(seg);
    state.ui.justPlanMode = true;
    render();
    state.ui.justPlanMode = false;
  },
  'plan-preset': el => {
    const seg = currentSeg();
    if (!seg) return;
    (seg.plan ||= { mode: 'count', value: PLAN_MODES.count.def }).value = Number(el.dataset.value);
    savePlan(seg);
    render();
  },
  'plan-discard': () => {
    const seg = currentSeg();
    if (!seg) return;
    let n = 0;
    for (const c of seg.candidates) if (c.status === 'pending' && infoOf(c).skip) { c.status = 'skipped'; n++; }
    seg.autoTop = computeAutoTop(seg);
    libSaveSegment(seg);
    toast(`${plural(n, 'palabra descartada', 'palabras descartadas')}. Puedes recuperarlas en el Glosario → Descartadas.`);
    render();
  },
  'plan-continue': el => {
    (state.ui.planContinue ||= new Set()).add(el.dataset.seg);
    render();
  },
  'plan-discard-rest': () => {
    const seg = currentSeg();
    if (!seg) return;
    let n = 0;
    for (const c of seg.candidates) if (c.status === 'pending') { c.status = 'skipped'; n++; }
    seg.history = [];
    seg.autoTop = computeAutoTop(seg);
    libSaveSegment(seg);
    toast(`${plural(n, 'palabra descartada', 'palabras descartadas')}. Puedes recuperarlas en el Glosario → Descartadas.`);
    go(`segmento/${seg.id}`);
  },
});
