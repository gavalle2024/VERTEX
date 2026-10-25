# Persistencia relacional y migraciones — esquema 2

**Fecha:** 2026-10-24

**Implementado:** fases 2 y 5 de la [evolución visual](evolucion-visual.md).

**Pendiente:** Mis tareas, calendario e historial visual. Responsables, etiquetas, prioridad y filtros de tarjetas ya tienen interfaz.

## Módulos

- [migraciones.js](../js/migraciones.js): DDL histórico, migraciones `0 → 1 → 2`, validación de integridad, versión, columnas, índices y claves foráneas.
- [db.js](../js/db.js): permisos, respaldo, consentimiento, activación y escritura confirmada.
- [trabajo.js](../js/trabajo.js): operaciones relacionales sobre responsables, tableros, listas, tarjetas, etiquetas y actividad.
- [app.js](../js/app.js) e [index.html](../index.html): confirmación/cancelación de migración, foco, teclado y estado.

Orden de carga: sql.js, migraciones, DB, trabajo, proyectos, dashboard y app. Se conserva `window.PSA`, sin paquetes nuevos, backend ni bundler.

## Esquema

`PRAGMA user_version=2` identifica el esquema actual; no equivale a la versión de la aplicación. Una versión desconocida superior se rechaza sin escritura.

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
| `actividad` | ID incremental, referencias opcionales a proyecto/tablero/tarjeta, tipo, detalle, actor local y fecha |

Las prioridades que muestra la interfaz son Crítica, Alta, Media y Baja. Por compatibilidad, Crítica se almacena como el valor histórico `Urgente`, incluido desde el esquema 1 en el `CHECK`; las tarjetas nuevas siguen usando Media como valor predeterminado. Las tarjetas históricas no se migran ni se elevan automáticamente a Crítica. Las categorías son `pendiente`, `en_curso`, `en_revision`, `bloqueado` y `completado`, independientemente del nombre que se dé a cada lista.

Las relaciones usan `ON DELETE RESTRICT`. Hay índices para responsables de proyectos y tarjetas, tableros de proyecto, orden de listas/tarjetas, vencimientos de tarjetas, búsqueda inversa de etiquetas y referencias de actividad. Las etiquetas y responsables se archivan lógicamente; sus asignaciones sobreviven y los registros no se eliminan físicamente.

La API normaliza espacios y compara nombres con NFKC y minúsculas antes de crear o renombrar. No impone índices únicos SQL basados en `lower()` porque no reproducirían correctamente la normalización Unicode; las operaciones de escritura se serializan en la única instancia escritora. Un acceso externo simultáneo a SQLite no está soportado.

Se habilitan las FK al cargar, clonar y después de exportar: sql.js reabre la conexión durante `export()` y reinicia pragmas. Una FK inválida, un índice ausente o un esquema incompatible impide activar o persistir la candidata.

Los campos de fecha de planificación son cadenas locales `YYYY-MM-DD`. La API valida fechas reales y que inicio no sea posterior a vencimiento. Las fechas de las nuevas entidades y actividad usan UTC ISO 8601; los timestamps históricos no se reescriben.

## Migración con consentimiento

1. Al conectar una base sin versión se valida que tenga los campos y restricciones históricos y no tablas ajenas. La migración la lleva de 0 a 1 y luego a 2 en una transacción.
2. Al conectar una base versión 1, se valida su esquema antes de solicitar actualización a versión 2.
3. La app muestra **Actualizar base de datos**. No publica una candidata ni escribe el original por el mero hecho de abrirla.
4. **Cancelar** (o Esc fuera de una operación) conserva la base previa y no crea respaldo.
5. **Crear respaldo y actualizar** valida/migra una copia en memoria dentro de una transacción.
6. Antes de escribir, se comprueba que el original no cambió.
7. Con carpeta autorizada, se crea junto al original un archivo de nombre único `vertex.pre-vN.<tiempo>.<identificador>.db` para la versión destino. Un nombre ya existente se rechaza.
8. Para conexiones antiguas sin handle de carpeta, se solicita un destino mediante el selector del sistema. Si existe contenido, o es el archivo original, se rechaza sin sobrescribir.
9. Se escribe el respaldo y se compara byte a byte con el original.
10. Se vuelve a comprobar el original, se escribe el archivo migrado y se espera `close()`.
11. Solo entonces se activa la nueva conexión y se confirma éxito indicando el nombre del respaldo.

La migración `1 → 2` agrega `etiquetas.archivado` con valor `0`, crea `tarjeta_responsables` con claves foráneas y copia cada vínculo no nulo de `tarjetas.responsable_id`. La columna antigua permanece para compatibilidad con consultas/proyectos y versiones previas; las operaciones nuevas de tarjetas mantienen su primer responsable en esa columna y la colección completa en la tabla intermedia. Una clave compuesta previene duplicados. No se altera título, descripción, prioridad, posición, lista o relación de etiquetas existente.

No se fusionan responsables, no se convierten textos por similitud y no se crean tableros, tarjetas ni eventos históricos artificiales. Todos los valores históricos se comparan antes/después de migrar.

Las bases vacías nuevas se crean directamente en esquema 2 sin respaldo de datos inexistentes. Reabrir una base vigente no la migra otra vez ni agrega filas.

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
| `getActividad()` | Eventos en orden descendente, actor Instalación local y fechas reales |

Renombrar un responsable sincroniza los nombres de proyectos explícitamente vinculados, no los textos sin vínculo. Archivar un padre no modifica las marcas propias de sus hijos; restaurar hijos requiere que sus contenedores estén activos.

Mover a una lista de categoría completado completa la tarjeta; mover a otra categoría la reabre. Reordenar dentro de la misma lista conserva la completitud. También puede marcarse completada sin cambiar de lista. `moverTarjetas` conserva el orden relativo de las seleccionadas según el orden de entrada, agrega las tarjetas después de la última posición existente y no altera la posición de tarjetas no seleccionadas; la UI ordena los IDs seleccionados visualmente antes de llamar a la API. Una selección inválida, un destino de otro tablero o un fallo de escritura descarta el lote entero.

No se permite cambiar de tablero una lista ni de proyecto un tablero. Una lista con tarjetas puede renombrarse, pero no cambiar su categoría: se debe crear otra lista y mover las tarjetas explícitamente para no alterar su interpretación de estado de manera implícita.

La eliminación histórica de proyectos sigue disponible si no hay tableros ni actividad asociada. Si los hay, se rechaza con un mensaje que indica archivar para proteger relaciones e historial.

## Límites actuales de esta entrega

- Las fases 3 a 5 reutilizan el mismo diálogo para tableros, listas, tarjetas, responsables y etiquetas; filtros y render se resuelven en `PSA.Tableros`, sin consultas SQL en la vista.
- El formulario histórico de proyectos se conserva; sus campos aditivos, archivo/asignación e integración de eventos de creación/edición siguen pendientes fuera del alcance específico solicitado para esta fase 3. No se inventan eventos retrospectivos.
- El Kanban incluye orden de listas, movimiento individual/múltiple y arrastre individual. Con filtros activos se bloquean arrastre y reordenamiento por posición para proteger tarjetas ocultas; selección múltiple requiere confirmación visible para incluir ocultas.
- No se incluye Mis tareas, calendario, historial visual ni soporte táctil de arrastre.
- Archivar tarjeta evita la eliminación física y conserva asignaciones. FK `RESTRICT` previene la eliminación manual de entidades vinculadas y evita huérfanos.
- Se mantiene una sola instancia escritora por archivo, sin coordinación entre pestañas ni usuarios.
- Se necesita acceso al CDN de sql.js; no se instaló ninguna dependencia.

## Pruebas y alcance

Ejecutar:

```powershell
node --test --test-reporter=spec tests\db.test.cjs
```

Las pruebas usan SQLite real y handles/IndexedDB simulados. Cubren legado, consentimiento pendiente, respaldo exacto y fallido, rollback SQL, cancelación, reintento, cambios externos, versión futura, esquema ajeno, restauración entre sesiones, entidades, asignaciones, etiquetas, movimientos, archivo jerárquico, restricciones y eventos.

Última ejecución de fase 5: `node --test --test-reporter=spec tests\db.test.cjs`: **35 pruebas aprobadas, 0 fallidas**. Incluye migración sintética v1 → v2, conservación de responsables asignados, validación de nombres y colores, relaciones M:N, inactivos, prioridad, regresión de movimientos y errores atómicos. Los módulos JS y el test de navegador se validan con `node --check`.

La prueba de navegador aislada `probarFase5Tableros()` comprueba catálogos UI, asignaciones múltiples, prioridad, búsquedas, filtros individuales y combinados, estado vacío, conservación de orden, drag bloqueado y movimiento explícito de selección oculta; el resultado actual se registra en [cambios.md](cambios.md).

La prueba que lee la base habitual crea únicamente una copia en memoria y verifica que el original permanece idéntico. La migración v1 → v2 se probó con binario sintético y con respaldo simulado; no se ejecutó sobre la base habitual.

Los selectores y permisos del sistema operativo no se aprueban automáticamente: requieren validación manual del usuario. En navegador se puede comprobar el flujo con handles simulados sin escribir datos reales.
