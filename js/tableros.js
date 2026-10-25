'use strict';

(function () {
  const PSA = window.PSA;
  const CATEGORIAS = {
    pendiente: 'Pendiente', en_curso: 'En curso', en_revision: 'En revisión',
    bloqueado: 'Bloqueado', completado: 'Completado'
  };
  let tableroId = null;
  let editor = null;
  let origenFoco = null;
  let formularioInicial = '';
  let tarjetasSeleccionadas = new Set();
  let arrastre = null;
  const $ = id => document.getElementById(id);
  const e = valor => PSA.escapeHtml(valor);
  const dialog = () => $('trabajo-dialog');

  function _boton(texto, accion, id, deshabilitado = false) {
    return `<button type="button" class="btn btn-ghost btn-sm" data-accion="${accion}"
      data-id="${e(id)}"${deshabilitado ? ' disabled' : ''}>${e(texto)}</button>`;
  }

  function _opciones(filas, valor, nombre = 'nombre') {
    return filas.map(fila => `<option value="${e(fila.id)}"${fila.id === valor ? ' selected' : ''}>${e(fila[nombre])}</option>`).join('');
  }

  function _seleccion(id, filas) {
    const anterior = $(id).value;
    $(id).innerHTML = '<option value="">Todos los proyectos</option>' + _opciones(filas, anterior);
    if (!filas.some(p => p.id === anterior)) $(id).value = '';
  }

  function _tablero() {
    return PSA.Trabajo.getTableros().find(t => t.id === tableroId);
  }

  function _textoFiltro(valor) {
    return String(valor || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  }

  function _filtrosTarjetasActivos() {
    return !!_textoFiltro($('filtro-tarjetas-texto').value) ||
      ['responsable', 'etiqueta', 'prioridad', 'lista', 'asignacion']
        .some(nombre => !!$('filtro-tarjetas-' + nombre).value);
  }

  function _filtrosTarjetas() {
    return {
      texto: _textoFiltro($('filtro-tarjetas-texto').value),
      responsable: $('filtro-tarjetas-responsable').value,
      etiqueta: $('filtro-tarjetas-etiqueta').value,
      prioridad: $('filtro-tarjetas-prioridad').value,
      lista: $('filtro-tarjetas-lista').value,
      asignacion: $('filtro-tarjetas-asignacion').value
    };
  }

  function _coincideTarjeta(tarjeta, filtros) {
    const responsables = (tarjeta.responsables || []).map(r => r.id);
    const etiquetas = (tarjeta.etiquetas || []).map(etiqueta => etiqueta.id);
    const texto = _textoFiltro(tarjeta.titulo + ' ' + tarjeta.descripcion);
    return (!filtros.texto || texto.includes(filtros.texto)) &&
      (!filtros.responsable || responsables.includes(filtros.responsable)) &&
      (!filtros.etiqueta || etiquetas.includes(filtros.etiqueta)) &&
      (!filtros.prioridad || tarjeta.prioridad === filtros.prioridad) &&
      (!filtros.lista || tarjeta.lista_id === filtros.lista) &&
      (!filtros.asignacion || (filtros.asignacion === 'con' ? responsables.length > 0 : responsables.length === 0));
  }

  function _actualizarOpcionesFiltro(listas) {
    const poner = (id, filas, todas) => {
      const select = $(id);
      const previo = select.value;
      select.innerHTML = `<option value="">${todas}</option>` + _opciones(filas, previo);
      if (!filas.some(fila => fila.id === previo)) select.value = '';
    };
    poner('filtro-tarjetas-responsable', PSA.Trabajo.getResponsables(), 'Todos');
    poner('filtro-tarjetas-etiqueta', PSA.Trabajo.getEtiquetas(), 'Todas');
    poner('filtro-tarjetas-lista', listas, 'Todas');
  }

  function _renderCatalogos() {
    const consultaResponsable = _textoFiltro($('buscar-responsables').value);
    const consultaEtiqueta = _textoFiltro($('buscar-etiquetas').value);
    const responsables = PSA.Trabajo.getResponsables().filter(fila =>
      ($('ver-responsables-inactivos').checked || !fila.archivado) &&
      _textoFiltro(fila.nombre).includes(consultaResponsable));
    const etiquetas = PSA.Trabajo.getEtiquetas().filter(fila =>
      ($('ver-etiquetas-inactivas').checked || !fila.archivado) &&
      _textoFiltro(fila.nombre).includes(consultaEtiqueta));
    $('catalogo-responsables').innerHTML = responsables.map(fila => `<div class="catalog-item">
      <span>${e(fila.nombre)}${fila.archivado ? ' · Inactivo' : ''}</span>
      <span class="actions">${_boton('Editar', 'responsable', fila.id, PSA.DB.ocupado)}
        ${_boton(fila.archivado ? 'Reactivar' : 'Desactivar', 'archivo-responsable', fila.id, PSA.DB.ocupado)}</span>
      </div>`).join('') || '<p class="empty">No hay responsables para esta búsqueda.</p>';
    $('catalogo-etiquetas').innerHTML = etiquetas.map(fila => {
      const color = /^#[0-9a-f]{6}$/i.test(fila.color) ? ` style="background-color:${e(fila.color)}"` : '';
      return `<div class="catalog-item">
      <span><span class="catalog-color"${color} aria-hidden="true"></span>
        ${e(fila.nombre)}${fila.archivado ? ' · Inactiva' : ''}</span>
      <span class="actions">${_boton('Editar', 'etiqueta', fila.id, PSA.DB.ocupado)}
        ${_boton(fila.archivado ? 'Reactivar' : 'Desactivar', 'archivo-etiqueta', fila.id, PSA.DB.ocupado)}</span>
      </div>`;
    }).join('') || '<p class="empty">No hay etiquetas para esta búsqueda.</p>';
  }

  function _bloqueado(tablero) {
    const proyecto = PSA.DB.getProyectos().find(p => p.id === tablero.proyecto_id);
    return !!tablero.archivado || !proyecto || !!proyecto.archivado;
  }

  function _hoy() {
    const fecha = new Date();
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  }

  function _tarjetaHTML(tarjeta, bloqueada, listas, tarjetasActivas) {
    const vencida = !tarjeta.completada && tarjeta.vencimiento && tarjeta.vencimiento < _hoy() && !bloqueada;
    const prioridad = ['Alta', 'Urgente'].includes(tarjeta.prioridad) ? ' work-priority-high' : '';
    const seleccionada = tarjetasSeleccionadas.has(tarjeta.id);
    const posicion = tarjetasActivas.findIndex(fila => fila.id === tarjeta.id);
    const noMovible = bloqueada || tarjeta.archivada || PSA.DB.ocupado;
    const arrastreDeshabilitado = _filtrosTarjetasActivos();
    const prioridadNombre = tarjeta.prioridad === 'Urgente' ? 'Crítica' : tarjeta.prioridad;
    const etiquetas = tarjeta.etiquetas || [];
    const responsables = tarjeta.responsables || [];
    const etiquetasHTML = etiquetas.map(etiqueta => {
      const valido = /^#[0-9a-f]{6}$/i.test(etiqueta.color);
      const color = valido ? parseInt(etiqueta.color.slice(1), 16) : 0xffffff;
      const luminancia = 0.299 * (color >> 16 & 255) + 0.587 * (color >> 8 & 255) + 0.114 * (color & 255);
      const estilo = valido ? ` style="background-color:${e(etiqueta.color)};color:${luminancia < 145 ? '#fff' : '#111'}"` : '';
      return `<span class="work-badge${etiqueta.archivado ? ' work-badge-inactive' : ''}"${estilo}>${e(etiqueta.nombre)}${etiqueta.archivado ? ' · Inactiva' : ''}</span>`;
    }).join('');
    const responsablesHTML = responsables.map(responsable =>
      `<span class="work-badge${responsable.archivado ? ' work-badge-inactive' : ''}">${e(responsable.nombre)}${responsable.archivado ? ' · Inactivo' : ''}</span>`
    ).join('');
    return `<article class="work-card${prioridad}${tarjeta.completada ? ' work-complete' : ''}${seleccionada ? ' work-selected' : ''}"
      data-card-id="${e(tarjeta.id)}" data-archived="${tarjeta.archivada ? 'true' : 'false'}">
      ${noMovible || arrastreDeshabilitado ? '' : `<span class="work-drag-handle" draggable="true" title="Arrastre desde este control para mover solo esta tarjeta"
        aria-label="Arrastrar ${e(tarjeta.titulo)}">↕ Arrastrar</span>`}
      <label class="work-select"><input class="tarjeta-seleccion" type="checkbox" data-id="${e(tarjeta.id)}"
        aria-label="Seleccionar ${e(tarjeta.titulo)}"${seleccionada ? ' checked' : ''}${bloqueada || tarjeta.archivada ? ' disabled' : ''}>
        <span>${seleccionada ? 'Seleccionada' : 'Seleccionar tarjeta'}</span></label>
      <h4>${_boton(tarjeta.titulo, 'tarjeta', tarjeta.id)}</h4>
      <div class="work-badges"><span class="work-badge work-badge-priority">Prioridad: ${e(prioridadNombre)}</span>${etiquetasHTML}</div>
      <div class="work-badges">${responsablesHTML || '<span class="work-badge">Sin responsables</span>'}</div>
      <p class="work-meta">${tarjeta.completada ? 'Completada' : ''}${tarjeta.archivada ? ' · Archivada' : ''}</p>
      <p class="${vencida ? 'work-overdue' : 'work-meta'}">${vencida ? 'Vencida · ' : 'Vencimiento: '}${e(PSA.formatFecha(tarjeta.vencimiento))}</p>
      <div class="actions no-print work-card-move">
        ${_boton('Subir en la etapa', 'tarjeta-posicion-anterior', tarjeta.id,
          noMovible || arrastreDeshabilitado || posicion <= 0)}
        ${_boton('Bajar en la etapa', 'tarjeta-posicion-siguiente', tarjeta.id,
          noMovible || arrastreDeshabilitado || posicion < 0 || posicion === tarjetasActivas.length - 1)}
        ${_boton('Etapa anterior', 'tarjeta-anterior', tarjeta.id, bloqueada || tarjeta.archivada || PSA.DB.ocupado)}
        ${_boton('Etapa siguiente', 'tarjeta-siguiente', tarjeta.id,
          bloqueada || tarjeta.archivada || PSA.DB.ocupado)}
        <label class="work-destination">Destino específico
          <select class="tarjeta-destino" data-id="${e(tarjeta.id)}" aria-label="Destino de ${e(tarjeta.titulo)}"
            ${bloqueada || tarjeta.archivada || PSA.DB.ocupado ? ' disabled' : ''}>
            <option value="">Seleccione etapa</option>${_opciones(listas, '', 'nombre')}
          </select>
        </label>
        ${_boton('Mover tarjeta', 'mover-tarjeta', tarjeta.id, bloqueada || tarjeta.archivada || PSA.DB.ocupado)}
        ${_boton(tarjeta.archivada ? 'Restaurar tarjeta' : 'Archivar tarjeta',
          'archivo-tarjeta', tarjeta.id, bloqueada || PSA.DB.ocupado)}
      </div>
    </article>`;
  }

  function _renderDetalle() {
    const tablero = _tablero();
    $('tablero-detalle').classList.toggle('hidden', !tablero);
    if (!tablero) {
      tableroId = null;
      tarjetasSeleccionadas.clear();
      $('tablero-seleccion-movimiento').classList.add('hidden');
      $('tablero-columnas').replaceChildren();
      return;
    }
    const proyecto = PSA.DB.getProyectos().find(p => p.id === tablero.proyecto_id);
    const bloqueado = _bloqueado(tablero);
    $('tablero-proyecto').textContent = 'Proyecto: ' + (proyecto ? proyecto.nombre : 'No disponible');
    $('tablero-titulo').textContent = tablero.nombre;
    $('tablero-descripcion').textContent = tablero.descripcion;
    $('tablero-fechas').textContent = 'Creado: ' + new Date(tablero.created_at).toLocaleString('es-AR') +
      ' · Modificado: ' + new Date(tablero.updated_at).toLocaleString('es-AR');
    $('tablero-aviso').textContent = bloqueado
      ? 'Este tablero o su proyecto está archivado. Puede consultar sus datos; restaure el contenedor para modificarlo.'
      : 'El orden de listas y el movimiento de tarjetas son acciones distintas. Puede mover tarjetas individuales o seleccionar varias.';
    document.querySelectorAll('[data-accion="editar-tablero-actual"], [data-accion="nueva-lista"]')
      .forEach(b => { b.disabled = bloqueado || PSA.DB.ocupado; });
    const todas = PSA.Trabajo.getListas(tablero.id);
    const activas = todas.filter(l => !l.archivado);
    const mostrarArchivadas = $('tablero-ver-archivados').checked;
    const listas = todas.filter(l => mostrarArchivadas || !l.archivado);
    const tarjetas = PSA.Trabajo.getTarjetas().filter(t => t.tablero_id === tablero.id);
    _actualizarOpcionesFiltro(activas);
    const filtros = _filtrosTarjetas();
    const tarjetasBase = tarjetas.filter(t => !t.archivada && !t.lista_archivada &&
      !t.tablero_archivado && !t.proyecto_archivado);
    const coincidencias = tarjetasBase.filter(t => _coincideTarjeta(t, filtros));
    const idsVisibles = new Set(coincidencias.map(t => t.id));
    const filtrosActivos = _filtrosTarjetasActivos();
    const idsActivos = new Set(tarjetas.filter(t => !t.archivada && !t.lista_archivada &&
      !t.tablero_archivado && !t.proyecto_archivado).map(t => t.id));
    tarjetasSeleccionadas = new Set(Array.from(tarjetasSeleccionadas).filter(id => idsActivos.has(id)));
    const seleccionadas = tarjetasSeleccionadas.size;
    const seleccionadasOcultas = Array.from(tarjetasSeleccionadas).filter(id => !idsVisibles.has(id)).length;
    $('tablero-seleccion-cantidad').textContent = seleccionadas + (seleccionadas === 1 ? ' tarjeta seleccionada' : ' tarjetas seleccionadas');
    $('tablero-seleccion-ayuda').textContent = seleccionadasOcultas
      ? seleccionadasOcultas + ' seleccionada(s) están ocultas por los filtros. Confirme explícitamente si quiere incluirlas en el movimiento.'
      : seleccionadas
        ? 'Las acciones afectan únicamente a las tarjetas seleccionadas visibles.'
      : 'Seleccione tarjetas con sus casillas o con «Seleccionar etapa».';
    $('tablero-incluir-seleccion-oculta').disabled = seleccionadasOcultas === 0;
    $('tablero-resultados').textContent = coincidencias.length + ' de ' + tarjetasBase.length + ' tarjetas coinciden.';
    $('tablero-filtros-estado').textContent = filtrosActivos
      ? 'Hay filtros activos. El arrastre y el reordenamiento por posición están deshabilitados para proteger las tarjetas ocultas.'
      : '';
    if (!coincidencias.length) {
      $('tablero-filtros-estado').textContent += (filtrosActivos ? ' ' : '') +
        'No hay tarjetas que coincidan. Pruebe otros criterios o limpie los filtros.';
    }
    const destinoSeleccionado = $('tablero-seleccion-destino').value;
    $('tablero-seleccion-destino').innerHTML = '<option value="">Seleccione etapa de destino</option>' +
      _opciones(activas, destinoSeleccionado, 'nombre');
    if (!activas.some(lista => lista.id === destinoSeleccionado)) $('tablero-seleccion-destino').value = '';
    $('tablero-seleccion-movimiento').classList.toggle('hidden', bloqueado);
    $('tablero-columnas').innerHTML = listas.length ? listas.map(lista => {
      const indice = activas.findIndex(l => l.id === lista.id);
      const inactiva = bloqueado || !!lista.archivado;
      const contenidoCompleto = tarjetas.filter(t => t.lista_id === lista.id && (mostrarArchivadas || !t.archivada));
      const contenido = contenidoCompleto.filter(t => _coincideTarjeta(t, filtros));
      const movibles = contenido.filter(t => !t.archivada && !inactiva);
      const tarjetasActivas = contenidoCompleto.filter(t => !t.archivada);
      return `<section class="kanban-list${lista.categoria === 'bloqueado' ? ' work-blocked' : ''}"
        data-list-id="${e(lista.id)}" data-inactive="${inactiva ? 'true' : 'false'}" aria-label="${e(lista.nombre)}">
        <h3>${e(lista.nombre)}${lista.archivado ? ' · Archivada' : ''}</h3>
        <p class="work-meta">${e(CATEGORIAS[lista.categoria])} · ${contenido.length} visible(s)</p>
        <div class="actions no-print">
          ${_boton('Editar lista', 'lista', lista.id, inactiva || PSA.DB.ocupado)}
          ${_boton('Ordenar lista antes', 'lista-anterior', lista.id, inactiva || indice <= 0 || PSA.DB.ocupado)}
          ${_boton('Ordenar lista después', 'lista-siguiente', lista.id, inactiva || indice === activas.length - 1 || PSA.DB.ocupado)}
          ${_boton(lista.archivado ? 'Restaurar lista' : 'Archivar lista', 'archivo-lista', lista.id, bloqueado || PSA.DB.ocupado)}
          ${_boton('Seleccionar todas en esta etapa (' + movibles.length + ')', 'seleccionar-etapa', lista.id,
            inactiva || !movibles.length || PSA.DB.ocupado)}
        </div>
        <div class="work-cards">${contenido.map(t => _tarjetaHTML(t, inactiva, activas, tarjetasActivas)).join('') ||
          `<p class="empty">${filtrosActivos ? 'Ninguna tarjeta coincide en esta etapa.' : 'Sin tarjetas visibles en esta lista.'}</p>`}</div>
        <div class="actions no-print">${_boton('Crear tarjeta', 'nueva-tarjeta', lista.id, inactiva || PSA.DB.ocupado)}</div>
      </section>`;
    }).join('') : '<p class="empty">No hay listas visibles. Cree la primera lista o active «Incluir listas y tarjetas archivadas» para restaurarlas.</p>';
    const resumenFiltros = [];
    if (filtros.texto) resumenFiltros.push('Búsqueda: «' + $('filtro-tarjetas-texto').value.trim() + '»');
    if (filtros.responsable) {
      const responsable = PSA.Trabajo.getResponsables().find(fila => fila.id === filtros.responsable);
      if (responsable) resumenFiltros.push('Responsable: ' + responsable.nombre);
    }
    if (filtros.etiqueta) {
      const etiqueta = PSA.Trabajo.getEtiquetas().find(fila => fila.id === filtros.etiqueta);
      if (etiqueta) resumenFiltros.push('Etiqueta: ' + etiqueta.nombre);
    }
    if (filtros.prioridad) resumenFiltros.push('Prioridad: ' +
      (filtros.prioridad === 'Urgente' ? 'Crítica' : filtros.prioridad));
    if (filtros.lista) {
      const lista = todas.find(fila => fila.id === filtros.lista);
      if (lista) resumenFiltros.push('Etapa: ' + lista.nombre);
    }
    if (filtros.asignacion) resumenFiltros.push('Asignación: ' +
      (filtros.asignacion === 'con' ? 'con responsables' : 'sin responsables'));
    if (filtrosActivos) {
      $('tablero-filtros-estado').textContent = 'Filtros activos: ' + resumenFiltros.join(' · ') +
        '. Arrastre y reordenamiento por posición deshabilitados para proteger las tarjetas ocultas.';
      if (!coincidencias.length) $('tablero-filtros-estado').textContent +=
        ' No hay tarjetas que coincidan; pruebe otros criterios o limpie los filtros.';
    }
  }

  function _focoAccion(accion, id) {
    const control = Array.from($('tablero-columnas').querySelectorAll('[data-accion]'))
      .find(b => b.dataset.accion === accion && b.dataset.id === id);
    if (control) control.focus();
    else $('tablero-seleccion-cantidad').focus();
  }

  function _tarjetasSeleccionadas() {
    if (!tarjetasSeleccionadas.size) throw new Error('Seleccione al menos una tarjeta para mover.');
    const filas = PSA.Trabajo.getTarjetas();
    const listas = PSA.Trabajo.getListas(tableroId).filter(lista => !lista.archivado);
    const seleccion = Array.from(tarjetasSeleccionadas, id => {
      const fila = filas.find(t => t.id === id);
      if (!fila || fila.tablero_id !== tableroId || fila.archivada ||
          fila.lista_archivada || fila.tablero_archivado || fila.proyecto_archivado) {
        throw new Error('La selección contiene una tarjeta archivada o fuera del tablero actual.');
      }
      return fila;
    }).sort((a, b) => listas.findIndex(lista => lista.id === a.lista_id) -
      listas.findIndex(lista => lista.id === b.lista_id) || a.posicion - b.posicion || a.id.localeCompare(b.id));
    const filtros = _filtrosTarjetas();
    const ocultas = seleccion.filter(tarjeta => !_coincideTarjeta(tarjeta, filtros));
    if (ocultas.length && !$('tablero-incluir-seleccion-oculta').checked) {
      throw new Error('Hay ' + ocultas.length + ' tarjeta(s) seleccionada(s) ocultas por los filtros. Limpie los filtros o confirme «Incluir también las tarjetas seleccionadas que los filtros ocultan» antes de mover.');
    }
    return seleccion;
  }

  function _destinoRelativo(tarjeta, direccion, listas) {
    const indice = listas.findIndex(lista => lista.id === tarjeta.lista_id);
    const destino = indice + direccion;
    if (indice < 0 || destino < 0 || destino >= listas.length) {
      throw new Error('No existe una etapa ' + (direccion < 0 ? 'anterior' : 'siguiente') + ' para «' + tarjeta.titulo + '».');
    }
    return listas[destino].id;
  }

  async function _moverTarjeta(id, accion, boton) {
    const tarjeta = PSA.Trabajo.getTarjetas().find(t => t.id === id && t.tablero_id === tableroId);
    if (!tarjeta || tarjeta.archivada || tarjeta.lista_archivada || tarjeta.tablero_archivado ||
        tarjeta.proyecto_archivado) throw new Error('La tarjeta no está disponible para mover.');
    const listas = PSA.Trabajo.getListas(tableroId).filter(lista => !lista.archivado);
    const indice = listas.findIndex(lista => lista.id === tarjeta.lista_id);
    let destinoId;
    let posicion;
    if (accion === 'mover-tarjeta') {
      destinoId = boton.closest('.work-card').querySelector('.tarjeta-destino').value;
      if (!destinoId) throw new Error('Seleccione una etapa de destino.');
      if (!listas.some(lista => lista.id === destinoId)) throw new Error('El destino no es una etapa activa de este tablero.');
      posicion = PSA.Trabajo.getTarjetas().filter(t =>
        t.lista_id === destinoId && !t.archivada && t.id !== tarjeta.id).length;
    } else if (accion === 'tarjeta-posicion-anterior' || accion === 'tarjeta-posicion-siguiente') {
      const tarjetas = PSA.Trabajo.getTarjetas().filter(t =>
        t.lista_id === tarjeta.lista_id && !t.archivada).sort((a, b) => a.posicion - b.posicion || a.id.localeCompare(b.id));
      const posicionActual = tarjetas.findIndex(t => t.id === tarjeta.id);
      const direccion = accion === 'tarjeta-posicion-anterior' ? -1 : 1;
      posicion = posicionActual + direccion;
      if (posicionActual < 0 || posicion < 0 || posicion >= tarjetas.length) {
        throw new Error('No existe una posición ' + (direccion < 0 ? 'anterior' : 'siguiente') + ' para esta tarjeta.');
      }
      destinoId = tarjeta.lista_id;
    } else {
      destinoId = _destinoRelativo(tarjeta, accion === 'tarjeta-anterior' ? -1 : 1, listas);
      posicion = PSA.Trabajo.getTarjetas().filter(t =>
        t.lista_id === destinoId && !t.archivada && t.id !== tarjeta.id).length;
    }
    await _guardarMovimientoTarjeta(id, destinoId, posicion);
  }

  async function _guardarMovimientoTarjeta(id, destinoId, posicion) {
    const tarjeta = PSA.Trabajo.getTarjetas().find(fila => fila.id === id);
    const listas = PSA.Trabajo.getListas(tableroId).filter(lista => !lista.archivado);
    await PSA.Trabajo.moverTarjeta(id, destinoId, posicion);
    tarjetasSeleccionadas.delete(id);
    render();
    _focoAccion('tarjeta', id);
    PSA.toast(tarjeta && tarjeta.lista_id === destinoId
      ? 'Se guardó la nueva posición de la tarjeta.'
      : 'La tarjeta se movió a «' + listas.find(lista => lista.id === destinoId).nombre + '».');
  }

  function _limpiarIndicadoresArrastre() {
    $('tablero-columnas').querySelectorAll('.drop-valid, .drop-target, .drop-invalid, .drop-before, .drop-after, .drop-end, .work-dragging')
      .forEach(elemento => elemento.classList.remove(
        'drop-valid', 'drop-target', 'drop-invalid', 'drop-before', 'drop-after', 'drop-end', 'work-dragging'));
  }

  function _iniciarArrastre(event) {
    const controlador = event.target.closest('.work-drag-handle');
    if (!controlador) return;
    if (_filtrosTarjetasActivos()) {
      event.preventDefault();
      $('tablero-arrastre-estado').textContent =
        'Desactive todos los filtros antes de arrastrar o reordenar: las tarjetas ocultas deben conservar su posición.';
      return;
    }
    const tarjeta = controlador.closest('.work-card');
    const fila = tarjeta && PSA.Trabajo.getTarjetas().find(t =>
      t.id === tarjeta.dataset.cardId && t.tablero_id === tableroId);
    if (!fila || fila.archivada || fila.lista_archivada || fila.tablero_archivado ||
        fila.proyecto_archivado || PSA.DB.ocupado || !_tablero() || _bloqueado(_tablero())) {
      event.preventDefault();
      return;
    }
    if (!event.dataTransfer) {
      event.preventDefault();
      $('tablero-arrastre-estado').textContent = 'El navegador no permite iniciar el arrastre.';
      return;
    }
    const listas = PSA.Trabajo.getListas(tableroId);
    arrastre = {
      id: fila.id,
      titulo: fila.titulo,
      tableroId,
      seleccionAviso: tarjetasSeleccionadas.size > 1 && tarjetasSeleccionadas.has(fila.id)
        ? ' Hay ' + tarjetasSeleccionadas.size + ' tarjetas seleccionadas, pero solo se arrastrará esta tarjeta; use la barra para mover el conjunto.'
        : ' Solo se moverá esta tarjeta.',
      posicion: Array.from(tarjeta.parentElement.querySelectorAll('.work-card[data-archived="false"]'))
        .findIndex(elemento => elemento.dataset.cardId === fila.id),
      destinos: new Map(listas.map(lista => [lista.id, lista])),
      soltada: false,
      guardando: false
    };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fila.id);
    tarjeta.classList.add('work-dragging');
    $('tablero-columnas').querySelectorAll('.kanban-list[data-inactive="false"]')
      .forEach(lista => lista.classList.add('drop-valid'));
    $('tableros-error').textContent = '';
    $('tablero-arrastre-estado').textContent = 'Arrastrando «' + fila.titulo + '».' + arrastre.seleccionAviso;
  }

  function _calcularDestinoArrastre(event, lista, estado) {
    if (!lista || lista.dataset.inactive !== 'false' || lista.dataset.listId == null ||
        !estado.destinos.has(lista.dataset.listId) || estado.destinos.get(lista.dataset.listId).archivado) {
      return { valido: false, mensaje: 'El destino no pertenece a una etapa activa del tablero actual.' };
    }
    const tarjetas = Array.from(lista.querySelectorAll('.work-card[data-archived="false"]'))
      .filter(elemento => elemento.dataset.cardId !== estado.id);
    const tarjetaDestino = event.target.closest('.work-card');
    if (tarjetaDestino && tarjetaDestino.dataset.archived !== 'false') {
      return { valido: false, mensaje: 'No se puede insertar una tarjeta sobre una tarjeta archivada.' };
    }
    if (tarjetaDestino && tarjetaDestino.dataset.cardId === estado.id) {
      return { valido: true, destinoId: lista.dataset.listId, posicion: estado.posicion };
    }
    if (!tarjetaDestino) {
      return { valido: true, destinoId: lista.dataset.listId, posicion: tarjetas.length };
    }
    const indice = tarjetas.indexOf(tarjetaDestino);
    if (indice < 0) return { valido: false, mensaje: 'La posición de inserción ya no está disponible.' };
    const rectangulo = tarjetaDestino.getBoundingClientRect();
    const despues = event.clientY >= rectangulo.top + rectangulo.height / 2;
    return { valido: true, destinoId: lista.dataset.listId, posicion: indice + Number(despues), tarjetaDestino, despues };
  }

  function _actualizarDestinoArrastre(event) {
    if (!arrastre) return;
    const lista = event.target.closest('.kanban-list');
    if (!lista || !$('tablero-columnas').contains(lista)) return;
    const destino = _calcularDestinoArrastre(event, lista, arrastre);
    event.preventDefault();
    _limpiarIndicadoresArrastre();
    $('tablero-columnas').querySelectorAll('.kanban-list[data-inactive="false"]')
      .forEach(elemento => elemento.classList.add('drop-valid'));
    const arrastrada = Array.from($('tablero-columnas').querySelectorAll('.work-card'))
      .find(elemento => elemento.dataset.cardId === arrastre.id);
    if (arrastrada) arrastrada.classList.add('work-dragging');
    if (!destino.valido) {
      lista.classList.add('drop-invalid');
      $('tablero-arrastre-estado').textContent = destino.mensaje;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    lista.classList.add('drop-valid', 'drop-target');
    if (destino.tarjetaDestino) {
      destino.tarjetaDestino.classList.add(destino.despues ? 'drop-after' : 'drop-before');
    } else {
      lista.querySelector('.work-cards').classList.add('drop-end');
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    $('tablero-arrastre-estado').textContent = 'Soltar «' + arrastre.titulo + '» en «' +
      arrastre.destinos.get(destino.destinoId).nombre +
      '», posición ' + (destino.posicion + 1) + '.' + arrastre.seleccionAviso;
  }

  async function _confirmarArrastre(event) {
    if (!arrastre || arrastre.guardando) return;
    const estado = arrastre;
    estado.guardando = true;
    estado.soltada = true;
    event.preventDefault();
    const lista = event.target.closest('.kanban-list');
    const destino = _calcularDestinoArrastre(event, lista, estado);
    try {
      if (PSA.DB.ocupado) throw new Error('La base de datos está ocupada; vuelva a intentar el movimiento.');
      if (estado.tableroId !== tableroId || !_tablero() || _bloqueado(_tablero())) {
        throw new Error('El tablero ya no está disponible para mover tarjetas.');
      }
      if (!destino.valido) throw new Error(destino.mensaje);
      const listas = PSA.Trabajo.getListas(tableroId);
      const listaDestino = listas.find(fila => fila.id === destino.destinoId);
      const tarjeta = PSA.Trabajo.getTarjetas().find(fila => fila.id === estado.id);
      if (!listaDestino || listaDestino.archivado || listaDestino.tablero_id !== estado.tableroId ||
          !tarjeta || tarjeta.archivada || tarjeta.lista_archivada || tarjeta.tablero_archivado ||
          tarjeta.proyecto_archivado || tarjeta.tablero_id !== estado.tableroId) {
        throw new Error('La tarjeta o la etapa de destino ya no están disponibles.');
      }
      const tarjetasDestino = PSA.Trabajo.getTarjetas().filter(fila =>
        fila.lista_id === destino.destinoId && !fila.archivada && fila.id !== estado.id);
      if (!Number.isInteger(destino.posicion) || destino.posicion < 0 || destino.posicion > tarjetasDestino.length) {
        throw new Error('La posición de destino ya no es válida.');
      }
      const origen = PSA.Trabajo.getTarjetas().filter(fila =>
        fila.lista_id === tarjeta.lista_id && !fila.archivada).sort((a, b) => a.posicion - b.posicion || a.id.localeCompare(b.id));
      const posicionActual = origen.findIndex(fila => fila.id === tarjeta.id);
      if (tarjeta.lista_id === destino.destinoId && destino.posicion === posicionActual) {
        $('tablero-arrastre-estado').textContent = 'La tarjeta ya ocupa esa posición. No se modificaron los datos.';
        return;
      }
      $('tablero-arrastre-estado').textContent = 'Guardando la posición de «' + tarjeta.titulo + '»…';
      await _guardarMovimientoTarjeta(tarjeta.id, destino.destinoId, destino.posicion);
      $('tablero-arrastre-estado').textContent = 'Se guardó la nueva posición de «' + tarjeta.titulo + '».';
    } catch (error) {
      console.error('[PSA.Tableros] Error al arrastrar tarjeta:', error);
      $('tableros-error').textContent = 'No se movió la tarjeta: ' + error.message;
      $('tablero-arrastre-estado').textContent = 'No se completó el arrastre. El tablero conserva el orden anterior.';
      PSA.toast('No se movió la tarjeta: ' + error.message, 'error');
    } finally {
      _limpiarIndicadoresArrastre();
      if (arrastre === estado) arrastre = null;
    }
  }

  function _finalizarArrastre() {
    if (!arrastre) return;
    const estado = arrastre;
    _limpiarIndicadoresArrastre();
    if (!estado.soltada) $('tablero-arrastre-estado').textContent = 'Arrastre cancelado; no se modificaron los datos.';
    arrastre = null;
  }

  async function _moverSeleccion(accion) {
    const tarjetas = _tarjetasSeleccionadas();
    const listas = PSA.Trabajo.getListas(tableroId).filter(lista => !lista.archivado);
    let movimientos;
    if (accion === 'mover-seleccion-destino') {
      const destinoId = $('tablero-seleccion-destino').value;
      if (!destinoId) throw new Error('Seleccione una etapa de destino para las tarjetas.');
      if (!listas.some(lista => lista.id === destinoId)) throw new Error('El destino no es una etapa activa de este tablero.');
      movimientos = tarjetas.map(tarjeta => ({ id: tarjeta.id, destinoId }));
    } else {
      const direccion = accion === 'mover-seleccion-anterior' ? -1 : 1;
      movimientos = tarjetas.map(tarjeta => ({
        id: tarjeta.id, destinoId: _destinoRelativo(tarjeta, direccion, listas)
      }));
    }
    await PSA.Trabajo.moverTarjetas(movimientos);
    const cantidad = movimientos.length;
    tarjetasSeleccionadas.clear();
    render();
    $('tablero-seleccion-cantidad').focus();
    PSA.toast('Se movieron ' + cantidad + (cantidad === 1 ? ' tarjeta seleccionada.' : ' tarjetas seleccionadas.'));
  }

  function render() {
    try {
      _renderCatalogos();
      const proyectos = PSA.DB.getProyectos();
      _seleccion('tableros-proyecto', proyectos);
      const filtro = $('tableros-proyecto').value;
      const incluirArchivados = $('tableros-archivados').checked;
      const tableros = PSA.Trabajo.getTableros().filter(t =>
        (!filtro || t.proyecto_id === filtro) && (incluirArchivados || !_bloqueado(t)));
      $('tableros-catalogo').innerHTML = tableros.map(t => {
        const proyecto = proyectos.find(p => p.id === t.proyecto_id);
        const bloqueado = _bloqueado(t);
        return `<article class="board-preview">
          <h3>${e(t.nombre)}${t.archivado ? ' · Archivado' : ''}</h3>
          <p>Proyecto: ${e(proyecto ? proyecto.nombre : 'No disponible')}</p>
          <p class="preserve-text">${e(t.descripcion)}</p>
          <div class="actions">
            ${_boton('Abrir tablero', 'abrir', t.id, PSA.DB.ocupado)}
            ${_boton('Editar tablero', 'tablero', t.id, bloqueado || PSA.DB.ocupado)}
            ${_boton(t.archivado ? 'Restaurar tablero' : 'Archivar tablero', 'archivo-tablero', t.id,
              !proyecto || !!proyecto.archivado || PSA.DB.ocupado)}
          </div></article>`;
      }).join('') || '<p class="empty">No hay tableros para esta selección. Cree uno asociado a un proyecto activo o incluya los archivados.</p>';
      document.querySelector('[data-accion="nuevo-tablero"]').disabled = !proyectos.some(p => !p.archivado) || PSA.DB.ocupado;
      if (!proyectos.length) $('tableros-catalogo').innerHTML = '<p class="empty">Primero cree un proyecto en la sección Proyectos. Luego podrá asociarle un tablero.</p>';
      $('tableros-error').textContent = '';
      _renderDetalle();
    } catch (error) {
      console.error('[PSA.Tableros] Error al consultar:', error);
      $('tableros-error').textContent = 'No se pudieron consultar los tableros: ' + error.message;
    }
  }

  function abrirProyecto(id) {
    if (PSA.DB.ocupado) return;
    if (!PSA.DB.getProyectos().some(p => p.id === id)) { PSA.toast('El proyecto ya no existe.', 'error'); return; }
    render();
    $('tableros-proyecto').value = id;
    tarjetasSeleccionadas.clear();
    tableroId = null;
    render();
    PSA.cambiarTab('v-tableros', 'v-tableros');
    $('tableros-proyecto').focus();
  }

  function _instantanea() {
    return JSON.stringify(Array.from(new FormData($('trabajo-form')).entries()));
  }

  function cerrar(forzar = false) {
    if (PSA.DB.ocupado && !forzar) return;
    if (!forzar && formularioInicial !== _instantanea() && !confirm('¿Descartar los cambios sin guardar?')) return;
    dialog().close();
    editor = null;
    if (origenFoco && origenFoco.isConnected) origenFoco.focus();
    else if (!$('tablero-detalle').classList.contains('hidden')) $('tablero-titulo').focus();
    else document.querySelector('[data-accion="nuevo-tablero"]').focus();
  }

  function _campo(nombre, etiqueta, valor = '', atributos = '', tipo = 'text') {
    return `<label class="${tipo === 'textarea' ? 'full' : ''}">${etiqueta}${tipo === 'textarea'
      ? `<textarea name="${nombre}" maxlength="10000" rows="3" ${atributos}>${e(valor)}</textarea>`
      : `<input name="${nombre}" type="${tipo}" value="${e(valor)}" ${atributos}>`}</label>`;
  }

  function editar(tipo, id, padreId) {
    if (PSA.DB.ocupado || dialog().open) return;
    try {
      const tablero = _tablero();
      let fila;
      let campos;
      let contexto;
      let soloLectura = false;
      if (tipo === 'tablero') {
        fila = id ? PSA.Trabajo.getTableros().find(t => t.id === id) : {};
        if (!fila) throw new Error('El tablero ya no existe.');
        const proyectos = PSA.DB.getProyectos().filter(p => !p.archivado || p.id === fila.proyecto_id);
        if (!proyectos.some(p => !p.archivado)) throw new Error('Primero cree o restaure un proyecto.');
        soloLectura = !!id && _bloqueado(fila);
        const proyectoId = fila.proyecto_id || $('tableros-proyecto').value;
        campos = `<label>Proyecto<select name="proyecto_id" required${id ? ' disabled' : ''}>
          <option value="">Seleccione un proyecto</option>${_opciones(proyectos, proyectoId)}</select></label>` +
          _campo('nombre', 'Nombre', fila.nombre, 'required maxlength="200"') +
          _campo('descripcion', 'Descripción', fila.descripcion, '', 'textarea');
        contexto = 'El tablero se asociará a un proyecto real. Su proyecto no puede cambiarse al editar.';
      } else if (tipo === 'lista') {
        if (!tablero) throw new Error('Abra primero un tablero.');
        fila = id ? PSA.Trabajo.getListas(tablero.id).find(l => l.id === id) : { tablero_id: tablero.id };
        if (!fila) throw new Error('La lista ya no existe.');
        soloLectura = _bloqueado(tablero) || !!fila.archivado;
        const tieneTarjetas = !!id && PSA.Trabajo.getTarjetas().some(t => t.lista_id === id);
        campos = _campo('nombre', 'Nombre', fila.nombre, 'required maxlength="120"') +
          `<label>Categoría funcional<select name="categoria"${tieneTarjetas ? ' disabled' : ''}>${Object.entries(CATEGORIAS)
            .map(([valor, nombre]) => `<option value="${valor}"${valor === fila.categoria ? ' selected' : ''}>${nombre}</option>`).join('')}</select></label>`;
        contexto = 'Tablero: ' + tablero.nombre + '. El nombre es libre; la categoría no cambia al renombrar.' +
          (tieneTarjetas ? ' La categoría no se modifica mientras existan tarjetas.' : '');
      } else if (tipo === 'responsable') {
        fila = id ? PSA.Trabajo.getResponsables().find(r => r.id === id) : {};
        if (!fila) throw new Error('El responsable ya no existe.');
        campos = _campo('nombre', 'Nombre', fila.nombre, 'required maxlength="120"');
        contexto = 'Responsable local; desactivarlo conserva las asignaciones históricas.';
      } else if (tipo === 'etiqueta') {
        fila = id ? PSA.Trabajo.getEtiquetas().find(etiqueta => etiqueta.id === id) : {};
        if (!fila) throw new Error('La etiqueta ya no existe.');
        campos = _campo('nombre', 'Nombre', fila.nombre, 'required maxlength="60"') +
          _campo('color', 'Color', fila.color || '#476581', 'required pattern="#[0-9a-fA-F]{6}" title="Formato hexadecimal #RRGGBB"', 'color');
        contexto = 'Las etiquetas inactivas se conservan en sus tarjetas y pueden reactivarse.';
      } else {
        if (!tablero) throw new Error('Abra primero un tablero.');
        fila = id ? PSA.Trabajo.getTarjetas().find(t => t.id === id && t.tablero_id === tablero.id) : { lista_id: padreId };
        if (!fila) throw new Error('La tarjeta ya no existe.');
        const lista = PSA.Trabajo.getListas(tablero.id).find(l => l.id === fila.lista_id);
        if (!lista) throw new Error('La lista ya no existe.');
        soloLectura = _bloqueado(tablero) || !!lista.archivado || !!fila.archivada;
        const asignados = (fila.responsables || []).map(r => r.id);
        const responsables = PSA.Trabajo.getResponsables().filter(r => !r.archivado || asignados.includes(r.id));
        const etiquetasAsignadas = (fila.etiquetas || []).map(etiqueta => etiqueta.id);
        const etiquetas = PSA.Trabajo.getEtiquetas().filter(etiqueta =>
          !etiqueta.archivado || etiquetasAsignadas.includes(etiqueta.id));
        campos = _campo('titulo', 'Título', fila.titulo, 'required maxlength="200"') +
          _campo('descripcion', 'Descripción', fila.descripcion, '', 'textarea') +
          `<label class="full">Responsables<select name="responsables" multiple size="4" aria-describedby="asignaciones-ayuda">
            ${responsables.map(r => `<option value="${e(r.id)}"${asignados.includes(r.id) ? ' selected' : ''}>${e(r.nombre)}${r.archivado ? ' · Inactivo (asignado)' : ''}</option>`).join('')}
          </select></label><input type="hidden" name="responsable_id" value="${e(asignados[0] || '')}">
          <label class="full">Etiquetas<select name="etiquetas" multiple size="4" aria-describedby="asignaciones-ayuda">
            ${etiquetas.map(etiqueta => `<option value="${e(etiqueta.id)}"${etiquetasAsignadas.includes(etiqueta.id) ? ' selected' : ''}>${e(etiqueta.nombre)}${etiqueta.archivado ? ' · Inactiva (asignada)' : ''}</option>`).join('')}
          </select></label><p id="asignaciones-ayuda" class="work-meta full">Use Ctrl (Windows/Linux) o Command (macOS) para seleccionar varias opciones. Las asignaciones inactivas existentes se conservan.</p>` +
          `<label>Prioridad<select name="prioridad">${PSA.Trabajo.PRIORIDADES.map(p =>
            `<option value="${p === 'Crítica' ? 'Urgente' : p}"${(p === 'Crítica' ? 'Urgente' : p) === (fila.prioridad || 'Media') ? ' selected' : ''}>${p}</option>`).join('')}</select></label>` +
          _campo('inicio', 'Fecha de inicio', fila.inicio, 'min="1000-01-01" max="9999-12-31"', 'date') +
          _campo('vencimiento', 'Vencimiento', fila.vencimiento, 'min="1000-01-01" max="9999-12-31"', 'date') +
          _campo('observaciones', 'Observaciones', fila.observaciones, '', 'textarea') +
          `<label class="check-label"><input name="completada" type="checkbox"${(id ? fila.completada : lista.categoria === 'completado') ? ' checked' : ''}>Completada</label>`;
        contexto = 'Tablero: ' + tablero.nombre + ' · Lista: ' + lista.nombre +
          '. Puede asignar varios responsables y etiquetas.';
      }
      editor = { tipo, fila, soloLectura };
      origenFoco = document.activeElement;
      const nombres = { responsable: 'responsable', etiqueta: 'etiqueta', tablero: 'tablero', lista: 'lista', tarjeta: 'tarjeta' };
      $('trabajo-dialog-titulo').textContent = (soloLectura ? 'Consultar ' : id ? 'Editar ' : 'Crear ') + nombres[tipo];
      $('trabajo-dialog-contexto').textContent = contexto + (soloLectura ? ' Elemento archivado: solo lectura. Restaure sus contenedores y el elemento para editar.' : '');
      $('trabajo-dialog-campos').innerHTML = campos;
      $('trabajo-dialog-error').textContent = '';
      $('trabajo-dialog-estado').textContent = '';
      actualizarEstado();
      formularioInicial = _instantanea();
      dialog().showModal();
    } catch (error) {
      console.error('[PSA.Tableros] Error al abrir editor:', error);
      PSA.toast(error.message, 'error');
    }
  }

  function actualizarEstado() {
    if (!editor) return;
    const bloqueado = PSA.DB.ocupado || editor.soloLectura;
    dialog().querySelectorAll('input, textarea, select, button').forEach(control => {
      if (!control.dataset.bloqueoOriginal) control.dataset.bloqueoOriginal = control.disabled ? 'si' : 'no';
      control.disabled = control.id === 'trabajo-dialog-cancelar' ? PSA.DB.ocupado
        : bloqueado || control.dataset.bloqueoOriginal === 'si';
    });
    $('trabajo-dialog-estado').textContent = PSA.DB.ocupado ? 'Guardando… No cierre esta ventana.' : '';
  }

  async function guardar(event) {
    event.preventDefault();
    if (!editor || editor.soloLectura || PSA.DB.ocupado) return;
    if (!$('trabajo-form').reportValidity()) return;
    $('trabajo-dialog-error').textContent = '';
    const formulario = new FormData($('trabajo-form'));
    const datos = Object.fromEntries(formulario);
    const { tipo, fila } = editor;
    const entidad = (tipo === 'tablero' ? 'el ' : 'la ') + tipo;
    const entrada = { ...datos };
    if (fila.id) entrada.id = fila.id;
    if (tipo === 'tablero' && fila.id) entrada.proyecto_id = fila.proyecto_id;
    if (tipo === 'lista') {
      entrada.tablero_id = fila.tablero_id;
      entrada.categoria = datos.categoria || fila.categoria;
    }
    if (tipo === 'tarjeta') {
      entrada.lista_id = fila.lista_id;
      entrada.responsables = formulario.getAll('responsables').filter(Boolean);
      if (!entrada.responsables.length && datos.responsable_id) entrada.responsables = [datos.responsable_id];
      entrada.etiquetas = formulario.getAll('etiquetas').filter(Boolean);
      entrada.completada = datos.completada ? 1 : 0;
    }
    try {
      const metodos = { tablero: 'guardarTablero', lista: 'guardarLista', tarjeta: 'guardarTarjeta',
        responsable: 'guardarResponsable', etiqueta: 'guardarEtiqueta' };
      const id = await PSA.Trabajo[metodos[tipo]](entrada);
      if (tipo === 'tablero') tableroId = id;
      cerrar(true);
      PSA.renderTodo();
      if (tipo === 'responsable' || tipo === 'etiqueta') {
        const boton = document.querySelector(`[data-accion="${tipo === 'responsable' ? 'nuevo-responsable' : 'nueva-etiqueta'}"]`);
        if (boton) boton.focus();
      } else $('tablero-titulo').focus();
      PSA.toast('Se guardó ' + entidad + ' correctamente.');
    } catch (error) {
      console.error('[PSA.Tableros] Error al guardar:', error);
      $('trabajo-dialog-error').textContent = 'No se guardó: ' + error.message;
      PSA.toast('No se guardó ' + entidad + ': ' + error.message, 'error');
    }
  }

  async function _archivar(tipo, id) {
    const filas = tipo === 'tablero' ? PSA.Trabajo.getTableros()
      : tipo === 'lista' ? PSA.Trabajo.getListas(tableroId)
        : tipo === 'tarjeta' ? PSA.Trabajo.getTarjetas()
          : tipo === 'responsable' ? PSA.Trabajo.getResponsables() : PSA.Trabajo.getEtiquetas();
    const fila = filas.find(f => f.id === id);
    if (!fila) throw new Error('El elemento ya no existe.');
    const archivado = tipo === 'tarjeta' ? fila.archivada : fila.archivado;
    if (!archivado) {
      const desactivarCatalogo = tipo === 'responsable' || tipo === 'etiqueta';
      const confirmacion = desactivarCatalogo
        ? '¿Desactivar «' + fila.nombre + '»? Se conservarán las asignaciones históricas; no estará disponible para nuevas tarjetas.'
        : '¿Archivar ' + (fila.nombre || fila.titulo) +
          '? Su contenido dejará de aparecer entre los elementos activos. Puede restaurarlo desde «Incluir archivados».';
      if (!confirm(confirmacion)) return;
    }
    await PSA.Trabajo.archivar(tipo, id, !archivado);
    PSA.renderTodo();
    if (tipo === 'tablero') $('tableros-proyecto').focus();
    else if (tipo === 'responsable') $('buscar-responsables').focus();
    else if (tipo === 'etiqueta') $('buscar-etiquetas').focus();
    else $('tablero-titulo').focus();
    PSA.toast(archivado ? 'Elemento reactivado o restaurado.' : 'Elemento desactivado o archivado.');
  }

  async function _accion(event) {
    const boton = event.target.closest('button[data-accion]');
    if (!boton || boton.disabled || PSA.DB.ocupado) return;
    const accion = boton.dataset.accion;
    const id = boton.dataset.id;
    $('tableros-error').textContent = '';
    try {
      if (accion === 'abrir') {
        if (tableroId !== id) tarjetasSeleccionadas.clear();
        tableroId = id; _renderDetalle(); $('tablero-titulo').focus();
      } else if (accion === 'nuevo-tablero') editar('tablero');
      else if (accion === 'tablero') editar('tablero', id);
      else if (accion === 'editar-tablero-actual') editar('tablero', tableroId);
      else if (accion === 'nuevo-responsable') editar('responsable');
      else if (accion === 'responsable') editar('responsable', id);
      else if (accion === 'nueva-etiqueta') editar('etiqueta');
      else if (accion === 'etiqueta') editar('etiqueta', id);
      else if (accion === 'nueva-lista') editar('lista');
      else if (accion === 'lista') editar('lista', id);
      else if (accion === 'nueva-tarjeta') editar('tarjeta', null, id);
      else if (accion === 'tarjeta') editar('tarjeta', id);
      else if (accion.startsWith('archivo-')) await _archivar(accion.slice(8), id);
      else if (accion === 'limpiar-filtros-tarjetas') {
        ['filtro-tarjetas-texto', 'filtro-tarjetas-responsable', 'filtro-tarjetas-etiqueta',
          'filtro-tarjetas-prioridad', 'filtro-tarjetas-lista', 'filtro-tarjetas-asignacion']
          .forEach(control => { $(control).value = ''; });
        $('tablero-incluir-seleccion-oculta').checked = false;
        render();
      }
      else if (accion === 'tarjeta-anterior' || accion === 'tarjeta-siguiente' ||
          accion === 'tarjeta-posicion-anterior' || accion === 'tarjeta-posicion-siguiente' ||
          accion === 'mover-tarjeta') {
        await _moverTarjeta(id, accion, boton);
      } else if (accion.startsWith('mover-seleccion-')) {
        await _moverSeleccion(accion);
      } else if (accion === 'cancelar-seleccion') {
        tarjetasSeleccionadas.clear();
        render();
        $('tablero-seleccion-cantidad').focus();
        PSA.toast('Selección de tarjetas cancelada.');
      } else if (accion === 'seleccionar-etapa') {
        const filtros = _filtrosTarjetas();
        PSA.Trabajo.getTarjetas().filter(t => t.lista_id === id && !t.archivada && _coincideTarjeta(t, filtros)).forEach(t =>
          tarjetasSeleccionadas.add(t.id));
        _renderDetalle();
        const botonEtapa = Array.from($('tablero-columnas').querySelectorAll('[data-accion="seleccionar-etapa"]'))
          .find(elemento => elemento.dataset.id === id);
        if (botonEtapa) botonEtapa.focus();
      }
      else if (accion === 'lista-anterior' || accion === 'lista-siguiente') {
        const ids = PSA.Trabajo.getListas(tableroId).filter(l => !l.archivado).map(l => l.id);
        const indice = ids.indexOf(id);
        const destino = indice + (accion === 'lista-anterior' ? -1 : 1);
        if (indice < 0 || destino < 0 || destino >= ids.length) throw new Error('No se puede mover la lista a esa posición.');
        [ids[indice], ids[destino]] = [ids[destino], ids[indice]];
        await PSA.Trabajo.reordenarListas(tableroId, ids);
        render();
        const equivalente = Array.from($('tablero-columnas').querySelectorAll('button')).find(b =>
          b.dataset.id === id && b.dataset.accion === 'lista');
        if (equivalente) equivalente.focus();
        PSA.toast('Orden de listas guardado.');
      }
    } catch (error) {
      console.error('[PSA.Tableros] Error en operación:', error);
      $('tableros-error').textContent = error.message;
      PSA.toast(error.message, 'error');
    }
  }

  function reiniciar() {
    if (dialog().open) cerrar(true);
    tableroId = null;
    $('tableros-proyecto').value = '';
    $('tableros-archivados').checked = false;
    $('tablero-ver-archivados').checked = false;
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('v-tableros').addEventListener('click', _accion);
    $('tablero-columnas').addEventListener('dragstart', _iniciarArrastre);
    $('tablero-columnas').addEventListener('dragenter', _actualizarDestinoArrastre);
    $('tablero-columnas').addEventListener('dragover', _actualizarDestinoArrastre);
    $('tablero-columnas').addEventListener('drop', _confirmarArrastre);
    $('tablero-columnas').addEventListener('dragend', _finalizarArrastre);
    $('tablero-columnas').addEventListener('dragleave', event => {
      const lista = event.target.closest('.kanban-list');
      if (lista && !lista.contains(event.relatedTarget)) lista.classList.remove('drop-target', 'drop-invalid');
    });
    $('tableros-proyecto').addEventListener('change', () => { tableroId = null; render(); });
    $('tableros-archivados').addEventListener('change', () => { tableroId = null; render(); });
    $('tablero-ver-archivados').addEventListener('change', render);
    $('v-tableros').addEventListener('change', event => {
      const checkbox = event.target.closest('.tarjeta-seleccion');
      if (checkbox) {
        if (checkbox.checked) tarjetasSeleccionadas.add(checkbox.dataset.id);
        else tarjetasSeleccionadas.delete(checkbox.dataset.id);
        _renderDetalle();
        const equivalente = Array.from($('tablero-columnas').querySelectorAll('.tarjeta-seleccion'))
          .find(control => control.dataset.id === checkbox.dataset.id);
        if (equivalente) equivalente.focus();
        return;
      }
      if (event.target.id === 'tablero-incluir-seleccion-oculta') {
        _renderDetalle();
        return;
      }
    });
    ['filtro-tarjetas-texto', 'filtro-tarjetas-responsable', 'filtro-tarjetas-etiqueta',
      'filtro-tarjetas-prioridad', 'filtro-tarjetas-lista', 'filtro-tarjetas-asignacion']
      .forEach(id => $(id).addEventListener(id === 'filtro-tarjetas-texto' ? 'input' : 'change', () => {
        $('tablero-incluir-seleccion-oculta').checked = false;
        render();
      }));
    $('buscar-responsables').addEventListener('input', render);
    $('buscar-etiquetas').addEventListener('input', render);
    $('ver-responsables-inactivos').addEventListener('change', render);
    $('ver-etiquetas-inactivas').addEventListener('change', render);
    $('trabajo-form').addEventListener('change', event => {
      if (event.target.name !== 'responsables') return;
      const seleccionados = Array.from(event.target.selectedOptions, opcion => opcion.value);
      $('trabajo-form').elements.namedItem('responsable_id').value = seleccionados[0] || '';
    });
    $('trabajo-form').addEventListener('submit', guardar);
    $('trabajo-dialog-cancelar').addEventListener('click', () => cerrar());
    dialog().addEventListener('cancel', event => { event.preventDefault(); cerrar(); });
    dialog().addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  });

  PSA.Tableros = { render, abrirProyecto, reiniciar, actualizarEstado, get editorAbierto() { return dialog().open; } };
})();
