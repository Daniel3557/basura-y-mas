/* BASURA Y MÁS · pruebas de la red urbana de puntos (toda la ciudad)
   ------------------------------------------------------------
   La red urbana reparte puntos cada 400 m sobre las calles reales de
   Ciudad Guzmán. Eso son cientos de puntos: si el reparto se equivoca,
   el mapa se llena de puntos encimados, las calles paralelas quedan
   vacías o las avenidas partidas en tramos salden con puntos de más.
   Aquí se prueba la cuenta con calles inventadas de longitud conocida,
   sin tocar Overpass ni el navegador.

     node tests/red-ciudad.js
   ============================================================ */
'use strict';

process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const SRC = fs.readFileSync('app.js', 'utf8');

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle){
  if (cond){ ok++; console.log('  ok   ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle ? ' -> ' + detalle : '')); }
}

/* ---------- Se extrae el código real de app.js ---------- */
function extraer(nombre){
  const desde = SRC.indexOf('function ' + nombre + '(');
  if (desde < 0) throw new Error('No se encontró ' + nombre + ' en app.js');
  return SRC.slice(desde).split(/\r?\n\}\r?\n/)[0] + '\n}';
}
const RED_SRC = SRC.match(/const RED_CIUDAD = \{[\s\S]*?\n\};/)[0];
const INTERVALO_SRC = SRC.match(/const INTERVALO_PUNTOS = \d+;[^\n]*/)[0];

const ambito = {};
Function('d',
  extraer('haversine') + '\n' + extraer('polilineaAPuntos') + '\n' + INTERVALO_SRC + '\n' + RED_SRC + '\n' +
  extraer('encadenarVias') + '\n' + extraer('puntosDesdeCadenas') + '\n' + extraer('puntosDesdeVias') +
  '\nd.haversine = haversine; d.RED_CIUDAD = RED_CIUDAD; d.encadenarVias = encadenarVias;' +
  '\nd.puntosDesdeCadenas = puntosDesdeCadenas; d.puntosDesdeVias = puntosDesdeVias;'
)(ambito);
const { haversine, RED_CIUDAD, encadenarVias, puntosDesdeCadenas, puntosDesdeVias } = ambito;

/* ---------- Calles sintéticas (geometría real de OSM: {lat, lon}) ---------- */
// Una calle recta hacia el este de ~`metros`, partida en 20 vértices.
function calleRecta(lat, lngInicio, metros, nombre){
  const gradosLng = metros / (111320 * Math.cos(lat * Math.PI / 180));
  const geometry = [];
  for (let i = 0; i <= 20; i++) geometry.push({ lat: lat, lon: lngInicio + gradosLng * (i / 20) });
  return { type: 'way', geometry: geometry, tags: nombre ? { name: nombre } : {} };
}
function viaNorte(latInicio, lng, metros, nombre){
  const gradosLat = metros / 110540;
  const geometry = [];
  for (let i = 0; i <= 20; i++) geometry.push({ lat: latInicio + gradosLat * (i / 20), lon: lng });
  return { type: 'way', geometry: geometry, tags: nombre ? { name: nombre } : {} };
}
// Los disparos caen en 200, 600, 1000… m (mitad del primer tramo + intervalos).
function esperados(metros){ const r = []; for (let d = 200; d <= metros; d += 400) r.push(d); return r.length; }

console.log('\n1 · Separación sobre una calle de 2 km');
{
  const via = calleRecta(19.70, -103.47, 2000, 'Calle Prueba');
  const puntos = puntosDesdeVias([via], { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 });
  comprobar('salen 5 puntos (200, 600, 1000, 1400, 1800 m)', puntos.length === 5, 'salieron ' + puntos.length);
  const distancias = puntos.map(p => Math.round(haversine({ lat: 19.70, lng: -103.47 }, p)));
  comprobar('el primero cae a mitad del primer tramo (~200 m)', Math.abs(distancias[0] - 200) < 15, 'cayó a ' + distancias[0]);
  const separaciones = puntos.slice(1).map((p, i) => haversine(puntos[i], p));
  comprobar('todos quedan a ~400 m del anterior',
    separaciones.every(s => Math.abs(s - 400) < 15),
    'separaciones: ' + separaciones.map(s => Math.round(s)).join(', '));
  comprobar('una calle corta no genera un punto más allá de su fin',
    puntosDesdeVias([calleRecta(19.70, -103.47, 500, 'Corta')], { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 }).length === 1);
}

console.log('\n2 · Una avenida partida en tramos (así viene de OpenStreetMap)');
{
  // Tres tramos de 500 m que se tocan: si cada tramo reiniciara la cuenta,
  // la avenida saldría con puntos cada 200 m.
  const tramos = [
    calleRecta(19.70, -103.470, 500, 'Avenida Larga'),
    calleRecta(19.70, -103.465, 500, 'Avenida Larga'),
    calleRecta(19.70, -103.460, 500, 'Avenida Larga')
  ];
  const cadenas = encadenarVias(tramos, 30);
  comprobar('los tres tramos se encadenan en UNA sola cadena', cadenas.length === 1, 'salieron ' + cadenas.length + ' cadenas');
  // 63 = 21×3: los tramos se concatenan completos y el vértice de unión
  // queda a pocos metros del anterior (así es OSM de verdad).
  comprobar('la cadena conserva todos los vértices', cadenas[0].length === 63, 'vértices: ' + cadenas[0].length);
  const huecoUnion = haversine(cadenas[0][20], cadenas[0][21]);
  comprobar('la unión entre tramos queda dentro de la tolerancia', huecoUnion < 30, 'hueco: ' + Math.round(huecoUnion) + ' m');
  comprobar('y ese hueco no altera el reparto (siguen siendo 4 puntos)',
    puntosDesdeCadenas(cadenas, { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 }).length === 4);
  const puntos = puntosDesdeVias(tramos, { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 });
  comprobar('la cuenta sigue de tramo en tramo (4 puntos, no 6)',
    puntos.length === 4, 'salieron ' + puntos.length);
  comprobar('todos llevan el nombre de la avenida',
    puntos.every(p => p.via === 'Avenida Larga'),
    'nombres: ' + puntos.map(p => p.via).join('|'));
  // Y si los tramos NO se tocan, siguen siendo cadenas separadas:
  const sueltos = encadenarVias([calleRecta(19.70, -103.470, 500, 'A'), calleRecta(19.72, -103.470, 500, 'B')], 30);
  comprobar('dos calles que no se tocan quedan como cadenas separadas', sueltos.length === 2);
}

console.log('\n3 · Los cruces y las calles paralelas no se borran entre sí');
{
  // Este es el fallo que motivó el cambio: con un filtro de 300 m, los
  // puntos de calles paralelas a 120 m se eliminaban entre sí y la calle
  // vecina quedaba SIN NINGÚN punto.
  const este = calleRecta(19.70, -103.47, 1000, 'Avenida Este');
  const norte = viaNorte(19.70, -103.47, 500, 'Calle Norte');
  const puntos = puntosDesdeVias([este, norte], { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 });
  comprobar('la avenida conserva sus puntos', puntos.some(p => p.via === 'Avenida Este'));
  comprobar('la calle transversal también', puntos.some(p => p.via === 'Calle Norte'));
  let encimados = 0;
  for (let i = 0; i < puntos.length; i++){
    for (let j = i + 1; j < puntos.length; j++){
      if (haversine(puntos[i], puntos[j]) < 60) encimados++;
    }
  }
  comprobar('ningún par queda a menos de 60 m (solo duplicados reales)', encimados === 0, 'pares: ' + encimados);

  // Dos paralelas a 120 m, el caso de la cuadrícula del centro:
  const p1 = calleRecta(19.700, -103.47, 1000, 'Calle 1');
  const p2 = calleRecta(19.7011, -103.47, 1000, 'Calle 2');
  const ambas = puntosDesdeVias([p1, p2], { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 });
  comprobar('dos paralelas a 120 m conservan puntos las dos',
    ambas.filter(p => p.via === 'Calle 1').length >= 2 && ambas.filter(p => p.via === 'Calle 2').length >= 2,
    'C1: ' + ambas.filter(p => p.via === 'Calle 1').length + ', C2: ' + ambas.filter(p => p.via === 'Calle 2').length);
}

console.log('\n4 · Techo de puntos y numeración');
{
  const vias = [];
  for (let i = 0; i < 40; i++) vias.push(calleRecta(19.69 + i * 0.0015, -103.49, 3000, 'Calle ' + i));
  const puntos = puntosDesdeVias(vias, { intervaloM: 400, maxPuntos: 120, separacionMinM: 60 });
  comprobar('se respeta el techo de maxPuntos', puntos.length <= 120, 'salieron ' + puntos.length);
  comprobar('la numeración es corrida y sin huecos',
    puntos.every((p, i) => p.numero === i + 1));
  comprobar('sin techo saldrían muchos más (el techo recorta de verdad)',
    puntosDesdeVias(vias, { intervaloM: 400, maxPuntos: 100000, separacionMinM: 60 }).length > 120);
}

console.log('\n5 · Cada punto dice la verdad');
{
  const via = calleRecta(19.70, -103.47, 1200, 'Calle Emiliano Zapata');
  const puntos = puntosDesdeVias([via], { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 });
  comprobar('el estado es "propuesto por el sistema"',
    puntos.every(p => p.estado === 'Punto propuesto por el sistema'));
  comprobar('ninguno se marca como confirmado', puntos.every(p => p.confirmado === false));
  comprobar('todos se identifican como red urbana',
    puntos.every(p => p.colonia === 'Red urbana de Ciudad Guzmán'));
  comprobar('llevan el nombre de la calle de OpenStreetMap',
    puntos.every(p => p.via === 'Calle Emiliano Zapata'));
  comprobar('traen latitud y longitud numéricas',
    puntos.every(p => typeof p.lat === 'number' && typeof p.lng === 'number' && p.lat > 19 && p.lng < -103));
}

console.log('\n6 · Casos raros que no deben romper nada');
{
  comprobar('sin calles devuelve cero puntos', puntosDesdeVias([], {}).length === 0);
  comprobar('una calle de un solo punto se ignora',
    puntosDesdeVias([{ type: 'way', geometry: [{ lat: 19.7, lon: -103.47 }], tags: {} }], {}).length === 0);
  comprobar('una calle sin nombre no rompe el reparto',
    puntosDesdeVias([calleRecta(19.70, -103.47, 900, null)], { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 }).length === 2);
  comprobar('puntos repetidos en la geometría no cuelgan el bucle',
    puntosDesdeVias([{ type: 'way', geometry: [{ lat: 19.7, lon: -103.47 }, { lat: 19.7, lon: -103.47 }, { lat: 19.7, lon: -103.47 }], tags: {} }], {}).length === 0);
  comprobar('acepta la clave "lng" además de "lon" (Overpass usa lon)',
    puntosDesdeVias([{ type: 'way', geometry: [{ lat: 19.70, lng: -103.47 }, { lat: 19.70, lng: -103.465 }], tags: {} }], { intervaloM: 400, maxPuntos: 100, separacionMinM: 60 }).length === 1);
  comprobar('una cadena de un solo vértice se ignora',
    puntosDesdeCadenas([[{ lat: 19.7, lng: -103.47, via: null }]], {}).length === 0);
}

console.log('\n7 · El mapa no puede quedarse sin puntos por un fallo de red');
{
  comprobar('hay copia local de la red (no se le vuelve a pedir a Overpass cada vez)',
    /localStorage\.setItem\(RED_CIUDAD\.cacheClave/.test(SRC));
  comprobar('la copia local caduca sola', /cacheDias/.test(SRC));
  comprobar('una sola consulta para toda la ciudad, no una por colonia',
    (SRC.match(/out geom;/g) || []).length === 2, 'consultas con "out geom": ' + (SRC.match(/out geom;/g) || []).length);
  comprobar('el filtro anti-duplicados es pequeño (60 m): un filtro grande borraría calles paralelas',
    RED_CIUDAD.separacionMinM === 60, 'separacionMinM = ' + RED_CIUDAD.separacionMinM);
  comprobar('la ventana de la ciudad cubre Ciudad Guzmán',
    RED_CIUDAD.bbox === '19.675,-103.500,19.735,-103.430', RED_CIUDAD.bbox);
  comprobar('el punto más cercano busca en toda la ciudad, no solo en la colonia activa',
    /redPuntos\.concat\(puntosActuales\)/.test(SRC));
  comprobar('la capa de la red se dibuja con lienzo (canvas) para aguantar cientos de puntos',
    /L\.canvas\(/.test(SRC));
  comprobar('la carga de la red no se repite sin necesidad en cada visita al mapa',
    /redUltimoIntento < 60000/.test(SRC));
}

console.log('\n8 · Al abrir el mapa se ve toda la ciudad, no una esquina');
{
  // Fallo real detectado en el navegador: al arrancar, centrarEnRuta()
  // hacía fitBounds con el mapa oculto y dejaba la vista encerrada en una
  // esquina con zoom 18; la red urbana quedaba fuera del encuadre y
  // parecía que "el lienzo no pintaba".
  comprobar('centrarEnRuta no mueve la vista si el usuario no está en el mapa',
    /estado\.vista !== 'mapa'/.test(extraer('centrarEnRuta')));
  const ajustarFn = extraer('ajustarVistaRedCiudad');
  comprobar('existe el encuadre automático de la red urbana (ajustarVistaRedCiudad)', !!ajustarFn);
  comprobar('el encuadre corre UNA sola vez por carga de página (no roba la vista en cada visita)',
    ajustarFn.includes('redAjustada') && ajustarFn.includes('redAjustada = true'));
  comprobar('el encuadre no acerca más de zoom 14 (es una vista de ciudad, no de calle)',
    /maxZoom: 14/.test(ajustarFn));
  comprobar('al entrar a la pestaña Mapa se ajusta la vista si la red ya está lista',
    /if \(redPuntos\.length\) ajustarVistaRedCiudad\(\);/.test(SRC));
  comprobar('la red recién cargada también encuadra (caché y Overpass)',
    (SRC.match(/ajustarVistaRedCiudad\(\);/g) || []).length >= 3,
    'llamadas: ' + (SRC.match(/ajustarVistaRedCiudad\(\);/g) || []).length);
}

console.log('\n' + (fallos ? 'FALLOS: ' + fallos : 'Todo en orden: ') + ok + ' comprobaciones, ' + fallos + ' fallos.');
process.exit(fallos ? 1 : 0);