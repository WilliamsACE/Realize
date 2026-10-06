'use strict';
/* Mis palabras: selección múltiple para fijar, agrupar o borrar varias palabras a la vez.

   Cómo se selecciona:
   - Botón «Seleccionar» (el camino en el celular): aparecen casillas y tocar una fila la marca.
   - Casilla de cada fila: marca o desmarca esa palabra sin tocar las demás.
   - Shift + clic (o Ctrl/Cmd + clic) en una fila: la suma a la selección sin soltar las anteriores.
   - Ctrl/Cmd + A: todas las que se ven con el filtro y la búsqueda actuales.
   - Supr (o Retroceso): borrar lo seleccionado, con confirmación. Esc: cancelar.
   Si cambias el filtro o la búsqueda, la selección se queda solo con lo que sigue a la vista,
   así nunca se borra algo que no estás viendo. Usa la lista de words.js y las copias de history.js. */

const selSet = () => (state.ui.sel ||= new Set());
const selActive = () => !!state.ui.selMode || selSet().size > 0;
const selectedWords = () => state.data.words.filter(w => selSet().has(w.id));
const SEL_GROUP_MAX = 8;   // palabras que admite un grupo (el tipo «significado»)

function clearSelection() {
  state.ui.sel = new Set();
  state.ui.selMode = false;
  updateSelection();
}

function selectionBarHTML() {
  const sel = selectedWords();
  const n = sel.length;
  const visible = filteredWords().length;
  const allPinned = n > 0 && sel.every(w => w.pinned);
  const groupOk = n >= 2 && n <= SEL_GROUP_MAX;
  const groupWhy = n < 2 ? 'Elige al menos 2 palabras' : n > SEL_GROUP_MAX ? `Un grupo admite hasta ${SEL_GROUP_MAX} palabras` : 'Crear un grupo con las seleccionadas';
  return `<div class="sel-info">
      <button type="button" class="icon-btn sel-close" data-action="sel-clear" aria-label="Cancelar la selección" title="Cancelar (Esc)">${icon('x', 18)}</button>
      <span class="sel-count" role="status" aria-live="polite"><b>${n}</b> ${n === 1 ? 'seleccionada' : 'seleccionadas'}</span>
      ${n < visible ? `<button type="button" class="btn-link" data-action="sel-all" title="Ctrl + A">Todas (${visible})</button>`
        : n ? '<button type="button" class="btn-link" data-action="sel-none">Ninguna</button>' : ''}
    </div>
    <div class="sel-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-action="bulk-pin" ${n ? '' : 'disabled'} title="${allPinned ? 'Quitar de fijadas' : 'Fijar las seleccionadas'}">${icon('star', 16)}<span>${allPinned ? 'Quitar fijado' : 'Fijar'}</span></button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="bulk-group" ${groupOk ? '' : 'disabled'} title="${groupWhy}">${icon('cards', 16)}<span>Grupo</span></button>
      <button type="button" class="btn btn-sm btn-danger" data-action="bulk-delete" ${n ? '' : 'disabled'} title="Borrar (Supr)">${icon('trash', 16)}<span>Borrar</span></button>
    </div>
    <div class="sel-keys" aria-hidden="true"><kbd>Shift</kbd> + clic suma · <kbd>Ctrl</kbd> + <kbd>A</kbd> todas · <kbd>Supr</kbd> borra · <kbd>Esc</kbd> cancela</div>`;
}

// Casilla de cada fila (la dibuja wordListHTML).
const selCheckHTML = w => `<button type="button" class="sel-check" data-action="sel-toggle" data-id="${esc(w.id)}" aria-pressed="${selSet().has(w.id)}" aria-label="Seleccionar ${esc(w.word)}">${icon('tick', 14)}</button>`;

// Repinta lista y barra. Con `list: false` solo la barra (cuando ya se actualizó la fila a mano).
function updateSelection({ list = true } = {}) {
  const box = $('#word-list');
  if (!box) return;
  // Ctrl + A y el clic en una fila no pasan por `actions` (que ya corta la animación de entrada):
  // si sigue activa, la barra entraría con «rise» y, al quitarse .view-enter, repetiría su «bar-up».
  endViewEnter();
  const active = selActive();
  if (list) box.innerHTML = wordListHTML();
  box.classList.toggle('selecting', active);
  document.body.classList.toggle('has-selbar', active);
  const bar = $('#sel-bar');
  if (bar) {
    bar.hidden = !active;
    if (active) bar.innerHTML = selectionBarHTML();
  }
  const btn = $('.sel-toggle');
  if (btn) {
    btn.setAttribute('aria-pressed', !!state.ui.selMode);
    btn.classList.toggle('is-on', active);
    const label = btn.querySelector('span');
    if (label) label.textContent = active ? 'Listo' : 'Seleccionar';
  }
}

// Lista de Mis palabras (búsqueda, filtro, fijar…): conserva la selección; con `prune`, solo lo visible.
function refreshWordList({ prune = false } = {}) {
  if (prune) {
    const visible = new Set(filteredWords().map(w => w.id));
    state.ui.sel = new Set([...selSet()].filter(id => visible.has(id)));
  }
  updateSelection();
}

// Al dibujar la pantalla: fuera lo que ya no existe (borrado en otra parte).
function pruneSelection() {
  const alive = new Set(state.data.words.map(w => w.id));
  state.ui.sel = new Set([...selSet()].filter(id => alive.has(id)));
}

function toggleSelected(id) {
  const set = selSet();
  const on = !set.has(id);
  if (on) set.add(id); else set.delete(id);
  // Solo se actualiza esa fila (sin repintar la lista) para que sea instantáneo y no parpadee.
  const row = $(`#word-list .list-row[data-wid="${CSS.escape(id)}"]`);
  row?.classList.toggle('is-selected', on);
  const check = row?.querySelector('.sel-check');
  check?.setAttribute('aria-pressed', on);
  updateSelection({ list: false });
}

function selectAllVisible() {
  state.ui.sel = new Set(filteredWords().map(w => w.id));
  state.ui.selMode = true;
  updateSelection();
}

/* ---------- Eventos ---------- */

// Clic en una fila: suma con Shift/Ctrl/Cmd; sin teclas, solo si ya se está seleccionando.
document.addEventListener('click', e => {
  const row = e.target.closest?.('#word-list .list-row[data-wid]');
  if (!row || e.target.closest('a, button, input, select, textarea, label, summary')) return;
  if (!(e.shiftKey || e.ctrlKey || e.metaKey) && !selActive()) return;
  toggleSelected(row.dataset.wid);
});
// Shift + clic no debe marcar texto de la página.
document.addEventListener('mousedown', e => {
  if (e.shiftKey && e.target.closest?.('#word-list .list-row[data-wid]')) e.preventDefault();
});

document.addEventListener('keydown', e => {
  if (currentRoute().name !== 'palabras') return;
  const t = e.target;
  const field = /^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable;
  const emptySearch = t.matches?.('input[type="search"]') && !t.value;   // sin texto que seleccionar: Ctrl + A es para la lista
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a' && (!field || emptySearch)) {
    e.preventDefault();
    if (state.data.words.length) selectAllVisible();
    return;
  }
  if (field || mod || e.altKey) return;
  if (e.key === 'Escape' && selActive()) { e.preventDefault(); clearSelection(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selSet().size) { e.preventDefault(); actions['bulk-delete'](); }
});

/* ---------- Acciones ---------- */

Object.assign(actions, {
  'sel-mode': () => {
    state.ui.selMode = !selActive();
    if (!state.ui.selMode) state.ui.sel = new Set();
    updateSelection();
  },
  'sel-toggle': el => toggleSelected(el.dataset.id),
  'sel-all': () => selectAllVisible(),
  'sel-none': () => { state.ui.sel = new Set(); updateSelection(); },
  'sel-clear': () => clearSelection(),

  'bulk-pin': () => {
    const ws = selectedWords();
    if (!ws.length) return;
    const pin = !ws.every(w => w.pinned);   // si todas ya están fijadas, las suelta
    for (const w of ws) w.pinned = pin;
    persist();
    toast(pin ? `${plural(ws.length, 'palabra fijada', 'palabras fijadas')}: saldrán en cada sesión hasta que las aprendas` : `${plural(ws.length, 'palabra', 'palabras')} ya no ${ws.length === 1 ? 'está fijada' : 'están fijadas'}`);
    // Al fijar, cada ★ hace su animación (la misma que al fijar una sola), en cascada.
    state.ui.justPinned = pin ? new Set(ws.map(w => w.id)) : null;
    updateSelection();
    state.ui.justPinned = null;
    document.querySelectorAll('#word-list .pin-btn.just svg').forEach((s, i) => { s.style.animationDelay = `${Math.min(i, 12) * 40}ms`; });
  },

  'bulk-delete': () => {
    const ws = selectedWords();
    if (!ws.length) return;
    const started = ws.filter(w => !isNew(w)).length;
    if (!confirm(`¿Borrar ${plural(ws.length, 'palabra', 'palabras')}?${started ? ` ${started === 1 ? 'Una ya la has estudiado' : `${started} ya las has estudiado`}: se pierde su progreso.` : ''} Antes se guarda una copia que puedes restaurar en Ajustes → Tus datos → Versiones anteriores.`)) return;
    saveCopy('Antes de borrar palabras');
    const ids = new Set(ws.map(w => w.id));
    state.data.words = state.data.words.filter(w => !ids.has(w.id));
    for (const g of groups()) g.ids = g.ids.filter(id => !ids.has(id));
    state.ui.sel = new Set();
    state.ui.selMode = false;
    persist();
    toast(`${plural(ws.length, 'palabra borrada', 'palabras borradas')}`);
    render();
  },

  // Lleva las seleccionadas a Agregar → Grupo, ya escritas, para elegir tipo y definiciones.
  'bulk-group': () => {
    const ws = selectedWords();
    if (ws.length < 2) { toast('Elige al menos 2 palabras para el grupo.'); return; }
    if (ws.length > SEL_GROUP_MAX) { toast(`Un grupo admite hasta ${SEL_GROUP_MAX} palabras. Elige menos.`); return; }
    Object.assign(groupDraft(), { type: 'meaning', theme: '', items: null, saved: null, error: null, text: ws.map(w => w.word).join('\n') });
    state.ui.sel = new Set();
    state.ui.selMode = false;
    go('agregar/grupo');
  },
});
