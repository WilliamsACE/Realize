'use strict';
/* UI: Ajustes. */

/* ---------- Ajustes ---------- */

function renderSettings() {
  const s = state.data.settings;
  const num = (key, label, min, max, hint) => `
    <div class="field field-num">
      <label class="label" for="set-${key}">${label}</label>
      <input id="set-${key}" class="input" type="number" inputmode="numeric" min="${min}" max="${max}" value="${s[key]}" data-bind="setting" data-key="${key}">
      ${hint ? `<p class="hint">${hint}</p>` : ''}
    </div>`;
  const toggle = (key, label, hint) => `
    <label class="switch-row"><input type="checkbox" ${s[key] ? 'checked' : ''} data-bind="setting-bool" data-key="${key}"><span class="switch" aria-hidden="true"></span>
      <span class="stack-xs"><b>${label}</b>${hint ? `<span class="hint">${hint}</span>` : ''}</span></label>`;
  // Apartados en una sola columna: conexiones, aprendizaje y, al final, tus datos.
  const group = (title, hint, body) => `<section class="settings-group">
      <div class="settings-group-head"><h2>${title}</h2><span class="hint">${hint}</span></div>
      ${body}
    </section>`;
  const lastExport = state.data.stats.lastExportAt;
  queueMicrotask(fillStorageStatus);   // js/history.js: espacio usado y protección (consultas asíncronas)
  return `
  <div class="row between">
    <div class="page-head"><span class="muted small">Configuración</span><h1>Ajustes</h1></div>
    <a class="btn-link" href="#/bienvenida">Ver la bienvenida</a>
  </div>
  <div class="settings-list">
    ${group('Conexiones', 'La IA que completa tus palabras y la sincronización entre dispositivos.', `
      <section class="card stack">
        <div class="row nowrap">
          <span class="icon-tile">${icon('sparkle')}</span>
          <div class="stack-xs grow"><span class="row gap-sm"><h2>Inteligencia artificial</h2><span id="key-status">${keyStatusChip()}</span></span></div>
        </div>
        <div class="field">
          <span class="label">Proveedor</span>
          <div class="provider-picker" role="radiogroup" aria-label="Proveedor de IA">
            ${Object.entries(AI_PROVIDERS).map(([id, p]) => `<button type="button" class="mode-opt ${aiProvider(s) === p ? 'on' : ''}" role="radio" aria-checked="${aiProvider(s) === p}" data-action="set-provider" data-provider="${id}">
              <b>${p.name}</b>
              ${s[p.keySetting] ? `<span class="provider-key" title="Key guardada">${icon('check', 14)}<span class="sr-only">Key guardada</span></span>` : ''}
            </button>`).join('')}
          </div>
        </div>
        ${(() => {
          const p = aiProvider(s);
          return `<div class="field">
          <label class="label" for="api-key">${p.keyLabel[0].toUpperCase() + p.keyLabel.slice(1)}</label>
          <div class="input-group">
            <input id="api-key" class="input" type="password" autocomplete="off" spellcheck="false" placeholder="Pega aquí tu clave" value="${esc(s[p.keySetting])}" data-bind="setting" data-key="${p.keySetting}">
            <button type="button" class="btn btn-secondary btn-sm" data-action="toggle-key">Mostrar</button>
          </div>
          <p class="hint">Solo se guarda en este navegador. <a href="${p.keyUrl}" target="_blank" rel="noopener">Consíguela en ${p.keySite}</a></p>
        </div>
        <details class="field">
          <summary class="label">Avanzado · modelo de IA (${esc(s[p.modelSetting] || p.defaultModel)})</summary>
          <input id="model" class="input" list="model-list" autocomplete="off" spellcheck="false" value="${esc(s[p.modelSetting])}" placeholder="${p.defaultModel}" aria-label="Modelo" data-bind="setting" data-key="${p.modelSetting}">
          <datalist id="model-list">${p.models.map(m => `<option value="${m}">`).join('')}</datalist>
        </details>`;
        })()}
        <div class="row">
          <button type="button" class="btn btn-secondary btn-sm" data-action="test-ai">Probar conexión</button>
          <span id="ai-status" class="status" role="status"></span>
        </div>
      </section>

      ${syncCard()}`)}

    ${group('Estudio y lecturas', 'Cuántas palabras nuevas ves cada día y cómo se corrigen tus respuestas.', `
      <section class="card stack">
        <div class="row nowrap"><span class="icon-tile">${icon('target')}</span><h2 class="grow">Estudio</h2></div>
        ${num('dailyNew', 'Nuevas por día · agregadas a mano', 0, 50)}
        <span class="label">Al revisar tus oraciones con IA, ignorar…</span>
        ${toggle('ignoreCase', 'Mayúsculas y minúsculas')}
        ${toggle('ignorePunct', 'Puntuación')}
        ${toggle('ignoreApostrophes', 'Apóstrofos', '«dont» = «don’t», pero «its» ≠ «it’s».')}
      </section>

      <section class="card stack">
        <div class="row nowrap"><span class="icon-tile">${icon('book')}</span><h2 class="grow">Lecturas</h2></div>
        <div class="fields">
          ${num('dailyNewRelaxed', 'Nuevas por día · modo Relajado', 0, 100)}
          ${num('dailyNewIntensive', 'Nuevas por día · modo Intensivo', 0, 100)}
          ${num('coverageTarget', 'Palabras que quieres conocer antes de leer (%)', 50, 100)}
          ${num('blockWords', 'Tamaño de cada parte (palabras)', 300, 20000, 'Para dividir textos que no tienen capítulos.')}
        </div>
        ${toggle('noSpoilers', 'Sin spoilers', 'Usa ejemplos genéricos en lugar de las oraciones del libro.')}
        ${toggle('verifyKnown', 'Verificar «La sé»', 'Al terminar de revisar las palabras de un texto, te propone una mini prueba con algunas que marcaste como sabidas.')}
        <p class="hint credit">Palabras comunes: ${esc(window.COMMON_WORDS_SOURCE || 'NGSL 1.2')} — New General Service List de Browne, Culligan y Phillips, <a href="https://www.newgeneralservicelist.com" target="_blank" rel="noopener">newgeneralservicelist.com</a>, licencia <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>. Frecuencia de uso: <a href="https://github.com/rspeer/wordfreq" target="_blank" rel="noopener">wordfreq</a> (CC BY-SA 4.0).</p>
      </section>`)}

    ${group('Tus datos', `${syncReady() ? 'Se sincronizan y además viven en este navegador' : 'Viven solo en este navegador'}${state.lib.available ? '' : ' <b>(sin IndexedDB: los libros se pierden al cerrar)</b>'}. Los respaldos no incluyen tus claves de IA ni el token.`, `
      <section class="card stack">
        <div class="data-row"><span class="icon-tile">${icon('shield')}</span><div class="data-row grow" id="storage-status"><div class="stack-xs grow"><b>Almacenamiento</b><span class="hint">Comprobando…</span></div></div></div>
        <div class="data-row">
          <span class="icon-tile">${icon('history')}</span>
          <div class="stack-xs grow"><b>Versiones anteriores</b><span class="hint">Copias automáticas de cada día${syncReady() ? ' y el historial de tu sincronización' : ''}. Sirven para deshacer un error.</span></div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="versions-toggle" aria-expanded="${!!state.ui.versions?.open}">${state.ui.versions?.open ? 'Ocultar' : 'Ver versiones'}</button>
        </div>
        ${versionsPanel()}
        <div class="data-row">
          <span class="icon-tile">${icon('download')}</span>
          <div class="stack-xs grow"><b>Exportar respaldo</b><span class="hint">Último: ${lastExport ? `${shortDate(lastExport)} · hace ${plural(Math.floor((Date.now() - lastExport) / DAY), 'día', 'días')}` : 'nunca'}</span></div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export">Descargar</button>
        </div>
        <label class="dropzone data-drop" for="import-file" data-drop="import-file">
          ${icon('upload', 26)}
          <b>Importar respaldo</b>
          <span class="hint">Arrastra aquí un respaldo descargado de la app (archivo .json), o toca para elegirlo. Reemplaza tus datos actuales${syncReady() ? ' (y los de tus otros dispositivos al sincronizar)' : ''}.</span>
        </label>
        <input id="import-file" type="file" accept="application/json,.json" hidden>
        <div class="data-row">
          <span class="icon-tile">${icon('list')}</span>
          <div class="stack-xs grow"><b>CSV para Anki</b><span class="hint">Tus palabras con significado, listas para importar en Anki.</span></div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export-csv-all">Descargar CSV</button>
        </div>
        <div class="actions data-danger">
          <button type="button" class="btn-link" data-action="restore-samples">Restaurar palabras de ejemplo</button>
          <button type="button" class="btn-link danger" data-action="wipe-all">Borrar todas las palabras</button>
        </div>
      </section>`)}
  </div>`;
}

function keyStatusChip() {
  return hasKey() ? `<span class="chip chip-ok">${aiProvider().name} · Configurada</span>` : '<span class="chip chip-warn">Sin configurar</span>';
}
