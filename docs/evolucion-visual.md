# Evolución visual de VERTEX — análisis y propuesta

**Fecha:** 2026-10-24

**Estado:** análisis y diseño aprobados; fase 2 implementada.

**Alcance:** la matriz registra la línea base 2.4.0 previa a los cambios. La infraestructura entregada se detalla en [migraciones.md](migraciones.md); las pantallas de gestión visual siguen pendientes.

## 1. Evidencia y línea base

Se leyeron íntegramente las instrucciones, README, documentos de arquitectura y cambios, HTML principal, cuatro módulos JavaScript, estilos, pruebas y configuración `.gitignore`. No hay manifiesto de paquetes, bundler ni configuración de backend.

El repositorio local no presentaba cambios según `git status --short` al iniciar el análisis. No se realizaron operaciones de sincronización ni commits.

Se inspeccionó exclusivamente el esquema de una instancia en memoria creada desde el archivo local:

- Archivo SQLite existente, 12.288 bytes al realizar la inspección.
- `PRAGMA user_version = 0`; no existe versionado ni registro de migraciones.
- Una tabla `proyectos`, con los campos documentados en [arquitectura.md](arquitectura.md).
- Sin tablas de responsables, tableros, listas, tarjetas, etiquetas ni actividad.
- Sin claves foráneas; una instancia sql.js nueva informa `foreign_keys = 0`.
- El responsable es texto libre; avance, cumplimiento y estado se ingresan manualmente.

Validación ejecutada el 2026-10-24:

```powershell
node --test tests\db.test.cjs
node --check js\db.js
node --check js\app.js
node --check js\proyectos.js
node --check js\dashboard.js
```

Resultado: **10 pruebas aprobadas, 0 fallidas**, y los cuatro módulos pasan la comprobación de sintaxis. La base original no se modificó.

## 2. Matriz de brechas

Prioridades: **P0** integridad y compatibilidad; **P1** núcleo funcional; **P2** vistas derivadas y mejoras.

La matriz representa el estado previo a implementar la fase 2. Los módulos de migraciones y trabajo ahora existen; los módulos de vistas siguen siendo propuestas.

| Funcionalidad | Estado actual | Problema detectado | Comportamiento esperado | Archivos involucrados | Dependencias técnicas | Pruebas necesarias | Prioridad |
|---|---|---|---|---|---|---|---|
| Persistencia SQLite y carpeta configurable | Implementada | Escrituras confirmadas disponibles; la mutación compartida solo admite una sentencia | Reutilizar exclusión y escritura candidata para operaciones relacionales completas | `js/db.js`, `tests/db.test.cjs` | sql.js, FSA, IndexedDB | Mantener las 10 regresiones; fallo antes/durante cierre | P0 |
| Versionado y migraciones | Inexistente | `user_version=0`; crear tablas al abrir no constituye una migración versionada | Migraciones aditivas, transaccionales, idempotentes, validadas y con respaldo previo | `js/db.js`, propuesto `js/migraciones.js`, pruebas | Inspección de esquema, transacciones, permisos de respaldo | Migrar legado; reapertura; versión futura; rollback; bytes originales intactos ante error | P0 |
| CRUD de proyectos | Implementada | Solo los campos históricos; eliminar no contempla futuros hijos | Conservar formulario, campos, exportaciones y eliminación explícita con protección referencial | `js/proyectos.js`, `js/db.js`, `index.html` | Persistencia actual | Alta/edición/eliminación y no alterar campos históricos | P0 |
| Descripción, prioridad y archivo de proyectos | Inexistente | No hay campos específicos; objetivo no debe reinterpretarse como descripción | Agregar descripción, prioridad y archivo/restauración sin borrar | `js/db.js`, `js/proyectos.js`, `index.html` | Migración aditiva | Predeterminados; archivo/restauración; filtros; CSV | P1 |
| Tableros por proyecto | Inexistente | No hay relación proyecto-tablero | Crear/editar/archivar/restaurar y consultar fechas | `js/db.js`, propuesto `js/tableros.js`, `index.html` | FK a proyectos, actividad | CRUD y archivo; padre inexistente; reapertura | P1 |
| Listas configurables | Inexistente | No hay entidad ni orden persistido | Crear, renombrar, reordenar, archivar/restaurar; nombres libres | `js/db.js`, propuesto `js/tableros.js` | Tablero, posición y categoría funcional | Orden estable, renombre sin cambiar estado, archivo con tarjetas | P1 |
| Tarjetas/tareas y detalle | Inexistente | Sin entidad ni formulario de detalle | CRUD, prioridad, fechas, responsable, observaciones, completar, archivar y restaurar en modal | `js/db.js`, propuesto `js/tarjetas.js`, `index.html`, `css/styles.css` | Listas, responsables, actividad | Campos obligatorios, límites, reapertura, cancelación, foco y Esc | P1 |
| Kanban y movimiento | Inexistente | No existen columnas ni orden de tarjetas | Arrastrar y reordenar, alternativa por teclado, cambio confirmado en SQLite | Propuestos `js/tableros.js`, `js/tarjetas.js`, `js/db.js`, estilos | CRUD, transacción de movimiento y orden | Entre/dentro de listas, sin duplicados, reapertura, rechazo y rollback | P1 |
| Responsables y asignaciones | Parcial | Proyectos tienen texto libre, no identidad reutilizable | Catálogo local, asignación a proyectos y tarjetas, filtros por persona; sin autenticación | `js/db.js`, `js/proyectos.js`, propuesto `js/tarjetas.js`, HTML | Modelo compatible con texto histórico | No fusionar nombres distintos, reasignación, nombres renombrados, FK | P1 |
| Etiquetas reutilizables | Inexistente | No hay etiquetas ni relación múltiple | Nombre/color validado, varias etiquetas por tarjeta y filtros | `js/db.js`, propuesto `js/tarjetas.js`, estilos | Tabla puente, validación de color | Alta, reutilización, duplicados, eliminación de asociación, escape HTML | P1 |
| Prioridades | Inexistente | No se registra prioridad en proyectos o tareas | Baja, Media, Alta, Urgente, con indicador textual además del color | `js/db.js`, proyectos, tarjetas, estilos | CHECK y predeterminados | Persistencia, orden/filtro y valor inválido | P1 |
| Mis tareas | Inexistente | Sin tarjetas ni persona seleccionable | Seleccionar responsable local y consultar tareas reales; no inventar sesión de usuario | Propuesto `js/tareas.js`, `index.html` | Responsables y tarjetas | Persona sin tareas, reasignación y filtros combinados | P2 |
| Calendario | Inexistente | Fechas de proyectos no equivalen a vencimientos de tareas | Mes anterior/siguiente, tareas por fecha y sin fecha, apertura de detalle | Propuesto `js/calendario.js`, HTML, estilos | Tarjetas; utilidades de fecha local | Cambio de mes/año, bisiesto, zona horaria y límites diarios | P2 |
| Búsqueda y filtros | Parcial | Solo nombre/responsable/división, estado e implementación de proyectos | Búsqueda sobre datos persistidos, tarjetas, descripciones, etiquetas, prioridad, lista y vencimiento | Propuestos `js/tareas.js`, `js/tarjetas.js`; proyectos, DB, HTML | Entidades y consultas compartidas | Combinaciones, limpiar, archivados y texto con HTML/apóstrofes | P1 |
| Historial de actividad | Inexistente | Solo fechas de creación/modificación; no hay eventos | Eventos junto con la mutación, fecha real y actor instalación local | `js/db.js`, propuesto `js/actividad.js`, HTML | Escritura multisentencia y esquema | Evento exacto por cambio; ninguno ante error; reapertura | P1 |
| Dashboard ampliado | Parcial | Métricas globales de proyectos; sin tareas/tableros | Mantener indicadores actuales y agregar tareas por estado, vencimiento, prioridad, persona y proyecto; actividad reciente | `js/dashboard.js`, HTML | Consultas/estadísticas comunes | Conteos reales, archivados, denominadores, sin doble conteo | P2 |
| Navegación | Parcial | Dos pestañas; `aria-selected` no se actualiza al cambiar | Seis secciones solo cuando sean funcionales, navegación y estado accesibles | `js/app.js`, `index.html`, estilos | Vistas reales | Estado ARIA, teclado, retorno al tablero y selección al cambiar de BD | P1 |
| UX y responsive | Parcial | Hay estilos, foco, notificaciones e impresión; faltan modal, Kanban y calendario | Evolución gradual con estados vacíos, carga/error, foco y contraste | HTML, estilos, módulos de vistas | Componentes existentes | Escritorio/tablet, teclado, modal, arrastre alternativo | P2 |
| Exportaciones e impresión | Implementada | CSV actual solo incluye campos históricos de proyectos | Conservar CSV filtrado, SQLite completo e impresión; ampliar CSV con nuevos campos cuando existan | `js/proyectos.js`, estilos, HTML | Modelos ampliados | CSV/SQLite, valores cero, apóstrofes, filtros y campos originales | P0 |
| Pruebas de integración | Parcial | Diez pruebas DB; no hay runner DOM ni casos relacionales | Extender Node sin paquetes y verificar flujos en navegador | `tests/db.test.cjs`, pruebas adicionales | sql.js real y navegador | FK activadas en cada clon; migración, CRUD, orden, actividad, XSS y regresión | P0 |

## 3. Decisiones aprobadas

El usuario aprobó el modelo relacional, la compatibilidad y el respaldo previo obligatorio mediante el formulario de confirmación de esta tarea. El criterio futuro de próximas a vencer conserva la propuesta predeterminada de siete días.

### 3.1 Modelo relacional aditivo

Conservar la tabla `proyectos` y todos sus datos. No reinterpretar `objetivo`, `resultado`, `observaciones`, `estado`, `avance` ni `cumplimiento`.

| Entidad | Campos nuevos/principales | Relaciones y restricciones propuestas |
|---|---|---|
| `proyectos` existente | Agregar `descripcion TEXT DEFAULT ''`, `prioridad TEXT DEFAULT 'Media'`, `archivado INTEGER DEFAULT 0`, `responsable_id TEXT NULL` | Campos antiguos intactos; prioridad limitada a cuatro opciones; archivado 0/1; FK opcional a responsables |
| `responsables` | `id`, `nombre`, `archivado`, fechas | Catálogo local sin usuarios/roles; no imponer unicidad de nombre porque puede haber homónimos |
| `tableros` | `id`, `proyecto_id`, `nombre`, `descripcion`, `archivado`, fechas | FK al proyecto; nombre obligatorio |
| `listas` | `id`, `tablero_id`, `nombre`, `categoria`, `posicion`, `archivado`, fechas | FK al tablero; posición entera no negativa; categoría funcional independiente del nombre |
| `tarjetas` | `id`, `lista_id`, `titulo`, `descripcion`, `responsable_id`, `prioridad`, `inicio`, `vencimiento`, `observaciones`, `completada`, `archivada`, `posicion`, fechas | FK a lista y responsable opcional; booleanos y prioridad restringidos; fecha de inicio no posterior al vencimiento cuando ambas existen |
| `etiquetas` | `id`, `nombre`, `color`, fechas | Catálogo reutilizable; color de paleta permitida o hexadecimal validado, nunca CSS arbitrario |
| `tarjeta_etiquetas` | `tarjeta_id`, `etiqueta_id` | PK compuesta y FKs; evitar asignaciones duplicadas |
| `actividad` | `id`, `proyecto_id`, `tablero_id`, `tarjeta_id`, `tipo`, `detalle`, `actor`, `created_at` | Actor real `Instalación local`; referencias opcionales para eventos de distinto nivel; conservar historial, sin inventar eventos antiguos |

Los nombres definitivos y el DDL se fijarán al implementar cada migración, sin SQL configurable por el usuario.

### 3.2 Responsables sin pérdida de texto histórico

No convertir automáticamente textos en personas por similitud, ni fusionar homónimos. Las asignaciones históricas conservan `proyectos.responsable` exactamente como están y comienzan con `responsable_id = NULL`.

La UI permitirá vincularlos explícitamente a una entrada del catálogo. Al asignar un responsable desde el catálogo, guardar también su nombre en el campo histórico para conservar la exportación y presentación existentes. Renombrar una persona deberá sincronizar el texto de proyectos vinculados en la misma operación, sin modificar los no vinculados.

### 3.3 Listas libres, estado de trabajo explícito

No inferir estados leyendo nombres como «Completado» o «Bloqueado». Agregar una categoría funcional de lista (`pendiente`, `en_curso`, `en_revision`, `bloqueado`, `completado`), con nombre libre y categoría elegible.

La creación de un tablero ofrecerá las cinco listas iniciales; no se crearán tableros ni tareas artificiales para proyectos antiguos.

Una tarjeta puede completarse explícitamente. Mover a una lista de categoría completado la completa; mover a otra categoría la reabre. Marcar completada sin moverla mantiene su lista y la muestra como terminada. Los indicadores priorizan la marca completada y usan la categoría para el resto: pendiente, en curso/revisión y bloqueada. El historial registra el cambio real de completitud además del movimiento cuando corresponda.

### 3.4 Archivo, eliminación e integridad

Archivar un proyecto/tablero/lista oculta su árbol del trabajo activo, sin cambiar las marcas de archivo de sus descendientes. Restaurar el padre no desarchiva elementos que se archivaron por separado.

No archivar una lista con tarjetas activas sin confirmación que explique su efecto. Ofrecer el acceso a archivados y restauración, no una ocultación irreversible.

Conservar la eliminación explícita de proyectos sin hijos. Rechazar la eliminación física de proyectos con tableros o actividad relacionada, con un mensaje que ofrezca archivar. No usar cascadas destructivas para borrar proyectos, tableros, listas o tarjetas; FKs con `RESTRICT`. Las asociaciones de etiquetas pueden eliminarse explícitamente.

### 3.5 Tiempo, vencimiento y progreso

- Fechas de planificación como `YYYY-MM-DD` local, validadas sin convertir cadenas de fecha a UTC.
- Instantes nuevos de actividad en UTC ISO 8601, representados en hora local; no reescribir fechas históricas.
- Vencida: no completada, activa y con vencimiento anterior al día local actual.
- Propuesta de «próxima a vencer»: desde hoy hasta los próximos **7 días**, inclusive; criterio único para calendario, tareas y dashboard.
- Conservar el porcentaje manual del proyecto; mostrar por separado progreso de tareas como completadas / total de tareas activas. No sobrescribir avance histórico.
- «Mis tareas» selecciona una persona local; no implica autenticación ni presupone quién usa la instalación.

## 4. Diseño de migraciones y recuperación

La fase 2 implementa este procedimiento. El comportamiento concreto y los comandos están en [migraciones.md](migraciones.md).

1. Identificar versión con `PRAGMA user_version`. `0` solo será legado válido si el esquema histórico coincide; una BD SQLite ajena no debe convertirse silenciosamente.
2. Rechazar versiones superiores a la admitida sin escribir ni «reparar» automáticamente.
3. Aplicar migraciones secuenciales en una instancia candidata en memoria, dentro de transacciones explícitas; actualizar `user_version` solo al concluir cada migración.
4. Habilitar `PRAGMA foreign_keys=ON` en **cada instancia**: carga y clones de escritura. El pragma es de conexión, no un ajuste persistido por exportar SQLite.
5. Validar `quick_check`, estructura/columnas/índices, `foreign_key_check` y conservación de los campos históricos. Abortar ante errores, sin publicar la candidata.
6. Antes de reemplazar un archivo existente por su versión migrada, exigir consentimiento de migración y respaldo binario **idéntico al original**, confirmado en otro archivo con nombre único y sin sobrescritura.
7. Con carpeta autorizada, proponer respaldo junto al original, por ejemplo `vertex.pre-v1.<identificador>.db`. Detectar colisiones y no truncar archivos previos. Con handle antiguo sin carpeta, pedir selección de carpeta o destino de respaldo desde un gesto del usuario; no eludir restricciones de activación del navegador.
8. Una cancelación de autorización/respaldo/migración conserva la base original. No permitir mutaciones sobre una candidata migrada solo en memoria para eludir la confirmación.
9. Solo después de confirmar respaldo y escritura migrada, activar la candidata y actualizar UI. Un error de escritura conserva la instancia visible y permite reintentar.
10. Si ya se completó la migración, reapertura sin duplicación de columnas, tablas, responsables ni eventos. Inicializar nuevas bases directamente en la versión vigente.

### Recuperación de versión anterior

Cerrar las instancias de VERTEX. Conservar aparte la base migrada antes de restaurar. Copiar el respaldo original a una carpeta separada con nombre `vertex.db` y abrir esa carpeta con la versión anterior de la app. No degradar por SQL destructivo ni sobrescribir automáticamente la base migrada. Los cambios realizados después de migrar no existen en el respaldo y no se recuperan mediante una degradación.

La implementación y las pruebas de este procedimiento se harán con bases sintéticas o copias en memoria. No se abrirá la base de uso habitual en modo escritura durante el desarrollo.

## 5. Plan por fases y condiciones de salida

Se conserva el orden solicitado; cada fase funcional debe terminar con pruebas y documentación, en vez de posponer toda la validación hasta el final.

| Fase | Entrega | Dependencias | Condición de salida |
|---|---|---|---|
| 1. Análisis y diseño | Matriz, esquema observado y propuesta de modelo/migración | Lectura e inspección | Línea base aprobada y decisiones autorizadas |
| 2. Migraciones y persistencia | Versionado, respaldo, FK, mutaciones relacionales confirmadas y API de entidades | Aprobación de fase 1 | Legado conservado; fallos no alteran original; reapertura y FK verificadas |
| 3. Primer flujo funcional | Alcance vigente solicitado: proyectos existentes → tableros, listas y tarjetas con detalle, archivo y columnas básicas; actividad relacional ya disponible | Fase 2 | Abrir proyecto, crear tablero/listas/tarjetas, editar y reabrir sin pérdida |
| 4. Kanban interactivo | Movimiento individual/múltiple y arrastre/reordenamiento individual de tarjetas implementados | Fase 3 | IDs seleccionados exclusivos; inserción por posición; orden correcto al reabrir; no duplicados; rollback ante error |
| 5. Organización | Responsables, etiquetas, prioridades, búsqueda combinada y filtros Kanban | Fases 3 y 4 | Asignaciones coherentes, filtros combinables, integridad y orden persistido |
| 6. Calendario y actividad | Calendario mensual, sin fecha, apertura de detalle, vista de historial | Fases 3 y 5 | Fechas locales correctas y eventos persistidos sin inventar antecedentes |
| 7. Dashboard y UX | Indicadores ampliados, accesibilidad, responsive y navegación completa | Fases 4 a 6 | Conteos coherentes; ninguna pantalla o acción vacía |
| 8. Verificación integral | Regresión completa, aceptación en navegador, manual de uso/recuperación | Todas las anteriores | Resultados ejecutados documentados, límites claros y datos preservados |

La actividad se debe escribir ya en la fase 3, dentro de la misma mutación de cada entidad; su vista llega en la fase 6. Así no se pierde historia esperando a implementar la pantalla.

No agregar pestañas futuras ni controles sin comportamiento. Ampliar `PSA.renderTodo()` y el manejo de estado/operaciones conforme aparezca cada vista real. Reutilizar botones, formularios, estilos, escape, notificaciones, conexión y descarga actuales.

## 6. Criterios transversales de prueba

- API actual, CRUD de proyectos, filtros, métricas, CSV, SQLite e impresión sin regresiones.
- Igualdad de todos los valores históricos antes/después de migrar, incluidas cadenas vacías, nulos, Unicode y apóstrofes.
- Migración repetida, versión futura, esquema incorrecto y fallos en respaldo, migración, escritura y cierre.
- No perder eventos ni emitirlos para mutaciones que no llegaron al archivo.
- FK en apertura y clones, hijos huérfanos rechazados y eliminación de padres protegida.
- Posiciones estables, movimientos atómicos y orden determinista sin duplicados.
- Archivo/restauración independiente de padres e hijos.
- Fechas locales, hoy/mañana, año nuevo, bisiestos y horario de verano cuando corresponda.
- Validación en cada punto de entrada, texto seguro y eventos DOM sin interpolar datos en código ejecutable.
- Foco, teclado, modal, alternativa al arrastre, estados de error y tamaños escritorio/tablet.
- No instalar paquetes, publicar, crear commits ni modificar datos reales sin la autorización correspondiente.

## 7. Estado de implementación

- Fase 1: completada; lectura, matriz, diseño y aprobación.
- Fase 2: implementada; esquema versionado, migración consentida con respaldo, transacciones y API relacional; flujos y pruebas en [migraciones.md](migraciones.md).
- Fase 3: implementada según el pedido específico posterior: navegación desde proyectos, catálogo de tableros, listas en columnas, orden con botones, tarjetas con detalle reutilizable, fechas/prioridad/responsable existente/completitud y archivo/restauración. Usa exclusivamente la API de fase 2 sin cambiar esquema ni migraciones. Flujos en [README](../README.md#uso-de-tableros-listas-y-tarjetas), pruebas y archivos en [cambios](cambios.md).
- El pedido vigente conserva el formulario histórico de proyectos: sus campos aditivos y eventos de creación/edición no se incorporaron en esta fase ni se declaran terminados. La actividad de tableros, listas y tarjetas sí queda registrada transaccionalmente por las APIs existentes.
- Fase 4: implementada para tableros Kanban; controles individuales y múltiples, arrastre individual entre/dentro de etapas, inserción por posición, feedback de destino y alternativa de teclado. El movimiento persiste con la API existente y rollback ante error; la selección múltiple no se arrastra en conjunto. Arrastre táctil no implementado ni verificado. Ver [cambios](cambios.md).
- Fase 5: implementada en el alcance confirmado: catálogo local de responsables/etiquetas, asignaciones múltiples, prioridades, búsqueda/filtros, política segura para selección oculta y desactivación lógica. No agrega Mis tareas ni identidad de usuario.
- Fases 6 a 8: pendientes total o parcialmente: calendario, historial visual, Mis tareas, dashboard ampliado y validación táctil/manualmente con dispositivo de destino.
- El esquema vigente es versión 2. La migración 1 → 2 es aditiva: crea la tabla M:N de responsables y agrega estado lógico para etiquetas; respalda y requiere consentimiento. Crítica se presenta usando el valor de SQLite histórico `Urgente` para evitar reconstruir tarjetas o cambiar la restricción.
- Las pruebas sintéticas de fase 5 abarcan migración, persistencia, asignaciones, catálogos, búsqueda/filtros y regresión de orden. Los resultados ejecutados quedan en [cambios](cambios.md); no se alteró la base habitual.
- No se migró ni modificó la base de uso habitual durante el desarrollo. No se instalaron dependencias ni se crearon commits ni operaciones remotas.
