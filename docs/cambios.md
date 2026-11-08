# Registro de cambios — Gestión de Proyectos PSA

Formato: [Keep a Changelog](https://keepachangelog.com/es/) · Versionado semántico

---

## [Sin publicar] — 2026-11-07

### Creación y validación de copias B1/B2
- `PSA.DB.crearBackup({enCarpeta})` guarda el estado confirmado en un destino elegido, independiente y vacío. No cambia conexión/handle ni descarta formularios. Confirma solo tras write, close, relectura, comparación binaria y validación integral; expone estados con `psa:backup-state`.
- `PSA.DB.validarBackup(handle)` usa una instancia sql.js independiente con integrity_check, FK, esquema 3, tablas/índices/columnas esperados y consultas esenciales. Diagnostica vacío, cabecera inválida, truncamiento, integridad y compatibilidad sin modificar ni migrar el origen.
- Se reutiliza la escritura verificada de respaldos previos a migraciones. Exportar mientras hay una operación ocupada se rechaza para impedir concurrencia. No hay nuevas dependencias ni cambios del esquema SQLite.
- Matriz específica: B1 **17 aprobadas**, B2 **14 aprobadas**, incluido respaldo y reapertura con archivos temporales físicos y datos sintéticos. Browser B1/B2 **14**, regresión funcional **164**, A3 **27**, CSSOM **31** y seguridad **7** comprobaciones aprobadas; sin violaciones CSP ni excepciones no controladas. Los permisos y selectores son mocks; la prueba física Node no certifica FSA nativa.
- La comparación entre Uint8Array de Node y VM del test temporal se corrigió a comparación de bytes con Buffer; el resultado final pasó. No se abrió/leyó/modificó la base habitual ni sus auxiliares, y no se hicieron operaciones Git de escritura o remotas.
- B3 y B4 no se implementan todavía: esperan revisión. Los destinos fallidos se conservan, sin eliminación, reparación ni restauración automática; close ambiguo/daño físico/concurrencia externa siguen fuera de las garantías.

### Corrección de CSSOM restringido en Tableros
- `_claseColor()` accedía a `#app-styles.sheet.cssRules` sin controlar SecurityError. La hoja era `css/styles.css`, no una hoja externa obtenida recorriendo `document.styleSheets`; en ciertos contextos file:// una hoja puede cargarse y aun así restringir su CSSOM. El fallo de color impedía terminar el renderizado del catálogo y mostraba error de consulta.
- Los hex validados se insertan ahora en una hoja `CSSStyleSheet` construida y adoptada por el documento, con referencia privada y una regla por color. No se consulta ni modifica CSSOM de hojas importadas. Fallos de construcción/inserción quedan controlados: se conserva el estilo predeterminado y el render continúa.
- CSP intacta, sin atributos style inline ni nuevas dependencias. Persistencia, esquema SQLite y cambios de A3 preservados.
- `probarColoresCSSOM()` aprobó 31 comprobaciones, incluidas fase 5 (18), seguridad (7) y seis casos específicos: hoja importada inaccesible, render, contraste, fallback, restauración del mock y reintento. En este Chromium la hoja importada era accesible nativamente; la restricción que provoca el mensaje reportado se reprodujo con un mock, sin afirmar validación de la configuración exacta del usuario.

### Robustez de persistencia y archivos (A3)
- Retomados los cambios previos en DB y pruebas sin revertirlos. El fallo de memoria del test vacío ocurría al comparar la carpeta almacenada con `conexionAnterior.carpeta` (undefined) y construir el diagnóstico del objeto con binarios; corregida la identidad y retirada la instrumentación. El test aislado y la suite volvieron a aprobar.
- SQLite existente de cero bytes se rechaza sin inicializarlo. Solo se crea tras confirmar ausencia; una marca de creación almacenada no se reutiliza en restauración. `conectarArchivo()` usa selector de apertura para existentes; la creación sigue en el flujo de carpeta y los respaldos en selector de guardado.
- Lectura y permiso se comprueban antes de cada transacción; los bytes externos deben coincidir con el estado confirmado. Errores de lectura, permisos, bloqueo, cuota y Writable se informan sin confirmar guardado. Se intenta abortar un stream creado al fallar write/close; AbortError de persistencia no se interpreta como cancelación de selector.
- Reautorizar acceso a la DB activa no reemplaza SQLite ni descarta formularios; el usuario reintenta el guardado. Un handle IndexedDB inválido permite selección manual. No hay reparación ni restauración automática ante resultados ambiguos o carreras con escritores externos.
- Node: **64 aprobadas, 0 fallidas**, con matriz A3-01 a A3-25 y regresión existente. Browser con archivos/IndexedDB sintéticos: A3 **27**, regresión **164**, seguridad CSP **7** comprobaciones; sin excepciones no controladas ni violaciones CSP.
- No se abrió, leyó ni modificó la base habitual ni archivos auxiliares. Sin dependencias nuevas, staging, commits u operaciones remotas. Selectores, permisos y bloqueos reales del SO siguen pendientes de validación manual; los mocks no certifican esos escenarios.

### Seguridad de interfaz y CSP (A2)
- Se eliminaron los 19 atributos de evento inline de `index.html` y se centralizaron las acciones estáticas por delegación `data-action` en `app.js`; pestañas y filtros usan listeners JavaScript.
- CSP meta estricta: `default-src 'self'`, scripts de `self` y cdnjs, `wasm-unsafe-eval` para el compilador WASM de sql.js, estilos/imágenes/fuentes de `self`, conexiones a cdnjs para WASM, `object-src 'none'`, `base-uri 'self'` y `form-action 'self'`. Sin `unsafe-inline` ni `unsafe-eval`.
- Se removieron los 15 usos de atributos `style` generados por las vistas. Progresos usan `<progress>` nativo y clases; los colores validados de etiquetas se insertan en la hoja CSS local mediante CSSOM. `frame-ancestors` se documentó como encabezado HTTP porque no se aplica desde `<meta>`.
- `tests/tableros.browser.js` agrega siete verificaciones de CSP, ausencia de inline, inicialización de sql.js/WASM, color CSSOM y ejecución única de listener.
- Chromium aislado con IndexedDB interceptado y archivos/base sintéticos: suites existentes **42, 26, 18, 25, 25 y 28** comprobaciones; seguridad **7**. Sin aperturas ni escrituras a `db/vertex.db`.
- La referencia histórica `gestion_proyectos_psa.html` queda intacta, con 12 handlers inline y un script inline; no es parte de la SPA activa ni se carga desde su entrypoint.

### Entorno de pruebas Node reproducible sin CDN
- `tests/db.test.cjs` inicializa sql.js 1.10.2 desde `tests/vendor/sql.js/1.10.2/` (`sql-wasm.js` y `sql-wasm.wasm`); coincide con la versión de producción y no descarga archivos durante la ejecución.
- Se incorpora la distribución oficial mínima y su licencia, sin agregar dependencias npm instaladas ni cambiar la carga CDN de la aplicación.
- La prueba de apertura de base vigente usa una imagen SQLite sintética y ya no lee `db/vertex.db`; el resto de la suite continúa usando archivos simulados y bases sintéticas.
- Node.js 22+: `node --test tests\\db.test.cjs`. Verificar ausencia de llamadas/referencias de red con `rg -n 'cdnjs|https?://|fetch' tests/db.test.cjs` (sin resultados esperados).
- Verificación de implementación y ejecución con `fetch` bloqueado: **38 pruebas aprobadas, 0 fallidas**.

## [Sin publicar] — 2026-10-24

### Auditoría de robustez, actividad y calendario (fase 8) — 2026-10-25
- La auditoría reprodujo eventos históricos falsos al volver a guardar sin cambios responsables, etiquetas, tableros o listas, al reasignar el mismo responsable a un proyecto y al repetir el orden actual de listas. Las ediciones idempotentes de estas entidades y tarjetas ahora conservan `updated_at`, no reescriben asignaciones idénticas ni registran actividad; los cambios efectivos mantienen sus eventos transaccionales.
- El benchmark sintético aislado reprodujo renders completos cercanos a 1,0–1,1 s con 20 tableros, 5 listas por tablero, 10 tarjetas por lista (1000 tarjetas) y 4000 eventos. El calendario recorría las tarjetas repetidamente por cada día. Se indexan los eventos una vez por fecha; se conservan las 2000 apariciones de inicio/vencimiento y el contenido expandible. Tres renders posteriores dieron 411,9, 402,9 y 446,1 ms (mediana 411,9 ms frente a 1067,1 ms inicial: mejora observada del 61,4 % en este entorno).
- La vista de calendario ya no declara `role="grid"` sin filas/celdas ni navegación de teclado de grilla. Expone grupos nombrados y fechas accesibles; la comprobación estructural se agregó a la regresión de calendario. No equivale a una auditoría con lectores de pantalla físicos.
- No se alteró el esquema SQLite ni se instalaron dependencias. La exportación existente crea una copia de la base confirmada; la recuperación desde esa copia sigue siendo manual y no se promete restauración automática. Los respaldos pre-migración siguen siendo exactos y verificados, con consentimiento.
- Node: `node --test --test-reporter=spec tests\db.test.cjs`: **38 aprobadas, 0 fallidas**. La regresión adicional comprueba que las operaciones sin cambios no generan eventos ni alteran timestamps.
- Chromium aislado: fases 3, movimientos, arrastre, 5, 6 y 7 aprobaron **42, 26, 25, 18, 25 y 28 comprobaciones**. La prueba de fase 6 incluye el estado ARIA del calendario. Benchmark: 1000 tarjetas, 4000 eventos, todas las 2000 apariciones de calendario conservadas; consulta de actividad de hasta 200 eventos por llamada.
- Responsive Chromium: mes, semana y agenda verificados a 390, 768 y 1280 px. Se corrigió un desborde interno de 4 px en los nombres largos de días de la vista semanal a 390 px; las nueve combinaciones finales no desbordan la página ni la grilla.
- La base SQLite de uso habitual no se conectó para escribir, migrar ni para el benchmark; las pruebas usan archivos virtuales y sintéticos. Se observó una diferencia entre el hash anotado en el checkpoint previo (`5EC6C84A…76A7452`) y el hash actual, del archivo ignorado por Git (`22E26CD4…A2832B5`). Su hash y fecha de modificación permanecieron iguales durante las pruebas sintéticas de esta fase. No se sobrescribió ni se intentó restaurar el archivo. No hubo commits ni operaciones remotas.
- Pendiente de interacción manual en el navegador de destino: permisos y handles reales de File System Access, ratón físico, lector de pantalla y dispositivos táctiles. La base y las pruebas sintéticas no sustituyen esas comprobaciones.

### Panel de control, indicadores y experiencia de usuario (fase 7) — 2026-10-25
- Se estableció **Panel de control** como pantalla principal, manteniendo las métricas anteriores de proyectos y agregando conteos de tableros/tarjetas activas, pendientes, en curso, completadas y otras categorías funcionales.
- Los indicadores excluyen tarjetas archivadas y descendientes de listas, tableros o proyectos archivados. La completitud se basa en `tarjetas.completada`; Pendientes/En curso usan `listas.categoria`, nunca nombres libres. El progreso por tablero es completadas / tarjetas activas × 100, con estado vacío sin porcentaje.
- Se amplió el resumen de prioridad para Crítica/Alta/Media/Baja; Crítica mantiene el valor SQLite compatible `Urgente`. Se pueden abrir tarjetas críticas/altas desde la lista prioritaria.
- Se reutilizó `PSA.Calendario.seguimiento()` para vencimientos locales: hoy, hoy + seis días, atrasadas y sin fecha. Las atrasadas excluyen completadas y tareas sin vencimiento. El panel muestra las diez primeras tareas vencidas/próximas con tablero, etapa, prioridad, responsables y enlace al editor.
- Se agregaron progreso por tablero, actividad reciente limitada a seis eventos existentes y accesos a proyecto, tablero, tarjeta, calendario, historial y tareas prioritarias/vencidas. Crear tablero/tarjeta abre los flujos existentes; la tarjeta requiere tablero y etapa activa.
- La navegación principal identifica pestaña/vista activa y soporta flechas, Inicio y Fin. La aplicación no incorpora «Mis tareas» ni simula una identidad de usuario.
- Sin conexión a DB se informa que los indicadores no están disponibles; errores de consulta no se sustituyen por valores cero. La actividad conserva un estado de error visible separado.
- No se cambió el esquema SQLite ni se agregó persistencia/caché. `PSA.renderTodo()` actualiza el panel desde datos confirmados. Los indicadores son de consulta y no alteran tarjetas, relaciones ni posiciones.
- Navegador aislado en Chromium: `probarFase7Dashboard()` aprobó **28 comprobaciones** (conteos, archivo, categorías, vencimientos inclusivos, prioridades, progreso 0/20/100 y tablero vacío, actividad, errores, casos sin proyecto/tablero/etapas, accesos, navegación y actualización tras guardar).
- Regresión Chromium: fases 3, movimientos, arrastre, fase 5 y fase 6 aprobaron **42, 26, 25, 18 y 24 comprobaciones**; fase 7 aprobó 28. A 390, 768 y 1280 px, la página y las grillas del panel no desbordan horizontalmente.
- Node: `node --test --test-reporter=spec tests\db.test.cjs`: **37 aprobadas, 0 fallidas**. Todos los módulos y tests JavaScript pasaron `node --check`; `git diff --check` no reportó errores.
- La base habitual no se conectó para las pruebas; se utilizaron bases sintéticas. No hubo cambios de esquema, dependencias, operaciones remotas ni commits.

### Calendario e historial de actividad (fase 6) — 2026-10-25
- Se agregaron vistas mensual, semanal y agenda basadas en `tarjetas.inicio` y `tarjetas.vencimiento`, con navegación por período y acción Hoy. Las tarjetas aparecen en las fechas definidas; una fecha de calendario se mantiene como texto `AAAA-MM-DD`, sin conversión UTC. El calendario abre el editor ya existente y tiene acceso al historial de cada tarjeta.
- Los indicadores del Kanban distinguen sin vencimiento, vencimiento cumplido, vencimiento próximo y vencido, con texto además del color. Próximo se define como vencimiento desde hoy hasta seis días después (siete fechas inclusivas); vencida es fecha anterior a hoy en tarjeta no completada.
- Se agregaron filtros temporales combinables en el tablero: con/sin vencimiento, vencidas, hoy, próximos siete días e intervalo inclusivo desde/hasta. Siguen respetando la política de fase 5: filtros activos bloquean arrastre y reordenamiento parcial, sin cambiar posiciones ni orden.
- La API de `actividad` registra cambios efectivos de tarjetas —creación, título, descripción, prioridad, fechas, asignaciones, etapa, reordenamiento, observaciones y completitud— dentro de la transacción que persiste la tarjeta. Eventos incluyen el título snapshot, detalle y actor neutral `Instalación local`; guardar valores iguales o repetir una posición sin cambios no genera eventos. Errores de escritura revierten tanto cambio como evento.
- Se agregó la consulta por tarjeta/tablero y actividad reciente con límite de 100 por página (máximo API 200) y carga incremental. Los textos se renderizan escapados. Las tarjetas se archivan, no se eliminan físicamente, por lo que sus referencias y trazabilidad continúan disponibles.
- Migración incremental `2 → 3`: añade `actividad.tarjeta_titulo` y rellena los títulos históricos desde la tarjeta vinculada. Se mantiene la migración completa `0 → 1 → 2 → 3`, con consentimiento, respaldo y rollback. No se migró la base habitual.
- Node: `node --test --test-reporter=spec tests\db.test.cjs`: **37 aprobadas, 0 fallidas**. Se validaron fechas, eventos detallados y no-op, consulta acotada/paginada, persistencia y migraciones/rollback con archivos sintéticos.
- Navegador aislado en Chromium: fase 6 **24 comprobaciones**; regresión de fases 3, movimientos, arrastre y fase 5: **42, 26, 25 y 18** comprobaciones. Layout del calendario a 390, 768 y 1280 px: sin desbordamiento de página ni de grilla.
- No se instalaron dependencias ni se realizaron commits u operaciones remotas. Mis tareas, historial visual ampliado de proyectos y soporte táctil siguen pendientes.

### Organización de tarjetas y filtros (fase 5) — 2026-10-25
- Se extendió el esquema a versión 2 con migración incremental `1 → 2`: nueva tabla `tarjeta_responsables` muchos-a-muchos, clave primaria compuesta, claves foráneas restrictivas e índice de búsqueda por responsable; `etiquetas.archivado` con default seguro. La migración copia las relaciones previas desde `tarjetas.responsable_id` y conserva esa columna y todas las posiciones/datos existentes. El proceso `0 → 1 → 2` también quedó cubierto.
- Responsables y etiquetas se pueden crear, buscar, renombrar, desactivar y reactivar desde la pestaña Tableros. Se normalizan los espacios y se rechazan duplicados por NFKC/minúsculas; colores deben ser `#RRGGBB`. La desactivación conserva asignaciones y los registros inactivos aparecen en las tarjetas históricas pero no en opciones para asignar de nuevo.
- El editor único de tarjetas permite varias asignaciones de responsables y etiquetas; `guardarTarjeta` las actualiza atómicamente, elimina duplicados de entrada y conserva relaciones si se edita sin enviar esos campos. Las relaciones tienen FK y no dejan huérfanos; la asignación singular existente se conserva como compatibilidad para proyectos y consumidores previos.
- Prioridades visibles: **Crítica, Alta, Media y Baja**, con default Media. Crítica se persiste como el valor histórico `Urgente` aceptado por el CHECK existente; no se reconstruyen tarjetas ni se asigna prioridad crítica a registros históricos.
- Se incorporó búsqueda inmediata por título/descripción y filtros combinables de responsable, etiqueta, prioridad, etapa y con/sin responsables. El tablero conserva sus columnas y orden; muestra resultados, resumen de criterios, estado vacío y acción de limpieza.
- Con cualquier filtro activo se deshabilitan arrastre y reordenamiento de posición para impedir que el índice visual parcial altere el orden real. Los movimientos individuales/múltiples mantienen su contrato. Seleccionar etapa agrega solo tarjetas visibles; si hay seleccionadas ocultas, la operación múltiple exige confirmarlas explícitamente mediante un checkbox; la opción se reinicia al cambiar filtros.
- `getTarjetas()` presenta arrays de responsables/etiquetas con estado archivado, en dos consultas relacionales por render; las tarjetas muestran distintivos compactos con contraste calculado y estado textual, sin depender solo del color.
- Pruebas Node: `node --test --test-reporter=spec tests\db.test.cjs`: **35 aprobadas, 0 fallidas**. Se añadieron casos para normalización, duplicados, inactivos, asignaciones M:N, etiquetas/color, prioridad, rollback y migración v1 → v2 con datos sintéticos.
- Prueba browser `probarFase5Tableros()`: **18 comprobaciones** para catálogos, prioridades, búsqueda/filtros individuales y combinados, orden no modificado y política de selección oculta. Se realizaron en Chromium con SQLite/binario sintético, nunca con la base habitual.
- La base de uso habitual no fue migrada ni modificada; no se instalaron dependencias, no hubo operaciones remotas ni commits. Mis tareas, historial visual ampliado y arrastre táctil continúan pendientes.

### Kanban con arrastre y reordenamiento (fase 4) — 2026-10-25
- El arrastre comienza únicamente en el control dedicado de cada tarjeta; los botones, casillas y selectores internos no inician una operación de arrastre.
- Se puede insertar una tarjeta antes/después de otra o al final de una etapa del mismo tablero, y cambiar el orden dentro de su propia etapa. Las etapas activas se resaltan, la posición propuesta queda señalada con texto y estilos, y las etapas inválidas se rechazan.
- El arrastre mueve siempre una sola tarjeta. Si el usuario tiene varias seleccionadas, el estado en vivo aclara que el arrastre no incluye a las demás; los controles explícitos de selección múltiple siguen disponibles.
- Se reutiliza `PSA.Trabajo.moverTarjeta(id,destinoId,posicion)` para validar el tablero y persistir lista/posición de forma transaccional. No hay actualización optimista: se vuelve a renderizar solo después de la escritura confirmada; errores mantienen la vista original y permiten reintentar. No se modificó esquema ni persistencia.
- Se añadieron controles **Subir/Bajar en la etapa** como alternativa de teclado para reordenar; los botones existentes siguen moviendo entre etapas.
- Prueba de navegador aislada con SQLite y archivo sintéticos: `probarArrastreTarjetas()` aprobó **25 comprobaciones**; reabrir el binario sintético conservó ubicaciones, posiciones y orden. Los eventos DragEvent se dispararon en Chromium; no se simularon interacciones físicas ni soporte táctil.
- Regresión de interfaz de fase 3: **42 comprobaciones** de tablero y **26 de movimiento** aprobadas. Diseño responsive: **15 comprobaciones** (cinco por ancho a 390, 768 y 1280 px).
- La automatización de puntero disponible generó inicio/final de arrastre pero no eventos de entrada/soltado; no se cuenta como prueba de arrastre físico. Se verificó el flujo de eventos DnD de forma automatizada en Chromium y queda recomendada la aceptación manual con ratón en el navegador de destino.
- Node: `node --test --test-reporter=spec tests\db.test.cjs`: **31 aprobadas, 0 fallidas**. Sintaxis JS y `git diff --check` sin errores.
- La base habitual mantuvo SHA-256 `FBF10EBEDBCAC4203A8190DB97F8EEF2F8E733AD3326C91F662AC9E4A4974020`, idéntico al valor inicial; las pruebas usaron únicamente bases sintéticas.
- Se actualizaron README, convenciones de AGENTS y la documentación de arquitectura, evolución y contrato/límites de persistencia. Sin paquetes, escritura a la base habitual, commits ni operaciones remotas.

### Corrección del movimiento de tarjetas — 2026-10-25
- Causa: la API persistente existente `moverTarjeta(id,destino,posicion)` ya era individual, pero la UI no la exponía. Los controles **Anterior / Siguiente** de las columnas reordenaban la lista completa; como todas las tarjetas pertenecen a esa lista, se desplazaban visualmente juntas sin cambiar sus asociaciones. Se distinguió ahora el orden de columna del traslado de tarjeta.
- Cada tarjeta ofrece etapa anterior/siguiente y destino específico; cada operación recibe únicamente el ID elegido. Los límites muestran un error claro y no cambian datos.
- Casillas por tarjeta y **Seleccionar todas en esta etapa** agregan selección múltiple con indicador de cantidad, botones para movimiento relativo individualizado o destino común, y **Cancelar selección**. El foco y la indicación escrita hacen la selección evidente además del color.
- Nueva API `PSA.Trabajo.moverTarjetas([{id,destinoId},...])`: rechaza lotes vacíos/duplicados, tarjetas archivadas, listas inactivas o combinaciones de tableros; valida todo antes de escribir; actualiza lista, completitud, actividad y posiciones contiguas en una transacción. El orden de entrada determina el relativo de las movidas; la interfaz envía los IDs en orden visual. Las restantes conservan orden y etapa.
- Errores de persistencia no publican movimientos parciales ni limpian la selección; al reintentar se persiste el lote completo. Al completar el movimiento, se actualiza el tablero y se deseleccionan los elementos.
- Pruebas Node: **31 aprobadas, 0 fallidas** (4 nuevas: movimiento individual/reapertura, lote y orden, validación de límites/tablero/vacío, fallo atómico/reintento).
- Navegador con SQLite/binario e IndexedDB simulados: **26 comprobaciones de movimiento aprobadas** y una comprobación de reapertura tras recargar, incluyendo las etapas límite, selección/deselección individual, selección por etapa, movimiento relativo en ambas direcciones, destino específico, posiciones y orden de seleccionadas/no seleccionadas, fallo sin cambios parciales y reintento.
- Diseño de los nuevos controles comprobado a 390, 768 y 1280 px: sin desborde horizontal de página/tarjeta y con desplazamiento horizontal limitado al Kanban.
- Se preservó `moverTarjeta` y su contrato, se agregó el método por lote sin tocar esquema, migraciones ni `db.js`. Sin dependencias, commits, operaciones remotas ni escrituras de prueba a la base habitual.
- Actualizados README, instrucciones de agentes, arquitectura, API/límites de persistencia y estado de la evolución visual.

### Tableros, listas y tarjetas (fase 3)
- Nuevo `js/tableros.js`: catálogo filtrado por proyecto real, creación/consulta/edición de tableros, apertura del detalle, archivo y restauración.
- Kanban básico con listas en columnas, nombres personalizados y categoría funcional independiente. Creación/renombre, archivo/restauración y orden persistente con **Anterior / Siguiente**. Las cinco listas iniciales se crean mediante la API ya existente, sin duplicar esa lógica.
- Tarjetas con título, descripción, responsable del catálogo existente, prioridad, inicio/vencimiento, observaciones y marca explícita de completada. Consulta y edición desde su título; archivo/restauración con protección de contenedores.
- `index.html`: pestaña Tableros, catálogo/detalle y un único `<dialog>` para las tres entidades. Reutiliza campos, botones, utilidades de escape y notificaciones; no hay componentes o persistencias paralelas.
- `js/app.js`: integración en `renderTodo`, selección ARIA de pestañas, ocupación global, convivencia con Esc histórico y reinicio de selección solo tras cambiar de base con éxito.
- `js/proyectos.js`: botón Tableros por proyecto; eventos DOM para acciones de fila sin interpolar identificadores en JavaScript. El CRUD, filtros, dashboard y exportaciones históricos se conservan.
- `css/styles.css`: catálogo adaptable, desplazamiento horizontal limitado a columnas, prioridad/vencimiento/completitud, diálogo móvil, texto largo sin desbordes, controles de selección e impresión.
- Reutilizadas exclusivamente `PSA.DB.getProyectos` y `PSA.Trabajo.getTableros/getListas/getTarjetas/getResponsables`, `guardarTablero/guardarLista/guardarTarjeta`, `reordenarListas` y `archivar`. Sus transacciones ya registran actividad y confirman escritura antes de publicar.
- Errores de guardado visibles y registrados; el diálogo conserva los valores para reintentar. No se notifica éxito ni se cierra antes de confirmar el archivo. Archivo confirmado explícitamente, consulta de archivados en solo lectura, protección de categoría con tarjetas y de la relación tablero/proyecto.
- Foco contenido por el diálogo nativo, Esc/Cancelar con confirmación de descarte, retorno de foco tras cerrar o renderizar; bloqueo durante operaciones.
- Sin cambios de fase 3 en `js/db.js`, `js/trabajo.js` ni `js/migraciones.js`: el esquema y las APIs de fase 2 resultaron suficientes. No se repiten migraciones.

### Verificación de fase 3
- `node --test --test-reporter=spec tests\db.test.cjs`: **27 pruebas aprobadas, 0 fallidas**. Se suman tres regresiones de edición/reapertura, validación sin escrituras y error de cierre/reintento de entidades, además de las 24 existentes.
- `tests/tableros.browser.js`: **42 comprobaciones DOM aprobadas**, con SQLite real y archivos/IndexedDB sintéticos. Incluye proyecto → tablero, listas iniciales/libres, edición/orden, tarjeta con asociaciones y fechas, validación, escape HTML, cierre retrasado, error de disco/reintento, archivo/restauración, estados vacíos y funciones históricas.
- **6 comprobaciones de reapertura aprobadas** después de recargar realmente la página y reconectar el binario sintético: tablero, tarjeta, relaciones, orden, reconstrucción del Kanban y responsable histórico. No se utiliza memoria de entidades de la sesión anterior.
- **15 comprobaciones de diseño aprobadas**: cinco a cada ancho de 390, 768 y 1280 px. Nombres sin espacios de 200 caracteres, ausencia de desborde global, desplazamiento de columnas, diálogo/grilla adaptables y checkbox sin ancho mínimo heredado. Se detectó y corrigió un desborde del título largo antes de la verificación final.
- **4 comprobaciones de cambio de base aprobadas**: cancelación y base inválida conservan selección/detalle; cambio confirmado limpia la vista; volver a la original recupera sus entidades sin mezclarlas. Total del script en navegador: **67 comprobaciones aprobadas**.
- **3 comprobaciones adicionales de teclado aprobadas** con teclas del navegador: Shift+Tab contenido, cancelar el descarte con Esc y confirmar el descarte con retorno de foco. No se confunden eventos DOM de la suite con clics manuales del usuario.
- Sintaxis comprobada con `node --check` para los siete módulos y los scripts de pruebas; revisión con `git diff --check`.
- La base habitual conserva SHA256 `9C69B209410341D5432FDE811EC29F17C3404DF2B2F1A0A55C60B572146A1BBC`, idéntico al inicio de esta fase. No se inicializó ni escribió durante las pruebas.
- No se instalaron dependencias, no se crearon commits ni se realizaron operaciones remotas. Los permisos/selectores reales del sistema operativo siguen requiriendo validación manual.
- Actualizados `AGENTS.md`, `README.md`, `docs/arquitectura.md`, `docs/evolucion-visual.md`, `docs/migraciones.md` y este registro, con flujos, APIs, alcance e instrucciones de prueba.

### Límites y siguiente fase
- La fase 4 incorpora arrastre individual y reordenamiento; la selección múltiple conserva acciones explícitas y no se arrastra como conjunto. El soporte táctil sigue pendiente y se recomienda validar el gesto físico de ratón en el navegador de destino.
- No hay gestión de responsables ni etiquetas, Mis tareas, calendario, historial visual o dashboard de tareas. Seleccionar un responsable existente no crea identidades ni interpreta automáticamente textos históricos.
- El pedido específico de fase 3 mantiene el formulario histórico de proyectos: no expone todavía sus campos aditivos, archivo/asignación ni nuevos eventos de creación/edición. No se declara completa esa parte del plan inicial más amplio.
- Mantener una sola instancia escritora y respaldo periódico. No se agregó backend, sincronización ni sustitución por localStorage.

### Migraciones y persistencia relacional (fase 2)
- Modelo y procedimiento de respaldo/migración aprobados por el usuario después del análisis.
- Nuevo `js/migraciones.js`: esquema SQLite 1, migración aditiva 0 → 1, comprobación de versión, integridad, columnas, índices, FK y conservación de todos los valores históricos.
- Nuevas tablas de responsables, tableros, listas, tarjetas, etiquetas, asociaciones y actividad. Campos aditivos en proyectos sin reinterpretar los existentes.
- `js/db.js`: consentimiento explícito, respaldo binario exacto y verificado antes de escribir, detección de cambios externos, rechazo de versiones futuras y conservación de conexión previa ante cancelación o error.
- `PSA.DB.transaccion()` habilita mutaciones compuestas sobre candidata, con rollback, FK y escritura confirmada. Las FK se vuelven a habilitar después de exportar, porque sql.js reinicia pragmas al reabrir su conexión.
- Nuevo `js/trabajo.js`: APIs para entidades, asignación explícita de responsables, etiquetas, archivo/restauración, orden de listas y movimiento de tarjetas. Los eventos se escriben con su mutación, actor Instalación local y fecha real.
- `index.html` y `js/app.js`: confirmación de actualización, cancelación, foco, contención de teclado y fondo inerte durante el diálogo. No se agregan menús vacíos.
- La eliminación de un proyecto con tableros o actividad se rechaza con indicación de archivar, sin cascadas destructivas.
- `docs/migraciones.md`: procedimiento de respaldo/recuperación, modelo, APIs y límites. Actualizados README, AGENTS, arquitectura y estado de evolución.

### Alcance pendiente al cerrar la fase 2
- Las fases 3 a 8 aún no están implementadas como experiencia de usuario: formularios ampliados, tableros, tarjetas, Kanban, Mis tareas, calendario, búsqueda de tareas, vista de actividad y dashboard de tareas.
- El formulario histórico de proyectos conserva su comportamiento; la integración de sus eventos de creación/edición y los nuevos campos corresponde a la fase 3.
- No se modificó ni migró la base habitual, no se instalaron dependencias, no se crearon commits ni se sincronizaron remotos.

### Verificación de fase 2
- Resultado final: 24 pruebas aprobadas, 0 fallidas; comprobación de sintaxis de los seis módulos JavaScript.
- Regresión ampliada con SQL real y archivos simulados: legado conservado, respaldo exacto, fallos de respaldo/cierre, cancelación, rollback, versión futura, cambios externos, FK, entidades, asignaciones, etiquetas, orden, archivo y actividad.
- Flujo de navegador con base sintética: solicitud de consentimiento, diálogo, fondo inerte, cancelación sin escrituras, respaldo verificado, migración confirmada y renderizado de proyectos históricos.
- Los selectores y permisos del sistema operativo no se automatizan: requieren aprobación manual. No se usó la base habitual para comprobar escritura.

### Análisis de evolución visual (fase 1)
- Lectura de documentación, HTML, módulos, estilos, pruebas y configuración, con inspección de esquema en memoria sin modificar la base original.
- Confirmado `PRAGMA user_version=0`, tabla única `proyectos` y ausencia de entidades de gestión visual.
- Añadido `docs/evolucion-visual.md` con matriz de brechas de ocho columnas, modelo relacional aditivo propuesto, decisiones de compatibilidad, procedimiento de migración/respaldo y plan por fases.
- Enlaces y estado de la propuesta actualizados en `AGENTS.md`, `README.md` y `docs/arquitectura.md`.
- Línea base ejecutada: 10 pruebas aprobadas y sintaxis correcta en los cuatro módulos JavaScript.
- Al concluir el análisis no se habían modificado funcionalidades ni datos. Después de la aprobación se implementó la fase 2 descrita arriba.

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

### Bloque B3 — Restauración segura

- Se incorporó `PSA.DB.prepararRestauracion(handle)` para validar el respaldo y conservar en memoria los bytes validados sin modificar el origen.
- Se incorporó `PSA.DB.restaurarBackup()` para escribir la restauración exclusivamente como archivo nuevo en una carpeta elegida por el usuario. El destino se relee, compara byte a byte y valida integralmente.
- Se incorporó `PSA.DB.cancelarRestauracion()` y el evento `psa:restore-state`.
- La conexión activa, el handle, los formularios y el respaldo original permanecen sin cambios. No se ejecutan migraciones ni se reemplaza automáticamente la base activa.
- Se agregaron cuatro pruebas Node B3 para éxito, archivo inválido, cancelación y error de escritura.
- Pendiente B4: interfaz de Administración de datos e historial independiente. Pendientes manuales B3: permisos, selector y escritura reales de File System Access API.


### Bloque B4 — Administración de datos e historial

- Se agregó la pestaña **Administración de datos** con acciones para crear y validar copias, preparar y ejecutar restauraciones, y consultar el historial.
- Se agregó historial de hasta 100 operaciones en una base IndexedDB independiente, sin contenido de proyectos.
- Se integraron estados accesibles, confirmación explícita y controles que evitan acciones simultáneas.
- La visualización de registros utiliza `textContent`; no se incorporaron handlers ni estilos inline y se conserva la CSP.
- Pendiente validación manual de los selectores y permisos reales en Chromium/Edge.


## Corrección de selección de respaldos

- Los selectores de creación, validación y restauración comparten el ID `vertex_backup` para reutilizar la última carpeta elegida en Chromium/Edge.
- Se agregaron mensajes que orientan al usuario a buscar `VERTEX_backup_*.db` en la carpeta donde creó el respaldo.


## Corrección de selector de restauración e historial

- Se eliminó el filtro por extensión del selector de respaldos para evitar que el navegador o el sistema oculten archivos SQLite por asociaciones MIME/extensión; la validación del contenido sigue siendo obligatoria mediante B2.
- Se separó la cancelación del diálogo de selección de los errores ocurridos después de seleccionar un archivo. La interfaz ahora identifica el archivo elegido y muestra errores de lectura/validación sin clasificarlos como cancelación del usuario.
- El botón **Actualizar historial** ahora informa el estado de consulta, deshabilita temporalmente el botón, muestra la cantidad de registros y la hora de actualización, y presenta los errores de consulta de forma visible.


### Selección de respaldos para validación y restauración

La interfaz utiliza el selector HTML nativo (`input[type=file]`) para recibir un objeto `File` y leerlo mediante `arrayBuffer()`. La validación SQLite se realiza por contenido, no por extensión. Este flujo evita depender de que `showOpenFilePicker()` entregue un `FileSystemFileHandle` en todos los entornos Chromium. La restauración sigue requiriendo `showDirectoryPicker()` para crear un archivo nuevo; no se otorgan ni simulan permisos persistentes de escritura sobre el archivo de origen.


## Rediseño compacto de tarjetas Kanban

- Se redujo el espacio permanente de cada tarjeta: título, prioridad, responsables y vencimiento permanecen visibles.
- La fecha de inicio, etiquetas y estados secundarios pasan a «Más información».
- Las acciones secundarias se agrupan en un menú contextual accesible con teclado, clic y toque; se cierra al hacer clic fuera o pulsar Escape.
- El selector de etapa específica aparece únicamente cuando se solicita desde el menú.
- Se conserva el control dedicado de arrastre y la selección individual/múltiple.
- Se agregaron comprobaciones browser para estructura compacta, acciones agrupadas, selector bajo demanda y cierre del menú.


## Rediseño compacto de etapas Kanban

- Se compactó la cabecera de cada etapa para mantener visibles el nombre, la cantidad de tarjetas visibles y la categoría.
- Las acciones de edición, ordenamiento, selección de todas las tarjetas visibles y archivado/reactivación se agruparon en un menú `⋮`.
- El botón `+ Crear tarjeta` permanece disponible al pie de cada columna; los estados vacíos utilizan el mensaje breve «Sin tarjetas».
- El menú admite cierre con Escape y clic externo, y devuelve el foco al control de apertura al cerrarse con Escape.
- El panel se despliega dentro del flujo de la cabecera para evitar recortes por el área horizontal desplazable del Kanban.
- Se añadieron comprobaciones browser para el menú, su cierre, las acciones agrupadas y la permanencia del botón de creación.


## Corrección visual de cabeceras Kanban

- Los nombres de las etapas utilizan texto blanco para mantener el contraste sobre sus cabeceras oscuras.
- El contador muestra únicamente la cantidad de tarjetas visibles, con singular y plural correctos, sin repetir el nombre o la categoría de la etapa.
- Se agregaron regresiones browser para contraste, contador en cero y contador singular tras crear una tarjeta.


## Personalización visual — tema claro/oscuro

- Se retiró la etiqueta PSA · AVSEC de la cabecera activa.
- Se incorporó un control accesible para alternar modo claro y oscuro.
- La preferencia se persiste en `localStorage` (`vertex-theme`), sin modificar SQLite.
- Se añadieron variables y reglas CSS para superficies, textos, controles, tablas, Kanban, calendario, diálogos y administración de datos.
- El tema predeterminado es claro cuando no existe una preferencia guardada.
