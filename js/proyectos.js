/* ============================================================
   js/proyectos.js  — Módulo CRUD y renderizado de proyectos
   Depende de:  PSA.DB  (js/db.js)
                PSA.escapeHtml, PSA.formatFecha, PSA.genId,
                PSA.toast, PSA.renderTodo  (js/app.js)
   ============================================================ */
'use strict';

(function () {

  /* ── Mapas de clases CSS para tags ── */
  const CLASE_ESTADO = {
    'En curso':    'est-curso',
    'Completado':  'est-completado',
    'Demorado':    'est-demorado',
    'Suspendido':  'est-suspendido'
  };
  const CLASE_CUMPL = {
    'Cumplido en término':             'cum-termino',
    'Cumplido con demora':             'cum-demora',
    'Parcialmente cumplido':           'cum-parcial',
    'No cumplido':                     'cum-no',
    'En curso (pendiente de evaluar)': 'cum-curso'
  };
  const CLASE_IMPL = {
    'No iniciado':                'imp-no',
    'Piloto / Prueba':            'imp-piloto',
    'Implementación parcial':     'imp-parcial',
    'Implementación completa':    'imp-completa',
    'En producción / uso regular':'imp-produccion',
    'Discontinuado':              'imp-discontinuado'
  };

  /* ── Estado del módulo ── */
  let editandoId = null;   // id del proyecto en edición, null si nuevo

  /* ─────────────────────────────────────────
     Helpers internos
     ───────────────────────────────────────── */
  function _val(id) { return document.getElementById(id).value; }
  function _setVal(id, v) { document.getElementById(id).value = v || ''; }
  function _setIdx(id, i) { document.getElementById(id).selectedIndex = i; }

  function _leerFormulario() {
    let avance = parseInt(_val('p-avance'), 10);
    if (isNaN(avance)) avance = 0;
    avance = Math.max(0, Math.min(100, avance));
    return {
      id:             editandoId || PSA.genId(),
      nombre:         _val('p-nombre').trim(),
      responsable:    _val('p-responsable').trim(),
      division:       _val('p-division').trim(),
      inicio:         _val('p-inicio'),
      meta:           _val('p-meta'),
      fin:            _val('p-fin'),
      estado:         _val('p-estado'),
      avance,
      implementacion: _val('p-implementacion'),
      cumplimiento:   _val('p-cumplimiento'),
      objetivo:       _val('p-objetivo').trim(),
      resultado:      _val('p-resultado').trim(),
      observaciones:  _val('p-observaciones').trim()
    };
  }

  /* ─────────────────────────────────────────
     API pública
     ───────────────────────────────────────── */

  /** Vacía el formulario y cancela cualquier edición en curso. */
  function limpiarForm() {
    [
      'p-nombre', 'p-responsable', 'p-division',
      'p-inicio', 'p-meta', 'p-fin',
      'p-objetivo', 'p-resultado', 'p-observaciones'
    ].forEach(id => _setVal(id, ''));
    _setIdx('p-estado', 0);
    _setIdx('p-implementacion', 0);
    _setIdx('p-cumplimiento', 0);
    _setVal('p-avance', '0');
    editandoId = null;
    _actualizarIndicadorEdicion();
  }

  /** Muestra/oculta el banner que indica que se está editando. */
  function _actualizarIndicadorEdicion() {
    const el = document.getElementById('edit-indicator');
    if (!el) return;
    if (editandoId) {
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  /** Guarda el proyecto (crea o actualiza). */
  async function guardarProyecto() {
    if (PSA.DB.ocupado) return;
    const p = _leerFormulario();

    if (!p.nombre)      { PSA.toast('El nombre del proyecto es obligatorio.', 'error'); return; }
    if (!p.responsable) { PSA.toast('El responsable es obligatorio.', 'error'); return; }
    if (!p.inicio)      { PSA.toast('La fecha de inicio es obligatoria.', 'error'); return; }

    const esNuevo = !editandoId;
    try {
      await PSA.DB.saveProyecto(p, esNuevo);
    } catch (e) {
      PSA.toast('No se guardó el proyecto: ' + e.message, 'error');
      return;
    }

    limpiarForm();
    PSA.renderTodo();
    PSA.toast(esNuevo ? 'Proyecto guardado correctamente.' : 'Proyecto actualizado correctamente.');
  }

  /** Carga un proyecto en el formulario para editarlo. */
  function editarProyecto(id) {
    const lista = PSA.DB.getProyectos();
    const p = lista.find(x => x.id === id);
    if (!p) return;

    _setVal('p-nombre',         p.nombre);
    _setVal('p-responsable',    p.responsable);
    _setVal('p-division',       p.division);
    _setVal('p-inicio',         p.inicio);
    _setVal('p-meta',           p.meta);
    _setVal('p-fin',            p.fin);
    _setVal('p-estado',         p.estado);
    _setVal('p-avance',         p.avance);
    _setVal('p-implementacion', p.implementacion || 'No iniciado');
    _setVal('p-cumplimiento',   p.cumplimiento);
    _setVal('p-objetivo',       p.objetivo);
    _setVal('p-resultado',      p.resultado);
    _setVal('p-observaciones',  p.observaciones);

    editandoId = id;
    _actualizarIndicadorEdicion();

    // Cambiar a la pestaña de proyectos y hacer scroll al form
    PSA.cambiarTab('v-proyectos', 'v-proyectos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('p-nombre').focus();
    PSA.toast('Modo edición activo. Presione Esc para cancelar.');
  }

  /** Elimina un proyecto tras confirmación. */
  async function eliminarProyecto(id) {
    if (PSA.DB.ocupado) return;
    if (!confirm('¿Eliminar este proyecto? Esta acción no se puede deshacer.')) return;
    try {
      await PSA.DB.deleteProyecto(id);
    } catch (e) {
      PSA.toast('No se eliminó el proyecto: ' + e.message, 'error');
      return;
    }
    if (editandoId === id) limpiarForm();
    PSA.renderTodo();
    PSA.toast('Proyecto eliminado.');
  }

  /** Limpia los filtros de la tabla. */
  function limpiarFiltros() {
    _setVal('filtro-p-texto', '');
    _setIdx('filtro-p-estado', 0);
    _setIdx('filtro-p-implementacion', 0);
    renderTabla();
  }

  /** Aplica los filtros activos y devuelve el subconjunto de proyectos. */
  function _filtrar() {
    const texto  = _val('filtro-p-texto').toLowerCase();
    const estado = _val('filtro-p-estado');
    const impl   = _val('filtro-p-implementacion');

    return PSA.DB.getProyectos().filter(p => {
      if (texto && !(
        (p.nombre       || '').toLowerCase().includes(texto) ||
        (p.responsable  || '').toLowerCase().includes(texto) ||
        (p.division     || '').toLowerCase().includes(texto)
      )) return false;
      if (estado && p.estado         !== estado) return false;
      if (impl   && p.implementacion !== impl)   return false;
      return true;
    });
  }

  /** Renderiza la tabla de proyectos. */
  function renderTabla() {
    const datos = _filtrar();
    const body  = document.getElementById('tabla-proyectos-body');
    const empty = document.getElementById('tabla-proyectos-empty');
    const cont  = document.getElementById('tabla-count');

    body.innerHTML = '';
    if (cont) cont.textContent = datos.length + ' proyecto' + (datos.length !== 1 ? 's' : '');

    if (datos.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    const e = PSA.escapeHtml;
    const f = PSA.formatFecha;

    datos.forEach(p => {
      const avance = p.avance || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${e(p.nombre)}</strong>
          ${p.division ? `<br><span style="color:var(--muted);font-size:11px;">${e(p.division)}</span>` : ''}
        </td>
        <td>${e(p.responsable)}</td>
        <td style="white-space:nowrap;">${f(p.inicio)}</td>
        <td style="white-space:nowrap;">${f(p.meta)}</td>
        <td style="white-space:nowrap;">${f(p.fin)}</td>
        <td><span class="tag ${CLASE_ESTADO[p.estado] || ''}">${e(p.estado)}</span></td>
        <td style="min-width:90px;">
          <div class="bar-bg"><div class="bar-fill" style="width:${avance}%;"></div></div>
          <div style="font-size:11px;margin-top:2px;">${avance}%</div>
        </td>
        <td><span class="tag ${CLASE_IMPL[p.implementacion] || 'imp-no'}">${e(p.implementacion || 'No iniciado')}</span></td>
        <td><span class="tag ${CLASE_CUMPL[p.cumplimiento] || ''}">${e(p.cumplimiento)}</span></td>
        <td style="max-width:180px;font-size:11.5px;">${e(p.objetivo)}</td>
        <td style="max-width:160px;font-size:11.5px;">${e(p.resultado)}</td>
        <td class="row-actions no-print" style="white-space:nowrap;">
        </td>`;
      const acciones = tr.querySelector('.row-actions');
      [
        ['Editar', 'btn-ghost', () => editarProyecto(p.id)],
        ['Tableros', 'btn-ghost', () => PSA.Tableros.abrirProyecto(p.id)],
        ['Eliminar', 'btn-danger', () => eliminarProyecto(p.id)]
      ].forEach(([texto, clase, accion]) => {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'btn btn-sm ' + clase;
        boton.textContent = texto;
        boton.addEventListener('click', accion);
        acciones.appendChild(boton);
      });
      body.appendChild(tr);
    });
  }

  /** Exporta los proyectos filtrados como archivo CSV. */
  function exportarCSV() {
    const datos = _filtrar();
    if (datos.length === 0) { PSA.toast('No hay datos para exportar.', 'error'); return; }

    const cabeceras = [
      'Proyecto','Responsable','División',
      'Inicio','Meta','Fin real',
      'Estado','Avance %','Nivel de implementación',
      'Cumplimiento','Objetivo','Resultado','Observaciones'
    ];
    const f = PSA.formatFecha;
    const filas = datos.map(p => [
      p.nombre, p.responsable, p.division,
      f(p.inicio), f(p.meta), f(p.fin),
      p.estado, p.avance, p.implementacion,
      p.cumplimiento, p.objetivo, p.resultado, p.observaciones
    ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));

    const csv = '\uFEFF' + [cabeceras.join(','), ...filas].join('\n');
    _descargar(csv, 'proyectos_ursa1este.csv', 'text/csv;charset=utf-8;');
    PSA.toast('CSV exportado correctamente.');
  }

  /** Exporta la base de datos SQLite como archivo .db. */
  function exportarDB() {
    const data = PSA.DB.exportarDB();
    if (!data) {
      PSA.toast('La exportación SQLite solo está disponible cuando sql.js está activo.', 'error');
      return;
    }
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'vertex.db'; a.click();
    URL.revokeObjectURL(url);
    PSA.toast('Base de datos exportada como vertex.db');
  }

  /** Helper de descarga genérico. */
  function _descargar(contenido, nombre, tipo) {
    const blob = new Blob([contenido], { type: tipo });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Exponer API ── */
  window.PSA = window.PSA || {};
  window.PSA.Proyectos = {
    limpiarForm,
    guardarProyecto,
    editarProyecto,
    eliminarProyecto,
    limpiarFiltros,
    renderTabla,
    exportarCSV,
    exportarDB,
    get editandoId() { return editandoId; }
  };

})();
