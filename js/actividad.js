'use strict';

(function () {
  const PSA = window.PSA;
  const $ = id => document.getElementById(id);
  const escape = value => PSA.escapeHtml(value);
  const TAMANO_PAGINA = 100;
  let tarjetaId = '';
  let tableroId = '';
  let cursor = null;
  let cargandoMas = false;

  function _fecha(valor) {
    if (!valor) return 'sin fecha';
    return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? PSA.formatFecha(valor) : valor;
  }

  function _datos(evento) {
    try { return JSON.parse(evento.detalle); } catch { return null; }
  }

  function _categoria(tipo) {
    if (tipo === 'tarjeta_creada') return { clase: 'creation', texto: 'Creación' };
    if (tipo.startsWith('responsable_') || tipo.startsWith('etiqueta_')) {
      return { clase: 'assignment', texto: 'Asignación' };
    }
    if (tipo === 'tarjeta_movida' || tipo === 'tarjeta_reordenada') {
      return { clase: 'movement', texto: tipo === 'tarjeta_movida' ? 'Movimiento' : 'Reordenamiento' };
    }
    if (tipo.includes('archivado') || tipo.includes('restaurado') ||
        tipo === 'tarea_completada' || tipo === 'tarea_reabierta') {
      return { clase: 'state', texto: 'Estado' };
    }
    return { clase: 'change', texto: 'Cambio' };
  }

  function _textoEvento(evento) {
    const datos = _datos(evento);
    const tipo = evento.tipo;
    if (tipo === 'tarjeta_creada') return evento.detalle;
    if (tipo === 'titulo_cambiado' && datos) return `El título cambió de «${datos.anterior}» a «${datos.actual}».`;
    if (tipo === 'descripcion_cambiada') return 'Se modificó la descripción.';
    if (tipo === 'prioridad_cambiada' && datos) {
      const prioridad = valor => valor === 'Urgente' ? 'Crítica' : valor;
      return `La prioridad cambió de ${prioridad(datos.anterior)} a ${prioridad(datos.actual)}.`;
    }
    if (tipo === 'inicio_cambiado' && datos) return `La fecha de inicio cambió de ${_fecha(datos.anterior)} a ${_fecha(datos.actual)}.`;
    if (tipo === 'vencimiento_cambiado' && datos) return `El vencimiento cambió de ${_fecha(datos.anterior)} a ${_fecha(datos.actual)}.`;
    if (tipo === 'observaciones_cambiadas') return 'Se modificaron las observaciones.';
    if (tipo === 'responsable_asignado' && datos) return `Se asignó el responsable ${datos.nombre}.`;
    if (tipo === 'responsable_retirado' && datos) return `Se retiró el responsable ${datos.nombre}.`;
    if (tipo === 'etiqueta_agregada' && datos) return `Se agregó la etiqueta ${datos.nombre}.`;
    if (tipo === 'etiqueta_retirada' && datos) return `Se retiró la etiqueta ${datos.nombre}.`;
    if (tipo === 'tarjeta_movida' && datos) return `La tarjeta pasó de «${datos.desde}» a «${datos.hasta}».`;
    if (tipo === 'tarjeta_reordenada' && datos) return `La tarjeta se reordenó en «${datos.etapa}».`;
    if (tipo === 'tarea_completada') return 'La tarjeta se marcó como completada.';
    if (tipo === 'tarea_reabierta') return 'La tarjeta se reabrió.';
    if (tipo === 'tarjeta_archivado') return 'La tarjeta se archivó.';
    if (tipo === 'tarjeta_restaurado') return 'La tarjeta se restauró.';
    return evento.detalle;
  }

  function _actualizarTableros() {
    const select = $('actividad-tablero');
    const seleccionado = tableroId || select.value;
    const tableros = PSA.Trabajo.getTableros();
    select.innerHTML = '<option value="">Todos los tableros</option>' +
      tableros.map(tablero => `<option value="${escape(tablero.id)}"${tablero.id === seleccionado ? ' selected' : ''}>
        ${escape(tablero.nombre)}${tablero.archivado ? ' · Archivado' : ''}
      </option>`).join('');
    if (!tableros.some(tablero => tablero.id === seleccionado)) {
      tableroId = '';
      select.value = '';
    }
  }

  function _renderFilas(eventos, anexar) {
    const lista = $('actividad-lista');
    const tarjetas = PSA.Trabajo.getTarjetas();
    const tableros = PSA.Trabajo.getTableros();
    const filas = eventos.map(evento => {
      const tarjeta = tarjetas.find(fila => fila.id === evento.tarjeta_id);
      const titulo = evento.tarjeta_titulo || (tarjeta && tarjeta.titulo) || 'Tarjeta eliminada o no disponible';
      const categoria = _categoria(evento.tipo);
      return `<li class="activity-item activity-${categoria.clase}">
        <div class="activity-heading"><strong>${escape(titulo)}</strong>
          <time datetime="${escape(evento.created_at)}">${escape(new Date(evento.created_at).toLocaleString('es-AR'))}</time></div>
        <span class="activity-type">${categoria.texto}</span>
        <p>${escape(_textoEvento(evento))}</p>
        <p class="work-meta">${escape(evento.actor || 'Actividad local')}${
          evento.tablero_id ? ' · Tablero: ' + escape(tableros
            .find(tablero => tablero.id === evento.tablero_id)?.nombre || 'No disponible') : ''
        }</p>
        ${evento.tarjeta_id && tarjeta ? `<button type="button" class="btn btn-ghost btn-sm activity-open-card"
          data-card-id="${escape(evento.tarjeta_id)}">Abrir tarjeta</button>` : ''}
      </li>`;
    }).join('');
    if (anexar) lista.insertAdjacentHTML('beforeend', filas);
    else lista.innerHTML = filas;
    if (!lista.children.length) {
      lista.innerHTML = '<li class="empty">No hay actividad para este criterio.</li>';
    }
  }

  function render(anexar = false) {
    _actualizarTableros();
    const filtros = { limite: TAMANO_PAGINA };
    if (tableroId) filtros.tableroId = tableroId;
    if (tarjetaId) filtros.tarjetaId = tarjetaId;
    if (anexar && cursor) filtros.antesId = cursor;
    $('actividad-error').textContent = '';
    try {
      const eventos = PSA.Trabajo.getActividad(filtros);
      _renderFilas(eventos, anexar);
      cursor = eventos.length ? eventos[eventos.length - 1].id : cursor;
      cargandoMas = false;
      $('actividad-mas').classList.toggle('hidden', eventos.length < TAMANO_PAGINA);
      const contexto = tarjetaId ? `Historial de tarjeta: ${eventos[0]?.tarjeta_titulo || 'Tarjeta no disponible'}.`
        : tableroId ? 'Actividad del tablero seleccionado.'
          : 'Actividad reciente de todos los tableros. Se muestran hasta 100 eventos por página.';
      $('actividad-contexto').textContent = contexto;
    } catch (error) {
      console.error('[PSA.Actividad] Error al consultar actividad:', error);
      $('actividad-error').textContent = 'No se pudo consultar la actividad: ' + error.message;
      $('actividad-mas').classList.add('hidden');
      cargandoMas = false;
    }
  }

  function _cambiarFiltro() {
    tableroId = $('actividad-tablero').value;
    tarjetaId = '';
    cursor = null;
    render();
  }

  function mostrarTarjeta(id) {
    const tarjeta = PSA.Trabajo.getTarjetas().find(fila => fila.id === id);
    tarjetaId = id;
    tableroId = tarjeta ? tarjeta.tablero_id : '';
    cursor = null;
    PSA.cambiarTab('v-actividad', 'v-actividad');
    render();
    $('actividad-contexto').focus();
  }

  function mostrarTablero(id) {
    tarjetaId = '';
    tableroId = id || '';
    cursor = null;
    PSA.cambiarTab('v-actividad', 'v-actividad');
    render();
  }

  function reiniciar() {
    tarjetaId = '';
    tableroId = '';
    cursor = null;
    if ($('actividad-tablero')) $('actividad-tablero').value = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('actividad-tablero').addEventListener('change', _cambiarFiltro);
    $('actividad-limpiar').addEventListener('click', () => {
      tarjetaId = '';
      tableroId = '';
      cursor = null;
      $('actividad-tablero').value = '';
      render();
    });
    $('actividad-mas').addEventListener('click', () => {
      if (!cargandoMas && cursor) {
        cargandoMas = true;
        render(true);
      }
    });
    $('actividad-lista').addEventListener('click', event => {
      const boton = event.target.closest('.activity-open-card');
      if (!boton) return;
      try {
        PSA.Tableros.abrirTarjeta(boton.dataset.cardId);
      } catch (error) {
        console.error('[PSA.Actividad] No se pudo abrir la tarjeta:', error);
        PSA.toast(error.message, 'error');
      }
    });
    render();
  });

  PSA.Actividad = { render, mostrarTarjeta, mostrarTablero, reiniciar };
})();
