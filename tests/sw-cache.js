/* BASURA Y MÁS · pruebas del service worker (orden de caché)
   ------------------------------------------------------------
   Aquí hubo un bug real: el HTML iba por red primero, pero app.js se
   servía caché-primero. El navegador entregaba el app.js viejo y por eso
   las colonias nuevas no aparecían hasta la segunda recarga. Esta prueba
   carga el sw.js DE VERDAD, simula la caché y comprueba qué respuesta
   recibe la página en cada caso. Si alguien vuelve a poner el código del
   mismo origen en caché-primero, esto falla.

     node tests/sw-cache.js

   Sin red, sin navegador y sin service worker instalado.
   ============================================================ */
'use strict';

process.chdir(require('path').join(__dirname, '..'));
const fs = require('fs');
const vm = require('vm');

const ORIGEN = 'https://ejemplo.test';
let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle){
  if (cond){ ok++; console.log('  ok   ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (detalle ? ' -> ' + detalle : '')); }
}

/* ---------- Service worker de mentira con el sw.js real dentro ---------- */
function montarSw(){
  const manejadores = {};
  const entradas = Object.create(null);

  const cache = {
    match(req){
      const u = typeof req === 'string' ? req : req.url;
      if (u in entradas) return Promise.resolve(entradas[u]);
      if (/\/$|index\.html$/.test(u)){
        for (const k of Object.keys(entradas)){
          if (/index\.html$/.test(k)) return Promise.resolve(entradas[k]);
        }
      }
      return Promise.resolve(undefined);
    },
    put(req, res){ entradas[typeof req === 'string' ? req : req.url] = res; return Promise.resolve(); },
    addAll(){ return Promise.resolve(); }
  };

  const caches = {
    open(){ return Promise.resolve(cache); },
    match(req){ return cache.match(req); },
    keys(){ return Promise.resolve([]); },
    delete(){ return Promise.resolve(true); }
  };

  const self = {
    location: { origin: ORIGEN },
    addEventListener(tipo, fn){ manejadores[tipo] = fn; },
    skipWaiting(){ return Promise.resolve(); },
    clients: { claim(){ return Promise.resolve(); } }
  };

  const ctx = vm.createContext({
    self, caches, URL, Response, Request, Promise, console, setTimeout, clearTimeout
  });
  ctx.fetch = () => Promise.reject(new Error('sin red'));
  vm.runInContext(fs.readFileSync('sw.js', 'utf8'), ctx, { filename: 'sw.js' });
  return { manejadores, entradas, ctx };
}

/* Dispara el evento fetch y devuelve lo que recibiría la página. */
function pedir(montaje, url, opciones){
  opciones = opciones || {};
  const { manejadores, entradas, ctx } = montaje;

  if (opciones.cacheado !== undefined) entradas[url] = new Response(opciones.cacheado, { status: 200 });

  let llamadasRed = 0;
  ctx.fetch = function (){
    llamadasRed++;
    if (opciones.sinRed) return Promise.reject(new Error('sin red'));
    return Promise.resolve(new Response(
      opciones.red !== undefined ? opciones.red : 'DE_RED',
      { status: 200, headers: { 'content-type': 'text/plain' } }));
  };

  let promesa = null, intervenida = false;
  manejadores.fetch({
    request: { method: 'GET', url: url, mode: opciones.modo || 'no-cors' },
    respondWith(p){ intervenida = true; promesa = p; }
  });

  const salida = {
    intervenida: intervenida,
    estado: null,
    llamadasRed: function(){ return llamadasRed; },
    cuerpo: null
  };
  if (promesa){
    salida.cuerpo = promesa.then(function (res){
      salida.estado = res && res.status;
      return res && typeof res.text === 'function' ? res.text() : null;
    });
  }
  return salida;
}

async function main(){
  /* ---------- 1 · El bug: app.js con una copia vieja en caché ---------- */
  console.log('\n1 · El codigo de la pagina va por red primero');
  {
    const r = pedir(montarSw(), ORIGEN + '/app.js', { cacheado: 'app.js_VIEJO', red: 'app.js_NUEVO' });
    const cuerpo = await r.cuerpo;
    comprobar('app.js entrega la version de la red, no la de la cache', cuerpo === 'app.js_NUEVO', 'llego: ' + cuerpo);
    comprobar('app.js sale a la red aunque tenga copia guardada', r.llamadasRed() === 1, 'llamadas a fetch: ' + r.llamadasRed());
  }

  /* ---------- 2 · estilos.css ---------- */
  console.log('\n2 · estilos.css va por red primero');
  {
    const r = pedir(montarSw(), ORIGEN + '/estilos.css', { cacheado: 'css_VIEJO', red: 'css_NUEVO' });
    comprobar('estilos.css entrega la version de la red', (await r.cuerpo) === 'css_NUEVO');
  }

  /* ---------- 3 · Las paginas ---------- */
  console.log('\n3 · Las paginas van por red primero');
  {
    const r = pedir(montarSw(), ORIGEN + '/', { modo: 'navigate', cacheado: 'html_VIEJO', red: 'html_NUEVO' });
    comprobar('la pagina entrega la version de la red', (await r.cuerpo) === 'html_NUEVO');
  }

  /* ---------- 4 · Iconos: aqui si vale la cache primero ---------- */
  console.log('\n4 · Los iconos si pueden ir por cache primero');
  {
    const r = pedir(montarSw(), ORIGEN + '/icon.svg', { cacheado: 'icono', red: 'icono_de_red' });
    comprobar('el icono se sirve al instante desde la cache', r.llamadasRed() === 0, 'llamadas a fetch: ' + r.llamadasRed());
    comprobar('y aun asi se refresca en segundo plano', (await r.cuerpo) === 'icono');
  }

  /* ---------- 5 · Lo que nunca se cachea ---------- */
  console.log('\n5 · Lo que nunca se toca');
  {
    comprobar('la API de Eco va siempre a la red',
      !pedir(montarSw(), ORIGEN + '/api/eco', { cacheado: 'eco', red: 'eco_de_red' }).intervenida);
    comprobar('los mapas de OpenStreetMap no se cachean',
      !pedir(montarSw(), 'https://tile.openstreetmap.org/1/2/3.png', { cacheado: 'tile' }).intervenida);
    comprobar('Supabase tampoco',
      !pedir(montarSw(), 'https://abc.supabase.co/rest/v1/x', {}).intervenida);
  }

  /* ---------- 6 · Sin red ---------- */
  console.log('\n6 · Sin red');
  {
    const r = pedir(montarSw(), ORIGEN + '/app.js', { cacheado: 'app.js_VIEJO', sinRed: true });
    comprobar('sin red, app.js cae a la copia guardada y la app sigue abriendo',
      (await r.cuerpo) === 'app.js_VIEJO');

    const r2 = pedir(montarSw(), ORIGEN + '/nuevo.js', { sinRed: true });
    await r2.cuerpo;
    comprobar('sin red y sin copia guardada, responde 504 en vez de romperse',
      r2.estado === 504, 'estado: ' + r2.estado);
  }

  console.log('\n' + (fallos ? 'FALLOS: ' + fallos : 'Todo en orden: ') + ok + ' comprobaciones, ' + fallos + ' fallos.');
  process.exit(fallos ? 1 : 0);
}

main().catch(function (e){
  console.error('La prueba revento: ' + e.message);
  process.exit(1);
});