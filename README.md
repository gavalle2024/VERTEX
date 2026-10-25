# Gestión de Proyectos PSA — URSA I del Este

Aplicación web para registrar, seguir y analizar proyectos de implementación de la **Policía de Seguridad Aeroportuaria**, sin backend ni instalación de paquetes.

**Evolución visual en curso:** están implementadas las fases 1 a 6: persistencia relacional, Kanban, responsables y etiquetas, prioridades, búsqueda y filtros, calendario e historial de actividad. Mis tareas y el historial visual ampliado siguen pendientes. El arrastre nativo se ofrece para puntero de escritorio; el soporte táctil no se implementó ni verificó. Ver [estado por fases](docs/evolucion-visual.md) y [migraciones y recuperación](docs/migraciones.md).

## Qué permite hacer

- Crear, consultar, editar y eliminar proyectos. La eliminación requiere confirmación.
- Registrar nombre, responsable, división, fechas de inicio/meta/finalización, avance, estado, nivel de implementación, cumplimiento, objetivo, resultado y observaciones.
- Validar nombre, responsable y fecha de inicio obligatorios, y limitar el avance entre 0 y 100 %.
- Clasificar proyectos como En curso, Completado, Demorado o Suspendido, con seis niveles de implementación y cinco categorías de cumplimiento.
- Buscar por nombre, responsable o división y combinar filtros de estado e implementación.
- Consultar un dashboard global con totales, avance promedio, cumplimiento en término sobre los evaluables, distribución de cumplimiento e implementación y alerta de suspendidos.
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

El motor y su WASM se descargan desde cdnjs; se necesita conexión para cargarlos. Si no están disponibles, se bloquea el uso y se informa el error. Los datos de proyectos no se envían a un servidor.

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
| [tests/tableros.browser.js](tests/tableros.browser.js) | Comprobaciones DOM con base sintética y verificación de reapertura |
| [docs/](docs/) | Arquitectura y cambios |

## Validación

Con Node.js 22 o superior e internet, sin instalar paquetes:

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
```

Las pruebas descargan la misma versión de sql.js usada por la app, ejecutan SQLite real y simulan los handles y permisos de archivos sin tocar la base del proyecto.

La suite Node actual cubre **37 pruebas**. Las pruebas de navegador `probarInterfazTableros()`, `probarMovimientoTarjetas()`, `probarArrastreTarjetas()`, `probarFase5Tableros()` y `probarFase6Seguimiento()` se ejecutan en una página aislada sin base real y usan bases sintéticas. El arrastre dispara eventos DragEvent; no simula interacción física de ratón ni táctil. Resultados y pasos en [arquitectura](docs/arquitectura.md) y [cambios](docs/cambios.md). No cargar el script de pruebas en una sesión con datos en uso.

## Documentación

- [Arquitectura](docs/arquitectura.md)
- [Registro de cambios](docs/cambios.md)
- [Instrucciones para agentes](AGENTS.md)
- [Evolución visual: matriz de brechas, diseño aprobado y fases](docs/evolucion-visual.md)
- [Persistencia relacional, respaldo, migraciones y recuperación](docs/migraciones.md)
