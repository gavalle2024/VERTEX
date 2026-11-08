/* ============================================================
   js/app.js  — Inicialización principal y utilidades globales
   Debe cargarse DESPUÉS de db.js, proyectos.js y dashboard.js.
   ============================================================ */
'use strict';

/* ════════════════════════════════════════
   Namespace global PSA
   ════════════════════════════════════════ */
window.PSA = window.PSA || {};

/* ── Tema visual: preferencia local independiente de SQLite ── */
PSA.Tema = (function () {
  const CLAVE = 'vertex-theme';
  const VALIDOS = new Set(['light', 'dark']);

  function aplicar(tema, guardar = true) {
    const elegido = VALIDOS.has(tema) ? tema : 'light';
    document.documentElement.dataset.theme = elegido;
    const boton = document.getElementById('btn-theme-toggle');
    if (boton) {
      const oscuro = elegido === 'dark';
      boton.setAttribute('aria-pressed', String(oscuro));
      boton.setAttribute('aria-label', oscuro ? 'Activar modo claro' : 'Activar modo oscuro');
      const icono = boton.querySelector('.theme-toggle-icon');
      const etiqueta = boton.querySelector('.theme-toggle-label');
      if (icono) icono.textContent = oscuro ? '☀️' : '🌙';
      if (etiqueta) etiqueta.textContent = oscuro ? 'Modo claro' : 'Modo oscuro';
    }
    if (guardar) {
      try { localStorage.setItem(CLAVE, elegido); }
      catch (error) { console.warn('[VERTEX] No se pudo guardar la preferencia de tema:', error); }
    }
    return elegido;
  }

  function inicializar() {
    let guardado = null;
    try { guardado = localStorage.getItem(CLAVE); }
    catch (error) { console.warn('[VERTEX] No se pudo leer la preferencia de tema:', error); }
    // Sin preferencia explícita, VERTEX inicia en modo claro.
    aplicar(VALIDOS.has(guardado) ? guardado : 'light', false);
  }

  function alternar() {
    const actual = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    return aplicar(actual === 'dark' ? 'light' : 'dark');
  }

  return { aplicar, inicializar, alternar };
})();
PSA.Tema.inicializar();

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
let _restauracionUIPreparada = false;
let _modoSelectorRespaldo = null;
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

document.querySelector('nav.tabs').addEventListener('click', event => {
  const boton = event.target.closest('button[data-view]');
  if (boton) PSA.cambiarTab(boton.dataset.view, boton);
});

document.addEventListener('click', event => {
  const boton = event.target.closest('button[data-action]');
  if (!boton) return;
  switch (boton.dataset.action) {
    case 'theme-toggle': PSA.Tema.alternar(); break;
    case 'db-connect': PSA.gestionarConexionDB(); break;
    case 'db-connect-folder': PSA.gestionarConexionDB(true); break;
    case 'migration-confirm': PSA.confirmarMigracion(); break;
    case 'migration-cancel': PSA.cancelarMigracion(); break;
    case 'project-save': PSA.Proyectos.guardarProyecto(); break;
    case 'project-clear': PSA.Proyectos.limpiarForm(); break;
    case 'project-filters-clear': PSA.Proyectos.limpiarFiltros(); break;
    case 'project-export-csv': PSA.Proyectos.exportarCSV(); break;
    case 'project-export-db': PSA.Proyectos.exportarDB(); break;
    case 'page-print': window.print(); break;
    case 'backup-create': PSA.crearBackupUI(); break;
    case 'backup-validate': PSA.validarBackupUI(); break;
    case 'restore-prepare': PSA.prepararRestauracionUI(); break;
    case 'restore-apply': PSA.restaurarBackupUI(); break;
    case 'restore-cancel': PSA.cancelarRestauracionUI(); break;
    case 'backup-history-refresh': PSA.actualizarHistorialBackupsUI(); break;
  }
});

document.getElementById('filtro-p-texto').addEventListener('input', PSA.Proyectos.renderTabla);
document.getElementById('filtro-p-estado').addEventListener('change', PSA.Proyectos.renderTabla);
document.getElementById('filtro-p-implementacion').addEventListener('change', PSA.Proyectos.renderTabla);

/** Renderiza todos los módulos de la aplicación desde el estado confirmado. */
PSA.renderTodo = function () {
  PSA.Proyectos.renderTabla();
  PSA.Dashboard.render();
  PSA.Tableros.render();
  PSA.Calendario.render();
  PSA.Actividad.render();
};

function _estadoDatos(mensaje, error = false) {
  const estado = document.getElementById('datos-operacion-status');
  const alerta = document.getElementById('datos-operacion-error');
  if (estado) estado.textContent = error ? '' : (mensaje || '');
  if (alerta) alerta.textContent = error ? (mensaje || '') : '';
}

function _actualizarControlesRestauracion() {
  const aplicar = document.querySelector('[data-action="restore-apply"]');
  const cancelar = document.querySelector('[data-action="restore-cancel"]');
  if (aplicar) aplicar.disabled = !_restauracionUIPreparada || PSA.DB.ocupado || !PSA.DB.tieneArchivo;
  if (cancelar) cancelar.disabled = !_restauracionUIPreparada || PSA.DB.ocupado;
}

PSA.crearBackupUI = async function () {
  if (PSA.DB.ocupado || !PSA.DB.tieneArchivo) return;
  _estadoDatos('Creando copia de seguridad…');
  try {
    const resultado = await PSA.DB.crearBackup();
    if (resultado.ok) _estadoDatos('Copia creada y verificada: ' + resultado.ubicacion + ' (' + resultado.tamano + ' bytes).');
    else _estadoDatos('Creación de copia cancelada.');
  } catch (error) {
    _estadoDatos(error.message, true);
  }
  await PSA.actualizarHistorialBackupsUI();
};

function _abrirSelectorRespaldo(modo) {
  if (PSA.DB.ocupado) {
    _estadoDatos('Hay una operación de base de datos en curso. Espere a que termine.', true);
    return;
  }
  if (modo === 'restaurar' && !PSA.DB.tieneArchivo) {
    _estadoDatos('Conecte primero una base de datos para preparar la restauración.', true);
    return;
  }
  if (modo === 'restaurar' && _restauracionUIPreparada) {
    _estadoDatos('Ya existe una restauración preparada. Cancele esa preparación antes de seleccionar otro respaldo.', true);
    return;
  }
  const input = document.getElementById('datos-restore-file');
  if (!input) {
    _estadoDatos('No está disponible el control de selección de respaldos.', true);
    return;
  }
  // input.click() se ejecuta sin await y dentro del gesto del usuario.
  // Así evitamos depender de la entrega de FileSystemFileHandle por el picker de Chromium.
  _modoSelectorRespaldo = modo;
  input.value = '';
  _estadoDatos(modo === 'restaurar'
    ? 'Seleccione el archivo de respaldo SQLite. Se validará por su contenido, sin depender de la extensión.'
    : 'Seleccione el archivo SQLite que desea validar.');
  try { input.click(); }
  catch (error) {
    _modoSelectorRespaldo = null;
    _estadoDatos('No se pudo abrir el selector de archivos: ' + error.message, true);
  }
}

PSA.validarBackupUI = function () {
  _abrirSelectorRespaldo('validar');
};

PSA.prepararRestauracionUI = function () {
  _abrirSelectorRespaldo('restaurar');
};

async function _procesarArchivoRespaldoSeleccionado(archivo, modo) {
  if (!archivo) {
    _estadoDatos('No se seleccionó ningún archivo. No se modificó ningún dato.');
    return;
  }
  _estadoDatos('Archivo seleccionado: ' + archivo.name + '. Leyendo archivo…');
  try {
    if (modo === 'validar') {
      _estadoDatos('Archivo leído. Iniciando validación SQLite…');
      const resultado = await PSA.DB.validarBackup(archivo);
      _estadoDatos(resultado.valido
        ? 'Copia válida: ' + archivo.name + '. Esquema ' + resultado.versionEsquema + ', ' + resultado.tamano + ' bytes.'
        : 'Copia rechazada (' + resultado.codigo + '): ' + resultado.mensaje, !resultado.valido);
      return;
    }

    _estadoDatos('Archivo leído. Iniciando validación SQLite para restauración…');
    const resultado = await PSA.DB.prepararRestauracion(archivo);
    _restauracionUIPreparada = resultado.preparada;
    const detalle = document.getElementById('datos-restore-detail');
    if (detalle) detalle.textContent = resultado.preparada
      ? 'Respaldo preparado: ' + resultado.nombre + ' · ' + resultado.tamano + ' bytes · esquema ' + resultado.versionEsquema + '. La restauración creará un archivo nuevo y no cambiará la base activa.'
      : 'Respaldo no apto: ' + resultado.validacion.mensaje;
    _estadoDatos(resultado.preparada
      ? 'Respaldo válido y preparado. Ya puede crear el archivo restaurado.'
      : 'El archivo «' + archivo.name + '» fue leído, pero no es apto para restaurar: ' + resultado.validacion.mensaje,
      !resultado.preparada);
  } catch (error) {
    _restauracionUIPreparada = false;
    _estadoDatos('Se seleccionó «' + archivo.name + '», pero ocurrió un error durante la lectura o validación: ' + error.name + ': ' + error.message, true);
  } finally {
    _actualizarControlesRestauracion();
    await PSA.actualizarHistorialBackupsUI();
  }
}

const _selectorArchivoRespaldo = document.getElementById('datos-restore-file');
if (_selectorArchivoRespaldo) {
  _selectorArchivoRespaldo.addEventListener('change', event => {
    const input = event.currentTarget;
    const modo = _modoSelectorRespaldo;
    _modoSelectorRespaldo = null;
    const archivo = input.files && input.files[0];
    void _procesarArchivoRespaldoSeleccionado(archivo, modo || 'restaurar');
  });
  _selectorArchivoRespaldo.addEventListener('cancel', () => {
    _modoSelectorRespaldo = null;
    _estadoDatos('Selección cancelada por el usuario. No se modificó ningún archivo.');
  });
}

PSA.restaurarBackupUI = async function () {
  if (!_restauracionUIPreparada || PSA.DB.ocupado) return;
  _estadoDatos('Seleccione el nombre y la ubicación del nuevo archivo restaurado…');
  try {
    const resultado = await PSA.DB.restaurarBackup();
    if (resultado.ok) {
      _restauracionUIPreparada = false;
      const detalle = document.getElementById('datos-restore-detail');
      if (detalle) detalle.textContent = 'Restauración creada: ' + resultado.ubicacion + '. La base activa sigue siendo la misma.';
      _estadoDatos('Archivo restaurado, releído y validado correctamente. Para trabajar con él, conéctelo mediante el selector habitual.');
    } else if (resultado.cancelado) {
      _estadoDatos(resultado.fase === 'selector'
        ? 'Se canceló el selector del archivo de destino. El respaldo sigue preparado para reintentar.'
        : 'Restauración cancelada en la confirmación. El respaldo sigue preparado para reintentar.');
    }
  } catch (error) {
    _estadoDatos(error.message, true);
  }
  _actualizarControlesRestauracion();
  await PSA.actualizarHistorialBackupsUI();
};

PSA.cancelarRestauracionUI = function () {
  try {
    PSA.DB.cancelarRestauracion();
    _restauracionUIPreparada = false;
    const detalle = document.getElementById('datos-restore-detail');
    if (detalle) detalle.textContent = 'No hay una restauración preparada.';
    _estadoDatos('Preparación cancelada. No se modificó ningún archivo.');
  } catch (error) { _estadoDatos(error.message, true); }
  _actualizarControlesRestauracion();
  PSA.actualizarHistorialBackupsUI();
};

PSA.actualizarHistorialBackupsUI = async function () {
  const lista = document.getElementById('datos-historial');
  const vacio = document.getElementById('datos-historial-vacio');
  const estado = document.getElementById('datos-historial-estado');
  const boton = document.querySelector('[data-action="backup-history-refresh"]');
  if (!lista || !vacio || !PSA.DB.listarHistorialBackups) return;

  if (boton) {
    boton.disabled = true;
    boton.textContent = 'Actualizando…';
  }
  if (estado) estado.textContent = 'Consultando el historial local…';

  try {
    const registros = await PSA.DB.listarHistorialBackups();
    lista.replaceChildren();
    vacio.classList.toggle('hidden', registros.length > 0);
    vacio.textContent = registros.length ? 'Todavía no hay operaciones registradas.' : 'Todavía no hay operaciones registradas.';
    registros.forEach(registro => {
      const item = document.createElement('li');
      const fecha = new Date(registro.fecha);
      const fechaTexto = Number.isNaN(fecha.getTime()) ? registro.fecha : fecha.toLocaleString();
      item.textContent = [fechaTexto, registro.tipo, registro.archivo || 'sin archivo', registro.resultado,
        registro.tamano === null ? '' : registro.tamano + ' bytes', registro.mensaje].filter(Boolean).join(' · ');
      lista.appendChild(item);
    });
    if (estado) {
      estado.textContent = registros.length
        ? 'Historial actualizado: ' + registros.length + ' operación(es). Última consulta: ' + new Date().toLocaleTimeString() + '.'
        : 'Historial consultado: todavía no hay operaciones registradas. Última consulta: ' + new Date().toLocaleTimeString() + '.';
    }
    return registros.length;
  } catch (error) {
    vacio.textContent = 'No se pudo consultar el historial: ' + error.message;
    vacio.classList.remove('hidden');
    if (estado) estado.textContent = 'Falló la actualización del historial.';
    console.error('[PSA] No se pudo actualizar el historial de respaldos:', error);
    return null;
  } finally {
    if (boton) {
      boton.disabled = false;
      boton.textContent = 'Actualizar historial';
    }
  }
};

window.addEventListener('psa:backup-state', () => PSA.actualizarHistorialBackupsUI());
window.addEventListener('psa:restore-state', event => {
  if (event.detail.estado === 'exitosa' || event.detail.estado === 'cancelada') {
    PSA.actualizarHistorialBackupsUI();
  }
});

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
  document.querySelectorAll('#v-datos button[data-action]').forEach(el => {
    if (el.dataset.action === 'backup-history-refresh') return;
    if (el.dataset.action === 'backup-validate') el.disabled = !!ocupado || !useSQLite;
    else el.disabled = !!ocupado || !tieneArchivo;
  });
  _actualizarControlesRestauracion();
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
    if (btnEl) { btnEl.textContent = esperaPermiso ? 'Reconectar vertex.db' : 'Cambiar carpeta de base de datos'; btnEl.classList.remove('hidden'); }
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
  const reautorizarActiva = PSA.DB.tieneArchivo && PSA.DB.esperaPermiso && !elegirCarpeta;
  const formularioModificado = Array.from(document.querySelectorAll('#v-proyectos .grid input, #v-proyectos .grid textarea, #v-proyectos .grid select'))
    .some(el => el.tagName === 'SELECT' ? el.selectedIndex !== 0 : el.value !== el.defaultValue);
  if (!reautorizarActiva && (formularioModificado || PSA.Proyectos.editandoId)) {
    if (!confirm('Hay datos sin guardar en el formulario. Si cambia de base, se descartarán. ¿Continuar?')) return;
  }
  try {
    const resultado = PSA.DB.esperaPermiso && !elegirCarpeta
      ? await PSA.DB.solicitarPermiso()
      : await PSA.DB.configurarCarpeta();
    if (resultado.ok) {
      if (resultado.reautorizada) {
        PSA.toast('Acceso autorizado. Reintente el guardado pendiente.');
        return;
      }
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
  PSA.actualizarHistorialBackupsUI();
})();
