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
  return `
  <div class="page-head"><span class="muted small">Configuración</span><h1>Ajustes</h1></div>
  <div class="settings-grid">
    <div class="stack-lg">
      <section class="card stack">
        <div class="row nowrap top">
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
          <label class="label" for="api-key">${p.keyLabel}</label>
          <div class="input-group">
            <input id="api-key" class="input" type="password" autocomplete="off" spellcheck="false" placeholder="Pega aquí tu API key" value="${esc(s[p.keySetting])}" data-bind="setting" data-key="${p.keySetting}">
            <button type="button" class="btn btn-secondary btn-sm" data-action="toggle-key">Mostrar</button>
          </div>
          <p class="hint">Solo se guarda en este navegador. <a href="${p.keyUrl}" target="_blank" rel="noopener">Consíguela en ${p.keySite}</a></p>
        </div>
        <details class="field">
          <summary class="label">Modelo · ${esc(s[p.modelSetting] || p.defaultModel)}</summary>
          <input id="model" class="input" list="model-list" autocomplete="off" spellcheck="false" value="${esc(s[p.modelSetting])}" placeholder="${p.defaultModel}" aria-label="Modelo" data-bind="setting" data-key="${p.modelSetting}">
          <datalist id="model-list">${p.models.map(m => `<option value="${m}">`).join('')}</datalist>
        </details>`;
        })()}
        <div class="row">
          <button type="button" class="btn btn-secondary btn-sm" data-action="test-ai">Probar conexión</button>
          <span id="ai-status" class="status" role="status"></span>
        </div>
      </section>

      <section class="card stack">
        <h2>Lecturas</h2>
        <div class="fields">
          ${num('dailyNewRelaxed', 'Nuevas por día · modo Relajado', 0, 100)}
          ${num('dailyNewIntensive', 'Nuevas por día · modo Intensivo', 0, 100)}
          ${num('coverageTarget', 'Objetivo de cobertura (%)', 50, 100)}
          ${num('blockWords', 'Palabras por bloque', 300, 20000, 'Para textos sin encabezados.')}
        </div>
        ${toggle('noSpoilers', 'Sin spoilers', 'Usa ejemplos genéricos en lugar de las oraciones del libro.')}
        ${toggle('verifyKnown', 'Verificar «La sé»', 'Al terminar el triage, ofrece comprobar una muestra con opción múltiple.')}
        <p class="hint credit">Palabras comunes: ${esc(window.COMMON_WORDS_SOURCE || 'NGSL 1.2')} — New General Service List de Browne, Culligan y Phillips, <a href="https://www.newgeneralservicelist.com" target="_blank" rel="noopener">newgeneralservicelist.com</a>, licencia <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.</p>
      </section>
    </div>

    <div class="stack-lg">
      <section class="card stack">
        <h2>Estudio</h2>
        ${num('dailyNew', 'Nuevas por día · agregadas a mano', 0, 50)}
        <span class="label">Al revisar tus oraciones con IA, ignorar…</span>
        ${toggle('ignoreCase', 'Mayúsculas y minúsculas')}
        ${toggle('ignorePunct', 'Puntuación')}
        ${toggle('ignoreApostrophes', 'Apóstrofos', '«dont» = «don’t», pero «its» ≠ «it’s».')}
      </section>

      ${syncCard()}

      <section class="card stack">
        <h2>Tus datos</h2>
        <p class="hint">${syncReady() ? 'Además de sincronizarse, todo vive en este navegador' : 'Todo vive solo en este navegador'}${state.lib.available ? '' : ' <b>(sin IndexedDB: los libros se pierden al cerrar)</b>'}. Exporta un respaldo de vez en cuando; no incluye las API keys.</p>
        <div class="kv"><span>Último respaldo</span><b>${state.data.stats.lastExportAt ? `${shortDate(state.data.stats.lastExportAt)} · hace ${plural(Math.floor((Date.now() - state.data.stats.lastExportAt) / DAY), 'día', 'días')}` : 'Nunca'}</b></div>
        <div class="actions">
          <button type="button" class="btn btn-secondary btn-sm" data-action="export">Exportar todo (JSON)</button>
          <label class="btn btn-secondary btn-sm" for="import-file">Importar JSON</label>
          <input id="import-file" type="file" accept="application/json,.json" hidden>
          <button type="button" class="btn btn-secondary btn-sm" data-action="export-csv-all">CSV para Anki</button>
        </div>
        <div class="actions">
          <button type="button" class="btn-link" data-action="restore-samples">Restaurar palabras de ejemplo</button>
          <button type="button" class="btn-link danger" data-action="wipe-all">Borrar todas las palabras</button>
        </div>
      </section>
    </div>
  </div>`;
}

function keyStatusChip() {
  return hasKey() ? `<span class="chip chip-ok">${aiProvider().name} · Configurada</span>` : '<span class="chip chip-warn">Sin configurar</span>';
}
