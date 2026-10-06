#!/usr/bin/env node
/* BASURA Y MÁS · ubicar las colonias del catálogo en el mapa
   ------------------------------------------------------------
   El catálogo COLONIAS (77 nombres) no trae coordenadas y el proyecto
   se niega a inventarlas. Este script pregunta a Nominatim (el buscador
   de OpenStreetMap) dónde está cada colonia, CON validación estricta:

     · el resultado debe caer dentro del límite urbano de Ciudad Guzmán,
     · se descartan respuestas que son la ciudad entera,
     · se prefieren resultados de tipo colonia/barrio (place=neighbourhood,
       quarter, suburb, city_block) sobre calles y escuelas,
     · el nombre debe coincidir (sin acentos, sin la palabra "colonia").

   Solo las colonias que pasan el filtro se colocan en el mapa; las que
   no se reportan para no inventar datos. Uso:

     node tools/ubicar-colonias.js            # imprime el reporte
     node tools/ubicar-colonias.js --json     # solo el JSON final

   Respeta el límite de Nominatim: 1 petición por segundo.
   ============================================================ */
'use strict';
process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');

const SRC = fs.readFileSync('app.js', 'utf8');

/* ---------- Catálogo y colonias con polígono (no se geocodifican) ---------- */
const COLONIAS = Function('"use strict"; return ' + SRC.match(/const COLONIAS = (\[[\s\S]*?\]);/)[1])();
const zonaNombres = [...SRC.matchAll(/nombre: '([^']+)'/g)].map(m => m[1]);
const objetivos = COLONIAS.filter(n => zonaNombres.indexOf(n) === -1);

const BBOX = { latN: 19.735, latS: 19.675, lngO: -103.500, lngE: -103.430 };
const UA = 'basura-y-mas/1.0 (proyecto escolar CBTis 226; https://github.com/Daniel3557/basura-y-mas)';

/* ---------- Utilidades ---------- */
function normalizar(s){
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^(colonia|fraccionamiento|fracc\.?|unidad habitacional|u\.?\s?h\.?)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function nominatim(q){
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=mx' +
    '&viewbox=' + BBOX.lngO + ',' + BBOX.latN + ',' + BBOX.lngE + ',' + BBOX.latS + '&bounded=1&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('Nominatim ' + r.status);
  return r.json();
}

const PESO_TIPO = {
  neighbourhood: 4, quarter: 4, suburb: 4, city_block: 3, postcode: 0,
  residential: 3, village: 0, hamlet: 0
};

function evaluar(colonia, candidatos){
  const objetivo = normalizar(colonia);
  let mejor = null;
  for (const c of (candidatos || [])){
    const lat = parseFloat(c.lat), lng = parseFloat(c.lon);
    if (!(lat > BBOX.latS && lat < BBOX.latN && lng > BBOX.lngO && lng < BBOX.lngE)) continue;
    const display = normalizar(c.display_name || '');
    if (display === normalizar('Ciudad Guzmán') || display === normalizar('Zapotlán el Grande')) continue;
    if (c.category === 'boundary') continue;          // límites administrativos: la ciudad entera
    const coincide = display.includes(objetivo);
    const tipo = (c.addresstype || c.type || '').toLowerCase();
    const peso = PESO_TIPO[tipo] || 0;
    const punto = { lat: +lat.toFixed(6), lng: +lng.toFixed(6), tipo: c.category + '/' + tipo,
                    texto: (c.display_name || '').split(',').slice(0, 3).join(',').trim() };
    const score = (coincide ? 3 : 0) + peso + (c.category === 'place' ? 1 : 0);
    if (!mejor || score > mejor.score) mejor = Object.assign(punto, { score, coincide });
  }
  // Sin coincidencia de nombre no se acepta: sería poner la colonia donde no es.
  return mejor && mejor.coincide ? mejor : null;
}

/* ---------- Recorrido del catálogo ---------- */
(async () => {
  const resultado = {};   // nombre -> {lat, lng, tipo, texto}
  const fallidas = [];
  for (const nombre of objetivos){
    let punto = null;
    for (const consulta of [
      nombre + ', Ciudad Guzmán, Jalisco',
      nombre + ', Zapotlán el Grande, Jalisco',
      nombre + ', Ciudad Guzmán'
    ]){
      try {
        punto = evaluar(nombre, await nominatim(consulta));
      } catch (e) {
        console.error('  aviso: ' + e.message + ' (' + consulta + ')');
      }
      await dormir(1100);                      // límite de cortesía de Nominatim
      if (punto) break;
    }
    if (punto) resultado[nombre] = punto;
    else fallidas.push(nombre);
    console.error((punto ? '  ok   ' : '  SIN  ') + nombre + (punto ? ' -> ' + punto.texto : ''));
  }

  console.error('\nUbicadas: ' + Object.keys(resultado).length + ' de ' + objetivos.length +
    ' (además de las ' + zonaNombres.length + ' con polígono). Sin ubicación fiable: ' + fallidas.length);
  if (fallidas.length) console.error('Sin ubicar: ' + fallidas.join(' | '));

  if (process.argv.includes('--json')){
    console.log(JSON.stringify(resultado, null, 1));
  } else {
    fs.writeFileSync('.ubicacion-colonias.json', JSON.stringify(resultado, null, 1));
    console.error('\nGuardado en .ubicacion-colonias.json');
  }
})();
