# Persistencia relacional y migraciones — esquema 3

**Fecha:** 2026-10-25

**Implementado:** fases 2, 5 y 6 de la [evolución visual](evolucion-visual.md).

**Pendiente:** Mis tareas e historial visual ampliado. Responsables, etiquetas, prioridad, filtros, calendario e historial básico ya tienen interfaz.

## Módulos

- [migraciones.js](../js/migraciones.js): DDL histórico, migraciones `0 → 1 → 2 → 3`, validación de integridad, versión, columnas, índices y claves foráneas.
- [db.js](../js/db.js): permisos, respaldo, consentimiento, activación y escritura confirmada.
- [trabajo.js](../js/trabajo.js): operaciones relacionales sobre responsables, tableros, listas, tarjetas, etiquetas y actividad.
- [calendario.js](../js/calendario.js) y [actividad.js](../js/actividad.js): presentación temporal e historial paginado usando las APIs de tarjetas/actividad.
- [app.js](../js/app.js) e [index.html](../index.html): confirmación/cancelación de migración, foco, teclado y estado.

Orden de carga: sql.js, migraciones, DB, trabajo, proyectos, tableros, calendario, actividad, dashboard y app. Se conserva `window.PSA`, sin paquetes nuevos, backend ni bundler.

## Esquema

`PRAGMA user_version=3` identifica el esquema actual; no equivale a la versión de la aplicación. Una versión desconocida superior se rechaza sin escritura.

| Tabla | Campos y comportamiento |
|---|---|
| `proyectos` | Todos los campos históricos intactos. Agrega `descripcion=''`, `prioridad='Media'`, `archivado=0`, `responsable_id=NULL` |
| `responsables` | ID, nombre normalizado obligatorio, archivado y fechas; catálogo local, sin autenticación |
| `tableros` | Proyecto padre, nombre, descripción, archivado y fechas |
| `listas` | Tablero padre, nombre libre, categoría funcional, posición entera no negativa, archivado y fechas |
| `tarjetas` | Lista padre, título, descripción, `responsable_id` histórico compatible, prioridad, inicio/vencimiento, observaciones, completada, archivada, posición y fechas |
| `tarjeta_responsables` | Relación M:N con PK compuesta y FK restrictivas; guarda asignaciones múltiples sin duplicados |
| `etiquetas` | Nombre normalizado, color hexadecimal validado, archivado y fechas |
| `tarjeta_etiquetas` | Clave primaria compuesta tarjeta/etiqueta, sin duplicados |
| `actividad` | ID incremental, referencias opcionales a proyecto/tablero/tarjeta, título de tarjeta en el momento del evento, tipo, detalle, actor local y fecha |

Las prioridades que muestra la interfaz son Crítica, Alta, Media y Baja. Por compatibilidad, Crítica se almacena como el valor histórico `Urgente`, incluido desde el esquema 1 en el `CHECK`; las tarjetas nuevas siguen usando Media como valor predeterminado. Las tarjetas históricas no se migran ni se elevan automáticamente a Crítica. Las categorías son `pendiente`, `en_curso`, `en_revision`, `bloqueado` y `completado`, independientemente del nombre que se dé a cada lista.

Las relaciones usan `ON DELETE RESTRICT`. Hay índices para responsables de proyectos y tarjetas, tableros de proyecto, orden de listas/tarjetas, vencimientos de tarjetas, búsqueda inversa de etiquetas y referencias de actividad. Las etiquetas y responsables se archivan lógicamente; sus asignaciones sobreviven y los registros no se eliminan físicamente.

La API normaliza espacios y compara nombres con NFKC y minúsculas antes de crear o renombrar. No impone índices únicos SQL basados en `lower()` porque no reproducirían correctamente la normalización Unicode; las operaciones de escritura se serializan en la única instancia escritora. Un acceso externo simultáneo a SQLite no está soportado.

Se habilitan las FK al cargar, clonar y después de exportar: sql.js reabre la conexión durante `export()` y reinicia pragmas. Una FK inválida, un índice ausente o un esquema incompatible impide activar o persistir la candidata.

Los campos de fecha de planificación son cadenas de calendario locales `YYYY-MM-DD`; no representan instantes y no se convierten a UTC. La API valida fechas reales y que inicio no sea posterior a vencimiento. Los timestamps de actividad sí usan UTC ISO 8601; la UI los presenta en la zona local. Mover tarjetas no cambia sus fechas.

## Migración con consentimiento

1. Al conectar una base sin versión se valida que tenga los campos y restricciones históricos y no tablas ajenas. La migración la lleva de 0 a 1, luego a 2 y finalmente a 3 en una transacción.
2. Al conectar una base versión 1, se valida su esquema antes de solicitar actualización a versión 3.
3. Al conectar una base versión 2, se valida su esquema antes de solicitar actualización a versión 3.
4. La app muestra **Actualizar base de datos**. No publica una candidata ni escribe el original por el mero hecho de abrirla.
5. **Cancelar** (o Esc fuera de una operación) conserva la base previa y no crea respaldo.
6. **Crear respaldo y actualizar** valida/migra una copia en memoria dentro de una transacción.
7. Antes de escribir, se comprueba que el original no cambió.
8. Con carpeta autorizada, se crea junto al original un archivo de nombre único `vertex.pre-vN.<tiempo>.<identificador>.db` para la versión destino. Un nombre ya existente se rechaza.
9. Para conexiones antiguas sin handle de carpeta, se solicita un destino mediante el selector del sistema. Si existe contenido, o es el archivo original, se rechaza sin sobrescribir.
10. Se escribe el respaldo y se compara byte a byte con el original.
11. Se vuelve a comprobar el original, se escribe el archivo migrado y se espera `close()`.
12. Solo entonces se activa la nueva conexión y se confirma éxito indicando el nombre del respaldo.

La migración `1 → 2` agrega `etiquetas.archivado` con valor `0`, crea `tarjeta_responsables` con claves foráneas y copia cada vínculo no nulo de `tarjetas.responsable_id`. La columna antigua permanece para compatibilidad con consultas/proyectos y versiones previas; las operaciones nuevas de tarjetas mantienen su primer responsable en esa columna y la colección completa en la tabla intermedia. Una clave compuesta previene duplicados. No se altera título, descripción, prioridad, posición, lista o relación de etiquetas existente.

La migración `2 → 3` agrega `actividad.tarjeta_titulo` con cadena vacía por defecto y la rellena a partir del título vigente al migrar de cada tarjeta asociada. No reconstruye el título que tenía cada tarjeta cuando ocurrió un evento antiguo ni cambia las tarjetas o los textos del evento. Los eventos creados desde v3 guardan el título del momento. Si se elimina una tarjeta físicamente mediante una herramienta externa, `ON DELETE RESTRICT` protege las referencias: la aplicación solo ofrece archivar/restaurar tarjetas y conserva su actividad.

No se fusionan responsables, no se convierten textos por similitud y no se crean tableros, tarjetas ni eventos históricos artificiales. Todos los valores históricos se comparan antes/después de migrar.

Las bases vacías nuevas se crean directamente en esquema 3 sin respaldo de datos inexistentes. Reabrir una base vigente no la migra otra vez ni agrega filas.

Una falla de migración revierte su transacción en memoria. Una falla de respaldo o de escritura no reemplaza la conexión confirmada. Se permite reintentar y se muestra el error. Un respaldo creado antes de una escritura fallida se conserva; los reintentos usan otro nombre. No se borran automáticamente archivos que puedan servir para recuperación. No usar como respaldo un archivo de un intento fallido sin verificar su contenido.

## Recuperación

1. Cerrar VERTEX y cualquier otra herramienta que use la base.
2. Conservar la base migrada aparte: puede contener cambios posteriores.
3. Copiar el respaldo previo verificado a una **carpeta separada**, nombrándolo `vertex.db`.
4. Abrir esa carpeta con la versión anterior de la app.

No existe una degradación automática del esquema ni se destruyen tablas para volver atrás. El respaldo contiene únicamente los datos previos a la migración: no puede recuperar cambios hechos después.

## API relacional disponible

### Transacciones confirmadas

`PSA.DB.transaccion(operacion)` recibe una función **síncrona** con:

- `tx.run(sql, parametros)`: ejecuta SQL parametrizado y devuelve filas modificadas.
- `tx.all(sql, parametros)`: devuelve filas como objetos.

Las llamadas son para módulos de confianza de la aplicación, nunca para SQL introducido por usuarios. Toda la función se ejecuta en una candidata con transacción SQLite y FK habilitadas. El resultado se publica solo después de validar, confirmar la transacción y terminar la escritura del archivo. Un error descarta todas las sentencias y sus eventos.

`PSA.DB.consultar(sql, parametros)` permite SELECT parametrizado sobre el estado confirmado.

### `PSA.Trabajo`

| Método | Comportamiento confirmado |
|---|---|
| `guardarResponsable(entrada)` | Crear/renombrar; ID omitido para crear, ID existente para editar |
| `asignarResponsableProyecto(proyectoId, responsableId)` | Vincular explícitamente o desvincular con `null`; conservar nombre histórico cuando se desvincula |
| `guardarTablero(entrada)` | Crear/editar; al crear agrega las cinco listas iniciales en la misma operación |
| `guardarLista(entrada)` | Crear/renombrar; categoría y orden almacenados |
| `guardarTarjeta(entrada)` | Crear/editar; `responsables` y `etiquetas` aceptan listas de IDs, más fechas, prioridad y completitud. Si se omiten en una edición, sus relaciones se conservan. Para compatibilidad acepta también `responsable_id` singular |
| `guardarEtiqueta(entrada)` | Crear/editar nombre y color hexadecimal de seis dígitos |
| `archivar(tipo, id, booleano)` | Proyecto, tablero, lista, tarjeta, responsable o etiqueta; archivo/desactivación y restauración/reactivación explícitos |
| `reordenarListas(tableroId, ids)` | Exige cada lista activa exactamente una vez |
| `moverTarjeta(id, destinoId, posicion)` | Mismo tablero, posición cero-based válida para inserción o reordenamiento en la misma etapa; operación atómica |
| `moverTarjetas(movimientos)` | Lista no vacía de `{id, destinoId}` únicos del mismo tablero; valida destinos y aplica todo en una transacción, asigna posiciones únicas al final de cada destino conservando el orden de entrada y deja intactas las posiciones de las demás tarjetas |
| `getResponsables()`, `getTableros()`, `getListas(tableroId)`, `getEtiquetas()` | Filas persistidas, incluyendo inactivos para consulta y restauración |
| `getTarjetas()` | Filas con contexto de lista/tablero/proyecto, arrays `responsables` y `etiquetas`, y marcas de archivo de cada nivel |
| `getEtiquetas()`, `getTarjetaEtiquetas(id)` | Catálogo y asignaciones persistidas |
| `getActividad({tarjetaId, tableroId, limite, antesId})` | Eventos en orden descendente, filtrados opcionalmente por tarjeta/tablero; límite predeterminado 100 y máximo 200 por consulta; cursor exclusivo para paginar |

Renombrar un responsable sincroniza los nombres de proyectos explícitamente vinculados, no los textos sin vínculo. Archivar un padre no modifica las marcas propias de sus hijos; restaurar hijos requiere que sus contenedores estén activos.

`guardarTarjeta` registra dentro de la misma transacción la creación y los cambios efectivos de título, descripción, prioridad, responsables, etiquetas, etapa, fechas, observaciones y completitud. Una edición idéntica no genera eventos. Los eventos nuevos guardan el título de la tarjeta al ocurrir; los eventos de asignación guardan el nombre del elemento afectado. Actor por defecto: `Instalación local`; no se identifica una persona porque no hay autenticación. Si falla la escritura, tanto los datos como los eventos se descartan.

Mover a una lista de categoría completado completa la tarjeta; mover a otra categoría la reabre. Reordenar dentro de la misma lista conserva la completitud. También puede marcarse completada sin cambiar de lista. `moverTarjetas` conserva el orden relativo de las seleccionadas según el orden de entrada, agrega las tarjetas después de la última posición existente y no altera la posición de tarjetas no seleccionadas; la UI ordena los IDs seleccionados visualmente antes de llamar a la API. Una selección inválida, un destino de otro tablero o un fallo de escritura descarta el lote entero.

No se permite cambiar de tablero una lista ni de proyecto un tablero. Una lista con tarjetas puede renombrarse, pero no cambiar su categoría: se debe crear otra lista y mover las tarjetas explícitamente para no alterar su interpretación de estado de manera implícita.

La eliminación histórica de proyectos sigue disponible si no hay tableros ni actividad asociada. Si los hay, se rechaza con un mensaje que indica archivar para proteger relaciones e historial.

## Límites actuales de esta entrega

- Las fases 3 a 5 reutilizan el mismo diálogo para tableros, listas, tarjetas, responsables y etiquetas; filtros y render se resuelven en `PSA.Tableros`, sin consultas SQL en la vista.
- El formulario histórico de proyectos se conserva; sus campos aditivos, archivo/asignación e integración de eventos de creación/edición siguen pendientes fuera del alcance específico solicitado para esta fase 3. No se inventan eventos retrospectivos.
- El Kanban incluye orden de listas, movimiento individual/múltiple y arrastre individual. Con filtros activos se bloquean arrastre y reordenamiento por posición para proteger tarjetas ocultas; selección múltiple requiere confirmación visible para incluir ocultas.
- El calendario muestra inicio y/o vencimiento en mes, semana y agenda; el filtro temporal del tablero incluye con/sin vencimiento, vencidas, hoy, próximos siete días e intervalo personalizado. El intervalo es inclusivo; próximos siete días significa hoy más los seis días calendario siguientes.
- El indicador de vencimiento próximo usa esa misma ventana inclusiva de siete días. Las tareas vencidas son las no completadas con fecha menor al día local actual.
- El historial presenta actividad reciente o por tablero/tarjeta, con hasta 100 eventos por página. No se ha implementado un historial visual/auditoría para toda modificación de campos del proyecto.
- Archivar tarjeta evita la eliminación física y conserva asignaciones e historial; no existe eliminación de tarjetas en la interfaz. FK `RESTRICT` previene la eliminación manual de entidades vinculadas y evita huérfanos.
- No se incluye Mis tareas ni soporte táctil de arrastre.
- Se mantiene una sola instancia escritora por archivo, sin coordinación entre pestañas ni usuarios.
- Se necesita acceso al CDN de sql.js; no se instaló ninguna dependencia.

## Pruebas y alcance

Ejecutar:

```powershell
node --test --test-reporter=spec tests\db.test.cjs
```

Las pruebas usan SQLite real y handles/IndexedDB simulados. Cubren legado, consentimiento pendiente, respaldo exacto y fallido, rollback SQL, cancelación, reintento, cambios externos, versión futura, esquema ajeno, restauración entre sesiones, entidades, asignaciones, etiquetas, movimientos, archivo jerárquico, restricciones y eventos.

Última ejecución de fase 8: `node --test --test-reporter=spec tests\db.test.cjs`: **38 pruebas aprobadas, 0 fallidas**. Incluye migraciones sintéticas 1 → 3 y 2 → 3, rollback, título de evento histórico, fechas de tarjeta, actividad, operaciones no-op, persistencia y regresión de movimientos. Los módulos JS y el test de navegador se validan con `node --check`.

La prueba de navegador aislada `probarFase5Tableros()` comprueba catálogos UI, asignaciones múltiples, prioridad, búsquedas, filtros individuales y combinados, estado vacío, conservación de orden, drag bloqueado y movimiento explícito de selección oculta. `probarFase6Seguimiento()` comprueba 25 casos de las vistas mensuales/semanales/agenda, navegación, fechas, filtros temporales, historial, no-op, estructura ARIA y actualización tras guardar; resultados en [cambios.md](cambios.md).

Ninguna prueba lee la base habitual ni crea copias de ella. Todas las bases son sintéticas, incluido el caso de reapertura. Las migraciones v1 → v3 y v2 → v3 usan binarios sintéticos y respaldo simulado; no se ejecutan sobre datos reales.

### Auditoría A3 y matriz de archivos

Resultado Node A3: **64 aprobadas, 0 fallidas**. Incluye la matriz A3-01 a A3-25 y las regresiones existentes. Los permisos, IndexedDB y Writable son mocks; sql.js 1.10.2 y SQLite se ejecutan realmente desde los artefactos locales.

| ID | Escenario sintético | Resultado comprobado |
|---|---|---|
| A3-01 | Abrir válida | Lectura y conexión correcta sin reescritura |
| A3-02 | Archivo inexistente | Error clasificado, conexión anterior intacta |
| A3-03 | Archivo existente vacío | Rechazo sin inicializar ni escribir |
| A3-04 | No SQLite | Rechazo sin reemplazo |
| A3-05 | Esquema inválido | Rechazo controlado |
| A3-06 | Crear nueva | Creación explícita, esquema y tablas vacías |
| A3-07 | Permiso de lectura concedido | Restauración y consulta; conexión requiere readwrite |
| A3-08 | Permiso de escritura concedido | Escritura y reapertura del cambio |
| A3-09 | Denegado | Error, conservación y reautorización |
| A3-10 | Revocado durante sesión | Reconexión sin reemplazo del estado en memoria |
| A3-11 | Bloqueado | Fallo de Writable sin confirmar |
| A3-12 | createWritable falla | No abortar stream inexistente ni confirmar |
| A3-13 | write falla | Aborto intentado, sin publicación |
| A3-14 | close falla | Aborto intentado, sin éxito comunicado |
| A3-15 | AbortError de escritura | Error de persistencia, no cancelación de selector |
| A3-16 | Reapertura | Datos confirmados disponibles |
| A3-17 | Reintento | Recuperación tras fallo de escritura |
| A3-18 | Handle inválido en IndexedDB | Error y selección manual disponible |
| A3-19 | API no disponible | Mensaje controlado, datos conservados |
| A3-20 | Dos guardados | Segundo rechazado; una escritura confirmada |
| A3-21 | Desaparición y cambio externo | Lectura/comparación impiden sobrescritura |
| A3-22 | abort falla | Error original conservado, candidata no publicada |
| A3-23 | Selector de apertura | Vacío rechazado, válido abierto, cancelación sin cambio |
| A3-24 | Restauración inaccesible / selector denegado | Diagnóstico y recuperación manual |
| A3-25 | Marca nueva recordada | No autoriza sobrescribir un existente vacío |

Browser: `probarPersistenciaA3()` en una página aislada con IndexedDB interceptado antes del arranque. Sus **27 comprobaciones** simulan archivo bloqueado, fallos de createWritable/write/close/abort, desaparición, permisos revocados/denegados, conservación de formulario, reautorización y reintento. Devuelve el binario virtual para reapertura sintética. Las seis suites existentes aprobaron **164** comprobaciones y `verificarSeguridadInterfaz()` aprobó **7**, sin excepciones JavaScript no controladas ni violaciones CSP. Los errores de disco/validación provocados intencionalmente pueden aparecer en consola.

Los archivos existentes de cero bytes se rechazan; solo se crea una base tras confirmar que no existía. Se valida una candidata antes de publicar, y se elimina la marca de creación del estado recordado. La API de apertura de archivos usa `showOpenFilePicker`, evitando el ambiguo selector de guardado; los respaldos siguen usando `showSaveFilePicker`. Antes de transaccionar se consulta permiso, se lee el archivo y se compara con el estado confirmado; solo write y close exitosos permiten publicar.

Si se revoca acceso a la conexión activa, reautorizar no carga otra DB ni limpia formularios: después se reintenta. No hay reparación automática, eliminación ni restauración silenciosa. Una carrera con otro proceso entre lectura y escritura, un close de resultado ambiguo o daño físico siguen fuera de las garantías; la app conserva su estado confirmado e informa error, pero no puede asegurar rollback del archivo. Mantener un solo escritor y respaldos. Quedan pendientes pruebas manuales de permisos/selectores nativos y bloqueos reales del sistema operativo.

Los selectores y permisos del sistema operativo no se aprueban automáticamente: requieren validación manual del usuario. En navegador se puede comprobar el flujo con handles simulados sin escribir datos reales.
