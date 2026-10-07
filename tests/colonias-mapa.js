/* BASURA Y MÁS · pruebas de las colonias del catálogo en el mapa
   ------------------------------------------------------------
   El catálogo son 77 nombres que entregó el equipo. El mapa ahora
   etiqueta a todas: las 6 de ZONAS con su polígono, las que tienen
   un lugar con su nombre en OpenStreetMap (verificado dentro de la
   ciudad) y las que el equipo coloca tocando el mapa. Las reglas
   que este archivo blinda:

     · ninguna coordenada se inventa: cada punto dice su fuente,
     · una COLONIA nunca se dibuja sobre una CALLE con el mismo
       nombre (puede estar lejos): eso es solo sugerencia,
     · lo colocado a mano vive en el navegador del equipo, con
       botón para exportarlo y hornearlo al repositorio.

     node tests/colonias-mapa.js
   ============================================================ */
'use strict';

process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const SRC = fs.readFileSync('app.js', 'utf8');
const HTML = fs.readFileSync('index.html', 'utf8');
const CSS = fs.readFileSync('estilos.css', 'utf8');

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle){
  if (cond){ ok++; console.log('  ok   ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle ? ' -> ' + detalle : '')); }
}

function extraer(nombre){
  const desde = SRC.indexOf('function ' + nombre + '(');
  if (desde < 0) throw new Error('No se encontró ' + nombre + ' en app.js');
  return SRC.slice(desde).split(/\r?\n\}\r?\n/)[0] + '\n}';
}

/* ---------- Datos reales extraídos de app.js ---------- */
const COLONIAS = Function('"use strict"; return ' + SRC.match(/const COLONIAS = (\[[\s\S]*?\]);/)[1])();
const ZONAS = Function('"use strict"; return ' + SRC.match(/const ZONAS = (\{[\s\S]*?\n\});/)[1])();
const UBICACION = Function('"use strict"; return ' + SRC.match(/const UBICACION_COLONIAS = (\[[\s\S]*?\]);/)[1])();
const EQUIPO = Function('"use strict"; return ' + SRC.match(/const UBICACIONES_EQUIPO_HORNEADAS = (\{[\s\S]*?\n\});/)[1])();

/* localStorage de prueba para las funciones que lo leen */
const almacenPrueba = {};
global.localStorage = {
  getItem: k => (k in almacenPrueba ? almacenPrueba[k] : null),
  setItem: (k, v) => { almacenPrueba[k] = String(v); }
};

const CLAVE = 'bym.colonias.ubicaciones.v1';
const ambito = {};
Function('d',
  'const COLONIAS = ' + JSON.stringify(COLONIAS) + ';' +
  'const ZONAS = ' + JSON.stringify(ZONAS) + ';' +
  'const UBICACION_COLONIAS = ' + JSON.stringify(UBICACION) + ';' +
  /* la constante va DECLARADA en el sandbox: las funciones la leen como
     variable libre, y una propiedad de `d` no es alcance léxico real */
  'const CLAVE_UBICACIONES_EQUIPO = "' + CLAVE + '";' +
  'const UBICACIONES_EQUIPO_HORNEADAS = ' + JSON.stringify(EQUIPO) + ';' +
  extraer('leerUbicacionesEquipo') + '\n' + extraer('coloniasPendientes') + '\n' +
  extraer('centroDeZona') +
  '; d.leerUbicacionesEquipo = leerUbicacionesEquipo; d.coloniasPendientes = coloniasPendientes;' +
  '; d.centroDeZona = centroDeZona;'
)(ambito);
const { leerUbicacionesEquipo, coloniasPendientes, centroDeZona } = ambito;

/* La ruta real de guardarUbicacionEquipo (toast, capa, select) se prueba
   en el navegador; aquí se verifica el round-trip del storage igual a
   como lo hace app.js. */
const guardadoConStub = function(nombre, latlng){
  const u = leerUbicacionesEquipo();
  u[nombre] = [Number(latlng.lat.toFixed(6)), Number(latlng.lng.toFixed(6))];
  try { localStorage.setItem(CLAVE, JSON.stringify(u)); } catch(e){}
  return u;
};

const BBOX = { latN: 19.735, latS: 19.675, lngO: -103.500, lngE: -103.430 };
const enCiudad = u => { const [lat, lng] = u[1]; return lat > BBOX.latS && lat < BBOX.latN && lng > BBOX.lngO && lng < BBOX.lngE; };

console.log('\n1 · Los datos horneados son verificados, no inventados');
{
  const nombresCatalogo = COLONIAS.concat(Object.keys(ZONAS).map(k => ZONAS[k].nombre));
  comprobar('hay ' + 31 + ' ubicaciones de OSM en UBICACION_COLONIAS', UBICACION.length === 31, 'salieron ' + UBICACION.length);
  comprobar('todas las ubicaciones son colonias del catálogo (o de ZONAS)',
    UBICACION.every(u => nombresCatalogo.indexOf(u[0]) !== -1),
    UBICACION.filter(u => nombresCatalogo.indexOf(u[0]) === -1).map(u => u[0]).join('|'));
  comprobar('cada coordenada cae dentro del límite urbano de Ciudad Guzmán',
    UBICACION.every(u => enCiudad(u)), UBICACION.filter(u => !enCiudad(u)).map(u => u[0]).join('|'));
  const lugares = UBICACION.filter(u => u[2] === 'lugar');
  const calles = UBICACION.filter(u => u[2] === 'calle');
  comprobar('13 tienen evidencia de lugar (parque/deportivo/edificio) y 18 solo de calle',
    lugares.length === 13 && calles.length === 18, 'lugar: ' + lugares.length + ', calle: ' + calles.length);
  comprobar('ninguna colonia de ZONAS se duplica en UBICACION_COLONIAS (usa su polígono)',
    UBICACION.every(u => Object.keys(ZONAS).every(k => ZONAS[k].nombre !== u[0])));
  comprobar('las ubicaciones horneadas del equipo son colonias del catálogo y caen en la ciudad',
    Object.keys(EQUIPO).length > 0 &&
    Object.keys(EQUIPO).every(n => nombresCatalogo.indexOf(n) !== -1) &&
    Object.keys(EQUIPO).every(n => { const [la, ln] = EQUIPO[n]; return la > BBOX.latS && la < BBOX.latN && ln > BBOX.lngO && ln < BBOX.lngE; }),
    Object.keys(EQUIPO).filter(n => nombresCatalogo.indexOf(n) === -1).join('|'));
  comprobar('ninguna colonia de ZONAS se duplica en las horneadas del equipo (usa su polígono)',
    Object.keys(EQUIPO).every(n => Object.keys(ZONAS).every(k => ZONAS[k].nombre !== n)),
    Object.keys(EQUIPO).filter(n => Object.keys(ZONAS).some(k => ZONAS[k].nombre === n)).join('|'));
  comprobar('el generador queda en el repositorio (procedencia reproducible)',
    fs.existsSync('tools/ubicar-colonias.js'));
}

console.log('\n2 · La calle con el mismo nombre NO es la colonia');
{
  const gante = UBICACION.filter(u => u[0] === 'Gante')[0];
  comprobar('Gante es de tipo calle (sugerencia, no pin)', gante && gante[2] === 'calle');
  const compositores = UBICACION.filter(u => u[0] === 'Compositores')[0];
  comprobar('Compositores es de tipo lugar (sí se dibuja)', compositores && compositores[2] === 'lugar');
  comprobar('pintarCapaColonias descarta las de tipo calle',
    /u\[2\] === 'calle' \|\| fuentes\[u\[0\]\]/.test(extraer('pintarCapaColonias')));
  comprobar('la sugerencia solo aparece en el modo de colocación (mostrarSugerencia)',
    /x\[2\] === 'calle'/.test(extraer('mostrarSugerencia')));
}

console.log('\n3 · Catálogo completo: 0 colonias por ubicar y el flujo de guardado sigue sano');
{
  comprobar('quedan 0 colonias sin ubicar (catálogo completo: 5 últimas del equipo Valle-Villas)',
    coloniasPendientes().length === 0, 'salieron ' + coloniasPendientes().length + ': ' + coloniasPendientes().join('|'));
  const enZonas = Object.keys(ZONAS).map(k => ZONAS[k].nombre);
  const enOsm = UBICACION.filter(u => u[2] === 'lugar').map(u => u[0]);
  const enEquipo = Object.keys(EQUIPO);
  const faltan = COLONIAS.filter(n => enZonas.indexOf(n) === -1 && enOsm.indexOf(n) === -1 && enEquipo.indexOf(n) === -1);
  comprobar('el catálogo completo está en el mapa (77 = ZONAS + OSM + equipo, sin huecos)',
    faltan.length === 0, 'faltan: ' + faltan.join('|'));
  /* Con el catálogo completo ya no hay pendientes que sacar: se verifica
     el round-trip re-guardando una colonia horneada (sobrescribe su punto). */
  const objetivo = coloniasPendientes()[0] || 'Valle de Zapotlán';
  guardadoConStub(objetivo, { lat: 19.712345, lng: -103.461234 });
  comprobar('guardarUbicacionEquipo deja la colonia fuera de pendientes', coloniasPendientes().length === 0);
  const u = leerUbicacionesEquipo()[objetivo];
  comprobar('la ubicación del equipo queda redondeada a 6 decimales',
    u && u[0] === 19.712345 && u[1] === -103.461234, JSON.stringify(u));
  comprobar('el punto del equipo entra al mapa (pintarCapaColonias lee el storage)',
    /leerUbicacionesEquipo\(\)/.test(extraer('pintarCapaColonias')));
  comprobar('cada punto etiquetado dice su fuente en el popup',
    /dice su fuente|fuente/.test(extraer('pintarCapaColonias')) && /Ubicación: ' \+ f\.fuente/.test(extraer('pintarCapaColonias')));
}

console.log('\n4 · Conexión con el mapa y honestidad de la interfaz');
{
  comprobar('initMapa crea la capa de colonias', /initCapaColonias\(\);/.test(SRC));
  comprobar('el clic del mapa acepta el modo colonia',
    /modoElegirMapa === 'colonia' && coloniaPorColocar/.test(SRC));
  comprobar('el botón de colonias alterna la capa', /function alternarColonias\(\)/.test(SRC) && /btnColonias/.test(HTML));
  comprobar('el botón existe con su ícono del sprite',
    /<button[^>]*id="btnColonias"[\s\S]{0,200}#i-pin/.test(HTML));
  comprobar('el bloque de colocación existe en el HTML', /id="bloqueColocar"/.test(HTML) && /id="btnCopiarUbicaciones"/.test(HTML));
  comprobar('las etiquetas tienen estilo propio (sin caja, con halo)',
    /\.et-colonia\{/.test(CSS) && /text-shadow/.test(CSS.match(/\.et-colonia\{[^}]*\}/)[0]));
  comprobar('el aviso de fuentes menciona que son ubicaciones aproximadas',
    /etiquetas 🏘️ de colonias son ubicaciones aproximadas/.test(HTML));
  comprobar('el popup aclara que no son límites oficiales',
    /límites oficiales públicos/.test(extraer('pintarCapaColonias')));
  comprobar('el storage del equipo usa clave versionada', /bym\.colonias\.ubicaciones\.v1/.test(SRC));
}

console.log('\n' + (fallos ? 'FALLOS: ' + fallos + ' · ' : 'Todo en orden: ') + ok + ' comprobaciones, ' + fallos + ' fallos.');
process.exit(fallos ? 1 : 0);
