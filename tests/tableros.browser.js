'use strict';

// Cargar únicamente en una página de prueba sin base conectada, nunca en la sesión de uso.
window.prepararPruebaTableros = async function (datos = []) {
  if (PSA.DB.ocupado) {
    await new Promise(resolve => {
      const terminado = event => {
        if (event.detail.ocupado) return;
        window.removeEventListener('psa:db-state', terminado);
        resolve();
      };
      window.addEventListener('psa:db-state', terminado);
    });
  }
  if (PSA.DB.tieneArchivo) throw new Error('Use una página sin base conectada para ejecutar esta prueba.');
  const store = new Map();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          close() {},
          transaction() {
            const tx = { objectStore: () => ({
              put(value, key) { store.set(key, value); queueMicrotask(() => tx.oncomplete()); return {}; },
              get(key) {
                const result = { result: store.get(key) };
                queueMicrotask(() => tx.oncomplete());
                return result;
              }
            }) };
            return tx;
          }
        };
        req.onsuccess();
      });
      return req;
    }
  } });
  const file = {
    kind: 'file', name: 'vertex.db', datos: new Uint8Array(datos), fallo: false, falloCierre: false,
    async getFile() {
      const bytes = this.datos.slice();
      return { arrayBuffer: async () => bytes.buffer };
    },
    async createWritable() {
      const archivo = this;
      let bytes;
      return {
        async write(data) {
          if (archivo.fallo) throw new Error('Disco sin espacio (prueba aislada)');
          bytes = data.slice();
        },
        async close() {
          if (archivo.esperar) await archivo.esperar;
          if (archivo.falloCierre) throw new Error('Error al cerrar el archivo (prueba aislada)');
          archivo.datos = bytes;
        },
        async abort() {}
      };
    }
  };
  window.__archivoPruebaTableros = file;
  window.showDirectoryPicker = async () => ({
    kind: 'directory', name: 'Prueba aislada', async getFileHandle() { return file; }
  });
  window.confirm = () => true;
  await PSA.gestionarConexionDB();
  if (!PSA.DB.tieneArchivo) throw new Error('No se conectó la base de prueba.');
};

window.probarInterfazTableros = async function () {
  const resultados = [];
  const check = (valor, nombre) => {
    if (!valor) throw new Error(nombre);
    resultados.push(nombre);
  };
  const $ = selector => document.querySelector(selector);
  const click = selector => {
    const boton = $(selector);
    if (!boton || boton.disabled) throw new Error('Acción no disponible: ' + selector);
    boton.click();
  };
  const cambiar = (selector, valor) => {
    const control = $(selector);
    control.value = valor;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const valor = (nombre, dato) => { $('#trabajo-form [name="' + nombre + '"]').value = dato; };
  const esperar = async () => {
    for (let i = 0; i < 1000; i++) {
      if (!PSA.DB.ocupado) { await Promise.resolve(); return; }
      await Promise.resolve();
    }
    throw new Error('La escritura no finalizó.');
  };
  const guardar = async () => {
    $('#trabajo-form').requestSubmit();
    await esperar();
  };
  const accion = (tipo, id) => '[data-accion="' + tipo + '"]' + (id ? '[data-id="' + id + '"]' : '');
  const cancelar = () => click('#trabajo-dialog-cancelar');
  const modal = () => $('#trabajo-dialog').open;

  await window.prepararPruebaTableros();
  PSA.cambiarTab('v-tableros', 'v-tableros');
  check($('#tableros-catalogo').textContent.includes('Primero cree un proyecto'), 'Estado vacío sin proyectos');
  check($(accion('nuevo-tablero')).disabled, 'Crear tablero requiere proyecto real');
  PSA.cambiarTab('v-proyectos', 'v-proyectos');
  $('#p-nombre').value = 'Proyecto UI aislado';
  $('#p-responsable').value = 'Responsable histórico';
  $('#p-inicio').value = '2026-10-24';
  await PSA.Proyectos.guardarProyecto();
  const proyecto = PSA.DB.getProyectos()[0];
  click('#tabla-proyectos-body button:nth-child(2)');
  check($('#v-tableros').classList.contains('active') && $('#tableros-proyecto').value === proyecto.id, 'Abrir tableros desde proyecto existente');
  check($('nav.tabs [data-view="v-tableros"]').getAttribute('aria-selected') === 'true', 'Navegación con estado ARIA');

  click(accion('nuevo-tablero'));
  valor('nombre', '   ');
  await guardar();
  check(modal() && $('#trabajo-dialog-error').textContent.includes('obligatorio'), 'Validación de nombre de tablero');
  valor('nombre', 'Operaciones <img src=x onerror="window.__inyeccion=1">');
  valor('descripcion', "Descripción O'Brien\nSegunda línea");
  await guardar();
  const tablero = PSA.Trabajo.getTableros()[0];
  check(!modal() && tablero.proyecto_id === proyecto.id, 'Crear tablero asociado y cerrar tras persistir');
  check(document.querySelectorAll('.kanban-list').length === 5, 'Cinco listas iniciales en columnas');
  check(!$('#tableros-catalogo img') && !window.__inyeccion, 'Nombre de tablero escapado');
  check($('#tablero-descripcion').textContent.includes("O'Brien"), 'Consultar descripción persistida');

  click(accion('editar-tablero-actual'));
  check($('#trabajo-form [name="proyecto_id"]').disabled, 'No cambiar proyecto al editar tablero');
  valor('nombre', 'Operaciones actualizadas');
  await guardar();
  check(PSA.Trabajo.getTableros()[0].nombre === 'Operaciones actualizadas', 'Editar tablero');

  click(accion('nueva-lista'));
  valor('nombre', 'Personalizada <b>literal</b>');
  valor('categoria', 'en_revision');
  await guardar();
  const lista = PSA.Trabajo.getListas(tablero.id).find(l => l.nombre.includes('Personalizada'));
  check(!!lista && lista.categoria === 'en_revision', 'Crear lista con nombre libre');
  click(accion('lista', lista.id));
  valor('nombre', 'Lista renombrada');
  await guardar();
  check(PSA.Trabajo.getListas(tablero.id).find(l => l.id === lista.id).nombre === 'Lista renombrada', 'Renombrar lista');
  click(accion('lista-anterior', lista.id)); await esperar();
  check(PSA.Trabajo.getListas(tablero.id)[4].id === lista.id, 'Reordenar listas con persistencia');

  const responsable = await PSA.Trabajo.guardarResponsable({ nombre: 'Persona del catálogo' });
  PSA.renderTodo();
  click(accion('nueva-tarjeta', lista.id));
  valor('titulo', '   ');
  await guardar();
  check(modal() && $('#trabajo-dialog-error').textContent.includes('obligatorio'), 'Validación de título de tarjeta');
  valor('titulo', 'Tarjeta <script>window.__inyeccion=1</script>');
  valor('descripcion', 'Descripción persistente');
  valor('responsable_id', responsable);
  valor('prioridad', 'Urgente');
  valor('inicio', '2026-10-24');
  valor('vencimiento', '2026-10-23');
  await guardar();
  check(modal() && $('#trabajo-dialog-error').textContent.includes('posterior'), 'Validación de rango de fechas');
  valor('inicio', '2020-01-01');
  valor('vencimiento', '2020-01-02');
  valor('observaciones', 'Observación de prueba');
  await guardar();
  const tarjeta = PSA.Trabajo.getTarjetas()[0];
  check(tarjeta.lista_id === lista.id && tarjeta.responsable_id === responsable, 'Asociaciones correctas de tarjeta');
  check(!$('#tablero-columnas script') && !window.__inyeccion, 'Título de tarjeta escapado');
  check(!!$('.work-priority-high') && !!$('.work-overdue'), 'Indicadores de prioridad y vencimiento');
  click(accion('lista', lista.id));
  check($('#trabajo-form [name="categoria"]').disabled, 'Categoría protegida cuando hay tarjetas');
  cancelar();
  click(accion('tarjeta', tarjeta.id));
  check($('#trabajo-form [name="descripcion"]').value === 'Descripción persistente', 'Consultar detalle sin perder tablero');
  valor('titulo', 'Cambio confirmado');
  $('#trabajo-form [name="completada"]').checked = true;
  let liberar;
  window.__archivoPruebaTableros.esperar = new Promise(resolve => { liberar = resolve; });
  $('#trabajo-form').requestSubmit();
  await Promise.resolve();
  check(PSA.DB.ocupado && $('#trabajo-dialog-cancelar').disabled &&
    $('#trabajo-dialog-estado').textContent.includes('Guardando'), 'Bloqueo y estado durante guardado');
  check(PSA.Trabajo.getTarjetas()[0].titulo === tarjeta.titulo && modal(), 'No publicar ni cerrar antes de confirmar escritura');
  liberar(); await esperar();
  window.__archivoPruebaTableros.esperar = null;
  check(!modal() && PSA.Trabajo.getTarjetas()[0].completada === 1, 'Edición y completitud confirmadas');

  click(accion('tarjeta', tarjeta.id));
  valor('titulo', 'No debe persistir');
  window.__archivoPruebaTableros.fallo = true;
  await guardar();
  check(modal() && $('#trabajo-dialog-error').textContent.includes('Disco sin espacio') &&
    $('#trabajo-form [name="titulo"]').value === 'No debe persistir', 'Error de disco conserva formulario');
  check(PSA.Trabajo.getTarjetas()[0].titulo === 'Cambio confirmado', 'Error de disco conserva estado visible');
  window.__archivoPruebaTableros.fallo = false;
  valor('titulo', 'Reintento confirmado'); await guardar();
  check(!modal() && PSA.Trabajo.getTarjetas()[0].titulo === 'Reintento confirmado', 'Reintentar guardado');

  click(accion('archivo-tarjeta', tarjeta.id)); await esperar();
  check(!$(accion('tarjeta', tarjeta.id)), 'Archivar tarjeta la oculta del trabajo activo');
  cambiar('#tablero-ver-archivados', '');
  $('#tablero-ver-archivados').checked = true;
  $('#tablero-ver-archivados').dispatchEvent(new Event('change'));
  click(accion('tarjeta', tarjeta.id));
  check($('#trabajo-form [name="titulo"]').disabled, 'Detalle archivado en solo lectura');
  cancelar();
  click(accion('archivo-tarjeta', tarjeta.id)); await esperar();
  check(PSA.Trabajo.getTarjetas()[0].archivada === 0, 'Restaurar tarjeta');

  click(accion('archivo-lista', lista.id)); await esperar();
  check(PSA.Trabajo.getListas(tablero.id).find(l => l.id === lista.id).archivado === 1, 'Archivar lista');
  check($(accion('nueva-tarjeta', lista.id)).disabled, 'Lista archivada no admite nuevas tarjetas');
  click(accion('archivo-lista', lista.id)); await esperar();
  check(PSA.Trabajo.getListas(tablero.id).find(l => l.id === lista.id).archivado === 0, 'Restaurar lista');

  click(accion('archivo-tablero', tablero.id)); await esperar();
  check(!$('#tableros-catalogo ' + accion('abrir', tablero.id)), 'Archivar tablero lo oculta del catálogo activo');
  $('#tableros-archivados').checked = true;
  $('#tableros-archivados').dispatchEvent(new Event('change'));
  click(accion('abrir', tablero.id));
  check($(accion('nueva-lista')).disabled, 'Tablero archivado solo consultable');
  click(accion('archivo-tablero', tablero.id)); await esperar();
  check(PSA.Trabajo.getTableros()[0].archivado === 0, 'Restaurar tablero');
  for (const fila of PSA.Trabajo.getListas(tablero.id)) await PSA.Trabajo.archivar('lista', fila.id, true);
  $('#tablero-ver-archivados').checked = false;
  PSA.renderTodo();
  check($('#tablero-columnas').textContent.includes('Cree la primera lista'), 'Estado vacío sin listas visibles');
  for (const fila of PSA.Trabajo.getListas(tablero.id)) await PSA.Trabajo.archivar('lista', fila.id, false);
  PSA.renderTodo();

  PSA.cambiarTab('v-proyectos', 'v-proyectos');
  $('#filtro-p-texto').value = 'No coincide'; PSA.Proyectos.renderTabla();
  check(document.querySelectorAll('#tabla-proyectos-body tr').length === 0, 'Filtros históricos conservados');
  PSA.Proyectos.limpiarFiltros();
  check(document.querySelector('#dash-estado .num').textContent === '1', 'Dashboard de proyectos conservado');
  PSA.Proyectos.editarProyecto(proyecto.id);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  check(PSA.Proyectos.editandoId === null, 'Esc histórico conservado');

  const anterior = URL.createObjectURL;
  const anteriorClick = HTMLAnchorElement.prototype.click;
  let descarga;
  URL.createObjectURL = blob => { descarga = blob; return 'blob:prueba-aislada'; };
  HTMLAnchorElement.prototype.click = function () {};
  try {
    PSA.Proyectos.exportarCSV();
    check((await descarga.text()).includes('Proyecto UI aislado'), 'CSV histórico conservado');
    PSA.Proyectos.exportarDB();
    check(new TextDecoder().decode(new Uint8Array(await descarga.arrayBuffer()).slice(0, 16)) === 'SQLite format 3\0', 'Exportación SQLite conservada');
  } finally {
    URL.createObjectURL = anterior;
    HTMLAnchorElement.prototype.click = anteriorClick;
  }
  return {
    resultados, tableroId: tablero.id, tarjetaId: tarjeta.id, listaId: lista.id, proyectoId: proyecto.id,
    orden: PSA.Trabajo.getListas(tablero.id).map(l => l.id)
  };
};

window.verificarReaperturaTableros = function (anterior) {
  const resultados = [];
  const check = (valor, nombre) => {
    if (!valor) throw new Error(nombre);
    resultados.push(nombre);
  };
  const tablero = PSA.Trabajo.getTableros().find(t => t.id === anterior.tableroId);
  const tarjeta = PSA.Trabajo.getTarjetas().find(t => t.id === anterior.tarjetaId);
  check(tablero && tablero.nombre === 'Operaciones actualizadas', 'Tablero editado conservado al recargar');
  check(tarjeta && tarjeta.titulo === 'Reintento confirmado' && tarjeta.completada === 1, 'Tarjeta editada conservada al recargar');
  check(tarjeta.lista_id === anterior.listaId && tarjeta.proyecto_id === anterior.proyectoId, 'Relaciones conservadas al recargar');
  check(JSON.stringify(PSA.Trabajo.getListas(tablero.id).map(l => l.id)) === JSON.stringify(anterior.orden), 'Orden de listas conservado al recargar');
  PSA.Tableros.abrirProyecto(anterior.proyectoId);
  document.querySelector('[data-accion="abrir"]').click();
  check(document.querySelectorAll('.kanban-list').length === 6 && document.querySelectorAll('.work-card').length === 1, 'Kanban reconstruido desde SQLite al recargar');
  check(PSA.DB.getProyectos()[0].responsable === 'Responsable histórico', 'Proyecto histórico conservado al recargar');
  return resultados;
};

window.verificarDisenoTableros = async function () {
  const tablero = PSA.Trabajo.getTableros()[0];
  const proyecto = PSA.DB.getProyectos().find(p => p.id === tablero.proyecto_id);
  const resultados = [];
  const check = (valor, nombre) => {
    if (!valor) throw new Error(nombre + ' a ' + innerWidth + ' px');
    resultados.push(nombre);
  };
  try {
    await PSA.DB.saveProyecto({ ...proyecto, nombre: 'P'.repeat(200) }, false);
    await PSA.Trabajo.guardarTablero({ id: tablero.id, nombre: 'T'.repeat(200) });
    PSA.Tableros.abrirProyecto(proyecto.id);
    document.querySelector('[data-accion="abrir"]').click();
    const ancho = document.documentElement.clientWidth;
    check(document.documentElement.scrollWidth <= ancho, 'Nombres largos sin desborde de página');
    const kanban = document.querySelector('#tablero-columnas');
    check(kanban.scrollWidth > kanban.clientWidth, 'Desplazamiento limitado a las columnas');
    const boton = document.querySelector('[data-accion="tarjeta"]');
    boton.focus();
    boton.click();
    const dialog = document.querySelector('#trabajo-dialog');
    const rect = dialog.getBoundingClientRect();
    check(rect.left >= 0 && rect.right <= ancho && dialog.scrollWidth <= dialog.clientWidth, 'Diálogo sin desborde horizontal');
    const columnas = getComputedStyle(document.querySelector('#trabajo-dialog .grid')).gridTemplateColumns.split(' ').length;
    check(columnas === (innerWidth <= 600 ? 1 : 2), 'Grilla del editor adaptable');
    check(getComputedStyle(document.querySelector('#tableros-archivados')).minWidth === '0px', 'Checkbox sin ancho mínimo heredado');
    document.querySelector('#trabajo-dialog-cancelar').click();
    return { ancho: innerWidth, resultados };
  } finally {
    if (document.querySelector('#trabajo-dialog').open) document.querySelector('#trabajo-dialog-cancelar').click();
    await PSA.DB.saveProyecto(proyecto, false);
    await PSA.Trabajo.guardarTablero({ id: tablero.id, nombre: tablero.nombre });
    PSA.renderTodo();
  }
};

window.verificarCambioBaseTableros = async function () {
  const original = window.__archivoPruebaTableros;
  const selector = window.showDirectoryPicker;
  const tablero = PSA.Trabajo.getTableros()[0];
  const filtro = document.querySelector('#tableros-proyecto').value;
  const resultados = [];
  const check = (valor, nombre) => {
    if (!valor) throw new Error(nombre);
    resultados.push(nombre);
  };
  const elegir = archivo => async () => ({ kind: 'directory', name: 'Otra prueba', async getFileHandle() { return archivo; } });
  try {
    window.showDirectoryPicker = async () => { throw new DOMException('Cancelado', 'AbortError'); };
    await PSA.gestionarConexionDB(true);
    check(document.querySelector('#tableros-proyecto').value === filtro &&
      document.querySelector('#tablero-titulo').textContent === tablero.nombre, 'Cancelar conexión conserva selección');
    window.showDirectoryPicker = elegir({ ...original, datos: new Uint8Array([1, 2, 3]) });
    await PSA.gestionarConexionDB(true);
    check(PSA.Trabajo.getTableros()[0].id === tablero.id &&
      document.querySelector('#tablero-titulo').textContent === tablero.nombre, 'Base inválida conserva datos y detalle');
    window.showDirectoryPicker = elegir({ ...original, datos: new Uint8Array() });
    await PSA.gestionarConexionDB(true);
    check(PSA.Trabajo.getTableros().length === 0 && document.querySelector('#tableros-proyecto').value === '' &&
      document.querySelector('#tablero-detalle').classList.contains('hidden'), 'Cambio confirmado reinicia selección y detalle');
    window.showDirectoryPicker = selector;
    await PSA.gestionarConexionDB(true);
    check(PSA.Trabajo.getTableros()[0].id === tablero.id && PSA.Trabajo.getTarjetas().length === 1,
      'Volver a la base original conserva sus entidades sin mezclarlas');
    return resultados;
  } finally {
    window.showDirectoryPicker = selector;
  }
};

window.probarMovimientoTarjetas = async function () {
  const resultados = [];
  const check = (valor, nombre) => {
    if (!valor) throw new Error(nombre);
    resultados.push(nombre);
  };
  const $ = selector => document.querySelector(selector);
  const accion = (nombre, id) => Array.from(document.querySelectorAll('[data-accion="' + nombre + '"]'))
    .find(boton => boton.dataset.id === id);
  const esperar = async () => {
    for (let i = 0; i < 1000; i++) {
      if (!PSA.DB.ocupado) { await Promise.resolve(); return; }
      await Promise.resolve();
    }
    throw new Error('La escritura de movimiento no finalizó.');
  };
  await prepararPruebaTableros();
  const proyecto = {
    id: PSA.genId(), nombre: 'Prueba de movimiento', responsable: 'Responsable',
    division: '', inicio: '2026-10-25', meta: '', fin: '', estado: 'En curso',
    avance: 25, implementacion: 'No iniciado',
    cumplimiento: 'En curso (pendiente de evaluar)', objetivo: '', resultado: '', observaciones: ''
  };
  await PSA.DB.saveProyecto(proyecto, true);
  const tableroId = await PSA.Trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Movimiento individual y múltiple' });
  const listas = PSA.Trabajo.getListas(tableroId);
  const origen = listas[0], siguiente = listas[1], especifica = listas[2], destinoMultiple = listas[3], ultima = listas[4];
  const ids = [];
  for (const titulo of ['A', 'B', 'C', 'D', 'E']) {
    ids.push(await PSA.Trabajo.guardarTarjeta({ lista_id: origen.id, titulo }));
  }
  const preexistentes = [];
  for (const titulo of ['X', 'Y']) {
    preexistentes.push(await PSA.Trabajo.guardarTarjeta({ lista_id: siguiente.id, titulo }));
  }
  PSA.Tableros.abrirProyecto(proyecto.id);
  accion('abrir', tableroId).click();

  const antesBordes = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  accion('tarjeta-anterior', ids[0]).click();
  await esperar();
  check($('#tableros-error').textContent.includes('No existe una etapa anterior') &&
    JSON.stringify(PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion])) === JSON.stringify(antesBordes),
  'Mover antes de la primera etapa se informa y no cambia datos');
  accion('tarjeta-siguiente', ids[4]).click();
  await esperar();
  check(PSA.Trabajo.getTarjetas().find(t => t.id === ids[4]).lista_id === siguiente.id,
    'Mover una tarjeta individual a la etapa siguiente');
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === origen.id).map(t => t.id)) ===
    JSON.stringify(ids.slice(0, 4)), 'Tarjetas no seleccionadas permanecen en el mismo orden');
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === origen.id).map(t => t.posicion)) ===
    JSON.stringify([0, 1, 2, 3]), 'Movimiento individual conserva posiciones de origen no seleccionadas');
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === siguiente.id).map(t => t.posicion)) ===
    JSON.stringify([0, 1, 2]), 'Movimiento individual agrega después de las posiciones existentes');

  const especificaSelect = Array.from(document.querySelectorAll('.tarjeta-destino')).find(control => control.dataset.id === ids[4]);
  especificaSelect.value = especifica.id;
  accion('mover-tarjeta', ids[4]).click();
  await esperar();
  check(PSA.Trabajo.getTarjetas().find(t => t.id === ids[4]).lista_id === especifica.id,
    'Elegir etapa específica para una sola tarjeta');
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === siguiente.id).map(t => t.id)) ===
    JSON.stringify(preexistentes), 'Las tarjetas de destino conservan orden al mover una tarjeta');

  for (const id of [ids[3], ids[1]]) {
    const control = Array.from(document.querySelectorAll('.tarjeta-seleccion')).find(item => item.dataset.id === id);
    control.checked = true;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
  check($('#tablero-seleccion-cantidad').textContent === '2 tarjetas seleccionadas', 'Conteo visible de selección múltiple');
  accion('mover-seleccion-destino').click();
  await esperar();
  check($('#tableros-error').textContent.includes('Seleccione una etapa de destino'),
    'Destino específico múltiple obligatorio');
  $('#tablero-seleccion-destino').value = destinoMultiple.id;
  accion('mover-seleccion-destino').click();
  await esperar();
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === destinoMultiple.id).map(t => t.id)) ===
    JSON.stringify([ids[1], ids[3]]), 'Solo las seleccionadas se mueven al destino específico en orden original');
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === origen.id).map(t => t.id)) ===
    JSON.stringify([ids[0], ids[2]]), 'No seleccionadas mantienen su orden tras movimiento múltiple');
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === origen.id).map(t => t.posicion)) ===
    JSON.stringify([0, 2]), 'Movimiento múltiple no renumera las posiciones no seleccionadas');
  check($('#tablero-seleccion-cantidad').textContent === '0 tarjetas seleccionadas', 'Movimiento exitoso limpia selección');

  accion('seleccionar-etapa', destinoMultiple.id).click();
  check($('#tablero-seleccion-cantidad').textContent === '2 tarjetas seleccionadas' &&
    Array.from(document.querySelectorAll('.tarjeta-seleccion')).filter(control => control.checked).length === 2,
  'Seleccionar todas las tarjetas de una etapa');
  accion('mover-seleccion-anterior').click();
  await esperar();
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === especifica.id).map(t => t.id)) ===
    JSON.stringify([ids[4], ids[1], ids[3]]), 'Movimiento múltiple a etapa anterior preserva el orden seleccionado');
  check(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === destinoMultiple.id).length === 0,
    'Las tarjetas no seleccionadas no se trasladan con la etapa');

  const checkboxes = Array.from(document.querySelectorAll('.tarjeta-seleccion'));
  const tarjetaA = checkboxes.find(control => control.dataset.id === ids[0]);
  tarjetaA.checked = true;
  tarjetaA.dispatchEvent(new Event('change', { bubbles: true }));
  check($('#tablero-seleccion-cantidad').textContent === '1 tarjeta seleccionada',
    'Seleccionar una sola tarjeta actualiza el contador');
  const desmarcarA = Array.from(document.querySelectorAll('.tarjeta-seleccion')).find(control => control.dataset.id === ids[0]);
  desmarcarA.checked = false;
  desmarcarA.dispatchEvent(new Event('change', { bubbles: true }));
  check($('#tablero-seleccion-cantidad').textContent === '0 tarjetas seleccionadas',
    'Desmarcar una tarjeta la quita de la selección');
  for (const id of [ids[0], ids[2]]) {
    const control = Array.from(document.querySelectorAll('.tarjeta-seleccion')).find(item => item.dataset.id === id);
    control.checked = true;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
  accion('cancelar-seleccion').click();
  check($('#tablero-seleccion-cantidad').textContent === '0 tarjetas seleccionadas' &&
    Array.from(document.querySelectorAll('.tarjeta-seleccion')).every(control => !control.checked),
  'Cancelar selección desmarca todas las tarjetas');
  accion('mover-seleccion-siguiente').click();
  await Promise.resolve();
  await Promise.resolve();
  check($('#tableros-error').textContent.includes('Seleccione al menos una tarjeta'),
    'Movimiento múltiple sin selección muestra mensaje y no cambia datos');

  const seleccionables = [ids[1], ids[3]];
  for (const id of seleccionables) {
    const control = Array.from(document.querySelectorAll('.tarjeta-seleccion')).find(item => item.dataset.id === id);
    control.checked = true;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
  $('#tablero-seleccion-destino').value = ultima.id;
  const antesFallo = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  window.__archivoPruebaTableros.falloCierre = true;
  accion('mover-seleccion-destino').click();
  await esperar();
  check($('#tableros-error').textContent.includes('cerrar') &&
    JSON.stringify(PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion])) === JSON.stringify(antesFallo),
  'Fallo de escritura no aplica movimientos parciales y mantiene selección');
  window.__archivoPruebaTableros.falloCierre = false;
  accion('mover-seleccion-destino').click();
  await esperar();
  check(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === ultima.id).map(t => t.id).join(',') === ids.slice(1, 4).filter(id => id === ids[1] || id === ids[3]).join(','),
    'Reintento mueve únicamente tarjetas seleccionadas');
  check(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === especifica.id).map(t => t.id).join(',') === ids[4],
    'Tarjetas restantes mantienen su etapa y orden tras reintento');
  const antesUltima = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  accion('tarjeta-siguiente', ids[3]).click();
  await esperar();
  check($('#tableros-error').textContent.includes('No existe una etapa siguiente') &&
    JSON.stringify(PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion])) === JSON.stringify(antesUltima),
  'Mover después de la última etapa se informa y no modifica datos');
  accion('seleccionar-etapa', origen.id).click();
  check($('#tablero-seleccion-cantidad').textContent === '2 tarjetas seleccionadas',
    'Seleccionar etapa completa antes del movimiento siguiente');
  accion('mover-seleccion-siguiente').click();
  await esperar();
  check(JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === siguiente.id).map(t => t.id)) ===
    JSON.stringify([...preexistentes, ids[0], ids[2]]) &&
    JSON.stringify(PSA.Trabajo.getTarjetas().filter(t => t.lista_id === siguiente.id).map(t => t.posicion)) ===
    JSON.stringify([0, 1, 2, 3]), 'Mover selección a etapa siguiente conserva el orden y el destino');

  const ordenFinal = PSA.Trabajo.getListas(tableroId).map(l => l.id);
  const ubicaciones = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  const archivo = Array.from(window.__archivoPruebaTableros.datos);
  return {
    resultados, proyectoId: proyecto.id, tableroId, tarjetas: ids, listas: listas.map(l => l.id),
    ordenFinal, ubicaciones, archivo
  };
};

window.verificarReaperturaMovimiento = function (anterior) {
  const actuales = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  if (JSON.stringify(actuales) !== JSON.stringify(anterior.ubicaciones)) {
    throw new Error('El orden y las etapas de tarjetas no sobrevivieron a la reapertura.');
  }
  if (JSON.stringify(PSA.Trabajo.getListas(anterior.tableroId).map(l => l.id)) !== JSON.stringify(anterior.ordenFinal)) {
    throw new Error('El orden del tablero cambió al reabrir.');
  }
  PSA.Tableros.abrirProyecto(anterior.proyectoId);
  document.querySelector('[data-accion="abrir"]').click();
  return 'Ubicaciones, posiciones y orden de listas persistidos al reabrir';
};

window.probarArrastreTarjetas = async function () {
  const resultados = [];
  const check = (valor, nombre) => {
    if (!valor) throw new Error(nombre);
    resultados.push(nombre);
  };
  const $ = selector => document.querySelector(selector);
  const tarjetasDe = listaId => PSA.Trabajo.getTarjetas()
    .filter(t => t.lista_id === listaId && !t.archivada)
    .sort((a, b) => a.posicion - b.posicion || a.id.localeCompare(b.id));
  const control = (accion, id) => Array.from(document.querySelectorAll('[data-accion="' + accion + '"]'))
    .find(elemento => elemento.dataset.id === id);
  const esperar = async () => {
    for (let i = 0; i < 1000; i++) {
      if (!PSA.DB.ocupado) { await Promise.resolve(); return; }
      await Promise.resolve();
    }
    throw new Error('La escritura de arrastre no finalizó.');
  };
  const iniciar = id => {
    const handle = Array.from(document.querySelectorAll('.work-drag-handle'))
      .find(elemento => elemento.closest('.work-card').dataset.cardId === id);
    const transferencia = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true, cancelable: true, dataTransfer: transferencia
    }));
    return { handle, transferencia };
  };
  const soltar = (id, selector, fraccion = .1) => {
    const { handle, transferencia } = iniciar(id);
    const destino = $(selector);
    if (!destino) throw new Error('No se encontró el destino de prueba: ' + selector);
    const rectangulo = destino.getBoundingClientRect();
    const y = rectangulo.top + rectangulo.height * fraccion;
    const opciones = { bubbles: true, cancelable: true, dataTransfer: transferencia, clientY: y };
    destino.dispatchEvent(new DragEvent('dragover', opciones));
    const listaDestino = destino.closest('.kanban-list');
    check(listaDestino.classList.contains('drop-target') || listaDestino.classList.contains('drop-invalid'),
      'La zona de soltado muestra el estado del destino antes de persistir');
    destino.dispatchEvent(new DragEvent('drop', opciones));
    handle.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  };

  await prepararPruebaTableros();
  const proyecto = {
    id: PSA.genId(), nombre: 'Prueba de arrastre', responsable: 'Responsable',
    division: '', inicio: '2026-10-25', meta: '', fin: '', estado: 'En curso',
    avance: 10, implementacion: 'No iniciado',
    cumplimiento: 'En curso (pendiente de evaluar)', objetivo: '', resultado: '', observaciones: ''
  };
  await PSA.DB.saveProyecto(proyecto, true);
  const tableroId = await PSA.Trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Arrastre y posiciones' });
  const listas = PSA.Trabajo.getListas(tableroId);
  const [origen, destino] = listas;
  const ids = [];
  for (const titulo of ['A', 'B', 'C', 'D']) {
    ids.push(await PSA.Trabajo.guardarTarjeta({ lista_id: origen.id, titulo }));
  }
  const existentes = [];
  for (const titulo of ['X', 'Y']) {
    existentes.push(await PSA.Trabajo.guardarTarjeta({ lista_id: destino.id, titulo }));
  }
  PSA.Tableros.abrirProyecto(proyecto.id);
  control('abrir', tableroId).click();

  const handle = Array.from(document.querySelectorAll('.work-drag-handle'))
    .find(elemento => elemento.closest('.work-card').dataset.cardId === ids[0]);
  check(handle && handle.draggable && !handle.closest('.work-card').draggable,
    'Solo el control dedicado inicia el arrastre; la tarjeta completa no es arrastrable');
  check(control('tarjeta-posicion-anterior', ids[0]).disabled &&
    !control('tarjeta-posicion-anterior', ids[1]).disabled &&
    control('tarjeta-posicion-siguiente', ids[3]).disabled,
  'Los controles accesibles de orden respetan los límites de la etapa');
  const moverBoton = control('tarjeta-siguiente', ids[0]);
  moverBoton.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  check(!moverBoton.closest('.work-card').classList.contains('work-dragging'),
    'Los botones internos no inician accidentalmente el arrastre');

  const destinoY = Array.from(document.querySelectorAll('.work-card'))
    .find(elemento => elemento.dataset.cardId === existentes[1]);
  const arrastreD = iniciar(ids[3]);
  const rectY = destinoY.getBoundingClientRect();
  const antesY = { bubbles: true, cancelable: true, dataTransfer: arrastreD.transferencia, clientY: rectY.top + 1 };
  destinoY.dispatchEvent(new DragEvent('dragover', antesY));
  check(Array.from(document.querySelectorAll('.kanban-list[data-inactive="false"]'))
    .every(lista => lista.classList.contains('drop-valid')), 'Las etapas activas indican destinos posibles');
  check(destinoY.classList.contains('drop-before'), 'Se indica visualmente la posición intermedia antes de soltar');
  destinoY.dispatchEvent(new DragEvent('drop', antesY));
  arrastreD.handle.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  await esperar();
  check(JSON.stringify(tarjetasDe(destino.id).map(t => t.id)) ===
    JSON.stringify([existentes[0], ids[3], existentes[1]]), 'Arrastrar entre etapas inserta en una posición intermedia');
  check(JSON.stringify(tarjetasDe(origen.id).map(t => t.id)) === JSON.stringify(ids.slice(0, 3)),
    'El arrastre entre etapas no mueve tarjetas no seleccionadas');

  const destinoB = Array.from(document.querySelectorAll('.work-card'))
    .find(elemento => elemento.dataset.cardId === ids[1]);
  const arrastreMismo = iniciar(ids[3]);
  const rectB = destinoB.getBoundingClientRect();
  const antesB = { bubbles: true, cancelable: true, dataTransfer: arrastreMismo.transferencia, clientY: rectB.top + 1 };
  destinoB.dispatchEvent(new DragEvent('dragover', antesB));
  destinoB.dispatchEvent(new DragEvent('drop', antesB));
  arrastreMismo.handle.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  await esperar();
  check(JSON.stringify(tarjetasDe(origen.id).map(t => t.id)) ===
    JSON.stringify([ids[0], ids[3], ids[1], ids[2]]), 'Arrastrar dentro de la etapa reordena antes de una tarjeta');

  const estadoAntesExtremos = tarjetasDe(origen.id).map(t => t.id);
  soltar(ids[0], '.kanban-list[data-list-id="' + origen.id + '"] .work-cards');
  await esperar();
  check(JSON.stringify(tarjetasDe(origen.id).map(t => t.id)) ===
    JSON.stringify([ids[3], ids[1], ids[2], ids[0]]), 'Arrastrar la primera tarjeta al final cambia el orden');
  check(estadoAntesExtremos.length === 4, 'La lista conserva sus cuatro tarjetas durante el reordenamiento');

  const segundaListaTablero = await PSA.Trabajo.guardarTablero({
    proyecto_id: proyecto.id, nombre: 'Otro tablero para validar destino'
  });
  const listaAjena = PSA.Trabajo.getListas(segundaListaTablero)[0];
  const listaFalsa = document.createElement('section');
  listaFalsa.className = 'kanban-list';
  listaFalsa.dataset.listId = listaAjena.id;
  listaFalsa.dataset.inactive = 'false';
  listaFalsa.innerHTML = '<div class="work-cards"></div>';
  $('#tablero-columnas').append(listaFalsa);
  const antesIntertablero = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  soltar(ids[2], '.kanban-list[data-list-id="' + listaAjena.id + '"] .work-cards');
  await esperar();
  check($('#tableros-error').textContent.includes('tablero actual') &&
    JSON.stringify(PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion])) ===
    JSON.stringify(antesIntertablero), 'Rechaza una etapa de otro tablero sin modificar datos');
  listaFalsa.remove();

  const antesCancelar = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  const cancelado = iniciar(ids[2]);
  cancelado.handle.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  check(JSON.stringify(PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion])) ===
    JSON.stringify(antesCancelar) && $('#tablero-arrastre-estado').textContent.includes('cancelado'),
  'Cancelar el arrastre no modifica la base y restaura el estado visual');

  for (const id of [ids[1], ids[2]]) {
    const checkbox = Array.from(document.querySelectorAll('.tarjeta-seleccion'))
      .find(elemento => elemento.dataset.id === id);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const arrastreSeleccionada = iniciar(ids[1]);
  check($('#tablero-arrastre-estado').textContent.includes('solo se arrastrará esta tarjeta'),
    'La selección múltiple advierte que el arrastre afectará solo a una tarjeta');
  const cardsDestino = $('.kanban-list[data-list-id="' + destino.id + '"] .work-cards');
  const rectDestino = cardsDestino.getBoundingClientRect();
  const finDestino = { bubbles: true, cancelable: true, dataTransfer: arrastreSeleccionada.transferencia,
    clientY: rectDestino.bottom + 50 };
  cardsDestino.dispatchEvent(new DragEvent('dragover', finDestino));
  cardsDestino.dispatchEvent(new DragEvent('drop', finDestino));
  arrastreSeleccionada.handle.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  await esperar();
  check(tarjetasDe(destino.id).some(t => t.id === ids[1]) && tarjetasDe(origen.id).some(t => t.id === ids[2]),
    'Con varias seleccionadas, el arrastre mueve solo su tarjeta y deja las demás en origen');
  check($('#tablero-seleccion-cantidad').textContent === '1 tarjeta seleccionada',
    'La selección ajena al arrastre permanece seleccionada');

  const file = window.__archivoPruebaTableros;
  const antesFallo = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  file.falloCierre = true;
  soltar(ids[0], '.kanban-list[data-list-id="' + destino.id + '"] .work-cards');
  await esperar();
  check($('#tableros-error').textContent.includes('cerrar') &&
    JSON.stringify(PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion])) ===
    JSON.stringify(antesFallo) &&
    $('.kanban-list[data-list-id="' + origen.id + '"] .work-card[data-card-id="' + ids[0] + '"]'),
  'Un fallo de persistencia no deja movimientos parciales y conserva la tarjeta en pantalla');
  file.falloCierre = false;
  soltar(ids[0], '.kanban-list[data-list-id="' + destino.id + '"] .work-cards');
  await esperar();
  check(tarjetasDe(destino.id).some(t => t.id === ids[0]), 'Reintentar tras el fallo guarda el movimiento');
  const sinDuplicados = PSA.Trabajo.getTarjetas().map(t => t.id);
  check(new Set(sinDuplicados).size === sinDuplicados.length, 'El tablero no contiene tarjetas duplicadas');
  const ordenarD = tarjetasDe(origen.id).find(t => t.id === ids[3]);
  control('tarjeta-posicion-siguiente', ordenarD.id).click();
  await esperar();
  check(JSON.stringify(tarjetasDe(origen.id).map(t => t.id)) === JSON.stringify([ids[2], ids[3]]),
    'El control accesible permite bajar una tarjeta sin arrastrar');
  control('tarjeta-posicion-anterior', ordenarD.id).click();
  await esperar();
  check(JSON.stringify(tarjetasDe(origen.id).map(t => t.id)) === JSON.stringify([ids[3], ids[2]]),
    'El control accesible permite subir la tarjeta de vuelta');
  const posicionesValidas = listas.every(lista => {
    const posiciones = tarjetasDe(lista.id).map(t => t.posicion);
    return new Set(posiciones).size === posiciones.length;
  });
  check(posicionesValidas, 'Las posiciones activas quedan únicas dentro de cada etapa');

  const ubicaciones = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  return {
    resultados, proyectoId: proyecto.id, tableroId, ordenListas: listas.map(l => l.id),
    ubicaciones, archivo: Array.from(file.datos)
  };
};

window.verificarReaperturaArrastre = function (anterior) {
  const actuales = PSA.Trabajo.getTarjetas().map(t => [t.id, t.lista_id, t.posicion]);
  if (JSON.stringify(actuales) !== JSON.stringify(anterior.ubicaciones)) {
    throw new Error('Las posiciones del arrastre no persistieron al reabrir.');
  }
  if (JSON.stringify(PSA.Trabajo.getListas(anterior.tableroId).map(l => l.id)) !==
      JSON.stringify(anterior.ordenListas)) {
    throw new Error('El orden de listas cambió al reabrir el tablero.');
  }
  PSA.Tableros.abrirProyecto(anterior.proyectoId);
  document.querySelector('[data-accion="abrir"][data-id="' + anterior.tableroId + '"]').click();
  return 'Posiciones y orden de tarjetas persistidos al reabrir';
};
