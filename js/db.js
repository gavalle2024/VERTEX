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
  const DDL = `
    CREATE TABLE IF NOT EXISTS proyectos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      responsable TEXT NOT NULL,
      division TEXT DEFAULT '',
      inicio TEXT DEFAULT '',
      meta TEXT DEFAULT '',
      fin TEXT DEFAULT '',
      estado TEXT DEFAULT 'En curso',
      avance INTEGER DEFAULT 0,
      implementacion TEXT DEFAULT 'No iniciado',
      cumplimiento TEXT DEFAULT 'En curso (pendiente de evaluar)',
      objetivo TEXT DEFAULT '',
      resultado TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `;

  let _SQL = null;
  let _db = null;
  let _conexion = null;
  let _pendiente = null;
  let _ocupado = false;
  let _error = '';
  let _avisoUbicacion = '';

  function _estado() {
    return {
      useSQLite: !!_SQL,
      tieneArchivo: !!_conexion,
      esperaPermiso: !!_pendiente,
      ocupado: _ocupado,
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

  function _crearDB(data) {
    const candidata = data.length ? new _SQL.Database(data) : new _SQL.Database();
    try {
      const control = candidata.exec('PRAGMA quick_check');
      if (control[0].values.some(row => row[0] !== 'ok')) {
        throw new Error('La base de datos está dañada.');
      }
      candidata.run(DDL);
      candidata.exec(`SELECT id,${CAMPOS.join(',')},created_at,updated_at FROM proyectos LIMIT 0`);
      return candidata;
    } catch (e) {
      candidata.close();
      throw new Error('Archivo SQLite inválido o esquema incompatible. No se modificó el archivo. ' + e.message);
    }
  }

  async function _activar(conexion) {
    const file = await conexion.archivo.getFile();
    const datos = new Uint8Array(await file.arrayBuffer());
    const candidata = _crearDB(datos);
    try {
      if (!datos.length) await _escribirArchivo(conexion.archivo, candidata.export());
    } catch (e) {
      candidata.close();
      throw e;
    }
    if (_db) _db.close();
    _db = candidata;
    _conexion = conexion;
    _pendiente = null;
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
      await _activar(conexion);
      return { ok: true, nombre: conexion.archivo.name };
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

  function getProyectos() {
    if (!_db) return [];
    const res = _db.exec('SELECT * FROM proyectos ORDER BY inicio DESC, created_at DESC');
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
  }

  async function _guardarCambio(sql, params) {
    if (!_db || !_conexion) throw new Error('Conecte una base de datos antes de guardar.');
    _iniciarOperacion();
    let candidata;
    try {
      // El estado visible solo cambia después de confirmar la escritura al disco.
      candidata = new _SQL.Database(_db.export());
      candidata.run(sql, params);
      await _escribirArchivo(_conexion.archivo, candidata.export());
      _db.close();
      _db = candidata;
      candidata = null;
      return true;
    } catch (e) {
      _registrarError(e);
      throw e;
    } finally {
      if (candidata) candidata.close();
      _finalizarOperacion();
    }
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
    return _guardarCambio('DELETE FROM proyectos WHERE id=?', [id]);
  }

  window.PSA = window.PSA || {};
  window.PSA.DB = {
    init, configurarCarpeta, conectarArchivo, solicitarPermiso,
    getProyectos, saveProyecto, deleteProyecto,
    exportarDB() { return _db ? _db.export() : null; },
    get estado() { return _estado(); },
    get useSQLite() { return !!_SQL; },
    get tieneArchivo() { return !!_conexion; },
    get esperaPermiso() { return !!_pendiente; },
    get ocupado() { return _ocupado; },
    get hasFSA() { return typeof window.showDirectoryPicker === 'function'; }
  };
})();
