# AGENTS.md — Gestión de Proyectos PSA · URSA I del Este

> Instrucciones para agentes de IA (GitHub Copilot, etc.) que trabajen en este repositorio.

---

## Descripción del proyecto

Aplicación web de página única (**SPA**) para registrar, seguir y analizar proyectos de implementación de la **Policía de Seguridad Aeroportuaria (PSA)**, específicamente para la Unidad Regional de Seguridad Aeroportuaria I del Este.

Corre directamente en el navegador desde `index.html` **sin servidor back-end**. La base de datos es **SQLite3** (`vertex.db` en una carpeta seleccionable desde la app) accedida vía **File System Access API** (Chrome/Edge). `db/vertex.db` es la ubicación inicial sugerida, no una ruta obligatoria. La persistencia usa **sql.js** (WebAssembly) en memoria y confirma cada cambio solo al finalizar la escritura al archivo.

> **Requiere Chrome o Edge con selección de carpetas habilitada** en un contexto seguro (HTTPS, localhost o archivo local compatible).

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Marcado | HTML5 semántico |
| Estilos | CSS3 puro (sin frameworks) — `css/styles.css` |
| Lógica | JavaScript ES6+ (sin bundler, sin transpilador) |
| Base de datos | **SQLite 3** (`vertex.db` en carpeta autorizada) |
| Motor SQL | **sql.js 1.10.2** (WASM desde CDN) |
| Acceso al archivo | **File System Access API** (Chrome/Edge ≥ 86) |
| Handles persistidos | **IndexedDB** (`psa_fs_v1/handles/vertex_db`): `{archivo, carpeta}`, compatible con handles de archivo anteriores |

---

## Estructura de archivos

```
VERTEX/
├── index.html              # Punto de entrada; solo HTML estructural
├── css/
│   └── styles.css          # Todos los estilos; variables CSS en :root
├── js/
│   ├── db.js               # SQLite + archivos autorizados; sin fallback
│   ├── migraciones.js      # DDL, esquema versionado y validación; cargar antes de db.js
│   ├── trabajo.js          # API relacional; cargar después de db.js
│   ├── proyectos.js        # CRUD y renderizado de la tabla de proyectos
│   ├── tableros.js         # Kanban, catálogos, búsqueda/filtros y diálogo único
│   ├── dashboard.js        # Métricas y panel general
│   └── app.js              # Bootstrap, utilidades globales (PSA.*)
├── db/
│   └── vertex.db           # Base inicial; la app permite otra carpeta
├── tests/
│   ├── db.test.cjs         # Regresión de persistencia con sql.js real
│   └── tableros.browser.js # Pruebas DOM aisladas; no cargar en sesiones de uso
├── docs/
│   ├── arquitectura.md     # Diseño y decisiones técnicas
│   └── cambios.md          # Registro de cambios (changelog)
├── AGENTS.md               # Este archivo
└── gestion_proyectos_psa.html  # Archivo original (referencia histórica)
```

---

## Namespace global

Todo el código usa el objeto global `window.PSA` para evitar colisiones:

| Símbolo | Definido en | Descripción |
|---------|-------------|-------------|
| `PSA.DB` | `js/db.js` | API de base de datos (SQLite + FSA; configuración en IndexedDB) |
| `PSA.Esquema` | `js/migraciones.js` | Esquema 1 y migración 0 → 1; validación |
| `PSA.Trabajo` | `js/trabajo.js` | Entidades relacionales, archivo, asignaciones, orden y actividad |
| `PSA.gestionarConexionDB(elegirCarpeta)` | `js/app.js` | Selecciona carpeta o reconecta la base (requiere gesto del usuario) |
| `PSA.Proyectos` | `js/proyectos.js` | CRUD + renderizado de proyectos |
| `PSA.Tableros` | `js/tableros.js` | `render`, `abrirProyecto(id)`, `reiniciar`, `actualizarEstado`, getter `editorAbierto` |
| `PSA.Dashboard` | `js/dashboard.js` | Renderizado del panel |
| `PSA.escapeHtml(s)` | `js/app.js` | Escapa HTML (anti-XSS) |
| `PSA.formatFecha(f)` | `js/app.js` | `YYYY-MM-DD` → `DD/MM/YYYY` |
| `PSA.genId()` | `js/app.js` | Genera IDs únicos |
| `PSA.toast(msg, tipo)` | `js/app.js` | Notificaciones temporales |
| `PSA.cambiarTab(viewId, btn)` | `js/app.js` | Navegación entre pestañas |
| `PSA.renderTodo()` | `js/app.js` | Actualiza tabla + dashboard + tableros |

---

## Convenciones de código

- **Sin frameworks ni bundlers**: el código debe correr directamente desde `file://` o un servidor estático simple.
- **IIFEs** para encapsular módulos (`js/db.js`, `js/proyectos.js`, `js/dashboard.js`).
- **`app.js` sin IIFE**: es el entrypoint y expone las utilidades en `window.PSA`.
- **Sin `innerHTML` con datos del usuario sin escapar**: siempre usar `PSA.escapeHtml()`.
- **Consultas SQL parametrizadas**: usar siempre `db.run(sql, [params])` — nunca concatenación.
- **`'use strict'`** al inicio de cada módulo JS.
- **Variables CSS** en `:root` de `styles.css`; no valores de color hardcodeados en JS.
- Textos en **español (Argentina)** con acentos correctos (UTF-8).
- `saveProyecto()` y `deleteProyecto()` son asíncronas: siempre esperarlas antes de limpiar formularios, renderizar o notificar éxito.
- No sustituir una base inválida por una vacía. Validar una instancia candidata antes de reemplazar la conexión.
- No permitir operaciones concurrentes ni escrituras con debounce. La instancia visible solo cambia después de `write()` y `close()` exitosos.
- `PSA.DB.estado` y el evento `psa:db-state` centralizan conexión, ubicación, ocupación y errores. Reutilizarlos para actualizar la UI.
- No prometer acceso por una ruta escrita ni mostrar nombres de carpeta como rutas absolutas. El navegador requiere selección autorizada.
- `PSA.DB.transaccion(tx => …)` admite una función síncrona: reutilizar `tx.run/all` con parámetros y registrar eventos dentro de la misma operación. Nunca escribir entidades y actividad por separado.
- Habilitar FK en cada instancia y después de exportar: sql.js reinicia pragmas al reabrir durante `export()`.
- No aplicar migraciones de archivos existentes sin consentimiento y respaldo exacto verificado. Rechazar versiones futuras, esquemas ajenos y cambios externos durante el proceso.
- Reutilizar `PSA.Trabajo` en la UI, sin SQL ni persistencia alternativa en las vistas. El editor único `trabajo-dialog` sirve a tableros, listas y tarjetas; no duplicar formularios ni notificaciones.
- Mantener el detalle archivado en solo lectura y exigir contenedores activos para restaurar hijos. Diferenciar ordenar columnas (`reordenarListas`) de mover tarjetas (`moverTarjeta`/`moverTarjetas`); usar IDs explícitos y nunca alterar tareas no seleccionadas. El movimiento múltiple debe validar todo y ejecutarse en una sola transacción.
- Para DnD, usar únicamente el control `.work-drag-handle` como origen y `moverTarjeta(id, listaId, posicion)` para persistir posiciones. El arrastre es siempre individual; la selección múltiple conserva sus acciones explícitas. Mantener una alternativa por teclado y no declarar soporte táctil sin implementarlo y probarlo.
- Reiniciar la selección de tableros solo después de un cambio de base confirmado. El Esc del diálogo no debe cancelar una edición histórica de proyecto.

---

## Seguridad

- Toda salida HTML de datos del usuario pasa por `PSA.escapeHtml()` (prevención XSS).
- Las consultas SQL usan parámetros posicionales `?` (prevención de SQL injection en sql.js).
- No se envían datos a ningún servidor externo. El único recurso externo es sql.js desde CDN.
- El `Content-Security-Policy` ideal para despliegue en servidor: `default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self'; connect-src https://cdnjs.cloudflare.com`.

---

## Orden de carga de scripts

El orden en `index.html` es crítico:

```html
<script src="https://cdnjs.cloudflare.com/…/sql-wasm.js"></script>
<script src="js/migraciones.js"></script> <!-- define PSA.Esquema -->
<script src="js/db.js"></script>       <!-- define PSA.DB -->
<script src="js/trabajo.js"></script>  <!-- define PSA.Trabajo -->
<script src="js/proyectos.js"></script> <!-- define PSA.Proyectos -->
<script src="js/tableros.js"></script> <!-- define PSA.Tableros -->
<script src="js/dashboard.js"></script> <!-- define PSA.Dashboard -->
<script src="js/app.js"></script>       <!-- inicializa todo -->
```

---

## Modelo de datos

El esquema SQLite y las migraciones se definen en `js/migraciones.js`, versión `PRAGMA user_version=2`. Ver `docs/migraciones.md` para las nueve tablas y sus relaciones. Campos históricos de `proyectos`, que se conservan:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | TEXT PK | Identificador único |
| `nombre` | TEXT | Nombre del proyecto |
| `responsable` | TEXT | Oficial/civil a cargo |
| `division` | TEXT | Área de la PSA |
| `inicio` | TEXT | Fecha inicio (ISO 8601) |
| `meta` | TEXT | Fecha objetivo |
| `fin` | TEXT | Fecha fin real |
| `estado` | TEXT | En curso / Completado / Demorado / Suspendido |
| `avance` | INTEGER | 0–100 % |
| `implementacion` | TEXT | Nivel de implementación (6 valores) |
| `cumplimiento` | TEXT | Estado de cumplimiento (5 valores) |
| `objetivo` | TEXT | Meta medible |
| `resultado` | TEXT | Resultado obtenido |
| `observaciones` | TEXT | Notas adicionales |

Campos nuevos de proyectos: `descripcion`, `prioridad`, `archivado`, `responsable_id`. El formulario histórico aún no los expone. No vincular responsables por similitud de nombres ni reinterpretar avance manual como progreso calculado.

La fase 5 administra responsables y etiquetas locales, con desactivación lógica; `tarjeta_responsables` y `tarjeta_etiquetas` conservan relaciones M:N. La migración 1 → 2 copia las asignaciones históricas de `tarjetas.responsable_id`. La UI presenta Crítica usando el valor SQLite compatible `Urgente`; no recrear ni migrar tarjetas por este alias.

---

## Tareas habituales para agentes

### Agregar un nuevo campo al formulario
1. Crear una migración secuencial en `js/migraciones.js` y actualizar la validación del esquema; no editar retroactivamente una migración aplicada.
2. Preservar el flujo de consentimiento, respaldo y activación de candidata en `js/db.js`; probar datos históricos, fallos y reapertura.
3. Agregar el campo `<label><input>` en `index.html` dentro de `<div class="grid">`.
4. Actualizar `_leerFormulario()` y `editarProyecto()` en `js/proyectos.js`.
5. Actualizar la constante `CAMPOS` en `js/db.js` (compartida por INSERT, UPDATE y validación de columnas).
6. Actualizar `exportarCSV()` en `js/proyectos.js` si corresponde.
7. Agregar columna en la `<table>` de `index.html` y en `renderTabla()` en `js/proyectos.js`.

### Agregar una nueva vista/tab
1. Crear `<section id="v-nueva" class="view">` en `index.html`.
2. Agregar `<button data-view="v-nueva" onclick="PSA.cambiarTab('v-nueva', this)">` en `<nav class="tabs">`.
3. Crear el módulo en `js/nueva-vista.js`.
4. Agregar `<script src="js/nueva-vista.js">` antes de `app.js`.
5. Llamar al render desde `PSA.renderTodo()` en `app.js`.

---

## Compatibilidad y configuración

- El modelo y procedimiento de evolución de `docs/evolucion-visual.md` fueron aprobados. Las fases 2 a 5 solicitadas están implementadas; Mis tareas, calendario e historial visual siguen pendientes. Consultar `docs/migraciones.md` para distinguir APIs disponibles de funciones expuestas en interfaz.

- No hay fallback a localStorage ni migración automática de proyectos antiguos.
- Las migraciones de esquema SQLite 0 → 1 → 2 y 1 → 2 requieren consentimiento y respaldo. No confundirlas con migración de formatos localStorage.
- Se restauran los handles de archivo anteriores y los nuevos registros `{archivo, carpeta}`.
- Cambiar de carpeta abre su base: no mueve ni fusiona proyectos. Crear una base vacía requiere confirmación.
- Si falla el selector, la carga o la escritura, conservar los datos confirmados y permitir reintentar. Informar errores de IndexedDB: la conexión actual puede funcionar aunque no se recuerde su ubicación.
- Uso de una sola instancia escritora por archivo; sin sincronización entre pestañas o usuarios.

## Validación

- Sin bundler ni instalación de paquetes: `node --test tests\db.test.cjs` con Node.js 22+ e internet.
- Las pruebas descargan sql.js 1.10.2, ejecutan SQLite real y simulan handles, permisos e IndexedDB. Nunca usar `db/vertex.db` para pruebas destructivas.
- Verificar sintaxis con `node --check` y comprobar UI en Chrome/Edge para selección, permisos, reconexión y cambio de carpeta.
- `tests/tableros.browser.js` se ejecuta solo en una página aislada sin conexión real; incluye flujos de fases 3, 4 y 5, simula archivos e IndexedDB y no se incluye en `index.html`.
- Los filtros no deben modificar relaciones, posiciones ni orden persistido. Con filtros activos, arrastre y reordenamiento en etapa deshabilitados; si una selección incluye tarjetas ocultas, pedir la confirmación explícita existente antes de mover.
- Responsables y etiquetas desactivados mantienen sus asignaciones históricas; no borrar asociaciones ni ofrecerlos para nuevas asignaciones.

---

## Notas de despliegue

- Para uso local: abrir `index.html` directamente en Chrome/Edge compatible.
- Para despliegue en servidor: servidor estático con HTTPS o localhost para habilitar acceso a archivos.
- Al abrir la app, usar **«Seleccionar carpeta»**; elegir `db/` u otra carpeta con `vertex.db`. La cabecera permite **«Cambiar carpeta de base de datos»**.
- En sesiones siguientes, la app intenta reconectarse automáticamente; si el permiso expiró aparece **«Reconectar vertex.db»**.
- Sin internet: sql.js no carga (WASM desde CDN); la app muestra error.
