'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let SQL;
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8');
const proyecto = {
  id: 'p1', nombre: 'Prueba', responsable: 'Responsable', division: 'URSA',
  inicio: '2026-10-23', meta: '', fin: '', estado: 'En curso', avance: 25,
  implementacion: 'Piloto / Prueba', cumplimiento: 'En curso (pendiente de evaluar)',
  objetivo: 'Objetivo', resultado: '', observaciones: ''
};

before(async () => {
  const cdn = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2';
  const responses = await Promise.all(['sql-wasm.js', 'sql-wasm.wasm'].map(file => fetch(`${cdn}/${file}`)));
  for (const response of responses) assert.equal(response.ok, true, 'sql.js debe estar disponible');
  const context = vm.createContext({
    console, WebAssembly, TextDecoder, TextEncoder, setTimeout, clearTimeout,
    crypto: require('node:crypto').webcrypto
  });
  vm.runInContext(await responses[0].text(), context);
  SQL = await context.initSqlJs({ wasmBinary: new Uint8Array(await responses[1].arrayBuffer()) });
});

function archivo(nombre = 'vertex.db', inicial = new Uint8Array()) {
  return {
    kind: 'file', name: nombre, datos: inicial, fallo: false, escrituras: 0, permiso: 'granted',
    async queryPermission() { return this.permiso; },
    async requestPermission() { return this.permiso; },
    async getFile() {
      const copia = this.datos.slice();
      return { arrayBuffer: async () => copia.buffer };
    },
    async createWritable() {
      const file = this;
      let temporal;
      return {
        async write(data) {
          if (file.fallo) throw new Error('Disco sin espacio');
          temporal = data.slice();
        },
        async close() {
          if (file.esperarCierre) await file.esperarCierre;
          if (file.falloCierre) throw new Error('Error al cerrar el archivo');
          file.datos = temporal;
          file.escrituras++;
        },
        async abort() {}
      };
    }
  };
}

function carpeta(file = archivo()) {
  return {
    kind: 'directory', name: 'Datos PSA', file, creaciones: 0,
    async getFileHandle(nombre, options) {
      assert.equal(nombre, 'vertex.db');
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
                    queueMicrotask(() => tx.oncomplete());
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
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data.detail; } }
  });
  vm.runInContext(source, context);
  return { db: window.PSA.DB, window, store, eventos };
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
  const file = archivo();
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

test('abre una copia de la base inicial del proyecto sin modificar el archivo original', async () => {
  const original = fs.readFileSync(path.join(__dirname, '..', 'db', 'vertex.db'));
  const file = archivo('vertex.db', new Uint8Array(original));
  const app = entorno(file);
  await app.db.init();
  assert.equal(app.db.tieneArchivo, true);
  assert.ok(Array.isArray(app.db.getProyectos()));
  assert.equal(file.escrituras, original.length ? 0 : 1);
  if (original.length) assert.deepEqual(Buffer.from(file.datos), original);
  else assert.equal(Buffer.from(file.datos.slice(0, 16)).toString(), 'SQLite format 3\0');
  assert.deepEqual(fs.readFileSync(path.join(__dirname, '..', 'db', 'vertex.db')), original);
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
