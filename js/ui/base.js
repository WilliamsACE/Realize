'use strict';
/* UI: íconos, avisos y piezas reutilizables. */

/* ===================== 8. UI ===================== */

const view = document.getElementById('view');

const ICON_PATHS = {
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  speaker: '<path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  xcircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/>',
  twin: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  cards: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  tick: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  cloud: '<path d="M7 19h10.5a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 5.6 9.4 4.8 4.8 0 0 0 7 19z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.6-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.6L20 16"/><path d="M20 20v-4h-4"/>',
};
function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3800);
}

/* ---------- Piezas reutilizables ---------- */

function speakBtn(text, label = 'Escuchar', size = '') {
  if (!speech.supported || !text) return '';
  return `<button type="button" class="speak ${size}" data-action="speak" data-text="${esc(text)}" aria-label="${esc(label)}" title="${esc(label)}">${icon('speaker')}</button>`;
}
function leechBadge(w) { return isLeech(w) ? '<span class="badge-leech" title="Palabra difícil: la has fallado 5 veces o más">Difícil</span>' : ''; }

function formatDue(w, now = Date.now()) {
  if (isNew(w)) return 'Nueva';
  const due = w.srs.due;
  if (due == null || due <= endOfDay(now)) return 'hoy';
  if (due <= endOfDay(addDays(now, 1))) return 'mañana';
  return new Date(due).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
function formatInterval(srs) {
  if (!srs.interval) return '10 min';
  const d = srs.interval;
  return d < 30 ? `${d} d` : d < 365 ? `${Math.round(d / 30)} m` : `${(d / 365).toFixed(1)} a`;
}

// `pin`: muestra la ★ para fijar; se apaga donde el título queda guardado como texto
// (no se volvería a dibujar con el estado nuevo).
function wordTitle(w, { pin = true } = {}) {
  return `<div class="word-title">
    <h1 class="word-xl">${esc(w.word)}</h1>
    ${w.ipa ? `<span class="muted">${esc(fmtIpa(w.ipa))}</span>` : ''}
    ${speakBtn(w.word, 'Escuchar pronunciación')}
    ${w.id ? leechBadge(w) : ''}
    ${pin && w.id ? pinBtn(w, 'title') : w.pinned ? `<span class="pin-mark is-pinned" title="Fijada: sale en cada sesión hasta que la aprendas">${icon('star', 16)}</span>` : ''}
  </div>`;
}

// Botón ★ para fijar una palabra: en la lista de palabras ('list'), junto al título en las
// sesiones ('title') o en ejercicios donde la palabra es la respuesta ('hidden': no la nombra).
function pinBtn(w, variant = 'list') {
  const small = variant !== 'list';
  return `<button type="button" class="${small ? 'pin-mark' : 'icon-btn'} pin-btn ${w.pinned ? 'is-pinned' : ''} ${state.ui.justPinned === w.id ? 'just' : ''}" data-action="toggle-pin" data-id="${esc(w.id)}" data-variant="${variant}" aria-pressed="${!!w.pinned}"
    aria-label="${w.pinned ? 'Quitar de fijadas' : 'Fijar'} ${variant === 'hidden' ? 'esta palabra' : esc(w.word)}" title="${w.pinned ? 'Fijada: sale en cada sesión hasta que la aprendas' : 'Fijar: que salga más seguido hasta aprenderla'}">${icon('star', small ? 16 : 20)}</button>`;
}

// Bloque de información de la palabra (definición, oraciones del libro, ejemplos, colocaciones, truco).
function wordInfo(w, { examples = 3, family = true } = {}) {
  const out = [];
  if (w.definition || w.translation) {
    out.push(`<div class="info"><span class="eyebrow">Significa${w.pos ? ' · ' + esc(w.pos) : ''}</span>
      <span>${esc(w.definition)}${w.translation ? ` <span class="muted">${w.definition ? '· ' : ''}${esc(w.translation)}</span>` : ''}</span></div>`);
  }
  if (w.otherMeanings?.length) out.push(`<div class="info"><span class="eyebrow">También puede significar</span><span>${w.otherMeanings.map(esc).join(' · ')}</span></div>`);
  if (w.note && w.noteFeedback) out.push(`<div class="info"><span class="eyebrow">Sobre tu comentario «${esc(w.note)}»</span><span>${esc(w.noteFeedback)}</span></div>`);
  const ctx = w.contexts ? bookContexts(w).slice(0, 2) : [];
  if (ctx.length) {
    out.push(`<div class="info"><span class="eyebrow">Del libro</span>
      ${ctx.map(c => `<div class="example"><span>${highlightWord(c.text, w)}${c.loc ? ` <span class="hint">· ${esc(c.loc)}</span>` : ''}</span>${speakBtn(c.text, 'Escuchar oración', 'sm')}</div>`).join('')}</div>`);
  }
  const ex = w.examples.slice(0, Math.max(0, examples - ctx.length) || (ctx.length ? 1 : examples));
  if (ex.length) {
    out.push(`<div class="info"><span class="eyebrow">${ex.length > 1 ? 'Ejemplos' : 'Ejemplo'}</span>
      ${ex.map(e => `<div class="example"><span>${esc(e)}</span>${speakBtn(e, 'Escuchar ejemplo', 'sm')}</div>`).join('')}</div>`);
  }
  if (w.collocations.length) out.push(`<div class="chips">${w.collocations.map(c => `<span class="chip chip-accent">${esc(c)}</span>`).join('')}</div>`);
  if (family && w.family.length) out.push(`<div class="info"><span class="eyebrow">Familia de palabras</span><span>${w.family.map(esc).join(' · ')}</span></div>`);
  if (w.rescueAid?.confusables?.length) {
    out.push(`<div class="info"><span class="eyebrow">No la confundas con</span><span>${w.rescueAid.confusables.map(c => `<b>${esc(c.word)}</b> <span class="muted">(${esc(c.meaning)})</span>`).join(' · ')}</span></div>`);
  }
  if (w.mnemonic) out.push(`<div class="tip">${w.rescue?.own ? 'Tu truco' : 'Truco'}: ${esc(w.mnemonic)}</div>`);
  return out.join('');
}

const FIELDS = [
  { key: 'word', label: 'Palabra', type: 'text' },
  { key: 'note', label: 'Tu comentario (qué significado quieres recordar; no se muestra)', type: 'text' },
  { key: 'translation', label: 'Traducción al español', type: 'text' },
  { key: 'ipa', label: 'Pronunciación (símbolos fonéticos)', type: 'text' },
  { key: 'pos', label: 'Tipo de palabra (verbo, sustantivo…)', type: 'text' },
  { key: 'definition', label: 'Definición simple (en inglés)', type: 'area', rows: 2, wide: true },
  { key: 'otherMeanings', label: 'Otros significados (uno por línea)', type: 'list', rows: 2, wide: true },
  { key: 'examples', label: 'Oraciones de ejemplo (una por línea)', type: 'list', rows: 3, wide: true },
  { key: 'collocations', label: 'Combinaciones frecuentes (una por línea)', type: 'list', rows: 3 },
  { key: 'family', label: 'Familia de palabras (una por línea)', type: 'list', rows: 3 },
  { key: 'mnemonic', label: 'Truco mnemotécnico', type: 'area', rows: 2, wide: true },
  { key: 'distractors', label: 'Respuestas falsas para los ejercicios de elegir (traducciones incorrectas, una por línea)', type: 'list', rows: 3, wide: true },
];

function wordFields(d, scope) {
  return `<div class="fields">${FIELDS.map(f => {
    const id = `f-${scope.replace(':', '-')}-${f.key}`;
    const val = f.type === 'list' ? (d[f.key] || []).join('\n') : (d[f.key] || '');
    const attrs = `id="${id}" data-bind="field" data-scope="${scope}" data-key="${f.key}"`;
    const control = f.type === 'text'
      ? `<input class="input" ${attrs} value="${esc(val)}" autocomplete="off"${f.key === 'word' || f.key === 'ipa' ? ' autocapitalize="off" spellcheck="false"' : ''}>`
      : `<textarea class="textarea" rows="${f.rows}" ${attrs}>${esc(val)}</textarea>`;
    return `<div class="field${f.wide ? ' wide' : ''}"><label class="label" for="${id}">${f.label}</label>${control}</div>`;
  }).join('')}</div>`;
}

/* Aviso único de «todavía no hay IA conectada»: el mismo en toda la app. Al cerrarlo se
   oculta en todas partes. `force`: el usuario acaba de pedir algo que necesita IA, así que
   se muestra aunque lo haya cerrado (y cerrarlo ahí solo lo quita de la vista).
   `short`: versión corta del texto para el celular, donde la estrella va junto al título y
   el botón ocupa todo el ancho. */
const AI_BANNER_TEXT = 'Conecta una IA (Gemini, DeepSeek u OpenAI; Gemini tiene plan gratis) para que complete tus palabras y corrija tus oraciones. Solo tienes que pegar una clave en Ajustes.';
const AI_BANNER_SHORT = 'Completa tus palabras y corrige tus oraciones. Gemini es gratis.';
function aiBanner(text = AI_BANNER_TEXT, { force = false, short = AI_BANNER_SHORT } = {}) {
  if (hasKey() || (!force && isDismissed('ai'))) return '';
  return `<div class="banner banner-info has-close ai-banner">${icon('sparkle', 24)}
    <div class="banner-body"><b>${icon('sparkle', 18)}Conecta la IA</b><span class="ai-long">${text}</span><span class="ai-short">${short}</span></div>
    <a class="btn btn-primary btn-sm" href="#/ajustes">Conectar IA</a>${bannerClose(force ? '' : 'ai')}</div>`;
}

// `dismiss`: clave del aviso para mostrar el botón de cerrar (ver la acción dismiss-banner).
// `dismiss`: una clave guarda el cierre en los ajustes; `true` solo oculta el aviso hasta
// el siguiente repintado (errores y notas del momento). `count`: el aviso vuelve a
// salir solo si el número crece (p. ej. palabras sin significado).
function banner(kind, title, text = '', extra = '', dismiss = '', count = null) {
  const ic = { ok: 'check', almost: 'check', warn: 'alert', err: 'xcircle', info: 'sparkle' }[kind];
  return `<div class="banner banner-${kind}${dismiss ? ' has-close' : ''}" role="${kind === 'err' ? 'alert' : 'status'}">${icon(ic, 24)}
    <div class="banner-body">${title ? `<b>${title}</b>` : ''}${text ? `<span>${text}</span>` : ''}${extra}</div>${dismiss ? bannerClose(dismiss === true ? '' : dismiss, count) : ''}</div>`;
}
const bannerClose = (key, count = null) => `<button type="button" class="banner-close" data-action="dismiss-banner" data-banner="${key}" ${count != null ? `data-seen="${count}"` : ''} aria-label="Cerrar aviso" title="Cerrar">${icon('x', 18)}</button>`;
// Letras de `expected` que no coinciden con lo escrito (alineación de Levenshtein).
function spellDiff(expected, typed) {
  const x = [...String(expected).toLowerCase()], y = [...String(typed).trim().toLowerCase()];
  const n = x.length, m = y.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  }
  const wrong = new Set();
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i && j && d[i][j] === d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)) { if (x[i - 1] !== y[j - 1]) wrong.add(i - 1); i--; j--; }
    else if (i && d[i][j] === d[i - 1][j] + 1) { wrong.add(i - 1); i--; }   // faltó esta letra
    else { wrong.add(Math.max(0, Math.min(i, n - 1))); j--; }                // sobró una letra aquí
  }
  return wrong;
}

/* «Casi perfecto»: cuenta como acierto, pero se distingue del correcto con un verde
   más amarillo y la forma correcta subrayada, con las letras que fallaron marcadas. */
function almostBanner(expected, typed, extra = '') {
  const wrong = spellDiff(expected, typed);
  const word = [...expected].map((ch, i) => (wrong.has(i) ? `<mark>${esc(ch)}</mark>` : esc(ch))).join('');
  return banner('almost', '¡Casi perfecto!', `Escribiste <s>${esc(String(typed).trim())}</s> · se escribe <span class="spell-fix">${word}</span>${extra}`);
}

// ¿El usuario cerró este aviso? Con `count`, solo si no hay más que cuando lo cerró.
function isDismissed(key, count = null) {
  const v = state.data.settings.dismissedBanners?.[key];
  return count != null ? count <= (Number(v) || 0) : !!v;
}

function coverageBar(seg, { compact = false } = {}) {
  const p = segmentCoverage(seg);
  const target = state.data.settings.coverageTarget;
  return `<div class="coverage ${compact ? 'compact' : ''}" role="img" aria-label="Conoces el ${fmtPct(p)} de las palabras (objetivo ${target}%)">
    <div class="coverage-fill ${p >= target ? 'ready' : ''}" style="width:${p}%"></div>
    <div class="coverage-target" style="left:${target}%" title="Objetivo ${target}%"></div>
  </div>`;
}
