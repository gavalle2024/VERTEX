# Registro de cambios — Gestión de Proyectos PSA

Formato: [Keep a Changelog](https://keepachangelog.com/es/) · Versionado semántico

---

## [2.4.0] — 2026-10-23

### Añadido
- Selección de la carpeta de `vertex.db` desde el overlay y cambio de ubicación desde la cabecera, mediante `showDirectoryPicker`.
- Creación de una base vacía con confirmación cuando el archivo no existe. Elegir otra carpeta no traslada ni combina los proyectos.
- Ubicación identificada por nombre de carpeta/archivo y estado persistente de operación/error. Se aclara que el navegador no expone la ruta absoluta.
- Opción de seleccionar otra carpeta cuando se necesita reconexión; la denegación de permisos admite reintento.
- Persistencia de `{archivo, carpeta}` en IndexedDB y compatibilidad con handles de archivo de versiones anteriores.
- Confirmación antes de descartar un formulario modificado al cambiar de base.
- Evento `psa:db-state`, estado público de conexión y advertencia de cierre durante una operación.
- `tests/db.test.cjs`: pruebas con sql.js real y APIs de archivos simuladas, sin modificar la base de producción.

### Cambiado
- `saveProyecto` y `deleteProyecto` pasan a devolver Promises; la UI espera la escritura y el cierre del archivo antes de limpiar el formulario o mostrar éxito.
- La persistencia trabaja sobre una instancia candidata. Un fallo conserva los datos confirmados y permite reintentar.
- Se reemplaza el debounce por exclusión explícita de operaciones. Se deshabilitan controles incompatibles durante conexiones y escrituras.
- La selección de carpeta abre únicamente la base de destino; una cancelación o carga fallida conserva la conexión y el formulario previos.
- `conectarArchivo()` se conserva como API de selección de archivo, con contrato asíncrono uniforme: errores por rechazo y cancelación mediante `{ok: false, cancelado: true}`.

### Corregido
- Los archivos corruptos o con esquema incompatible se rechazan sin reinicializar ni sobrescribir silenciosamente su contenido.
- Los errores de escritura y cierre se muestran en el estado de conexión y las notificaciones; los errores de IndexedDB advierten que la ubicación puede no recordarse.
- Documentación obsoleta sobre fallback, migraciones localStorage, rutas fijas, vistas/índices y CHECK inexistentes en el DDL actual.

### Documentación
- `README.md`: uso, configuración, traslado manual mediante exportación, resumen funcional detallado, límites y comandos de validación.
- `AGENTS.md`: contratos asíncronos, estado compartido, conservación de datos y pautas de pruebas.
- `docs/arquitectura.md`: arquitectura vigente, selección/restauración, escritura confirmada y límites del navegador.

### Límites preservados
- Sin backend, frameworks ni dependencias de instalación; sql.js continúa cargándose desde CDN.
- Sin coordinación multiusuario/multipestaña; usar un solo escritor por base y mantener respaldos.
- El archivo `db/vertex.db`, la referencia histórica HTML y la planilla Excel no se modifican.

### Verificación
- Validación de sintaxis de los cuatro módulos JavaScript.
- Diez pruebas de regresión con SQLite real, incluyendo apertura de una copia de la base inicial y cambio entre bases existentes sin mezcla de datos.
- Comprobación en navegador de conexión, alta, edición, eliminación, error de escritura y reintento, bloqueo de controles, dashboard, alerta de suspendidos, filtros, CSV y cancelación de cambio.
- Los handles usados en esas comprobaciones son simulados: no se altera la base original ni se automatiza la aprobación de permisos del sistema operativo.

---

## [2.3.1] — 2026-08-26

### Corrección: "Error al guardar. Revise la consola" al crear proyecto

#### Causa raíz
`conectarArchivo()` no llamaba a `_initDB()` cuando el usuario conectaba un **archivo nuevo/vacío** mediante el selector FSA. El bloque `else` condicionaba la escritura al archivo con `if (_db)`, pero `_db` era `null` en ese momento (sql.js cargado, sin instancia de base de datos). El resultado: `_fileHandle` quedaba asignado (overlay se ocultaba), pero `_db` seguía siendo `null`; cualquier intento de guardar fallaba con "Error al guardar. Revise la consola".

#### Correcciones — `js/db.js`
- `conectarArchivo()`: el bloque `else` (archivo vacío) ahora llama `await _initDB(null)` antes de escribir al archivo, garantizando que `_db` esté siempre inicializado al conectar.

#### Correcciones — `js/app.js`
- `arrancar()`: el bloque `catch` ahora llama `_actualizarEstadoDB({ useSQLite: false, … })` en lugar de solo actualizar un span, asegurando que el overlay bloqueante aparezca ante cualquier fallo de inicialización imprevisto.

---

## [2.3.0] — 2026-07-14

### SQLite3 puro — `db/vertex.db` como única fuente de verdad

#### Añadido
- **`db/vertex.db`** — Archivo SQLite3 creado con el esquema completo de la tabla `proyectos` e índices. Es la única fuente de persistencia de la aplicación.

#### Cambiado
- **`js/db.js`** — Eliminados todos los mecanismos de persistencia alternativa: localStorage, JSON plano y funciones de migración (`_migrarLegacy`, `_migrarClaveStorage`). El motor ahora depende exclusivamente de `db/vertex.db` vía File System Access API.
- **`js/db.js` — `_persistir()`** simplificada: escribe únicamente en `db/vertex.db` con debounce de 300 ms.
- **`js/db.js` — `init()`** simplificada: carga sql.js y restaura el handle de IndexedDB; sin fallback a localStorage.
- **`js/db.js` — `getProyectos()`**, **`saveProyecto()`**, **`deleteProyecto()`**: eliminados los fallbacks a localStorage.
- **`js/app.js` — `_actualizarEstadoDB()`**: muestra un overlay bloqueante de pantalla completa cuando la base de datos no está conectada (3 estados: sql.js no disponible / permiso vencido / sin archivo).
- **`index.html`**: nuevo overlay `#connect-overlay` que bloquea la UI hasta que `db/vertex.db` esté conectada.
- **`css/styles.css`**: estilos del overlay (`.connect-overlay`, `.connect-box`, `.connect-icon`, `.connect-hint`).
- **`AGENTS.md`**, **`README.md`**: actualizados para reflejar la arquitectura de archivo único.

#### Eliminado
- **`js/db.js`**: constantes `STORAGE_KEY`, `STORAGE_KEY_V2`, `LEGACY_KEY`.
- **`js/db.js`**: funciones `_u8ToBase64()`, `_base64ToU8()`, `_migrarClaveStorage()`, `_migrarLegacy()`.
- Todas las lecturas/escrituras a `localStorage` en `db.js`, `solicitarPermiso()` y `conectarArchivo()`.

#### Migración desde v2.x
Los datos almacenados en `localStorage['vertex.db']` (v2.2.x) **no se migran automáticamente**. Para preservar datos:
1. Abrir la app en **v2.2.x** y usar **Exportar DB** → descarga `vertex.db`.
2. Mover `vertex.db` a la carpeta `db/` del proyecto.
3. Actualizar a v2.3.0 y conectar `db/vertex.db` mediante el overlay de conexión.

---

## [2.2.0] — 2026-07-14

### Persistencia en archivo real `db/vertex.db` (File System Access API)

#### Añadido
- **`js/db.js` — File System Access API**: la base de datos se puede conectar como archivo físico `db/vertex.db` en Chrome/Edge (≥ 86) mediante `window.showSaveFilePicker`.
  - `PSA.DB.conectarArchivo()` — abre el selector de archivos, carga datos del archivo existente o escribe el estado actual en uno nuevo; requiere gesto del usuario.
  - `PSA.DB.solicitarPermiso()` — reactiva el permiso sobre un handle guardado sin abrir el selector; requiere gesto del usuario.
  - Getters nuevos en `PSA.DB`: `tieneArchivo`, `esperaPermiso`, `hasFSA`.
- **`js/db.js` — IndexedDB**: el `FileSystemFileHandle` se persiste en IndexedDB (`psa_fs_v1 / handles / vertex_db`) para restaurar la conexión automáticamente entre sesiones.
- **`js/db.js` — Debounce de escritura al archivo**: cada operación de escritura dispara la persistencia en archivo con un retraso de 300 ms para evitar escrituras I/O concurrentes.
- **`js/app.js` — `PSA.gestionarConexionDB()`**: función pública que gestiona la apertura o reconexión al archivo desde el botón de la cabecera.
- **`js/app.js` — `_actualizarEstadoDB()`**: función interna que actualiza el indicador de estado (`● db/vertex.db`, `⚠ vertex.db (sin permiso)`, `● localStorage`) y la visibilidad del botón de conexión.
- **`index.html`**: panel `.header-db` en la cabecera con `#db-status` (span) y `#btn-db-connect` (botón dinámico).
- **`css/styles.css`**: estilos para `.header-db`, `#btn-db-connect`, `#db-status.db-connected` (verde) y `#db-status.db-warning` (amarillo).

#### Cambiado
- `PSA.DB.init()` retorna ahora `{ useSQLite, tieneArchivo, esperaPermiso }` (tres campos en lugar de uno).
- Orden de prioridad de carga: **archivo FSA** > **localStorage SQLite** > **localStorage JSON** > **BD vacía**.
- `_persistir()` escribe en localStorage (síncrono) y también en `db/vertex.db` cuando hay un archivo conectado (asíncrono con debounce).
- `_initDB(data)` extrae la lógica de creación/reinicialización de la instancia `SQL.Database`; incluye limpieza del timer de debounce y manejo de datos corruptos.
- `_migrarClaveStorage()` extraída como función independiente (antes estaba inline en `init()`).

#### Seguridad
- No se introduce nueva superficie de ataque: los datos nunca salen del dispositivo local.
- La escritura al archivo usa `createWritable()` de la File System Access API (sandboxed).

---

## [2.1.0] — 2026-07-14

### Renombre de base de datos y limpieza de esquema externo

#### Cambiado
- **`js/db.js`** — Clave de almacenamiento localStorage renombrada de `'psa_sqlite_v2'` a `'vertex.db'`, alineándola con el nombre canónico del archivo exportable.
- **`js/proyectos.js`** — El archivo exportado por «Exportar DB» ahora se llama `vertex.db` (antes `proyectos_psa.db`).

#### Eliminado
- **`db/schema.sql`** — Eliminado; el DDL canónico de la base de datos se mantiene en la constante `DDL` de `js/db.js`, que es la única fuente de verdad del esquema.

#### Añadido
- **`README.md`** — Archivo de presentación del proyecto.
- **`js/db.js`** — Migración automática de clave de almacenamiento: al iniciar, si existe `localStorage['psa_sqlite_v2']` (v2.0.x), los datos se transfieren a `localStorage['vertex.db']` y se elimina la clave anterior sin pérdida de datos.

---

## [2.0.0] — 2026-07-14

### Refactorización completa (v1 → v2)

La versión anterior (`gestion_proyectos_psa.html`) era un archivo HTML monolítico con estilos y lógica incrustados. Esta versión separa completamente las responsabilidades en múltiples archivos.

---

### Añadido

- **`index.html`** — Punto de entrada con únicamente marcado HTML semántico; reemplaza al monolito.
- **`css/styles.css`** — Hoja de estilos externa con todas las reglas CSS; variables de diseño en `:root`.
- **`js/db.js`** — Módulo de persistencia con dos modos de operación:
  - **SQLite** vía `sql.js 1.10.2` (WebAssembly desde CDN de cdnjs).
  - **Fallback automático a `localStorage` JSON** cuando sql.js no está disponible (modo offline).
  - Migración automática de datos del formato legado (`localStorage['proyectos']`) al esquema SQLite.
  - Serialización del binario SQLite en base64 chunkeado (evita límite de call-stack).
  - Exportación del binario `.db` descargable desde la interfaz.
- **`js/proyectos.js`** — Módulo CRUD de proyectos:
  - Validación de campos obligatorios con mensajes específicos.
  - Indicador visual de modo edición con banner informativo.
  - Atajo de teclado `Esc` para cancelar edición activa.
  - Búsqueda por texto ahora incluye la columna `división`.
  - Contador de resultados bajo los filtros.
  - Botón «Exportar DB» para descargar el archivo `.db` SQLite.
  - Export CSV con BOM UTF-8 (compatible con Microsoft Excel en español).
- **`js/dashboard.js`** — Panel de control expandido:
  - Nuevo bloque de **cumplimiento detallado** (5 categorías con conteos individuales).
  - Tabla de alerta de **proyectos suspendidos** (aparece solo cuando hay suspendidos).
  - Barra de avance promedio con color diferenciado.
- **`js/app.js`** — Bootstrap asíncrono:
  - Indicador de motor de BD en la cabecera («SQLite activo» / «localStorage»).
  - Overlay de carga mientras se inicializa sql.js.
  - Namespace global `window.PSA` con utilidades compartidas.
- **`db/schema.sql`** — Esquema SQLite canónico con restricciones `CHECK`, índices y vistas:
  - `v_resumen_estado` — resumen de proyectos por estado.
  - `v_proyectos_riesgo` — proyectos con fecha meta vencida o estado problemático.
- **`AGENTS.md`** — Instrucciones completas para agentes de IA que trabajen en el repositorio.
- **`docs/arquitectura.md`** — Documentación técnica de la arquitectura, decisiones de diseño y flujo de datos.
- **`docs/cambios.md`** — Este archivo.

---

### Corregido

- **Persistencia de datos rota en v1**: `window.storage.get/set` estaba referenciado pero nunca definido; la aplicación nunca guardaba datos entre sesiones. Ahora la persistencia funciona correctamente con SQLite o localStorage.
- **Desbordamiento de call-stack** al serializar bases de datos grandes con `String.fromCharCode.apply(null, largeArray)`: reemplazado por serialización chunkeada.
- **Inyección de HTML**: la tabla de proyectos ahora escapa correctamente todos los campos del usuario mediante `PSA.escapeHtml()` antes de insertarlos en el DOM.

---

### Mejorado

- Separación de responsabilidades: cada archivo JS tiene una única responsabilidad.
- Diseño responsive mejorado para pantallas de 600 px y 900 px de ancho.
- Estilos de foco (`:focus-visible`) en botones e inputs para navegación con teclado.
- `<meta name="viewport">` y `<meta name="description">` en `index.html`.
- Atributos ARIA (`role="tablist"`, `role="tab"`, `aria-selected`, `aria-live`) en navegación y notificaciones.
- Botones con estado `disabled` visualizado vía CSS (`.btn:disabled`).
- Toast con variante de error (`.toast.error` con fondo rojo).
- Transiciones CSS suaves en barras de progreso, botones e inputs.

---

### Seguridad

- Todas las salidas HTML de datos del usuario pasan por `PSA.escapeHtml()` (prevención XSS).
- Las consultas SQL usan parámetros posicionales `?` (prevención de inyección en sql.js).
- No se envían datos a ningún servidor externo; el único recurso externo es sql.js desde CDN de cdnjs.

---

### No modificado

- **`gestion_proyectos_psa.html`** — Se conserva sin cambios como referencia histórica de la v1.
- **`proyectos_implementacion_ursa1este.xlsx`** — Archivo de datos externo no modificado.

---

## [1.0.0] — (anterior a 2026-07-14)

Versión inicial monolítica: `gestion_proyectos_psa.html`.

### Características originales
- Formulario de alta/edición de proyectos.
- Tabla con filtros por estado e implementación.
- Dashboard básico con conteos por estado y nivel de implementación.
- Exportación CSV.
- Impresión por navegador.

### Limitaciones conocidas
- Sin persistencia real (`window.storage` undefined).
- Todo el código en un único archivo HTML de ~450 líneas.
- Sin validación de seguridad contra XSS.
- Sin documentación técnica.
