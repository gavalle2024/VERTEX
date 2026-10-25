/* Persistencia SQLite en archivo local autorizado por el usuario. */
'use strict';

(function () {
  const DB_FILENAME = 'vertex.db';
  const IDB_NAME = 'psa_fs_v1';
  const IDB_STORE = 'handles';
  const IDB_KEY = 'vertex_db';
  const SQL_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2';
  const CAMPOS = [
    'nombre', 'responsable', 'division', 'inicio', 'meta', 'fin', 'estado',
    'avance', 'implementacion', 'cumplimiento', 'objetivo', 'resultado', 'observaciones'
  ];

  let _SQL = null;
  let _db = null;
  let _conexion = null;
  let _pendiente = null;
  let _ocupado = false;
  let _error = '';
  let _avisoUbicacion = '';
  let _migracion = null;

  function _estado() {
    return {
      useSQLite: !!_SQL,
      tieneArchivo: !!_conexion,
      esperaPermiso: !!_pendiente,
      ocupado: _ocupado,
      requiereMigracion: !!_migracion,
      destinoMigracion: _migracion ? _migracion.conexion.archivo.name : '',
      ubicacion: _conexion
        ? (_conexion.carpeta ? _conexion.carpeta.name + ' / ' : '') + _conexion.archivo.name
        : '',
      error: _error || _avisoUbicacion
    };
  }

  function _notificar() {
    window.dispatchEvent(new CustomEvent('psa:db-state', { detail: _estado() }));
  }

  function _iniciarOperacion() {
    if (_ocupado) throw new Error('Hay una operación de base de datos en curso. Espere a que finalice.');
    _ocupado = true;
    _error = '';
    _notificar();
  }

  function _finalizarOperacion() {
    _ocupado = false;
    _notificar();
  }

  function _registrarError(e) {
    _error = e.message;
    console.error('[PSA.DB]', e);
  }

  async function _idbOperacion(modo, ejecutar) {
    const idb = await new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_STORE, modo);
        const req = ejecutar(tx.objectStore(IDB_STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error || req.error);
        tx.onabort = () => reject(tx.error || new Error('Se canceló el acceso a IndexedDB.'));
      });
    } finally {
      idb.close();
    }
  }

  async function _escribirArchivo(handle, data) {
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (e) {
      try {
        await writable.abort();
      } catch (abortError) {
        console.warn('[PSA.DB] No se pudo abortar la escritura:', abortError);
      }
      throw e;
    }
  }

  function _exportar(db) {
    const data = db.export();
    // sql.js reabre su conexión al exportar y restablece los pragmas.
    db.run('PRAGMA foreign_keys=ON');
    return data;
  }

  function _crearDB(data) {
    const candidata = data.length ? new _SQL.Database(data) : new _SQL.Database();
    try {
      const requiereMigracion = window.PSA.Esquema.preparar(candidata, !data.length);
      return { candidata, requiereMigracion };
    } catch (e) {
      candidata.close();
      throw new Error('Archivo SQLite inválido o esquema incompatible. No se modificó el archivo. ' + e.message);
    }
  }

  async function _activar(conexion) {
    const file = await conexion.archivo.getFile();
    const datos = new Uint8Array(await file.arrayBuffer());
    const { candidata, requiereMigracion } = _crearDB(datos);
    if (requiereMigracion) {
      candidata.close();
      _migracion = { conexion, original: datos };
      return false;
    }
    try {
      if (!datos.length) await _escribirArchivo(conexion.archivo, _exportar(candidata));
    } catch (e) {
      candidata.close();
      throw e;
    }
    await _publicarConexion(conexion, candidata);
    return true;
  }

  async function _publicarConexion(conexion, candidata) {
    if (_db) _db.close();
    _db = candidata;
    _conexion = conexion;
    _pendiente = null;
    _migracion = null;
    try {
      await _idbOperacion('readwrite', store => store.put(conexion, IDB_KEY));
      _avisoUbicacion = '';
    } catch (e) {
      console.warn('[PSA.DB] No se pudo recordar la ubicación:', e);
      _avisoUbicacion = 'Base conectada, pero no se pudo recordar la ubicación. Deberá seleccionarla al volver a abrir la app.';
    }
  }

  async function _inicializar() {
    try {
      if (typeof initSqlJs !== 'function') throw new Error('No se pudo cargar sql.js. Verifique la conexión a internet.');
      _SQL = await initSqlJs({ locateFile: f => `${SQL_JS_CDN}/${f}` });
    } catch (e) {
      _registrarError(e);
      return _estado();
    }
    try {
      const guardado = await _idbOperacion('readonly', store => store.get(IDB_KEY));
      if (guardado) {
        // Compatibilidad con el FileSystemFileHandle guardado por versiones anteriores.
        _pendiente = guardado.kind === 'file' ? { archivo: guardado, carpeta: null } : guardado;
        if (await _pendiente.archivo.queryPermission({ mode: 'readwrite' }) === 'granted') {
          await _activar(_pendiente);
        }
      }
    } catch (e) {
      _registrarError(e);
    }
    return _estado();
  }

  async function init() {
    _iniciarOperacion();
    try {
      await _inicializar();
    } finally {
      _finalizarOperacion();
    }
    return _estado();
  }

  async function _conectar(seleccionar) {
    if (!_SQL) throw new Error('El motor SQLite no está disponible.');
    _iniciarOperacion();
    try {
      const conexion = await seleccionar();
      if (!conexion) return { ok: false, cancelado: true };
      const activa = await _activar(conexion);
      return { ok: activa, requiereMigracion: !activa, nombre: conexion.archivo.name };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, cancelado: true };
      _registrarError(e);
      throw e;
    } finally {
      _finalizarOperacion();
    }
  }

  async function configurarCarpeta() {
    return _conectar(async () => {
      if (typeof window.showDirectoryPicker !== 'function') {
        throw new Error('La selección de carpetas requiere Chrome o Edge en un contexto seguro.');
      }
      const carpeta = await window.showDirectoryPicker({
        id: 'vertex_carpeta',
        mode: 'readwrite',
        startIn: _conexion && _conexion.carpeta ? _conexion.carpeta : 'documents'
      });
      let archivo;
      try {
        archivo = await carpeta.getFileHandle(DB_FILENAME);
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
        if (!window.confirm(`La carpeta «${carpeta.name}» no contiene ${DB_FILENAME}. ¿Crear una base vacía? No se copiarán los proyectos de la base actual.`)) {
          return null;
        }
        archivo = await carpeta.getFileHandle(DB_FILENAME, { create: true });
      }
      return { archivo, carpeta };
    });
  }

  async function conectarArchivo() {
    return _conectar(async () => {
      const archivo = await window.showSaveFilePicker({
        id: 'vertex_db',
        suggestedName: DB_FILENAME,
        types: [{ description: 'Base de datos SQLite', accept: { 'application/octet-stream': ['.db'] } }]
      });
      return { archivo, carpeta: null };
    });
  }

  async function solicitarPermiso() {
    if (!_pendiente) throw new Error('No hay una conexión pendiente de permiso.');
    return _conectar(async () => {
      const conexion = _pendiente;
      if (await conexion.archivo.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Permiso denegado. Puede reintentar o seleccionar otra carpeta.');
      }
      return conexion;
    });
  }

  function _iguales(a, b) {
    return a.length === b.length && a.every((valor, i) => valor === b[i]);
  }

  async function _leerBinario(handle) {
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async function _respaldar(solicitud, destino) {
    if (!destino) {
      const carpeta = solicitud.conexion.carpeta;
      const nombre = 'vertex.pre-v1.' + Date.now() + '.' + Math.random().toString(36).slice(2, 10) + '.db';
      try {
        await carpeta.getFileHandle(nombre);
        throw new Error('El nombre de respaldo ya existe. Reintente para generar otro nombre.');
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
      }
      destino = await carpeta.getFileHandle(nombre, { create: true });
    }
    if (typeof destino.isSameEntry === 'function' && await destino.isSameEntry(solicitud.conexion.archivo)) {
      throw new Error('El respaldo debe ser distinto de la base original.');
    }
    if ((await _leerBinario(destino)).length) {
      throw new Error('El archivo de respaldo no está vacío. No se sobrescribió.');
    }
    await _escribirArchivo(destino, solicitud.original);
    if (!_iguales(await _leerBinario(destino), solicitud.original)) {
      throw new Error('No se pudo verificar el respaldo. La base original no se modificó.');
    }
    return destino.name;
  }

  async function migrarConexion() {
    if (!_migracion) throw new Error('No hay una migración pendiente.');
    _iniciarOperacion();
    let candidata;
    try {
      const solicitud = _migracion;
      // El selector alternativo se invoca antes de cualquier await para conservar el gesto del usuario.
      const destino = solicitud.conexion.carpeta ? null : await window.showSaveFilePicker({
        suggestedName: 'vertex.pre-v1.' + Date.now() + '.db',
        types: [{ description: 'Respaldo SQLite anterior a la migración', accept: { 'application/octet-stream': ['.db'] } }]
      });
      candidata = new _SQL.Database(solicitud.original);
      candidata.run('PRAGMA foreign_keys=ON');
      window.PSA.Esquema.migrar(candidata);
      if (!_iguales(await _leerBinario(solicitud.conexion.archivo), solicitud.original)) {
        throw new Error('La base cambió desde que se solicitó la migración. Cancele y vuelva a seleccionarla.');
      }
      const respaldo = await _respaldar(solicitud, destino);
      if (!_iguales(await _leerBinario(solicitud.conexion.archivo), solicitud.original)) {
        throw new Error('La base cambió durante el respaldo. No se aplicó la migración.');
      }
      await _escribirArchivo(solicitud.conexion.archivo, _exportar(candidata));
      await _publicarConexion(solicitud.conexion, candidata);
      candidata = null;
      return { ok: true, respaldo };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, cancelado: true };
      _registrarError(e);
      throw e;
    } finally {
      if (candidata) candidata.close();
      _finalizarOperacion();
    }
  }

  function cancelarMigracion() {
    if (_ocupado) throw new Error('Espere a que termine la operación en curso.');
    _migracion = null;
    _pendiente = null;
    _error = '';
    _notificar();
  }

  function _filas(db, sql, params = []) {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      const filas = [];
      while (statement.step()) filas.push(statement.getAsObject());
      return filas;
    } finally {
      statement.free();
    }
  }

  function consultar(sql, params = []) {
    if (!_db) return [];
    if (!/^\s*SELECT\b/i.test(sql)) throw new Error('La consulta debe ser de solo lectura.');
    return _filas(_db, sql, params);
  }

  function getProyectos() {
    if (!_db) return [];
    const res = _db.exec('SELECT * FROM proyectos ORDER BY inicio DESC, created_at DESC');
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
  }

  async function transaccion(operacion) {
    if (!_db || !_conexion) throw new Error('Conecte una base de datos antes de guardar.');
    if (_migracion) throw new Error('Confirme o cancele la migración pendiente antes de guardar.');
    _iniciarOperacion();
    let candidata;
    try {
      // El estado visible solo cambia después de confirmar la escritura al disco.
      candidata = new _SQL.Database(_exportar(_db));
      candidata.run('PRAGMA foreign_keys=ON');
      candidata.run('BEGIN IMMEDIATE');
      let resultado;
      try {
        resultado = operacion({
          run(sql, params = []) { candidata.run(sql, params); return candidata.getRowsModified(); },
          all(sql, params = []) { return _filas(candidata, sql, params); }
        });
        if (resultado && typeof resultado.then === 'function') {
          throw new Error('La operación SQLite debe ser síncrona dentro de la transacción.');
        }
        window.PSA.Esquema.validar(candidata);
      } catch (e) {
        candidata.run('ROLLBACK');
        throw e;
      }
      candidata.run('COMMIT');
      await _escribirArchivo(_conexion.archivo, _exportar(candidata));
      _db.close();
      _db = candidata;
      candidata = null;
      return resultado;
    } catch (e) {
      _registrarError(e);
      throw e;
    } finally {
      if (candidata) candidata.close();
      _finalizarOperacion();
    }
  }

  function _guardarCambio(sql, params) {
    return transaccion(tx => {
      if (!tx.run(sql, params)) throw new Error('El registro ya no existe. Actualice la vista.');
      return true;
    });
  }

  async function saveProyecto(p, esNuevo) {
    const valores = CAMPOS.map(campo => p[campo]);
    return esNuevo
      ? _guardarCambio(
        `INSERT INTO proyectos (id,${CAMPOS.join(',')}) VALUES (${[p.id, ...valores].map(() => '?').join(',')})`,
        [p.id, ...valores])
      : _guardarCambio(
        `UPDATE proyectos SET ${CAMPOS.map(campo => campo + '=?').join(',')},updated_at=datetime('now','localtime') WHERE id=?`,
        [...valores, p.id]);
  }

  async function deleteProyecto(id) {
    return transaccion(tx => {
      const asociados = tx.all(`SELECT
        (SELECT count(*) FROM tableros WHERE proyecto_id=?) +
        (SELECT count(*) FROM actividad WHERE proyecto_id=?) AS cantidad`, [id, id])[0].cantidad;
      if (asociados) throw new Error('El proyecto tiene tableros o actividad asociada. Archívelo para conservar su información.');
      if (!tx.run('DELETE FROM proyectos WHERE id=?', [id])) throw new Error('El proyecto ya no existe.');
      return true;
    });
  }

  window.PSA = window.PSA || {};
  window.PSA.DB = {
    init, configurarCarpeta, conectarArchivo, solicitarPermiso, migrarConexion, cancelarMigracion,
    consultar, transaccion,
    getProyectos, saveProyecto, deleteProyecto,
    exportarDB() { return _db ? _exportar(_db) : null; },
    get estado() { return _estado(); },
    get useSQLite() { return !!_SQL; },
    get tieneArchivo() { return !!_conexion; },
    get esperaPermiso() { return !!_pendiente; },
    get ocupado() { return _ocupado; },
    get hasFSA() { return typeof window.showDirectoryPicker === 'function'; }
  };
})();
