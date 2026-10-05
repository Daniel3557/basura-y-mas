/* BASURA Y MÁS · pruebas de las cuentas de Eco (lado del navegador)
   ------------------------------------------------------------
   Eco tiene dos piezas que NO pueden equivocarse: la calculadora y el
   simulador de acciones. Las dos viven en app.js y aquí se prueban tal
   cual, extrayendo el código del archivo de verdad: si alguien cambia la
   cuenta, este test lo ve.

     node tests/eco-reglas.js

   Sin red, sin clave y sin navegador.
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
function arrancar(nombre, deps){
  const envoltura = extraer(nombre) + '\nreturn ' + nombre + ';';
  const Factor = Function;
  return Factor.apply(null, (deps || []).concat([envoltura]));
}

/* El mínimo que las dos piezas necesitan del resto de la app. */
const ecoTexto = function (s) { return String(s == null ? '' : s); };
const PTS = { accion: 10, reporte: 20, participacion: 30, ayuda: 5 };
const NIVELES = [
  { min: 0, nombre: 'Vecino consciente' }, { min: 100, nombre: 'Cuidador' },
  { min: 220, nombre: 'Ecoactivo' }, { min: 360, nombre: 'Participante' }
];
function nivelDe(p){
  let i = 0;
  while (i + 1 < NIVELES.length && p >= NIVELES[i + 1].min) i++;
  return { nivel: i + 1, nombre: NIVELES[i].nombre, min: NIVELES[i].min };
}

const ecoCalcular = arrancar('ecoCalcular', ['ecoTexto'])(ecoTexto);
const DEPS = ['ecoTexto', 'PTS', 'nivelDe', 'estado'];

/* ---------- 1. La calculadora ---------- */
console.log('\n1 · Calculadora (sin eval, solo números y operadores)');
const cuentas = [
  ['145 + 2*20 + 3*30', 275], ['2*(3+4)', 14], ['145-220', -75], ['10/4', 2.5],
  ['7%3', 1], ['5', 5], ['-3+10', 7], ['100*1.5', 150], ['(145+40+90)/5', 55],
  ['1/0', null], ['7%0', null], ['2**8', null], ['2+abc', null], ['fetch(1)', null],
  ['alert(1)+2', null], ['constructor', null], ['this', null], ['1;2', null],
  ['', null], ['1+'.repeat(70), null], ['9'.repeat(200), null], ['1e999', null]
];
cuentas.forEach(function (c){
  let r;
  try { r = ecoCalcular(c[0]); } catch (e){ r = 'EXCEPCION'; }
  comprobar(JSON.stringify(c[0]).slice(0, 24).padEnd(26) + ' = ' + JSON.stringify(c[1]),
    r === c[1], 'salió ' + JSON.stringify(r));
});
comprobar('no usa eval ni Function', !/eval\(|new Function/.test(extraer('ecoCalcular')));

/* ---------- 2. El simulador ---------- */
console.log('\n2 · Simulador de acciones (la cuenta y el sí/no son de la app)');
function simularCon(pregunta, puntos){
  const fn = arrancar('ecoSimularAcciones', DEPS)(ecoTexto, PTS, nivelDe, { puntos: puntos });
  return fn(pregunta);
}
function veredicto(r){
  if (r.indexOf('No entend') === 0) return 'NO-ENT';
  if (/S[IÍ], alcanzar/.test(r)) return 'SI';
  if (r.indexOf('NO, no alcanzar') !== -1) return 'NO';
  return '?';
}
function puntosFinales(r){
  const m = /quedarías en (\d+)/.exec(r);
  return m ? Number(m[1]) : null;
}
const simulaciones = [
  ['2 reportes y 3 publicaciones', 145, 275, 'SI'],
  ['3 reportes', 145, 205, 'NO'],
  ['1 reporte y 1 publicacion', 145, 195, 'NO'],
  ['5 reportes y 2 publicaciones', 145, 305, 'SI'],
  ['3 publicaciones', 145, 235, 'SI'],
  ['10 reportes', 145, 345, 'SI'],
  ['1 accion ecologica', 145, 155, 'NO'],
  ['ayudo a un vecino', 145, 150, 'NO'],
  ['2 reportes', 100, 140, 'NO'],
  ['nada de nada', 145, null, 'NO-ENT'],
  ['["reporte","reporte","publicacion"]', 145, 215, 'NO']
];
simulaciones.forEach(function (c){
  const r = simularCon(c[0], c[1]);
  const p = puntosFinales(r), v = veredicto(r);
  const bien = (c[2] === null || p === c[2]) && v === c[3];
  comprobar('"' + c[0] + '" desde ' + c[1] + 'p -> ' + p + ' pts, ' + v, bien,
    'esperaba ' + c[2] + ' y ' + c[3] + '; salió: ' + r.slice(0, 90));
});
const r2 = simularCon('2 reportes', 145);
comprobar('el veredicto va al principio, para que el modelo lo cite',
  r2.indexOf('RESPUESTA CORRECTA:') === 0);

/* ---------- 3. Lo que el modelo NO puede ver ---------- */
console.log('\n3 · El simulador no recibe datos personales');
const conSesion = arrancar('ecoSimularAcciones', DEPS)(
  ecoTexto, PTS, nivelDe, { puntos: 145 });
comprobar('con solo los puntos basta: ni nombre, ni correo',
  conSesion('2 reportes').indexOf('nombre') === -1 && conSesion('2 reportes').indexOf('correo') === -1);

/* ---------- 4. Las preguntas sobre TU actividad ---------- */
console.log('\n4 · Conclusiones sobre tu actividad (la app, no el modelo)');
const ecoReparto = arrancar('ecoReparto', ['ecoTexto'])(ecoTexto);
const conclusion = arrancar('ecoConclusion', ['ecoTexto', 'ecoReparto'])(ecoTexto, ecoReparto);

/* Reportes de prueba: Centro x3, La Floresta x1, El Agustin x1.
   Tipos: Contenedor lleno x2, Basura en la calle x2, Camion no paso x1. */
const REPORTS = [
  { colonia: 'Centro', tipo: 'Contenedor lleno' },
  { colonia: 'Centro', tipo: 'Basura en la calle' },
  { colonia: 'La Floresta', tipo: 'Camión no pasó' },
  { colonia: 'El Agustín', tipo: 'Basura en la calle' },
  { colonia: 'Centro', tipo: 'Contenedor lleno' }
];

comprobar('conclusión de colonia: Centro con 3 de 5',
  conclusion(REPORTS, 'colonia') === 'Centro, con 3 de tus 5 datos',
  conclusion(REPORTS, 'colonia'));
comprobar('conclusión de tipo: empate 2-2 entre los dos primeros',
  conclusion(REPORTS, 'tipo') === 'Contenedor lleno y Basura en la calle, con 2 cada uno',
  conclusion(REPORTS, 'tipo'));

const SOLO_UNO = [{ colonia: 'Villas del Padre', tipo: 'Otro' }];
comprobar('con un solo reporte no inventa comparación',
  conclusion(SOLO_UNO, 'colonia') === 'Villas del Padre, con 1 de tu único dato',
  conclusion(SOLO_UNO, 'colonia'));

const EMPATE = [
  { colonia: 'Centro' }, { colonia: 'Centro' }, { colonia: 'La Floresta' }, { colonia: 'La Floresta' }
];
comprobar('con empate lo dice en vez de elegir una',
  conclusion(EMPATE, 'colonia') === 'Centro y La Floresta, con 2 cada uno',
  conclusion(EMPATE, 'colonia'));
comprobar('sin datos no inventa nada', conclusion([], 'colonia') === null);

/* ecoReparto tiene que seguir enteros para las herramientas */
comprobar('el reparto incluye el total y todos los valores',
  ecoReparto(REPORTS, 'colonia', 'Por colonia').indexOf('(total 5)') !== -1);
comprobar('el reparto ordena de mayor a menor',
  /Centro \(3\), La Floresta \(1\), El Agustín \(1\)/.test(ecoReparto(REPORTS, 'colonia', 'Por colonia')),
  ecoReparto(REPORTS, 'colonia', 'Por colonia'));

/* ---------- 5. Patrones sobre tus reportes ---------- */
console.log('\n5 · Patrones (con pocos datos NO se inventa ninguno)');
/* DIAS y MINIMO_PATRON se leen del app.js de verdad: si cambian, cambia el test. */
const DIAS = eval(SRC.match(/const DIAS = (\[[^\]]*\]);/)[1]);
const MINIMO_PATRON = Number(SRC.match(/const MINIMO_PATRON = (\d+);/)[1]);
const patrones = arrancar('ecoPatrones', ['DIAS', 'DIAS_PLURAL', 'MINIMO_PATRON'])(
  DIAS, eval('(' + SRC.match(/const DIAS_PLURAL = (\{[^}]*\});/)[1].replace(/'/g, '"') + ')'), MINIMO_PATRON);

const DIA = 86400000;
/** Un reporte fechado en el día de la semana `diaSem` (1 = lunes), hace `semanas` semanas, a esa hora. */
function reporteEn(diaSem, semanas, hora, colonia, tipo){
  const d = new Date();
  const delta = (d.getDay() - diaSem + 7) % 7;          // días hasta ese día de la semana
  d.setDate(d.getDate() - delta - semanas * 7);
  d.setHours(hora, 15, 0, 0);
  return { ts: d.getTime(), colonia: colonia || 'Centro', tipo: tipo || 'Contenedor lleno' };
}

comprobar('sin reportes no hay patrón que buscar',
  patrones([]).suficiente === false && /No tienes reportes/.test(patrones([]).texto));

const uno = patrones([{ ts: Date.now() - DIA, colonia: 'Centro', tipo: 'Otro' }]);
comprobar('con un solo reporte lo dice en vez de suponer',
  uno.suficiente === false && /menos de 4/.test(uno.texto), uno.texto);

const dos = patrones([reporteEn(1, 2, 9), reporteEn(3, 1, 10)]);
comprobar('con dos reportes tampoco afirma patrón',
  dos.suficiente === false && /menos de 4/.test(dos.texto), dos.texto);

const repartidos = patrones([
  reporteEn(1, 4, 9, 'Centro', 'Contenedor lleno'),
  reporteEn(2, 3, 18, 'La Floresta', 'Basura en la calle'),
  reporteEn(3, 2, 13, 'El Agustín', 'Camión no pasó'),
  reporteEn(4, 1, 20, 'Centro', 'Ruta incorrecta'),
  reporteEn(5, 0, 11, 'San Rafael', 'Otro')
]);
comprobar('con 5 reportes repartidos no afirma un día ni una hora',
  repartidos.patrones.every(function (p) { return /reportas más los|sobre todo de/.test(p) === false; }),
  JSON.stringify(repartidos.patrones));
comprobar('y lo dice con esas palabras',
  /no sale un patrón claro|Lo que más se repite/.test(repartidos.texto), repartidos.texto);

const luneses = patrones([
  reporteEn(1, 5, 9, 'Centro', 'Contenedor lleno'),
  reporteEn(1, 4, 9, 'Centro', 'Basura en la calle'),
  reporteEn(1, 3, 9, 'La Floresta', 'Contenedor lleno'),
  reporteEn(1, 2, 9, 'Centro', 'Contenedor lleno'),
  reporteEn(2, 1, 14, 'El Agustín', 'Otro'),
  reporteEn(6, 0, 19, 'San Rafael', 'Camión no pasó')
]);
comprobar('con 4 luneses y 2 más sí lo detecta',
  luneses.suficiente === true && luneses.patrones.indexOf('reportas más los lunes') !== -1, luneses.texto);
comprobar('los días en plural no salen con una s de más',
  !luneses.patrones.some(function (p) { return /luness|miercoless|juevess|sabados/.test(p); }),
  JSON.stringify(luneses.patrones));
const sabados = patrones([reporteEn(6, 3, 10), reporteEn(6, 2, 10), reporteEn(6, 1, 10),
  reporteEn(6, 0, 10), reporteEn(3, 2, 15)]);
comprobar('sábado sí pluraliza a sábados',
  sabados.patrones.indexOf('reportas más los sábados') !== -1, JSON.stringify(sabados.patrones));
const soloSabados = patrones([reporteEn(6, 3, 10), reporteEn(6, 2, 10), reporteEn(6, 1, 10), reporteEn(6, 0, 10)]);
comprobar('si todos son el mismo día, no afirma un patrón de día',
  soloSabados.patrones.every(function (p) { return !/reportas más los/.test(p); }),
  JSON.stringify(soloSabados.patrones));
comprobar('y nombra la hora de más reportes',
  /9:00/.test(luneses.texto), luneses.texto);
comprobar('y dice cada cuánto, en días',
  /entre un reporte y el siguiente/i.test(luneses.texto), luneses.texto);
comprobar('y dice cuándo fue el último',
  /tu último reporte es de hace (hoy|ayer|\d+ días)/i.test(luneses.texto), luneses.texto);

const sinHoy = patrones([reporteEn(1, 3, 9), reporteEn(1, 2, 9), reporteEn(1, 1, 9), reporteEn(1, 0, 9)]);
comprobar('cuando el ganador empata no elige a dedo', sinHoy.patrones.length > 0 || /no sale un patrón/.test(sinHoy.texto));

comprobar('el mínimo de muestra es 4, no 2 ni 3', MINIMO_PATRON === 4);

console.log('\n' + (fallos ? 'FALLOS: ' + fallos : 'Todo en orden: ') + ok + ' comprobaciones, ' + fallos + ' fallos.');
process.exit(fallos ? 1 : 0);