/* ============================================================
   js/app.js  — Inicialización principal y utilidades globales
   Debe cargarse DESPUÉS de db.js, proyectos.js y dashboard.js.
   ============================================================ */
'use strict';

/* ════════════════════════════════════════
   Namespace global PSA
   ════════════════════════════════════════ */
window.PSA = window.PSA || {};

/* ── Escapa HTML para prevenir XSS ── */
PSA.escapeHtml = function (s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/** Formatea YYYY-MM-DD → DD/MM/YYYY */
PSA.formatFecha = function (f) {
  if (!f) return '—';
  const [y, m, d] = f.split('-');
  return `${d}/${m}/${y}`;
};

/** Genera un ID único (alfanumérico corto). */
PSA.genId = function () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
};

/* ── Toast de notificación ── */
let _toastTimer = null;
PSA.toast = function (msg, tipo) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (tipo === 'error' ? ' error' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
};

/* ── Cambio de pestaña ── */
PSA.cambiarTab = function (viewId, btnOrKey) {
  document.querySelectorAll('section.view').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));

  const sec = document.getElementById(viewId);
  if (sec) sec.classList.add('active');

  if (typeof btnOrKey === 'string') {
    const btn = document.querySelector(`nav.tabs button[data-view="${btnOrKey}"]`);
    if (btn) btn.classList.add('active');
  } else if (btnOrKey && btnOrKey.classList) {
    btnOrKey.classList.add('active');
  }
  document.querySelectorAll('nav.tabs button').forEach(b => {
    const activa = b.classList.contains('active');
    b.setAttribute('aria-selected', String(activa));
    b.tabIndex = activa ? 0 : -1;
  });
};

document.querySelector('nav.tabs').addEventListener('keydown', event => {
  const botones = Array.from(document.querySelectorAll('nav.tabs button'));
  const indice = botones.indexOf(event.target);
  if (indice < 0) return;
  let siguiente = indice;
  if (event.key === 'ArrowRight') siguiente = (indice + 1) % botones.length;
  else if (event.key === 'ArrowLeft') siguiente = (indice - 1 + botones.length) % botones.length;
  else if (event.key === 'Home') siguiente = 0;
  else if (event.key === 'End') siguiente = botones.length - 1;
  else return;
  event.preventDefault();
  botones[siguiente].focus();
  PSA.cambiarTab(botones[siguiente].dataset.view, botones[siguiente]);
});

/** Renderiza todos los módulos de la aplicación desde el estado confirmado. */
PSA.renderTodo = function () {
  PSA.Proyectos.renderTabla();
  PSA.Dashboard.render();
  PSA.Tableros.render();
  PSA.Calendario.render();
  PSA.Actividad.render();
};

/* ════════════════════════════════════════
   Atajos de teclado
   ════════════════════════════════════════ */
document.addEventListener('keydown', function (e) {
  if (PSA.DB.ocupado) return;
  if (PSA.Tableros.editorAbierto) return;
  if (PSA.DB.estado.requiereMigracion) {
    const botones = Array.from(document.querySelectorAll('#migration-overlay button:not(:disabled)'));
    if (e.key === 'Escape') { e.preventDefault(); PSA.cancelarMigracion(); }
    if (e.key === 'Tab' && botones.length) {
      const primero = botones[0];
      const ultimo = botones[botones.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
    return;
  }
  if (e.key === 'Escape' && PSA.Proyectos && PSA.Proyectos.editandoId) {
    PSA.Proyectos.limpiarForm();
    PSA.toast('Edición cancelada (Esc).');
  }
});

/* ════════════════════════════════════════
   Gestión del estado de conexión a DB
   ════════════════════════════════════════ */

/** Actualiza el indicador de estado y controla el overlay de conexión a DB. */
function _actualizarEstadoDB({ useSQLite, tieneArchivo, esperaPermiso, ocupado, ubicacion, error, requiereMigracion, destinoMigracion } = {}) {
  const statusEl  = document.getElementById('db-status');
  const btnEl     = document.getElementById('btn-db-connect');
  const overlayEl = document.getElementById('connect-overlay');
  const titleEl   = document.getElementById('connect-title');
  const msgEl     = document.getElementById('connect-msg');
  const ovBtnEl   = document.getElementById('connect-btn');
  const carpetaBtn = document.getElementById('connect-folder-btn');
  const detalleEl = document.getElementById('db-detail');

  document.querySelectorAll('#v-proyectos input, #v-proyectos select, #v-proyectos textarea, #v-proyectos button, .header-db button, .connect-box button')
    .forEach(el => { el.disabled = !!ocupado; });
  if (detalleEl) {
    detalleEl.textContent = error || (ocupado ? 'Procesando… No cierre esta ventana.' : 'La carpeta se autoriza con el selector del navegador; no se expone la ruta absoluta.');
    detalleEl.classList.toggle('db-warning', !!error);
  }
  if (carpetaBtn) carpetaBtn.classList.toggle('hidden', !useSQLite || !PSA.DB.hasFSA || !esperaPermiso);
  const migracionEl = document.getElementById('migration-overlay');
  const abrirMigracion = requiereMigracion && migracionEl.classList.contains('hidden');
  const cerrarMigracion = !requiereMigracion && !migracionEl.classList.contains('hidden');
  migracionEl.classList.toggle('hidden', !requiereMigracion);
  document.querySelectorAll('main, header, nav.tabs').forEach(el => { el.inert = !!requiereMigracion; });
  document.getElementById('v-tableros').inert = !!ocupado;
  document.getElementById('v-tableros').setAttribute('aria-busy', String(!!ocupado));
  document.getElementById('v-calendario').setAttribute('aria-busy', String(!!ocupado));
  document.getElementById('v-actividad').setAttribute('aria-busy', String(!!ocupado));
  PSA.Tableros.actualizarEstado();
  if (requiereMigracion) {
    if (overlayEl) overlayEl.classList.add('hidden');
    document.getElementById('migration-msg').textContent = error ||
      'La base ' + destinoMigracion + ' usa el esquema anterior. Requiere una migración a la versión ' + PSA.Esquema.VERSION + '.';
    if (statusEl) { statusEl.textContent = '⚠ Actualización pendiente'; statusEl.className = 'db-warning'; }
    if (abrirMigracion && !ocupado) document.getElementById('migration-confirm').focus();
    if (!ocupado && !migracionEl.contains(document.activeElement)) document.getElementById('migration-confirm').focus();
    return;
  }
  if (cerrarMigracion) {
    const destinoFoco = tieneArchivo ? btnEl : ovBtnEl;
    if (destinoFoco) setTimeout(() => destinoFoco.focus(), 0);
  }

  if (ocupado && !useSQLite) {
    if (statusEl) statusEl.textContent = 'Iniciando SQLite…';
    return;
  }

  // sql.js no disponible → error crítico
  if (!useSQLite) {
    if (statusEl) { statusEl.textContent = '⚠ sql.js no disponible'; statusEl.className = 'db-warning'; }
    if (btnEl) btnEl.classList.add('hidden');
    if (overlayEl) {
      if (titleEl) titleEl.textContent = 'Motor de base de datos no disponible';
      if (msgEl)   msgEl.textContent = error || 'No se pudo cargar sql.js desde CDN. Verifique la conexión a internet y recargue la página.';
      if (ovBtnEl) ovBtnEl.classList.add('hidden');
      overlayEl.classList.remove('hidden');
    }
    return;
  }

  // Totalmente operativo → ocultar overlay
  if (tieneArchivo) {
    if (statusEl) { statusEl.textContent = (error ? '⚠ ' : '● ') + ubicacion; statusEl.className = error ? 'db-warning' : 'db-connected'; }
    if (btnEl) { btnEl.textContent = 'Cambiar carpeta de base de datos'; btnEl.classList.remove('hidden'); }
    if (overlayEl) overlayEl.classList.add('hidden');
    return;
  }

  // Sin archivo: configurar overlay según el motivo
  if (!PSA.DB.hasFSA) {
    if (statusEl) { statusEl.textContent = '⚠ Navegador no compatible'; statusEl.className = 'db-warning'; }
    if (titleEl) titleEl.textContent = 'Navegador no compatible';
    if (msgEl)   msgEl.textContent = 'Esta aplicación requiere Chrome o Edge con selección de carpetas habilitada. Use HTTPS, localhost o un archivo local compatible.';
    if (ovBtnEl) ovBtnEl.classList.add('hidden');
    if (btnEl) btnEl.classList.add('hidden');
  } else if (esperaPermiso) {
    if (statusEl) { statusEl.textContent = '⚠ vertex.db (sin permiso)'; statusEl.className = 'db-warning'; }
    if (btnEl)   { btnEl.textContent = 'Reconectar vertex.db'; btnEl.classList.remove('hidden'); }
    if (titleEl)  titleEl.textContent = 'Permiso requerido';
    if (msgEl)    msgEl.textContent = error || 'El acceso a la base seleccionada requiere permiso. Reconecte o seleccione otra carpeta.';
    if (ovBtnEl) { ovBtnEl.textContent = 'Reconectar vertex.db'; ovBtnEl.classList.remove('hidden'); }
  } else {
    if (statusEl) { statusEl.textContent = '⚠ Sin base de datos'; statusEl.className = 'db-warning'; }
    if (btnEl)   { btnEl.textContent = 'Seleccionar carpeta de base de datos'; btnEl.classList.remove('hidden'); }
    if (titleEl)  titleEl.textContent = 'Base de datos requerida';
    if (msgEl)    msgEl.textContent = error || 'Seleccione la carpeta que contiene vertex.db. Si no existe, podrá crear una base vacía.';
    if (ovBtnEl) { ovBtnEl.textContent = 'Seleccionar carpeta'; ovBtnEl.classList.remove('hidden'); }
  }
  if (overlayEl) overlayEl.classList.remove('hidden');
}

/**
 * Gestiona la selección de carpeta o reconexión a vertex.db.
 * Llamado desde el botón en la cabecera (requiere gesto del usuario).
 */
PSA.gestionarConexionDB = async function (elegirCarpeta = false) {
  if (PSA.DB.ocupado) return;
  const formularioModificado = Array.from(document.querySelectorAll('#v-proyectos .grid input, #v-proyectos .grid textarea, #v-proyectos .grid select'))
    .some(el => el.tagName === 'SELECT' ? el.selectedIndex !== 0 : el.value !== el.defaultValue);
  if (formularioModificado || PSA.Proyectos.editandoId) {
    if (!confirm('Hay datos sin guardar en el formulario. Si cambia de base, se descartarán. ¿Continuar?')) return;
  }
  try {
    const resultado = PSA.DB.esperaPermiso && !elegirCarpeta
      ? await PSA.DB.solicitarPermiso()
      : await PSA.DB.configurarCarpeta();
    if (resultado.ok) {
      PSA.Proyectos.limpiarForm();
      PSA.Tableros.reiniciar();
      PSA.Calendario.reiniciar();
      PSA.Actividad.reiniciar();
      PSA.renderTodo();
      PSA.toast(PSA.DB.estado.error || 'Conectado a ' + PSA.DB.estado.ubicacion, PSA.DB.estado.error ? 'error' : undefined);
    }
  } catch (e) {
    PSA.toast('Error al conectar: ' + e.message, 'error');
  }
};

PSA.confirmarMigracion = async function () {
  if (PSA.DB.ocupado) return;
  try {
    const resultado = await PSA.DB.migrarConexion();
    if (!resultado.ok) return;
    PSA.Proyectos.limpiarForm();
    PSA.Tableros.reiniciar();
    PSA.Calendario.reiniciar();
    PSA.Actividad.reiniciar();
    PSA.renderTodo();
    PSA.toast('Base actualizada. Respaldo: ' + resultado.respaldo);
  } catch (e) {
    PSA.toast('No se actualizó la base: ' + e.message, 'error');
  }
};

PSA.cancelarMigracion = function () {
  try {
    PSA.DB.cancelarMigracion();
  } catch (e) {
    PSA.toast(e.message, 'error');
  }
};

window.addEventListener('psa:db-state', e => _actualizarEstadoDB(e.detail));
window.addEventListener('beforeunload', e => {
  if (!PSA.DB.ocupado) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ════════════════════════════════════════
   Bootstrap asíncrono
   ════════════════════════════════════════ */
(async function arrancar() {
  const loadingEl = document.getElementById('loading-overlay');

  try {
    const estado = await PSA.DB.init();
    _actualizarEstadoDB(estado);
  } catch (err) {
    console.error('[PSA] Error de inicialización:', err);
    _actualizarEstadoDB({ useSQLite: false, tieneArchivo: false, esperaPermiso: false });
  } finally {
    if (loadingEl) loadingEl.classList.add('hidden');
  }

  PSA.renderTodo();
})();
