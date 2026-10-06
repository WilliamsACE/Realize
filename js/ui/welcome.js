'use strict';
/* Bienvenida: la primera vez que se abre la app en un dispositivo explica en tres pasos qué
   es, ayuda a conectar la IA (con la clave gratis de Gemini) y a agregar las primeras
   palabras. Quien ya la usa en otro dispositivo puede traer sus datos con la sincronización.
   Se puede volver a ver desde Ajustes. Se registra en el router (con una guarda que la
   muestra mientras no se haya terminado), en los enlaces de inputs y en las acciones. */

const welcomeState = () => (state.ui.welcome ||= { step: 0, words: '', testing: false, error: null });

function finishWelcome() {
  state.data.settings.welcomeDone = true;
  state.ui.welcome = null;
  persist();
}

function welcomeDots(step) {
  return `<div class="welcome-dots" role="img" aria-label="Paso ${step + 1} de 3">${[0, 1, 2].map(i => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}"></span>`).join('')}</div>`;
}

const welcomeHead = (ic, eyebrow, title, text) => `<div class="welcome-head">
    <span class="welcome-icon">${icon(ic, 28)}</span>
    ${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}
    <h1 class="welcome-title">${title}</h1>
    <p class="muted">${text}</p>
  </div>`;

function welcomeIntro() {
  const feature = (ic, title, text, i) => `<div class="welcome-feature" style="--i:${i}">
      <span class="icon-tile">${icon(ic)}</span><span class="stack-xs"><b>${title}</b><span class="hint">${text}</span></span></div>`;
  return `<div class="welcome-hero">
      <span class="welcome-mark" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/></svg></span>
      <span class="eyebrow">Te damos la bienvenida a Realize</span>
      <h1 class="welcome-title">Aprende las palabras en inglés que de verdad necesitas</h1>
      <p class="muted">Y no las olvides: la app te dice qué repasar cada día.</p>
    </div>
    <div class="welcome-features">
      ${feature('plus', 'Agrega las palabras que no conoces', 'Escríbelas y la IA completa su significado, pronunciación y ejemplos.', 0)}
      ${feature('repeat', 'Repasa justo cuando toca', 'Cada palabra vuelve antes de que la olvides. Unos minutos al día bastan.', 1)}
      ${feature('book', 'Prepárate para leer', 'Sube un libro o un texto y aprende antes sus palabras difíciles.', 2)}
    </div>
    <div class="welcome-actions">
      <button type="button" class="btn btn-primary btn-block" data-action="welcome-next" data-autofocus>Empezar</button>
      <button type="button" class="btn-link" data-action="welcome-sync">Ya uso Realize en otro dispositivo</button>
    </div>`;
}

function welcomeAi(w) {
  if (hasKey()) {
    return `${welcomeHead('sparkle', 'Paso 2 de 3', '¡La IA está conectada!', `Usas ${aiProvider().name}. Cada palabra que agregues se completará sola y tus oraciones se corregirán al momento.`)}
      <div class="welcome-actions">
        <button type="button" class="btn btn-primary btn-block" data-action="welcome-next" data-autofocus>Continuar</button>
        <button type="button" class="btn-link" data-action="welcome-back">Volver</button>
      </div>`;
  }
  return `${welcomeHead('sparkle', 'Paso 2 de 3 · Recomendado', 'Conecta la IA', 'Con la IA, cada palabra se completa sola y tus oraciones se corrigen al momento. La de Google (Gemini) es gratis y se conecta en un minuto.')}
    <ol class="welcome-steps">
      <li><span class="stack-xs grow"><b>Abre Google AI Studio</b><span class="hint">Entra con tu cuenta de Google (la de Gmail sirve).</span></span>
        <a class="btn btn-secondary btn-sm" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Abrir</a></li>
      <li><span class="stack-xs grow"><b>Toca «Create API key»</b><span class="hint">Copia la clave que aparece (empieza con «AIza»).</span></span></li>
      <li><span class="stack-xs grow"><b>Pégala aquí</b>
        <form class="input-group" data-submit="welcome-key" autocomplete="off">
          <input class="input" name="key" type="password" spellcheck="false" placeholder="Pega tu clave" aria-label="Clave de Google Gemini" ${w.testing ? 'readonly' : ''}>
          <button class="btn btn-primary btn-sm" type="submit" ${w.testing ? 'disabled' : ''}>${w.testing ? '<span class="spinner"></span><span>Probando…</span>' : 'Conectar'}</button>
        </form></span></li>
    </ol>
    ${w.error ? banner('err', 'No funcionó', esc(w.error)) : ''}
    <p class="hint" style="text-align:center">¿Prefieres DeepSeek u OpenAI? Puedes elegirlos después en Ajustes.</p>
    <div class="welcome-actions">
      <button type="button" class="btn btn-secondary btn-block" data-action="welcome-next">Saltar por ahora</button>
      <button type="button" class="btn-link" data-action="welcome-back">Volver</button>
    </div>`;
}

function welcomeWords(w) {
  return `${welcomeHead('plus', 'Paso 3 de 3', 'Tus primeras palabras', 'Escribe palabras en inglés que quieras aprender, una por línea. Pueden salir de un libro, una serie o una canción.')}
    <textarea id="welcome-words" class="textarea big" rows="5" data-bind="welcome-words" placeholder="reluctant&#10;overwhelm&#10;thrive" autocapitalize="off" spellcheck="false" data-autofocus>${esc(w.words)}</textarea>
    ${hasKey() ? '' : '<p class="hint">Sin IA tendrás que escribir tú el significado de cada una. Puedes conectarla cuando quieras en Ajustes.</p>'}
    <div class="welcome-actions">
      <button type="button" class="btn btn-primary btn-block" data-action="welcome-words">${icon(hasKey() ? 'sparkle' : 'plus', 18)}<span>Agregar mis palabras</span></button>
      <button type="button" class="btn btn-secondary btn-block" data-action="welcome-samples">Probar con palabras de ejemplo</button>
      <button type="button" class="btn-link" data-action="welcome-back">Volver</button>
    </div>`;
}

function welcomeSync() {
  return `${welcomeHead('cloud', '', 'Trae tus datos', 'Conecta este dispositivo al mismo repositorio de GitHub que usas en el otro y tus palabras aparecerán aquí.')}
    ${syncCard()}
    <div class="welcome-actions"><button type="button" class="btn-link" data-action="welcome-back">Volver</button></div>`;
}

function renderWelcome() {
  const w = welcomeState();
  if (w.step === 'sync') return `<div class="welcome">${welcomeSync()}</div>`;
  return `<div class="welcome">${welcomeDots(w.step)}${[welcomeIntro, welcomeAi, welcomeWords][w.step](w)}</div>`;
}

function welcomeGo(step) {
  welcomeState().step = step;
  welcomeState().error = null;
  render();
  animateView();
  window.scrollTo(0, 0);
}

/* ---------- Registro ---------- */

ROUTES.bienvenida = renderWelcome;
// Mientras no se termine la bienvenida, cualquier pantalla lleva a ella.
ROUTE_GUARDS.push(r => (!state.data.settings.welcomeDone && r.name !== 'bienvenida' ? 'bienvenida' : null));

Object.assign(bindings, {
  'welcome-words': el => { welcomeState().words = el.value; },
});

Object.assign(actions, {
  'welcome-next': () => { const w = welcomeState(); welcomeGo(Math.min(2, (typeof w.step === 'number' ? w.step : 0) + 1)); },
  'welcome-back': () => { const w = welcomeState(); welcomeGo(w.step === 'sync' ? 0 : Math.max(0, w.step - 1)); },
  'welcome-sync': () => welcomeGo('sync'),
  'welcome-key': async form => {
    const w = welcomeState();
    const key = form.elements.key.value.trim();
    if (!key || w.testing) { if (!key) toast('Pega primero tu clave.'); return; }
    const s = state.data.settings;
    const prev = { provider: s.provider, apiKey: s.apiKey };
    Object.assign(s, { provider: 'gemini', apiKey: key });
    w.testing = true;
    w.error = null;
    render();
    try {
      await callAI({
        system: 'You are a connection test. Reply only with JSON.',
        prompt: 'Return {"ok": true}.',
        schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
      });
      persist();
      toast('IA conectada');
    } catch (e) {
      Object.assign(s, prev);
      w.error = `${errorText(e)} Revisa que hayas copiado la clave completa.`;
    }
    w.testing = false;
    if (currentRoute().name === 'bienvenida') { render(); animateView(); }
  },
  'welcome-words': () => {
    const w = welcomeState();
    const text = w.words.trim();
    if (!text) { toast('Escribe al menos una palabra.'); $('#welcome-words')?.focus(); return; }
    // En una instalación nueva, las palabras de ejemplo dejan su lugar a las tuyas.
    const samples = new Set(sampleWords().map(x => normalize(x.word)));
    if (state.data.words.every(x => samples.has(normalize(x.word)))) state.data.words = [];
    finishWelcome();
    state.ui.addText = text;
    state.ui.drafts = [];
    go('agregar');
    if (hasKey()) enrichAction();
  },
  'welcome-samples': () => {
    finishWelcome();
    go('inicio');
  },
});
