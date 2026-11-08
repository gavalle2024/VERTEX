'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

let SQL;
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8');
const migraciones = fs.readFileSync(path.join(__dirname, '..', 'js', 'migraciones.js'), 'utf8');
const trabajoSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'trabajo.js'), 'utf8');
const sqlJsDir = path.join(__dirname, 'vendor', 'sql.js', '1.10.2');
const proyecto = {
  id: 'p1', nombre: 'Prueba', responsable: 'Responsable', division: 'URSA',
  inicio: '2026-10-23', meta: '', fin: '', estado: 'En curso', avance: 25,
  implementacion: 'Piloto / Prueba', cumplimiento: 'En curso (pendiente de evaluar)',
  objetivo: 'Objetivo', resultado: '', observaciones: ''
};

before(async () => {
  const sqlJsSource = fs.readFileSync(path.join(sqlJsDir, 'sql-wasm.js'), 'utf8');
  const wasmBinary = new Uint8Array(fs.readFileSync(path.join(sqlJsDir, 'sql-wasm.wasm')));
  const context = vm.createContext({
    console, WebAssembly, TextDecoder, TextEncoder, setTimeout, clearTimeout,
    crypto: require('node:crypto').webcrypto
  });
  vm.runInContext(sqlJsSource, context);
  SQL = await context.initSqlJs({ wasmBinary });
});

function archivo(nombre = 'vertex.db', inicial = new Uint8Array()) {
  return {
    kind: 'file', name: nombre, datos: inicial, fallo: false, escrituras: 0, permiso: 'granted',
    writableCreados: 0, abortos: 0,
    async isSameEntry(otro) { return this === otro; },
    async queryPermission() { return this.permiso; },
    async requestPermission() { return this.permiso; },
    async getFile() {
      if (this.errorLectura) throw this.errorLectura;
      const copia = this.datos.slice();
      return { arrayBuffer: async () => copia.buffer };
    },
    async createWritable() {
      if (this.errorWritable) throw this.errorWritable;
      this.writableCreados++;
      const file = this;
      let temporal;
      return {
        async write(data) {
          if (file.errorEscritura) throw file.errorEscritura;
          if (file.fallo) throw new Error('Disco sin espacio');
          temporal = data.slice();
        },
        async close() {
          if (file.esperarCierre) await file.esperarCierre;
          if (file.falloCierre) throw new Error('Error al cerrar el archivo');
          file.datos = temporal;
          file.escrituras++;
        },
        async abort() {
          file.abortos++;
          if (file.errorAbort) throw file.errorAbort;
          temporal = undefined;
        }
      };
    }
  };
}

function archivoDestinoNuevo(nombre) {
  const destino = archivo(nombre);
  let existe = false;
  const crearWritable = destino.createWritable.bind(destino);
  destino.getFile = async () => {
    if (!existe) { const error = new Error('No existe'); error.name = 'NotFoundError'; throw error; }
    const copia = destino.datos.slice();
    return { arrayBuffer: async () => copia.buffer };
  };
  destino.createWritable = async () => {
    const writable = await crearWritable();
    return {
      write: data => writable.write(data),
      async close() { await writable.close(); existe = true; },
      abort: error => writable.abort(error)
    };
  };
  return destino;
}

function carpeta(file = null) {
  return {
    kind: 'directory', name: 'Datos PSA', file, creaciones: 0, respaldos: new Map(),
    async getFileHandle(nombre, options) {
      if (nombre !== 'vertex.db') {
        if (this.respaldos.has(nombre)) return this.respaldos.get(nombre);
        if (options && options.create) {
          const respaldo = archivo(nombre);
          this.respaldos.set(nombre, respaldo);
          return respaldo;
        }
        const e = new Error('No existe');
        e.name = 'NotFoundError';
        throw e;
      }
      if (!this.file) {
        if (!options || !options.create) {
          const e = new Error('No existe');
          e.name = 'NotFoundError';
          throw e;
        }
        this.file = archivo();
        this.creaciones++;
      }
      return this.file;
    }
  };
}

function entorno(guardado, opciones = {}) {
  const store = new Map(guardado ? [['vertex_db', guardado]] : []);
  const eventos = [];
  const window = {
    PSA: {}, confirmar: true, seleccion: carpeta(),
    confirm() { return this.confirmar; },
    async showDirectoryPicker() {
      if (this.errorSelector) throw this.errorSelector;
      return this.seleccion;
    },
    dispatchEvent(e) { eventos.push(e.detail); }
  };
  const indexedDB = {
    open() {
      const req = {};
      queueMicrotask(() => {
        if (opciones.idbError) {
          req.error = new Error('IndexedDB bloqueado');
          req.onerror();
          return;
        }
        req.result = {
          close() {},
          transaction() {
            const tx = {
              objectStore() {
                return {
                  get(key) {
                    const result = { result: store.get(key) };
                    queueMicrotask(() => { if (result.onsuccess) result.onsuccess(); tx.oncomplete(); });
                    return result;
                  },
                  put(value, key) {
                    store.set(key, value);
                    queueMicrotask(() => tx.oncomplete());
                    return {};
                  }
                };
              }
            };
            return tx;
          }
        };
        req.onsuccess();
      });
      return req;
    }
  };
  const context = vm.createContext({
    window, indexedDB, console: { error() {}, warn() {} },
    initSqlJs: async () => {
      if (opciones.sqlError) throw new Error('Motor no disponible');
      return SQL;
    },
    Date,
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data.detail; } }
  });
  vm.runInContext(migraciones, context);
  vm.runInContext(source, context);
  let secuencia = 0;
  window.PSA.genId = () => 'nuevo-' + (++secuencia);
  vm.runInContext(trabajoSource, context);
  return { db: window.PSA.DB, trabajo: window.PSA.Trabajo, esquema: window.PSA.Esquema, window, store, eventos };
}

test('crea SQLite real, guarda, edita, elimina y restaura entre sesiones', async () => {
  const app = entorno();
  await app.db.init();
  assert.equal(app.db.tieneArchivo, false);
  await app.db.configurarCarpeta();
  const file = app.window.seleccion.file;
  assert.equal(Buffer.from(file.datos.slice(0, 16)).toString(), 'SQLite format 3\0');
  await app.db.saveProyecto(proyecto, true);
  const copia = new SQL.Database(file.datos);
  assert.equal(copia.exec('SELECT nombre FROM proyectos')[0].values[0][0], 'Prueba');
  copia.close();
  await app.db.saveProyecto({ ...proyecto, avance: 100, estado: 'Completado' }, false);
  const siguiente = entorno(app.store.get('vertex_db'));
  await siguiente.db.init();
  assert.equal(siguiente.db.getProyectos()[0].avance, 100);
  assert.equal(siguiente.db.estado.ubicacion, 'Datos PSA / vertex.db');
  await siguiente.db.deleteProyecto('p1');
  const tercera = entorno(app.store.get('vertex_db'));
  await tercera.db.init();
  assert.equal(tercera.db.getProyectos().length, 0);
});

test('el guardado espera close, bloquea operaciones concurrentes y publica estado', async () => {
  const app = entorno();
  await app.db.init();
  await app.db.configurarCarpeta();
  let liberar;
  app.window.seleccion.file.esperarCierre = new Promise(resolve => { liberar = resolve; });
  const guardando = app.db.saveProyecto(proyecto, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.db.ocupado, true);
  assert.equal(app.db.getProyectos().length, 0);
  await assert.rejects(app.db.deleteProyecto('p1'), /operación.*curso/);
  await assert.rejects(app.db.configurarCarpeta(), /operación.*curso/);
  liberar();
  await guardando;
  assert.equal(app.db.ocupado, false);
  assert.equal(app.db.getProyectos().length, 1);
  assert.ok(app.eventos.some(e => e.ocupado));
  assert.equal(app.eventos.at(-1).ocupado, false);
});

test('errores de escritura y cierre conservan archivo, datos visibles y permiten reintentar', async () => {
  const app = entorno();
  await app.db.init();
  await app.db.configurarCarpeta();
  await app.db.saveProyecto(proyecto, true);
  const file = app.window.seleccion.file;
  const anterior = file.datos.slice();
  for (const tipo of ['fallo', 'falloCierre']) {
    file[tipo] = true;
    await assert.rejects(app.db.deleteProyecto('p1'), /Disco sin espacio|Error al cerrar/);
    assert.equal(app.db.getProyectos().length, 1);
    assert.deepEqual(file.datos, anterior);
    assert.ok(app.db.estado.error);
    assert.equal(app.db.ocupado, false);
    file[tipo] = false;
  }
  await app.db.deleteProyecto('p1');
  assert.equal(app.db.getProyectos().length, 0);
  assert.equal(app.db.estado.error, '');
});

test('cancelar o abrir una base corrupta/incompatible no reemplaza la conexión ni sobrescribe datos', async () => {
  const app = entorno();
  await app.db.init();
  await app.db.configurarCarpeta();
  await app.db.saveProyecto(proyecto, true);
  const anterior = app.window.seleccion;
  const cancelado = new Error('Cancelado');
  cancelado.name = 'AbortError';
  app.window.errorSelector = cancelado;
  assert.equal((await app.db.configurarCarpeta()).cancelado, true);
  app.window.errorSelector = null;
  const incompatible = new SQL.Database();
  incompatible.run('CREATE TABLE proyectos (id TEXT)');
  for (const datos of [new Uint8Array([1, 2, 3, 4]), incompatible.export()]) {
    const file = archivo('vertex.db', datos);
    app.window.seleccion = carpeta(file);
    await assert.rejects(app.db.configurarCarpeta());
    assert.deepEqual(file.datos, datos);
    assert.equal(file.escrituras, 0);
    assert.equal(app.db.getProyectos()[0].id, 'p1');
    assert.equal(app.store.get('vertex_db').carpeta, anterior);
  }
  incompatible.close();
});

test('rechaza un archivo SQLite existente vacío sin alterar la conexión activa', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const conexionAnterior = app.window.seleccion;
  const bytesAnteriores = conexionAnterior.file.datos.slice();
  const vacio = archivo('vertex.db', new Uint8Array());
  app.window.seleccion = carpeta(vacio);

  await assert.rejects(app.db.configurarCarpeta(), /archivo SQLite existente está vacío/);

  assert.equal(app.db.tieneArchivo, true);
  assert.equal(app.db.getProyectos()[0].id, 'p1');
  assert.ok(app.store.get('vertex_db').carpeta === conexionAnterior);
  assert.equal(vacio.escrituras, 0);
  assert.deepEqual(conexionAnterior.file.datos, bytesAnteriores);
});

const escenariosA3 = [
  ['A3-01', 'SQLite válida'], ['A3-02', 'archivo inexistente'], ['A3-03', 'archivo vacío'],
  ['A3-04', 'archivo no SQLite'], ['A3-05', 'esquema inválido'], ['A3-06', 'base nueva'],
  ['A3-07', 'permiso de lectura'], ['A3-08', 'permiso de escritura'], ['A3-09', 'permiso denegado'],
  ['A3-10', 'permiso revocado'], ['A3-11', 'archivo bloqueado'], ['A3-12', 'createWritable fallido'],
  ['A3-13', 'write fallido'], ['A3-14', 'close fallido'], ['A3-15', 'escritura abortada'],
  ['A3-16', 'reapertura'], ['A3-17', 'reintento'], ['A3-18', 'handle IndexedDB inválido'],
  ['A3-19', 'API no disponible'], ['A3-20', 'guardados simultáneos']
];

function errorArchivoPrueba(nombre, mensaje = nombre) {
  const error = new Error(mensaje);
  error.name = nombre;
  return error;
}

for (const [id, nombre] of escenariosA3) {
  test(id + ': ' + nombre, async () => {
    const app = await entornoNuevo();
    await app.db.saveProyecto(proyecto, true);
    const file = app.window.seleccion.file;
    const original = file.datos.slice();
    const escrituras = file.escrituras;
    const cambio = { ...proyecto, nombre: 'Cambio A3' };
    if (['A3-01', 'A3-07', 'A3-16'].includes(id)) {
      const reapertura = entorno(file);
      await reapertura.db.init();
      assert.equal(reapertura.db.tieneArchivo, true);
      assert.equal(reapertura.db.getProyectos()[0].nombre, 'Prueba');
      assert.equal(file.escrituras, escrituras);
    } else if (['A3-02', 'A3-03', 'A3-04', 'A3-05'].includes(id)) {
      let datos = id === 'A3-04' ? new Uint8Array([1, 2, 3]) : new Uint8Array();
      if (id === 'A3-05') {
        const incompatible = new SQL.Database();
        incompatible.run('CREATE TABLE otra (id TEXT)');
        datos = incompatible.export();
        incompatible.close();
      }
      const candidata = archivo('vertex.db', datos);
      if (id === 'A3-02') candidata.errorLectura = errorArchivoPrueba('NotFoundError');
      app.window.seleccion = carpeta(candidata);
      await assert.rejects(app.db.configurarCarpeta(), id === 'A3-02' ? /Archivo no encontrado/ : /vacío|inválido/);
      assert.equal(candidata.escrituras, 0);
      assert.deepEqual(candidata.datos, datos);
      assert.equal(app.db.getProyectos()[0].nombre, 'Prueba');
      assert.deepEqual(file.datos, original);
    } else if (id === 'A3-06') {
      app.window.seleccion = carpeta();
      await app.db.configurarCarpeta();
      assert.equal(app.window.seleccion.creaciones, 1);
      assert.equal(app.db.getProyectos().length, 0);
      assert.equal(app.db.consultar('SELECT count(*) AS cantidad FROM tarjetas')[0].cantidad, 0);
      assert.deepEqual(file.datos, original);
    } else if (id === 'A3-08') {
      await app.db.saveProyecto(cambio, false);
      assert.equal(file.escrituras, escrituras + 1);
      const reapertura = entorno(file);
      await reapertura.db.init();
      assert.equal(reapertura.db.getProyectos()[0].nombre, 'Cambio A3');
    } else if (['A3-09', 'A3-10'].includes(id)) {
      file.permiso = id === 'A3-09' ? 'denied' : 'prompt';
      await assert.rejects(app.db.saveProyecto(cambio, false), /Permiso denegado o revocado/);
      assert.equal(app.db.esperaPermiso, true);
      await assert.rejects(app.db.solicitarPermiso(), /Permiso denegado/);
      assert.equal(app.db.getProyectos()[0].nombre, 'Prueba');
      assert.deepEqual(file.datos, original);
      file.permiso = 'granted';
      assert.equal((await app.db.solicitarPermiso()).reautorizada, true);
      assert.equal(app.db.getProyectos()[0].nombre, 'Prueba');
      await app.db.saveProyecto(cambio, false);
      assert.equal(app.db.getProyectos()[0].nombre, 'Cambio A3');
    } else if (['A3-11', 'A3-12', 'A3-13', 'A3-14', 'A3-15', 'A3-17'].includes(id)) {
      if (id === 'A3-11') file.errorWritable = errorArchivoPrueba('NoModificationAllowedError');
      if (id === 'A3-12') file.errorWritable = new Error('Fallo createWritable');
      if (['A3-13', 'A3-17'].includes(id)) file.fallo = true;
      if (id === 'A3-14') file.falloCierre = true;
      if (id === 'A3-15') file.errorEscritura = errorArchivoPrueba('AbortError');
      await assert.rejects(app.db.saveProyecto(cambio, false), /Escritura SQLite no confirmada/);
      assert.equal(file.abortos, ['A3-11', 'A3-12'].includes(id) ? 0 : 1);
      assert.equal(file.escrituras, escrituras);
      assert.deepEqual(file.datos, original);
      assert.equal(app.db.getProyectos()[0].nombre, 'Prueba');
      assert.equal(app.db.ocupado, false);
      assert.match(app.eventos.at(-1).error, /Escritura SQLite no confirmada/);
      file.errorWritable = null;
      file.errorEscritura = null;
      file.fallo = false;
      file.falloCierre = false;
      await app.db.saveProyecto(cambio, false);
      assert.equal(app.db.getProyectos()[0].nombre, 'Cambio A3');
    } else if (id === 'A3-18') {
      const rota = entorno({ archivo: { kind: 'file' }, carpeta: null });
      const estado = await rota.db.init();
      assert.match(estado.error, /IndexedDB es inválido/);
      assert.equal(estado.esperaPermiso, false);
      await rota.db.configurarCarpeta();
      assert.equal(rota.db.tieneArchivo, true);
    } else if (id === 'A3-19') {
      app.window.showDirectoryPicker = undefined;
      await assert.rejects(app.db.configurarCarpeta(), /Chrome o Edge/);
      await assert.rejects(app.db.conectarArchivo(), /selección de archivos/);
      assert.equal(app.db.hasFSA, false);
      assert.deepEqual(file.datos, original);
    } else if (id === 'A3-20') {
      let liberar;
      file.esperarCierre = new Promise(resolve => { liberar = resolve; });
      const pendiente = app.db.saveProyecto(cambio, false);
      const segundo = app.db.saveProyecto({ ...cambio, nombre: 'No guardar' }, false);
      await assert.rejects(segundo, /operación.*curso/);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(file.escrituras, escrituras);
      assert.equal(app.db.getProyectos()[0].nombre, 'Prueba');
      liberar();
      await pendiente;
      assert.equal(file.escrituras, escrituras + 1);
      assert.equal(app.db.getProyectos()[0].nombre, 'Cambio A3');
    }
  });
}

test('A3-21: cambios externos y desaparición durante una sesión no se sobrescriben', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const file = app.window.seleccion.file;
  const original = file.datos.slice();
  file.errorLectura = errorArchivoPrueba('NotFoundError');
  await assert.rejects(app.db.saveProyecto({ ...proyecto, nombre: 'No guardar' }, false), /Archivo no encontrado/);
  file.errorLectura = null;
  file.datos = new Uint8Array([1, 2, 3]);
  await assert.rejects(app.db.saveProyecto(proyecto, false), /cambió fuera de VERTEX/);
  assert.deepEqual(Array.from(file.datos), [1, 2, 3]);
  assert.equal(app.db.getProyectos()[0].nombre, 'Prueba');
  file.datos = original;
  await app.db.saveProyecto(proyecto, false);
});

test('A3-22: falla de abort conserva el error original sin publicar cambios', async () => {
  const app = await entornoNuevo();
  const file = app.window.seleccion.file;
  file.fallo = true;
  file.errorAbort = new Error('Fallo abort');
  await assert.rejects(app.db.saveProyecto(proyecto, true), /Disco sin espacio/);
  assert.equal(file.abortos, 1);
  assert.equal(app.db.getProyectos().length, 0);
});

test('A3-23: selector de apertura rechaza vacíos y conserva la conexión previa', async () => {
  const app = await entornoNuevo();
  const anterior = app.window.seleccion.file;
  app.window.showOpenFilePicker = async () => [archivo()];
  await assert.rejects(app.db.conectarArchivo(), /existente está vacío/);
  assert.equal(app.db.tieneArchivo, true);
  app.window.showOpenFilePicker = async () => [anterior];
  assert.equal((await app.db.conectarArchivo()).ok, true);
  app.window.showOpenFilePicker = async () => { throw errorArchivoPrueba('AbortError'); };
  assert.equal((await app.db.conectarArchivo()).cancelado, true);
});

test('A3-24: restauración inaccesible y selector denegado permiten recuperación manual', async () => {
  const creadora = await entornoNuevo();
  const file = creadora.window.seleccion.file;
  file.errorLectura = errorArchivoPrueba('NotReadableError');
  const app = entorno(file);
  const estado = await app.db.init();
  assert.match(estado.error, /inaccesible para lectura/);
  assert.equal(estado.tieneArchivo, false);
  assert.equal(estado.esperaPermiso, false);
  app.window.errorSelector = errorArchivoPrueba('NotAllowedError');
  await assert.rejects(app.db.configurarCarpeta(), /Permiso denegado o revocado/);
  app.window.errorSelector = null;
  await app.db.configurarCarpeta();
  assert.equal(app.db.tieneArchivo, true);
});

test('A3-25: una marca nueva recordada no permite sobrescribir un archivo existente vacío', async () => {
  const file = archivo();
  const app = entorno({ archivo: file, carpeta: null, nueva: true });
  const estado = await app.db.init();
  assert.match(estado.error, /existente está vacío/);
  assert.equal(estado.tieneArchivo, false);
  assert.equal(file.escrituras, 0);
});

test('B2: valida copia íntegra en una instancia independiente sin modificar origen ni conexión', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Validación sintética' });
  const lista = app.trabajo.getListas(tablero)[0].id;
  await app.trabajo.guardarTarjeta({ lista_id: lista, titulo: 'Tarjeta sintética' });
  const original = app.db.exportarDB();
  const file = archivo('copia-sintetica.db', original.slice());
  const conexion = app.store.get('vertex_db');
  const resultado = await app.db.validarBackup(file);
  assert.equal(resultado.valido, true);
  assert.equal(resultado.versionEsquema, 3);
  assert.equal(resultado.consultas.proyectos, 1);
  assert.equal(resultado.consultas.tableros, 1);
  assert.equal(resultado.consultas.tarjetas, 1);
  assert.ok(resultado.consultas.actividad > 0);
  assert.equal(file.escrituras, 0);
  assert.deepEqual(file.datos, original);
  assert.ok(app.store.get('vertex_db') === conexion);
  assert.deepEqual(app.db.exportarDB(), original);
});

for (const tipo of ['vacío', 'no SQLite', 'truncado', 'página truncada', 'corrupto', 'versión antigua', 'versión futura', 'tabla ausente', 'índice ausente', 'FK inválida']) {
  test('B2: rechaza ' + tipo + ' sin modificar el archivo ni migrar', async () => {
    const app = await entornoNuevo();
    let datos = app.db.exportarDB();
    let codigo;
    if (tipo === 'vacío') { datos = new Uint8Array(); codigo = 'archivo_vacio'; }
    else if (tipo === 'no SQLite') { datos = new Uint8Array([1, 2, 3]); codigo = 'archivo_invalido'; }
    else if (tipo === 'truncado') { datos = datos.slice(0, 80); codigo = 'archivo_incompleto'; }
    else if (tipo === 'página truncada') { datos = datos.slice(0, datos.length - 1); codigo = 'archivo_incompleto'; }
    else if (tipo === 'corrupto') { datos = datos.slice(); datos[100] = 255; codigo = 'integridad'; }
    else if (tipo === 'versión antigua') { datos = baseLegacy(); codigo = 'esquema_incompatible'; }
    else {
      const sintesis = new SQL.Database(datos);
      if (tipo === 'versión futura') sintesis.run('PRAGMA user_version=99');
      if (tipo === 'tabla ausente') sintesis.run('DROP TABLE actividad');
      if (tipo === 'índice ausente') sintesis.run('DROP INDEX idx_tarjetas_vencimiento');
      if (tipo === 'FK inválida') {
        sintesis.run('PRAGMA foreign_keys=OFF');
        sintesis.run("INSERT INTO tableros (id,proyecto_id,nombre) VALUES ('huérfano','inexistente','Sintético')");
      }
      datos = sintesis.export();
      sintesis.close();
      codigo = tipo === 'FK inválida' ? 'integridad' : 'esquema_incompatible';
    }
    const file = archivo('copia-prueba.db', datos.slice());
    app.esquema.migrar = () => { throw new Error('No debe migrar una validación'); };
    const resultado = await app.db.validarBackup(file);
    assert.equal(resultado.valido, false);
    assert.equal(resultado.codigo, codigo);
    assert.equal(file.escrituras, 0);
    assert.deepEqual(file.datos, datos);
    assert.equal(app.db.tieneArchivo, true);
    assert.equal(app.db.ocupado, false);
  });
}

test('B2: error de lectura se propaga y permite validar de nuevo', async () => {
  const app = await entornoNuevo();
  const file = archivo('copia-prueba.db', app.db.exportarDB());
  file.errorLectura = errorArchivoPrueba('NotReadableError');
  await assert.rejects(app.db.validarBackup(file), /Lectura SQLite/);
  assert.equal(app.db.ocupado, false);
  file.errorLectura = null;
  assert.equal((await app.db.validarBackup(file)).valido, true);
});

test('B4: historial independiente registra validación y restauración sin datos funcionales', async () => {
  const app = await entornoNuevo();
  const backup = archivo('historial-sintetico.db', app.db.exportarDB());
  const validacion = await app.db.validarBackup(backup);
  assert.equal(validacion.valido, true);
  assert.equal((await app.db.prepararRestauracion(backup)).preparada, true);
  const historial = await app.db.listarHistorialBackups();
  assert.ok(historial.length >= 2);
  assert.ok(historial.some(item => item.tipo === 'validacion' && item.resultado === 'valida'));
  assert.ok(historial.some(item => item.tipo === 'restauracion' && item.resultado === 'preparada'));
  for (const item of historial) {
    assert.ok(item.fecha);
    assert.ok(item.versionApp);
    assert.equal(Object.hasOwn(item, 'datos'), false);
    assert.equal(Object.hasOwn(item, 'contenido'), false);
  }
  app.db.cancelarRestauracion();
});

test('B3: acepta un File del selector HTML sin FileSystemFileHandle y restaura a un destino nuevo', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const bytes = app.db.exportarDB();
  const fileInput = {
    name: 'respaldo-seleccion-html.db',
    size: bytes.length,
    type: 'application/octet-stream',
    async arrayBuffer() { return bytes.slice().buffer; }
  };

  const validacion = await app.db.validarBackup(fileInput);
  assert.equal(validacion.valido, true);
  const preparada = await app.db.prepararRestauracion(fileInput);
  assert.equal(preparada.preparada, true);
  assert.equal(preparada.nombre, fileInput.name);

  const conexion = app.store.get('vertex_db');
  const activo = app.window.seleccion.file;
  const activoAntes = activo.datos.slice();
  const carpetaDestino = carpeta();
  app.window.seleccion = carpetaDestino;
  const resultado = await app.db.restaurarBackup();

  assert.equal(resultado.ok, true);
  assert.equal(resultado.conexionActivaConservada, true);
  assert.equal(app.store.get('vertex_db'), conexion);
  assert.equal(Buffer.from(activo.datos).equals(Buffer.from(activoAntes)), true);
  const destino = carpetaDestino.respaldos.get(resultado.nombre);
  assert.ok(destino);
  assert.equal(Buffer.from(destino.datos).equals(Buffer.from(bytes)), true);
  assert.notEqual(destino.name, fileInput.name);
  assert.equal(app.db.ocupado, false);
});

test('B2: valida File del selector HTML y rechaza contenido inválido con diagnóstico', async () => {
  const app = await entornoNuevo();
  const bytes = app.db.exportarDB();
  const fileValido = { name: 'seleccion-html.db', async arrayBuffer() { return bytes.slice().buffer; } };
  const fileInvalido = { name: 'seleccion-html-invalido.db', async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } };
  assert.equal((await app.db.validarBackup(fileValido)).valido, true);
  const invalido = await app.db.validarBackup(fileInvalido);
  assert.equal(invalido.valido, false);
  assert.equal(invalido.codigo, 'archivo_invalido');
});

test('B3: prepara un respaldo válido y lo restaura a un archivo nuevo sin cambiar la conexión activa', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const bytes = app.db.exportarDB();
  const origen = archivo('respaldo-valido.db', bytes.slice());
  const conexion = app.store.get('vertex_db');
  const handleActivo = app.window.seleccion.file;
  const activoAntes = handleActivo.datos.slice();
  const preparada = await app.db.prepararRestauracion(origen);
  assert.equal(preparada.preparada, true);
  assert.equal(preparada.versionEsquema, 3);
  const destinoFolder = carpeta();
  app.window.seleccion = destinoFolder;
  const resultado = await app.db.restaurarBackup();
  assert.equal(resultado.ok, true);
  assert.equal(resultado.conexionActivaConservada, true);
  assert.equal(app.store.get('vertex_db'), conexion);
  assert.deepEqual(handleActivo.datos, activoAntes);
  assert.equal(Buffer.from(origen.datos).equals(Buffer.from(bytes)), true);
  const destino = destinoFolder.respaldos.get(resultado.nombre);
  assert.ok(destino);
  assert.equal(destino.escrituras, 1);
  assert.equal(Buffer.from(destino.datos).equals(Buffer.from(bytes)), true);
  const restaurada = new SQL.Database(destino.datos);
  assert.equal(restaurada.exec('SELECT nombre FROM proyectos')[0].values[0][0], 'Prueba');
  restaurada.close();
  assert.equal(app.db.ocupado, false);
});

test('B3: selector de archivo de destino crea un archivo nuevo y muestra confirmación antes de escribir', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const bytes = app.db.exportarDB();
  const origen = { name: 'respaldo-file-picker.db', async arrayBuffer() { return bytes.slice().buffer; } };
  assert.equal((await app.db.prepararRestauracion(origen)).preparada, true);
  const destino = archivoDestinoNuevo('vertex_restaurada_prueba.db');
  let opciones;
  app.window.showSaveFilePicker = async valor => { opciones = valor; return destino; };
  let confirmaciones = 0;
  app.window.confirm = mensaje => { confirmaciones++; assert.match(mensaje, /vertex_restaurada_prueba.db/); return true; };
  const resultado = await app.db.restaurarBackup();
  assert.equal(resultado.ok, true);
  assert.equal(resultado.nombre, destino.name);
  assert.equal(confirmaciones, 1);
  assert.equal(opciones.suggestedName.endsWith('.db'), true);
  assert.equal(Buffer.from(destino.datos).equals(Buffer.from(bytes)), true);
  assert.equal(app.db.ocupado, false);
});

test('B3: rechaza respaldo inválido y no permite iniciar restauración', async () => {
  const app = await entornoNuevo();
  const invalido = archivo('invalido.db', new Uint8Array([1, 2, 3]));
  const resultado = await app.db.prepararRestauracion(invalido);
  assert.equal(resultado.preparada, false);
  assert.equal(resultado.validacion.valido, false);
  await assert.rejects(app.db.restaurarBackup(), /Primero seleccione y valide/);
  assert.equal(invalido.escrituras, 0);
  assert.equal(app.db.ocupado, false);
});

test('B3: cancelar selector conserva respaldo preparado y no crea archivos', async () => {
  const app = await entornoNuevo();
  const origen = archivo('respaldo.db', app.db.exportarDB());
  assert.equal((await app.db.prepararRestauracion(origen)).preparada, true);
  const cancelado = new Error('Cancelado');
  cancelado.name = 'AbortError';
  app.window.errorSelector = cancelado;
  const resultado = await app.db.restaurarBackup();
  assert.equal(resultado.cancelado, true);
  assert.equal(resultado.preparada, true);
  assert.equal(app.db.ocupado, false);
  assert.equal(app.db.cancelarRestauracion(), true);
  assert.equal(app.db.cancelarRestauracion(), false);
});

test('B3: cancelar la confirmación no crea archivos ni descarta la copia preparada', async () => {
  const app = await entornoNuevo();
  const origen = archivo('respaldo.db', app.db.exportarDB());
  assert.equal((await app.db.prepararRestauracion(origen)).preparada, true);
  const destinoFolder = carpeta();
  app.window.seleccion = destinoFolder;
  app.window.confirmar = false;
  const resultado = await app.db.restaurarBackup();
  assert.equal(resultado.cancelado, true);
  assert.equal(resultado.preparada, true);
  assert.equal(destinoFolder.respaldos.size, 0);
  assert.equal(app.db.ocupado, false);
  assert.equal(app.db.cancelarRestauracion(), true);
});

test('B3: un error de escritura no altera la conexión activa y permite cancelar la preparación', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const origen = archivo('respaldo.db', app.db.exportarDB());
  const conexion = app.store.get('vertex_db');
  const handleActivo = app.window.seleccion.file;
  const activa = handleActivo.datos.slice();
  assert.equal((await app.db.prepararRestauracion(origen)).preparada, true);
  const destinoFolder = carpeta();
  destinoFolder.getFileHandle = async function (nombre, options) {
    if (nombre === 'vertex.db') return this.file;
    if (this.respaldos.has(nombre)) return this.respaldos.get(nombre);
    if (options && options.create) {
      const nuevo = archivo(nombre);
      nuevo.fallo = true;
      this.respaldos.set(nombre, nuevo);
      return nuevo;
    }
    const error = new Error('No existe'); error.name = 'NotFoundError'; throw error;
  };
  app.window.seleccion = destinoFolder;
  await assert.rejects(app.db.restaurarBackup(), /No se pudo completar la restauración/);
  assert.equal(app.store.get('vertex_db'), conexion);
  assert.deepEqual(handleActivo.datos, activa);
  assert.equal(app.db.getProyectos().length, 1);
  assert.equal(app.db.cancelarRestauracion(), true);
  assert.equal(app.db.ocupado, false);
});

test('B2: no valida ni guarda simultáneamente con una lectura pendiente', async () => {
  const app = await entornoNuevo();
  const datos = app.db.exportarDB();
  let liberar;
  const esperando = new Promise(resolve => { liberar = resolve; });
  const file = archivo('copia-prueba.db', datos);
  file.getFile = async () => { await esperando; return { arrayBuffer: async () => datos.buffer }; };
  const validando = app.db.validarBackup(file);
  await assert.rejects(app.db.validarBackup(file), /operación.*curso/);
  await assert.rejects(app.db.saveProyecto(proyecto, true), /operación.*curso/);
  liberar();
  assert.equal((await validando).valido, true);
  assert.equal(app.db.getProyectos().length, 0);
});

test('B1: crea respaldo validado sin leer el archivo activo ni cambiar conexión o datos', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const datos = app.db.exportarDB();
  const conexion = app.store.get('vertex_db');
  const activo = app.window.seleccion.file;
  const destino = archivo('VERTEX_backup_prueba.db');
  activo.errorLectura = new Error('No debe leer el archivo activo para respaldar el estado confirmado');
  let sugerido;
  app.window.showSaveFilePicker = async opciones => { sugerido = opciones.suggestedName; return destino; };
  const resultado = await app.db.crearBackup();
  assert.match(sugerido, /^VERTEX_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.db$/);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.tamano, datos.length);
  assert.equal(resultado.versionEsquema, 3);
  assert.equal(resultado.ubicacion, destino.name);
  assert.equal(destino.escrituras, 1);
  assert.deepEqual(destino.datos, datos);
  assert.deepEqual(activo.datos, datos);
  assert.ok(app.store.get('vertex_db') === conexion);
  assert.deepEqual(app.db.exportarDB(), datos);
  assert.ok(app.eventos.some(evento => evento.estado === 'en_curso'));
  assert.ok(app.eventos.some(evento => evento.estado === 'exitosa' && evento.tamano === datos.length));
  assert.equal((await app.db.validarBackup(destino)).valido, true);
});

test('B1: crea copia en carpeta independiente sin reemplazar archivos existentes', async () => {
  const app = await entornoNuevo();
  const activa = app.store.get('vertex_db');
  const destino = carpeta();
  destino.name = 'Respaldos sintéticos';
  app.window.showDirectoryPicker = async () => destino;
  const resultado = await app.db.crearBackup({ enCarpeta: true });
  assert.equal(resultado.ok, true);
  assert.ok(resultado.ubicacion.startsWith('Respaldos sintéticos / VERTEX_backup_'));
  assert.equal(destino.respaldos.size, 1);
  assert.ok(app.store.get('vertex_db') === activa);
  const existente = archivo('copia-existente.db', new Uint8Array([5, 6, 7]));
  destino.getFileHandle = async () => existente;
  await assert.rejects(app.db.crearBackup({ enCarpeta: true }), /Ya existe un respaldo/);
  assert.equal(existente.escrituras, 0);
  assert.deepEqual(Array.from(existente.datos), [5, 6, 7]);
});

for (const tipo of ['activo', 'alias activo', 'con contenido', 'identidad no verificable']) {
  test('B1: rechaza destino ' + tipo + ' antes de escribir', async () => {
    const app = await entornoNuevo();
    const activo = app.window.seleccion.file;
    const original = activo.datos.slice();
    const destino = tipo === 'activo' ? activo : archivo('destino.db');
    if (tipo === 'alias activo') destino.isSameEntry = async () => true;
    if (tipo === 'con contenido') destino.datos = new Uint8Array([9]);
    if (tipo === 'identidad no verificable') destino.isSameEntry = undefined;
    const escrituras = destino.escrituras;
    app.window.showSaveFilePicker = async () => destino;
    await assert.rejects(app.db.crearBackup(), /respaldo no pudo confirmarse/);
    assert.equal(destino.escrituras, escrituras);
    assert.deepEqual(activo.datos, original);
  });
}

for (const enCarpeta of [false, true]) {
  test('B1: cancelar selector ' + (enCarpeta ? 'de carpeta' : 'de archivo') + ' no escribe ni confirma éxito', async () => {
    const app = await entornoNuevo();
    const datos = app.db.exportarDB();
    const cancelar = async () => { throw errorArchivoPrueba('AbortError'); };
    app.window.showSaveFilePicker = cancelar;
    app.window.showDirectoryPicker = cancelar;
    const resultado = await app.db.crearBackup({ enCarpeta });
    assert.equal(resultado.cancelado, true);
    assert.equal(app.db.ocupado, false);
    assert.deepEqual(app.db.exportarDB(), datos);
    assert.equal(app.eventos.filter(evento => evento.estado === 'exitosa').length, 0);
    assert.equal(app.eventos.filter(evento => evento.estado === 'cancelada').length, 1);
  });
}

for (const tipo of ['createWritable', 'write', 'close', 'relectura', 'bytes distintos', 'validación posterior']) {
  test('B1: ' + tipo + ' fallido nunca confirma el respaldo; permite reintentar', async () => {
    const app = await entornoNuevo();
    const original = app.db.exportarDB();
    const destino = archivo('destino.db');
    if (tipo === 'createWritable') destino.errorWritable = new Error('createWritable falló');
    if (tipo === 'write') destino.fallo = true;
    if (tipo === 'close') destino.falloCierre = true;
    if (['relectura', 'bytes distintos'].includes(tipo)) {
      const obtener = destino.getFile.bind(destino);
      destino.getFile = async () => {
        if (destino.escrituras) {
          if (tipo === 'relectura') throw errorArchivoPrueba('NotReadableError');
          return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
        }
        return obtener();
      };
    }
    const validarOriginal = app.esquema.validar;
    if (tipo === 'validación posterior') {
      let llamadas = 0;
      app.esquema.validar = db => {
        if (++llamadas === 2) throw new Error('Validación posterior fallida');
        return validarOriginal(db);
      };
    }
    app.window.showSaveFilePicker = async () => destino;
    await assert.rejects(app.db.crearBackup(), /respaldo no pudo confirmarse/);
    assert.equal(app.eventos.filter(evento => evento.estado === 'exitosa').length, 0);
    assert.equal(app.eventos.filter(evento => evento.estado === 'fallida').length, 1);
    assert.equal(app.db.ocupado, false);
    assert.deepEqual(app.db.exportarDB(), original);
    app.esquema.validar = validarOriginal;
    const nuevo = archivo('reintento.db');
    app.window.showSaveFilePicker = async () => nuevo;
    assert.equal((await app.db.crearBackup()).ok, true);
    assert.deepEqual(nuevo.datos, original);
  });
}

test('B1: espera close y bloquea respaldos, validaciones, exportaciones y guardados concurrentes', async () => {
  const app = await entornoNuevo();
  const original = app.db.exportarDB();
  let liberar;
  const destino = archivo('pendiente.db');
  destino.esperarCierre = new Promise(resolve => { liberar = resolve; });
  app.window.showSaveFilePicker = async () => destino;
  const respaldando = app.db.crearBackup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destino.escrituras, 0);
  assert.equal(app.eventos.filter(evento => evento.estado === 'exitosa').length, 0);
  await assert.rejects(app.db.crearBackup(), /operación.*curso/);
  await assert.rejects(app.db.validarBackup(destino), /operación.*curso/);
  await assert.rejects(app.db.saveProyecto(proyecto, true), /operación.*curso/);
  assert.throws(() => app.db.exportarDB(), /Espere antes de exportar/);
  liberar();
  assert.equal((await respaldando).ok, true);
  assert.deepEqual(destino.datos, original);
  assert.equal(app.db.getProyectos().length, 0);
});

test('B1: aborto al crear destino en carpeta es fallo, no cancelación del usuario', async () => {
  const app = await entornoNuevo();
  const destino = carpeta();
  destino.getFileHandle = async (nombre, opciones) => {
    throw errorArchivoPrueba(opciones?.create ? 'AbortError' : 'NotFoundError');
  };
  app.window.showDirectoryPicker = async () => destino;
  await assert.rejects(app.db.crearBackup({ enCarpeta: true }), /respaldo no pudo confirmarse/);
  assert.equal(app.eventos.filter(evento => evento.estado === 'cancelada').length, 0);
  assert.equal(app.eventos.filter(evento => evento.estado === 'fallida').length, 1);
});

test('B1: respaldo validado y reabierto desde archivos temporales reales con datos sintéticos', async contexto => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const original = app.db.exportarDB();
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-b1-'));
  contexto.after(() => fs.rmSync(temporal, { recursive: true, force: true }));
  const destinoPath = path.join(temporal, 'VERTEX_backup_sintetico.db');
  fs.writeFileSync(destinoPath, new Uint8Array());
  const destino = {
    kind: 'file', name: 'VERTEX_backup_sintetico.db',
    async isSameEntry() { return false; },
    async getFile() {
      const datos = new Uint8Array(await fs.promises.readFile(destinoPath));
      return { arrayBuffer: async () => datos.buffer };
    },
    async createWritable() {
      const staging = destinoPath + '.pending';
      const stream = await fs.promises.open(staging, 'wx');
      return {
        async write(datos) { await stream.writeFile(datos); },
        async close() { await stream.close(); await fs.promises.rename(staging, destinoPath); },
        async abort() { await stream.close(); await fs.promises.rm(staging, { force: true }); }
      };
    }
  };
  app.window.showSaveFilePicker = async () => destino;
  assert.equal((await app.db.crearBackup()).ok, true);
  const bytes = new Uint8Array(fs.readFileSync(destinoPath));
  assert.equal(Buffer.compare(Buffer.from(bytes), Buffer.from(original)), 0);
  assert.equal((await app.db.validarBackup(destino)).valido, true);
  const reapertura = entorno(archivo('copia-temporal.db', bytes));
  await reapertura.db.init();
  assert.equal(reapertura.db.getProyectos()[0].nombre, proyecto.nombre);
  assert.deepEqual(app.db.exportarDB(), original);
});

test('B2: valida sin conexión activa y rechaza motor no inicializado', async () => {
  const creadora = await entornoNuevo();
  const copia = archivo('copia-sintetica.db', creadora.db.exportarDB());
  const app = entorno();
  await assert.rejects(app.db.validarBackup(copia), /motor SQLite/);
  await app.db.init();
  assert.equal((await app.db.validarBackup(copia)).valido, true);
  assert.equal(app.db.tieneArchivo, false);
  assert.equal(copia.escrituras, 0);
});

test('crear una base requiere confirmación y no copia los datos de otra base', async () => {
  const app = entorno();
  await app.db.init();
  await app.db.configurarCarpeta();
  await app.db.saveProyecto(proyecto, true);
  const destino = carpeta(null);
  app.window.seleccion = destino;
  app.window.confirmar = false;
  assert.equal((await app.db.configurarCarpeta()).cancelado, true);
  assert.equal(destino.creaciones, 0);
  assert.equal(app.db.getProyectos().length, 1);
  app.window.confirmar = true;
  await app.db.configurarCarpeta();
  assert.equal(destino.creaciones, 1);
  assert.equal(app.db.getProyectos().length, 0);
});

test('recupera handles antiguos y permite reintentar un permiso denegado', async () => {
  const creadora = await entornoNuevo();
  const file = archivo('vertex.db', creadora.window.seleccion.file.datos.slice());
  file.permiso = 'prompt';
  const app = entorno(file);
  const estado = await app.db.init();
  assert.equal(estado.esperaPermiso, true);
  file.permiso = 'denied';
  await assert.rejects(app.db.solicitarPermiso(), /Permiso denegado/);
  assert.equal(app.db.esperaPermiso, true);
  file.permiso = 'granted';
  await app.db.solicitarPermiso();
  assert.equal(app.db.tieneArchivo, true);
  assert.equal(app.db.esperaPermiso, false);
  assert.equal(app.db.estado.ubicacion, 'vertex.db');
});

test('parametriza datos y exporta toda la base', async () => {
  const app = entorno();
  await app.db.init();
  await app.db.configurarCarpeta();
  const nombre = "O'Brien'); DROP TABLE proyectos; --";
  await app.db.saveProyecto({ ...proyecto, nombre }, true);
  const exportada = new SQL.Database(app.db.exportarDB());
  assert.equal(exportada.exec('SELECT nombre FROM proyectos')[0].values[0][0], nombre);
  exportada.close();
  await assert.rejects(app.db.saveProyecto(proyecto, true), /UNIQUE/);
  assert.equal(app.db.getProyectos()[0].nombre, nombre);
});

test('informa motor ausente, navegador incompatible e IndexedDB bloqueado', async () => {
  const sinMotor = entorno(null, { sqlError: true });
  assert.equal((await sinMotor.db.init()).useSQLite, false);
  await assert.rejects(sinMotor.db.configurarCarpeta(), /motor SQLite/);
  const app = entorno(null, { idbError: true });
  assert.match((await app.db.init()).error, /IndexedDB/);
  await app.db.configurarCarpeta();
  assert.equal(app.db.tieneArchivo, true);
  assert.match(app.db.estado.error, /recordar la ubicación/);
  await app.db.saveProyecto(proyecto, true);
  assert.match(app.db.estado.error, /recordar la ubicación/);
  app.window.showDirectoryPicker = undefined;
  assert.equal(app.db.hasFSA, false);
  await assert.rejects(app.db.configurarCarpeta(), /Chrome o Edge/);
});

test('abre una base SQLite sintética vigente sin volver a escribirla', async () => {
  const creadora = await entornoNuevo();
  const original = creadora.window.seleccion.file.datos.slice();
  const file = archivo('vertex.db', original.slice());
  const app = entorno(file);
  await app.db.init();
  assert.equal(app.db.estado.requiereMigracion, false);
  assert.equal(app.db.tieneArchivo, true);
  assert.ok(Array.isArray(app.db.getProyectos()));
  assert.equal(file.escrituras, 0);
  assert.deepEqual(file.datos, original);
});

test('cambiar a una base existente no mezcla datos ni modifica la base anterior', async () => {
  const primera = entorno();
  const segunda = entorno();
  await primera.db.init();
  await segunda.db.init();
  await primera.db.configurarCarpeta();
  await segunda.db.configurarCarpeta();
  await primera.db.saveProyecto(proyecto, true);
  await segunda.db.saveProyecto({ ...proyecto, id: 'p2', nombre: 'Otro proyecto' }, true);
  const archivoAnterior = primera.window.seleccion.file;
  const bytesAnteriores = archivoAnterior.datos.slice();
  primera.window.seleccion = segunda.window.seleccion;
  await primera.db.configurarCarpeta();
  assert.equal(primera.db.getProyectos().length, 1);
  assert.equal(primera.db.getProyectos()[0].id, 'p2');
  assert.deepEqual(archivoAnterior.datos, bytesAnteriores);
});

function baseLegacy() {
  const db = new SQL.Database();
  db.run(`CREATE TABLE proyectos (
    id TEXT PRIMARY KEY,nombre TEXT NOT NULL,responsable TEXT NOT NULL,division TEXT,
    inicio TEXT,meta TEXT,fin TEXT,estado TEXT,avance INTEGER,implementacion TEXT,
    cumplimiento TEXT,objetivo TEXT,resultado TEXT,observaciones TEXT,created_at TEXT,updated_at TEXT
  )`);
  db.run('INSERT INTO proyectos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
    'historico', "Proyecto histórico O'Brien", 'Responsable original', null, '2026-01-01',
    '', '', 'En curso', 0, 'No iniciado', 'En curso (pendiente de evaluar)',
    '<strong>Texto, no HTML</strong>', '', 'Acentos: áéíóú', '2026-01-01 10:30:00', '2026-01-02 14:00:00'
  ]);
  const bytes = db.export();
  db.close();
  return bytes;
}

async function entornoNuevo() {
  const app = entorno();
  await app.db.init();
  await app.db.configurarCarpeta();
  return app;
}

async function solicitarMigracion(app, bytes = baseLegacy()) {
  const destino = carpeta(archivo('vertex.db', bytes.slice()));
  app.window.seleccion = destino;
  const resultado = await app.db.configurarCarpeta();
  assert.equal(resultado.requiereMigracion, true);
  assert.equal(destino.file.escrituras, 0);
  return destino;
}

test('migración con consentimiento, respaldo exacto, campos históricos intactos e idempotencia', async () => {
  const app = await entornoNuevo();
  const bytes = baseLegacy();
  const previo = new SQL.Database(bytes);
  const valores = previo.exec('SELECT * FROM proyectos');
  previo.close();
  const destino = await solicitarMigracion(app, bytes);
  assert.equal(app.db.estado.requiereMigracion, true);
  const resultado = await app.db.migrarConexion();
  assert.equal(resultado.ok, true);
  assert.ok(resultado.respaldo.startsWith('vertex.pre-v1.'));
  assert.deepEqual(Buffer.from(destino.respaldos.get(resultado.respaldo).datos), Buffer.from(bytes));
  assert.equal(destino.file.escrituras, 1);
  const migrada = new SQL.Database(destino.file.datos);
  const columnas = valores[0].columns.join(',');
  assert.deepEqual(migrada.exec(`SELECT ${columnas} FROM proyectos`), valores);
  assert.equal(migrada.exec('PRAGMA user_version')[0].values[0][0], 3);
  assert.equal(migrada.exec('SELECT count(*) FROM responsables')[0].values[0][0], 0);
  assert.equal(migrada.exec('SELECT count(*) FROM actividad')[0].values[0][0], 0);
  assert.equal(migrada.exec('SELECT prioridad,archivado,responsable_id,descripcion FROM proyectos')[0].values[0][0], 'Media');
  migrada.close();
  const reapertura = entorno(app.store.get('vertex_db'));
  await reapertura.db.init();
  assert.equal(reapertura.db.estado.requiereMigracion, false);
  assert.equal(reapertura.db.getProyectos()[0].id, 'historico');
  assert.equal(destino.file.escrituras, 1);
});

test('cancelar migración conserva conexión previa y no escribe ni crea respaldos', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const destino = await solicitarMigracion(app);
  await assert.rejects(app.db.saveProyecto({ ...proyecto, nombre: 'Cambio' }, false), /migración pendiente/);
  app.db.cancelarMigracion();
  assert.equal(app.db.getProyectos()[0].nombre, 'Prueba');
  assert.equal(app.db.estado.requiereMigracion, false);
  assert.equal(destino.respaldos.size, 0);
  assert.equal(destino.file.escrituras, 0);
});

test('respaldo fallido o no verificable no migra el archivo original', async () => {
  for (const tipo of ['write', 'verify']) {
    const app = await entornoNuevo();
    const bytes = baseLegacy();
    const destino = await solicitarMigracion(app, bytes);
    const get = destino.getFileHandle.bind(destino);
    destino.getFileHandle = async (nombre, options) => {
      const file = await get(nombre, options);
      if (nombre !== 'vertex.db' && options && options.create) {
        if (tipo === 'write') file.fallo = true;
        else {
          file.createWritable = async () => ({ async write() {}, async close() {}, async abort() {} });
        }
      }
      return file;
    };
    await assert.rejects(app.db.migrarConexion(), /Disco sin espacio|verificar el respaldo/);
    assert.equal(destino.file.escrituras, 0);
    assert.deepEqual(destino.file.datos, bytes);
    assert.equal(app.db.estado.requiereMigracion, true);
  }
});

test('fallo de escritura migrada conserva original y conexión; permite reintentar con otro respaldo', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const bytes = baseLegacy();
  const destino = await solicitarMigracion(app, bytes);
  destino.file.falloCierre = true;
  await assert.rejects(app.db.migrarConexion(), /cerrar el archivo/);
  assert.deepEqual(destino.file.datos, bytes);
  assert.equal(app.db.getProyectos()[0].id, 'p1');
  assert.equal(destino.respaldos.size, 1);
  destino.file.falloCierre = false;
  await app.db.migrarConexion();
  assert.equal(app.db.getProyectos()[0].id, 'historico');
  assert.equal(destino.respaldos.size, 2);
  for (const file of destino.respaldos.values()) assert.deepEqual(Buffer.from(file.datos), Buffer.from(bytes));
});

test('versión futura, esquema ajeno y cambio externo se rechazan sin escribir', async () => {
  const app = await entornoNuevo();
  const futura = new SQL.Database(app.db.exportarDB());
  futura.run('PRAGMA user_version=99');
  const datosFuturos = futura.export();
  futura.close();
  app.window.seleccion = carpeta(archivo('vertex.db', datosFuturos));
  await assert.rejects(app.db.configurarCarpeta(), /versión/);
  assert.equal(app.window.seleccion.file.escrituras, 0);
  const ajena = new SQL.Database(baseLegacy());
  ajena.run('CREATE TABLE otra_aplicacion (id TEXT)');
  app.window.seleccion = carpeta(archivo('vertex.db', ajena.export()));
  ajena.close();
  await assert.rejects(app.db.configurarCarpeta(), /tablas ajenas/);
  assert.equal(app.window.seleccion.file.escrituras, 0);
  const destino = await solicitarMigracion(app);
  destino.file.datos = baseLegacy().slice(0, 30);
  await assert.rejects(app.db.migrarConexion(), /cambió/);
  assert.equal(destino.file.escrituras, 0);
  assert.equal(destino.respaldos.size, 0);
});

test('handle antiguo requiere respaldo distinto; cancelar selector no cambia datos', async () => {
  const bytes = baseLegacy();
  const file = archivo('vertex.db', bytes.slice());
  const app = entorno(file);
  await app.db.init();
  assert.equal(app.db.estado.requiereMigracion, true);
  const cancelado = new Error('Cancelado'); cancelado.name = 'AbortError';
  app.window.showSaveFilePicker = async () => { throw cancelado; };
  assert.equal((await app.db.migrarConexion()).cancelado, true);
  assert.equal(file.escrituras, 0);
  file.isSameEntry = async otro => otro === file;
  app.window.showSaveFilePicker = async () => file;
  await assert.rejects(app.db.migrarConexion(), /distinto/);
  const respaldo = archivo('respaldo.db');
  app.window.showSaveFilePicker = async () => respaldo;
  await app.db.migrarConexion();
  assert.deepEqual(Buffer.from(respaldo.datos), Buffer.from(bytes));
  assert.equal(app.db.tieneArchivo, true);
});

test('rollback de migración restaura versión y esquema ante un error SQL', () => {
  const app = entorno();
  const db = new SQL.Database(baseLegacy());
  db.run('PRAGMA foreign_keys=ON');
  const runOriginal = db.run.bind(db);
  db.run = (sql, params) => {
    if (sql.includes('CREATE TABLE responsables')) {
      runOriginal('ALTER TABLE proyectos ADD COLUMN temporal TEXT');
      throw new Error('Fallo SQL simulado');
    }
    return runOriginal(sql, params);
  };
  assert.throws(() => app.esquema.migrar(db), /Fallo SQL simulado/);
  assert.equal(db.exec('PRAGMA user_version')[0].values[0][0], 0);
  assert.equal(db.exec('PRAGMA table_info(proyectos)')[0].values.some(row => row[1] === 'temporal'), false);
  assert.equal(db.exec('SELECT nombre FROM proyectos')[0].values[0][0], "Proyecto histórico O'Brien");
  db.close();
});

test('API relacional crea entidades, asignaciones, etiquetas y actividad confirmada', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const responsable = await app.trabajo.guardarResponsable({ nombre: 'Persona local' });
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Operaciones' });
  const listas = app.trabajo.getListas(tablero);
  assert.equal(listas.length, 5);
  const etiqueta = await app.trabajo.guardarEtiqueta({ nombre: '<script>texto</script>', color: '#336699' });
  const tarjeta = await app.trabajo.guardarTarjeta({
    lista_id: listas[0].id, titulo: "Tarea O'Brien <img>", responsable_id: responsable,
    prioridad: 'Alta', inicio: '2026-10-24', vencimiento: '2026-10-30', etiquetas: [etiqueta, etiqueta]
  });
  assert.equal(app.trabajo.getTarjetaEtiquetas(tarjeta).length, 1);
  assert.equal(app.trabajo.getTarjetas()[0].responsable_nombre, 'Persona local');
  await app.trabajo.guardarTarjeta({ id: tarjeta, prioridad: 'Urgente', completada: 1 });
  assert.equal(app.trabajo.getTarjetas()[0].completada, 1);
  const tipos = app.trabajo.getActividad().map(e => e.tipo);
  assert.ok(tipos.includes('prioridad_cambiada'));
  assert.ok(tipos.includes('tarea_completada'));
  assert.ok(app.trabajo.getActividad().every(e => e.actor === 'Instalación local' && /Z$/.test(e.created_at)));
  const nuevo = entorno(app.store.get('vertex_db'));
  await nuevo.db.init();
  assert.equal(nuevo.trabajo.getTarjetas()[0].titulo, "Tarea O'Brien <img>");
  assert.equal(nuevo.trabajo.getTarjetaEtiquetas(tarjeta).length, 1);
});

test('fase 5: responsables normalizados, asignaciones múltiples e historial inactivo', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Fase 5' });
  const lista = app.trabajo.getListas(tablero)[0].id;
  const r1 = await app.trabajo.guardarResponsable({ nombre: ' Ana  Pérez ' });
  const r2 = await app.trabajo.guardarResponsable({ nombre: 'Bruno' });
  await assert.rejects(app.trabajo.guardarResponsable({ nombre: 'ana pérez' }), /Ya existe/);
  await assert.rejects(app.trabajo.guardarResponsable({ nombre: '   ' }), /obligatorio/);
  await app.trabajo.guardarResponsable({ id: r1, nombre: 'Ana Pérez editada' });
  const tarjeta = await app.trabajo.guardarTarjeta({
    lista_id: lista, titulo: 'Asignación múltiple', responsables: [r1, r2, r1]
  });
  assert.deepEqual(Array.from(app.trabajo.getTarjetas()[0].responsables, r => r.id), [r1, r2]);
  await app.trabajo.archivar('responsable', r2, true);
  assert.deepEqual(Array.from(app.trabajo.getTarjetas()[0].responsables, r => r.id), [r1, r2]);
  assert.equal(app.trabajo.getTarjetas()[0].responsables[1].archivado, 1);
  await app.trabajo.guardarTarjeta({ id: tarjeta, lista_id: lista, titulo: 'Conserva inactivo', responsables: [r1, r2] });
  const r3 = await app.trabajo.guardarResponsable({ nombre: 'Carla' });
  await app.trabajo.archivar('responsable', r3, true);
  await assert.rejects(app.trabajo.guardarTarjeta({
    lista_id: lista, titulo: 'No asignar inactivo', responsables: [r3]
  }), /inactivos/);
  await app.trabajo.archivar('responsable', r2, false);
  await app.trabajo.guardarTarjeta({ id: tarjeta, lista_id: lista, titulo: 'Edición conservadora' });
  assert.deepEqual(Array.from(app.trabajo.getTarjetas()[0].responsables, r => r.id), [r1, r2]);
  const bytes = app.db.exportarDB();
  await assert.rejects(app.db.transaccion(tx => {
    tx.run('INSERT INTO tarjeta_responsables (tarjeta_id,responsable_id) VALUES (?,?)', [tarjeta, 'inexistente']);
  }), /FOREIGN KEY/);
  assert.deepEqual(app.db.exportarDB(), bytes);
});

test('fase 5: catálogo de etiquetas, color, asignación múltiple y archivado histórico', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Etiquetas' });
  const lista = app.trabajo.getListas(tablero)[0].id;
  const desarrollo = await app.trabajo.guardarEtiqueta({ nombre: 'Desarrollo', color: '#336699' });
  const revision = await app.trabajo.guardarEtiqueta({ nombre: 'Revisión', color: '#aabbcc' });
  await assert.rejects(app.trabajo.guardarEtiqueta({ nombre: '  desarrollo ', color: '#112233' }), /Ya existe/);
  await assert.rejects(app.trabajo.guardarEtiqueta({ nombre: 'Inválida', color: 'red' }), /hexadecimal/);
  await app.trabajo.guardarEtiqueta({ id: revision, nombre: 'Revisión final', color: '#abcdef' });
  const tarjeta = await app.trabajo.guardarTarjeta({
    lista_id: lista, titulo: 'Clasificada', etiquetas: [desarrollo, revision, desarrollo]
  });
  assert.deepEqual(Array.from(app.trabajo.getTarjetas()[0].etiquetas, e => e.id), [desarrollo, revision]);
  await app.trabajo.archivar('etiqueta', desarrollo, true);
  await app.trabajo.guardarTarjeta({ id: tarjeta, lista_id: lista, titulo: 'Conserva etiqueta', etiquetas: [desarrollo, revision] });
  assert.equal(app.trabajo.getTarjetas()[0].etiquetas[0].archivado, 1);
  const nueva = await app.trabajo.guardarEtiqueta({ nombre: 'Nueva', color: '#123456' });
  await app.trabajo.archivar('etiqueta', nueva, true);
  await assert.rejects(app.trabajo.guardarTarjeta({
    lista_id: lista, titulo: 'Etiqueta inactiva', etiquetas: [nueva]
  }), /inactivas/);
  await app.trabajo.guardarTarjeta({ id: tarjeta, lista_id: lista, titulo: 'Edición sin selección de etiquetas' });
  assert.deepEqual(Array.from(app.trabajo.getTarjetas()[0].etiquetas, e => e.id), [desarrollo, revision]);
  await app.trabajo.archivar('etiqueta', desarrollo, false);
  assert.equal(app.trabajo.getEtiquetas().find(e => e.id === desarrollo).archivado, 0);
});

test('fase 5: prioridad crítica compatible y cambio de etapa sin alterar prioridad', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Prioridades' });
  const [origen, destino] = app.trabajo.getListas(tablero);
  const tarjeta = await app.trabajo.guardarTarjeta({ lista_id: origen.id, titulo: 'Predeterminada' });
  assert.equal(app.trabajo.getTarjetas()[0].prioridad, 'Media');
  await app.trabajo.guardarTarjeta({ id: tarjeta, lista_id: origen.id, titulo: 'Prioridad crítica', prioridad: 'Crítica' });
  assert.equal(app.trabajo.getTarjetas()[0].prioridad, 'Urgente');
  await assert.rejects(app.trabajo.guardarTarjeta({
    id: tarjeta, lista_id: origen.id, titulo: 'Prioridad inválida', prioridad: 'Inmediata'
  }), /prioridad/);
  await app.trabajo.moverTarjeta(tarjeta, destino.id, 0);
  assert.equal(app.trabajo.getTarjetas()[0].prioridad, 'Urgente');
  assert.equal(app.trabajo.getTarjetas()[0].lista_id, destino.id);
});

test('fase 5: migración v1→v2 conserva responsables y asignaciones históricas', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Migración sintética' });
  const lista = app.trabajo.getListas(tablero)[0].id;
  const responsable = await app.trabajo.guardarResponsable({ nombre: 'Histórico v1' });
  const etiqueta = await app.trabajo.guardarEtiqueta({ nombre: 'Anterior', color: '#123abc' });
  const tarjeta = await app.trabajo.guardarTarjeta({
    lista_id: lista, titulo: 'Tarjeta v1', responsable_id: responsable, etiquetas: [etiqueta]
  });
  const v1 = new SQL.Database(app.db.exportarDB());
  v1.run('DROP INDEX idx_tarjeta_responsables_responsable');
  v1.run('DROP TABLE tarjeta_responsables');
  v1.run('ALTER TABLE etiquetas DROP COLUMN archivado');
  v1.run('ALTER TABLE actividad DROP COLUMN tarjeta_titulo');
  v1.run('PRAGMA user_version=1');
  const bytes = v1.export();
  v1.close();

  const rollback = new SQL.Database(bytes);
  rollback.run('PRAGMA foreign_keys=ON');
  const runOriginal = rollback.run.bind(rollback);
  rollback.run = (sql, params) => {
    if (sql === 'PRAGMA user_version=2') throw new Error('Fallo de migración v2 simulado');
    return runOriginal(sql, params);
  };
  assert.throws(() => app.esquema.migrar(rollback), /Fallo de migración v2/);
  assert.equal(rollback.exec('PRAGMA user_version')[0].values[0][0], 1);
  assert.equal(rollback.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tarjeta_responsables'").length, 0);
  assert.equal(rollback.exec('PRAGMA table_info(etiquetas)')[0].values.some(row => row[1] === 'archivado'), false);
  rollback.close();

  const destino = await solicitarMigracion(app, bytes);
  const resultado = await app.db.migrarConexion();
  assert.equal(resultado.ok, true);
  assert.ok(resultado.respaldo.startsWith('vertex.pre-v2.'));
  assert.equal(Buffer.compare(Buffer.from(destino.respaldos.get(resultado.respaldo).datos),
    Buffer.from(bytes)), 0);
  const migrada = new SQL.Database(destino.file.datos);
  assert.equal(migrada.exec('PRAGMA user_version')[0].values[0][0], 3);
  assert.deepEqual(Array.from(migrada.exec('SELECT tarjeta_id,responsable_id FROM tarjeta_responsables')[0].values[0]),
    [tarjeta, responsable]);
  migrada.close();
  assert.equal(app.trabajo.getTarjetas().find(fila => fila.id === tarjeta).responsables[0].id, responsable);
  assert.equal(app.trabajo.getTarjetas().find(fila => fila.id === tarjeta).etiquetas[0].id, etiqueta);
  const nuevo = entorno(app.store.get('vertex_db'));
  await nuevo.db.init();
  assert.equal(nuevo.trabajo.getTarjetas().find(fila => fila.id === tarjeta).titulo, 'Tarjeta v1');
  assert.equal(nuevo.trabajo.getTarjetaEtiquetas(tarjeta).length, 1);
});

test('fase 6: fechas de calendario e historial detallado solo registran cambios efectivos', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Seguimiento temporal' });
  const listas = app.trabajo.getListas(tablero);
  const responsable = await app.trabajo.guardarResponsable({ nombre: 'Ana' });
  const etiqueta = await app.trabajo.guardarEtiqueta({ nombre: 'Planificación', color: '#123456' });
  const tarjeta = await app.trabajo.guardarTarjeta({
    lista_id: listas[0].id, titulo: 'Plan anual', descripcion: 'Primera descripción',
    inicio: '2026-10-25', vencimiento: '2026-11-01', prioridad: 'Media',
    responsables: [responsable], etiquetas: [etiqueta]
  });
  const creada = app.trabajo.getActividad({ tarjetaId: tarjeta });
  assert.ok(creada.some(evento => evento.tipo === 'tarjeta_creada' && evento.tarjeta_titulo === 'Plan anual'));
  assert.ok(creada.some(evento => evento.tipo === 'responsable_asignado'));
  assert.ok(creada.some(evento => evento.tipo === 'etiqueta_agregada'));

  const antesSinCambios = creada.length;
  await app.trabajo.guardarTarjeta({
    id: tarjeta, lista_id: listas[0].id, titulo: 'Plan anual', descripcion: 'Primera descripción',
    inicio: '2026-10-25', vencimiento: '2026-11-01', prioridad: 'Media',
    responsables: [responsable], etiquetas: [etiqueta]
  });
  assert.equal(app.trabajo.getActividad({ tarjetaId: tarjeta }).length, antesSinCambios);

  await app.trabajo.guardarTarjeta({
    id: tarjeta, lista_id: listas[0].id, titulo: 'Plan anual actualizado',
    descripcion: 'Descripción actualizada', inicio: '', vencimiento: '2026-11-02',
    prioridad: 'Alta', responsables: [], etiquetas: []
  });
  const actividad = app.trabajo.getActividad({ tarjetaId: tarjeta });
  assert.ok(actividad.some(evento => evento.tipo === 'titulo_cambiado' && evento.tarjeta_titulo === 'Plan anual actualizado'));
  assert.ok(actividad.some(evento => evento.tipo === 'descripcion_cambiada'));
  assert.ok(actividad.some(evento => evento.tipo === 'prioridad_cambiada'));
  assert.ok(actividad.some(evento => evento.tipo === 'inicio_cambiado'));
  assert.ok(actividad.some(evento => evento.tipo === 'vencimiento_cambiado'));
  assert.ok(actividad.some(evento => evento.tipo === 'responsable_retirado'));
  assert.ok(actividad.some(evento => evento.tipo === 'etiqueta_retirada'));
  assert.equal(app.trabajo.getTarjetas().find(fila => fila.id === tarjeta).inicio, '');
  await app.trabajo.moverTarjeta(tarjeta, listas[1].id, 0);
  const movida = app.trabajo.getTarjetas().find(fila => fila.id === tarjeta);
  assert.equal(movida.inicio, '');
  assert.equal(movida.vencimiento, '2026-11-02');
  assert.equal(movida.prioridad, 'Alta');
  assert.ok(app.trabajo.getActividad({ tableroId: tablero }).some(evento => evento.tipo === 'tarjeta_movida'));
  const segunda = await app.trabajo.guardarTarjeta({ lista_id: listas[1].id, titulo: 'Para reordenar' });
  await app.trabajo.moverTarjeta(segunda, listas[1].id, 0);
  assert.ok(app.trabajo.getActividad({ tarjetaId: segunda }).some(evento => evento.tipo === 'tarjeta_reordenada'));
  const eventosAntesNoOp = app.trabajo.getActividad({ tarjetaId: segunda }).length;
  await app.trabajo.moverTarjeta(segunda, listas[1].id, 0);
  assert.equal(app.trabajo.getActividad({ tarjetaId: segunda }).length, eventosAntesNoOp);
  assert.equal(app.trabajo.getActividad({ tarjetaId: tarjeta, limite: 2 }).length, 2);
  const pagina = app.trabajo.getActividad({ tableroId: tablero, limite: 2 });
  const anterior = app.trabajo.getActividad({ tableroId: tablero, limite: 2, antesId: pagina[1].id });
  assert.ok(anterior.every(evento => evento.id < pagina[1].id));
  assert.throws(() => app.trabajo.getActividad({ limite: 0 }), /límite/);

  const reopen = entorno(app.store.get('vertex_db'));
  await reopen.db.init();
  assert.ok(reopen.trabajo.getActividad({ tarjetaId: tarjeta })
    .some(evento => evento.tipo === 'titulo_cambiado' && evento.tarjeta_titulo === 'Plan anual actualizado'));
  assert.equal(reopen.trabajo.getTarjetas().find(fila => fila.id === tarjeta).vencimiento, '2026-11-02');
});

test('fase 6: migración v2→v3 captura títulos históricos y revierte ante fallo', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Historial legado' });
  const lista = app.trabajo.getListas(tablero)[0].id;
  const tarjeta = await app.trabajo.guardarTarjeta({ lista_id: lista, titulo: 'Título anterior' });
  const v2 = new SQL.Database(app.db.exportarDB());
  v2.run('ALTER TABLE actividad DROP COLUMN tarjeta_titulo');
  v2.run('PRAGMA user_version=2');
  const bytes = v2.export();
  v2.close();

  const rollback = new SQL.Database(bytes);
  rollback.run('PRAGMA foreign_keys=ON');
  const ejecutarOriginal = rollback.run.bind(rollback);
  rollback.run = (sql, params) => {
    if (sql === 'PRAGMA user_version=3') throw new Error('Fallo de migración v3 simulado');
    return ejecutarOriginal(sql, params);
  };
  assert.throws(() => app.esquema.migrar(rollback), /Fallo de migración v3/);
  assert.equal(rollback.exec('PRAGMA user_version')[0].values[0][0], 2);
  assert.equal(rollback.exec('PRAGMA table_info(actividad)')[0].values.some(row => row[1] === 'tarjeta_titulo'), false);
  rollback.close();

  const destino = await solicitarMigracion(app, bytes);
  const resultado = await app.db.migrarConexion();
  assert.equal(resultado.ok, true);
  const migrada = new SQL.Database(destino.file.datos);
  assert.equal(migrada.exec('PRAGMA user_version')[0].values[0][0], 3);
  assert.equal(migrada.exec('SELECT tarjeta_titulo FROM actividad WHERE tarjeta_id=?', [tarjeta])[0].values[0][0],
    'Título anterior');
  migrada.close();
});

test('FK y restricciones se aplican tras clonar/exportar y protegen relaciones', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Tablero' });
  app.db.exportarDB();
  await assert.rejects(app.db.deleteProyecto('p1'), /Archívelo/);
  await assert.rejects(app.db.transaccion(tx => tx.run(
    'INSERT INTO tableros (id,proyecto_id,nombre) VALUES (?,?,?)', ['huerfano', 'no-existe', 'No válido'])), /FOREIGN KEY/);
  await assert.rejects(app.db.transaccion(tx => tx.run(
    'UPDATE proyectos SET prioridad=? WHERE id=?', ['Incorrecta', 'p1'])), /CHECK/);
  assert.equal(app.trabajo.getTableros().length, 1);
});

test('movimiento y reordenamiento son atómicos, persistentes y no duplican tarjetas', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Tablero' });
  const listas = app.trabajo.getListas(tablero);
  const primera = await app.trabajo.guardarTarjeta({ lista_id: listas[0].id, titulo: 'Primera' });
  const segunda = await app.trabajo.guardarTarjeta({ lista_id: listas[0].id, titulo: 'Segunda' });
  await app.trabajo.moverTarjeta(segunda, listas[0].id, 0);
  assert.deepEqual(Array.from(app.trabajo.getTarjetas(), t => t.id), [segunda, primera]);
  await app.trabajo.moverTarjeta(primera, listas[4].id, 0);
  assert.equal(app.trabajo.getTarjetas().find(t => t.id === primera).completada, 1);
  await app.trabajo.moverTarjeta(primera, listas[1].id, 0);
  assert.equal(app.trabajo.getTarjetas().find(t => t.id === primera).completada, 0);
  const invertidas = Array.from(listas, l => l.id).reverse();
  await app.trabajo.reordenarListas(tablero, invertidas);
  const nueva = entorno(app.store.get('vertex_db'));
  await nueva.db.init();
  assert.deepEqual(Array.from(nueva.trabajo.getListas(tablero), l => l.id), invertidas);
  assert.equal(nueva.trabajo.getTarjetas().length, 2);
  const actividad = nueva.trabajo.getActividad().length;
  const file = app.window.seleccion.file;
  file.fallo = true;
  await assert.rejects(app.trabajo.moverTarjeta(segunda, listas[4].id, 0), /Disco sin espacio/);
  assert.equal(app.trabajo.getTarjetas().find(t => t.id === segunda).lista_id, listas[0].id);
  assert.equal(app.trabajo.getActividad().length, actividad);
});

test('mover una tarjeta conserva las demás y el orden de origen/destino después de reabrir', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Tablero' });
  const [origen, destino] = app.trabajo.getListas(tablero);
  const ids = [];
  for (const titulo of ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco']) {
    ids.push(await app.trabajo.guardarTarjeta({ lista_id: origen.id, titulo }));
  }
  const previas = [];
  for (const titulo of ['Destino 1', 'Destino 2']) {
    previas.push(await app.trabajo.guardarTarjeta({ lista_id: destino.id, titulo }));
  }
  await app.trabajo.moverTarjeta(ids[2], destino.id, 1);
  const origenActual = Array.from(app.trabajo.getTarjetas().filter(t => t.lista_id === origen.id), t => t.id);
  const destinoActual = Array.from(app.trabajo.getTarjetas().filter(t => t.lista_id === destino.id), t => t.id);
  assert.deepEqual(origenActual, [ids[0], ids[1], ids[3], ids[4]]);
  assert.deepEqual(destinoActual, [previas[0], ids[2], previas[1]]);
  assert.deepEqual(Array.from(app.trabajo.getTarjetas().filter(t => t.lista_id === origen.id), t => t.posicion), [0, 1, 3, 4]);
  const reabierta = entorno(app.store.get('vertex_db'));
  await reabierta.db.init();
  assert.deepEqual(Array.from(reabierta.trabajo.getTarjetas().filter(t => t.lista_id === origen.id), t => t.id), origenActual);
  assert.deepEqual(Array.from(reabierta.trabajo.getTarjetas().filter(t => t.lista_id === destino.id), t => t.id), destinoActual);
});

test('mover varias tarjetas seleccionadas conserva su orden relativo y deja intactos los demás', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Tablero' });
  const [origen, destino] = app.trabajo.getListas(tablero);
  const ids = [];
  for (const titulo of ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco']) {
    ids.push(await app.trabajo.guardarTarjeta({ lista_id: origen.id, titulo }));
  }
  const previas = [];
  for (const titulo of ['Destino 1', 'Destino 2']) {
    previas.push(await app.trabajo.guardarTarjeta({ lista_id: destino.id, titulo }));
  }
  const archivada = await app.trabajo.guardarTarjeta({ lista_id: destino.id, titulo: 'Archivada' });
  await app.trabajo.archivar('tarjeta', archivada, true);
  await app.trabajo.moverTarjetas([
    { id: ids[1], destinoId: destino.id },
    { id: ids[3], destinoId: destino.id }
  ]);
  assert.deepEqual(Array.from(app.trabajo.getTarjetas().filter(t => t.lista_id === origen.id), t => t.id),
    [ids[0], ids[2], ids[4]]);
  assert.deepEqual(Array.from(app.trabajo.getTarjetas().filter(t => t.lista_id === destino.id && !t.archivada), t => t.id),
    [...previas, ids[1], ids[3]]);
  assert.deepEqual(Array.from(app.trabajo.getTarjetas().filter(t => t.lista_id === origen.id), t => t.posicion), [0, 2, 4]);
  assert.deepEqual(Array.from(app.trabajo.getTarjetas().filter(t => t.lista_id === destino.id && !t.archivada), t => t.posicion), [0, 1, 3, 4]);
  assert.equal(app.trabajo.getTarjetas().find(t => t.id === archivada).posicion, 2);
  await app.trabajo.moverTarjeta(ids[0], destino.id, 0);
  const destinoConInsercion = app.trabajo.getTarjetas().filter(t => t.lista_id === destino.id);
  assert.deepEqual(Array.from(destinoConInsercion, t => t.posicion), [0, 1, 2, 3, 4, 5]);
  assert.equal(destinoConInsercion.at(-1).id, archivada);
});

test('movimiento múltiple entre etapas relativas, vacío e intertablero valida antes de escribir', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Tablero' });
  const otroTablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Otro tablero' });
  const listas = app.trabajo.getListas(tablero);
  const listasOtro = app.trabajo.getListas(otroTablero);
  const primera = await app.trabajo.guardarTarjeta({ lista_id: listas[0].id, titulo: 'Primera' });
  const segunda = await app.trabajo.guardarTarjeta({ lista_id: listas[1].id, titulo: 'Segunda' });
  const ajena = await app.trabajo.guardarTarjeta({ lista_id: listasOtro[0].id, titulo: 'Ajena' });
  await app.trabajo.moverTarjetas([
    { id: primera, destinoId: listas[1].id },
    { id: segunda, destinoId: listas[2].id }
  ]);
  const datos = app.trabajo.getTarjetas();
  assert.equal(datos.find(t => t.id === primera).lista_id, listas[1].id);
  assert.equal(datos.find(t => t.id === segunda).lista_id, listas[2].id);
  assert.equal(datos.find(t => t.id === ajena).lista_id, listasOtro[0].id);
  const binario = app.db.exportarDB();
  const eventos = app.trabajo.getActividad().length;
  await assert.rejects(app.trabajo.moverTarjetas([]), /Seleccione/);
  await assert.rejects(app.trabajo.moverTarjetas([
    { id: primera, destinoId: listas[3].id },
    { id: ajena, destinoId: listasOtro[1].id }
  ]), /mismo tablero/);
  await assert.rejects(app.trabajo.moverTarjetas([
    { id: primera, destinoId: listasOtro[1].id }
  ]), /mismo tablero/);
  assert.deepEqual(app.db.exportarDB(), binario);
  assert.equal(app.trabajo.getActividad().length, eventos);
});

test('fallo de escritura en movimiento múltiple descarta todos los cambios y permite reintento', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Tablero' });
  const [origen, destino] = app.trabajo.getListas(tablero);
  const uno = await app.trabajo.guardarTarjeta({ lista_id: origen.id, titulo: 'Uno' });
  const dos = await app.trabajo.guardarTarjeta({ lista_id: origen.id, titulo: 'Dos' });
  const binario = app.db.exportarDB();
  const eventos = app.trabajo.getActividad().length;
  app.window.seleccion.file.falloCierre = true;
  await assert.rejects(app.trabajo.moverTarjetas([
    { id: uno, destinoId: destino.id }, { id: dos, destinoId: destino.id }
  ]), /cerrar/);
  assert.deepEqual(app.db.exportarDB(), binario);
  assert.equal(app.trabajo.getActividad().length, eventos);
  assert.ok(app.trabajo.getTarjetas().every(t => t.lista_id === origen.id));
  app.window.seleccion.file.falloCierre = false;
  await app.trabajo.moverTarjetas([
    { id: uno, destinoId: destino.id }, { id: dos, destinoId: destino.id }
  ]);
  assert.deepEqual(Array.from(app.trabajo.getTarjetas(), t => t.lista_id), [destino.id, destino.id]);
});

test('archivo jerárquico no modifica marcas de los descendientes y restaura de forma explícita', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Tablero' });
  const lista = app.trabajo.getListas(tablero)[0];
  const tarjeta = await app.trabajo.guardarTarjeta({ lista_id: lista.id, titulo: 'Tarea' });
  await app.trabajo.archivar('tarjeta', tarjeta, true);
  await app.trabajo.archivar('tablero', tablero, true);
  assert.equal(app.trabajo.getTarjetas()[0].archivada, 1);
  assert.equal(app.trabajo.getTarjetas()[0].lista_archivada, 0);
  await assert.rejects(app.trabajo.archivar('tarjeta', tarjeta, false), /archivado/);
  await app.trabajo.archivar('tablero', tablero, false);
  assert.equal(app.trabajo.getTarjetas()[0].archivada, 1);
  await app.trabajo.archivar('tarjeta', tarjeta, false);
  assert.equal(app.trabajo.getTarjetas()[0].archivada, 0);
});

test('validaciones rechazan fechas imposibles, colores CSS, padres inexistentes y orden inválido sin eventos', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: 'p1', nombre: 'Tablero' });
  const lista = app.trabajo.getListas(tablero)[0];
  const cantidad = app.trabajo.getActividad().length;
  await assert.rejects(app.trabajo.guardarTarjeta({ lista_id: lista.id, titulo: 'Tarea', inicio: '2026-02-30' }), /fecha/);
  await assert.rejects(app.trabajo.guardarTarjeta({
    lista_id: lista.id, titulo: 'Tarea', inicio: '2026-10-25', vencimiento: '2026-10-24'
  }), /posterior/);
  await assert.rejects(app.trabajo.guardarEtiqueta({ nombre: 'Color', color: 'url(javascript:evil)' }), /hexadecimal/);
  await assert.rejects(app.trabajo.guardarTablero({ proyecto_id: 'ausente', nombre: 'No' }), /no existe/);
  await assert.rejects(app.trabajo.reordenarListas(tablero, [lista.id, lista.id]), /cada lista/);
  assert.equal(app.trabajo.getActividad().length, cantidad);
  assert.equal(app.trabajo.getTarjetas().length, 0);
});

test('guardar entidades y repetir un orden sin cambios conserva timestamps y no agrega actividad', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const responsableId = await app.trabajo.guardarResponsable({ nombre: 'Responsable' });
  await app.trabajo.asignarResponsableProyecto('p1', responsableId);
  const etiquetaId = await app.trabajo.guardarEtiqueta({ nombre: 'Etiqueta', color: '#123456' });
  const tableroId = await app.trabajo.guardarTablero({
    proyecto_id: 'p1', nombre: 'Tablero', descripcion: 'Descripción'
  });
  const lista = app.trabajo.getListas(tableroId)[0];
  const tarjetaId = await app.trabajo.guardarTarjeta({
    lista_id: lista.id, titulo: 'Tarea', responsables: [responsableId], etiquetas: [etiquetaId]
  });
  const orden = app.trabajo.getListas(tableroId).map(fila => fila.id);
  const marcador = '2000-01-01T00:00:00.000Z';
  await app.db.transaccion(tx => {
    for (const [tabla, id] of [
      ['proyectos', 'p1'], ['responsables', responsableId], ['etiquetas', etiquetaId],
      ['tableros', tableroId], ['listas', lista.id], ['tarjetas', tarjetaId]
    ]) tx.run(`UPDATE ${tabla} SET updated_at=? WHERE id=?`, [marcador, id]);
  });
  const actividadInicial = app.trabajo.getActividad().length;
  const tarjeta = app.trabajo.getTarjetas().find(fila => fila.id === tarjetaId);

  await app.trabajo.guardarResponsable({ id: responsableId, nombre: 'Responsable' });
  await app.trabajo.asignarResponsableProyecto('p1', responsableId);
  await app.trabajo.guardarEtiqueta({ id: etiquetaId, nombre: 'Etiqueta', color: '#123456' });
  await app.trabajo.guardarTablero({
    id: tableroId, proyecto_id: 'p1', nombre: 'Tablero', descripcion: 'Descripción'
  });
  await app.trabajo.guardarLista({
    id: lista.id, tablero_id: tableroId, nombre: lista.nombre, categoria: lista.categoria
  });
  await app.trabajo.guardarTarjeta({
    id: tarjeta.id, lista_id: tarjeta.lista_id, titulo: tarjeta.titulo,
    descripcion: tarjeta.descripcion, prioridad: tarjeta.prioridad, inicio: tarjeta.inicio,
    vencimiento: tarjeta.vencimiento, observaciones: tarjeta.observaciones,
    completada: tarjeta.completada, responsables: tarjeta.responsables.map(fila => fila.id),
    etiquetas: tarjeta.etiquetas.map(fila => fila.id)
  });
  await app.trabajo.reordenarListas(tableroId, orden);

  assert.equal(app.trabajo.getActividad().length, actividadInicial);
  assert.equal(app.trabajo.getTarjetas()[0].responsables.length, 1);
  assert.equal(app.trabajo.getTarjetas()[0].etiquetas.length, 1);
  assert.deepEqual(Array.from(app.db.consultar(
    `SELECT updated_at FROM proyectos WHERE id=? UNION ALL
     SELECT updated_at FROM responsables WHERE id=? UNION ALL
     SELECT updated_at FROM etiquetas WHERE id=? UNION ALL
     SELECT updated_at FROM tableros WHERE id=? UNION ALL
     SELECT updated_at FROM listas WHERE id=? UNION ALL
     SELECT updated_at FROM tarjetas WHERE id=?`,
    ['p1', responsableId, etiquetaId, tableroId, lista.id, tarjetaId]
  ), fila => fila.updated_at), Array(6).fill(marcador));
});

test('asignación explícita y renombre conservan responsables históricos no vinculados', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  await app.db.saveProyecto({ ...proyecto, id: 'p2' }, true);
  const id = await app.trabajo.guardarResponsable({ nombre: 'Responsable' });
  assert.ok(app.db.getProyectos().every(p => p.responsable_id === null));
  await app.trabajo.asignarResponsableProyecto('p1', id);
  await app.trabajo.guardarResponsable({ id, nombre: 'Nombre corregido' });
  const datos = app.db.getProyectos();
  assert.equal(datos.find(p => p.id === 'p1').responsable, 'Nombre corregido');
  assert.equal(datos.find(p => p.id === 'p2').responsable, 'Responsable');
  assert.equal(datos.find(p => p.id === 'p2').responsable_id, null);
  await app.trabajo.asignarResponsableProyecto('p1', null);
  assert.equal(app.db.getProyectos().find(p => p.id === 'p1').responsable, 'Nombre corregido');
});

test('una transacción compuesta y sus eventos se descartan enteramente ante error', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const bytes = app.db.exportarDB();
  await assert.rejects(app.db.transaccion(tx => {
    tx.run('INSERT INTO responsables (id,nombre) VALUES (?,?)', ['r1', 'Persona']);
    tx.run('INSERT INTO actividad (tipo,detalle) VALUES (?,?)', ['prueba', 'No debe persistir']);
    tx.run('INSERT INTO tableros (id,proyecto_id,nombre) VALUES (?,?,?)', ['b1', 'ausente', 'Inválido']);
  }), /FOREIGN KEY/);
  assert.equal(app.trabajo.getResponsables().length, 0);
  assert.equal(app.trabajo.getActividad().length, 0);
  assert.deepEqual(app.db.exportarDB(), bytes);
  await assert.rejects(app.db.transaccion(tx => tx.run('DROP INDEX idx_tarjetas_lista')), /índices/);
  assert.deepEqual(app.db.exportarDB(), bytes);
});

test('fase 3: edición de tablero, listas personalizadas y tarjetas se conserva al reabrir', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Inicial' });
  await app.trabajo.guardarTablero({ id: tablero, nombre: 'Editado', descripcion: "Texto <b>literal</b> O'Brien" });
  const lista = await app.trabajo.guardarLista({ tablero_id: tablero, nombre: 'Personalizada', categoria: 'en_revision' });
  const otra = await app.trabajo.guardarLista({ tablero_id: tablero, nombre: 'Otra' });
  await app.trabajo.guardarLista({ id: lista, nombre: 'Renombrada' });
  const orden = [otra, lista, ...Array.from(app.trabajo.getListas(tablero), l => l.id).filter(id => id !== otra && id !== lista)];
  await app.trabajo.reordenarListas(tablero, orden);
  const tarjeta = await app.trabajo.guardarTarjeta({ lista_id: lista, titulo: 'Inicial' });
  await app.trabajo.guardarTarjeta({
    id: tarjeta, titulo: 'Editada', descripcion: 'Detalle', prioridad: 'Urgente',
    inicio: '2026-10-24', vencimiento: '2026-10-30', observaciones: 'Notas', completada: 1
  });
  const nueva = entorno(app.store.get('vertex_db'));
  await nueva.db.init();
  const board = nueva.trabajo.getTableros()[0];
  assert.equal(board.proyecto_id, proyecto.id);
  assert.equal(board.nombre, 'Editado');
  assert.equal(board.descripcion, "Texto <b>literal</b> O'Brien");
  assert.deepEqual(Array.from(nueva.trabajo.getListas(tablero), l => l.id), orden);
  assert.equal(nueva.trabajo.getListas(tablero)[1].nombre, 'Renombrada');
  const card = nueva.trabajo.getTarjetas()[0];
  assert.equal(card.id, tarjeta);
  assert.equal(card.lista_id, lista);
  assert.equal(card.tablero_id, tablero);
  assert.equal(card.titulo, 'Editada');
  assert.equal(card.descripcion, 'Detalle');
  assert.equal(card.prioridad, 'Urgente');
  assert.equal(card.inicio, '2026-10-24');
  assert.equal(card.vencimiento, '2026-10-30');
  assert.equal(card.observaciones, 'Notas');
  assert.equal(card.completada, 1);
  assert.equal(nueva.db.getProyectos()[0].avance, proyecto.avance);
  assert.equal(nueva.db.getProyectos()[0].responsable, proyecto.responsable);
});

test('fase 3: campos obligatorios y asociaciones inválidas no escriben ni registran éxito', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Tablero' });
  const lista = app.trabajo.getListas(tablero)[0].id;
  const archivo = app.window.seleccion.file;
  const escrituras = archivo.escrituras;
  const eventos = app.trabajo.getActividad().length;
  await assert.rejects(app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: '  ' }), /obligatorio/);
  await assert.rejects(app.trabajo.guardarLista({ tablero_id: tablero, nombre: '  ' }), /obligatorio/);
  await assert.rejects(app.trabajo.guardarTarjeta({ lista_id: lista, titulo: '  ' }), /obligatorio/);
  await assert.rejects(app.trabajo.guardarLista({ tablero_id: 'ausente', nombre: 'No válida' }), /no existe/);
  await assert.rejects(app.trabajo.guardarTarjeta({ lista_id: 'ausente', titulo: 'No válida' }), /no existe/);
  assert.equal(archivo.escrituras, escrituras);
  assert.equal(app.trabajo.getActividad().length, eventos);
});

test('fase 3: fallo al editar conserva datos y actividad en disco, y permite reintentar', async () => {
  const app = await entornoNuevo();
  await app.db.saveProyecto(proyecto, true);
  const tablero = await app.trabajo.guardarTablero({ proyecto_id: proyecto.id, nombre: 'Confirmado' });
  const lista = app.trabajo.getListas(tablero)[0].id;
  const tarjeta = await app.trabajo.guardarTarjeta({ lista_id: lista, titulo: 'Confirmada' });
  const file = app.window.seleccion.file;
  const bytes = file.datos.slice();
  const eventos = app.trabajo.getActividad().length;
  file.falloCierre = true;
  await assert.rejects(app.trabajo.guardarTablero({ id: tablero, nombre: 'No confirmado' }), /cerrar/);
  await assert.rejects(app.trabajo.guardarLista({ id: lista, nombre: 'No confirmada' }), /cerrar/);
  await assert.rejects(app.trabajo.guardarTarjeta({ id: tarjeta, titulo: 'No confirmada' }), /cerrar/);
  assert.equal(app.trabajo.getTableros()[0].nombre, 'Confirmado');
  assert.equal(app.trabajo.getTarjetas()[0].titulo, 'Confirmada');
  assert.equal(app.trabajo.getActividad().length, eventos);
  assert.deepEqual(file.datos, bytes);
  file.falloCierre = false;
  await app.trabajo.guardarTarjeta({ id: tarjeta, titulo: 'Reintento' });
  const nueva = entorno(app.store.get('vertex_db'));
  await nueva.db.init();
  assert.equal(nueva.trabajo.getTarjetas()[0].titulo, 'Reintento');
});
