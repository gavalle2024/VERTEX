/* ============================================================
   js/dashboard.js — Panel de control y métricas de proyectos
   Depende de PSA.DB, PSA.Trabajo, PSA.Calendario y PSA.Actividad
   ============================================================ */
'use strict';

(function () {
  const IMPL_ORDEN = [
    'No iniciado',
    'Piloto / Prueba',
    'Implementación parcial',
    'Implementación completa',
    'En producción / uso regular',
    'Discontinuado'
  ];
  const PRIORIDADES = [
    { valor: 'Urgente', nombre: 'Crítica', clase: 'critical' },
    { valor: 'Alta', nombre: 'Alta', clase: 'high' },
    { valor: 'Media', nombre: 'Media', clase: 'medium' },
    { valor: 'Baja', nombre: 'Baja', clase: 'low' }
  ];
  const $ = id => document.getElementById(id);
  const escape = valor => PSA.escapeHtml(valor);
  let tablerosActivos = [];
  let hayProyectosActivos = false;
  let datosDisponibles = false;

  function _stat(num, lbl, color) {
    return `<div class="stat">
      <div class="num"${color ? ' style="color:' + color + '"' : ''}>${num}</div>
      <div class="lbl">${lbl}</div>
    </div>`;
  }

  function _barra(label, pct, colorFill) {
    return `<div class="project-progress">
      <div class="project-progress-label">${label}</div>
      <div class="bar-bg" role="progressbar" aria-label="${escape(label)}" aria-valuemin="0"
        aria-valuemax="100" aria-valuenow="${pct}">
        <div class="bar-fill" style="width:${pct}%;${colorFill ? 'background:' + colorFill : ''}"></div>
      </div>
      <div class="project-progress-value">${pct}%</div>
    </div>`;
  }

  function _estadisticasProyectos(proyectos) {
    const total = proyectos.length;
    const porEstado = { 'En curso': 0, 'Completado': 0, 'Demorado': 0, 'Suspendido': 0 };
    proyectos.forEach(proyecto => {
      if (proyecto.estado in porEstado) porEstado[proyecto.estado]++;
    });
    const avgAvance = total
      ? Math.round(proyectos.reduce((suma, proyecto) => suma + (proyecto.avance || 0), 0) / total)
      : 0;
    const evaluables = proyectos.filter(proyecto =>
      proyecto.cumplimiento !== 'En curso (pendiente de evaluar)').length;
    const enTermino = proyectos.filter(proyecto =>
      proyecto.cumplimiento === 'Cumplido en término').length;
    const pctEnTermino = evaluables ? Math.round(enTermino / evaluables * 100) : 0;
    const porImpl = {};
    IMPL_ORDEN.forEach(valor => { porImpl[valor] = 0; });
    proyectos.forEach(proyecto => {
      const nivel = proyecto.implementacion || 'No iniciado';
      porImpl[nivel] = (porImpl[nivel] || 0) + 1;
    });

    $('dash-estado').innerHTML =
      _stat(total, 'Proyectos totales') +
      _stat(porEstado['En curso'], 'En curso', 'var(--navy)') +
      _stat(porEstado['Completado'], 'Completados', 'var(--green)') +
      _stat(porEstado['Demorado'], 'Demorados', 'var(--amber)');
    $('dash-barras').innerHTML = `<div class="project-progress-grid">
      ${_barra('Proyectos cumplidos en término (sobre evaluables)', pctEnTermino)}
      ${_barra('Avance promedio manual de los proyectos', avgAvance, 'var(--navy2)')}
    </div>`;

    const demora = proyectos.filter(proyecto => proyecto.cumplimiento === 'Cumplido con demora').length;
    const parcial = proyectos.filter(proyecto => proyecto.cumplimiento === 'Parcialmente cumplido').length;
    const noCumpl = proyectos.filter(proyecto => proyecto.cumplimiento === 'No cumplido').length;
    const pendEval = proyectos.filter(proyecto =>
      proyecto.cumplimiento === 'En curso (pendiente de evaluar)').length;
    $('dash-cumplimiento').innerHTML =
      _stat(enTermino, 'En término', 'var(--green)') +
      _stat(demora, 'Con demora', 'var(--amber)') +
      _stat(parcial, 'Parcialmente', 'var(--amber)') +
      _stat(noCumpl, 'No cumplidos', 'var(--red)') +
      _stat(pendEval, 'Pendientes de eval.', 'var(--muted)');
    $('dash-implementacion').innerHTML = IMPL_ORDEN.map(valor =>
      _stat(porImpl[valor] || 0, escape(valor))).join('');

    const suspendidos = proyectos.filter(proyecto => proyecto.estado === 'Suspendido');
    const bloqueSuspendidos = $('dash-suspendidos');
    if (!suspendidos.length) {
      bloqueSuspendidos.classList.add('hidden');
    } else {
      bloqueSuspendidos.classList.remove('hidden');
      bloqueSuspendidos.querySelector('tbody').innerHTML = suspendidos.map(proyecto =>
        `<tr><td><strong>${escape(proyecto.nombre)}</strong></td>
          <td>${escape(proyecto.responsable)}</td>
          <td>${escape(proyecto.observaciones || '—')}</td></tr>`).join('');
    }
  }

  function _tarjetaActiva(tarjeta) {
    return !tarjeta.archivada && !tarjeta.lista_archivada &&
      !tarjeta.tablero_archivado && !tarjeta.proyecto_archivado;
  }

  function _ordenarTarjetas(a, b) {
    return (a.vencimiento || '9999-12-31').localeCompare(b.vencimiento || '9999-12-31') ||
      a.titulo.localeCompare(b.titulo, 'es');
  }

  function _tarjetaEnlace(tarjeta, detalle) {
    const prioridad = PRIORIDADES.find(item => item.valor === tarjeta.prioridad) || PRIORIDADES[2];
    const responsables = (tarjeta.responsables || []).map(responsable => responsable.nombre);
    if (!responsables.length && tarjeta.responsable_nombre) responsables.push(tarjeta.responsable_nombre);
    return `<li class="dashboard-task-item">
      <button type="button" class="dashboard-task-title" data-dashboard-card-id="${escape(tarjeta.id)}">
        ${escape(tarjeta.titulo)}
      </button>
      <p>${escape(tarjeta.tablero_nombre)} · ${escape(tarjeta.lista_nombre)} ·
        <span class="dashboard-priority-label dashboard-priority-${prioridad.clase}">${prioridad.nombre}</span>
        ${responsables.length ? ' · ' + escape(responsables.join(', ')) : ' · Sin responsables'}
        ${detalle ? ' · ' + escape(detalle) : ''}
      </p>
    </li>`;
  }

  function _renderMetricas(tableros, tarjetas, proyectos) {
    const activos = tarjetas.filter(_tarjetaActiva);
    const completadas = activos.filter(tarjeta => !!tarjeta.completada);
    const pendientes = activos.filter(tarjeta => !tarjeta.completada && tarjeta.categoria === 'pendiente');
    const enCurso = activos.filter(tarjeta => !tarjeta.completada && tarjeta.categoria === 'en_curso');
    const otrasEtapas = activos.filter(tarjeta => !tarjeta.completada &&
      !['pendiente', 'en_curso'].includes(tarjeta.categoria));
    const seguimiento = PSA.Calendario.seguimiento(activos);
    const activosTablero = tableros.filter(tablero => !tablero.archivado &&
      proyectos.some(proyecto => proyecto.id === tablero.proyecto_id && !proyecto.archivado));

    $('dash-work-stats').innerHTML =
      _stat(activosTablero.length, 'Tableros activos') +
      _stat(activos.length, 'Tarjetas activas') +
      _stat(pendientes.length, 'Pendientes') +
      _stat(enCurso.length, 'En curso') +
      _stat(completadas.length, 'Completadas', 'var(--green)') +
      _stat(seguimiento.atrasadas.length, 'Atrasadas', 'var(--red)') +
      _stat(seguimiento.proximos7.length, 'Vencen en 7 días', 'var(--amber)') +
      _stat(otrasEtapas.length, 'En revisión, bloqueadas u otras etapas');

    $('dash-indicadores-ayuda').textContent =
      'Completadas se determina por la marca explícita de cada tarjeta. Pendientes y En curso usan la categoría funcional de la etapa, no su nombre visible. ' +
      seguimiento.proximos7.length + ' vencimiento(s) próximos incluye hoy y los seis días siguientes.';

    _renderPrioridades(activos);
    _renderVencimientos(seguimiento);
    _renderProgreso(activosTablero, activos);
    _actualizarSelectores(activosTablero);
  }

  function _renderPrioridades(tarjetas) {
    const prioritarias = tarjetas.filter(tarjeta => !tarjeta.completada &&
      ['Urgente', 'Alta'].includes(tarjeta.prioridad));
    const grupos = PRIORIDADES.slice(0, 2).map(prioridad => {
      const grupo = prioritarias.filter(tarjeta => tarjeta.prioridad === prioridad.valor);
      const filas = grupo.length
        ? grupo.map(tarjeta => _tarjetaEnlace(tarjeta, '')).join('')
        : '<li class="dashboard-empty">No hay tareas de esta prioridad.</li>';
      return `<section class="dashboard-priority-group">
        <h3><span class="dashboard-priority-label dashboard-priority-${prioridad.clase}">${prioridad.nombre}</span>
          <span class="dashboard-count">${grupo.length}</span></h3>
        <ul class="dashboard-task-list">${filas}</ul>
      </section>`;
    }).join('');
    const conteos = PRIORIDADES.map(prioridad => {
      const total = tarjetas.filter(tarjeta => tarjeta.prioridad === prioridad.valor).length;
      return `<div class="dashboard-priority-count">
        <span class="dashboard-priority-label dashboard-priority-${prioridad.clase}">${prioridad.nombre}</span>
        <strong>${total}</strong>
      </div>`;
    }).join('');
    $('dash-prioridades-conteo').innerHTML = conteos;
    $('dash-prioridades-lista').innerHTML = grupos;
  }

  function _renderVencimientos(seguimiento) {
    $('dash-vencimiento-conteo').innerHTML =
      `<div class="dashboard-due-count"><strong>${seguimiento.hoy.length}</strong><span>Vencen hoy</span></div>
       <div class="dashboard-due-count"><strong>${seguimiento.proximos7.length}</strong><span>Hoy y próximos 6 días</span></div>
       <div class="dashboard-due-count"><strong>${seguimiento.atrasadas.length}</strong><span>Atrasadas</span></div>
       <div class="dashboard-due-count"><strong>${seguimiento.sinVencimiento.length}</strong><span>Sin vencimiento</span></div>`;
    const candidatas = [...seguimiento.atrasadas, ...seguimiento.proximos7]
      .sort(_ordenarTarjetas);
    const filas = candidatas.slice(0, 10).map(tarjeta => {
      const fecha = tarjeta.vencimiento;
      const detalle = fecha < seguimiento.hoyClave
        ? 'Atrasada · ' + PSA.formatFecha(fecha)
        : fecha === seguimiento.hoyClave
          ? 'Vence hoy'
          : 'Vence ' + PSA.formatFecha(fecha);
      return _tarjetaEnlace(tarjeta, detalle);
    }).join('');
    $('dash-vencimientos-lista').innerHTML = filas ||
      '<li class="dashboard-empty">No hay tareas pendientes con vencimiento hoy, próximo o atrasado.</li>';
    $('dash-vencimientos-mas').textContent = candidatas.length > 10
      ? `Se muestran 10 de ${candidatas.length}; consulte el calendario para el resto.`
      : 'Las tareas completadas no se incluyen en el seguimiento.';
  }

  function _renderProgreso(tableros, tarjetas) {
    const filas = tableros.map(tablero => {
      const delTablero = tarjetas.filter(tarjeta => tarjeta.tablero_id === tablero.id);
      const completadas = delTablero.filter(tarjeta => !!tarjeta.completada).length;
      const pendientes = delTablero.filter(tarjeta => !tarjeta.completada &&
        tarjeta.categoria === 'pendiente').length;
      const total = delTablero.length;
      const progreso = total ? Math.round(completadas / total * 100) : null;
      return `<li class="dashboard-board-progress">
        <div class="dashboard-board-heading">
          <button type="button" class="dashboard-task-title" data-dashboard-board-id="${escape(tablero.id)}">
            ${escape(tablero.nombre)}
          </button>
          <span>${total
            ? `${completadas} completadas · ${pendientes} pendientes · ${total - completadas} abiertas`
            : 'Sin tarjetas activas'}</span>
        </div>
        ${total
          ? `<div class="bar-bg" role="progressbar" aria-label="Progreso de ${escape(tablero.nombre)}"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progreso}">
              <div class="bar-fill" style="width:${progreso}%"></div></div>
            <span class="dashboard-progress-value">${progreso}%</span>`
          : '<p class="work-meta">No hay porcentaje mientras el tablero esté vacío.</p>'}
      </li>`;
    }).join('');
    $('dash-tableros-progreso').innerHTML = filas ||
      '<li class="dashboard-empty">No hay tableros activos asociados a proyectos activos.</li>';
  }

  function _actualizarSelectores(tableros) {
    const tableroSelect = $('dash-nueva-tarjeta-tablero');
    const listaSelect = $('dash-nueva-tarjeta-lista');
    const anterior = tableroSelect.value;
    tablerosActivos = tableros;
    tableroSelect.innerHTML = '<option value="">Seleccione un tablero</option>' +
      tableros.map(tablero => `<option value="${escape(tablero.id)}">${escape(tablero.nombre)}</option>`).join('');
    const seleccionado = tableros.some(tablero => tablero.id === anterior) ? anterior : '';
    tableroSelect.value = seleccionado;
    _actualizarListas(seleccionado);
  }

  function _actualizarListas(tableroId) {
    const listaSelect = $('dash-nueva-tarjeta-lista');
    const anterior = listaSelect.value;
    const listas = tableroId
      ? PSA.Trabajo.getListas(tableroId).filter(lista => !lista.archivado)
      : [];
    listaSelect.innerHTML = '<option value="">Seleccione una etapa</option>' +
      listas.map(lista => `<option value="${escape(lista.id)}">${escape(lista.nombre)}</option>`).join('');
    listaSelect.value = listas.some(lista => lista.id === anterior) ? anterior : '';
    listaSelect.disabled = !listas.length || !PSA.DB.tieneArchivo || PSA.DB.ocupado;
    $('dash-crear-tarjeta').disabled = listaSelect.disabled;
    $('dash-nueva-tarjeta-ayuda').textContent = tableroId
      ? listas.length ? 'El título y los demás datos se completan en el editor de tarjetas existente.'
        : 'No hay etapas activas disponibles en este tablero.'
      : tablerosActivos.length
        ? 'Seleccione un tablero activo y una etapa.'
        : hayProyectosActivos
          ? 'Cree un tablero activo para agregar tarjetas.'
          : 'Cree un proyecto y luego un tablero para agregar tarjetas.';
  }

  function _renderActividad(tableros, tarjetas) {
    try {
      const eventos = PSA.Trabajo.getActividad({ limite: 6 });
      const filas = eventos.map(evento => {
        const tarjeta = tarjetas.find(fila => fila.id === evento.tarjeta_id);
        const tablero = tableros.find(fila => fila.id === evento.tablero_id);
        const titulo = evento.tarjeta_titulo || tarjeta?.titulo || 'Tarjeta no disponible';
        return `<li class="dashboard-activity-item">
          <div><strong>${escape(titulo)}</strong>
            <time datetime="${escape(evento.created_at)}">${escape(new Date(evento.created_at).toLocaleString('es-AR'))}</time></div>
          <p>${escape(PSA.Actividad.resumir(evento))}</p>
          <p class="work-meta">${escape(tablero?.nombre || 'Tablero no disponible')}</p>
          ${tarjeta ? `<button type="button" class="btn btn-ghost btn-sm"
            data-dashboard-card-id="${escape(tarjeta.id)}">Abrir tarjeta</button>` :
            tablero ? `<button type="button" class="btn btn-ghost btn-sm"
              data-dashboard-board-id="${escape(tablero.id)}">Abrir tablero</button>` : ''}
        </li>`;
      }).join('');
      $('dash-actividad-reciente').innerHTML = filas ||
        '<li class="dashboard-empty">Todavía no hay actividad registrada.</li>';
      $('dash-actividad-error').textContent = '';
    } catch (error) {
      console.error('[PSA.Dashboard] Error al consultar actividad reciente:', error);
      $('dash-actividad-reciente').innerHTML = '';
      $('dash-actividad-error').textContent = 'No se pudo consultar la actividad reciente: ' + error.message;
    }
  }

  function _estadoNoDisponible(mensaje) {
    $('dash-no-disponible').textContent = mensaje;
    $('dash-no-disponible').classList.remove('hidden');
    $('dash-data').classList.add('hidden');
    $('dash-error').classList.add('hidden');
    _actualizarEstadoAccesos();
  }

  function _actualizarEstadoAccesos() {
    const disponible = datosDisponibles && PSA.DB.tieneArchivo && !PSA.DB.ocupado;
    $('dash-crear-tablero').disabled = !disponible || !hayProyectosActivos;
    $('dash-nueva-tarjeta-tablero').disabled = !disponible || !tablerosActivos.length;
    if (!disponible) {
      $('dash-nueva-tarjeta-lista').disabled = true;
      $('dash-crear-tarjeta').disabled = true;
      $('dash-quick-status').textContent = '';
    } else if (!hayProyectosActivos) {
      $('dash-quick-status').textContent = 'No hay proyectos activos. Cree un proyecto antes de crear un tablero.';
    } else if ($('dash-quick-status').textContent.startsWith('No hay proyectos activos.')) {
      $('dash-quick-status').textContent = '';
    }
  }

  function _ir(viewId) {
    PSA.cambiarTab(viewId, viewId);
    $(viewId)?.focus();
  }

  function _accion(event) {
    const boton = event.target.closest('button');
    if (!boton) return;
    try {
      if (boton.dataset.dashboardView) {
        _ir(boton.dataset.dashboardView);
      } else if (boton.id === 'dash-crear-proyecto') {
        _ir('v-proyectos');
        $('p-nombre').focus();
      } else if (boton.id === 'dash-crear-tablero') {
        if (!PSA.Tableros.crearTablero()) {
          _ir('v-tableros');
          $('tableros-proyecto').focus();
        }
      } else if (boton.id === 'dash-crear-tarjeta') {
        const listaId = $('dash-nueva-tarjeta-lista').value;
        if (!listaId) {
          $('dash-quick-status').textContent = 'Seleccione un tablero y una etapa para crear la tarjeta.';
          $('dash-nueva-tarjeta-tablero').focus();
          return;
        }
        PSA.Tableros.crearTarjetaEnLista(listaId);
      } else if (boton.dataset.dashboardCardId) {
        PSA.Tableros.abrirTarjeta(boton.dataset.dashboardCardId);
      } else if (boton.dataset.dashboardBoardId) {
        PSA.Tableros.abrirTablero(boton.dataset.dashboardBoardId);
      } else if (boton.dataset.dashboardScroll) {
        const destino = $(boton.dataset.dashboardScroll);
        destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
        destino.setAttribute('tabindex', '-1');
        destino.focus();
      }
      $('dash-quick-status').textContent = '';
    } catch (error) {
      console.error('[PSA.Dashboard] No se pudo completar el acceso rápido:', error);
      $('dash-quick-status').textContent = 'No se pudo completar la acción: ' + error.message;
    }
  }

  function render() {
    if (!$('dash-data')) return;
    if (!PSA.DB.tieneArchivo) {
      datosDisponibles = false;
      _estadoNoDisponible('Conecte una base de datos para consultar los indicadores reales.');
      return;
    }
    try {
      const proyectos = PSA.DB.getProyectos();
      const tableros = PSA.Trabajo.getTableros();
      const tarjetas = PSA.Trabajo.getTarjetas();
      hayProyectosActivos = proyectos.some(proyecto => !proyecto.archivado);
      _estadisticasProyectos(proyectos);
      _renderMetricas(tableros, tarjetas, proyectos);
      _renderActividad(tableros, tarjetas);
      $('dash-no-disponible').classList.add('hidden');
      $('dash-error').classList.add('hidden');
      $('dash-data').classList.remove('hidden');
      datosDisponibles = true;
      _actualizarEstadoAccesos();
    } catch (error) {
      console.error('[PSA.Dashboard] Error al consultar el panel:', error);
      datosDisponibles = false;
      $('dash-error').textContent = 'No se pudieron consultar los indicadores: ' + error.message;
      $('dash-error').classList.remove('hidden');
      $('dash-no-disponible').classList.add('hidden');
      $('dash-data').classList.add('hidden');
      _actualizarEstadoAccesos();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('dash-crear-tablero').addEventListener('click', _accion);
    $('dash-crear-proyecto').addEventListener('click', _accion);
    $('dash-crear-tarjeta').addEventListener('click', _accion);
    $('v-dashboard').addEventListener('click', _accion);
    $('dash-nueva-tarjeta-tablero').addEventListener('change', () =>
      _actualizarListas($('dash-nueva-tarjeta-tablero').value));
    window.addEventListener('psa:db-state', _actualizarEstadoAccesos);
    render();
  });

  window.PSA = window.PSA || {};
  window.PSA.Dashboard = { render };
})();
