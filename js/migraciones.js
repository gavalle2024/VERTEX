'use strict';

(function () {
  const VERSION = 1;
  const CAMPOS_LEGACY = [
    'id', 'nombre', 'responsable', 'division', 'inicio', 'meta', 'fin', 'estado',
    'avance', 'implementacion', 'cumplimiento', 'objetivo', 'resultado', 'observaciones',
    'created_at', 'updated_at'
  ];
  const FECHA = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
  const PRIORIDAD = "TEXT NOT NULL DEFAULT 'Media' CHECK(prioridad IN ('Baja','Media','Alta','Urgente'))";
  const LEGACY = `
    CREATE TABLE proyectos (
      id TEXT PRIMARY KEY, nombre TEXT NOT NULL, responsable TEXT NOT NULL,
      division TEXT DEFAULT '', inicio TEXT DEFAULT '', meta TEXT DEFAULT '', fin TEXT DEFAULT '',
      estado TEXT DEFAULT 'En curso', avance INTEGER DEFAULT 0,
      implementacion TEXT DEFAULT 'No iniciado',
      cumplimiento TEXT DEFAULT 'En curso (pendiente de evaluar)',
      objetivo TEXT DEFAULT '', resultado TEXT DEFAULT '', observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `;
  const MIGRACION_1 = `
    CREATE TABLE responsables (
      id TEXT PRIMARY KEY NOT NULL,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) > 0),
      archivado INTEGER NOT NULL DEFAULT 0 CHECK(archivado IN (0,1)),
      created_at ${FECHA}, updated_at ${FECHA}
    );
    ALTER TABLE proyectos ADD COLUMN descripcion TEXT NOT NULL DEFAULT '';
    ALTER TABLE proyectos ADD COLUMN prioridad ${PRIORIDAD};
    ALTER TABLE proyectos ADD COLUMN archivado INTEGER NOT NULL DEFAULT 0 CHECK(archivado IN (0,1));
    ALTER TABLE proyectos ADD COLUMN responsable_id TEXT REFERENCES responsables(id) ON DELETE RESTRICT;
    CREATE TABLE tableros (
      id TEXT PRIMARY KEY NOT NULL,
      proyecto_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE RESTRICT,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) > 0),
      descripcion TEXT NOT NULL DEFAULT '',
      archivado INTEGER NOT NULL DEFAULT 0 CHECK(archivado IN (0,1)),
      created_at ${FECHA}, updated_at ${FECHA}
    );
    CREATE TABLE listas (
      id TEXT PRIMARY KEY NOT NULL,
      tablero_id TEXT NOT NULL REFERENCES tableros(id) ON DELETE RESTRICT,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) > 0),
      categoria TEXT NOT NULL DEFAULT 'pendiente'
        CHECK(categoria IN ('pendiente','en_curso','en_revision','bloqueado','completado')),
      posicion INTEGER NOT NULL CHECK(typeof(posicion)='integer' AND posicion >= 0),
      archivado INTEGER NOT NULL DEFAULT 0 CHECK(archivado IN (0,1)),
      created_at ${FECHA}, updated_at ${FECHA}
    );
    CREATE TABLE tarjetas (
      id TEXT PRIMARY KEY NOT NULL,
      lista_id TEXT NOT NULL REFERENCES listas(id) ON DELETE RESTRICT,
      titulo TEXT NOT NULL CHECK(length(trim(titulo)) > 0),
      descripcion TEXT NOT NULL DEFAULT '',
      responsable_id TEXT REFERENCES responsables(id) ON DELETE RESTRICT,
      prioridad ${PRIORIDAD},
      inicio TEXT NOT NULL DEFAULT '',
      vencimiento TEXT NOT NULL DEFAULT '',
      observaciones TEXT NOT NULL DEFAULT '',
      completada INTEGER NOT NULL DEFAULT 0 CHECK(completada IN (0,1)),
      archivada INTEGER NOT NULL DEFAULT 0 CHECK(archivada IN (0,1)),
      posicion INTEGER NOT NULL CHECK(typeof(posicion)='integer' AND posicion >= 0),
      created_at ${FECHA}, updated_at ${FECHA},
      CHECK(inicio = '' OR vencimiento = '' OR inicio <= vencimiento)
    );
    CREATE TABLE etiquetas (
      id TEXT PRIMARY KEY NOT NULL,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) > 0),
      color TEXT NOT NULL,
      created_at ${FECHA}, updated_at ${FECHA}
    );
    CREATE TABLE tarjeta_etiquetas (
      tarjeta_id TEXT NOT NULL REFERENCES tarjetas(id) ON DELETE RESTRICT,
      etiqueta_id TEXT NOT NULL REFERENCES etiquetas(id) ON DELETE RESTRICT,
      PRIMARY KEY(tarjeta_id,etiqueta_id)
    );
    CREATE TABLE actividad (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id TEXT REFERENCES proyectos(id) ON DELETE RESTRICT,
      tablero_id TEXT REFERENCES tableros(id) ON DELETE RESTRICT,
      tarjeta_id TEXT REFERENCES tarjetas(id) ON DELETE RESTRICT,
      tipo TEXT NOT NULL, detalle TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'Instalación local',
      created_at ${FECHA}
    );
    CREATE INDEX idx_proyectos_responsable ON proyectos(responsable_id);
    CREATE INDEX idx_tableros_proyecto ON tableros(proyecto_id,archivado);
    CREATE INDEX idx_listas_tablero ON listas(tablero_id,archivado,posicion,id);
    CREATE INDEX idx_tarjetas_lista ON tarjetas(lista_id,archivada,posicion,id);
    CREATE INDEX idx_tarjetas_responsable ON tarjetas(responsable_id,archivada);
    CREATE INDEX idx_tarjetas_vencimiento ON tarjetas(vencimiento,completada);
    CREATE INDEX idx_etiquetas_tarjeta ON tarjeta_etiquetas(etiqueta_id,tarjeta_id);
    CREATE INDEX idx_actividad_proyecto ON actividad(proyecto_id,id);
    CREATE INDEX idx_actividad_tablero ON actividad(tablero_id,id);
    CREATE INDEX idx_actividad_tarjeta ON actividad(tarjeta_id,id);
  `;
  const COLUMNAS = {
    proyectos: [...CAMPOS_LEGACY, 'descripcion', 'prioridad', 'archivado', 'responsable_id'],
    responsables: ['id', 'nombre', 'archivado', 'created_at', 'updated_at'],
    tableros: ['id', 'proyecto_id', 'nombre', 'descripcion', 'archivado', 'created_at', 'updated_at'],
    listas: ['id', 'tablero_id', 'nombre', 'categoria', 'posicion', 'archivado', 'created_at', 'updated_at'],
    tarjetas: ['id', 'lista_id', 'titulo', 'descripcion', 'responsable_id', 'prioridad', 'inicio',
      'vencimiento', 'observaciones', 'completada', 'archivada', 'posicion', 'created_at', 'updated_at'],
    etiquetas: ['id', 'nombre', 'color', 'created_at', 'updated_at'],
    tarjeta_etiquetas: ['tarjeta_id', 'etiqueta_id'],
    actividad: ['id', 'proyecto_id', 'tablero_id', 'tarjeta_id', 'tipo', 'detalle', 'actor', 'created_at']
  };
  const INDICES = [
    'idx_proyectos_responsable', 'idx_tableros_proyecto', 'idx_listas_tablero',
    'idx_tarjetas_lista', 'idx_tarjetas_responsable', 'idx_tarjetas_vencimiento',
    'idx_etiquetas_tarjeta', 'idx_actividad_proyecto', 'idx_actividad_tablero', 'idx_actividad_tarjeta'
  ];
  const RELACIONES = {
    proyectos: { responsable_id: 'responsables' },
    tableros: { proyecto_id: 'proyectos' },
    listas: { tablero_id: 'tableros' },
    tarjetas: { lista_id: 'listas', responsable_id: 'responsables' },
    tarjeta_etiquetas: { tarjeta_id: 'tarjetas', etiqueta_id: 'etiquetas' },
    actividad: { proyecto_id: 'proyectos', tablero_id: 'tableros', tarjeta_id: 'tarjetas' }
  };

  function version(db) {
    return db.exec('PRAGMA user_version')[0].values[0][0];
  }

  function _integridad(db) {
    const resultado = db.exec('PRAGMA quick_check');
    if (!resultado.length || resultado[0].values.some(row => row[0] !== 'ok')) {
      throw new Error('La base de datos no supera la comprobación de integridad.');
    }
  }

  function _columnas(db, tabla, esperadas) {
    const columnas = db.exec(`PRAGMA table_info(${tabla})`);
    if (!columnas.length || esperadas.some(nombre => !columnas[0].values.some(row => row[1] === nombre))) {
      throw new Error('Esquema incompatible: faltan columnas de ' + tabla + '.');
    }
    db.exec(`SELECT ${esperadas.join(',')} FROM ${tabla} LIMIT 0`);
    return columnas[0].values;
  }

  function validarLegacy(db) {
    _integridad(db);
    const columnas = _columnas(db, 'proyectos', CAMPOS_LEGACY);
    if (!columnas.some(row => row[1] === 'id' && row[5] === 1) ||
        ['nombre', 'responsable'].some(nombre => !columnas.some(row => row[1] === nombre && row[3] === 1))) {
      throw new Error('Las restricciones del esquema histórico no son compatibles.');
    }
    const tablas = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    if (tablas[0].values.some(row => row[0] !== 'proyectos')) {
      throw new Error('La base sin versión contiene tablas ajenas al esquema histórico. No se migrará automáticamente.');
    }
  }

  function validar(db) {
    _integridad(db);
    if (version(db) !== VERSION) throw new Error('Versión de esquema incompatible.');
    for (const [tabla, columnas] of Object.entries(COLUMNAS)) _columnas(db, tabla, columnas);
    const indices = db.exec("SELECT name FROM sqlite_master WHERE type='index'")[0].values.map(row => row[0]);
    if (INDICES.some(nombre => !indices.includes(nombre))) throw new Error('Faltan índices del esquema vigente.');
    for (const [tabla, relaciones] of Object.entries(RELACIONES)) {
      const claves = db.exec(`PRAGMA foreign_key_list(${tabla})`);
      for (const [columna, destino] of Object.entries(relaciones)) {
        if (!claves.length || !claves[0].values.some(row =>
          row[2] === destino && row[3] === columna && row[4] === 'id' && row[6] === 'RESTRICT')) {
          throw new Error('Relación incompatible en ' + tabla + '.' + columna + '.');
        }
      }
    }
    if (db.exec('PRAGMA foreign_key_check').length) throw new Error('Hay relaciones inválidas en la base de datos.');
    const fk = db.exec('PRAGMA foreign_keys')[0].values[0][0];
    if (fk !== 1) throw new Error('Las claves foráneas no están habilitadas.');
  }

  function preparar(db, nueva) {
    db.run('PRAGMA foreign_keys=ON');
    const actual = version(db);
    if (actual > VERSION || actual < 0) throw new Error('La base pertenece a una versión no compatible de VERTEX.');
    if (nueva) {
      db.run(LEGACY);
      migrar(db);
      return false;
    }
    if (actual === 0) {
      validarLegacy(db);
      return true;
    }
    validar(db);
    return false;
  }

  function migrar(db) {
    if (version(db) === VERSION) { validar(db); return; }
    if (version(db) !== 0) throw new Error('No existe una migración para esta versión.');
    validarLegacy(db);
    const original = db.exec(`SELECT ${CAMPOS_LEGACY.join(',')} FROM proyectos ORDER BY id`);
    db.run('BEGIN IMMEDIATE');
    try {
      db.run(MIGRACION_1);
      db.run('PRAGMA user_version=1');
      validar(db);
      const migrados = db.exec(`SELECT ${CAMPOS_LEGACY.join(',')} FROM proyectos ORDER BY id`);
      if (JSON.stringify(original) !== JSON.stringify(migrados)) {
        throw new Error('La migración alteró datos históricos.');
      }
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }
  }

  window.PSA = window.PSA || {};
  window.PSA.Esquema = { VERSION, preparar, migrar, validar };
})();
