# Gestión de Proyectos PSA — URSA I del Este

Aplicación web para registrar, seguir y analizar proyectos de implementación de la **Policía de Seguridad Aeroportuaria**, sin backend ni instalación de paquetes.

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

Los estados y el cumplimiento se cargan manualmente; no se recalculan por vencimiento de fechas. Los filtros del listado no afectan al dashboard ni a la exportación completa de la base.

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

La app está diseñada para **una instancia escritora por base**. No implementa sincronización entre pestañas, procesos o usuarios. No editar simultáneamente el archivo desde otra herramienta. Mantener respaldos periódicos.

## Requisitos y límites

El motor y su WASM se descargan desde cdnjs; se necesita conexión para cargarlos. Si no están disponibles, se bloquea el uso y se informa el error. Los datos de proyectos no se envían a un servidor.

No incluye autenticación, roles, historial de cambios, importación Excel/CSV, sincronización multiusuario ni alertas automáticas por vencimiento.

## Estructura

| Archivo/carpeta | Responsabilidad |
|---|---|
| [index.html](index.html) | Estructura y controles |
| [css/styles.css](css/styles.css) | Estilos y adaptación a impresión |
| [js/db.js](js/db.js) | SQLite, archivos, permisos y conexión recordada |
| [js/proyectos.js](js/proyectos.js) | CRUD, filtros y exportaciones |
| [js/dashboard.js](js/dashboard.js) | Métricas globales |
| [js/app.js](js/app.js) | Inicialización, conexión y utilidades compartidas |
| [db/vertex.db](db/vertex.db) | Base inicial; puede elegirse otra carpeta |
| [tests/db.test.cjs](tests/db.test.cjs) | Regresión de persistencia |
| [docs/](docs/) | Arquitectura y cambios |

## Validación

Con Node.js 22 o superior e internet, sin instalar paquetes:

```powershell
node --test tests\db.test.cjs
node --check js\db.js
node --check js\app.js
node --check js\proyectos.js
```

Las pruebas descargan la misma versión de sql.js usada por la app, ejecutan SQLite real y simulan los handles y permisos de archivos sin tocar la base del proyecto.

## Documentación

- [Arquitectura](docs/arquitectura.md)
- [Registro de cambios](docs/cambios.md)
- [Instrucciones para agentes](AGENTS.md)
