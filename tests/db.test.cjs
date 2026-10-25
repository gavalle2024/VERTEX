'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let SQL;
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8');
const migraciones = fs.readFileSync(path.join(__dirname, '..', 'js', 'migraciones.js'), 'utf8');
const trabajoSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'trabajo.js'), 'utf8');
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
  if (app.db.estado.requiereMigracion) {
    assert.equal(app.db.tieneArchivo, false);
    assert.equal(file.escrituras, 0);
    assert.deepEqual(Buffer.from(file.datos), original);
    assert.deepEqual(fs.readFileSync(path.join(__dirname, '..', 'db', 'vertex.db')), original);
    return;
  }
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
  assert.equal(migrada.exec('PRAGMA user_version')[0].values[0][0], 2);
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
  assert.equal(migrada.exec('PRAGMA user_version')[0].values[0][0], 2);
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
