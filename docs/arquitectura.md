# Arquitectura — Gestión de Proyectos PSA

**Versión de esquema:** 2 (persistencia relacional, Kanban y organización de fase 5)

**Fecha:** 2026-10-24

## Visión general

SPA estática en HTML, CSS y JavaScript sin frameworks, bundler ni backend. Se abre desde un archivo local compatible o un servidor estático en contexto seguro.

Los proyectos se almacenan exclusivamente en **SQLite3**, en el archivo `vertex.db` de una carpeta autorizada por el usuario. El archivo [../db/vertex.db](../db/vertex.db) es una ubicación inicial, no una ruta fija.

```text
index.html + css/styles.css
          |
       js/app.js (bootstrap, conexión, notificaciones)
          |
   +------+----------------+----------------+
   |                       |                |
js/proyectos.js       js/dashboard.js   js/tableros.js
   |                       |                |
   |                       |           js/trabajo.js
   +-------- js/db.js -----+----------------+
                 |
           sql.js / WASM
                 |
      File System Access API -> carpeta elegida / vertex.db
                 |
      IndexedDB -> handles autorizados, no proyectos
```

## Módulos y responsabilidades

### Presentación

[index.html](../index.html) contiene cabecera, conexión, overlays, formulario/listado de proyectos, dashboard y sección de tableros con un único diálogo reutilizable. [styles.css](../css/styles.css) concentra estilos, variables, estados, columnas con desplazamiento horizontal, adaptación móvil e impresión.

La cabecera mantiene visible la opción de cambiar de carpeta. Se muestran el nombre de la carpeta, el archivo y el estado de operación o error. No se presenta ese nombre como una ruta absoluta.

### Persistencia: [db.js](../js/db.js)

Encapsulado en una IIFE bajo `PSA.DB`. Utiliza sql.js 1.10.2 desde cdnjs.

Se carga primero [migraciones.js](../js/migraciones.js) (`PSA.Esquema`) y después de DB se carga [trabajo.js](../js/trabajo.js) (`PSA.Trabajo`). El detalle de esquema, APIs y recuperación está en [migraciones.md](migraciones.md). La fase 3 agrega presentación sobre estas APIs sin cambiar la persistencia.

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
| `migrarConexion()` | Confirma respaldo y migración pendiente; Promise con `{ok, respaldo}` |
| `cancelarMigracion()` | Descarta la solicitud sin escribir ni cambiar la base previa |
| `transaccion(operacion)` | Ejecuta callback síncrono sobre candidata, valida y espera escritura confirmada |
| `consultar(sql, parametros)` | SELECT parametrizado sobre estado confirmado |

`estado` agrega `requiereMigracion` y `destinoMigracion`. Las conexiones pueden devolver `{ok: false, requiereMigracion: true}`: la UI muestra la confirmación, sin tratarlo como éxito.

Los getters `useSQLite`, `tieneArchivo`, `esperaPermiso`, `ocupado` y `hasFSA` permiten consultar el estado sin exponer handles.

Las operaciones fallidas rechazan su Promise; la UI debe capturar y notificar el error. La cancelación voluntaria del selector no se trata como error.

#### Selección y restauración

1. El usuario invoca `showDirectoryPicker({mode: 'readwrite'})` desde un clic.
2. Se busca `vertex.db` en la carpeta.
3. Si no existe, se pide confirmar la creación de una base vacía, sin copiar la base actual.
4. Se abre una instancia candidata, se habilitan FK y se valida con `quick_check`, versión, columnas, índices y relaciones. El esquema legado requiere confirmación y respaldo, no se actualiza automáticamente al abrir.
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

No hay `localStorage`, fallback JSON ni migración automática de formatos antiguos. Sí existe migración explícita del esquema SQLite, con respaldo y consentimiento. Al reabrir una base vigente no se vuelve a migrar.

Las operaciones relacionales usan una transacción SQL en una candidata y registran actividad antes de persistir. Se validan las FK antes de confirmar; un error revierte o descarta toda la operación. Se vuelven a habilitar FK tras `export()` porque sql.js reinicia pragmas al reabrir la conexión.

### Proyectos: [proyectos.js](../js/proyectos.js)

CRUD con validación de nombre, responsable y fecha de inicio, avance entre 0 y 100, edición cancelable con Esc y confirmación de eliminación. Guardado y eliminación esperan la persistencia y notifican los errores explícitamente.

La tabla filtra por nombre/responsable/división, estado e implementación. CSV exporta solo el subconjunto filtrado, con BOM UTF-8; SQLite exporta toda la base confirmada.

La acción **Tableros** de cada fila abre su catálogo filtrado mediante `PSA.Tableros.abrirProyecto(id)`. Los botones se crean con eventos DOM y no interpolan IDs en código ejecutable. No se modifican campos, cálculos ni contratos del CRUD histórico.

### Tableros: [tableros.js](../js/tableros.js)

IIFE bajo `PSA.Tableros`, cargada antes de `app.js`. Mantiene únicamente selección de tablero y estado efímero del editor; no almacena entidades ni handles.

- Catálogo filtrado por proyecto real, inclusión explícita de archivados, apertura y edición.
- Columnas por lista, nombres libres y categoría funcional; orden de listas activas con `reordenarListas(tableroId, ids)`. La creación de cinco listas iniciales pertenece a `guardarTablero`, no se duplica en la UI.
- Administración local de responsables y etiquetas desde el mismo diálogo de entidades, con búsqueda de catálogo, edición y desactivación/reactivación lógica. No hay autenticación ni cuentas.
- Tarjetas en su lista, detalle/edición, varios responsables y etiquetas, prioridad, fechas, observaciones, completitud y archivo/restauración. Los vencimientos se comparan con el día local; no modifican automáticamente estados del proyecto.
- Búsqueda en memoria por título/descripción y filtros centralizados por responsable, etiqueta, prioridad, etapa y asignación. Buscar o filtrar no modifica registros ni orden.
- Con cualquier filtro activo se deshabilitan el arrastre y los controles de reordenamiento dentro de la etapa, pues los índices parciales no representan la posición persistida. Los movimientos individuales y por lote conservan su API; una selección con tarjetas ocultas requiere activar el control explícito para incluirlas.
- `guardarTablero`, `guardarLista`, `guardarTarjeta` y `archivar` esperan transacción y escritura confirmadas antes de renderizar/notificar. Los errores se registran y se muestran; un guardado fallido conserva el diálogo y sus datos.
- `getTableros`, `getListas`, `getTarjetas`, `getResponsables` y `DB.getProyectos` son las únicas fuentes de datos. La UI no ejecuta SQL, no recrea tablas y no usa localStorage.
- El mismo `<dialog>` nativo cambia sus campos según entidad. Cuenta con etiquetas, título/contexto accesibles, contención de foco, Esc/cancelación con confirmación de descarte y retorno de foco a un elemento existente tras renderizar.
- Archivados y descendientes de contenedores archivados son de solo lectura. Restaurar un padre no altera marcas propias de hijos. El selector de proyecto se bloquea al editar tablero; una categoría de lista con tarjetas también se bloquea según el contrato existente.
- El estado global de DB bloquea acciones de tablero y editor mientras se escribe. Los atajos históricos no interfieren con el diálogo. Un cambio de base confirmado reinicia selección y filtros; una conexión fallida no los descarta.
- Los controles **Ordenar lista antes/después** solo llaman `reordenarListas`; cambiar una columna de lugar no cambia la lista de sus tarjetas.
- Cada tarjeta ofrece casilla, etapa anterior/siguiente y lista de destino específica. Las acciones direccionales validan límites antes de persistir; el destino se limita a listas activas del tablero actual.
- Cada tarjeta activa ofrece un controlador nativo de arrastre separado de sus botones y campos. Se puede insertar antes/después de otra tarjeta o al final, dentro de una etapa activa del mismo tablero. `moverTarjeta(id, destinoId, posicion)` persiste el movimiento y normaliza las posiciones afectadas en una transacción; la vista solo se actualiza después de la escritura confirmada.
- El arrastre siempre mueve una sola tarjeta, incluso si forma parte de una selección. La barra de selección múltiple conserva sus operaciones; el estado accesible informa qué se arrastra. **Subir/Bajar en la etapa** reordena con el mismo contrato y ofrece una alternativa compatible con teclado. El arrastre HTML nativo está orientado a puntero de escritorio; no se ha implementado ni probado interacción táctil.
- La selección conserva IDs, se ordena por etapa y posición visibles, admite seleccionar toda una etapa y cancelar. Una barra informa la cantidad y ofrece movimiento relativo por tarjeta o un destino común. No se acepta selección vacía, selección archivada ni destino inválido.
- `moverTarjeta` se conserva para el movimiento individual y actualiza solo ese ID en los traslados al final de una etapa; las posiciones de origen y destino no seleccionadas se preservan. `moverTarjetas` valida el lote, tablero único y listas activas antes de mutar, asigna nuevas posiciones únicas contiguas al final de cada destino en orden visual y no cambia las posiciones de tarjetas restantes. Eventos y completitud se escriben dentro de una sola transacción. Un error de validación/escritura no publica cambios parciales. El éxito vuelve a renderizar y limpia selección.
- Los controles explícitos de movimiento por etapa y posición se mantienen como alternativa al arrastre.

La fase 5 no incluye Mis tareas, calendario ni historial visual. La actividad relacional sigue escribiéndose dentro de las transacciones. El avance de proyectos sigue siendo manual. Las etiquetas se muestran en distintivos flexibles; no se limita la cantidad máxima por tarjeta.

#### Validación de la interfaz de fases 3, 4 y 5

[tests/tableros.browser.js](../tests/tableros.browser.js) no se incluye en la aplicación. Ejecutarlo **solo en una página de prueba sin base real conectada**; rechaza una conexión activa. Usa SQLite real, archivos en memoria e IndexedDB simulado. No solicita permisos ni escribe archivos de usuario.

En la consola del navegador de esa página aislada:

```javascript
await new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = 'tests/tableros.browser.js';
  script.onload = resolve;
  script.onerror = reject;
  document.head.appendChild(script);
});
const resultado = await probarInterfazTableros();
console.log(resultado.resultados); // 42 comprobaciones; una excepción indica fallo.
```

La prueba usa eventos DOM reales y el diálogo del navegador: CRUD, asociaciones, orden, validación, escape HTML, retraso de cierre, error/reintento, archivo/restauración, estados vacíos y regresión de filtros/dashboard/CSV/SQLite/Esc. Los errores de validación y disco que aparecen en consola son intencionales.

Para verificar una recarga real mediante automatización, conservar fuera de la página `resultado` y `Array.from(window.__archivoPruebaTableros.datos)`, recargar, volver a cargar el script, ejecutar `await prepararPruebaTableros(bytes)` y luego `verificarReaperturaTableros(resultado)`: agrega seis comprobaciones de datos, relaciones, orden y reconstrucción del Kanban desde el binario. Al terminar, recargar para retirar todos los dobles de prueba. La autorización/reconexión de handles reales del sistema operativo sigue siendo una comprobación manual.

Después de la reapertura, `await verificarDisenoTableros()` comprueba nombres de 200 caracteres, desborde, columnas, diálogo, grilla y checkbox al ancho actual; restaura los nombres originales de la base sintética al terminar. Se ejecutó a 390, 768 y 1280 px (cinco comprobaciones por tamaño). Adicionalmente se verificaron Shift+Tab, Esc con descarte rechazado y Esc con descarte confirmado/retorno de foco mediante teclas del navegador.

`await verificarCambioBaseTableros()` agrega cuatro comprobaciones sobre cancelación, archivo inválido, reinicio de selección al cambiar y recuperación sin mezcla al volver a la base sintética original. El script completo suma 67 comprobaciones aprobadas, además de las tres verificaciones de teclado.

La corrección de movimiento se valida con `await probarMovimientoTarjetas()`: 26 comprobaciones de UI para límites, movimiento individual y a destino específico, seleccionar/deseleccionar, selección por etapa, movimiento relativo en ambas direcciones, orden/posiciones relativas, tarjetas que permanecen, falta de selección y error/reintento atómico. Devuelve el binario aislado y las ubicaciones/posiciones esperadas; tras recargar y cargar el helper, `await prepararPruebaTableros(resultado.archivo)` y `verificarReaperturaMovimiento(resultado)` comprueba que los movimientos y el orden persisten.

La fase 5 se valida con `await probarFase5Tableros()`: administración local de responsables/etiquetas, asignaciones múltiples, prioridad crítica, búsqueda por título/descripción y mayúsculas, filtros individuales/combinados, estado sin resultados, posiciones persistidas, arrastre deshabilitado con filtros y selección oculta con confirmación explícita. Devuelve los IDs del tablero, catálogo y etiquetas; se ejecutó en navegador aislado con base sintética.

El DnD se valida con `await probarArrastreTarjetas()`: comprueba el control de inicio, inserción intermedia, reordenamiento dentro de lista, extremos, rechazo intertablero, cancelación, alcance individual con selección múltiple, error/reintento de escritura, orden/posiciones y alternativa de teclado. Devuelve `{archivo, ubicaciones, ordenListas, tableroId, proyectoId}`; tras recargar, `await prepararPruebaTableros(resultado.archivo)` y `verificarReaperturaArrastre(resultado)` comprueban la persistencia. La suite envía eventos `DragEvent` en Chromium con una base sintética; no simula interacción física ni táctil.

Los controles y columnas también se midieron a 390, 768 y 1280 px: no provocan overflow horizontal de documento/tarjeta y el desplazamiento horizontal queda confinado al Kanban.

La regresión final ejecutó 42 comprobaciones de interfaz, 26 de movimiento, 25 de arrastre y 15 comprobaciones responsive (cinco por ancho). La automatización de puntero disponible no produjo eventos de entrada/soltado, por lo que no se registra como prueba de ratón físico; queda recomendada la verificación manual en el navegador de destino.

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

El DDL canónico está en [migraciones.js](../js/migraciones.js). La tabla `proyectos` conserva:

- `id`: TEXT PRIMARY KEY.
- `nombre`, `responsable`: TEXT NOT NULL.
- `division`, `inicio`, `meta`, `fin`: TEXT.
- `estado`, `implementacion`, `cumplimiento`: TEXT con valores iniciales.
- `avance`: INTEGER, limitado en el formulario.
- `objetivo`, `resultado`, `observaciones`: TEXT.
- `created_at`, `updated_at`: fechas de creación y última modificación.

El esquema 1 agrega descripción, prioridad, archivo y vínculo opcional de responsable a proyectos. El esquema 2 agrega `tarjeta_responsables` (relación M:N) y el indicador `etiquetas.archivado`; la migración copia los vínculos existentes de `tarjetas.responsable_id` sin quitar esa columna histórica. Los responsables y etiquetas se desactivan de forma lógica para preservar asignaciones anteriores. Las tarjetas mantienen prioridad SQLite histórica `Urgente` como valor interno compatible, que la interfaz presenta como **Crítica**; la prioridad predeterminada sigue siendo `Media`. Los valores se envían mediante parámetros SQL; los identificadores provienen de constantes internas. No se crean vistas SQL. El formulario histórico de proyectos permanece sin cambios.

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

[tests/db.test.cjs](../tests/db.test.cjs) usa el runner incorporado de Node.js 22+, descarga sql.js 1.10.2 y ejecuta SQLite real con handles/IndexedDB simulados, sin escribir en la base del proyecto. La ejecución de fase 5 aprobó **35 pruebas**.

```powershell
node --test tests\db.test.cjs
```

Cubre CRUD y reapertura, binario SQLite, espera de cierre, exclusión de operaciones, errores de escritura y cierre, reintento, cancelación, archivos corruptos o incompatibles, creación confirmada, conexiones antiguas, permisos denegados, SQL parametrizado, exportación y errores de motor/IndexedDB/API. Los permisos nativos requieren además comprobación en Chrome/Edge.

## Evolución propuesta

El [análisis de evolución visual](evolucion-visual.md) conserva la matriz histórica de brechas sobre la línea base (`user_version=0`) y registra el estado actual: fases 2 a 5 implementadas, con esquema vigente 2. Mis tareas, calendario e historial visual permanecen pendientes. Ver [migraciones y límites de esta entrega](migraciones.md).
