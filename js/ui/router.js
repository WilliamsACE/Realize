'use strict';
/* UI: router, render y animaciones de vista. */

/* ---------- Router ---------- */

const ROUTES = {
  inicio: renderHome, agregar: renderAdd, estudiar: renderStudy,
  palabras: renderWords, ajustes: renderSettings, editar: renderEdit,
  progreso: renderProgress,
};
// Preparación al entrar a una ruta (reading.js agrega las suyas).
const ROUTE_ENTER = {
  // «Estudiar» es un submenú: el repaso diario vive en estudiar/diario (ver renderStudy).
  estudiar: param => {
    if (param !== 'diario') return;
    const s = state.ui.session;
    if (!s || s.finished) { state.ui.session = buildSession(state.data); prepareExercise(); }
  },
  palabras: () => { state.ui.pinOrder = null; state.ui.sel = new Set(); state.ui.selMode = false; if (state.ui.filter === 'lowvalue') ensureFreq(); },   // el orden de las fijadas se toma al dibujar la lista
  editar: param => {
    const w = findWord(param);
    if (w && state.ui.editDraft?.id !== w.id) state.ui.editDraft = { id: w.id, stage: w.stage, ...cleanContent(w) };
  },
};
// Guardas: devuelven otra ruta a la que ir en lugar de la pedida (p. ej., la bienvenida).
const ROUTE_GUARDS = [];
// Rutas en las que funcionan los atajos 1–4.
const KEY_ROUTES = new Set(['estudiar', 'prueba', 'verificar']);
const NAV_PARENT = { editar: 'palabras', libro: 'lecturas', segmento: 'lecturas', triage: 'lecturas', glosario: 'lecturas', prueba: 'lecturas', verificar: 'lecturas', captura: 'lecturas' };

function currentRoute() {
  const [name, param] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: ROUTES[name] ? name : 'inicio', param: param ? decodeURIComponent(param) : null };
}

function go(path) {
  if (location.hash === `#/${path}`) onRoute();
  else location.hash = `#/${path}`;
}

// Se ejecuta al cambiar de pantalla: prepara el estado que la vista necesita.
function onRoute() {
  const r = currentRoute();
  for (const guard of ROUTE_GUARDS) {
    const to = guard(r);
    if (to && to !== r.name) { location.replace(`#/${to}`); return; }
  }
  ROUTE_ENTER[r.name]?.(r.param);
  render();
  animateView();
  window.scrollTo(0, 0);
}

// Animación de entrada (ver .view-enter en style.css). Se quita al terminar para
// que los re-render normales de la misma pantalla no vuelvan a animarse.
let enterTimer;
function animateView() {
  view.classList.add('view-enter');
  clearTimeout(enterTimer);
  enterTimer = setTimeout(endViewEnter, 1500);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) view.querySelectorAll('[data-count]').forEach(countUp);
}
// Se corta en cuanto el usuario actúa: si no, un repintado parcial antes de que
// termine (p. ej. la lista al fijar una palabra) vuelve a animar toda la cascada.
function endViewEnter() {
  clearTimeout(enterTimer);
  view.classList.remove('view-enter');
}

// Cuenta de 0 hasta data-count (p. ej. los días de racha).
function countUp(el) {
  const to = Number(el.dataset.count);
  if (!to) return;
  const t0 = performance.now(), dur = Math.min(1400, 500 + to * 60);
  const step = t => {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = '0';
  requestAnimationFrame(step);
}

// Lluvia de confeti al terminar una sesión (una sola vez por sesión, ver render()).
function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['var(--accent)', 'var(--accent-2)', 'var(--fire-1)', 'var(--fire-2)', '#34D399', '#F472B6'];
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    const r = (a, b) => (a + Math.random() * (b - a)).toFixed(2);
    p.style.cssText = `left:${r(35, 65)}%;--x:${r(-45, 45)}vw;--y:${r(-85, -40)}vh;--r:${r(-540, 540)}deg;`
      + `--d:${r(0, .25)}s;--t:${r(1.8, 3)}s;width:${r(6, 11)}px;height:${r(9, 16)}px;`
      + `background:${colors[i % colors.length]};border-radius:${Math.random() < 0.3 ? '50%' : '2px'}`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3600);
}

function render() {
  const r = currentRoute();
  document.body.dataset.route = r.name;
  view.innerHTML = ROUTES[r.name](r.param);
  // Modo enfoque: durante un ejercicio (sesión, quiz o triage) el móvil oculta la barra inferior.
  document.body.classList.toggle('is-focus', !!view.querySelector('.study-head'));
  const active = NAV_PARENT[r.name] || r.name;
  document.querySelectorAll('.nav-link, .topbar-more').forEach(a => {
    const on = a.dataset.route === active;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Submenú de Estudiar en la barra lateral (escritorio).
  const sub = r.name === 'estudiar' ? { diario: 'diario', grupos: 'grupos', practica: 'grupos' }[r.param] : null;
  document.querySelectorAll('.nav-sublink').forEach(a => {
    const on = a.dataset.sub === sub;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Confeti una sola vez: lo marca la sesión diaria o el repaso de grupos, según quién lo pida.
  const c = view.querySelector('[data-celebrate]');
  const owner = c && (c.dataset.celebrate === 'groups' ? state.ui.groupRun : state.ui.session);
  if (owner && !owner.celebrated) { owner.celebrated = true; celebrate(); }
  // Solo se enfoca automáticamente en ejercicios, para no abrir el teclado en otras pantallas.
  if (KEY_ROUTES.has(r.name) || r.name === 'captura') view.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
}

const refreshIfOn = name => { if (currentRoute().name === name) render(); };
