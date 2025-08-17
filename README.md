# Sorteo Lima 12 — 1..50 (sin backend)
Hola Bienvenidos Grupo Scout Lima 12 
Aniversario 85
App web de una sola pantalla para reservar un número del 1 al 50. Sin APIs propias ni bases de datos SQL: usa Google Forms para recibir envíos y un Google Sheet publicado (CSV) para mostrar qué números ya están tomados.

## Flujo
1. La página descarga un CSV público desde Google Sheets con la lista de reservas (solo lectura) y bloquea los números ocupados.
2. Al enviar el formulario, realiza un POST al endpoint `formResponse` de Google Forms (sin CORS, usando `mode: no-cors`).
3. Google Forms escribe la fila en el Sheet. La próxima recarga mostrará ese número como tomado.

## Requisitos
- Cuenta Google para crear Form y Sheet.
- No necesitas servidores ni APIs propias. Se despliega como sitio estático (Azure Static Web Apps o Azure Storage Static Website).

## Configuración (10 minutos)

1) Crear Google Form
- Campos:
  - Nombre (corto, obligatorio)
  - Número (corto, obligatorio)
- En el Form, abre Vista previa y con DevTools inspecciona los `name` de inputs. Busca `entry.xxxxx` de cada campo.
  - Alternativa: envía una respuesta de prueba y revisa el `formResponse` en el Network panel para ver los `entry.xxxxx`.
- Copia el formulario "Enlace para enviar" (pero usaremos `/formResponse`). La URL final tendrá esta forma:
  - `https://docs.google.com/forms/d/e/FORM_ID/formResponse`

2) Vincular Form a un Sheet
- En Google Forms: Respuestas → Crear hoja de cálculo. Se crea un Google Sheet con las columnas.

3) Publicar el Sheet como CSV
- Abre el Sheet → Archivo → Compartir → Publicar en la Web → Hoja específica → CSV.
- Copia el enlace generado. Suele verse como:
  - `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=0`

4) Pegar configuraciones en `main.js`
- Edita:
```
const CONFIG = {
  sheetCsvUrl: 'https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=0',
  formPostUrl: 'https://docs.google.com/forms/d/e/FORM_ID/formResponse',
  fields: {
    nombre: 'entry.123456',
    numero: 'entry.456789',
  }
};
```
- Asegúrate de que en el Sheet la columna del número se llame "numero" o similar; el script intenta detectar la columna correcta automáticamente.

5) Probar en local
- Abre `index.html` en el navegador (no requiere servidor). Selecciona un número libre y envía.
- Recarga: el número debería aparecer bloqueado al poco tiempo (depende de latencia/propagación).

## Seguridad mínima
- Sin cuentas de usuario. Los datos quedan en tu Sheet.
- Valida en cliente: nombre (requerido) y que el número esté en rango.
- Evita exponer datos sensibles; lo que se publica es solo la lista de números.
- Rate limiting básico: puedes activar reCAPTCHA en el Google Form si lo deseas.

## Azure: despliegue rápido

Opción A) Azure Static Web Apps (recomendada)
- Crea un repo con estos archivos.
- En Azure Portal: Create Static Web App → Source control (GitHub) → Framework: Custom → Build presets: No build → App location: `/`.
- O usa Azure SWA CLI si prefieres.

Opción B) Azure Storage Static Website
- Crea una cuenta de Storage → Static website → habilitar → sube `index.html`, `styles.css`, `main.js`.

## Personalización
- Cambia el rango a más de 50: ajusta `TOTAL_NUMBERS` en `main.js` y el grid en CSS si quieres más columnas.
- Cambia la marca/textos en `index.html` y colores en `styles.css`.

## Limitaciones y tips
- Con `mode: no-cors`, no obtendrás códigos de respuesta. Considera mostrar un mensaje de confirmación y refresh de disponibilidad.
- Para evitar choques en simultáneo, el grid se refresca desde el CSV. Dos usuarios que envían casi a la vez podrían intentar el mismo número; el primero en llegar quedará, el segundo verá el número como ocupado al refrescar. Para reducir esto:
  - Añade un checado de disponibilidad justo antes de enviar (volver a leer el CSV).
  - Haz un auto-refresh del CSV cada 10–15 s (puedes activarlo editando `init`).
- Si el CSV es grande, limita a columnas imprescindibles.

## Privacidad de los datos

Objetivo: que la web solo exponga qué números están ocupados, nunca los datos personales.

Recomendado (sin backend y sin APIs):
- Publica solo una hoja (tab) con la columna "Número", sin nombre.
- Mantén la hoja con datos personales privada (no publicada).

Opciones para lograrlo:
1) Hoja pública dentro del mismo Sheet
   - Crea una nueva hoja (por ejemplo, `publico`).
   - En `A1` coloca una fórmula que copie solo la columna de número de la hoja de respuestas. Ejemplo (ajusta el nombre de la hoja y columna):
     - `=UNIQUE(FILTER(Respuestas!D2:D, LEN(Respuestas!D2:D)))`
   - Publica a la web únicamente la hoja `publico` en formato CSV.
   - Usa esa URL CSV en `main.js` → `sheetCsvUrl`.

2) Segundo Spreadsheet solo con números
   - Crea otro Google Sheet vacío (este será el "público").
   - En `A1` usa `IMPORTRANGE` para traer solo la columna de números del Sheet privado. Ejemplo:
     - `=UNIQUE(FILTER(IMPORTRANGE("URL_DEL_SHEET_PRIVADO", "Respuestas!D2:D"), LEN(IMPORTRANGE("URL_DEL_SHEET_PRIVADO", "Respuestas!D2:D"))))`
   - Acepta la autorización de `IMPORTRANGE` (una vez).
   - Publica a la web ese segundo Sheet (solo la hoja con números) como CSV.
   - Configura `sheetCsvUrl` con esa URL CSV.

Notas:
- "Publicar en la web" hace accesible ese CSV a cualquiera con el enlace, por eso debe contener solo números. No se indexa normalmente, pero evita compartir el enlace.
- Google Forms no muestra respuestas públicamente por defecto. No compartas el resumen de respuestas ni el Sheet privado.

## Licencia
MIT
