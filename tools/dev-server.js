/* BASURA Y MÁS · servidor de desarrollo
   ------------------------------------------------------------
   Vercel sirve el proyecto como estático + funciones de /api. En local
   no hay Vercel, así que este archivo hace de las dos cosas:

     · sirve los archivos del repositorio (para probar la app);
     · entrega POST y GET /api/eco a la MISMA función que se despliega
       (api/eco.js), sin copia y sin divergencia.

   La clave se lee de un archivo .env local que git ignora:

     cp .env.example .env   y luego pega la clave ahí dentro

   Uso:  node tools/dev-server.js [puerto]

   Este archivo es solo de desarrollo: en producción quien responde es
   Vercel. No se despliega ni se sirve en el navegador.
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const eco = require('../api/eco.js');

const RAIZ = path.join(__dirname, '..');
const PUERTO = Number(process.argv[2] || process.env.PORT || 4178);

/* .env mínimo: solo KEY=VALUE, sin comillas ni escapes. */
function cargarEnv(){
  const f = path.join(RAIZ, '.env');
  if (!fs.existsSync(f)) return false;
  let n = 0;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(function(line){
    const i = line.indexOf('=');
    if (i < 1 || line.trim().charAt(0) === '#') return;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!k || !v) return;
    if (!process.env[k]){ process.env[k] = v; n++; }
  });
  return n > 0;
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf'
};

function responderArchivo(res, ruta){
  fs.readFile(ruta, function(err, buf){
    if (err){ res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); return; }
    const ext = path.extname(ruta).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TIPOS[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}

const CUERPO_MAX = 64 * 1024;

/** Vercel entrega req.body ya parseado; un servidor de Node no. Sin esto
    la función recibiría undefined y respondería "pregunta vacía" siempre. */
function leerCuerpo(req){
  return new Promise(function(resolve){
    if (req.method === 'GET' || req.method === 'HEAD'){ resolve(null); return; }
    let datos = '';
    let cortado = false;
    req.on('data', function(t){
      if (cortado) return;
      datos += t;
      if (datos.length > CUERPO_MAX){ cortado = true; resolve(null); }
    });
    req.on('end', function(){ if (!cortado) resolve(datos || null); });
    req.on('error', function(){ resolve(null); });
  });
}

const cargadas = cargarEnv();

const servidor = http.createServer(function(req, res){
  const url = new URL(req.url, 'http://localhost:' + PUERTO);

  if (url.pathname === '/api/eco'){
    leerCuerpo(req).then(function(cuerpo){
      req.body = cuerpo;
      eco(req, res);
    }).catch(function(){
      res.writeHead(500); res.end('Error');
    });
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const ruta = path.join(RAIZ, path.normalize(rel));
  // Nunca se sirve nada por fuera de la raíz del repositorio.
  if (ruta.indexOf(RAIZ) !== 0){ res.writeHead(403); res.end('Prohibido'); return; }
  if (fs.existsSync(ruta) && fs.statSync(ruta).isDirectory()){ responderArchivo(res, path.join(ruta, 'index.html')); return; }
  responderArchivo(res, ruta);
});

servidor.listen(PUERTO, '127.0.0.1', function(){
  console.log('Basura y Más · desarrollo en http://127.0.0.1:' + PUERTO);
  console.log('  /api/eco -> ' + (process.env.NVIDIA_API_KEY ? 'con IA (clave leída del .env)' : 'SIN IA (no hay clave en .env)'));
  if (!cargadas && !process.env.NVIDIA_API_KEY) console.log('  Copia .env.example a .env si quieres probar la IA en local.');
});