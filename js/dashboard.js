/* ============================================================
   js/dashboard.js  — Módulo de Panel General (métricas)
   Depende de:  PSA.DB  (js/db.js)
                PSA.escapeHtml  (js/app.js)
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

  /** Genera una card de estadística HTML. */
  function _stat(num, lbl, color) {
    return `<div class="stat">
      <div class="num" style="${color ? 'color:' + color : ''}">${num}</div>
      <div class="lbl">${lbl}</div>
    </div>`;
  }

  /** Genera una barra de progreso con etiqueta. */
  function _barra(label, pct, colorFill) {
    return `<div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">${label}</div>
      <div class="bar-bg" style="height:16px;">
        <div class="bar-fill" style="width:${pct}%;${colorFill ? 'background:' + colorFill : ''}"></div>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--navy);margin-top:4px;">${pct}%</div>
    </div>`;
  }

  /** Renderiza todo el panel de control. */
  function render() {
    const proyectos = PSA.DB.getProyectos();
    const total = proyectos.length;

    /* ── Conteos por estado ── */
    const porEstado = { 'En curso': 0, 'Completado': 0, 'Demorado': 0, 'Suspendido': 0 };
    proyectos.forEach(p => {
      if (p.estado in porEstado) porEstado[p.estado]++;
    });

    /* ── Avance promedio ── */
    const avgAvance = total > 0
      ? Math.round(proyectos.reduce((s, p) => s + (p.avance || 0), 0) / total)
      : 0;

    /* ── Cumplimiento ── */
    const evaluables    = proyectos.filter(p => p.cumplimiento !== 'En curso (pendiente de evaluar)').length;
    const enTermino     = proyectos.filter(p => p.cumplimiento === 'Cumplido en término').length;
    const pctEnTermino  = evaluables > 0 ? Math.round((enTermino / evaluables) * 100) : 0;

    /* ── Distribución por implementación ── */
    const porImpl = {};
    IMPL_ORDEN.forEach(k => { porImpl[k] = 0; });
    proyectos.forEach(p => {
      const k = p.implementacion || 'No iniciado';
      porImpl[k] = (porImpl[k] || 0) + 1;
    });

    /* ── Renderizar: bloque de estado ── */
    const elEstado = document.getElementById('dash-estado');
    if (elEstado) {
      elEstado.innerHTML =
        _stat(total,                   'Proyectos totales') +
        _stat(porEstado['En curso'],   'En curso',    'var(--navy)') +
        _stat(porEstado['Completado'], 'Completados', 'var(--green)') +
        _stat(porEstado['Demorado'],   'Demorados',   'var(--amber)') ;
    }

    /* ── Renderizar: barras de métricas globales ── */
    const elBarras = document.getElementById('dash-barras');
    if (elBarras) {
      elBarras.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px;">
        ${_barra('Proyectos cumplidos en término (sobre evaluables)', pctEnTermino)}
        ${_barra('Avance promedio de todos los proyectos', avgAvance, 'var(--navy2)')}
      </div>`;
    }

    /* ── Renderizar: bloque de cumplimiento extra ── */
    const elCumpl = document.getElementById('dash-cumplimiento');
    if (elCumpl) {
      const demora   = proyectos.filter(p => p.cumplimiento === 'Cumplido con demora').length;
      const parcial  = proyectos.filter(p => p.cumplimiento === 'Parcialmente cumplido').length;
      const noCumpl  = proyectos.filter(p => p.cumplimiento === 'No cumplido').length;
      const pendEval = proyectos.filter(p => p.cumplimiento === 'En curso (pendiente de evaluar)').length;
      elCumpl.innerHTML =
        _stat(enTermino,  'En término',        'var(--green)') +
        _stat(demora,     'Con demora',         'var(--amber)') +
        _stat(parcial,    'Parcialmente',       '#a06b1a') +
        _stat(noCumpl,    'No cumplidos',       'var(--red)') +
        _stat(pendEval,   'Pendientes de eval.','var(--muted)');
    }

    /* ── Renderizar: implementación ── */
    const elImpl = document.getElementById('dash-implementacion');
    if (elImpl) {
      elImpl.innerHTML = IMPL_ORDEN.map(k =>
        _stat(porImpl[k] || 0, PSA.escapeHtml(k))
      ).join('');
    }

    /* ── Renderizar: tabla de suspendidos (alerta) ── */
    const elSusp = document.getElementById('dash-suspendidos');
    if (elSusp) {
      const suspendidos = proyectos.filter(p => p.estado === 'Suspendido');
      if (suspendidos.length === 0) {
        elSusp.classList.add('hidden');
      } else {
        elSusp.classList.remove('hidden');
        const filas = suspendidos.map(p =>
          `<tr><td><strong>${PSA.escapeHtml(p.nombre)}</strong></td>
               <td>${PSA.escapeHtml(p.responsable)}</td>
               <td>${PSA.escapeHtml(p.observaciones || '—')}</td></tr>`
        ).join('');
        elSusp.querySelector('tbody').innerHTML = filas;
      }
    }
  }

  /* ── Exponer API ── */
  window.PSA = window.PSA || {};
  window.PSA.Dashboard = { render };

})();
