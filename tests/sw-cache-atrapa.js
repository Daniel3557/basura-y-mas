/* BASURA Y MÁS · ¿la prueba del service worker atrapa de verdad el bug?
   ------------------------------------------------------------
   Una prueba que siempre pasa no sirve de nada. Esta corre
   tests/sw-cache.js contra una copia de sw.js a la que se le
   reintroduce el bug (app.js en caché-primero) y exige que la
   prueba FALLE. Si algún día alguien afloja el guard, esto lo delata.

     node tests/sw-cache-atrapa.js

   Trabaja sobre una copia temporal: nunca modifica sw.js de verdad.
   ============================================================ */
'use strict';

process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bym-sw-'));

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle){
  if (cond){ ok++; console.log('  ok   ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle ? ' -> ' + detalle : '')); }
}

function correr(sw){
  fs.writeFileSync(path.join(tmp, 'sw.js'), sw);
  try {
    const salida = execFileSync('node', [path.join(tmp, 'tests', 'sw-cache.js')],
      { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { codigo: 0, salida: salida };
  } catch (e){
    return { codigo: e.status === undefined ? -1 : e.status, salida: (e.stdout || '') + (e.stderr || '') };
  }
}

try {
  fs.mkdirSync(path.join(tmp, 'tests'));
  fs.copyFileSync(path.join(RAIZ, 'tests', 'sw-cache.js'), path.join(tmp, 'tests', 'sw-cache.js'));

  const original = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');

  console.log('\n1 · Con el arreglo puesto, la prueba pasa');
  const bien = correr(original);
  comprobar('la prueba sale con codigo 0', bien.codigo === 0, 'codigo: ' + bien.codigo + ' · ' + bien.salida.slice(0, 200));
  comprobar('y reporta cero fallos', /0 fallos/.test(bien.salida));
  comprobar('y no se queja de nada', bien.salida.indexOf('FALLA') === -1);

  console.log('\n2 · Con el bug de vuelta, la prueba tiene que fallar');
  const conBug = original.replace(
    "const esCodigo = /\\.(?:js|css)$/.test(url.pathname);",
    "const esCodigo = false;   // BUG reintroducido a proposito"
  );
  comprobar('se pudo reintroducir el bug (si no, la prueba ya no protege nada)',
    conBug !== original);

  const mal = correr(conBug);
  comprobar('la prueba sale con codigo distinto de 0', mal.codigo !== 0, 'codigo: ' + mal.codigo);
  comprobar('y señala especificamente app.js', /app\.js/.test(mal.salida),
    mal.salida.split(/\r?\n/).filter(l => /FALLA/.test(l)).join(' | '));

  console.log('\n3 · sw.js de verdad no se toco');
  comprobar('el archivo del repo sigue igual', fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8') === original);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + (fallos ? 'FALLOS: ' + fallos : 'Todo en orden: ') + ok + ' comprobaciones, ' + fallos + ' fallos.');
process.exit(fallos ? 1 : 0);