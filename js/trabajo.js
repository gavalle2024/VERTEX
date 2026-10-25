'use strict';

(function () {
  const PSA = window.PSA;
  const PRIORIDADES = ['Crítica', 'Alta', 'Media', 'Baja'];
  const PRIORIDAD_URGENTE = 'Urgente';
  const CATEGORIAS = ['pendiente', 'en_curso', 'en_revision', 'bloqueado', 'completado'];
  const LISTAS_INICIALES = ['Pendiente', 'En curso', 'En revisión', 'Bloqueado', 'Completado'];
  const AHORA = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

  function _texto(valor, campo, limite, obligatorio = false) {
    if (typeof valor !== 'string' || valor.length > limite || (obligatorio && !valor.trim())) {
      throw new Error('Revise el campo ' + campo + (obligatorio ? ': es obligatorio' : '') + '.');
    }
    return valor.trim();
  }

  function _opcion(valor, opciones, campo) {
    if (!opciones.includes(valor)) throw new Error('Valor inválido en ' + campo + '.');
    return valor;
  }

  function _claveNombre(valor) {
    return valor.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  }

  function _nombreUnico(tx, tabla, nombre, id) {
    const clave = _claveNombre(nombre);
    if (tx.all(`SELECT id,nombre FROM ${tabla}`).some(fila =>
      fila.id !== id && _claveNombre(fila.nombre) === clave)) {
      throw new Error('Ya existe un registro con ese nombre.');
    }
  }

  function _nombreCatalogo(valor, campo, limite) {
    return _texto(valor, campo, limite, true).replace(/\s+/g, ' ');
  }

  function _idsTarjeta(tx, tabla, columna, tarjetaId) {
    return tx.all(`SELECT ${columna} AS id FROM ${tabla} WHERE tarjeta_id=?`, [tarjetaId]).map(fila => fila.id);
  }

  function _validarAsignaciones(tx, ids, tabla, asociacion, tarjetaId, existentes, tipo) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
      throw new Error('La selección de ' + tipo + ' no es válida.');
    }
    const unicos = Array.from(new Set(ids));
    for (const id of unicos) {
      const fila = _registro(tx, tabla, id);
      if (fila.archivado && !existentes.includes(id)) {
        throw new Error('No se pueden asignar ' + tipo + (tipo === 'etiquetas' ? ' inactivas' : ' inactivos') + ' a una tarjeta.');
      }
    }
    tx.run(`DELETE FROM ${asociacion} WHERE tarjeta_id=?`, [tarjetaId]);
    return unicos;
  }

  function _fecha(valor) {
    if (valor === '') return valor;
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      throw new Error('La fecha debe usar el formato AAAA-MM-DD.');
    }
    const [anio, mes, dia] = valor.split('-').map(Number);
    const fecha = new Date(anio, mes - 1, dia);
    if (anio < 1000 || fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
      throw new Error('La fecha no es válida.');
    }
    return valor;
  }

  function _registro(tx, tabla, id) {
    const fila = tx.all(`SELECT * FROM ${tabla} WHERE id=?`, [id])[0];
    if (!fila) throw new Error('El registro solicitado ya no existe.');
    return fila;
  }

  function _activo(fila, campo = 'archivado') {
    if (fila[campo]) throw new Error('El elemento o su contenedor está archivado. Restáurelo primero.');
    return fila;
  }

  function _tablero(tx, id, activo = true) {
    const tablero = _registro(tx, 'tableros', id);
    const proyecto = _registro(tx, 'proyectos', tablero.proyecto_id);
    if (activo) { _activo(tablero); _activo(proyecto); }
    return tablero;
  }

  function _lista(tx, id, activo = true) {
    const lista = _registro(tx, 'listas', id);
    _tablero(tx, lista.tablero_id, activo);
    if (activo) _activo(lista);
    return lista;
  }

  function _contexto(tx, tabla, fila) {
    if (tabla === 'tableros') return { proyecto_id: fila.proyecto_id, tablero_id: fila.id };
    if (tabla === 'listas') {
      const tablero = _tablero(tx, fila.tablero_id, false);
      return { proyecto_id: tablero.proyecto_id, tablero_id: tablero.id };
    }
    if (tabla === 'tarjetas') {
      const lista = _lista(tx, fila.lista_id, false);
      const tablero = _tablero(tx, lista.tablero_id, false);
      return { proyecto_id: tablero.proyecto_id, tablero_id: tablero.id, tarjeta_id: fila.id };
    }
    return {};
  }

  function _evento(tx, contexto, tipo, detalle) {
    tx.run('INSERT INTO actividad (proyecto_id,tablero_id,tarjeta_id,tipo,detalle) VALUES (?,?,?,?,?)',
      [contexto.proyecto_id || null, contexto.tablero_id || null, contexto.tarjeta_id || null, tipo, detalle]);
  }

  function _responsable(tx, id, anteriorId) {
    if (id) {
      const responsable = _registro(tx, 'responsables', id);
      if (id !== anteriorId) _activo(responsable);
    }
    return id || null;
  }

  function _guardar(tx, tabla, entrada, campos, preparar) {
    const anterior = entrada.id ? _registro(tx, tabla, entrada.id) : null;
    const fila = preparar({ ...anterior, ...entrada }, anterior);
    fila.id = anterior ? anterior.id : PSA.genId();
    if (anterior) {
      tx.run(`UPDATE ${tabla} SET ${campos.map(c => c + '=?').join(',')},updated_at=${AHORA} WHERE id=?`,
        [...campos.map(c => fila[c]), fila.id]);
    } else {
      tx.run(`INSERT INTO ${tabla} (id,${campos.join(',')}) VALUES (${['id', ...campos].map(() => '?').join(',')})`,
        [fila.id, ...campos.map(c => fila[c])]);
    }
    return { fila, anterior };
  }

  function guardarResponsable(entrada) {
    return PSA.DB.transaccion(tx => {
      const { fila, anterior } = _guardar(tx, 'responsables', entrada, ['nombre'], p => ({
        nombre: _nombreCatalogo(p.nombre, 'nombre', 120)
      }));
      _nombreUnico(tx, 'responsables', fila.nombre, fila.id);
      if (anterior && anterior.nombre !== fila.nombre) {
        tx.run(`UPDATE proyectos SET responsable=?,updated_at=${AHORA} WHERE responsable_id=?`, [fila.nombre, fila.id]);
      }
      _evento(tx, {}, anterior ? 'responsable_modificado' : 'responsable_creado', fila.nombre);
      return fila.id;
    });
  }

  function asignarResponsableProyecto(proyectoId, responsableId) {
    return PSA.DB.transaccion(tx => {
      const proyecto = _activo(_registro(tx, 'proyectos', proyectoId));
      const id = _responsable(tx, responsableId, proyecto.responsable_id);
      const nombre = id ? _registro(tx, 'responsables', id).nombre : proyecto.responsable;
      tx.run(`UPDATE proyectos SET responsable_id=?,responsable=?,updated_at=${AHORA} WHERE id=?`,
        [id, nombre, proyectoId]);
      _evento(tx, { proyecto_id: proyectoId }, 'responsable_cambiado',
        JSON.stringify({ anterior: proyecto.responsable, actual: nombre, responsable_id: id }));
      return proyectoId;
    });
  }

  function guardarTablero(entrada) {
    return PSA.DB.transaccion(tx => {
      const { fila, anterior } = _guardar(tx, 'tableros', entrada,
        ['proyecto_id', 'nombre', 'descripcion'], (p, previo) => {
          if (previo && p.proyecto_id !== previo.proyecto_id) throw new Error('No se puede trasladar un tablero a otro proyecto.');
          _activo(_registro(tx, 'proyectos', p.proyecto_id));
          if (previo) _activo(previo);
          return {
            proyecto_id: p.proyecto_id,
            nombre: _texto(p.nombre, 'nombre', 200, true),
            descripcion: _texto(p.descripcion ?? '', 'descripción', 10000)
          };
        });
      const contexto = _contexto(tx, 'tableros', fila);
      if (!anterior) {
        LISTAS_INICIALES.forEach((nombre, posicion) => {
          tx.run('INSERT INTO listas (id,tablero_id,nombre,categoria,posicion) VALUES (?,?,?,?,?)',
            [PSA.genId(), fila.id, nombre, CATEGORIAS[posicion], posicion]);
        });
      }
      _evento(tx, contexto, anterior ? 'tablero_modificado' : 'tablero_creado', fila.nombre);
      return fila.id;
    });
  }

  function guardarLista(entrada) {
    return PSA.DB.transaccion(tx => {
      const { fila, anterior } = _guardar(tx, 'listas', entrada,
        ['tablero_id', 'nombre', 'categoria', 'posicion'], (p, previo) => {
          _tablero(tx, p.tablero_id);
          if (previo) {
            _activo(previo);
            if (p.tablero_id !== previo.tablero_id) throw new Error('No se puede trasladar una lista a otro tablero.');
            if (p.categoria !== previo.categoria) {
              const cantidad = tx.all('SELECT count(*) AS n FROM tarjetas WHERE lista_id=?', [previo.id])[0].n;
              if (cantidad) throw new Error('No se puede cambiar la categoría de una lista con tarjetas; cree otra lista y muévalas explícitamente.');
            }
          }
          return {
            tablero_id: p.tablero_id,
            nombre: _texto(p.nombre, 'nombre', 120, true),
            categoria: _opcion(p.categoria ?? 'pendiente', CATEGORIAS, 'categoría'),
            posicion: previo ? previo.posicion : tx.all(
              'SELECT coalesce(max(posicion),-1)+1 AS posicion FROM listas WHERE tablero_id=?', [p.tablero_id])[0].posicion
          };
        });
      _evento(tx, _contexto(tx, 'listas', fila), anterior ? 'lista_modificada' : 'lista_creada', fila.nombre);
      return fila.id;
    });
  }

  function guardarEtiqueta(entrada) {
    return PSA.DB.transaccion(tx => {
      const { fila, anterior } = _guardar(tx, 'etiquetas', entrada, ['nombre', 'color'], p => {
        if (typeof p.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.color)) {
          throw new Error('El color debe ser hexadecimal de seis dígitos.');
        }
        return { nombre: _nombreCatalogo(p.nombre, 'nombre', 60), color: p.color.toLowerCase() };
      });
      _nombreUnico(tx, 'etiquetas', fila.nombre, fila.id);
      _evento(tx, {}, anterior ? 'etiqueta_modificada' : 'etiqueta_creada', fila.nombre);
      return fila.id;
    });
  }

  function guardarTarjeta(entrada) {
    return PSA.DB.transaccion(tx => {
      const campos = ['lista_id', 'titulo', 'descripcion', 'responsable_id', 'prioridad', 'inicio',
        'vencimiento', 'observaciones', 'completada', 'posicion'];
      const { fila, anterior } = _guardar(tx, 'tarjetas', entrada, campos, (p, previo) => {
        const lista = _lista(tx, p.lista_id);
        if (previo) {
          _activo(previo, 'archivada');
          if (previo.lista_id !== p.lista_id) throw new Error('Use la operación de movimiento para cambiar de lista.');
        }
        const inicio = _fecha(p.inicio ?? '');
        const vencimiento = _fecha(p.vencimiento ?? '');
        if (inicio && vencimiento && inicio > vencimiento) throw new Error('El inicio no puede ser posterior al vencimiento.');
        const completada = p.completada ?? (lista.categoria === 'completado' ? 1 : 0);
        if (![0, 1].includes(completada)) throw new Error('El estado de completitud debe ser 0 o 1.');
        let responsableId;
        if (Object.hasOwn(entrada, 'responsables')) {
          if (!Array.isArray(entrada.responsables) || entrada.responsables.some(id => typeof id !== 'string')) {
            throw new Error('La selección de responsables no es válida.');
          }
          const anteriores = previo ? _idsTarjeta(tx, 'tarjeta_responsables', 'responsable_id', previo.id) : [];
          const unicos = Array.from(new Set(entrada.responsables));
          for (const id of unicos) {
            const responsable = _registro(tx, 'responsables', id);
            if (responsable.archivado && !anteriores.includes(id)) {
              throw new Error('No se pueden asignar responsables inactivos a una tarjeta.');
            }
          }
          responsableId = unicos[0] || null;
        } else {
          responsableId = _responsable(tx, p.responsable_id, previo && previo.responsable_id);
        }
        const prioridadSolicitada = p.prioridad ?? 'Media';
        const prioridad = prioridadSolicitada === 'Crítica' ? PRIORIDAD_URGENTE : prioridadSolicitada;
        if (prioridad !== PRIORIDAD_URGENTE && !PRIORIDADES.includes(prioridad)) {
          throw new Error('Valor inválido en prioridad.');
        }
        return {
          lista_id: lista.id, titulo: _texto(p.titulo, 'título', 200, true),
          descripcion: _texto(p.descripcion ?? '', 'descripción', 10000),
          responsable_id: responsableId,
          prioridad,
          inicio, vencimiento, observaciones: _texto(p.observaciones ?? '', 'observaciones', 10000),
          completada,
          posicion: previo ? previo.posicion : tx.all(
            'SELECT coalesce(max(posicion),-1)+1 AS posicion FROM tarjetas WHERE lista_id=?', [lista.id])[0].posicion
        };
      });
      const contexto = _contexto(tx, 'tarjetas', fila);
      if (Object.hasOwn(entrada, 'responsables')) {
        const anteriores = anterior ? _idsTarjeta(tx, 'tarjeta_responsables', 'responsable_id', fila.id) : [];
        const responsables = _validarAsignaciones(tx, entrada.responsables, 'responsables',
          'tarjeta_responsables', fila.id, anteriores, 'responsables');
        for (const id of responsables) {
          tx.run('INSERT INTO tarjeta_responsables (tarjeta_id,responsable_id) VALUES (?,?)', [fila.id, id]);
        }
      } else if (Object.hasOwn(entrada, 'responsable_id')) {
        const responsables = fila.responsable_id ? [fila.responsable_id] : [];
        const anteriores = anterior ? _idsTarjeta(tx, 'tarjeta_responsables', 'responsable_id', fila.id) : [];
        const validos = _validarAsignaciones(tx, responsables, 'responsables',
          'tarjeta_responsables', fila.id, anteriores, 'responsables');
        for (const id of validos) {
          tx.run('INSERT INTO tarjeta_responsables (tarjeta_id,responsable_id) VALUES (?,?)', [fila.id, id]);
        }
      }
      if (Object.hasOwn(entrada, 'etiquetas')) {
        const anteriores = anterior ? _idsTarjeta(tx, 'tarjeta_etiquetas', 'etiqueta_id', fila.id) : [];
        const etiquetas = _validarAsignaciones(tx, entrada.etiquetas, 'etiquetas',
          'tarjeta_etiquetas', fila.id, anteriores, 'etiquetas');
        for (const id of etiquetas) {
          tx.run('INSERT INTO tarjeta_etiquetas (tarjeta_id,etiqueta_id) VALUES (?,?)', [fila.id, id]);
        }
      }
      _evento(tx, contexto, anterior ? 'tarjeta_modificada' : 'tarjeta_creada', fila.titulo);
      if (anterior) {
        for (const [campo, tipo] of [['responsable_id', 'responsable_cambiado'], ['prioridad', 'prioridad_cambiada'],
          ['vencimiento', 'vencimiento_cambiado'], ['completada', fila.completada ? 'tarea_completada' : 'tarea_reabierta']]) {
          if (anterior[campo] !== fila[campo]) {
            _evento(tx, contexto, tipo, JSON.stringify({ anterior: anterior[campo], actual: fila[campo] }));
          }
        }
      }
      return fila.id;
    });
  }

  function archivar(tipo, id, valor) {
    const tablas = { proyecto: 'proyectos', tablero: 'tableros', lista: 'listas', tarjeta: 'tarjetas', responsable: 'responsables', etiqueta: 'etiquetas' };
    if (!Object.hasOwn(tablas, tipo)) throw new Error('Tipo de elemento inválido.');
    if (typeof valor !== 'boolean') throw new Error('El estado de archivo no es válido.');
    const tabla = tablas[tipo];
    const campo = tipo === 'tarjeta' ? 'archivada' : 'archivado';
    return PSA.DB.transaccion(tx => {
      const fila = _registro(tx, tabla, id);
      if (fila[campo] === Number(valor)) return id;
      if (!valor && tipo === 'tablero') _activo(_registro(tx, 'proyectos', fila.proyecto_id));
      if (!valor && tipo === 'lista') _tablero(tx, fila.tablero_id);
      if (!valor && tipo === 'tarjeta') _lista(tx, fila.lista_id);
      tx.run(`UPDATE ${tabla} SET ${campo}=?,updated_at=${AHORA} WHERE id=?`, [Number(valor), id]);
      const contexto = tipo === 'proyecto' ? { proyecto_id: id } : _contexto(tx, tabla, fila);
      _evento(tx, contexto, tipo + (valor ? '_archivado' : '_restaurado'), fila.nombre || fila.titulo);
      return id;
    });
  }

  function _ordenar(tx, tabla, ids) {
    ids.forEach((id, posicion) => tx.run(`UPDATE ${tabla} SET posicion=?,updated_at=${AHORA} WHERE id=?`, [posicion, id]));
  }

  function reordenarListas(tableroId, ids) {
    return PSA.DB.transaccion(tx => {
      const tablero = _tablero(tx, tableroId);
      const existentes = tx.all('SELECT id FROM listas WHERE tablero_id=? AND archivado=0 ORDER BY posicion,id', [tableroId]);
      if (!Array.isArray(ids) || ids.length !== existentes.length || new Set(ids).size !== ids.length ||
          ids.some(id => !existentes.some(fila => fila.id === id))) {
        throw new Error('El orden debe incluir cada lista activa del tablero una sola vez.');
      }
      _ordenar(tx, 'listas', ids);
      _evento(tx, { proyecto_id: tablero.proyecto_id, tablero_id: tablero.id }, 'listas_reordenadas', JSON.stringify(ids));
      return true;
    });
  }

  function moverTarjeta(id, destinoId, posicion) {
    return PSA.DB.transaccion(tx => {
      const tarjeta = _activo(_registro(tx, 'tarjetas', id), 'archivada');
      const origen = _lista(tx, tarjeta.lista_id);
      const destino = _lista(tx, destinoId);
      if (origen.tablero_id !== destino.tablero_id) throw new Error('El destino debe pertenecer al mismo tablero.');
      const ids = tx.all('SELECT id FROM tarjetas WHERE lista_id=? AND archivada=0 AND id<>? ORDER BY posicion,id',
        [destinoId, id]).map(fila => fila.id);
      if (!Number.isInteger(posicion) || posicion < 0 || posicion > ids.length) throw new Error('La posición de destino no es válida.');
      const completada = origen.id === destino.id ? tarjeta.completada : Number(destino.categoria === 'completado');
      if (origen.id !== destino.id && posicion === ids.length) {
        const siguientePosicion = tx.all('SELECT coalesce(max(posicion),-1)+1 AS posicion FROM tarjetas WHERE lista_id=?',
          [destinoId])[0].posicion;
        tx.run(`UPDATE tarjetas SET lista_id=?,completada=?,posicion=?,updated_at=${AHORA} WHERE id=?`,
          [destinoId, completada, siguientePosicion, id]);
        const contexto = _contexto(tx, 'tarjetas', { ...tarjeta, lista_id: destinoId });
        _evento(tx, contexto, 'tarjeta_movida', JSON.stringify({
          desde: origen.nombre, hasta: destino.nombre, posicion: siguientePosicion
        }));
        if (tarjeta.completada !== completada) {
          _evento(tx, contexto, completada ? 'tarea_completada' : 'tarea_reabierta', tarjeta.titulo);
        }
        return id;
      }
      tx.run(`UPDATE tarjetas SET lista_id=?,completada=?,updated_at=${AHORA} WHERE id=?`, [destinoId, completada, id]);
      ids.splice(posicion, 0, id);
      const archivadas = tx.all(
        'SELECT id FROM tarjetas WHERE lista_id=? AND archivada=1 ORDER BY posicion,id', [destinoId])
        .map(fila => fila.id);
      _ordenar(tx, 'tarjetas', [...ids, ...archivadas]);
      const contexto = _contexto(tx, 'tarjetas', { ...tarjeta, lista_id: destinoId });
      _evento(tx, contexto, 'tarjeta_movida', JSON.stringify({ desde: origen.nombre, hasta: destino.nombre, posicion }));
      if (tarjeta.completada !== completada) {
        _evento(tx, contexto, completada ? 'tarea_completada' : 'tarea_reabierta', tarjeta.titulo);
      }
      return id;
    });
  }

  function moverTarjetas(movimientos) {
    return PSA.DB.transaccion(tx => {
      if (!Array.isArray(movimientos) || movimientos.length === 0 ||
          movimientos.some(m => !m || typeof m.id !== 'string' || typeof m.destinoId !== 'string') ||
          new Set(movimientos.map(m => m.id)).size !== movimientos.length) {
        throw new Error('Seleccione una o más tarjetas distintas y un destino válido para cada una.');
      }
      const filas = movimientos.map(m => {
        const tarjeta = _activo(_registro(tx, 'tarjetas', m.id), 'archivada');
        const origen = _lista(tx, tarjeta.lista_id);
        const destino = _lista(tx, m.destinoId);
        if (origen.tablero_id !== destino.tablero_id) throw new Error('El destino debe pertenecer al mismo tablero.');
        return { tarjeta, origen, destino };
      });
      if (new Set(filas.map(fila => fila.origen.tablero_id)).size !== 1) {
        throw new Error('Las tarjetas seleccionadas deben pertenecer al mismo tablero.');
      }
      const movidas = new Set(movimientos.map(m => m.id));
      const posiciones = new Map();
      for (const { destino } of filas) {
        if (!posiciones.has(destino.id)) {
          posiciones.set(destino.id, tx.all(
            'SELECT coalesce(max(posicion),-1)+1 AS posicion FROM tarjetas WHERE lista_id=?', [destino.id])[0].posicion);
        }
      }
      for (const { tarjeta, origen, destino } of filas) {
        const completada = origen.id === destino.id ? tarjeta.completada : Number(destino.categoria === 'completado');
        const posicion = posiciones.get(destino.id);
        posiciones.set(destino.id, posicion + 1);
        tx.run(`UPDATE tarjetas SET lista_id=?,completada=?,posicion=?,updated_at=${AHORA} WHERE id=?`,
          [destino.id, completada, posicion, tarjeta.id]);
        const contexto = _contexto(tx, 'tarjetas', { ...tarjeta, lista_id: destino.id });
        _evento(tx, contexto, 'tarjeta_movida', JSON.stringify({
          desde: origen.nombre, hasta: destino.nombre, posicion
        }));
        if (tarjeta.completada !== completada) {
          _evento(tx, contexto, completada ? 'tarea_completada' : 'tarea_reabierta', tarjeta.titulo);
        }
      }
      return movimientos.map(m => m.id);
    });
  }

  const TARJETAS = `
    SELECT t.*, l.nombre AS lista_nombre,l.categoria,l.tablero_id,l.archivado AS lista_archivada,
      b.nombre AS tablero_nombre,b.proyecto_id,b.archivado AS tablero_archivado,
      p.nombre AS proyecto_nombre,p.archivado AS proyecto_archivado,r.nombre AS responsable_nombre
    FROM tarjetas t JOIN listas l ON l.id=t.lista_id JOIN tableros b ON b.id=l.tablero_id
    JOIN proyectos p ON p.id=b.proyecto_id LEFT JOIN responsables r ON r.id=t.responsable_id`;

  PSA.Trabajo = {
    PRIORIDADES, CATEGORIAS, guardarResponsable, asignarResponsableProyecto, guardarTablero, guardarLista, guardarEtiqueta,
    guardarTarjeta, archivar, reordenarListas, moverTarjeta, moverTarjetas,
    getResponsables() { return PSA.DB.consultar('SELECT * FROM responsables ORDER BY nombre,id'); },
    getTableros() { return PSA.DB.consultar('SELECT * FROM tableros ORDER BY created_at,id'); },
    getListas(tableroId) { return PSA.DB.consultar('SELECT * FROM listas WHERE tablero_id=? ORDER BY posicion,id', [tableroId]); },
    getTarjetas() {
      const filas = PSA.DB.consultar(TARJETAS + ' ORDER BY t.posicion,t.id');
      const responsables = PSA.DB.consultar(`SELECT tr.tarjeta_id,r.id,r.nombre,r.archivado
        FROM tarjeta_responsables tr JOIN responsables r ON r.id=tr.responsable_id
        ORDER BY r.nombre,r.id`);
      const etiquetas = PSA.DB.consultar(`SELECT te.tarjeta_id,e.id,e.nombre,e.color,e.archivado
        FROM tarjeta_etiquetas te JOIN etiquetas e ON e.id=te.etiqueta_id
        ORDER BY e.nombre,e.id`);
      const porResponsable = new Map();
      const porEtiqueta = new Map();
      for (const fila of responsables) {
        if (!porResponsable.has(fila.tarjeta_id)) porResponsable.set(fila.tarjeta_id, []);
        porResponsable.get(fila.tarjeta_id).push({ id: fila.id, nombre: fila.nombre, archivado: fila.archivado });
      }
      for (const fila of etiquetas) {
        if (!porEtiqueta.has(fila.tarjeta_id)) porEtiqueta.set(fila.tarjeta_id, []);
        porEtiqueta.get(fila.tarjeta_id).push({ id: fila.id, nombre: fila.nombre, color: fila.color, archivado: fila.archivado });
      }
      return filas.map(fila => ({
        ...fila,
        responsables: porResponsable.get(fila.id) || [],
        etiquetas: porEtiqueta.get(fila.id) || []
      }));
    },
    getEtiquetas() { return PSA.DB.consultar('SELECT * FROM etiquetas ORDER BY nombre,id'); },
    getTarjetaEtiquetas(id) {
      return PSA.DB.consultar('SELECT e.* FROM etiquetas e JOIN tarjeta_etiquetas te ON te.etiqueta_id=e.id WHERE te.tarjeta_id=? ORDER BY e.nombre,e.id', [id]);
    },
    getActividad() { return PSA.DB.consultar('SELECT * FROM actividad ORDER BY id DESC'); }
  };
})();
