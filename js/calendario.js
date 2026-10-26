'use strict';

(function () {
  const PSA = window.PSA;
  const $ = id => document.getElementById(id);
  const escape = value => PSA.escapeHtml(value);
  let referencia = new Date();
  let vista = 'mes';

  function _clave(fecha) {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  }

  function _desdeClave(clave) {
    const [anio, mes, dia] = clave.split('-').map(Number);
    return new Date(anio, mes - 1, dia);
  }

  function _sumar(fecha, dias) {
    const resultado = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    resultado.setDate(resultado.getDate() + dias);
    return resultado;
  }

  function _hoy() {
    const fecha = new Date();
    return _clave(fecha);
  }

  function _tarjetas() {
    return PSA.Trabajo.getTarjetas().filter(tarjeta =>
      !tarjeta.archivada && !tarjeta.lista_archivada &&
      !tarjeta.tablero_archivado && !tarjeta.proyecto_archivado);
  }

  function seguimiento(tarjetas) {
    const activas = tarjetas.filter(tarjeta =>
      !tarjeta.archivada && !tarjeta.lista_archivada &&
      !tarjeta.tablero_archivado && !tarjeta.proyecto_archivado);
    const hoy = _hoy();
    const limite = _clave(_sumar(_desdeClave(hoy), 6));
    const pendientes = activas.filter(tarjeta => !tarjeta.completada);
    return {
      hoy: pendientes.filter(tarjeta => tarjeta.vencimiento === hoy),
      proximos7: pendientes.filter(tarjeta =>
        tarjeta.vencimiento && tarjeta.vencimiento >= hoy && tarjeta.vencimiento <= limite),
      atrasadas: pendientes.filter(tarjeta => tarjeta.vencimiento && tarjeta.vencimiento < hoy),
      sinVencimiento: pendientes.filter(tarjeta => !tarjeta.vencimiento),
      hoyClave: hoy,
      limiteClave: limite
    };
  }

  function _crearEventosPorFecha(tarjetas) {
    const porFecha = new Map();
    tarjetas.forEach(tarjeta => {
      const inicio = tarjeta.inicio;
      const vencimiento = tarjeta.vencimiento;
      const fechas = new Set([tarjeta.inicio, tarjeta.vencimiento].filter(Boolean));
      fechas.forEach(clave => {
        const eventos = porFecha.get(clave) || [];
        eventos.push({
          tarjeta,
          etiqueta: inicio === clave && vencimiento === clave
            ? 'Inicio y vencimiento' : inicio === clave ? 'Inicio' : 'Vencimiento'
        });
        porFecha.set(clave, eventos);
      });
    });
    porFecha.forEach(eventos => eventos.sort((a, b) =>
      (a.tarjeta.vencimiento || '9999-12-31').localeCompare(b.tarjeta.vencimiento || '9999-12-31') ||
      a.tarjeta.titulo.localeCompare(b.tarjeta.titulo, 'es')));
    return porFecha;
  }

  function _eventosPorFecha(porFecha, clave) {
    return porFecha.get(clave) || [];
  }

  function _tarjetaEvento(evento) {
    const tarjeta = evento.tarjeta;
    const prioridad = tarjeta.prioridad === 'Urgente' ? 'Crítica' : tarjeta.prioridad;
    const responsables = (tarjeta.responsables || []).map(responsable => responsable.nombre).join(', ') || 'Sin responsables';
    const hoy = _hoy();
    const vencida = tarjeta.vencimiento && tarjeta.vencimiento < hoy && !tarjeta.completada;
    const proximo = tarjeta.vencimiento && tarjeta.vencimiento >= hoy &&
      tarjeta.vencimiento <= _clave(_sumar(_desdeClave(hoy), 6)) && !tarjeta.completada;
    return `<article class="calendar-event${vencida ? ' calendar-event-overdue' : ''}">
      <div class="calendar-event-heading">
        <button type="button" class="calendar-open-card" data-card-id="${escape(tarjeta.id)}">
          ${escape(tarjeta.titulo)}
        </button>
        <span class="work-badge">${escape(evento.etiqueta)}</span>
      </div>
      <p>${escape(tarjeta.tablero_nombre)} · ${escape(tarjeta.lista_nombre)}</p>
      <p>Vencimiento: ${escape(PSA.formatFecha(tarjeta.vencimiento))} · Prioridad: ${escape(prioridad)}</p>
      <p>Responsables: ${escape(responsables)}${vencida ? ' · Vencida' :
        proximo ? ' · Vence pronto' : tarjeta.completada ? ' · Completada' : ''}</p>
      <button type="button" class="btn btn-ghost btn-sm calendar-history" data-card-id="${escape(tarjeta.id)}">
        Ver historial
      </button>
    </article>`;
  }

  function _celda(fecha, mesActual, porFecha) {
    const clave = _clave(fecha);
    const eventos = _eventosPorFecha(porFecha, clave);
    const hoy = clave === _hoy();
    const visibles = eventos.slice(0, 3).map(_tarjetaEvento).join('');
    const restantes = eventos.slice(3);
    const nombreDia = new Intl.DateTimeFormat('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(fecha);
    return `<div class="calendar-day${mesActual ? '' : ' calendar-day-outside'}${hoy ? ' calendar-day-today' : ''}"
      role="group" aria-label="${escape(nombreDia)}${hoy ? ', hoy' : ''}, ${eventos.length} tareas">
      <h4><time datetime="${clave}">${fecha.getDate()}</time>${hoy ? '<span class="calendar-today-label">Hoy</span>' : ''}</h4>
      ${visibles || '<p class="calendar-empty-day">—</p>'}
      ${restantes.length ? `<details class="calendar-more"><summary>+ ${restantes.length} tareas más</summary>
        ${restantes.map(_tarjetaEvento).join('')}</details>` : ''}
    </div>`;
  }

  function _diasSemana(fecha) {
    const inicio = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    const desplazamiento = (inicio.getDay() + 6) % 7;
    inicio.setDate(inicio.getDate() - desplazamiento);
    return Array.from({ length: 7 }, (_, indice) => _sumar(inicio, indice));
  }

  function _periodoMes() {
    return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(referencia);
  }

  function _renderMes(porFecha) {
    const primero = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
    const inicio = _sumar(primero, -((primero.getDay() + 6) % 7));
    const dias = Array.from({ length: 42 }, (_, indice) => _sumar(inicio, indice));
    $('calendario-periodo').textContent = _periodoMes();
    $('calendario-contenido').innerHTML = `<div class="calendar-grid calendar-month" role="group" aria-label="Calendario mensual">
      ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(dia =>
        `<div class="calendar-weekday">${dia}</div>`).join('')}
      ${dias.map(fecha => _celda(fecha, fecha.getMonth() === referencia.getMonth(), porFecha)).join('')}
    </div>`;
  }

  function _renderSemana(porFecha) {
    const dias = _diasSemana(referencia);
    $('calendario-periodo').textContent = PSA.formatFecha(_clave(dias[0])) + ' – ' + PSA.formatFecha(_clave(dias[6]));
    $('calendario-contenido').innerHTML = `<div class="calendar-grid calendar-week" role="group" aria-label="Calendario semanal">
      ${dias.map(fecha => `<div class="calendar-weekday">${escape(new Intl.DateTimeFormat('es-AR', {
        weekday: 'long', day: 'numeric', month: 'short'
      }).format(fecha))}</div>`).join('')}
      ${dias.map(fecha => _celda(fecha, true, porFecha)).join('')}
    </div>`;
  }

  function _renderAgenda(porFecha) {
    const inicio = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
    const fin = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0);
    const fechas = Array.from(porFecha.keys())
      .filter(fecha => fecha >= _clave(inicio) && fecha <= _clave(fin)).sort();
    $('calendario-periodo').textContent = _periodoMes();
    $('calendario-contenido').innerHTML = fechas.length
      ? `<ol class="calendar-agenda">${fechas.map(clave => `<li>
          <h4><time datetime="${clave}">${escape(new Intl.DateTimeFormat('es-AR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
          }).format(_desdeClave(clave)))}</time></h4>
            <div class="calendar-agenda-events">${_eventosPorFecha(porFecha, clave).map(_tarjetaEvento).join('')}</div>
        </li>`).join('')}</ol>`
      : '<p class="empty">No hay tareas fechadas en este período.</p>';
  }

  function render() {
    if (!$('calendario-contenido')) return;
    vista = $('calendario-vista').value || vista;
    const tarjetas = _tarjetas();
    const porFecha = _crearEventosPorFecha(tarjetas);
    const conFecha = tarjetas.filter(tarjeta => tarjeta.inicio || tarjeta.vencimiento).length;
    $('calendario-estado').textContent = `${conFecha} tarjetas activas con al menos una fecha. Las tarjetas sin fechas no aparecen en el calendario.`;
    if (vista === 'semana') _renderSemana(porFecha);
    else if (vista === 'agenda') _renderAgenda(porFecha);
    else _renderMes(porFecha);
  }

  function _moverPeriodo(direccion) {
    if (vista === 'semana') referencia = _sumar(referencia, direccion * 7);
    else referencia = new Date(referencia.getFullYear(), referencia.getMonth() + direccion, 1);
    render();
  }

  function reiniciar() {
    referencia = new Date();
    vista = 'mes';
    $('calendario-vista').value = vista;
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('calendario-vista').addEventListener('change', () => {
      vista = $('calendario-vista').value;
      render();
    });
    $('calendario-anterior').addEventListener('click', () => _moverPeriodo(-1));
    $('calendario-siguiente').addEventListener('click', () => _moverPeriodo(1));
    $('calendario-hoy').addEventListener('click', () => {
      referencia = new Date();
      render();
    });
    $('calendario-contenido').addEventListener('click', event => {
      const abrir = event.target.closest('.calendar-open-card');
      const historial = event.target.closest('.calendar-history');
      if (abrir) {
        try {
          PSA.Tableros.abrirTarjeta(abrir.dataset.cardId);
        } catch (error) {
          console.error('[PSA.Calendario] No se pudo abrir la tarjeta:', error);
          PSA.toast(error.message, 'error');
        }
      } else if (historial) {
        PSA.Actividad.mostrarTarjeta(historial.dataset.cardId);
      }
    });
    render();
  });

  PSA.Calendario = { render, reiniciar, seguimiento };
})();
