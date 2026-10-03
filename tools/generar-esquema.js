/* ============================================================
   BASURA Y MÁS · Generar el espejo del esquema
   Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
   ------------------------------------------------------------
   supabase-schema.sql es un ESPEJO: se genera a partir de los
   archivos de migrations/ para que nunca se quede desincronizado de
   la base de datos real.

   Uso:
       node tools/generar-esquema.js

   Se ejecuta después de añadir o modificar cualquier migración.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DIR = path.join(RAIZ, 'migrations');
const SALIDA = path.join(RAIZ, 'supabase-schema.sql');

const archivos = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

if (!archivos.length) {
  console.error('No hay migraciones en migrations/.');
  process.exit(1);
}

const cabecera = `-- ============================================================
-- BASURA Y MÁS · Esquema de base de datos (Supabase / PostgreSQL)
-- Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
-- ------------------------------------------------------------
-- ESTE ARCHIVO SE GENERA. No lo edites a mano: para cambiar la base
-- de datos se escribe un archivo nuevo en migrations/ y se regenera
-- con:
--
--     node tools/generar-esquema.js
--
-- Cada migración trae en su cabecera qué problema resuelve, por qué
-- se eligió esa solución y qué se rompe al revertirla. Los ROLLBACK
-- están en migrations/rollback/ con el nombre del original + .down.sql.
--
-- ORDEN DE APLICACIÓN
${archivos.map(f => '--   ' + f).join('\n')}
--
-- Idea de seguridad (resumen)
--   · Todo lo que se escribe sin sesión tiene un tope por cuenta, por
--     huella de navegador y por IP (public.registrar_uso).
--   · "Me importa" solo cambia dentro de public.dar_like(), que suma
--     +1 exacto y recuerda a quien ya le pulso alguna vez.
--   · Los comentarios viven en su propia tabla y se escriben solo por
--     public.crear_comentario(), con límites por publicación y persona.
--   · El nombre público nunca es el correo: por defecto es "Vecino".
--   · La ubicación de un reporte se redondea a ~100 m ANTES de
--     guardarse: lo que no se guarda no se puede filtrar.
--   · El estado de un reporte solo lo cambia la moderación, y cada
--     reporte nace siempre en "recibido".
--   · Lo oculto solo lo ven su autor y las cuentas administradoras.
--   · Cada quien puede borrar su propia publicación y su reporte.
-- ============================================================

`;

let salida = cabecera;
for (const archivo of archivos) {
  salida += '\n' + '-- ' + '='.repeat(64) + '\n';
  salida += '-- ' + archivo + '\n';
  salida += '-- ' + '='.repeat(64) + '\n\n';
  salida += fs.readFileSync(path.join(DIR, archivo), 'utf8').replace(/\r\n/g, '\n');
}

fs.writeFileSync(SALIDA, salida, 'utf8');
console.log('supabase-schema.sql regenerado con ' + archivos.length + ' migraciones (' + salida.split('\n').length + ' lineas).');