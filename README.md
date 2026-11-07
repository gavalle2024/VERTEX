# Gestión de Proyectos PSA — URSA I del Este

Aplicación web para registrar, seguir y analizar proyectos de implementación de la **Policía de Seguridad Aeroportuaria**, sin backend ni instalación de paquetes.

**Evolución visual en curso:** están implementadas las fases 1 a 8: persistencia relacional, Kanban, responsables y etiquetas, prioridades, búsqueda y filtros, calendario, historial, panel de control y auditoría sintética de robustez. Mis tareas y el historial visual ampliado de proyectos siguen pendientes. El arrastre nativo se ofrece para puntero de escritorio; el soporte táctil no se implementó ni verificó. Ver [estado por fases](docs/evolucion-visual.md) y [migraciones y recuperación](docs/migraciones.md).

## Qué permite hacer

- Crear, consultar, editar y eliminar proyectos. La eliminación requiere confirmación.
- Registrar nombre, responsable, división, fechas de inicio/meta/finalización, avance, estado, nivel de implementación, cumplimiento, objetivo, resultado y observaciones.
- Validar nombre, responsable y fecha de inicio obligatorios, y limitar el avance entre 0 y 100 %.
- Clasificar proyectos como En curso, Completado, Demorado o Suspendido, con seis niveles de implementación y cinco categorías de cumplimiento.
- Buscar por nombre, responsable o división y combinar filtros de estado e implementación.
- Consultar el panel de control como pantalla principal: proyectos, tableros y tarjetas activas; tareas por etapa funcional/completitud; prioridades; vencimientos; progreso por tablero; actividad reciente; y accesos rápidos.
- Exportar los proyectos filtrados a CSV compatible con Excel o descargar una copia SQLite completa mediante **Exportar DB**.
- Imprimir con los estilos del navegador y cancelar ediciones con **Esc**.
- Seleccionar y recordar la carpeta de la base de datos desde la interfaz, y cambiarla posteriormente.
- Crear tableros vinculados a proyectos reales; consultar, editar, archivar y restaurar sus datos.
- Organizar listas personalizables como columnas; crearlas, renombrarlas, ordenar con **Ordenar lista antes/después**, archivar y restaurar.
- Administrar responsables locales (crear, buscar, renombrar, desactivar y reactivar) y asignar varios a una tarjeta; la desactivación conserva el historial.
- Administrar etiquetas personalizadas con color, búsqueda y activación/desactivación; asignar varias etiquetas a una tarjeta.
- Crear, consultar y editar tarjetas con descripción, prioridad (Crítica, Alta, Media o Baja), fechas, observaciones y marca de completada; archivar y restaurar.
- Buscar tarjetas por título o descripción y combinar filtros de responsable, etiqueta, prioridad, etapa y asignación. Limpiar filtros sin alterar datos ni orden.
- Consultar calendario mensual, semanal o de agenda; navegar por períodos y abrir la tarjeta desde sus fechas de inicio o vencimiento.
- Consultar actividad reciente, por tablero o por tarjeta, con paginación y títulos históricos de tarjeta.
- Mover una tarjeta a la etapa anterior/siguiente o a una etapa específica. Seleccionar varias tarjetas individualmente o todas las de una etapa, moverlas de forma atómica y cancelar la selección.
- Arrastrar una tarjeta desde su control dedicado para insertarla antes/después de otra o al final de una etapa, incluso dentro de su etapa actual. Los botones **Subir/Bajar en la etapa** ofrecen la alternativa por teclado; las acciones de selección múltiple siguen siendo explícitas y separadas.
- Consultar el Kanban con responsables, distintivos de etiquetas, indicadores de prioridad, vencimiento y completitud, estados vacíos y errores explícitos.

Los estados y el cumplimiento se cargan manualmente; no se recalculan por vencimiento de fechas. Los filtros del listado no afectan al dashboard ni a la exportación completa de la base.

## Panel de control

El panel se actualiza junto con el resto de las vistas después de cada escritura confirmada. Si la base no está conectada, muestra que la información no está disponible en lugar de presentar ceros. Los errores de lectura se informan sin sustituirlos por cifras predeterminadas.

- **Tableros activos:** tableros no archivados asociados a proyectos activos.
- **Tarjetas activas:** tarjetas no archivadas cuyo proyecto, tablero y lista también están activos.
- **Pendientes / En curso:** tarjetas no completadas en listas cuya categoría funcional es `pendiente` / `en_curso`. Las demás categorías se agrupan como otras etapas; no se clasifican por nombre de lista.
- **Completadas:** marca explícita `tarjetas.completada`; la categoría funcional Completado también activa esa marca al mover/crear una tarjeta según el comportamiento existente.
- **Prioridades:** cantidades por prioridad interna de tarjetas activas (incluye las completadas). La lista de críticas y altas muestra solo tarjetas abiertas y permite abrir su detalle.
- **Vencimientos:** tareas abiertas que vencen hoy, desde hoy hasta los próximos seis días inclusive, atrasadas antes de hoy, y tareas abiertas sin vencimiento. Las completadas no se cuentan como atrasadas; las fechas se comparan como `AAAA-MM-DD` local, sin conversión UTC. Se muestran hasta diez tareas pendientes con vencimiento; el resto se consulta en Calendario.
- **Progreso por tablero:** tarjetas activas en el denominador; porcentaje = `completadas / tarjetas activas × 100`, redondeado al entero más cercano. Las pendientes se cuentan por la categoría funcional `pendiente`; otras tareas abiertas aparecen en el total abierto. Un tablero vacío no presenta porcentaje.
- **Actividad reciente:** hasta seis eventos de la tabla existente `actividad`, con título snapshot, fecha y tablero cuando están disponibles. No crea ni duplica eventos.
- **Acciones rápidas:** crear proyecto, tablero y tarjeta usando las pestañas, catálogos y editor existentes; también abrir Calendario/Actividad y navegar a prioridades y vencimientos. Crear una tarjeta exige elegir tablero y etapa activa antes de abrir el formulario obligatorio.
- **Navegación:** pestañas accesibles con flechas, Inicio y Fin, identifican la sección activa y permiten regresar al panel. No hay «Mis tareas» porque esta instalación no autentica usuarios.

## Uso de tableros, listas y tarjetas

1. Crear o buscar un proyecto en **Proyectos** y presionar **Tableros** en su fila. También se puede entrar desde la pestaña **Tableros** y filtrar por proyecto.
2. Presionar **Crear tablero**, elegir un proyecto activo, completar nombre y descripción y guardar. Se crean las cinco listas iniciales de la API existente: Pendiente, En curso, En revisión, Bloqueado y Completado.
3. Abrir el tablero para ver su proyecto, descripción y columnas. **Editar tablero** modifica nombre y descripción, no su proyecto.
4. Usar **Crear lista** o **Editar lista**. El nombre es libre; la categoría funcional es independiente. Una lista con tarjetas puede renombrarse, pero su categoría queda protegida. **Ordenar lista antes/después** cambia solo la posición de la columna, no mueve las tarjetas a otra etapa.
5. Usar **Crear tarjeta** en la lista correspondiente. El título es obligatorio; descripción, prioridad, responsables, etiquetas, fechas y observaciones se editan en el diálogo de tarjeta. La prioridad predeterminada es Media; el vencimiento no puede ser anterior al inicio.
6. Para reordenar una tarjeta, arrastrar desde el control **Arrastrar** y soltar antes/después de una tarjeta o al final de una etapa activa del mismo tablero. La indicación visual muestra el destino/posición. El orden se guarda antes de actualizar la vista. Para usar teclado, accionar **Subir/Bajar en la etapa**; **Etapa anterior/siguiente** continúa cambiando de lista.
7. Para varias, marcar las casillas de las tarjetas o usar **Seleccionar todas en esta etapa**. La barra indica la cantidad y ofrece mover cada una a su etapa anterior/siguiente, trasladar todas al mismo destino, o **Cancelar selección**. Los movimientos por dirección son relativos a la etapa actual de cada tarjeta. La selección múltiple se aplica solo a las marcadas y conserva su orden visual relativo; las demás tarjetas y su orden se mantienen. Si hay varias seleccionadas, arrastrar una mueve solo esa tarjeta y lo indica; para mover el conjunto, usar las acciones de la barra. Si no existe un destino válido para alguna seleccionada, se cancela toda la operación.
8. Las listas de destino se limitan a etapas activas del mismo tablero. No se permite cruzar tableros. Después de un movimiento confirmado, la interfaz se actualiza y la selección se limpia.
9. Presionar el título de una tarjeta para consultar o editar su detalle en el mismo diálogo reutilizable. La marca **Completada** es explícita y no modifica el avance manual del proyecto. Las tarjetas que entran a la categoría Completado se marcan completadas; al salir se reabren.
10. Archivar requiere confirmación. Para restaurar, activar **Incluir archivados** en el catálogo o **Incluir listas y tarjetas archivadas** dentro del tablero. Restaurar primero los contenedores: archivar un padre no cambia las marcas propias de sus hijos.
11. En **Catálogos de responsables y etiquetas**, crear o buscar registros, editarlos y desactivarlos/reactivarlos. Los inactivos se consultan mediante **Incluir inactivos/inactivas**; no se ofrecen para asignaciones nuevas, pero permanecen visibles en tarjetas históricas.
12. Usar **Buscar tarjetas** para título/descripción y combinar los filtros de responsable, etiqueta, prioridad, etapa, asignación y vencimiento (con/sin fecha, vencidas, hoy, próximos siete días o intervalo). Próximos siete días incluye hoy y los seis días siguientes. Para intervalo, seleccionar **Intervalo** y completar desde/hasta; cualquiera de los límites puede quedar vacío. El contador y el estado del tablero indican coincidencias; **Limpiar filtros** restablece la vista. Las columnas y el orden se mantienen. Mientras haya filtros activos, se deshabilitan el arrastre y el reordenamiento dentro de la etapa para evitar posiciones ambiguas. Si una selección contiene tarjetas ocultas, la acción múltiple exige confirmar explícitamente si deben incluirse.
13. En **Calendario**, alternar mensual, semanal o agenda. Los eventos aparecen en su fecha de inicio y/o vencimiento; las tarjetas sin fechas no se muestran. **Período anterior/siguiente** navega y **Hoy** vuelve al período actual. Los vencimientos de hoy y los próximos seis días se consideran próximos; las fechas pasadas sin completar se marcan vencidas. Pulsar el título abre el diálogo de la tarjeta.
14. En **Actividad**, consultar los eventos recientes, limitar la vista a un tablero o abrir el historial desde una tarjeta. Se muestran hasta 100 eventos por página; **Cargar actividad anterior** permite continuar. Los eventos identifican la instalación local, no una persona autenticada.
15. Guardar confirma éxito solo después de escribir SQLite. Si falla, conservar los datos y permitir reintentar. **Cancelar / Esc** pide confirmación si hubo cambios y devuelve el foco; no cancela durante un guardado.

El responsable histórico del proyecto no se convierte automáticamente en una persona del catálogo. Las tarjetas pueden quedar **Sin responsable**. El formulario y los indicadores históricos de proyectos mantienen sus funciones anteriores.

Las fechas de inicio y vencimiento se guardan como fecha de calendario `AAAA-MM-DD`, sin conversión a hora UTC. Se aceptan campos vacíos; si están ambos, el inicio no puede superar el vencimiento. Mover una tarjeta no altera sus fechas.

El historial registra cambios de tarjeta que realmente se guardan: creación, título, descripción, prioridad, asignaciones, etapa, inicio, vencimiento, observaciones y completitud. Si una escritura falla no se confirma ningún evento. Las tarjetas se archivan y restauran, no se eliminan físicamente; la referencia y el historial se conservan.

## Inicio y configuración de carpeta

1. Abrir [index.html](index.html) en Chrome o Edge con File System Access API habilitada.
2. Presionar **Seleccionar carpeta**.
3. Elegir la carpeta que contiene `vertex.db`, por ejemplo [db/](db/), o cualquier otra carpeta autorizada.
4. Si el archivo no existe, confirmar la creación de una **base vacía**. No se copian automáticamente los proyectos de otra base.
5. La cabecera muestra el nombre de la carpeta y del archivo. Usar **Cambiar carpeta de base de datos** para elegir otra ubicación.

Cambiar de carpeta abre la base de destino: **no mueve, copia ni combina los datos** de la base anterior. Para trasladar datos, exportar una copia con **Exportar DB**, guardarla como `vertex.db` en la carpeta de destino y seleccionar esa carpeta. Conservar la copia original como respaldo.

Si hay un formulario modificado, se pide confirmar su descarte antes de cambiar de base. Cancelar el selector o fallar la conexión conserva la base y el formulario actuales.

### Permisos y reconexión

El acceso autorizado se recuerda en IndexedDB. Al volver a abrir la app, se intenta reconectar automáticamente; si hace falta permiso, se ofrece **Reconectar vertex.db** o **Seleccionar otra carpeta**.

- El navegador exige seleccionar la carpeta: escribir una ruta absoluta no otorga acceso.
- La API no expone la ruta absoluta completa; la interfaz muestra nombres, no una ruta verificable.
- Chrome/Edge deben permitir el acceso a archivos. Usar HTTPS, localhost o apertura local compatible. Firefox no está soportado para esta configuración.
- Si IndexedDB está bloqueado, se informa que la ubicación no podrá recordarse, pero se puede trabajar con la base conectada.
- Si el archivo se movió, eliminó o perdió permisos, volver a autorizarlo o elegir otra carpeta.
- Se reconocen también las conexiones a archivo guardadas por versiones anteriores. Hasta seleccionar una carpeta, solo se conoce el nombre del archivo.

## Persistencia y protección de datos

Los proyectos se guardan exclusivamente en un archivo **SQLite3 estándar**, usando **sql.js 1.10.2** en memoria y File System Access API para escribir al disco. No hay fallback ni migración automática desde `localStorage`.

- Guardar y eliminar confirman éxito únicamente después de finalizar la escritura al archivo.
- Mientras hay una operación en curso, se bloquean las acciones incompatibles y se advierte al intentar cerrar la ventana.
- Si falla la escritura, se mantienen los datos visibles anteriores y el formulario para reintentar; se muestra el error.
- Un archivo corrupto o con un esquema incompatible se rechaza sin reemplazarlo por una base vacía.
- **Exportar DB** descarga una copia completa; no modifica la ubicación conectada.
- Las bases del esquema anterior requieren **Crear respaldo y actualizar**. Antes de escribir se crea y verifica un respaldo exacto; cancelar no modifica el original. Una base nueva usa el esquema 3. Las migraciones 1 → 2 y 2 → 3 agregan asignaciones múltiples/estado de etiquetas y el título histórico de los eventos, respectivamente.
- Una versión de esquema futura se rechaza. La eliminación de proyectos con tableros o actividad relacionada se protege mediante un error explícito.

El respaldo se guarda en la carpeta autorizada con nombre único (`vertex.pre-v1.…db` o `vertex.pre-v2.…db`, según corresponda); las conexiones antiguas sin carpeta solicitan un destino de respaldo vacío. La guía de [migración y recuperación](docs/migraciones.md) explica el procedimiento y cómo volver a una copia anterior sin sobrescribir la base migrada.

La app está diseñada para **una instancia escritora por base**. No implementa sincronización entre pestañas, procesos o usuarios. No editar simultáneamente el archivo desde otra herramienta. Mantener respaldos periódicos.

## Requisitos y límites

En la aplicación de navegador, sql.js 1.10.2 y su WASM se cargan desde cdnjs; si no están disponibles, se bloquea el uso y se informa el error. Los datos de proyectos no se envían a un servidor. Las pruebas Node usan una copia local de la misma versión y no acceden a la red.

## Seguridad de la interfaz

`index.html` aplica una CSP por metadato: `default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src https://cdnjs.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'`. Los manejadores se registran desde JavaScript con `addEventListener` y `data-action`; no se permiten scripts ni atributos de estilo inline.

`wasm-unsafe-eval` se limita a habilitar la compilación WebAssembly que requiere sql.js 1.10.2. No habilita `eval`, `new Function` ni JavaScript evaluado desde texto. El CDN solo se permite para el script sql.js y la descarga de su WASM. Los estilos dinámicos de progreso usan `<progress>` y clases; los colores hexadecimales validados de etiquetas se incorporan como reglas CSSOM a la hoja local autorizada.

La CSP requiere un navegador que implemente `wasm-unsafe-eval`; el requisito histórico de File System Access API (Chrome/Edge 86+) por sí solo no garantiza esa directiva. La validación automatizada se realizó en Chromium compatible.

`frame-ancestors` no se puede aplicar desde una CSP `<meta>`. En un despliegue HTTP(S), se debe enviar también como encabezado de respuesta, por ejemplo `Content-Security-Policy: default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src https://cdnjs.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. El archivo histórico [gestion_proyectos_psa.html](gestion_proyectos_psa.html) es una referencia independiente, no se carga desde la SPA activa y no forma parte de esta política.

No incluye autenticación, roles, vista de historial de cambios, importación Excel/CSV, sincronización multiusuario ni alertas automáticas por vencimiento. La infraestructura relacional registra actividad de sus operaciones, pero su interfaz y la integración de eventos del formulario histórico de proyectos corresponden a fases posteriores.

## Estructura

| Archivo/carpeta | Responsabilidad |
|---|---|
| [index.html](index.html) | Estructura y controles |
| [css/styles.css](css/styles.css) | Estilos y adaptación a impresión |
| [js/db.js](js/db.js) | SQLite, archivos, permisos y conexión recordada |
| [js/migraciones.js](js/migraciones.js) | Esquema 2, migraciones secuenciales y validación |
| [js/trabajo.js](js/trabajo.js) | Infraestructura relacional de trabajo y actividad |
| [js/proyectos.js](js/proyectos.js) | CRUD, filtros y exportaciones |
| [js/tableros.js](js/tableros.js) | Catálogos locales, búsqueda/filtros, Kanban y diálogo único |
| [js/dashboard.js](js/dashboard.js) | Métricas globales |
| [js/app.js](js/app.js) | Inicialización, conexión y utilidades compartidas |
| [db/vertex.db](db/vertex.db) | Base inicial; puede elegirse otra carpeta |
| [tests/db.test.cjs](tests/db.test.cjs) | Regresión de persistencia |
| [tests/vendor/sql.js/1.10.2/](tests/vendor/sql.js/1.10.2/) | `sql-wasm.js`, WASM y licencia de sql.js 1.10.2 para Node |
| [tests/tableros.browser.js](tests/tableros.browser.js) | Comprobaciones DOM con base sintética y verificación de reapertura |
| [docs/](docs/) | Arquitectura y cambios |

## Validación

Con Node.js 22 o superior, sin instalar paquetes ni necesitar Internet para esta suite:

```powershell
node --test tests\db.test.cjs
node --check js\db.js
node --check js\app.js
node --check js\proyectos.js
node --check js\migraciones.js
node --check js\trabajo.js
node --check js\tableros.js
node --check js\calendario.js
node --check js\actividad.js
node --check js\dashboard.js
```

La copia de sql.js está incluida en `tests/vendor/sql.js/1.10.2/`. `tests/db.test.cjs` carga desde allí el JavaScript y WebAssembly, ejecuta SQLite real y simula archivos, handles, permisos e IndexedDB. Todas las bases de la suite son sintéticas; no se abre `db/vertex.db`. Para preparar el entorno basta conservar esos archivos al obtener el proyecto; no hay `npm install` ni descarga automática durante las pruebas. Si se renuevan los artefactos, usar el paquete oficial `sql.js` en la versión exacta declarada por la aplicación y actualizar conjuntamente la copia local y esta documentación.

Para comprobar que el test Node no referencia un CDN ni `fetch`, ejecutar `rg -n 'cdnjs|https?://|fetch' tests/db.test.cjs`; no debe devolver coincidencias. Esta comprobación aplica a Node: la aplicación web mantiene su carga de sql.js desde cdnjs y, por lo tanto, su ejecución y las pruebas browser que cargan la app conservan ese requisito de red.

La suite Node actual cubre **38 pruebas**. Las pruebas de navegador `probarInterfazTableros()`, `probarMovimientoTarjetas()`, `probarArrastreTarjetas()`, `probarFase5Tableros()`, `probarFase6Seguimiento()` y `probarFase7Dashboard()` se ejecutan en una página aislada sin base real y usan bases sintéticas; la fase 6 incluye una comprobación estructural de accesibilidad del calendario. La suite cubre accesos, conteos, vencimientos, progreso, errores y no-op sin alterar valores confirmados, timestamps ni historial; el arrastre dispara eventos DragEvent y no simula interacción física de ratón ni táctil. En Chromium se midió un render global de 411,9 ms de mediana con 1000 tarjetas y 4000 eventos; es una referencia, no un umbral. Resultados y pasos en [arquitectura](docs/arquitectura.md) y [cambios](docs/cambios.md). No cargar el script de pruebas en una sesión con datos en uso.

## Documentación

- [Arquitectura](docs/arquitectura.md)
- [Registro de cambios](docs/cambios.md)
- [Instrucciones para agentes](AGENTS.md)
- [Evolución visual: matriz de brechas, diseño aprobado y fases](docs/evolucion-visual.md)
- [Persistencia relacional, respaldo, migraciones y recuperación](docs/migraciones.md)
