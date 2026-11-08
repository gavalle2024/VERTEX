/* Persistencia SQLite en archivo local autorizado por el usuario. */
'use strict';

(function () {
  const DB_FILENAME = 'vertex.db';
  const IDB_NAME = 'psa_fs_v1';
  const IDB_STORE = 'handles';
  const IDB_KEY = 'vertex_db';
  const IDB_HIST_NAME = 'psa_vertex_backup_history_v1';
  const IDB_HIST_STORE = 'operaciones';
  const IDB_HIST_KEY = 'registros';
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
  let _restauracionPendiente = null;
  let _historialCola = Promise.resolve();

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

  function _errorArchivo(e, etapa, handle) {
    const motivos = {
      NotAllowedError: 'Permiso denegado o revocado. Reconecte el archivo para autorizar el acceso.',
      SecurityError: 'El navegador bloqueó el acceso. Verifique los permisos y el contexto seguro.',
      NotFoundError: 'Archivo no encontrado. Seleccione nuevamente su ubicación.',
      NoModificationAllowedError: 'Archivo bloqueado o no modificable. Cierre otras aplicaciones y reintente.',
      NotReadableError: 'Archivo inaccesible para lectura. Verifique su disponibilidad.',
      QuotaExceededError: 'Espacio insuficiente para escribir el archivo.',
      AbortError: 'La operación de archivo fue interrumpida; no se confirmó el guardado.'
    };
    if (e.name === 'NotAllowedError' && _conexion && handle === _conexion.archivo) {
      _pendiente = _conexion;
    }
    return new Error(etapa + ': ' + (motivos[e.name] || e.message), { cause: e });
  }

  async function _comprobarPermiso(conexion) {
    if (typeof conexion.archivo.queryPermission !== 'function') return;
    try {
      if (await conexion.archivo.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        _pendiente = conexion;
        const error = new Error('Permiso de lectura y escritura requerido.');
        error.name = 'NotAllowedError';
        throw error;
      }
    } catch (e) {
      throw _errorArchivo(e, 'Acceso a SQLite', conexion.archivo);
    }
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
    let writable;
    try {
      writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    } catch (e) {
      if (writable) {
        try {
          await writable.abort();
        } catch (abortError) {
          console.warn('[PSA.DB] No se pudo abortar la escritura:', abortError);
        }
      }
      throw _errorArchivo(e, 'Escritura SQLite no confirmada', handle);
    }
  }

  function _exportar(db) {
    const data = db.export();
    // sql.js reabre su conexión al exportar y restablece los pragmas.
    db.run('PRAGMA foreign_keys=ON');
    return data;
  }

  function _crearDB(data, nueva = false) {
    if (!data.length && !nueva) {
      throw new Error('El archivo SQLite existente está vacío. No se modificó ni se reemplazó la conexión activa.');
    }
    const candidata = data.length ? new _SQL.Database(data) : new _SQL.Database();
    try {
      const versionOriginal = candidata.exec('PRAGMA user_version')[0].values[0][0];
      const requiereMigracion = window.PSA.Esquema.preparar(candidata, nueva && !data.length);
      return { candidata, requiereMigracion, versionOriginal };
    } catch (e) {
      candidata.close();
      throw new Error('Archivo SQLite inválido o esquema incompatible. No se modificó el archivo. ' + e.message);
    }
  }

  async function _activar(conexion) {
    await _comprobarPermiso(conexion);
    const datos = await _leerBinario(conexion.archivo);
    const { candidata, requiereMigracion, versionOriginal } = _crearDB(datos, !!conexion.nueva);
    if (requiereMigracion) {
      candidata.close();
      _migracion = { conexion, original: datos, versionOriginal };
      return false;
    }
    try {
      if (!datos.length) await _escribirArchivo(conexion.archivo, _exportar(candidata));
    } catch (e) {
      candidata.close();
      throw e;
    }
    conexion.nueva = false;
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
        const conexion = guardado.kind === 'file' ? { archivo: guardado, carpeta: null } : guardado;
        if (!conexion.archivo || typeof conexion.archivo.getFile !== 'function' ||
            typeof conexion.archivo.queryPermission !== 'function') {
          throw new Error('El handle recordado en IndexedDB es inválido. Seleccione nuevamente la carpeta.');
        }
        _pendiente = { archivo: conexion.archivo, carpeta: conexion.carpeta || null };
        if (await _pendiente.archivo.queryPermission({ mode: 'readwrite' }) === 'granted') {
          const disponible = _pendiente;
          _pendiente = null;
          await _activar(disponible);
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
      const error = ['NotAllowedError', 'SecurityError', 'NotFoundError', 'NotReadableError',
        'NoModificationAllowedError'].includes(e.name) ? _errorArchivo(e, 'Apertura SQLite') : e;
      _registrarError(error);
      throw error;
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
      let nueva = false;
      try {
        archivo = await carpeta.getFileHandle(DB_FILENAME);
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
        if (!window.confirm(`La carpeta «${carpeta.name}» no contiene ${DB_FILENAME}. ¿Crear una base vacía? No se copiarán los proyectos de la base actual.`)) {
          return null;
        }
        archivo = await carpeta.getFileHandle(DB_FILENAME, { create: true });
        nueva = true;
      }
      return { archivo, carpeta, nueva };
    });
  }

  async function conectarArchivo() {
    return _conectar(async () => {
      if (typeof window.showOpenFilePicker !== 'function') {
        throw new Error('La selección de archivos requiere Chrome o Edge en un contexto seguro. Use Seleccionar carpeta.');
      }
      const [archivo] = await window.showOpenFilePicker({
        id: 'vertex_db',
        multiple: false,
        types: [{ description: 'Base de datos SQLite', accept: { 'application/octet-stream': ['.db'] } }]
      });
      return { archivo, carpeta: null };
    });
  }

  async function solicitarPermiso() {
    if (!_pendiente) throw new Error('No hay una conexión pendiente de permiso.');
    if (_pendiente === _conexion) {
      _iniciarOperacion();
      try {
        if (await _conexion.archivo.requestPermission({ mode: 'readwrite' }) !== 'granted') {
          throw new Error('Permiso denegado. Puede reintentar o seleccionar otra carpeta.');
        }
        await _leerBinario(_conexion.archivo);
        _pendiente = null;
        return { ok: true, reautorizada: true, nombre: _conexion.archivo.name };
      } catch (e) {
        _registrarError(e);
        throw e;
      } finally {
        _finalizarOperacion();
      }
    }
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
    try {
      // Acepta tanto FileSystemFileHandle como File/Blob del selector HTML nativo.
      const archivo = handle && typeof handle.getFile === 'function'
        ? await handle.getFile()
        : handle && typeof handle.arrayBuffer === 'function'
          ? handle
          : null;
      if (!archivo || typeof archivo.arrayBuffer !== 'function') {
        throw new TypeError('El selector no entregó un archivo legible.');
      }
      return new Uint8Array(await archivo.arrayBuffer());
    } catch (e) {
      throw _errorArchivo(e, 'Lectura SQLite', handle);
    }
  }

  function _validarBackupBinario(datos) {
    const fallo = (codigo, mensaje, versionEsquema = null) => ({
      valido: false, codigo, mensaje, versionEsquema, tamano: datos.length
    });
    if (!datos.length) return fallo('archivo_vacio', 'El archivo de respaldo está vacío.');
    const cabecera = 'SQLite format 3\0';
    if (datos.length < cabecera.length ||
        Array.from(cabecera).some((letra, indice) => datos[indice] !== letra.charCodeAt(0))) {
      return fallo('archivo_invalido', 'El archivo no tiene una cabecera SQLite válida.');
    }
    if (datos.length < 100) return fallo('archivo_incompleto', 'El encabezado SQLite está incompleto.');
    const encabezado = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
    const paginaDeclarada = encabezado.getUint16(16);
    const tamanoPagina = paginaDeclarada === 1 ? 65536 : paginaDeclarada;
    if (tamanoPagina < 512 || tamanoPagina > 65536 || (tamanoPagina & (tamanoPagina - 1))) {
      return fallo('archivo_invalido', 'El tamaño de página SQLite no es válido.');
    }
    if (datos.length % tamanoPagina) {
      return fallo('archivo_incompleto', 'El archivo contiene una página SQLite incompleta.');
    }
    let candidata;
    let codigo = 'archivo_invalido';
    let versionEsquema = null;
    try {
      candidata = new _SQL.Database(datos);
      candidata.run('PRAGMA foreign_keys=ON');
      codigo = 'integridad';
      const integridad = candidata.exec('PRAGMA integrity_check');
      if (!integridad.length || integridad[0].values.length !== 1 || integridad[0].values[0][0] !== 'ok') {
        return fallo(codigo, 'La copia no supera integrity_check. No es recuperable.');
      }
      if (candidata.exec('PRAGMA foreign_key_check').length) {
        return fallo(codigo, 'La copia contiene relaciones inválidas. No es recuperable.');
      }
      codigo = 'esquema_incompatible';
      versionEsquema = candidata.exec('PRAGMA user_version')[0].values[0][0];
      if (versionEsquema !== window.PSA.Esquema.VERSION) {
        return fallo(codigo, 'La versión de esquema no es compatible con la validación actual; no se aplicaron migraciones.', versionEsquema);
      }
      window.PSA.Esquema.validar(candidata);
      const consultas = {};
      for (const tabla of ['proyectos', 'tableros', 'tarjetas', 'actividad']) {
        consultas[tabla] = candidata.exec(`SELECT count(*) FROM ${tabla}`)[0].values[0][0];
      }
      return { valido: true, codigo: 'valido', mensaje: 'Copia SQLite válida.',
        versionEsquema, tamano: datos.length, consultas };
    } catch (e) {
      return fallo(codigo, 'No se pudo validar la copia: ' + e.message, versionEsquema);
    } finally {
      if (candidata) candidata.close();
    }
  }

  async function validarBackup(archivo) {
    if (!_SQL) throw new Error('El motor SQLite no está disponible.');
    _iniciarOperacion();
    try {
      const datos = await _leerBinario(archivo);
      const resultado = { nombre: archivo.name, ..._validarBackupBinario(datos) };
      _registrarHistorial({ tipo: 'validacion', archivo: archivo.name, tamano: datos.length,
        resultado: resultado.valido ? 'valida' : 'invalida', mensaje: resultado.mensaje,
        versionEsquema: resultado.versionEsquema });
      return resultado;
    } catch (e) {
      _registrarError(e);
      throw e;
    } finally {
      _finalizarOperacion();
    }
  }

  async function prepararRestauracion(archivo) {
    if (!_SQL) throw new Error('El motor SQLite no está disponible.');
    if (_restauracionPendiente) throw new Error('Ya existe una restauración preparada. Cancele esa operación antes de seleccionar otra copia.');
    _iniciarOperacion();
    try {
      const datos = await _leerBinario(archivo);
      const validacion = _validarBackupBinario(datos);
      if (!validacion.valido) {
        _notificarRestauracion('invalida', { nombre: archivo.name, validacion });
        return { preparada: false, nombre: archivo.name, validacion };
      }
      _restauracionPendiente = {
        nombre: archivo.name,
        origen: archivo,
        datos: datos.slice(),
        validacion,
        preparadaEn: new Date().toISOString()
      };
      const resultado = {
        preparada: true,
        nombre: archivo.name,
        tamano: datos.length,
        versionEsquema: validacion.versionEsquema,
        consultas: validacion.consultas
      };
      _notificarRestauracion('preparada', resultado);
      return resultado;
    } catch (e) {
      _registrarError(e);
      _notificarRestauracion('fallida', { nombre: archivo.name, mensaje: e.message });
      throw e;
    } finally {
      _finalizarOperacion();
    }
  }

  function cancelarRestauracion() {
    if (_ocupado) throw new Error('Espere a que termine la operación en curso.');
    if (!_restauracionPendiente) return false;
    const nombre = _restauracionPendiente.nombre;
    _restauracionPendiente = null;
    _notificarRestauracion('cancelada', { nombre, mensaje: 'Restauración cancelada. No se modificó ningún archivo.' });
    return true;
  }

  function _notificarRestauracion(estado, detalle = {}) {
    window.dispatchEvent(new CustomEvent('psa:restore-state', { detail: { estado, ...detalle } }));
    if (['preparada', 'invalida', 'cancelada', 'fallida', 'exitosa'].includes(estado)) {
      _registrarHistorial({ tipo: 'restauracion', archivo: detalle.nombre || detalle.origen,
        tamano: detalle.tamano || detalle.validacion?.tamano, resultado: estado,
        mensaje: detalle.mensaje || detalle.validacion?.mensaje,
        versionEsquema: detalle.versionEsquema || detalle.validacion?.versionEsquema });
    }
  }

  function _nombreRestauracion() {
    const fecha = new Date();
    const dos = valor => String(valor).padStart(2, '0');
    const marca = fecha.getFullYear() + '-' + dos(fecha.getMonth() + 1) + '-' + dos(fecha.getDate()) +
      '_' + dos(fecha.getHours()) + '-' + dos(fecha.getMinutes()) + '-' + dos(fecha.getSeconds());
    return 'vertex_restaurada_' + marca + '_' + Math.random().toString(36).slice(2, 8) + '.db';
  }

  async function restaurarBackup() {
    if (!_conexion || !_conexion.archivo) throw new Error('Conecte una base de datos antes de restaurar una copia.');
    if (!_restauracionPendiente) throw new Error('Primero seleccione y valide una copia de seguridad.');
    const usaSelectorArchivo = typeof window.showSaveFilePicker === 'function';
    const usaSelectorCarpeta = typeof window.showDirectoryPicker === 'function';
    if (!usaSelectorArchivo && !usaSelectorCarpeta) {
      throw new Error('Este navegador no ofrece un selector compatible para crear el archivo restaurado. Utilice una versión actual de Chrome o Edge.');
    }
    _iniciarOperacion();
    let fase = 'selector';
    try {
      const nombreSugerido = _nombreRestauracion();
      let destino;
      let destinoNombre = '';
      let carpeta = null;

      // Preferir el selector de archivo: permite elegir nombre y ubicación en
      // una sola ventana. La invocación ocurre directamente desde el clic.
      if (usaSelectorArchivo) {
        const seleccion = window.showSaveFilePicker({
          id: 'vertex_restore_destination',
          suggestedName: nombreSugerido,
          types: [{ description: 'Base de datos SQLite', accept: { 'application/vnd.sqlite3': ['.db'] } }]
        });
        destino = await seleccion;
        destinoNombre = destino.name;
      } else {
        // Compatibilidad para navegadores que ofrecen selector de carpeta.
        const seleccion = window.showDirectoryPicker({ id: 'vertex_restore_folder', mode: 'readwrite' });
        carpeta = await seleccion;
        const pendienteNombre = _restauracionPendiente;
        if (!pendienteNombre) throw new Error('La restauración preparada ya no está disponible. Vuelva a seleccionar el respaldo.');
        for (let intento = 0; intento < 5; intento++) {
          const nombre = intento === 0 ? nombreSugerido : _nombreRestauracion();
          if (nombre === pendienteNombre.nombre) continue;
          try {
            await carpeta.getFileHandle(nombre);
          } catch (error) {
            if (error.name !== 'NotFoundError') throw error;
            destinoNombre = nombre;
            break;
          }
        }
        if (!destinoNombre) throw new Error('No se pudo generar un nombre de destino único. No se escribió la restauración.');
      }

      const pendiente = _restauracionPendiente;
      if (!pendiente) throw new Error('La restauración preparada ya no está disponible. Vuelva a seleccionar el respaldo.');
      fase = 'comprobacion';
      if (destino && (typeof destino.isSameEntry !== 'function' || typeof _conexion?.archivo?.isSameEntry !== 'function')) {
        throw new Error('No se pudo comprobar la identidad del destino y de la base activa. No se escribió la restauración.');
      }
      if (destino) {
        const mismoActivo = await destino.isSameEntry(_conexion.archivo);
        const origenConHandle = typeof pendiente.origen?.isSameEntry === 'function';
        const mismoOrigen = origenConHandle
          ? await destino.isSameEntry(pendiente.origen)
          : destino.name === pendiente.nombre;
        if (mismoActivo || mismoOrigen) {
          throw new Error('El destino debe ser un archivo nuevo, distinto de la base activa y del respaldo original.');
        }
        // El selector de archivo puede apuntar a un archivo existente. Rechazarlo
        // para no sobrescribir información.
        try {
          await destino.getFile();
          throw new Error('El archivo de destino ya existe. Elegí un nombre nuevo para evitar sobrescribir información.');
        } catch (error) {
          if (error.name !== 'NotFoundError') throw error;
        }
      } else if (destinoNombre === pendiente.nombre) {
        throw new Error('El destino debe tener un nombre diferente al respaldo original.');
      }

      fase = 'confirmacion';
      const ubicacion = carpeta ? carpeta.name + ' / ' + destinoNombre : destinoNombre;
      const confirmar = window.confirm(
        'Se creará una base restaurada nueva: «' + ubicacion + '». ' +
        'La base activa y el respaldo original no se modificarán. ¿Continuar?'
      );
      if (!confirmar) {
        _notificarRestauracion('cancelada', { nombre: pendiente.nombre, mensaje: 'Restauración cancelada en la confirmación. No se creó ningún archivo.' });
        return { ok: false, cancelado: true, preparada: true, fase };
      }

      fase = 'escritura';
      if (carpeta) {
        destino = await carpeta.getFileHandle(destinoNombre, { create: true });
        if (typeof destino.isSameEntry !== 'function' || typeof _conexion?.archivo?.isSameEntry !== 'function') {
          throw new Error('No se pudo comprobar la identidad del archivo creado y de la base activa. No se escribió la restauración.');
        }
        if (await destino.isSameEntry(_conexion.archivo)) {
          throw new Error('El destino coincide con la base activa. No se escribió la restauración.');
        }
        if (typeof pendiente.origen?.isSameEntry === 'function' && await destino.isSameEntry(pendiente.origen)) {
          throw new Error('El destino coincide con el respaldo original. No se escribió la restauración.');
        }
      }
      await _escribirArchivo(destino, pendiente.datos);
      const releido = await _leerBinario(destino);
      if (!_iguales(releido, pendiente.datos)) {
        throw new Error('La restauración no pudo confirmarse: el archivo de destino difiere del respaldo. Puede haber quedado un archivo residual.');
      }
      const validacion = _validarBackupBinario(releido);
      if (!validacion.valido) {
        throw new Error('La restauración no pudo confirmarse: el destino no superó la validación integral. Puede haber quedado un archivo residual. ' + validacion.mensaje);
      }
      const resultado = {
        ok: true,
        nombre: destino.name,
        ubicacion,
        origen: pendiente.nombre,
        tamano: releido.length,
        versionEsquema: validacion.versionEsquema,
        conexionActivaConservada: true
      };
      _restauracionPendiente = null;
      _notificarRestauracion('exitosa', resultado);
      return resultado;
    } catch (e) {
      if (e.name === 'AbortError') {
        const mensaje = fase === 'selector'
          ? 'El selector de destino se cerró o fue cancelado (AbortError). El respaldo sigue preparado; no se creó ningún archivo.'
          : 'La operación de restauración fue interrumpida durante ' + fase + ' (AbortError). El respaldo sigue preparado; no se confirmó ningún archivo.';
        _notificarRestauracion('cancelada', { nombre: _restauracionPendiente?.nombre || '', mensaje });
        return { ok: false, cancelado: true, preparada: !!_restauracionPendiente, fase };
      }
      const error = new Error('No se pudo completar la restauración durante ' + fase + ': ' + e.message, { cause: e });
      _registrarError(error);
      _notificarRestauracion('fallida', { nombre: _restauracionPendiente?.nombre || '', mensaje: error.message });
      throw error;
    } finally {
      _finalizarOperacion();
    }
  }

  function _abrirHistorialDB() {
    return new Promise((resolve, reject) => {
      const solicitud = indexedDB.open(IDB_HIST_NAME, 1);
      solicitud.onupgradeneeded = () => {
        if (!solicitud.result.objectStoreNames.contains(IDB_HIST_STORE)) {
          solicitud.result.createObjectStore(IDB_HIST_STORE);
        }
      };
      solicitud.onsuccess = () => resolve(solicitud.result);
      solicitud.onerror = () => reject(solicitud.error || new Error('No se pudo abrir el historial de respaldos.'));
      solicitud.onblocked = () => reject(new Error('El historial de respaldos está bloqueado por otra conexión.'));
    });
  }

  function _registrarHistorial(datos) {
    const versionApp = typeof document !== 'undefined'
      ? (document.querySelector('meta[name="app-version"]')?.content || 'no-declarada')
      : 'entorno-de-pruebas';
    const registro = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      fecha: new Date().toISOString(),
      tipo: datos.tipo,
      archivo: datos.archivo || '',
      tamano: Number.isFinite(datos.tamano) ? datos.tamano : null,
      resultado: datos.resultado,
      mensaje: datos.mensaje || '',
      versionEsquema: Number.isInteger(datos.versionEsquema) ? datos.versionEsquema : null,
      versionApp
    };
    _historialCola = _historialCola.then(async () => {
      let idb;
      try {
        idb = await _abrirHistorialDB();
        await new Promise((resolve, reject) => {
          const tx = idb.transaction(IDB_HIST_STORE, 'readwrite');
          const store = tx.objectStore(IDB_HIST_STORE);
          const solicitud = store.get(IDB_HIST_KEY);
          solicitud.onsuccess = () => {
            const registros = Array.isArray(solicitud.result) ? solicitud.result : [];
            store.put([registro, ...registros].slice(0, 100), IDB_HIST_KEY);
          };
          solicitud.onerror = () => reject(solicitud.error || new Error('No se pudo leer el historial.'));
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el historial.'));
          tx.onabort = () => reject(tx.error || new Error('Se canceló el registro del historial.'));
        });
      } finally {
        if (idb) idb.close();
      }
    }).catch(error => {
      console.warn('[PSA.DB] No se pudo registrar la operación de respaldo:', error);
    });
    return _historialCola;
  }

  async function listarHistorialBackups() {
    await _historialCola;
    const idb = await _abrirHistorialDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = idb.transaction(IDB_HIST_STORE, 'readonly');
        const solicitud = tx.objectStore(IDB_HIST_STORE).get(IDB_HIST_KEY);
        tx.oncomplete = () => {};
        tx.onerror = () => reject(tx.error || new Error('No se pudo consultar el historial.'));
        tx.onabort = () => reject(tx.error || new Error('Se canceló la consulta del historial.'));
        solicitud.onsuccess = () => resolve(Array.isArray(solicitud.result) ? solicitud.result.slice() : []);
        solicitud.onerror = () => reject(solicitud.error || new Error('No se pudo consultar el historial.'));
      });
    } finally {
      idb.close();
    }
  }

  function _notificarBackup(estado, detalle = {}) {
    window.dispatchEvent(new CustomEvent('psa:backup-state', { detail: { estado, ...detalle } }));
    if (['exitosa', 'fallida', 'cancelada'].includes(estado)) {
      _registrarHistorial({ tipo: 'backup', archivo: detalle.nombre, tamano: detalle.tamano,
        resultado: estado, mensaje: detalle.mensaje, versionEsquema: detalle.versionEsquema });
    }
  }

  function _nombreBackup() {
    const fecha = new Date();
    const dos = valor => String(valor).padStart(2, '0');
    return 'VERTEX_backup_' + fecha.getFullYear() + '-' + dos(fecha.getMonth() + 1) + '-' + dos(fecha.getDate()) +
      '_' + dos(fecha.getHours()) + '-' + dos(fecha.getMinutes()) + '-' + dos(fecha.getSeconds()) + '.db';
  }

  async function _seleccionarDestinoBackup(enCarpeta) {
    const nombre = _nombreBackup();
    let carpeta;
    let archivo;
    try {
      if (enCarpeta) {
        if (typeof window.showDirectoryPicker !== 'function') throw new Error('La selección de carpetas no está disponible.');
        carpeta = await window.showDirectoryPicker({ id: 'vertex_backup_carpeta', mode: 'readwrite' });
      } else {
        if (typeof window.showSaveFilePicker !== 'function') throw new Error('La selección del destino de respaldo no está disponible.');
        archivo = await window.showSaveFilePicker({
          id: 'vertex_backup', suggestedName: nombre,
          types: [{ description: 'Copia de seguridad SQLite', accept: { 'application/octet-stream': ['.db'] } }]
        });
      }
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
    if (carpeta) {
      try {
        await carpeta.getFileHandle(nombre);
        throw new Error('Ya existe un respaldo con ese nombre. No se sobrescribió; reintente o elija otra ubicación.');
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
      }
      archivo = await carpeta.getFileHandle(nombre, { create: true });
    }
    return { archivo, ubicacion: (carpeta ? carpeta.name + ' / ' : '') + archivo.name };
  }

  async function _escribirVerificado(destino, datos) {
    await _escribirArchivo(destino, datos);
    const leido = await _leerBinario(destino);
    if (!_iguales(leido, datos)) {
      throw new Error('No se pudo verificar el respaldo. El destino no coincide con los bytes esperados.');
    }
    return leido;
  }

  async function crearBackup({ enCarpeta = false } = {}) {
    if (!_db || !_conexion) throw new Error('Conecte una base de datos antes de crear una copia de seguridad.');
    if (_migracion) throw new Error('Confirme o cancele la migración pendiente antes de crear una copia.');
    _iniciarOperacion();
    _notificarBackup('en_curso', { mensaje: 'Creando copia de seguridad del estado confirmado.' });
    try {
      const destino = await _seleccionarDestinoBackup(enCarpeta);
      if (!destino) {
        _notificarBackup('cancelada', { mensaje: 'Copia de seguridad cancelada. No se escribieron datos.' });
        return { ok: false, cancelado: true };
      }
      if (destino.archivo === _conexion.archivo) throw new Error('El respaldo debe ser distinto del archivo activo.');
      if (typeof destino.archivo.isSameEntry !== 'function') {
        throw new Error('No se pudo verificar la identidad del destino. No se escribió el respaldo.');
      }
      if (await destino.archivo.isSameEntry(_conexion.archivo)) throw new Error('El respaldo debe ser distinto del archivo activo.');
      if ((await _leerBinario(destino.archivo)).length) throw new Error('El destino contiene datos. No se sobrescribió.');
      const datos = _exportar(_db);
      const origen = _validarBackupBinario(datos);
      if (!origen.valido) throw new Error(origen.mensaje);
      const leido = await _escribirVerificado(destino.archivo, datos);
      const validacion = _validarBackupBinario(leido);
      if (!validacion.valido) throw new Error(validacion.mensaje);
      const resultado = { ok: true, nombre: destino.archivo.name, ubicacion: destino.ubicacion,
        tamano: leido.length, versionEsquema: validacion.versionEsquema };
      _notificarBackup('exitosa', { ...resultado, mensaje: 'Copia de seguridad escrita, cerrada y validada.' });
      return resultado;
    } catch (e) {
      const error = new Error('El respaldo no pudo confirmarse: ' + e.message, { cause: e });
      _registrarError(error);
      _notificarBackup('fallida', { mensaje: error.message });
      throw error;
    } finally {
      _finalizarOperacion();
    }
  }

  async function _respaldar(solicitud, destino) {
    const versionDestino = Math.max(1, solicitud.versionOriginal + 1);
    if (!destino) {
      const carpeta = solicitud.conexion.carpeta;
      const nombre = 'vertex.pre-v' + versionDestino + '.' + Date.now() + '.' +
        Math.random().toString(36).slice(2, 10) + '.db';
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
    await _escribirVerificado(destino, solicitud.original);
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
        suggestedName: 'vertex.pre-v' + Math.max(1, solicitud.versionOriginal + 1) + '.' + Date.now() + '.db',
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
      await _comprobarPermiso(_conexion);
      const archivoActual = await _leerBinario(_conexion.archivo);
      const confirmado = _exportar(_db);
      if (!_iguales(archivoActual, confirmado)) {
        throw new Error('El archivo SQLite cambió fuera de VERTEX. No se sobrescribió; seleccione nuevamente la base y revise los datos antes de reintentar.');
      }
      // El estado visible solo cambia después de confirmar la escritura al disco.
      candidata = new _SQL.Database(confirmado);
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
    consultar, transaccion, validarBackup, crearBackup, prepararRestauracion, cancelarRestauracion, restaurarBackup, listarHistorialBackups,
    getProyectos, saveProyecto, deleteProyecto,
    exportarDB() {
      if (_ocupado) throw new Error('Hay una operación de base de datos en curso. Espere antes de exportar.');
      return _db ? _exportar(_db) : null;
    },
    get estado() { return _estado(); },
    get useSQLite() { return !!_SQL; },
    get tieneArchivo() { return !!_conexion; },
    get esperaPermiso() { return !!_pendiente; },
    get ocupado() { return _ocupado; },
    get hasFSA() { return typeof window.showDirectoryPicker === 'function'; }
  };
})();
