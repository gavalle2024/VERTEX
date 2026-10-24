# Arquitectura — Gestión de Proyectos PSA

**Versión:** 2.4.0  
**Fecha:** 2026-10-23

## Visión general

SPA estática en HTML, CSS y JavaScript sin frameworks, bundler ni backend. Se abre desde un archivo local compatible o un servidor estático en contexto seguro.

Los proyectos se almacenan exclusivamente en **SQLite3**, en el archivo `vertex.db` de una carpeta autorizada por el usuario. El archivo [../db/vertex.db](../db/vertex.db) es una ubicación inicial, no una ruta fija.

```text
index.html + css/styles.css
          |
       js/app.js (bootstrap, conexión, notificaciones)
          |
   +------+----------------+
   |                       |
js/proyectos.js       js/dashboard.js
   |                       |
   +-------- js/db.js -----+
                 |
           sql.js / WASM
                 |
      File System Access API -> carpeta elegida / vertex.db
                 |
      IndexedDB -> handles autorizados, no proyectos
```

## Módulos y responsabilidades

### Presentación

[index.html](../index.html) contiene la cabecera, controles de conexión, overlay obligatorio, formulario, listado y dashboard. [styles.css](../css/styles.css) concentra estilos, variables, estados y reglas de impresión.

La cabecera mantiene visible la opción de cambiar de carpeta. Se muestran el nombre de la carpeta, el archivo y el estado de operación o error. No se presenta ese nombre como una ruta absoluta.

### Persistencia: [db.js](../js/db.js)

Encapsulado en una IIFE bajo `PSA.DB`. Utiliza sql.js 1.10.2 desde cdnjs.

| API | Resultado |
|---|---|
| `init()` | Promise con el estado inicial y restauración de acceso si es posible |
| `configurarCarpeta()` | Promise con `{ok, nombre}` o `{ok: false, cancelado: true}` |
| `solicitarPermiso()` | Promise con el mismo resultado; conserva la conexión pendiente si se deniega |
| `conectarArchivo()` | Selector de archivo conservado para consumidores anteriores; resultado asíncrono uniforme |
| `getProyectos()` | Proyectos ordenados por inicio y creación descendentes |
| `saveProyecto(p, esNuevo)` | Promise que se resuelve tras persistir al archivo |
| `deleteProyecto(id)` | Promise que se resuelve tras persistir al archivo |
| `exportarDB()` | Binario SQLite completo del estado confirmado o `null` |
| `estado` | `{useSQLite, tieneArchivo, esperaPermiso, ocupado, ubicacion, error}` |

Los getters `useSQLite`, `tieneArchivo`, `esperaPermiso`, `ocupado` y `hasFSA` permiten consultar el estado sin exponer handles.

Las operaciones fallidas rechazan su Promise; la UI debe capturar y notificar el error. La cancelación voluntaria del selector no se trata como error.

#### Selección y restauración

1. El usuario invoca `showDirectoryPicker({mode: 'readwrite'})` desde un clic.
2. Se busca `vertex.db` en la carpeta.
3. Si no existe, se pide confirmar la creación de una base vacía, sin copiar la base actual.
4. Se abre una instancia candidata y se valida con `PRAGMA quick_check`, el DDL y una consulta de las columnas necesarias.
5. Solo tras una carga válida, o una escritura inicial exitosa, se reemplaza la conexión activa.
6. Se recuerda `{archivo: FileSystemFileHandle, carpeta: FileSystemDirectoryHandle}` en IndexedDB, base `psa_fs_v1`, store `handles`, clave `vertex_db`.

Las conexiones antiguas que contienen directamente un `FileSystemFileHandle` se normalizan sin exigir una nueva selección. Para ellas se muestra solo el nombre del archivo hasta que el usuario seleccione una carpeta.

En sesiones siguientes se consulta el permiso de lectura/escritura. Si está concedido se carga el archivo; de lo contrario se ofrece reconectar mediante un clic o seleccionar otra carpeta. La denegación permite reintentar, sin abrir automáticamente un segundo selector después de perder la activación del usuario.

Un error en IndexedDB se registra y se muestra: no impide usar una base ya conectada, pero su ubicación podría no recordarse.

#### Escritura confirmada y exclusión de operaciones

```text
validar formulario
       |
adquirir exclusión de operación -> emitir psa:db-state (ocupado)
       |
clonar SQLite confirmado y ejecutar INSERT / UPDATE / DELETE parametrizado
       |
createWritable -> write -> close
       |
reemplazar instancia confirmada -> liberar exclusión -> renderizar -> notificar éxito
```

Se elimina el debounce de escritura. Mientras se escribe o conecta, se rechazan operaciones concurrentes. La UI deshabilita controles de proyectos y conexión, muestra el estado y registra `beforeunload` para advertir al cerrar.

Si falla la escritura, la candidata se descarta, se intenta abortar el stream y se conservan la instancia confirmada y el formulario para reintentar. No se notifica éxito antes de `close()`.

La carga de archivos dañados o incompatibles nunca se convierte silenciosamente en una base vacía. Cancelar o fallar un cambio de ubicación conserva la conexión previa. Al cambiar con éxito, se limpia el formulario; si había datos sin guardar, se pide confirmación previamente.

No hay `localStorage`, fallback JSON ni migración automática de datos antiguos.

### Proyectos: [proyectos.js](../js/proyectos.js)

CRUD con validación de nombre, responsable y fecha de inicio, avance entre 0 y 100, edición cancelable con Esc y confirmación de eliminación. Guardado y eliminación esperan la persistencia y notifican los errores explícitamente.

La tabla filtra por nombre/responsable/división, estado e implementación. CSV exporta solo el subconjunto filtrado, con BOM UTF-8; SQLite exporta toda la base confirmada.

### Dashboard: [dashboard.js](../js/dashboard.js)

Métricas sobre todos los proyectos, independientemente de los filtros:

- Total y cantidades en curso, completados y demorados.
- Avance promedio.
- Porcentaje cumplido en término sobre proyectos distintos de pendiente de evaluación.
- Cinco categorías de cumplimiento y seis niveles de implementación.
- Tabla de suspendidos con responsable y observaciones.

Estado, cumplimiento y avance son ingresados manualmente; no se deducen automáticamente de las fechas.

### Bootstrap y utilidades: [app.js](../js/app.js)

Define `PSA.escapeHtml`, `formatFecha`, `genId`, `toast`, navegación y `renderTodo`. Inicializa la BD, escucha `psa:db-state` y centraliza los controles de conexión mediante `gestionarConexionDB(elegirCarpeta)`.

## Modelo de datos

El DDL canónico está en [db.js](../js/db.js), tabla `proyectos`:

- `id`: TEXT PRIMARY KEY.
- `nombre`, `responsable`: TEXT NOT NULL.
- `division`, `inicio`, `meta`, `fin`: TEXT.
- `estado`, `implementacion`, `cumplimiento`: TEXT con valores iniciales.
- `avance`: INTEGER, limitado en el formulario.
- `objetivo`, `resultado`, `observaciones`: TEXT.
- `created_at`, `updated_at`: fechas de creación y última modificación.

El DDL actual no define vistas, índices adicionales ni restricciones CHECK. Los valores de usuario se envían mediante parámetros SQL; los identificadores de columnas provienen de constantes internas.

## Decisiones y límites

- **Sin backend:** conserva la portabilidad y el acceso local. No permite acceder a una carpeta escribiendo su ruta: el navegador exige autorización mediante un selector y no revela la ruta absoluta.
- **IIFEs y namespace PSA:** ejecución sin módulos ES ni servidor obligatorio.
- **SQLite en memoria:** cada cambio escribe una imagen completa. La candidata evita mostrar cambios no confirmados, con un costo adicional de memoria proporcional al tamaño de la base.
- **Un escritor por base:** no hay coordinación entre pestañas, usuarios o programas externos. No editar el archivo simultáneamente desde otra instancia.
- **Cambiar no es trasladar:** seleccionar otra carpeta abre su propia base, sin fusionar datos. Para trasladar, exportar una copia, ubicarla como `vertex.db` en destino y seleccionar esa carpeta.
- **Disponibilidad:** Chrome/Edge con API habilitada, en HTTPS, localhost o archivo local compatible. No se promete soporte Firefox.
- **CDN:** se necesita acceso al JavaScript y WASM de sql.js; si fallan, se bloquea el uso sin fallback.
- **Seguridad:** escape HTML de textos, parámetros SQL y permisos del navegador. Los proyectos no se transmiten a servidores. No hay autenticación ni roles.
- **Cierre:** el navegador puede advertir sobre una operación en curso; no puede garantizarse persistencia frente a cierre forzado, caída del sistema o fallo físico. Mantener respaldos.

## Verificación

[tests/db.test.cjs](../tests/db.test.cjs) usa el runner incorporado de Node.js 22+, descarga sql.js 1.10.2 y ejecuta SQLite real con handles/IndexedDB simulados, sin escribir en la base del proyecto.

```powershell
node --test tests\db.test.cjs
```

Cubre CRUD y reapertura, binario SQLite, espera de cierre, exclusión de operaciones, errores de escritura y cierre, reintento, cancelación, archivos corruptos o incompatibles, creación confirmada, conexiones antiguas, permisos denegados, SQL parametrizado, exportación y errores de motor/IndexedDB/API. Los permisos nativos requieren además comprobación en Chrome/Edge.
