'use strict';
/* UI: enlaces de inputs, eventos globales y arranque. */

/* ---------- Enlaces de inputs con el estado (sin repintar para no perder el foco) ---------- */

const bindings = {
  addText: el => { state.ui.addText = el.value; },
  field: el => {
    const scope = el.dataset.scope;
    const target = scope === 'edit' ? state.ui.editDraft : state.ui.drafts[Number(scope.split(':')[1])];
    const f = FIELDS.find(x => x.key === el.dataset.key);
    if (target && f) target[f.key] = f.type === 'list' ? linesToArray(el.value) : el.value;
  },
  'edit-stage': el => { if (state.ui.editDraft) state.ui.editDraft.stage = clampStage(el.value); },
  sentence: el => { const ex = state.ui.session?.ex; if (ex) ex.sentence = el.value; },
  'rescue-note': el => { const ex = state.ui.session?.ex; if (ex?.type === 8) ex.note = el.value; },
  search: el => { state.ui.search = el.value; refreshWordList({ prune: true }); },
  filter: el => { state.ui.filter = el.value; if (el.value === 'lowvalue') ensureFreq(); refreshWordList({ prune: true }); },
  setting: el => {
    const s = state.data.settings;
    const k = el.dataset.key;
    if (k === 'apiKey' || k === 'deepseekKey' || k === 'openaiKey') s[k] = el.value.trim();
    else if (k === 'model' || k === 'deepseekModel' || k === 'openaiModel') s[k] = cleanModel(el.value);
    else {
      const n = parseInt(el.value, 10);
      if (!Number.isFinite(n)) return;
      const limits = { dailyNew: [0, 50], dailyNewRelaxed: [0, 100], dailyNewIntensive: [0, 100], coverageTarget: [50, 100], blockWords: [300, 20000] }[k];
      if (!limits) return;
      s[k] = Math.min(limits[1], Math.max(limits[0], n));
    }
    persist();
    const chip = $('#key-status');
    if (chip) chip.innerHTML = keyStatusChip();
  },
  'setting-bool': el => {
    state.data.settings[el.dataset.key] = el.checked;
    persist();
    if (el.dataset.rerender) render();
  },
};

/* ---------- Eventos globales (delegación) ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); endViewEnter(); fn(el, e); }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  actions[form.dataset.submit]?.(form, e);
});

const onBind = e => {
  const fn = bindings[e.target.dataset?.bind];
  if (fn) { endViewEnter(); fn(e.target); }
};
document.addEventListener('input', e => { if (e.target.type !== 'checkbox') onBind(e); });
document.addEventListener('change', e => { if (e.target.type === 'checkbox') onBind(e); });

// Archivos: importar JSON (aquí) y abrir libros (reading.js registra el suyo en FILE_INPUTS).
const FILE_INPUTS = {
  'import-file': async file => {
    try {
      const raw = JSON.parse(await file.text());
      const n = Array.isArray(raw.words) ? raw.words.length : 0;
      if (!confirm(`Se importarán ${plural(n, 'palabra', 'palabras')}${raw.lib ? ' y tus lecturas' : ''}, y reemplazarán tus datos actuales${syncReady() ? ' y, al sincronizar, los de tus otros dispositivos' : ''}. ¿Continuar?`)) return;
      await saveCopy('Antes de importar');
      const data = await importAll(raw);
      if (!data.settings.apiKey) data.settings.apiKey = state.data.settings.apiKey;
      if (!data.settings.deepseekKey) data.settings.deepseekKey = state.data.settings.deepseekKey;
      if (!data.settings.openaiKey) data.settings.openaiKey = state.data.settings.openaiKey;
      // La conexión de sincronización es de este dispositivo: no la cambia un respaldo.
      for (const k of ['syncRepo', 'syncToken', 'syncAuto', 'syncLastAt']) data.settings[k] = state.data.settings[k];
      state.data = data;
      state.ui.session = null;
      persist();
      toast('Datos importados');
      render();
    } catch {
      toast('No se pudo importar: el archivo no es un JSON válido de esta app.', 'err');
    }
  },
};
document.addEventListener('change', e => {
  const handler = FILE_INPUTS[e.target.id];
  if (!handler || !e.target.files?.[0]) return;
  const file = e.target.files[0];
  e.target.value = '';
  handler(file);
});

// Atajos de teclado registrados por ruta (reading.js agrega el del triage).
const KEY_HANDLERS = [];
document.addEventListener('keydown', e => {
  // Ctrl/Cmd + Enter envía la oración.
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const t = e.target.closest?.('[data-ctrl-enter]');
    if (t) { e.preventDefault(); actions[t.dataset.ctrlEnter]?.(t); }
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const route = currentRoute().name;
  for (const h of KEY_HANDLERS) if (h(e, route)) return;
  // Teclas 1–4: elegir opción o calificar, cuando no se está escribiendo.
  if (!KEY_ROUTES.has(route)) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 4) {
    const btn = view.querySelectorAll('.grade-row .grade, .options .option:not(:disabled)')[n - 1];
    if (!btn) return;
    e.preventDefault();
    btn.click();
    // Con teclado no hay toques en falso: la opción se marca y se confirma a la vez.
    if (btn.classList.contains('option')) view.querySelector('[data-confirm]:not(:disabled)')?.click();
  }
});

window.addEventListener('hashchange', onRoute);

/* ---------- Arranque ---------- */

// App instalable y usable sin conexión (sw.js). Solo funciona servida por http/https,
// no al abrir index.html como archivo.
function registerOffline() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('No se pudo activar el modo sin conexión', e));
}

// Se espera a que carguen todos los scripts (reading.js registra rutas) y a IndexedDB.
window.addEventListener('DOMContentLoaded', async () => {
  if (speech.supported) {
    pickVoice();
    speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  }
  // El orden importa: primero se cargan los datos guardados y solo después se guarda
  // (si no, los de ejemplo pisarían a los reales).
  await loadLib();
  await loadAppData();
  persist();          // guarda los ejemplos en la primera visita
  onRoute();
  syncBoot();         // js/sync.js: trae los cambios de tus otros dispositivos
  registerOffline();  // app instalable y sin conexión
  dailyCopy();        // js/history.js: copia automática del día
  protectStorage();   // que el navegador no borre los datos por su cuenta
});
