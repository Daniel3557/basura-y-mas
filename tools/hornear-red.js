/* BASURA Y MÁS · hornear la red urbana como copia de respaldo
   ------------------------------------------------------------
   La red urbana de puntos se pide a Overpass (OpenStreetMap). Cuando el
   servicio está saturado, la app queda sin la capa. Esta herramienta
   consulta Overpass UNA vez y guarda la respuesta REAL como copia estática
   (red-ciudad.json) que la app usa de respaldo. Es el mismo principio de
   UBICACION_COLONIAS: datos de verdad, con procedencia, no inventados.

     node tools/hornear-red.js            # consulta Overpass y hornea
     node tools/hornear-red.js ruta.json  # hornea desde una captura previa

   La copia lleva la fecha y la consulta exacta dentro, para que se sepa
   de dónde salió cada calle. Refrescar de vez en cuando (las calles
   cambian poco; una vez al semestre sobra). */
'use strict';

process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');

const RED = {
  bbox: '19.675,-103.500,19.735,-103.430',
  tags: ['primary', 'secondary', 'tertiary', 'residential'],
  servidor: 'https://overpass-api.de/api/interpreter',
  ua: 'basura-y-mas/1.0 (proyecto escolar CBTis 226)'
};

function contarVias(j){
  return (j.elements || []).filter(function(e){ return e.type === 'way' && e.geometry && e.geometry.length > 1; }).length;
}

async function main(){
  const destino = 'red-ciudad.json';
  const captura = process.argv[2];

  let datos;
  if (captura){
    datos = JSON.parse(fs.readFileSync(captura, 'utf8'));
    console.log('Horneando desde la captura ' + captura + '…');
  } else {
    const q = '[out:json][timeout:60];way["highway"~"^(' + RED.tags.join('|') +
      ')$"](' + RED.bbox + ');out geom;';
    console.log('Consultando a ' + RED.servidor + ' (puede tardar ~15 s)…');
    const r = await fetch(RED.servidor, {
      method: 'POST',
      headers: { 'User-Agent': RED.ua, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q)
    });
    if (!r.ok) throw new Error('Overpass respondió ' + r.status + ' — reintenta más tarde o pasa una captura previa como argumento');
    datos = await r.json();
  }

  const vias = contarVias(datos);
  if (vias < 500) throw new Error('La respuesta solo trae ' + vias + ' vías; no parece la ciudad completa. No se hornea nada.');

  const copia = {
    fuente: 'OpenStreetMap vía Overpass API',
    consulta: '[out:json][timeout:60];way["highway"~"^(primary|secondary|tertiary|residential)$"](' + RED.bbox + ');out geom;',
    bbox: RED.bbox,
    servidores: ['https://overpass-api.de/api/interpreter'],
    generado: new Date().toISOString().slice(0, 10),
    vias: datos.elements.filter(function(e){ return e.type === 'way' && e.geometry && e.geometry.length > 1; })
  };
  fs.writeFileSync(destino, JSON.stringify(copia));
  const kb = Math.round(fs.statSync(destino).size / 1024);
  console.log('✔ ' + destino + ': ' + vias + ' vías, ' + kb + ' KB, generado ' + copia.generado);
}

main().catch(function(e){ console.error('✗ ' + e.message); process.exit(1); });
