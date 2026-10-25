# Persistencia relacional y migraciones — esquema 1

**Fecha:** 2026-10-24

**Implementado:** fase 2 de la [evolución visual](evolucion-visual.md).

**No implementado aún:** pantallas de tableros, tarjetas, calendario, tareas e historial. Las APIs descritas aquí son infraestructura, no opciones disponibles en la interfaz.

## Módulos

- [migraciones.js](../js/migraciones.js): DDL histórico, migración `0 → 1`, validación de integridad, versión, columnas, índices y claves foráneas.
- [db.js](../js/db.js): permisos, respaldo, consentimiento, activación y escritura confirmada.
- [trabajo.js](../js/trabajo.js): operaciones relacionales sobre responsables, tableros, listas, tarjetas, etiquetas y actividad.
- [app.js](../js/app.js) e [index.html](../index.html): confirmación/cancelación de migración, foco, teclado y estado.

Orden de carga: sql.js, migraciones, DB, trabajo, proyectos, dashboard y app. Se conserva `window.PSA`, sin paquetes nuevos, backend ni bundler.

## Esquema

`PRAGMA user_version=1` identifica el esquema actual; no equivale a la versión de la aplicación. Una versión desconocida superior se rechaza sin escritura.

| Tabla | Campos y comportamiento |
|---|---|
| `proyectos` | Todos los campos históricos intactos. Agrega `descripcion=''`, `prioridad='Media'`, `archivado=0`, `responsable_id=NULL` |
| `responsables` | ID, nombre obligatorio, archivado y fechas; no hay autenticación ni unicidad de nombre |
| `tableros` | Proyecto padre, nombre, descripción, archivado y fechas |
| `listas` | Tablero padre, nombre libre, categoría funcional, posición entera no negativa, archivado y fechas |
| `tarjetas` | Lista padre, título, descripción, responsable opcional, prioridad, inicio/vencimiento, observaciones, completada, archivada, posición y fechas |
| `etiquetas` | Nombre, color hexadecimal validado y fechas |
| `tarjeta_etiquetas` | Clave primaria compuesta tarjeta/etiqueta, sin duplicados |
| `actividad` | ID incremental, referencias opcionales a proyecto/tablero/tarjeta, tipo, detalle, actor local y fecha |

Las prioridades válidas son Baja, Media, Alta y Urgente. Las categorías son `pendiente`, `en_curso`, `en_revision`, `bloqueado` y `completado`, independientemente del nombre que se dé a cada lista.

Las relaciones usan `ON DELETE RESTRICT`. Hay índices para responsables de proyectos, tableros de proyecto, orden de listas/tarjetas, responsables/vencimientos de tarjetas, búsqueda inversa de etiquetas y referencias de actividad.

Se habilitan las FK al cargar, clonar y después de exportar: sql.js reabre la conexión durante `export()` y reinicia pragmas. Una FK inválida, un índice ausente o un esquema incompatible impide activar o persistir la candidata.

Los campos de fecha de planificación son cadenas locales `YYYY-MM-DD`. La API valida fechas reales y que inicio no sea posterior a vencimiento. Las fechas de las nuevas entidades y actividad usan UTC ISO 8601; los timestamps históricos no se reescriben.

## Migración con consentimiento

1. Al conectar una base sin versión se valida que tenga los campos y restricciones históricos y no tablas ajenas.
2. La app muestra **Actualizar base de datos**. No publica una candidata ni escribe el original por el mero hecho de abrirla.
3. **Cancelar** (o Esc fuera de una operación) conserva la base previa y no crea respaldo.
4. **Crear respaldo y actualizar** valida/migra una copia en memoria dentro de una transacción.
5. Antes de escribir, se comprueba que el original no cambió.
6. Con carpeta autorizada, se crea junto al original un archivo de nombre único `vertex.pre-v1.<tiempo>.<identificador>.db`. Un nombre ya existente se rechaza.
7. Para conexiones antiguas sin handle de carpeta, se solicita un destino mediante el selector del sistema. Si existe contenido, o es el archivo original, se rechaza sin sobrescribir.
8. Se escribe el respaldo y se compara byte a byte con el original.
9. Se vuelve a comprobar el original, se escribe el archivo migrado y se espera `close()`.
10. Solo entonces se activa la nueva conexión y se confirma éxito indicando el nombre del respaldo.

No se fusionan responsables, no se convierten textos por similitud y no se crean tableros, tarjetas ni eventos históricos artificiales. Todos los valores históricos se comparan antes/después de migrar.

Las bases vacías nuevas se crean directamente en esquema 1 sin respaldo de datos inexistentes. Reabrir una base vigente no la migra otra vez ni agrega filas.

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
| `guardarTarjeta(entrada)` | Crear/editar; responsable, fechas, prioridad, completitud y etiquetas múltiples |
| `guardarEtiqueta(entrada)` | Crear/editar nombre y color hexadecimal de seis dígitos |
| `archivar(tipo, id, booleano)` | Proyecto, tablero, lista, tarjeta o responsable; archivo/restauración explícitos |
| `reordenarListas(tableroId, ids)` | Exige cada lista activa exactamente una vez |
| `moverTarjeta(id, destinoId, posicion)` | Mismo tablero, posición cero-based válida para inserción o reordenamiento en la misma etapa; operación atómica |
| `moverTarjetas(movimientos)` | Lista no vacía de `{id, destinoId}` únicos del mismo tablero; valida destinos y aplica todo en una transacción, asigna posiciones únicas al final de cada destino conservando el orden de entrada y deja intactas las posiciones de las demás tarjetas |
| `getResponsables()`, `getTableros()`, `getListas(tableroId)` | Filas persistidas, incluyendo archivados para permitir restauración |
| `getTarjetas()` | Filas con contexto de lista/tablero/proyecto/responsable y marcas de archivo de cada nivel |
| `getEtiquetas()`, `getTarjetaEtiquetas(id)` | Catálogo y asignaciones persistidas |
| `getActividad()` | Eventos en orden descendente, actor Instalación local y fechas reales |

Renombrar un responsable sincroniza los nombres de proyectos explícitamente vinculados, no los textos sin vínculo. Archivar un padre no modifica las marcas propias de sus hijos; restaurar hijos requiere que sus contenedores estén activos.

Mover a una lista de categoría completado completa la tarjeta; mover a otra categoría la reabre. Reordenar dentro de la misma lista conserva la completitud. También puede marcarse completada sin cambiar de lista. `moverTarjetas` conserva el orden relativo de las seleccionadas según el orden de entrada, agrega las tarjetas después de la última posición existente y no altera la posición de tarjetas no seleccionadas; la UI ordena los IDs seleccionados visualmente antes de llamar a la API. Una selección inválida, un destino de otro tablero o un fallo de escritura descarta el lote entero.

No se permite cambiar de tablero una lista ni de proyecto un tablero. Una lista con tarjetas puede renombrarse, pero no cambiar su categoría: se debe crear otra lista y mover las tarjetas explícitamente para no alterar su interpretación de estado de manera implícita.

La eliminación histórica de proyectos sigue disponible si no hay tableros ni actividad asociada. Si los hay, se rechaza con un mensaje que indica archivar para proteger relaciones e historial.

## Límites actuales de esta entrega

- La fase 3 agrega una pestaña funcional de tableros y un diálogo único. Reutiliza `getTableros`, `getListas`, `getTarjetas`, `getResponsables`, `guardarTablero`, `guardarLista`, `guardarTarjeta`, `reordenarListas` y `archivar`, más `PSA.DB.getProyectos`. No modifica este esquema ni repite migraciones.
- El formulario histórico de proyectos se conserva; sus campos aditivos, archivo/asignación e integración de eventos de creación/edición siguen pendientes fuera del alcance específico solicitado para esta fase 3. No se inventan eventos retrospectivos.
- Existe Kanban con orden de listas por botones, movimiento individual anterior/siguiente/destino, selección múltiple atómica y arrastre individual con inserción/reordenamiento por posición. El orden de una columna no mueve por sí mismo las tarjetas a otra lista. No hay soporte táctil de arrastre, filtros de tareas, gestión del catálogo de responsables, etiquetas, calendario ni visualización de actividad.
- Las consultas de infraestructura incluyen archivados; la UI excluye contenedores archivados del catálogo activo, ofrece consulta/restauración explícita y bloquea ediciones en árboles archivados.
- Se mantiene una sola instancia escritora por archivo, sin coordinación entre pestañas ni usuarios.
- Se necesita acceso al CDN de sql.js; no se instaló ninguna dependencia.

## Pruebas y alcance

Ejecutar:

```powershell
node --test --test-reporter=spec tests\db.test.cjs
```

Las pruebas usan SQLite real y handles/IndexedDB simulados. Cubren legado, consentimiento pendiente, respaldo exacto y fallido, rollback SQL, cancelación, reintento, cambios externos, versión futura, esquema ajeno, restauración entre sesiones, entidades, asignaciones, etiquetas, movimientos, archivo jerárquico, restricciones y eventos.

Resultado ejecutado el 2026-10-24: **24 pruebas aprobadas, 0 fallidas**. Los seis módulos JavaScript pasan `node --check`.

Ampliación de fase 3: **27 pruebas aprobadas, 0 fallidas**, incluyendo edición de tableros/listas/tarjetas, nombres libres, relaciones y orden al reabrir, validaciones sin escrituras y fallos de cierre sin publicar datos ni actividad. La comprobación de sintaxis incluye ahora los siete módulos. Las pruebas DOM y sus resultados se detallan en [cambios.md](cambios.md).

La prueba que lee la base habitual crea únicamente una copia en memoria y verifica que el original permanece idéntico. No ejecuta la migración sobre el archivo real.

Los selectores y permisos del sistema operativo no se aprueban automáticamente: requieren validación manual del usuario. En navegador se puede comprobar el flujo con handles simulados sin escribir datos reales.
