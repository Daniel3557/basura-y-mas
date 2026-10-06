/* ============================================================
   BASURA Y MÁS · Lógica de la aplicación
   Proyecto FILOSOFARTE · Filosofía II · CBTis 226
   ------------------------------------------------------------
   Extraída de index.html para que la CSP pueda limiting
   script-src a 'self'. Se ejecuta con defer, al final del análisis.
   Módulos M0 a M22, en el mismo orden de siempre.
   ============================================================ */

(function(){
'use strict';

/* ============================================================
   MÓDULO 0 · UTILIDADES
   ============================================================ */
const $  = (s, c) => (c || document).querySelector(s);
const $$ = (s, c) => Array.prototype.slice.call((c || document).querySelectorAll(s));
const REDUCIR = window.matchMedia('(prefers-reduced-motion: reduce)');

function normalizar(t){
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}
function fmtDistancia(m){
  if (m == null || !isFinite(m)) return '—';
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(1).replace('.', '.') + ' km';
}
function fmtDuracion(seg){
  if (seg == null || !isFinite(seg)) return '—';
  const min = Math.round(seg / 60);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60);
  return h + ' h ' + (min % 60) + ' min';
}
function haversine(a, b){
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*rad) * Math.cos(b.lat*rad) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function tiempoRelativo(ts){
  const min = Math.floor(Math.max(0, Date.now() - ts) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.floor(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : 'hace ' + d + ' días';
}
function uid(){ return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function hoyISO(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function iniciales(n){
  if (!n) return '👤';
  const p = n.trim().split(/\s+/);
  return ((p[0] || '')[0] || '?').toUpperCase() + (p[1] ? p[1][0].toUpperCase() : '');
}

/* ============================================================
   MÓDULO 1 · PERSISTENCIA LOCAL
   ============================================================ */
const almacen = {
  clave: 'bym.v1',
  ok: (function(){ try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); return true; } catch(e){ return false; } })(),
  datos: null,
  leer(){
    if (!this.ok) return {};
    try { return JSON.parse(localStorage.getItem(this.clave)) || {}; } catch(e){ return {}; }
  },
  guardar(){
    if (!this.ok) return;
    try { localStorage.setItem(this.clave, JSON.stringify(this.datos)); }
    catch(e){ toast('No se pudo guardar localmente (espacio lleno). La app sigue funcionando.', 'error'); }
  },
  borrar(){ if (this.ok) { try { localStorage.removeItem(this.clave); } catch(e){} } }
};
almacen.datos = almacen.leer();
function guardar(){ almacen.guardar(); }

/* ============================================================
   MÓDULO 2 · ESTADO GLOBAL
   ============================================================ */
const estado = {
  vista: 'inicio',
  tema: almacen.datos.tema || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  coloniaId: almacen.datos.coloniaId || 'centro',
  nombrePerfil: almacen.datos.nombrePerfil || 'Invitado',  // identidad propia del dispositivo (sin cuenta se es invitado)
  notif: !!almacen.datos.notif,
  demo: !!almacen.datos.demo,
  puntos: almacen.datos.puntos || 0,
  acciones: almacen.datos.acciones || [],          // {ts, tipo, texto}
  accionDia: almacen.datos.accionDia || null,      // último día con acción ecológica
  diasAccion: almacen.datos.diasAccion || [],      // días distintos con acción
  insignias: almacen.datos.insignias || [],
  reportes: null,
  publicaciones: null,
  ubicacion: null,                                  // {lat,lng} del usuario
  ubicacionManual: null,                            // {lat,lng} seleccionada en mapa
  ubicacionReporte: null,                           // {lat,lng} del reporte en curso
  fotoData: null,
  modoElegirMapa: null,                             // 'usuario' | 'reporte' | null
  eliminadosRep: almacen.datos.eliminadosRep || []  // ids eliminados localmente (no vuelven desde la nube)
};

/* ============================================================
   MÓDULO 3 · CAPA DE DATOS (arquitectura para backend real)
   ------------------------------------------------------------
   Cada función devuelve Promesas y está lista para reemplazarse
   por Supabase / Firebase / API municipal sin tocar la interfaz.
   ============================================================ */
const dataLayer = {
  /** Ubicación del usuario (API del navegador). */
  getUserLocation(){
    return new Promise(function(resolve, reject){
      if (!navigator.geolocation){ reject(new Error('Geolocalización no disponible en este navegador.')); return; }
      navigator.geolocation.getCurrentPosition(
        function(pos){ resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }); },
        function(err){
          const mensajes = { 1: 'Permiso de ubicación rechazado.', 2: 'Ubicación no disponible.', 3: 'La ubicación tardó demasiado.' };
          reject(new Error(mensajes[err.code] || 'No pudimos acceder a tu ubicación.'));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  },
  /** Ruta de recolección de una zona (vialidades OSM + OSRM). */
  getRoutes(zona){ return construirRutaZona(zona); },
  /** Puntos sobre la geometría real de la ruta. */
  getCollectionPoints(ruta, intervaloM){ return distribuirPuntos(ruta.geometria, intervaloM); },
  /** GPS del vehículo. HOY: no hay fuente municipal conectada → null. */
  getVehiclePosition(){
    // Punto de integración futuro: API municipal o backend propio.
    // Cuando exista, devolver {lat,lng,ts} y la app lo mostrará como real.
    return Promise.resolve(null);
  },
  createReport(reporte){
    reporte._pendiente = true;   // se sube solo la primera vez, y solo si nunca se subió
    reportesLocales.push(reporte); almacen.datos.reportes = reportesLocales; guardar();
    reporte.estado_sync = 'Sincronizado con la nube';
    // La fotografía se sube como archivo a Supabase Storage: la fila solo
    // guarda su URL, así la app no descarga megabytes en cada carga.
    return subirFotoReporte(reporte).then(function(url){
      if (url) reporte.foto = url;
      return upsertNube('reportes', reporte);
    }).then(function(ok){
      reporte._sinc = ok;
      if (!ok) reporte.estado_sync = 'Registrado localmente (copia local)';
      renderReportes(); guardar();
      return reporte;
    });
  },
  createPost(post){
    post._pendiente = true;     // se sube solo la primera vez, y solo si nunca se subió
    publicaciones.unshift(post); almacen.datos.publicaciones = publicaciones; guardar();
    return upsertNube('publicaciones', post).then(function(ok){ post._nube = ok; post._sinc = ok; guardar(); return post; });
  },
  votePost(id){
    const p = publicaciones.find(function(x){ return x.id === id; });
    if (!p) return Promise.resolve({ ok: false, error: 'La publicación ya no está en la lista.' });
    // Los "me importa" solo se suman en la base de datos: aquí ya no se
    // manda un PATCH con la cifra (eso quedaba congelado por seguridad).
    return rpcNube('dar_like', { p_publicacion_id: id, p_huella: huellaDispositivo() })
      .then(function(r){
        if (r.ok && typeof r.data === 'number'){ p.likes = r.data; return { ok: true }; }
        return { ok: false, error: mensajeNube(r) };
      });
  },
  sendNotification(titulo, cuerpo){ notificarReal(titulo, cuerpo); }
};

/* ---------- Nube (Supabase) con respaldo local honesto ----------
   API REST de Supabase con la llave anónima: RLS permite leer y crear,
   nunca editar ni borrar contenido ajeno. Sin conexión → todo queda en
   el dispositivo y se etiqueta como "copia local" para no confundir. */
const NUBE = {
  url: 'https://rmnnqggasqxlpntcffrz.supabase.co/rest/v1/',
  storage: 'https://rmnnqggasqxlpntcffrz.supabase.co/storage/v1/object/',
  bucketFotos: 'reportes-fotos',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtbm5xZ2dhc3F4bHBudGNmZnJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4MDAzMzUsImV4cCI6MjEwNjM3NjMzNX0.89g4vlDGldKazqO8o1MFSPcnvNbIL5D486r1lKrUKto'
};
/* Cuántas filas trae la nube y cuántas guarda el dispositivo. Sin topes la
   app grows sin límite: se llena el localStorage y el arranque se ralentiza. */
const MAX_NUBE = 120;
const MAX_LOCAL = 150;
/* Identificador anónimo del dispositivo. NO es un dato personal ni permite
   reconocer a nadie: solo sirve para que la base de datos sepa que "este
   navegador ya votó aquí" y para acotar las publicaciones por minuto.
   Se borra al borrar los datos locales del navegador. */
const CLAVE_HUELLA = 'bym.huella.v1';
let _huella = null;
function huellaDispositivo(){
  if (_huella) return _huella;
  try {
    _huella = localStorage.getItem(CLAVE_HUELLA);
    if (!_huella){
      _huella = 'd' + uid().slice(1) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(CLAVE_HUELLA, _huella);
    }
  } catch(e){}
  if (!_huella) _huella = 'd' + Math.random().toString(36).slice(2, 12);
  return _huella;
}
let nubeCargadaPost = false, nubeCargadaRep = false;

/* ============================================================
   MÓDULO 3b · CUENTAS DE USUARIO (Supabase Auth)
   ------------------------------------------------------------
   Cada visitante puede crear su cuenta (correo + contraseña) para
   tener identidad propia. Sin cuenta se participa como invitado.
   La sesión se guarda en localStorage y se restaura al abrir la app.
   ============================================================ */
const NUBE_AUTH = 'https://rmnnqggasqxlpntcffrz.supabase.co/auth/v1/';
const CLAVE_SESION = 'bym.sesion.v1';
const sesion = { usuario: null };               // { id, email, nombre }
function obtenerSesion(){
  if (!almacen.ok) return null;
  try { return JSON.parse(localStorage.getItem(CLAVE_SESION)) || null; } catch(e){ return null; }
}
function guardarSesion(s){
  try {
    if (s) localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
    else localStorage.removeItem(CLAVE_SESION);
  } catch(e){}
  sesion.usuario = s;
}
function restaurarSesion(){
  const s = obtenerSesion();
  if (!s || !s.id || !s.token) { sesion.usuario = null; return Promise.resolve(); }
  // Renueva el access_token con el refresh_token (los JWT de Supabase caducan en ~1 h)
  return fetch(NUBE_AUTH + 'token?grant_type=refresh_token', {
    method: 'POST', headers: cabecerasAnon(), body: JSON.stringify({ refresh_token: s.refresh })
  }).then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
    if (d && d.access_token){
      guardarSesion({ id: d.user.id, email: d.user.email, token: d.access_token, refresh: d.refresh_token });
      return cargarPerfilRemoto();
    }
    guardarSesion(null); // sesión irrecuperable: sigue como invitado
  }).catch(function(){
    sesion.usuario = s; // sin internet: usa la sesión guardada tal cual
  });
}
function cargarPerfilRemoto(){
  if (!sesion.usuario) return Promise.resolve();
  const uid = sesion.usuario.id;
  return fetch(NUBE.url + 'perfiles?id=eq.' + uid + '&select=nombre,nombre_edicado&limit=1', { headers: cabecerasAnon() })
    .then(function(r){ return r.ok ? r.json() : []; })
    .then(function(rows){
      const fila = (rows && rows[0]) || {};
      const n = (fila.nombre || '').trim();
      // Nunca se deduce del correo: si no hay nombre elegido, 'Vecino'.
      sesion.usuario.nombre = n || 'Vecino';
      sesion.usuario.nombreElegido = !!fila.nombre_edicado;
      estado.nombrePerfil = sesion.usuario.nombre;
      almacen.datos.nombrePerfil = estado.nombrePerfil; guardar();
      aplicarIdentidad();
    }).catch(function(){});
}
function cabecerasAnon(extra){
  const h = { 'apikey': NUBE.key, 'Authorization': 'Bearer ' + NUBE.key, 'Content-Type': 'application/json' };
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}
function cabecerasNube(extra){
  const h = { 'apikey': NUBE.key, 'Content-Type': 'application/json' };
  h['Authorization'] = 'Bearer ' + (sesion.usuario && sesion.usuario.token ? sesion.usuario.token : NUBE.key);
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}
function crearCuenta(nombre, email, pass){
  return fetch(NUBE_AUTH + 'signup', {
    method: 'POST', headers: cabecerasAnon(), body: JSON.stringify({ email: email, password: pass })
  }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(d){ return { ok: r.ok, d: d }; });
  }).then(function(res){
    if (!res.ok){
      const m = (res.d && (res.d.msg || res.d.message || res.d.error_description || res.d.error)) || 'No se pudo crear la cuenta. Revisa los datos e intenta de nuevo.';
      return { ok: false, error: m };
    }
    const d = res.d;
    if (!d || !d.access_token || !d.user) return { ok: false, error: 'La cuenta se creó, pero el servidor pidió confirmar el correo. Pide a Daniel desactivar "Confirm email" en Supabase.' };
    guardarSesion({ id: d.user.id, email: d.user.email, token: d.access_token, refresh: d.refresh_token });
    // El nombre público NO se deduce del correo: si no se elige uno, es 'Vecino'.
    const elegido = (nombre || '').trim();
    const n = elegido || 'Vecino';
    sesion.usuario.nombre = n;
    sesion.usuario.nombreElegido = !!elegido;
    return fetch(NUBE.url + 'perfiles', {
      method: 'POST', headers: cabecerasNube({ 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify([{ id: sesion.usuario.id, nombre: n, nombre_edicado: !!elegido }])
    }).then(function(){ return { ok: true }; }).catch(function(){ return { ok: true }; });
  }).catch(function(){ return { ok: false, error: 'Sin conexión: no se pudo crear la cuenta. Intenta de nuevo con internet.' }; });
}
function iniciarSesion(email, pass){
  return fetch(NUBE_AUTH + 'token?grant_type=password', {
    method: 'POST', headers: cabecerasAnon(), body: JSON.stringify({ email: email, password: pass })
  }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(d){ return { ok: r.ok, d: d }; });
  }).then(function(res){
    if (!res.ok || !res.d.access_token){
      const m = (res.d && (res.d.msg || res.d.message || res.d.error_description || res.d.error)) || 'Correo o contraseña incorrectos.';
      return { ok: false, error: m };
    }
    guardarSesion({ id: res.d.user.id, email: res.d.user.email, token: res.d.access_token, refresh: res.d.refresh_token });
    return cargarPerfilRemoto()
      .then(function(){ return cargarProgresoNube(); })
      .then(function(){ comprobarAdmin(); subirProgreso(); return { ok: true }; });
  }).catch(function(){ return { ok: false, error: 'Sin conexión: no se pudo iniciar sesión. Intenta de nuevo.' }; });
}
/* ---------- Recuperación de contraseña ----------
   Envía el correo de Supabase Auth y procesa el enlace (vuelve con
   #access_token=...). Si el envío falla se explica con el mensaje real. */
function pedirRecuperacion(email){
  const cuerpo = { email: email };
  const esWeb = (location.protocol === 'http:' || location.protocol === 'https:') && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
  if (esWeb) cuerpo.redirect_to = location.origin + location.pathname;
  return fetch(NUBE_AUTH + 'recover', { method: 'POST', headers: cabecerasAnon(), body: JSON.stringify(cuerpo) })
    .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ return { ok: r.ok, d: d }; }); })
    .then(function(res){
      if (!res.ok){
        const m = (res.d && (res.d.msg || res.d.message || res.d.error_description)) || 'No se pudo enviar el correo.';
        return { ok: false, error: m };
      }
      return { ok: true };
    })
    .catch(function(){ return { ok: false, error: 'Sin conexión: no se pudo enviar el correo. Intenta de nuevo con internet.' }; });
}
/** Lee el token del enlace de recuperación que llega en la URL (#access_token…). */
function leerEnlaceRecuperacion(){
  const h = (location.hash || '').replace(/^#/, '');
  if (!h || h.indexOf('access_token=') === -1) return null;
  const p = {};
  h.split('&').forEach(function(kv){
    const i = kv.indexOf('=');
    if (i > 0) p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
  });
  if (p.error_description) return { error: p.error_description };
  if (!p.access_token) return null;
  return { token: p.access_token };
}
function cambiarPassword(token, pass){
  return fetch(NUBE_AUTH + 'user', {
    method: 'PUT',
    headers: { 'apikey': NUBE.key, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pass })
  }).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ return { ok: r.ok, d: d }; }); })
    .then(function(res){
      if (!res.ok) return { ok: false, error: (res.d && (res.d.msg || res.d.message)) || 'No se pudo actualizar la contraseña.' };
      guardarSesion(null); // el enlace caduca: se vuelve a entrar con la nueva clave
      return { ok: true };
    })
    .catch(function(){ return { ok: false, error: 'Sin conexión: no se pudo actualizar la contraseña.' }; });
}
function cerrarSesion(){
  if (sesion.usuario && sesion.usuario.token){
    fetch(NUBE_AUTH + 'logout', { method: 'POST', headers: cabecerasNube() }).catch(function(){});
  }
  guardarSesion(null);
  clearTimeout(_progresoTemporizador);
  _progresoSubiendo = false;
  estado.nombrePerfil = 'Invitado';
  almacen.datos.nombrePerfil = estado.nombrePerfil; guardar();
  $('#repNombre').value = ''; $('#postNombre').value = '';
  aplicarIdentidad();
  ssyncPublicaciones(); ssyncReportes();
  toast('Sesión cerrada. Ahora participas como invitado.', 'info');
}
/* ---------- Llamadas a funciones de la base de datos (RPC) ----------
   Seguridad: los límites de seguridad viven en SQL, no aquí. Esta función
   solo traduce la respuesta para poder mostrar un mensaje claro. */
function rpcNube(nombre, cuerpo){
  return fetch(NUBE.url + 'rpc/' + nombre, {
    method: 'POST', headers: cabecerasNube(), body: JSON.stringify(cuerpo || {})
  }).then(function(r){
    return r.json().catch(function(){ return null; }).then(function(d){
      return { ok: r.ok, status: r.status, data: d, cruda: d };
    });
  }).catch(function(){
    return { ok: false, status: 0, data: null, cruda: null };
  });
}
/** Traduce el error de PostgREST a un mensaje que se pueda mostrar. */
function mensajeNube(r){
  const crudo = (r && r.cruda && (r.cruda.message || r.cruda.msg || r.cruda.error_description)) || '';
  const m = String(crudo);
  if (/ya registraste/i.test(m)) return 'ya';
  if (/límite|demasiad|frecuencia/i.test(m)) return 'Has publicado varias veces seguidas. Espera un momento e inténtalo de nuevo.';
  if (/no se pudo registrar el apoyo|inicia sesión/i.test(m)) return 'No se pudo registrar tu apoyo. Recarga la página e inténtalo otra vez.';
  if (!r || !r.status) return 'Sin conexión: tu apoyo se guardó solo en este dispositivo.';
  return 'No se pudo registrar tu apoyo.';
}
/* ---------- Cuántos intentos lleva un elemento local ----------
   Sin esto, un reporte que la nube rechaza (porque ya no existe, o
   porque se superó un límite) se volvía a subir en cada sincronización,
   para siempre: decenas de peticiones fallidas en cada carga. */
const MAX_INTENTOS_NUBE = 3;
function marcarIntento(x){
  x._intentos = (x._intentos || 0) + 1;
  return x._intentos;
}
function esperaDemasiado(x){ return (x._intentos || 0) >= MAX_INTENTOS_NUBE; }

/** Un aviso, no uno por elemento: el usuario no puede hacer nada con
    esta información y el toast solo se robaría la pantalla. */
let _ultimoAvisoSinSubir = 0;
function avisarSinSubir(lista){
  const atascados = lista.filter(esperaDemasiado);
  if (!atascados.length) return;
  const ahora = Date.now();
  if (ahora - _ultimoAvisoSinSubir < 300000) return;   // una vez cada 5 min
  _ultimoAvisoSinSubir = ahora;
  toast('⚠️ ' + atascados.length + ' contenido(s) se guardaron solo en este dispositivo porque la nube no los aceptó. Bórralos desde la app si ya no los necesitas.', 'alerta', 6000);
}

function upsertNube(tabla, obj){
  if (!estado._nube) return Promise.resolve(false);
  // _sinc/_nube/_intentos/ejemplo/votado son marcas locales: no viajan.
  const copia = Object.assign({}, obj);
  delete copia.ejemplo; delete copia.votado; delete copia._nube;
  delete copia._sinc; delete copia._intentos; delete copia._pendiente;
  // IMPORTANTE: el usuario_id se NORMALIZA siempre. Antes solo se
  // sobrescribía cuando había sesión, así que sin sesión se enviaba el
  // id de la cuenta con la que se creó en su día, la base de datos lo
  // rechazaba (no se puede reclamar la autoría de otra persona) y la
  // app lo reintentaba eternamente.
  copia.usuario_id = (sesion.usuario && sesion.usuario.id) || null;
  // Huella anónima del dispositivo: la base de datos la usa para poner
  // topes por persona y no depende de nada que se pueda falsear desde aquí.
  copia.huella = huellaDispositivo();
  const envio = fetch(NUBE.url + tabla, {
    method: 'POST',
    headers: cabecerasNube({ 'Prefer': 'resolution=merge-duplicates' }),
    body: JSON.stringify([copia])
  });
  return envio.then(function(r){
    return r.text().then(function(txt){
      // Token caducado: renovarlo con el refresh_token y reintentar una vez
      if (r.status === 401 && sesion.usuario && sesion.usuario.refresh){
        return restaurarSesion().then(function(){
          return fetch(NUBE.url + tabla, {
            method: 'POST',
            headers: cabecerasNube({ 'Prefer': 'resolution=merge-duplicates' }),
            body: JSON.stringify([copia])
          }).then(function(r2){ return r2.ok; });
        });
      }
      if (!r.ok && /l[ií]mite de frecuencia/i.test(txt)) avisarLimiteFrecuencia();
      return r.ok;
    });
  }).catch(function(){ return false; });
}
/* Aviso del tope de la base de datos. Solo se muestra una vez por minuto
   para no llenar la pantalla si alguien mantiene pulsado el botón. */
let _ultimoAvisoLimite = 0;
function avisarLimiteFrecuencia(){
  const ahora = Date.now();
  if (ahora - _ultimoAvisoLimite < 60000) return;
  _ultimoAvisoLimite = ahora;
  toast('Has enviado demasiadas cosas en poco tiempo. Espera un minuto antes de continuar.', 'alerta', 5200);
}
/* ---------- Fotografías en Supabase Storage ----------
   Antes la foto viajaba dentro de la fila (data URL) y cada visita descargaba
   megabytes. Ahora es un archivo real; si la subida falla, la app conserva la
   copia reducida en el dispositivo y marca el reporte como local. */
function dataUrlABlob(dataUrl){
  const bin = atob((dataUrl.split(',')[1] || ''));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'image/jpeg' });
}
function subirFotoReporte(reporte){
  const d = reporte.foto;
  if (!d || d.indexOf('data:') !== 0) return Promise.resolve(reporte.foto || null); // ya es URL
  const ruta = NUBE.bucketFotos + '/reportes/' + encodeURIComponent(reporte.id) + '.jpg';
  return fetch(NUBE.storage + ruta, {
    method: 'POST',
    headers: {
      'apikey': NUBE.key,
      'Authorization': 'Bearer ' + (sesion.usuario && sesion.usuario.token ? sesion.usuario.token : NUBE.key),
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true'
    },
    body: dataUrlABlob(d)
  }).then(function(r){
    return r.ok ? (NUBE.storage + 'public/' + ruta) : null;
  }).catch(function(){ return null; });
}
/* Mantiene el dispositivo ligero: como mucho MAX_LOCAL elementos ya subidos
   a la nube (donde siguen disponibles) más los ejemplos de la app. */
function podarLista(lista, esEjemplo){
  const ejemplos = lista.filter(esEjemplo);
  const reales = lista.filter(function(x){ return !esEjemplo(x); })
    .sort(function(a, b){ return b.ts - a.ts; })
    .slice(0, MAX_LOCAL);
  return ejemplos.concat(reales);
}
function actualizarBotonCuenta(){
  const b = $('#btnCuenta');
  if (!b) return;
  b.classList.toggle('activo', !!sesion.usuario);
  b.title = sesion.usuario ? 'Mi cuenta (' + sesion.usuario.nombre + ')' : 'Mi cuenta';
}
/** Nombre con el que se firman reportes, publicaciones y comentarios. */
function nombreFirma(){
  if (sesion.usuario && sesion.usuario.nombre) return sesion.usuario.nombre;
  const n = (estado.nombrePerfil || '').trim();
  return (n && n !== 'Invitado') ? n : 'Anónimo';
}
/** Nombre que se muestra en el perfil (invitado si no hay nada). */
function nombreMostrado(){
  if (sesion.usuario && sesion.usuario.nombre) return sesion.usuario.nombre;
  return (estado.nombrePerfil || '').trim() || 'Invitado';
}
/** Sincroniza la identidad con la interfaz (perfil, formularios, botones). */
function aplicarIdentidad(){
  if (sesion.usuario){ estado.nombrePerfil = sesion.usuario.nombre; almacen.datos.nombrePerfil = estado.nombrePerfil; guardar(); }
  const nombre = nombreMostrado();
  const txt = $('#perfilNombreTxt'); if (txt) txt.textContent = nombre;
  const av = $('#perfilAvatar'); if (av) av.textContent = iniciales(nombre);
  const etq = $('#perfilCuentaEtq');
  if (etq) etq.textContent = sesion.usuario ? 'Sesión activa · ' + sesion.usuario.email : 'Sin cuenta: participas como invitado y puedes crear una gratis.';
  const repIn = $('#repNombre'), postIn = $('#postNombre');
  if (sesion.usuario){
    // Con cuenta el nombre es fijo: no se puede publicar suplantando a nadie
    if (repIn){ repIn.value = nombreFirma(); repIn.readOnly = true; repIn.placeholder = 'Firmas como ' + nombreFirma(); }
    if (postIn){ postIn.value = nombreFirma(); postIn.readOnly = true; postIn.placeholder = 'Publicas como ' + nombreFirma(); }
  } else {
    if (repIn && repIn.readOnly){ repIn.value = ''; repIn.readOnly = false; repIn.placeholder = 'Puedes reportar como Anónimo'; }
    if (postIn && postIn.readOnly){ postIn.value = ''; postIn.readOnly = false; postIn.placeholder = 'Publica como Anónimo'; }
  }
  const ln = $('#cuentaNuevoNombre'); if (ln && sesion.usuario) ln.value = sesion.usuario.nombre;
  const bp = $('#btnAbrirCuentaPerfil');
  if (bp) bp.innerHTML = sesion.usuario ? '<svg class="icono"><use href="#i-usuario"/></svg>Mi cuenta' : '<svg class="icono"><use href="#i-estrella"/></svg>Crear cuenta / Iniciar sesión';
  actualizarBotonCuenta();
}
function nubeEstado(v){
  estado._nube = (v === 'ok');
  const e = $('#estadoNube');
  if (!e) return;
  if (v === 'ok'){ e.textContent = '☁️ Datos sincronizados en la nube'; e.className = 'chip'; }
  else if (v === 'conectando'){ e.textContent = '☁️ Conectando con la nube…'; e.className = 'chip gris'; }
  else { e.textContent = '💾 Datos guardados en este dispositivo (copia local)'; e.className = 'chip gris'; }
}
function mapearReporteNube(r){
  return { id: r.id, nombre: r.nombre, colonia: r.colonia, tipo: r.tipo, texto: r.texto,
    foto: r.foto || null, ubicacion: r.ubicacion || null,
    estado_sync: 'Sincronizado con la nube',                       // nota técnica del navegador
    estado: r.estado || 'recibido',                                // estado real del reporte
    oculto: !!r.oculto, ts: Number(r.ts), usuario_id: r.usuario_id || null };
}
/** Etiquetas del estado de seguimiento, con su color. */
const ESTADOS_REPORTE = {
  recibido:    { txt: 'Recibido',    chip: 'ambar'  },
  en_revision: { txt: 'En revisión', chip: ''       },
  atendido:    { txt: 'Atendido',    chip: 'verde'  }
};
function mapearPostNube(p){
  return { id: p.id, nombre: p.nombre, colonia: p.colonia, tipo: p.tipo, texto: p.texto,
    likes: p.likes || 0, votado: false, comentarios: [], ts: Number(p.ts), ejemplo: false, usuario_id: p.usuario_id || null };
}
/** Los comentarios ya no viajan dentro de la publicación: viven en su propia
    tabla y se piden aparte para todas las publicaciones de una vez. */
function adjuntarComentarios(posts){
  const ids = (posts || []).filter(function(p){ return !p.ejemplo; }).map(function(p){ return p.id; }).filter(Boolean);
  if (!ids.length) return Promise.resolve();
  return rpcNube('comentarios_de', { p_ids: ids }).then(function(r){
    if (!r.ok || !Array.isArray(r.data)) return;
    const porPost = {};
    r.data.forEach(function(c){
      (porPost[c.publicacion_id] = porPost[c.publicacion_id] || []).push({
        id: c.id,
        autor: c.autor || 'Anónimo',
        texto: c.texto || '',
        ts: Number(c.ts) || 0,
        propio: !!(sesion.usuario && c.usuario_id && c.usuario_id === sesion.usuario.id)
      });
    });
    (posts || []).forEach(function(p){ p.comentarios = porPost[p.id] || []; });
  });
}
/** Traduce el error de la base de datos al comentar. */
function mensajeComentario(r){
  const m = String((r && r.cruda && (r.cruda.message || r.cruda.msg)) || '');
  if (/suficientes comentarios|varios comentarios|ya tiene demasiados/i.test(m)) return 'Esta publicación ya tiene suficientes comentarios por ahora.';
  if (/vacío|existe/i.test(m)) return 'Ese comentario ya no se puede publicar.';
  if (!r || !r.status) return 'Sin conexión: el comentario se guardó solo en este dispositivo.';
  return 'No se pudo publicar tu comentario.';
}
function ssyncPublicaciones(){
  // Orden descendente: la nube trae lo MÁS RECIENTE. Con "asc" y límite 200,
  // al pasar de 200 publicaciones nadie volvía a ver las nuevas.
  return fetch(NUBE.url + 'publicaciones?select=*&order=ts.desc&limit=' + MAX_NUBE, { headers: cabecerasNube() })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(rows){
      const remotas = (rows || []).map(mapearPostNube).map(function(p){
        // Con sesión activa, lo mío siempre muestra el nombre actual de MI cuenta
        if (sesion.usuario && p.usuario_id === sesion.usuario.id) p.nombre = sesion.usuario.nombre;
        return p;
      });
      const vistos = {}; remotas.forEach(function(p){ vistos[p.id] = true; });
      // Solo se reintentan las que aún no se han podido subir (nada de
      // reenviar 150 publicaciones en cada visita), y como mucho
      // MAX_INTENTOS_NUBE veces: pasado ese punto se quedan solo aquí,
      // marcadas como copia local, en vez de golpear el servidor cada vez.
      // _pendiente lo pone la app al CREAR el contenido y se borra en
      // cuanto la nube lo acepta. Sin esta marca, todo lo que estuviera
      // en el dispositivo se volvía a subir en cada arranque: lo que un
      // vecino hubiera borrado en la nube reaparecía solo.
      const localesNuevas = publicaciones.filter(function(p){
        return !p.ejemplo && !vistos[p.id] && p._pendiente && !esperaDemasiado(p);
      });
      return Promise.all(localesNuevas.map(function(p){
        return upsertNube('publicaciones', p).then(function(ok){
          p._sinc = ok;
          if (ok) p._pendiente = false;
          else marcarIntento(p);
        });
      })).then(function(){
        avisarSinSubir(publicaciones);
        return remotas.concat(localesNuevas);
      });
    })
    .then(function(todas){
      return adjuntarComentarios(todas).then(function(){ return todas; });
    })
    .then(function(todas){
      if (todas.length){
        const ids = {}; todas.forEach(function(p){ ids[p.id] = true; });
        publicaciones.forEach(function(p){ if (!p.ejemplo && !ids[p.id]) todas.push(p); }); // seguridad ante cargas en curso
        publicaciones = podarLista(todas, function(p){ return !!p.ejemplo; });
        estado.publicaciones = publicaciones;
        almacen.datos.publicaciones = publicaciones; guardar();
      }
      nubeCargadaPost = true; renderMuro();
    })
    .catch(function(){ nubeCargadaPost = false; });
}
function ssyncReportes(){
  return fetch(NUBE.url + 'reportes?select=*&order=ts.desc&limit=' + MAX_NUBE, { headers: cabecerasNube() })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(rows){
      const remotas = (rows || []).map(mapearReporteNube).map(function(x){
        if (sesion.usuario && x.usuario_id === sesion.usuario.id) x.nombre = sesion.usuario.nombre;
        return x;
      }).filter(function(x){ return estado.eliminadosRep.indexOf(x.id) === -1; });
      const vistos = {}; remotas.forEach(function(x){ vistos[x.id] = true; });
      const localesNuevas = reportesLocales.filter(function(x){
        return !vistos[x.id] && x._pendiente && !esperaDemasiado(x);
      });
      return Promise.all(localesNuevas.map(function(x){
        return upsertNube('reportes', x).then(function(ok){
          x._sinc = ok;
          if (ok){ x._pendiente = false; x.estado_sync = 'Sincronizado con la nube'; }
          else { x.estado_sync = 'Registrado localmente (copia local)'; marcarIntento(x); }
        });
      }))
        .then(function(){
          avisarSinSubir(reportesLocales);
          return remotas.concat(localesNuevas);
        });
    })
    .then(function(todas){
      reportesLocales = podarLista(todas, function(){ return false; });
      estado.reportes = reportesLocales;
      almacen.datos.reportes = reportesLocales; guardar();
      nubeCargadaRep = true; renderReportes();
    })
    .catch(function(){ nubeCargadaRep = false; });
}
/* Antes, cada comentario reenviaba la publicación entera a la nube. Ahora
   los comentarios viven en su propia tabla (ver crear_comentario) y aquí solo
   se guarda la copia local. */
function guardarPublicacionesLocales(){
  almacen.datos.publicaciones = publicaciones; guardar();
}
function initNube(){
  nubeEstado('conectando');
  restaurarSesion().then(function(){
    actualizarBotonCuenta();
    comprobarAdmin();
    return fetch(NUBE.url + 'publicaciones?select=id&limit=1', { headers: cabecerasNube() });
  }).then(function(r){
    if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 0));
    nubeEstado('ok');
    return Promise.all([ssyncPublicaciones(), ssyncReportes(), cargarProgresoNube()]);
  }).catch(function(){ nubeEstado('sin'); });
}

/* ============================================================
   MÓDULO 4 · TOASTS
   ============================================================ */
const cToasts = $('#toasts');
const ICONO_TOAST = { info:'💚', exito:'✅', error:'⚠️', alerta:'🔔', logro:'🏅' };
function toast(msg, tipo, ms){
  tipo = tipo || 'info'; ms = ms || 4200;
  while (cToasts.children.length >= 4) cToasts.removeChild(cToasts.firstChild);
  const el = document.createElement('div');
  el.className = 'toast ' + tipo;
  const ic = document.createElement('span'); ic.className = 't-icono'; ic.textContent = ICONO_TOAST[tipo] || '💚';
  const tx = document.createElement('div'); tx.className = 't-texto'; tx.textContent = msg;
  const bt = document.createElement('button'); bt.type = 'button'; bt.className = 't-cerrar'; bt.setAttribute('aria-label','Cerrar notificación'); bt.textContent = '✕';
  bt.addEventListener('click', function(){ cerrarToast(el); });
  el.append(ic, tx, bt);
  cToasts.appendChild(el);
  el._t = setTimeout(function(){ cerrarToast(el); }, ms);
}
function cerrarToast(el){
  if (!el || el._c) return;
  el._c = true; clearTimeout(el._t);
  el.classList.add('salida');
  setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 300);
}

/* ============================================================
   MÓDULO 5 · MODALES
   ============================================================ */
let focoPrevio = null;
function abrirModal(id){
  const ov = $('#' + id);
  if (!ov) return;
  focoPrevio = document.activeElement;
  ov.classList.add('abierto');
  document.body.style.overflow = 'hidden';
  const f = $$('button, input, select, textarea, a[href]', ov).filter(function(e){ return !e.disabled && e.offsetParent !== null; });
  if (f.length) f[0].focus();
}
function cerrarModal(id){
  const ov = typeof id === 'string' ? $('#' + id) : id;
  if (!ov || !ov.classList.contains('abierto')) return;
  ov.classList.remove('abierto');
  if (!$('.modal-overlay.abierto')) document.body.style.overflow = '';
  if (focoPrevio && focoPrevio.focus) focoPrevio.focus();
}
$$('.modal-overlay').forEach(function(ov){
  ov.addEventListener('click', function(e){ if (e.target === ov) cerrarModal(ov); });
  ov.addEventListener('keydown', function(e){
    if (e.key !== 'Tab') return;
    const f = $$('button, input, select, textarea, a[href]', ov).filter(function(el){ return !el.disabled && el.offsetParent !== null; });
    if (!f.length) return;
    const p = f[0], u = f[f.length - 1];
    if (e.shiftKey && document.activeElement === p){ e.preventDefault(); u.focus(); }
    else if (!e.shiftKey && document.activeElement === u){ e.preventDefault(); p.focus(); }
  });
});
$$('[data-cerrar]').forEach(function(b){ b.addEventListener('click', function(){ cerrarModal(b.closest('.modal-overlay')); }); });
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape'){ const a = $('.modal-overlay.abierto'); if (a) cerrarModal(a); }
});
function mostrarInfo(titulo, parrafos){
  $('#tInfo').textContent = titulo;
  const cont = $('#infoContenido');
  cont.innerHTML = '';
  parrafos.forEach(function(p){
    const el = document.createElement('p');
    el.innerHTML = p; // contenido propio de la app (no ingresado por usuarios)
    cont.appendChild(el);
  });
  abrirModal('modalInfo');
}
let resolverConfirm = null;
function confirmarAccion(titulo, texto, textoBoton){
  $('#tConfirmar').textContent = titulo;
  $('#txtConfirmar').textContent = texto;
  $('#btnConfirmarSi').textContent = textoBoton || 'Sí, continuar';
  abrirModal('modalConfirmar');
  return new Promise(function(res){ resolverConfirm = res; });
}
$('#btnConfirmarSi').addEventListener('click', function(){
  cerrarModal('modalConfirmar');
  if (resolverConfirm){ resolverConfirm(true); resolverConfirm = null; }
});
$$('#modalConfirmar [data-cerrar]').forEach(function(b){
  b.addEventListener('click', function(){ if (resolverConfirm){ resolverConfirm(false); resolverConfirm = null; } });
});
$('#modalConfirmar').addEventListener('click', function(e){
  if (e.target === this && resolverConfirm){ resolverConfirm(false); resolverConfirm = null; }
});

/* ============================================================
   MÓDULO 6 · NAVEGACIÓN SPA
   ============================================================ */
const VISTAS = ['inicio','mapa','guia','reportes','comunidad','perfil','moderacion'];
function irA(v){
  if (VISTAS.indexOf(v) === -1) return;
  if (v === 'moderacion' && !estado._admin){ toast('Esta sección es solo para cuentas administradoras del proyecto.', 'error'); return; }
  estado.vista = v;
  VISTAS.forEach(function(x){
    const vista = $('#view-' + x);
    if (vista) vista.classList.toggle('activa', x === v);
  });
  $$('[data-nav]').forEach(function(b){
    if (b.getAttribute('data-nav') === v) b.setAttribute('aria-current','true');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: REDUCIR.matches ? 'auto' : 'smooth' });
  if (v === 'mapa' && mapa){
    setTimeout(function(){
      mapa.invalidateSize();
      // Si la red urbana ya está lista, encuadrar toda la ciudad (una sola vez)
      if (redPuntos.length) ajustarVistaRedCiudad();
    }, 80);
    // La red de toda la ciudad se pide al abrir el mapa por primera vez
    // (una sola consulta), no al arrancar la app.
    setTimeout(function(){ cargarRedCiudad(false); }, 2000);
  }
  if (v === 'perfil') renderPerfil();
}
$$('[data-nav]').forEach(function(b){ b.addEventListener('click', function(){ irA(b.getAttribute('data-nav')); }); });

/* ============================================================
   MÓDULO 7 · TEMA
   ============================================================ */
function aplicarTema(t){
  if (t === 'dark') document.documentElement.setAttribute('data-theme','dark');
  else document.documentElement.removeAttribute('data-theme');
  estado.tema = t;
  const chk = $('#cfgTema'); if (chk) chk.checked = t === 'dark';
  const meta = $('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', t === 'dark' ? '#0D1410' : '#2E7D32');
}
$('#cfgTema').addEventListener('change', function(){
  aplicarTema(this.checked ? 'dark' : 'light');
  almacen.datos.tema = estado.tema; guardar();
  toast(estado.tema === 'dark' ? '🌙 Tema oscuro activado.' : '☀️ Tema claro activado.', 'info', 2400);
});

/* ============================================================
   MÓDULO 8 · GAMIFICACIÓN (puntos, niveles, insignias)
   ============================================================ */
const NIVELES = [
  { min: 0,    nombre: 'Vecino consciente' },
  { min: 100,  nombre: 'Cuidador' },
  { min: 220,  nombre: 'Ecoactivo' },
  { min: 360,  nombre: 'Participante' },
  { min: 520,  nombre: 'Guardián verde' },
  { min: 700,  nombre: 'Colaborador' },
  { min: 900,  nombre: 'Líder comunitario' },
  { min: 1150, nombre: 'Impulsor ambiental' },
  { min: 1450, nombre: 'Defensor del entorno' },
  { min: 1800, nombre: 'Embajador de la comunidad' }
];
const PTS = { accion: 10, reporte: 20, participacion: 30, ayuda: 5 };

function nivelDe(puntos){
  let i = 0;
  while (i + 1 < NIVELES.length && puntos >= NIVELES[i + 1].min) i++;
  if (puntos >= NIVELES[NIVELES.length - 1].min){
    // Progresión ilimitada: cada 500 puntos adicionales sube "Nivel X+" con el nombre máximo
    const extra = Math.floor((puntos - NIVELES[NIVELES.length - 1].min) / 500);
    const min = NIVELES[NIVELES.length - 1].min + extra * 500;
    const sig = min + 500;
    return { nivel: NIVELES.length + extra, nombre: NIVELES[NIVELES.length - 1].nombre + ' ★', min: min, sig: sig };
  }
  return { nivel: i + 1, nombre: NIVELES[i].nombre, min: NIVELES[i].min, sig: i + 1 < NIVELES.length ? NIVELES[i + 1].min : NIVELES[i].min + 500 };
}

const INSIGNIAS = [
  { id: 'primera',   icono: '🌱', nombre: 'Primera acción',       desc: 'Registra tu 1ª acción ecológica', cond: e => e.acciones.length >= 1 },
  { id: 'explorador',icono: '📍', nombre: 'Explorador de rutas',  desc: 'Usa tu ubicación o elige un punto', cond: e => !!e.usoUbicacion },
  { id: 'separador', icono: '♻️', nombre: 'Separador responsable',desc: '3 días distintos separando', cond: e => e.diasAccion.length >= 3 },
  { id: 'voz',       icono: '📢', nombre: 'Voz ciudadana',        desc: 'Envía tu primer reporte', cond: e => e.numReportes >= 1 },
  { id: 'participar',icono: '🤝', nombre: 'Participación',        desc: 'Publica o comenta en la comunidad', cond: e => e.numPublicaciones >= 1 },
  { id: 'reportero', icono: '📸', nombre: 'Reportero ambiental',  desc: 'Reporte con fotografía', cond: e => e.reporteConFoto },
  { id: 'ruta',      icono: '🚛', nombre: 'Conoce tu ruta',       desc: 'Consulta la ruta de tu colonia', cond: e => !!e.consultaRuta },
  { id: 'guardia',   icono: '🏆', nombre: 'Guardián verde',       desc: 'Alcanza el nivel 5', cond: e => nivelDe(e.puntos).nivel >= 5 }
];

function registrarAccion(tipo, texto, puntosGanados){
  estado.acciones.unshift({ ts: Date.now(), tipo: tipo, texto: texto });
  if (estado.acciones.length > 40) estado.acciones.length = 40;
  almacen.datos.acciones = estado.acciones;
  addPoints(puntosGanados, texto);
}
function addPoints(cantidad, motivo){
  const antes = nivelDe(estado.puntos).nivel;
  estado.puntos += cantidad;
  almacen.datos.puntos = estado.puntos;
  guardar();
  // La nube es un espejo opcional: el progreso vive igual sin conexión
  // y sin cuenta, y solo se sube cuando hay sesión.
  sincronizarProgresoNube();
  toast('+' + cantidad + ' puntos · ' + motivo, 'exito', 3000);
  actualizarHeaderNivel();
  const despues = nivelDe(estado.puntos);
  if (despues.nivel > antes){
    lanzarConfeti();
    toast('🎉 ¡Subiste al Nivel ' + despues.nivel + ' — ' + despues.nombre + '!', 'logro', 5500);
  }
  verificarInsignias();
}

/* ============================================================
   PROGRESO EN LA NUBE (P4.18)
   ------------------------------------------------------------
   Principio: localStorage manda. La nube es un espejo opcional y
   NUNCA hace retroceder un progreso:
     · sin sesión o sin conexión → no pasa nada, todo igual que antes;
     · al iniciar sesión se sube lo local y se baja lo que hubiera en
       la nube, quedándose con la mejor de las dos versiones;
     · cada subida va con retraso para no llamar al servidor en cada
       pulsación.
   ============================================================ */
let _progresoTemporizador = null;
let _progresoSubiendo = false;
function hoyISO(){
  const d = new Date();
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
function sincronizarProgresoNube(){
  if (!estado._nube || !sesion.usuario) return;
  clearTimeout(_progresoTemporizador);
  _progresoTemporizador = setTimeout(function(){ subirProgreso(); }, 1200);
}
function subirProgreso(){
  if (_progresoSubiendo || !sesion.usuario || !estado._nube) return;
  _progresoSubiendo = true;
  rpcNube('guardar_progreso', {
    p_puntos: estado.puntos,
    p_insignias: estado.insignias,
    p_dias_accion: estado.diasAccion
  }).then(function(r){
    _progresoSubiendo = false;
    if (r.ok && r.data){
      aplicarProgresoRemoto(r.data);
    }
  }).catch(function(){ _progresoSubiendo = false; });
}
/** Combina lo local y lo de la nube quedándose siempre con lo más alto. */
function aplicarProgresoRemoto(fila){
  if (!fila) return;
  const remoto = Number(fila.puntos) || 0;
  const subio = remoto > estado.puntos;
  const antes = nivelDe(estado.puntos).nivel;
  estado.puntos = Math.max(estado.puntos, remoto);
  estado.insignias = Array.from(new Set((estado.insignias || []).concat(fila.insignias || [])));
  estado.diasAccion = Array.from(new Set((estado.diasAccion || []).concat(fila.dias_accion || [])));
  almacen.datos.puntos = estado.puntos;
  almacen.datos.insignias = estado.insignias;
  almacen.datos.diasAccion = estado.diasAccion;
  guardar();
  if (subio){
    toast('☁️ Progreso recuperado de tu cuenta: ' + estado.puntos + ' puntos.', 'info', 4200);
    renderInsignias();
  }
  if (nivelDe(estado.puntos).nivel > antes){
    lanzarConfeti();
    toast('🎉 ¡Subiste al Nivel ' + nivelDe(estado.puntos).nivel + '!', 'logro', 5000);
  }
  renderPerfil(); actualizarHeaderNivel();
}
/** Se llama al entrar con sesión: baja lo que hubiera en la nube. */
function cargarProgresoNube(){
  if (!estado._nube || !sesion.usuario) return Promise.resolve();
  return rpcNube('mi_progreso', {}).then(function(r){
    if (r.ok && r.data) aplicarProgresoRemoto(r.data);
  }).catch(function(){});
}
function marcarIndicadores(hash){
  estado._indicadores = estado._indicadores || {};
  Object.assign(estado._indicadores, hash);
}
function verificarInsignias(){
  const ctx = {
    puntos: estado.puntos,
    acciones: estado.acciones,
    diasAccion: estado.diasAccion,
    numReportes: (estado.reportes || []).length,
    numPublicaciones: contarPublicacionesPropias(),
    reporteConFoto: (estado.reportes || []).some(function(r){ return !!r.foto; }),
    usoUbicacion: estado._usoUbicacion || false,
    consultaRuta: estado._consultaRuta || false
  };
  INSIGNIAS.forEach(function(ins){
    if (estado.insignias.indexOf(ins.id) === -1 && ins.cond(ctx)){
      estado.insignias.push(ins.id);
      almacen.datos.insignias = estado.insignias;
      guardar();
      sincronizarProgresoNube();
      lanzarConfeti();
      toast('🏅 Insignia desbloqueada: ' + ins.icono + ' ' + ins.nombre, 'logro', 5200);
      renderInsignias(ins.id);
    }
  });
  actualizarHeaderNivel();
}
function contarPublicacionesPropias(){
  return (estado.publicaciones || []).filter(function(p){ return !p.ejemplo; }).length;
}
function actualizarHeaderNivel(){
  const n = nivelDe(estado.puntos);
  $('#headerNivel').textContent = 'Nivel ' + n.nivel;
}
function renderInsignias(recien){
  const grid = $('#insigniasGrid');
  grid.innerHTML = '';
  INSIGNIAS.forEach(function(ins){
    const desbloq = estado.insignias.indexOf(ins.id) !== -1;
    const el = document.createElement('div');
    el.className = 'insignia' + (desbloq ? ' desbloqueada' : '') + (ins.id === recien ? ' recien' : '');
    const ic = document.createElement('span'); ic.className = 'ins-icono'; ic.textContent = ins.icono;
    const st = document.createElement('strong'); st.textContent = ins.nombre;
    const sm = document.createElement('small'); sm.textContent = desbloq ? 'Desbloqueada' : ins.desc;
    el.append(ic, st, sm);
    grid.appendChild(el);
  });
  $('#statInsignias').textContent = estado.insignias.length + '/' + INSIGNIAS.length;
}
function renderPerfil(){
  const n = nivelDe(estado.puntos);
  $('#perfilNombreTxt').textContent = nombreMostrado();
  $('#perfilAvatar').textContent = iniciales(nombreMostrado());
  const nombresCol = { centro:'Centro', floresta:'La Floresta', villas:'Villas del Padre', estanzuela:'La Estanzuela', agustin:'El Agustín', rafael:'San Rafael' };
  $('#perfilColoniaTxt').textContent = (nombresCol[estado.coloniaId] || 'Ciudad Guzmán') + ' · Ciudad Guzmán';
  $('#perfilNivelNum').textContent = 'Nivel ' + n.nivel + ' · ' + n.nombre;
  $('#perfilPuntosTxt').textContent = estado.puntos;
  const rango = n.sig - n.min;
  const avanzado = Math.min(100, Math.round(((estado.puntos - n.min) / rango) * 100));
  $('#perfilSiguienteTxt').textContent = estado.puntos + ' / ' + n.sig + ' puntos';
  $('#barraProgreso').setAttribute('aria-valuenow', avanzado);
  $('#barraProgresoFill').style.width = avanzado + '%';
  $('#progresoNivelTxt').textContent = 'Nivel ' + n.nivel;
  $('#progresoFaltaTxt').textContent = 'Faltan ' + Math.max(0, n.sig - estado.puntos) + ' puntos para el nivel ' + (n.nivel + 1);
  $('#statReportes').textContent = (estado.reportes || []).length;
  $('#statParticipaciones').textContent = contarPublicacionesPropias() + (estado._numComentarios || 0);
  $('#statAcciones').textContent = estado.acciones.length;
  renderInsignias();
  const lista = $('#logrosLista');
  lista.innerHTML = '';
  if (!estado.acciones.length){
    const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.85rem';
    p.textContent = 'Tus acciones aparecerán aquí.';
    lista.appendChild(p);
  } else {
    estado.acciones.slice(0, 8).forEach(function(a){
      const fila = document.createElement('div'); fila.className = 'logro-item';
      const ic = document.createElement('span'); const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('class','icono'); const use = document.createElementNS('http://www.w3.org/2000/svg','use');
      use.setAttribute('href', a.tipo === 'reporte' ? '#i-altavoz' : a.tipo === 'participacion' ? '#i-usuarios' : a.tipo === 'ruta' ? '#i-mapa' : '#i-hoja');
      svg.appendChild(use); ic.appendChild(svg);
      const tx = document.createElement('span'); tx.textContent = a.texto;
      const ft = document.createElement('small'); ft.textContent = tiempoRelativo(a.ts);
      fila.append(ic, tx, ft);
      lista.appendChild(fila);
    });
  }
}

/* ============================================================
   MÓDULO 9 · CONFETI
   ============================================================ */
const cConf = $('#confetti');
const ctxConf = cConf.getContext ? cConf.getContext('2d') : null;
let confetiPart = [], confetiActivo = false;
function ajustarCanvas(){ if (!ctxConf) return; cConf.width = document.documentElement.clientWidth; cConf.height = document.documentElement.clientHeight; }
window.addEventListener('resize', ajustarCanvas); ajustarCanvas();
function lanzarConfeti(){
  if (!ctxConf || REDUCIR.matches) return;
  const colores = ['#2E7D32','#81C784','#A5D6A7','#FF9800','#2196F3','#FFD54F'];
  confetiPart = [];
  for (let i = 0; i < 100; i++){
    confetiPart.push({
      x: cConf.width / 2 + (Math.random() - .5) * 200,
      y: cConf.height * .3,
      vx: (Math.random() - .5) * 9, vy: -(Math.random() * 9 + 5), g: .22,
      t: Math.random() * 7 + 4, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
      c: colores[Math.floor(Math.random() * colores.length)]
    });
  }
  if (!confetiActivo){ confetiActivo = true; requestAnimationFrame(pasoConfeti); }
}
function pasoConfeti(){
  const H = cConf.height;
  ctxConf.clearRect(0, 0, cConf.width, H);
  let vivos = 0;
  confetiPart.forEach(function(p){
    p.vy += p.g; p.x += p.vx; p.y += p.vy; p.r += p.vr;
    if (p.y < H + 30) vivos++;
    ctxConf.save(); ctxConf.translate(p.x, p.y); ctxConf.rotate(p.r);
    ctxConf.fillStyle = p.c; ctxConf.fillRect(-p.t/2, -p.t/2, p.t, p.t * .6);
    ctxConf.restore();
  });
  if (vivos > 0) requestAnimationFrame(pasoConfeti);
  else { confetiActivo = false; ctxConf.clearRect(0, 0, cConf.width, cConf.height); }
}

/* ============================================================
   MÓDULO 10 · ZONAS DE CIUDAD GUZMÁN
   ------------------------------------------------------------
   Delimitaciones APROXIMADAS generadas por el sistema para
   poder agrupar vialidades por colonia. No son límites oficiales.
   ============================================================ */
const ZONAS = {
  centro:     { nombre: 'Centro',            poly: [[19.7085,-103.4740],[19.7085,-103.4590],[19.6975,-103.4590],[19.6975,-103.4740]], tags: ['primary','secondary','residential'] },
  floresta:   { nombre: 'La Floresta',       poly: [[19.7160,-103.4780],[19.7160,-103.4640],[19.7070,-103.4640],[19.7070,-103.4780]], tags: ['secondary','residential','tertiary'] },
  villas:     { nombre: 'Villas del Padre',  poly: [[19.6965,-103.4670],[19.6965,-103.4550],[19.6880,-103.4550],[19.6880,-103.4670]], tags: ['residential','secondary','tertiary'] },
  estanzuela: { nombre: 'La Estanzuela',     poly: [[19.6935,-103.4830],[19.6935,-103.4680],[19.6845,-103.4680],[19.6845,-103.4830]], tags: ['residential','secondary','tertiary'] },
  agustin:    { nombre: 'El Agustín',        poly: [[19.7245,-103.4700],[19.7245,-103.4560],[19.7140,-103.4560],[19.7140,-103.4700]], tags: ['primary','secondary','residential'] },
  rafael:     { nombre: 'San Rafael',        poly: [[19.7030,-103.4585],[19.7030,-103.4460],[19.6930,-103.4460],[19.6930,-103.4585]], tags: ['residential','tertiary','secondary'] }
};
const CENTRO_CIUZ = [19.7020, -103.4640];
const INTERVALO_PUNTOS = 400; // metros entre puntos de recolección (configurable)

/* ============================================================
   MÓDULO 10 · CATÁLOGO DE COLONIAS DE CIUDAD GUZMÁN
   ------------------------------------------------------------
   Los 77 nombres que entregó el equipo del proyecto. Sirven para
   elegir colonia al reportar y para que Eco sepa de qué colonia
   se está hablando. NO son delimitaciones: solo las 6 de ZONAS
   (arriba) tienen polígono y ruta; el resto son nombres sueltos.

   La lista llegó de un documento con dos formatos que hubo que
   separar: "El Pastor / Colinas del Sur" eran dos colonias
   pegadas, y el paréntesis era un alias oficial
   ("Fovissste (José Clemente Orozco)"). Aquí se queda el nombre
   corto; los alias van anotados en DOCUMENTACION.md §5.7b.

   Ubicación en el mapa: las 6 de ZONAS (arriba) tienen polígono y
   ruta. Para el resto, UBICACION_COLONIAS (abajo) trae puntos de
   OpenStreetMap verificados dentro de la ciudad (parques, deportivos
   y edificios con el nombre de la colonia) y sugerencias por calle
   con el mismo nombre, que SOLO se dibujan si el equipo confirma el
   punto tocando el mapa. Nada se inventa: cada punto dice su fuente.
   ============================================================ */
const COLONIAS = [
  '1 de Mayo', '1ro de Agosto', '5 de Febrero', '16 de Septiembre', 'Álamo', 'Azaleas',
  'Benefactores', 'C.N.O.P.CTM', 'Campamento Ferrocarrilero', 'Cañadas', 'Centro', 'Chuluapan',
  'Colinas del Sur', 'Compositores', 'Conjunto Calderón', 'Conjunto Hidalgo',
  'Conjunto Modernidad', 'Cumbres Residencial', 'El Jazmín', 'El Nogal', 'El Pastor',
  'El Portón Azul', 'El Retiro', 'El Tinaco', 'Emiliano Zapata', 'Empleados Municipales',
  'Escritores', 'Esquipulas', 'Fovissste', 'Francisco I. Madero',
  'Francisco Villalvazo Rolón', 'Gante', 'Gordiano Guzmán', 'Hijos Ilustres', 'Insurgentes',
  'Jardines de Zapotlán', 'Jesús Reyes Heroles', 'Juan Rulfo', 'La Cantera San José',
  'La Cebada', 'La Nueva Luz', 'La Paz', 'Las Américas', 'Las Lomas', 'Lázaro Cárdenas',
  'Lic. A. Gándara Estrada', 'Loma Bonita', 'Lomas de San Cayetano', 'Los Bomberos',
  'Los Camichines', 'Los Doctores', 'Los Olivos', 'Mansiones del Real', 'Mariano Otero',
  'Miguel Hidalgo II', 'Morelos', 'Pablo Luis Juan', 'Paseos del Real', 'Pintores',
  'Rancho Quemado', 'Revolución', 'Rinconada Hidalgo', 'San Antonio', 'San Cayetano',
  'San José', 'Santa Cecilia', 'Senderos San Miguel', 'Teocali', 'Tlayolan',
  'Unión de Colonos Independencia', 'Unión de Colonos Organizados de Cd. Guzmán',
  'Universitaria', 'Valle de Zapotlán', 'Valle del Sol', 'Villa Norte', 'Villas de Calderón',
  'Villas de San Isidro'
];

/** Ubicaciones de colonias sin polígono. Generadas por
    tools/ubicar-colonias.js (Nominatim, validadas dentro del límite
    urbano). Tercer campo: 'lugar' = parque/deportivo/edificio con el
    nombre de la colonia (se dibuja como punto aproximado);
    'calle' = solo existe una calle con ese nombre (NO se dibuja como
    colonia; sirve de sugerencia al colocarlas a mano). */
const UBICACION_COLONIAS = [
  ["Compositores", [19.717963, -103.468408], "lugar"],
  ["El Nogal", [19.696011, -103.455397], "lugar"],
  ["Emiliano Zapata", [19.688576, -103.476077], "lugar"],
  ["Escritores", [19.688785, -103.458114], "lugar"],
  ["Francisco I. Madero", [19.692391, -103.46972], "lugar"],
  ["Gordiano Guzmán", [19.726123, -103.456806], "lugar"],
  ["Jesús Reyes Heroles", [19.688671, -103.466158], "lugar"],
  ["La Paz", [19.685214, -103.469164], "lugar"],
  ["Loma Bonita", [19.710249, -103.460061], "lugar"],
  ["Pablo Luis Juan", [19.700765, -103.477279], "lugar"],
  ["Revolución", [19.70487, -103.478977], "lugar"],
  ["San José", [19.691039, -103.463376], "lugar"],
  ["Tlayolan", [19.677882, -103.472882], "lugar"],
  ["5 de Febrero", [19.705296, -103.475129], "calle"],
  ["16 de Septiembre", [19.7049, -103.474893], "calle"],
  ["Álamo", [19.693163, -103.455965], "calle"],
  ["Colinas del Sur", [19.680069, -103.46904], "calle"],
  ["Esquipulas", [19.716418, -103.466564], "calle"],
  ["Gante", [19.719874, -103.472035], "calle"],
  ["Insurgentes", [19.707984, -103.470761], "calle"],
  ["Juan Rulfo", [19.678497, -103.470426], "calle"],
  ["Las Lomas", [19.706602, -103.455315], "calle"],
  ["Lázaro Cárdenas", [19.703856, -103.459279], "calle"],
  ["Los Camichines", [19.695193, -103.454642], "calle"],
  ["Mariano Otero", [19.675142, -103.469851], "calle"],
  ["Morelos", [19.721478, -103.464989], "calle"],
  ["Rancho Quemado", [19.731065, -103.461217], "calle"],
  ["San Antonio", [19.684802, -103.479612], "calle"],
  ["Santa Cecilia", [19.720923, -103.465676], "calle"],
  ["Valle de Zapotlán", [19.688794, -103.484695], "calle"],
  ["Valle del Sol", [19.706279, -103.470987], "calle"]
];

/** Las colonias del catálogo agrupadas para el desplegable de reportes:
    primero las que sí tienen ruta en el mapa, después el resto.
    'Centro' está en los dos sitios (ZONAS y catálogo) y se muestra
    una sola vez, en el grupo con ruta. */
function opcionesColonias(){
  const conRuta = Object.keys(ZONAS).map(function(k){ return ZONAS[k].nombre; });
  const resto = COLONIAS.filter(function(n){ return conRuta.indexOf(n) === -1; });
  return [
    { etiqueta: 'Con ruta en el mapa (' + conRuta.length + ')', nombres: conRuta },
    { etiqueta: 'Resto de colonias de Ciudad Guzmán (' + resto.length + ')', nombres: resto }
  ];
}

/** Llena #repColonia. Las opciones que trae el HTML se quedan como
    respaldo si el script no carga; aquí se sustituyen por el catálogo. */
function pintarSelectColonias(){
  const sel = $('#repColonia');
  if (!sel) return;
  sel.textContent = '';
  opcionesColonias().forEach(function(grupo){
    const grp = document.createElement('optgroup');
    grp.label = grupo.etiqueta;
    grupo.nombres.forEach(function(nombre){
      const o = document.createElement('option');
      o.value = nombre; o.textContent = nombre;
      grp.appendChild(o);
    });
    sel.appendChild(grp);
  });
  const otra = document.createElement('option');
  otra.value = 'Otra';
  otra.textContent = 'Otra (no aparece en la lista)';
  sel.appendChild(otra);
  // Preselección: la colonia guardada en el perfil, o Centro como antes.
  const guardada = (ZONAS[estado.coloniaId] || {}).nombre || 'Centro';
  sel.value = guardada;
  if (sel.value !== guardada) sel.value = 'Centro';
}

function puntoDentro(p, poly){
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const xi = poly[i][1], yi = poly[i][0], xj = poly[j][1], yj = poly[j][0];
    if (((yi > p.lat) !== (yj > p.lat)) && (p.lng < (xj - xi) * (p.lat - yi) / (yj - yi) + xi)) dentro = !dentro;
  }
  return dentro;
}

/* ============================================================
   MÓDULO 11 · SERVICIOS EXTERNOS (Overpass + OSRM + Nominatim)
   ============================================================ */
function fetchConTimeout(url, ms){
  const ctrl = new AbortController();
  const t = setTimeout(function(){ ctrl.abort(); }, ms || 15000);
  return fetch(url, { signal: ctrl.signal }).finally(function(){ clearTimeout(t); });
}

async function osrmRuta(puntos){
  // puntos: [{lat,lng},...] → ruta por calles reales
  const coords = puntos.map(function(p){ return p.lng.toFixed(6) + ',' + p.lat.toFixed(6); }).join(';');
  const url = 'https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson';
  const r = await fetchConTimeout(url, 15000);
  if (!r.ok) throw new Error('OSRM no respondió');
  const j = await r.json();
  if (!j.routes || !j.routes.length) throw new Error('OSRM sin ruta');
  const ruta = j.routes[0];
  return {
    geometria: ruta.geometry.coordinates.map(function(c){ return { lat: c[1], lng: c[0] }; }),
    distanciaM: ruta.distance,
    duracionS: ruta.duration
  };
}

function polilineaAPuntos(way){
  return (way.geometry || []).map(function(g){ return { lat: g.lat, lng: (g.lng !== undefined ? g.lng : g.lon) }; });
}

// Espejos públicos de Overpass: si uno falla se intenta el siguiente.
const SERVIDORES_OVERPASS = [
  'https://overpass-api.de/api/interpreter?data=',
  'https://overpass.kumi.systems/api/interpreter?data=',
  'https://overpass.private.coffee/api/interpreter?data='
];
// Copia local de vialidades OSM por zona: permite seguir mostrando la ruta
// aunque Overpass falle temporalmente. Solo contiene datos reales de OSM.
const CLAVE_CACHE_OSM = 'bym.osm.v1';
function leerCacheOSM(){
  try { return JSON.parse(localStorage.getItem(CLAVE_CACHE_OSM)) || {}; } catch(e){ return {}; }
}
function guardarCacheOSM(zonaId, ways){
  try {
    const c = leerCacheOSM(); c[zonaId] = ways; localStorage.setItem(CLAVE_CACHE_OSM, JSON.stringify(c));
  } catch(e){ /* sin espacio: la caché es opcional */ }
}

async function overpassVialidades(zona, zonaId){
  const lats = zona.poly.map(function(p){ return p[0]; });
  const lngs = zona.poly.map(function(p){ return p[1]; });
  const bbox = Math.min.apply(null, lats) + ',' + Math.min.apply(null, lngs) + ',' + Math.max.apply(null, lats) + ',' + Math.max.apply(null, lngs);
  const q = '[out:json][timeout:25];way["highway"~"^(' + zona.tags.join('|') + ')$"](' + bbox + ');out geom;';
  // El principal se reintenta al final: suele responder bien tras un 504 transitorio.
  const servidores = SERVIDORES_OVERPASS.concat([SERVIDORES_OVERPASS[0]]);
  let ultimoError = null;
  for (const servidor of servidores){
    try {
      const r = await fetchConTimeout(servidor + encodeURIComponent(q), 20000);
      if (!r.ok) throw new Error('Overpass no respondió (' + r.status + ')');
      const j = await r.json();
      const ways = (j.elements || []).filter(function(e){ return e.type === 'way' && e.geometry && e.geometry.length > 1; });
      if (!ways.length) throw new Error('El espejo respondió sin vialidades; probando otro servidor…');
      guardarCacheOSM(zonaId, ways);
      return { ways: ways, desdeCache: false };
    } catch (err){
      ultimoError = err;
    }
  }
  // Todos los servidores fallaron: usar copia local si existe.
  const cache = leerCacheOSM()[zonaId];
  if (cache && cache.length) return { ways: cache, desdeCache: true };
  throw ultimoError || new Error('Overpass no disponible');
}

/** Encadena vialidades dentro de la zona en un recorrido continuo. */
function encadenarVialidades(ways, zona){
  const dentro = ways.filter(function(w){
    const pts = polilineaAPuntos(w);
    const enZona = pts.filter(function(p){ return puntoDentro(p, zona.poly); }).length;
    return enZona >= Math.max(2, Math.ceil(pts.length * 0.5));
  });
  if (dentro.length < 2) return null;

  dentro.sort(function(a, b){ return polilineaAPuntos(b).length - polilineaAPuntos(a).length; });
  const usadas = [{ way: dentro[0], invertir: false }];
  const restantes = dentro.slice(1);

  function extremos(wayObj){
    const p = polilineaAPuntos(wayObj.way || wayObj);
    if (wayObj.invertir){ const r = p.slice().reverse(); return [r[0], r[r.length - 1]]; }
    return [p[0], p[p.length - 1]];
  }
  let fin = extremos(usadas[0])[1];

  while (restantes.length){
    let mejor = null;
    restantes.forEach(function(w, idx){
      const cand = { way: w, invertir: false };
      const [ini, finW] = extremos(cand);
      const dIni = haversine(fin, ini), dFin = haversine(fin, finW);
      const d = Math.min(dIni, dFin);
      if (!mejor || d < mejor.d) mejor = { d: d, idx: idx, invertir: dFin < dIni };
    });
    if (!mejor || mejor.d > 600) break; // hueco demasiado grande: se detiene la cadena
    const w = restantes.splice(mejor.idx, 1)[0];
    usadas.push({ way: w, invertir: mejor.invertir });
    fin = extremos({ way: w, invertir: mejor.invertir })[1];
  }

  // Rellenar con tramos de enlace reales vía OSRM
  return (async function(){
    let geometria = [];
    for (let i = 0; i < usadas.length; i++){
      const w = usadas[i].way;
      let pts = polilineaAPuntos(w);
      if (usadas[i].invertir) pts = pts.slice().reverse();
      if (i > 0){
        const anterior = geometria[geometria.length - 1];
        try {
          const enlace = await osrmRuta([anterior, pts[0]]);
          geometria = geometria.concat(enlace.geometria);
        } catch(e){ geometria = geometria.concat([anterior, pts[0]]); }
      }
      geometria = geometria.concat(pts);
    }
    // cerrar el circuito
    try {
      const cierre = await osrmRuta([geometria[geometria.length - 1], geometria[0]]);
      geometria = geometria.concat(cierre.geometria);
    } catch(e){ geometria = geometria.concat([geometria[geometria.length - 1], geometria[0]]); }
    return geometria;
  })();
}

/** Simplifica la geometría para no guardar miles de puntos. */
function simplificar(puntos, umbralM){
  if (puntos.length < 3) return puntos;
  const salida = [puntos[0]];
  for (let i = 1; i < puntos.length - 1; i++){
    if (haversine(salida[salida.length - 1], puntos[i]) >= umbralM) salida.push(puntos[i]);
  }
  salida.push(puntos[puntos.length - 1]);
  return salida;
}

/* ---------- Mapbox (opcional): teselas y rutas sobre calles reales ----------
   Con un token público configurado, el mapa usa teselas de Mapbox y las
   rutas se calculan con su Directions API, sin depender de Overpass.
   Sin token todo funciona igual con OpenStreetMap + OSRM. */
const MAPBOX_TOKEN = 'pk.eyJ1IjoiZGFuaWJveTEyMSIsImEiOiJjbXVwMXVxN3cwMndxMnpvcTNuOXc5Zm5vIn0.UXCBv-CguAQlOZUDjla1kA'; // token público de Mapbox (restringido por URL en el panel de Mapbox)
const CLAVE_CACHE_RUTAS = 'bym.rutas.v1';
function leerCacheRutas(){
  try { return JSON.parse(localStorage.getItem(CLAVE_CACHE_RUTAS)) || {}; } catch(e){ return {}; }
}
function guardarCacheRutas(coloniaId, ruta){
  try {
    const c = leerCacheRutas();
    c[coloniaId] = { geometria: ruta.geometria, distanciaM: ruta.distanciaM, callePrincipal: ruta.callePrincipal, zona: ruta.zona, fuente: ruta.fuente };
    localStorage.setItem(CLAVE_CACHE_RUTAS, JSON.stringify(c));
  } catch(e){ /* la caché es opcional */ }
}
/** Puntos serpenteantes dentro de la poligonal de la zona (máx. 24). */
function waypointsZona(zona){
  const lats = zona.poly.map(function(p){ return p[0]; });
  const lngs = zona.poly.map(function(p){ return p[1]; });
  const minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
  const minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
  const filas = 5, cols = 5, pts = [];
  for (let f = 0; f < filas; f++){
    const fila = [];
    for (let c = 0; c < cols; c++){
      const lat = minLat + (maxLat - minLat) * ((f + 0.5) / filas);
      const lng = minLng + (maxLng - minLng) * ((c + 0.5) / cols);
      if (puntoDentro({ lat: lat, lng: lng }, zona.poly)) fila.push({ lat: lat, lng: lng });
    }
    if (f % 2 === 1) fila.reverse();
    pts.push.apply(pts, fila);
  }
  return pts.slice(0, 24);
}
async function mapboxRutaZona(coloniaId, zona){
  const wps = waypointsZona(zona);
  if (wps.length < 2) throw new Error('La zona es demasiado pequeña para trazar una ruta.');
  const coords = wps.map(function(p){ return p.lng.toFixed(6) + ',' + p.lat.toFixed(6); }).join(';');
  const url = 'https://api.mapbox.com/directions/v5/mapbox/driving/' + coords + '?overview=full&geometries=geojson&access_token=' + encodeURIComponent(MAPBOX_TOKEN);
  const r = await fetchConTimeout(url, 15000);
  if (!r.ok) throw new Error('Mapbox Directions no respondió (' + r.status + ')');
  const j = await r.json();
  const ruta = j.routes && j.routes[0];
  if (!ruta || !ruta.geometry || ruta.geometry.coordinates.length < 2) throw new Error('Mapbox no devolvió una ruta útil.');
  const geometria = ruta.geometry.coordinates.map(function(c){ return { lat: c[1], lng: c[0] }; });
  const salida = { geometria: geometria, distanciaM: Math.round(ruta.distance || 0), callePrincipal: 'Calles de ' + zona.nombre, zona: zona.nombre, fuente: 'Mapbox Directions sobre calles de OpenStreetMap' };
  guardarCacheRutas(coloniaId, salida);
  return salida;
}

const rutas = {}; // rutas[coloniaId] = {geometria, distanciaM, callePrincipal, fuente}
async function construirRutaZona(coloniaId){
  if (rutas[coloniaId]) return rutas[coloniaId];
  const zona = ZONAS[coloniaId];
  if (!zona) throw new Error('Zona desconocida');
  // Vía rápida y confiable: Mapbox Directions (si hay token) con caché local.
  if (MAPBOX_TOKEN && navigator.onLine){
    try { return await mapboxRutaZona(coloniaId, zona); }
    catch(e){ console.warn('Mapbox no disponible; usando OpenStreetMap:', e.message); }
  }
  try {
    const resultado = await overpassVialidades(zona, coloniaId);
    const ways = resultado.ways;
    if (!ways.length) throw new Error('No se encontraron vialidades de OpenStreetMap en esta zona.');
    let geometria = await encadenarVialidades(ways, zona);
    if (!geometria || geometria.length < 10) throw new Error('No se pudo formar un recorrido continuo en esta zona.');
    geometria = simplificar(geometria, 12);
    let distanciaM = 0;
    for (let i = 1; i < geometria.length; i++) distanciaM += haversine(geometria[i-1], geometria[i]);
    const nombreSeed = ways[0].tags && ways[0].tags.name ? ways[0].tags.name : 'Vialidades de ' + zona.nombre;
    const salida = { geometria: geometria, distanciaM: distanciaM, callePrincipal: nombreSeed, zona: zona.nombre, fuente: 'vialidades de OpenStreetMap' + (resultado.desdeCache ? ' (copia local)' : '') };
    guardarCacheRutas(coloniaId, salida);
    rutas[coloniaId] = salida;
    return salida;
  } catch (err) {
    // Último respaldo honesto: una ruta ya calculada antes, etiquetada como copia local.
    const cr = leerCacheRutas()[coloniaId];
    if (cr && cr.geometria && cr.geometria.length > 1){
      const salida = Object.assign({}, cr, { fuente: cr.fuente + ' (copia local)' });
      rutas[coloniaId] = salida;
      return salida;
    }
    throw err;
  }
}

/** Distribuye puntos cada INTERVALO_PUNTOS metros sobre la geometría real. */
async function distribuirPuntos(geometria, intervalo){
  const puntos = [];
  let acumulado = 0, siguiente = intervalo / 2; // el primero a mitad del primer tramo
  for (let i = 1; i < geometria.length && puntos.length < 40; i++){
    const a = geometria[i - 1], b = geometria[i];
    const seg = haversine(a, b);
    while (acumulado + seg >= siguiente && puntos.length < 40){
      const t = (siguiente - acumulado) / seg;
      puntos.push({
        numero: puntos.length + 1,
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        distanciaM: Math.round(siguiente),
        estado: 'Punto propuesto por el sistema',
        confirmado: false
      });
      siguiente += intervalo;
    }
    acumulado += seg;
  }
  return puntos;
}

/* ============================================================
   MÓDULO 11b · RED URBANA DE PUNTOS (toda la ciudad)
   ------------------------------------------------------------
   Los puntos de recolección por colonia nacen de la ruta de esa colonia,
   y solo 6 colonias tienen ruta. Para cubrir toda Ciudad Guzmán sin
   inventar fronteras (OSM no tiene los límites de las colonias: se
   comprobó con Overpass y Nominatim), se piden LAS CALLES reales de
   toda la ciudad en una sola consulta y se reparten puntos cada
   INTERVALO_PUNTOS metros sobre ellas. Cada punto se etiqueta
   "propuesto por el sistema": no es un contenedor municipal confirmado.
   ============================================================ */
const RED_CIUDAD = {
  bbox: '19.675,-103.500,19.735,-103.430',        // Ciudad Guzmán con margen
  tags: ['primary', 'secondary', 'tertiary', 'residential'],
  intervaloM: INTERVALO_PUNTOS,                    // 400 m, igual que por colonia
  maxPuntos: 1500,                                 // techo de seguridad para el navegador
  separacionMinM: 60,                              // solo duplicados reales: 300 m borraría puntos legítimos de calles paralelas
  colonia: 'Red urbana de Ciudad Guzmán',
  cacheClave: 'bym.osm.red.v1',
  cacheDias: 7                                     // las calles cambian poco
};

function leerCacheRed(){
  try {
    const c = JSON.parse(localStorage.getItem(RED_CIUDAD.cacheClave));
    if (!c || !c.puntos || !c.puntos.length) return null;
    if (Date.now() - (c.ts || 0) > RED_CIUDAD.cacheDias * 86400000) return null;
    if (!Array.isArray(c.puntos) || typeof c.puntos[0].lat !== 'number') return null;
    return c;
  } catch(e){ return null; }
}
function guardarCacheRed(puntos){
  try {
    localStorage.setItem(RED_CIUDAD.cacheClave, JSON.stringify({ ts: Date.now(), puntos: puntos }));
  } catch(e){ /* sin espacio: la red se vuelve a pedir la próxima vez */ }
}

/** Una sola consulta por TODA la ciudad (no 82 por colonia). */
async function overpassRedCiudad(){
  const q = '[out:json][timeout:60];way["highway"~"^(' + RED_CIUDAD.tags.join('|') +
    ')$"](' + RED_CIUDAD.bbox + ');out geom;';
  const servidores = SERVIDORES_OVERPASS.concat([SERVIDORES_OVERPASS[0]]);
  let ultimoError = null;
  for (const servidor of servidores){
    try {
      const r = await fetchConTimeout(servidor + encodeURIComponent(q), 45000);
      if (!r.ok) throw new Error('Overpass no respondió (' + r.status + ')');
      const j = await r.json();
      const vias = (j.elements || []).filter(function(e){ return e.type === 'way' && e.geometry && e.geometry.length > 1; });
      if (!vias.length) throw new Error('El espejo respondió sin vialidades; probando otro servidor…');
      return vias;
    } catch (err){ ultimoError = err; }
  }
  throw ultimoError || new Error('Overpass no disponible');
}

/** Encadena vías que se tocan (en OSM una avenida larga viene partida en
    tramos por cada cruce) para que la cuenta de metros siga por la calle
    en vez de reiniciarse en cada tramo. Devuelve CADENAS: listas de
    vértices {lat, lng, via}. Es la idea de encadenarVialidades, pero en
    vez de una sola ruta para la zona, todas las cadenas que haga falta:
    la ciudad entera no es un recorrido único. */
function encadenarVias(vias, toleranciaM){
  const pendientes = [];
  (vias || []).forEach(function(v){
    const pts = polilineaAPuntos(v);
    if (pts.length > 1){
      const nombre = (v.tags && v.tags.name) || null;
      pendientes.push(pts.map(function(p){ return { lat: p.lat, lng: p.lng, via: nombre }; }));
    }
  });
  // Cubos espaciales para no comparar cada extremo contra todas las vías:
  // solo se miran las que tienen un extremo en las 9 celdas vecinas.
  const lado = Math.max(1, toleranciaM);
  const cubos = new Map();
  function clave(p){
    return Math.round(p.lat * 110540 / lado) + ':' + Math.round(p.lng * 104797 / lado);
  }
  function registrar(item){
    [item[0], item[item.length - 1]].forEach(function(p){
      const k = clave(p);
      if (!cubos.has(k)) cubos.set(k, []);
      cubos.get(k).push(item);
    });
  }
  pendientes.forEach(function(p){ p.viva = true; });
  pendientes.forEach(registrar);

  const cadenas = [];
  while (pendientes.length){
    let cadena = null;
    while (pendientes.length && !cadena){
      const cand = pendientes.shift();
      if (cand.viva){ cadena = cand; cadena.viva = false; }
    }
    if (!cadena) break;   // solo quedaban vías ya consumidas
    for(;;){
      const fin = cadena[cadena.length - 1];
      let mejor = null, mejorD = toleranciaM, invertir = false;
      const cx = Math.round(fin.lat * 110540 / lado), cy = Math.round(fin.lng * 104797 / lado);
      for (let i = cx - 1; i <= cx + 1 && !mejor; i++){
        for (let j = cy - 1; j <= cy + 1 && !mejor; j++){
          const lista = cubos.get(i + ':' + j);
          if (!lista) continue;
          for (let k = 0; k < lista.length; k++){
            const cand = lista[k];
            if (!cand.viva) continue;
            const dIni = haversine(fin, cand[0]);
            const dFin = haversine(fin, cand[cand.length - 1]);
            if (dIni <= mejorD){ mejorD = dIni; mejor = cand; invertir = false; }
            if (dFin < mejorD){ mejorD = dFin; mejor = cand; invertir = true; }
          }
        }
      }
      if (!mejor) break;
      mejor.viva = false;
      cadena = cadena.concat(invertir ? mejor.slice().reverse() : mejor);
    }
    cadenas.push(cadena);
  }
  return cadenas;
}

/** Reparte puntos cada intervaloM sobre cada cadena y descarta los que
    caen a menos de separacionMinM de otro ya aceptado (vías duplicadas
    en OSM). Puro y sin red: se prueba en tests/red-ciudad.js. */
function puntosDesdeCadenas(cadenas, opciones){
  const intervalo = (opciones && opciones.intervaloM) || RED_CIUDAD.intervaloM;
  const max = (opciones && opciones.maxPuntos) || RED_CIUDAD.maxPuntos;
  const sep = (opciones && opciones.separacionMinM) || RED_CIUDAD.separacionMinM;
  // Rejilla en grados equivalente a celdas de `sep` metros (Ciudad Guzmán,
  // lat ~19.7°): cualquier punto a menos de sep está en las 9 celdas vecinas.
  const METRO_POR_GRADO_LAT = 110540;
  const METRO_POR_GRADO_LNG = 111320 * Math.cos(19.7 * Math.PI / 180);
  const celdas = Object.create(null);

  function ocupada(lat, lng){
    const cx = Math.floor(lat * METRO_POR_GRADO_LAT / sep);
    const cy = Math.floor(lng * METRO_POR_GRADO_LNG / sep);
    for (let i = cx - 1; i <= cx + 1; i++){
      for (let j = cy - 1; j <= cy + 1; j++){
        const lista = celdas[i + ':' + j];
        if (!lista) continue;
        for (let k = 0; k < lista.length; k++){
          if (haversine({ lat: lat, lng: lng }, lista[k]) < sep) return true;
        }
      }
    }
    return false;
  }
  function aceptar(lat, lng, distanciaM, via){
    const p = {
      numero: null, lat: lat, lng: lng, distanciaM: Math.round(distanciaM),
      estado: 'Punto propuesto por el sistema', confirmado: false,
      colonia: RED_CIUDAD.colonia
    };
    if (via) p.via = via;
    const cx = Math.floor(lat * METRO_POR_GRADO_LAT / sep);
    const cy = Math.floor(lng * METRO_POR_GRADO_LNG / sep);
    const clave = cx + ':' + cy;
    (celdas[clave] || (celdas[clave] = [])).push(p);
    return p;
  }

  const puntos = [];
  for (let c = 0; c < cadenas.length && puntos.length < max; c++){
    const cadena = cadenas[c];
    if (!cadena || cadena.length < 2) continue;
    let acumulado = 0, siguiente = intervalo / 2;   // el primero a mitad del primer tramo
    for (let i = 1; i < cadena.length && puntos.length < max; i++){
      const a = cadena[i - 1], b = cadena[i];
      const seg = haversine(a, b);
      if (seg <= 0) continue;
      while (acumulado + seg >= siguiente && puntos.length < max){
        const t = (siguiente - acumulado) / seg;
        const lat = a.lat + (b.lat - a.lat) * t, lng = a.lng + (b.lng - a.lng) * t;
        if (!ocupada(lat, lng)) puntos.push(aceptar(lat, lng, siguiente, b.via || a.via || null));
        siguiente += intervalo;
      }
      acumulado += seg;
    }
  }
  puntos.forEach(function(p, i){ p.numero = i + 1; });
  return puntos;
}

function puntosDesdeVias(vias, opciones){
  return puntosDesdeCadenas(encadenarVias(vias, 30), opciones);
}

/** Geocodificación (Nominatim) — preparada para búsqueda de direcciones. */
async function nominatimBuscar(texto){
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(texto + ', Ciudad Guzmán, Jalisco');
  const r = await fetchConTimeout(url, 12000);
  if (!r.ok) throw new Error('Geocodificación no disponible');
  return r.json();
}

/* ============================================================
   MÓDULO 12 · MAPA LEAFLET
   ============================================================ */
let mapa = null;
let capaRuta = null, capaPuntos = null, capaZonas = null, marcadorUsuario = null, marcadorCamion = null, marcadorSeleccion = null, rutaUsuario = null;
let puntosActuales = [];   // puntos de la colonia activa
let rutaActiva = null;     // ruta de la colonia activa
let puntoSeleccionado = null;
let capaRed = null, lienzoRed = null;   // red urbana: puntos de toda la ciudad
let redPuntos = [];                     // puntos de la red urbana (Módulo 11b)
let redVisible = true, redCargando = false, redUltimoIntento = 0, redAjustada = false;
let capaColonias, coloniasVisible = true, coloniaPorColocar = null, capaSugerencia = null;

function iconoPunto(num, seleccion){
  return L.divIcon({
    className: '',
    html: '<div class="mk-punto' + (seleccion ? ' mk-punto-seleccion' : '') + '"><span>' + String(num).padStart(2,'0') + '</span></div>',
    iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26]
  });
}
function iconoUsuario(){
  return L.divIcon({ className: '', html: '<div style="position:relative;width:22px;height:22px"><div class="mk-pulso"></div><div class="mk-usuario"></div></div>', iconSize: [22,22], iconAnchor: [11,11] });
}
function iconoCamion(){
  return L.divIcon({
    className: '',
    html: '<div class="mk-camion"><div class="camion-circulo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 6h12v10h-12z"/><path d="M13.5 9h4l3 3.5V16h-7"/><circle cx="6" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/></svg></div></div>',
    iconSize: [44,44], iconAnchor: [22,22]
  });
}

function initMapa(){
  if (mapa || typeof L === 'undefined') return;
  mapa = L.map('mapa', { zoomControl: true, attributionControl: true }).setView(CENTRO_CIUZ, 14);
  const capaBase = MAPBOX_TOKEN
    ? L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}?access_token=' + MAPBOX_TOKEN, {
        tileSize: 512, zoomOffset: -1, maxZoom: 19,
        attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/">Mejorar este mapa</a>'
      })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      });
  capaBase.addTo(mapa);

  // Delimitaciones aproximadas de colonias (visibles pero no bloquean clics)
  capaZonas = L.layerGroup();
  Object.keys(ZONAS).forEach(function(id){
    const z = ZONAS[id];
    L.polygon(z.poly, { color: '#2E7D32', weight: 1.5, dashArray: '6 6', fillOpacity: 0.05, interactive: false })
      .addTo(capaZonas);
  });
  capaZonas.addTo(mapa);

  capaRuta = L.layerGroup();
  capaPuntos = L.layerGroup();
  initCapaRed();
  initCapaColonias();
  mapa.on('click', function(e){
    if (!estado.modoElegirMapa) return;
    const latlng = { lat: e.latlng.lat, lng: e.latlng.lng };
    if (estado.modoElegirMapa === 'usuario'){
      fijarUbicacionManual(latlng);
    } else if (estado.modoElegirMapa === 'reporte'){
      estado.ubicacionReporte = latlng;
      pintarMarcadorSeleccion(latlng);
      actualizarCoordenadasReporte();
      estado.modoElegirMapa = null;
      toast('📍 Ubicación del reporte asignada.', 'exito', 2600);
    } else if (estado.modoElegirMapa === 'colonia' && coloniaPorColocar){
      guardarUbicacionEquipo(coloniaPorColocar, latlng);
    }
  });

  $('#btnGPS').addEventListener('click', usarMiUbicacion);
  $('#btnVerRuta').addEventListener('click', centrarEnRuta);
  $('#btnRecargarRuta').addEventListener('click', function(){ delete rutas[estado.coloniaId]; cargarRutaColonia(true); });
  $('#btnRed').addEventListener('click', alternarRedCiudad);
  $('#rutaSelect').addEventListener('change', function(){ seleccionarColonia(this.value, true); });
}

/* ---------- Red urbana: capa, pintado y carga ---------- */
function initCapaRed(){
  if (!mapa || capaRed) return;
  capaRed = L.layerGroup();
  // Lienzo (canvas): dibuja cientos de círculos sin crear un nodo del DOM
  // por punto, que es lo que haría lento el mapa con toda la ciudad.
  lienzoRed = L.canvas({ padding: 0.5 });
  const b = $('#btnRed');
  if (b) b.classList.toggle('activo', redVisible);
  if (redVisible) capaRed.addTo(mapa);
}

function pintarRedCiudad(){
  if (!capaRed) return;
  capaRed.clearLayers();
  redPuntos.forEach(function(p){
    L.circleMarker([p.lat, p.lng], {
      renderer: lienzoRed, radius: 4.5, color: '#1B5E20', weight: 1,
      fillColor: '#2E7D32', fillOpacity: .55,
      bubblingMouseEvents: false   // para no colocar tu ubicación al tocar un punto
    }).addTo(capaRed).bindPopup(function(){ return construirPopupPunto(p); }, { className: 'pz-popup' });
  });
}

function pintarChipRed(titulo, detalle, fuente){
  const cont = $('#estadoRedChip');
  if (!cont) return;
  cont.innerHTML = '';
  const c1 = document.createElement('span');
  c1.className = 'chip ' + (redPuntos.length ? 'verde' : 'ambar');
  c1.textContent = titulo + (detalle ? ': ' + detalle : '');
  cont.appendChild(c1);
  if (fuente){
    const c2 = document.createElement('span'); c2.className = 'chip gris'; c2.textContent = fuente;
    cont.appendChild(c2);
  }
}

/** Encuadra toda la red urbana (una sola vez por carga de página), para que
  * al abrir el mapa se vea la ciudad completa con sus puntos de recolección.
  */
function ajustarVistaRedCiudad(){
  if (redAjustada || !mapa || !redPuntos.length || !redVisible) return;
  if (estado.vista !== 'mapa') return;
  const bounds = L.latLngBounds(redPuntos.map(function(p){ return [p.lat, p.lng]; }));
  mapa.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  redAjustada = true;
}

function alternarRedCiudad(){
  redVisible = !redVisible;
  const b = $('#btnRed');
  if (b) b.classList.toggle('activo', redVisible);
  if (capaRed){
    if (redVisible) capaRed.addTo(mapa); else mapa.removeLayer(capaRed);
  }
  toast(redVisible
    ? '🟢 Red urbana visible' + (redPuntos.length ? ': ' + redPuntos.length + ' puntos en toda la ciudad.' : '.')
    : 'Red urbana oculta.', 'info', 3000);
}

/* ---------- Colonias del catálogo: etiquetas en el mapa ---------- */
const CLAVE_UBICACIONES_EQUIPO = 'bym.colonias.ubicaciones.v1';

function leerUbicacionesEquipo(){
  try {
    const u = JSON.parse(localStorage.getItem(CLAVE_UBICACIONES_EQUIPO));
    return (u && typeof u === 'object') ? u : {};
  } catch(e){ return {}; }
}

function centroDeZona(z){
  // Punto medio del polígono aproximado (solo las 6 colonias de ZONAS).
  let lat = 0, lng = 0;
  z.poly.forEach(function(p){ lat += p[0]; lng += p[1]; });
  return [lat / z.poly.length, lng / z.poly.length];
}

function initCapaColonias(){
  if (!mapa || capaColonias) return;
  capaColonias = L.layerGroup();
  pintarCapaColonias();
  llenarSelectColocar();
  const b = $('#btnColonias');
  if (b) b.classList.toggle('activo', coloniasVisible);
  if (coloniasVisible) capaColonias.addTo(mapa);
  $('#btnColonias').addEventListener('click', alternarColonias);
  $('#btnColocarColonia').addEventListener('click', activarColocarColonia);
  $('#btnCopiarUbicaciones').addEventListener('click', copiarUbicacionesEquipo);
}

/** Dibuja una etiqueta por colonia. Fuente de cada punto, en orden de
    confianza: polígono de ZONAS, ubicación aportada por el equipo
    (en este navegador) y lugar con el mismo nombre en OpenStreetMap.
    Las que solo tienen una CALLE con su nombre NO se dibujan como
    colonia: una calle puede estar lejos de la colonia a la que dio
    nombre. Cada punto dice su fuente en el popup. */
function pintarCapaColonias(){
  if (!capaColonias) return;
  capaColonias.clearLayers();
  const fuentes = {};
  Object.keys(ZONAS).forEach(function(id){
    fuentes[ZONAS[id].nombre] = { c: centroDeZona(ZONAS[id]), fuente: 'polígono aproximado de la colonia' };
  });
  const equipo = leerUbicacionesEquipo();
  Object.keys(equipo).forEach(function(n){
    if (COLONIAS.indexOf(n) !== -1) fuentes[n] = { c: equipo[n], fuente: 'ubicación aportada por el equipo del proyecto' };
  });
  UBICACION_COLONIAS.forEach(function(u){
    if (u[2] === 'calle' || fuentes[u[0]]) return;
    fuentes[u[0]] = { c: u[1], fuente: 'aproximada: lugar con su nombre en OpenStreetMap' };
  });
  Object.keys(fuentes).forEach(function(nombre){
    const f = fuentes[nombre];
    L.circleMarker(f.c, {
      radius: 4.5, color: '#5E35B1', weight: 1.5, fillColor: '#7E57C2', fillOpacity: .8,
      bubblingMouseEvents: false
    }).addTo(capaColonias)
      .bindTooltip(nombre, { permanent: true, direction: 'top', offset: [0, -6], className: 'et-colonia' })
      .bindPopup(function(){
        const cont = document.createElement('div');
        const t = document.createElement('strong'); t.textContent = '🏘️ Colonia ' + nombre;
        const d = document.createElement('div'); d.style.fontSize = '.78rem'; d.style.marginTop = '.3rem';
        d.textContent = 'Ubicación: ' + f.fuente + '. Ninguna colonia del catálogo tiene límites oficiales públicos: el punto es orientativo, no una delimitación.';
        cont.append(t, d);
        return cont;
      }, { className: 'pz-popup' });
  });
}

function alternarColonias(){
  coloniasVisible = !coloniasVisible;
  const b = $('#btnColonias');
  if (b) b.classList.toggle('activo', coloniasVisible);
  if (capaColonias){
    if (coloniasVisible) capaColonias.addTo(mapa); else mapa.removeLayer(capaColonias);
  }
  const bloque = $('#bloqueColocar');
  if (bloque) bloque.hidden = !coloniasVisible;
  toast(coloniasVisible
    ? '🏘️ Colonias visibles: el catálogo completo sobre el mapa.'
    : 'Colonias ocultas.', 'info', 2600);
}

/** Colonias del catálogo que aún no tienen punto en el mapa. */
function coloniasPendientes(){
  const ubicadas = {};
  Object.keys(ZONAS).forEach(function(id){ ubicadas[ZONAS[id].nombre] = true; });
  UBICACION_COLONIAS.forEach(function(u){ if (u[2] !== 'calle') ubicadas[u[0]] = true; });
  Object.keys(leerUbicacionesEquipo()).forEach(function(n){ ubicadas[n] = true; });
  return COLONIAS.filter(function(n){ return !ubicadas[n]; });
}

function llenarSelectColocar(){
  const sel = $('#coloniaColocar');
  if (!sel) return;
  const pend = coloniasPendientes();
  sel.innerHTML = '';
  pend.forEach(function(n){
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sel.appendChild(o);
  });
  const bloque = $('#bloqueColocar');
  if (bloque) bloque.hidden = !coloniasVisible || pend.length === 0;
  const ayuda = $('#ayudaColocar');
  if (ayuda) ayuda.textContent = pend.length
    ? 'Faltan ' + pend.length + ' colonias por ubicar (solo se guarda en este navegador).'
    : '¡Catálogo completo! Las ' + COLONIAS.length + ' colonias están en el mapa.';
}

function activarColocarColonia(){
  const sel = $('#coloniaColocar');
  coloniaPorColocar = sel ? sel.value : null;
  if (!coloniaPorColocar){ toast('Ya no quedan colonias por ubicar.', 'info', 2600); return; }
  estado.modoElegirMapa = 'colonia';
  if (estado.vista !== 'mapa') irA('mapa');
  toast('👆 Toca el punto exacto de la colonia ' + coloniaPorColocar + '.', 'info', 4600);
  mostrarSugerencia(coloniaPorColocar);
}

/** Si OpenStreetMap solo tiene una CALLE con el nombre de la colonia,
    se muestra como sugerencia punteada: el equipo confirma o corrige
    tocando el punto correcto. */
function mostrarSugerencia(nombre){
  limpiarSugerencia();
  if (!mapa) return;
  const u = UBICACION_COLONIAS.filter(function(x){ return x[0] === nombre && x[2] === 'calle'; })[0];
  if (!u) return;
  capaSugerencia = L.circle(u[1], {
    radius: 200, color: '#5E35B1', weight: 1.5, dashArray: '6 6', fillOpacity: .05, interactive: false
  }).addTo(mapa);
}
function limpiarSugerencia(){
  if (capaSugerencia && mapa){ mapa.removeLayer(capaSugerencia); }
  capaSugerencia = null;
}

function guardarUbicacionEquipo(nombre, latlng){
  const u = leerUbicacionesEquipo();
  u[nombre] = [Number(latlng.lat.toFixed(6)), Number(latlng.lng.toFixed(6))];
  try { localStorage.setItem(CLAVE_UBICACIONES_EQUIPO, JSON.stringify(u)); } catch(e){ /* sin espacio: se puede repetir */ }
  coloniaPorColocar = null;
  estado.modoElegirMapa = null;
  limpiarSugerencia();
  pintarCapaColonias();
  llenarSelectColocar();
  const falta = coloniasPendientes().length;
  toast('📍 Colonia ' + nombre + ' guardada.' + (falta ? ' Faltan ' + falta + '.' : ' ¡Catálogo completo en el mapa!'), 'exito', 3800);
}

/** Las ubicaciones colocadas a mano viven solo en este navegador;
    este botón las copia como JSON para hornearlas al repositorio. */
function copiarUbicacionesEquipo(){
  const datos = leerUbicacionesEquipo();
  if (!Object.keys(datos).length){ toast('Aún no has colocado colonias en este navegador.', 'info', 3000); return; }
  const texto = JSON.stringify({ fuente: 'equipo del proyecto BASURA Y MÁS', colonias: datos }, null, 1);
  navigator.clipboard.writeText(texto).then(function(){
    toast('📋 Ubicaciones copiadas. Pégalas en el chat para hornearlas al mapa.', 'exito', 5200);
  }, function(){
    toast('No se pudo copiar automáticamente.', 'error', 3600);
  });
}

/** Carga la red urbana: copia local primero, Overpass solo si toca. */
async function cargarRedCiudad(forzar){
  if (!capaRed || redCargando) return;
  if (!forzar){
    const c = leerCacheRed();
    if (c){
      redPuntos = c.puntos;
      pintarRedCiudad();
      pintarChipRed('🟢 Red urbana', redPuntos.length + ' puntos', 'copia local de OpenStreetMap');
      ajustarVistaRedCiudad();
      return;
    }
  }
  if (!forzar && Date.now() - redUltimoIntento < 60000) return;  // no insistir en cada visita
  redUltimoIntento = Date.now();
  redCargando = true;
  pintarChipRed('⏳ Red urbana', 'consultando OpenStreetMap…', '');
  try {
    const vias = await overpassRedCiudad();
    redPuntos = puntosDesdeVias(vias, {
      intervaloM: RED_CIUDAD.intervaloM, maxPuntos: RED_CIUDAD.maxPuntos,
      separacionMinM: RED_CIUDAD.separacionMinM
    });
    guardarCacheRed(redPuntos);
    pintarRedCiudad();
    pintarChipRed('🟢 Red urbana', redPuntos.length + ' puntos', vias.length + ' vialidades de OpenStreetMap');
    ajustarVistaRedCiudad();
  } catch(e){
    pintarChipRed('🔴 Red urbana', 'OpenStreetMap no respondió; vuelve a entrar al mapa en un minuto para reintentar', '');
  } finally {
    redCargando = false;
  }
}

function pintarRuta(){
  capaRuta.clearLayers();
  capaPuntos.clearLayers();
  if (rutaActiva){
    L.polyline(rutaActiva.geometria.map(function(p){ return [p.lat, p.lng]; }),
      { color: '#ffffff', weight: 9, opacity: .7 }).addTo(capaRuta);
    L.polyline(rutaActiva.geometria.map(function(p){ return [p.lat, p.lng]; }),
      { color: '#2E7D32', weight: 5, opacity: .95 }).addTo(capaRuta);
  }
  puntosActuales.forEach(function(p){
    L.marker([p.lat, p.lng], { icon: iconoPunto(p.numero) })
      .addTo(capaPuntos)
      .bindPopup(function(){ return construirPopupPunto(p); }, { className: 'pz-popup' });
  });
  capaRuta.addTo(mapa);
  capaPuntos.addTo(mapa);
}

function construirPopupPunto(p){
  const cont = document.createElement('div');
  const t = document.createElement('strong'); t.textContent = '📍 Punto de recolección #' + String(p.numero).padStart(2,'0');
  const col = document.createElement('div'); col.style.fontSize = '.78rem';
  col.textContent = p.colonia
    ? ('Zona: ' + p.colonia + (p.via ? ' · ' + p.via : ''))
    : ('Colonia: ' + (rutaActiva ? rutaActiva.zona : '—'));
  const est = document.createElement('div'); est.style.fontSize = '.78rem'; est.textContent = 'Estado: ' + p.estado;
  const d = document.createElement('div'); d.style.fontSize = '.78rem';
  d.textContent = estado.ubicacion ? ('Distancia: ' + fmtDistancia(haversine(estado.ubicacion, p))) : 'Selecciona tu ubicación para ver la distancia';
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-primario btn-chico'; b.style.marginTop = '.5rem';
  b.textContent = 'Ver detalle';
  b.addEventListener('click', function(){ abrirModalPunto(p); mapa.closePopup(); });
  cont.append(t, col, est, d, b);
  return cont;
}

function pintarMarcadorUsuario(latlng){
  if (marcadorUsuario) mapa.removeLayer(marcadorUsuario);
  marcadorUsuario = L.marker([latlng.lat, latlng.lng], { icon: iconoUsuario() }).addTo(mapa)
    .bindPopup('<strong>Tu ubicación</strong><br>Se usa solo para calcular rutas cercanas.', { className: 'pz-popup' });
}
function pintarMarcadorSeleccion(latlng){
  if (marcadorSeleccion) mapa.removeLayer(marcadorSeleccion);
  marcadorSeleccion = L.marker([latlng.lat, latlng.lng], { icon: iconoPunto('•', true) }).addTo(mapa);
}
function limpiarRutaUsuario(){
  if (rutaUsuario){ mapa.removeLayer(rutaUsuario); rutaUsuario = null; }
}
function pintarRutaUsuario(geometria){
  limpiarRutaUsuario();
  rutaUsuario = L.polyline(geometria.map(function(p){ return [p.lat, p.lng]; }),
    { color: '#2196F3', weight: 4, dashArray: '8 10', opacity: .9 }).addTo(mapa);
}

function seleccionarColonia(id, avisar){
  if (!ZONAS[id]) id = 'centro';
  estado.coloniaId = id;
  almacen.datos.coloniaId = id; guardar();
  $('#rutaSelect').value = id;
  $('#cfgColonia').value = id;
  $('#pColonia').value = id;
  mapa.setView(CENTRO_CIUZ, 13, { animate: !REDUCIR.matches });
  cargarRutaColonia(avisar);
}

async function cargarRutaColonia(avisar){
  const demoPendiente = estado.demo; // se conserva la intención de demo antes de recargar la ruta
  const chip = $('#estadoRutaChip');
  chip.innerHTML = '';
  const cCargando = document.createElement('span'); cCargando.className = 'chip ambar'; cCargando.textContent = '⏳ Calculando ruta con OpenStreetMap…';
  chip.appendChild(cCargando);
  $('#infoRutaNombre').textContent = '—';
  $('#infoPuntoCercano').textContent = '—';
  $('#infoDistanciaPunto').textContent = '—';
  $('#infoTiempoLlegada').textContent = 'No disponible';
  $('#listaPuntos').innerHTML = '<div class="vacio visible" style="padding:1.1rem"><p style="font-size:.85rem">Calculando la ruta real y sus puntos…</p></div>';
  detenerDemo(true);

  try {
    estado._consultaRuta = true;
    const ruta = await dataLayer.getRoutes(estado.coloniaId);
    rutaActiva = ruta;
    puntosActuales = await dataLayer.getCollectionPoints(ruta, INTERVALO_PUNTOS);
    pintarRuta();
    centrarEnRuta();

    chip.innerHTML = '';
    const cOk = document.createElement('span'); cOk.className = 'chip verde'; cOk.textContent = '🟢 Ruta disponible';
    const cFuente = document.createElement('span'); cFuente.className = 'chip gris'; cFuente.textContent = 'Vialidades de OpenStreetMap';
    chip.append(cOk, cFuente);
    $('#infoRutaNombre').textContent = ruta.zona + ' · circuito de ' + fmtDistancia(ruta.distanciaM);
    renderListaPuntos();
    verificarInsignias();
    if (estado.ubicacion) evaluarPuntoCercano();
    if (avisar) toast('🚛 Ruta de ' + ruta.zona + ' lista: ' + puntosActuales.length + ' puntos sobre calles reales.', 'exito', 4200);

    if (demoPendiente) iniciarDemo();
  } catch(err){
    chip.innerHTML = '';
    const cErr = document.createElement('span'); cErr.className = 'chip ambar'; cErr.textContent = '⚠️ Ruta no disponible';
    chip.appendChild(cErr);
    $('#listaPuntos').innerHTML = '<div class="vacio visible" style="padding:1.1rem"><p style="font-size:.85rem">No se pudo calcular la ruta (' + (err.message || 'error de conexión') + ').<br>Revisa tu conexión e inténtalo de nuevo.</p></div>';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-secundario btn-chico'; btn.style.marginTop = '.5rem';
    btn.textContent = '↻ Intentar de nuevo';
    btn.addEventListener('click', function(){ cargarRutaColonia(false); });
    $('#listaPuntos').firstChild.appendChild(btn);
    if (avisar) toast('No pudimos calcular la ruta de esta colonia. Intenta de nuevo.', 'error');
  }
}

function centrarEnRuta(){
  if (!rutaActiva) return;
  if (estado.vista !== 'mapa') return;  // arranque en segundo plano: no mover una vista oculta
  const bounds = L.latLngBounds(rutaActiva.geometria.map(function(p){ return [p.lat, p.lng]; }));
  mapa.fitBounds(bounds, { padding: [30, 30] });
}

function renderListaPuntos(){
  const cont = $('#listaPuntos');
  cont.innerHTML = '';
  if (!puntosActuales.length){
    const v = document.createElement('div'); v.className = 'vacio visible'; v.style.padding = '1.1rem';
    v.textContent = 'Carga una ruta para ver sus puntos.';
    cont.appendChild(v); return;
  }
  puntosActuales.forEach(function(p){
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'fila-punto';
    const num = document.createElement('span'); num.className = 'num-punto'; num.textContent = String(p.numero).padStart(2,'0');
    const info = document.createElement('span'); info.className = 'fp-info';
    const st = document.createElement('strong'); st.textContent = 'Punto de recolección #' + String(p.numero).padStart(2,'0');
    const sm = document.createElement('small'); sm.textContent = p.estado + (estado.ubicacion ? ' · a ' + fmtDistancia(haversine(estado.ubicacion, p)) + ' de ti' : '');
    info.append(st, sm);
    const dist = document.createElement('span'); dist.className = 'fp-dist'; dist.textContent = fmtDistancia(p.distanciaM) + ' en ruta';
    b.append(num, info, dist);
    b.addEventListener('click', function(){ abrirModalPunto(p); });
    cont.appendChild(b);
  });
}

function abrirModalPunto(p){
  puntoSeleccionado = p;
  $('#tPunto').textContent = '📍 Punto de recolección #' + String(p.numero).padStart(2,'0');
  const det = $('#puntoDetalle');
  det.innerHTML = '';
  function fila(etiqueta, valor){
    const d = document.createElement('div'); d.className = 'info-caja'; d.style.marginBottom = '.5rem';
    const s = document.createElement('small'); s.textContent = etiqueta;
    const b = document.createElement('strong'); b.textContent = valor;
    d.append(s, b); det.appendChild(d);
  }
  fila('Colonia', p.colonia ? p.colonia : (rutaActiva ? rutaActiva.zona : '—'));
  if (p.via) fila('Calle (OpenStreetMap)', p.via);
  fila('Estado', (p.confirmado ? '✓ Punto confirmado' : '📍 ' + p.estado));
  if (!p.colonia) fila('Distancia en ruta desde el inicio', fmtDistancia(p.distanciaM));
  fila('Distancia hasta ti', estado.ubicacion ? fmtDistancia(haversine(estado.ubicacion, p)) : 'Selecciona tu ubicación');
  fila('Próxima atención', 'GPS del vehículo no conectado — no disponible' + (estado.demo ? ' (disponible en modo demostración)' : ''));
  abrirModal('modalPunto');
}
$('#btnVerRutaPunto').addEventListener('click', function(){
  if (!puntoSeleccionado) return;
  cerrarModal('modalPunto');
  calcularRutaHastaPunto(puntoSeleccionado);
});

/* ============================================================
   MÓDULO 13 · UBICACIÓN DEL USUARIO
   ============================================================ */
async function usarMiUbicacion(){
  const btn = $('#btnGPS');
  btn.classList.add('activo');
  toast('⏳ Buscando tu ubicación…', 'info', 2500);
  try {
    const loc = await dataLayer.getUserLocation();
    estado.ubicacion = { lat: loc.lat, lng: loc.lng };
    estado._usoUbicacion = true;
    pintarMarcadorUsuario(estado.ubicacion);
    mapa.setView([loc.lat, loc.lng], 16, { animate: !REDUCIR.matches });
    toast('✓ Ubicación encontrada. Buscando la recolección más cercana…', 'exito');
    evaluarPuntoCercano();
    verificarInsignias();
    registrarAccion('ruta', 'Usó su ubicación para buscar la ruta', PTS.ayuda);
  } catch(err){
    toast(err.message + ' Puedes seleccionar un punto directamente en el mapa.', 'error', 6000);
    activarElegirMapa('usuario');
  } finally {
    btn.classList.remove('activo');
  }
}
function fijarUbicacionManual(latlng){
  estado.ubicacion = latlng;
  estado._usoUbicacion = true;
  pintarMarcadorUsuario(latlng);
  pintarMarcadorSeleccion(latlng);
  toast('📍 Ubicación seleccionada. Buscando la ruta más cercana…', 'info', 3000);
  evaluarPuntoCercano();
  verificarInsignias();
  estado.modoElegirMapa = null;
}
function activarElegirMapa(modo){
  estado.modoElegirMapa = modo;
  irA('mapa');
  toast('👆 Toca el mapa para seleccionar tu ubicación.', 'info', 3800);
}
$('#btnGPS').addEventListener('click', function(){ /* manejado en initMapa */ });

function puntoMasCercano(){
  if (!estado.ubicacion) return null;
  // Busca en TODA la ciudad (red urbana) además de la ruta de la colonia
  // activa: el punto más cercano ya no depende de qué colonia tengas cargada.
  const candidatas = redPuntos.concat(puntosActuales);
  if (!candidatas.length) return null;
  let mejor = null;
  candidatas.forEach(function(p){
    const d = haversine(estado.ubicacion, p);
    if (!mejor || d < mejor.d) mejor = { p: p, d: d };
  });
  return mejor;
}
function evaluarPuntoCercano(){
  const cerca = puntoMasCercano();
  if (!cerca){ 
    $('#infoPuntoCercano').textContent = '—';
    $('#infoDistanciaPunto').textContent = '—';
    $('#infoTiempoLlegada').textContent = 'No disponible';
    return;
  }
  $('#infoPuntoCercano').textContent = '#' + String(cerca.p.numero).padStart(2,'0') + (cerca.p.colonia ? ' · red' : '');
  $('#infoDistanciaPunto').textContent = fmtDistancia(cerca.d);
  $('#infoTiempoLlegada').textContent = 'No disponible';
  calcularRutaHastaPunto(cerca.p);
}
async function calcularRutaHastaPunto(punto){
  if (!estado.ubicacion){ 
    $('#infoTiempoLlegada').textContent = 'No disponible';
    return;
  }
  $('#infoTiempoLlegada').textContent = '⏳ Calculando…';
  try {
    const r = await osrmRuta([estado.ubicacion, punto]);
    pintarRutaUsuario(r.geometria);
    const aPie = r.distanciaM / 1.35;       // caminando ~4.9 km/h
    const enCoche = r.distanciaM / 8.3;     // ~30 km/h urbano
    $('#infoTiempoLlegada').innerHTML = '';
    $('#infoTiempoLlegada').textContent = fmtDuracion(aPie) + ' a pie · ' + fmtDuracion(enCoche) + ' en vehículo';
    toast('El punto #' + String(punto.numero).padStart(2,'0') + ' está a ' + fmtDistancia(r.distanciaM) + ' por calle (' + fmtDuracion(aPie) + ' a pie).', 'info', 4500);
  } catch(e){
    $('#infoTiempoLlegada').textContent = 'No disponible';
  }
}

/* ============================================================
   MÓDULO 14 · MODO DEMOSTRACIÓN (simulación etiquetada)
   ============================================================ */
const demo = { activo: false, distanciaM: 0, velocidadKmh: 22, ultimoTick: null, raf: null, avisoPunto: null, ultimaAct: null };
function longitudGeometria(geo){ let t = 0; for (let i = 1; i < geo.length; i++) t += haversine(geo[i-1], geo[i]); return t; }
function puntoEnDistancia(geo, distObjetivo){
  let acum = 0;
  for (let i = 1; i < geo.length; i++){
    const seg = haversine(geo[i-1], geo[i]);
    if (acum + seg >= distObjetivo){
      const t = (distObjetivo - acum) / seg;
      return { lat: geo[i-1].lat + (geo[i].lat - geo[i-1].lat) * t, lng: geo[i-1].lng + (geo[i].lng - geo[i-1].lng) * t, restante: longitudGeometria(geo) - distObjetivo };
    }
    acum += seg;
  }
  const u = geo[geo.length - 1];
  return { lat: u.lat, lng: u.lng, restante: 0 };
}
function iniciarDemo(){
  if (!rutaActiva){ toast('Primero carga la ruta de una colonia para ver la demostración.', 'alerta'); setDemoUI(false); return; }
  detenerDemo(true);
  demo.activo = true; demo.distanciaM = 0; demo.ultimoTick = null;
  estado.demo = true; almacen.datos.demo = true; guardar();
  if (!marcadorCamion) marcadorCamion = L.marker([rutaActiva.geometria[0].lat, rutaActiva.geometria[0].lng], { icon: iconoCamion(), zIndexOffset: 900 }).addTo(mapa);
  else marcadorCamion.addTo(mapa);
  $('#bannerDemo').classList.add('visible');
  $('#chipDemo').hidden = false;
  setDemoUI(true);
  demo.raf = requestAnimationFrame(tickDemo);
  toast('▶ Recorrido demostrativo iniciado. Los datos son simulados y están etiquetados.', 'alerta', 5000);
}
function detenerDemo(silencio){
  demo.activo = false;
  if (demo.raf) cancelAnimationFrame(demo.raf);
  if (marcadorCamion) mapa.removeLayer(marcadorCamion);
  $('#bannerDemo').classList.remove('visible');
  $('#chipDemo').hidden = true;
  setDemoUI(false);
  estado.demo = false; almacen.datos.demo = false; guardar();
  if (!silencio) toast('⏹ Recorrido demostrativo detenido.', 'info', 2600);
}
function setDemoUI(activo){
  $('#cfgDemo').checked = activo;
  $('#swDemoNav').checked = activo;
}
function tickDemo(ts){
  if (!demo.activo || !rutaActiva){ return; }
  if (demo.ultimoTick == null) demo.ultimoTick = ts;
  const dt = Math.min(200, ts - demo.ultimoTick) / 1000;
  demo.ultimoTick = ts;
  demo.distanciaM += (demo.velocidadKmh * 1000 / 3600) * dt;
  const total = rutaActiva.distanciaM;
  if (demo.distanciaM >= total){ demo.distanciaM = 0; demo.avisoPunto = null; }
  const pos = puntoEnDistancia(rutaActiva.geometria, demo.distanciaM);
  if (marcadorCamion) marcadorCamion.setLatLng([pos.lat, pos.lng]);
  demo.ultimaAct = Date.now();
  $('#infoTiempoLlegada').textContent = 'Demo: ' + fmtDuracion(pos.restante / (demo.velocidadKmh * 1000 / 3600)) + ' (fin del circuito)';

  // Proximidad al punto más cercano del usuario (notificación cada vuelta)
  if (estado.ubicacion){
    const cerca = puntoMasCercano();
    if (cerca){
      const distRuta = Math.abs(cerca.p.distanciaM - demo.distanciaM);
      const minRest = distRuta / (demo.velocidadKmh * 1000 / 60);
      if (minRest <= 5 && demo.avisoPunto !== cerca.p.numero){
        demo.avisoPunto = cerca.p.numero;
        toast('🚛 (Demo) El camión está a ~' + Math.round(minRest) + ' min de tu punto #' + String(cerca.p.numero).padStart(2,'0') + '.', 'alerta', 6000);
        dataLayer.sendNotification('BASURA Y MÁS (demo)', '🚛 El camión demostrativo está a ~' + Math.round(minRest) + ' minutos de tu punto de recolección.');
      }
    }
  }
  demo.raf = requestAnimationFrame(tickDemo);
}
$('#cfgDemo').addEventListener('change', function(){ this.checked ? iniciarDemo() : detenerDemo(false); });
$('#swDemoNav').addEventListener('change', function(){ this.checked ? iniciarDemo() : detenerDemo(false); });

/* ============================================================
   MÓDULO 15 · NOTIFICACIONES REALES
   ============================================================ */
function notificarReal(titulo, cuerpo){
  if (!estado.notif) return;
  try {
    if ('Notification' in window && Notification.permission === 'granted'){
      new Notification(titulo, { body: cuerpo });
    }
  } catch(e){ /* fallback silencioso: ya se muestra el toast */ }
}
function pintarBotonNotif(){
  const t = $('#btnNotifTexto');
  t.textContent = estado.notif ? 'Notificaciones activadas ✓' : 'Activar notificaciones';
  $('#btnNotif').classList.toggle('btn-secundario', estado.notif);
  $('#btnNotif').classList.toggle('btn-primario', !estado.notif);
  $('#cfgNotif').checked = estado.notif;
}
$('#btnNotif').addEventListener('click', async function(){
  if (estado.notif){
    estado.notif = false; almacen.datos.notif = false; guardar(); pintarBotonNotif();
    toast('🔕 Notificaciones desactivadas.', 'info'); return;
  }
  if (!('Notification' in window)){
    estado.notif = true; almacen.datos.notif = true; guardar(); pintarBotonNotif();
    toast('Este navegador no soporta notificaciones del sistema; usaremos avisos dentro de la app.', 'alerta', 5000);
    return;
  }
  let permiso = Notification.permission;
  if (permiso === 'default'){
    try { permiso = await Notification.requestPermission(); } catch(e){ permiso = 'denied'; }
  }
  if (permiso === 'granted'){
    estado.notif = true; almacen.datos.notif = true; guardar(); pintarBotonNotif();
    toast('✓ Notificaciones activadas. Te avisaremos en la app cuando el camión esté cerca (en demostración).', 'exito', 5500);
    dataLayer.sendNotification('BASURA Y MÁS', '♻️ Recuerda sacar tus residuos antes del paso del camión.');
  } else {
    estado.notif = true; almacen.datos.notif = true; guardar(); pintarBotonNotif();
    toast('Permiso del navegador rechazado: usaremos avisos dentro de la app. Nota: las alertas no llegan con la app cerrada.', 'alerta', 6000);
  }
});
$('#cfgNotif').addEventListener('change', function(){
  if (this.checked){ $('#btnNotif').click(); }
  else { estado.notif = false; almacen.datos.notif = false; guardar(); pintarBotonNotif(); toast('🔕 Notificaciones desactivadas.', 'info'); }
});

/* ============================================================
   MÓDULO 16 · CONCIENCIA (tarjeta local)
   ============================================================ */
function pintarConciencia(){
  $('#contadorAcciones').textContent = estado.acciones.filter(function(a){ return a.tipo === 'accion'; }).length;
  const resp = $('#respuestaAccion');
  if (estado.accionDia === hoyISO()){
    resp.className = 'pensamiento-respuesta ok visible';
    resp.textContent = '🌿 ¡Excelente! Cada pequeña acción cuenta. Hoy ya registraste tu acción.';
  }
}
$('#btnAccionSi').addEventListener('click', function(){
  const hoy = hoyISO();
  const resp = $('#respuestaAccion');
  resp.className = 'pensamiento-respuesta ok visible';
  resp.textContent = '¡Excelente! Cada pequeña acción cuenta. 🌿';
  if (estado.accionDia !== hoy){
    estado.accionDia = hoy;
    almacen.datos.accionDia = hoy;
    if (estado.diasAccion.indexOf(hoy) === -1){ estado.diasAccion.push(hoy); almacen.datos.diasAccion = estado.diasAccion; }
    guardar();
    registrarAccion('accion', 'Separó sus residuos hoy', PTS.accion);
    lanzarConfeti();
  } else {
    toast('Ya registraste tu acción de hoy. ¡Vuelve mañana! 🌱', 'info');
  }
  pintarConciencia();
  verificarInsignias();
});
$('#btnAccionNo').addEventListener('click', function(){
  const resp = $('#respuestaAccion');
  resp.className = 'pensamiento-respuesta pend visible';
  resp.textContent = '♻️ No pasa nada: todavía estás a tiempo. Abre la guía de separación y empieza hoy.';
  irA('guia');
});

/* ============================================================
   MÓDULO 17 · GUÍA Y BUSCADOR DE RESIDUOS
   ============================================================ */
$$('.tab-btn').forEach(function(tab){
  tab.addEventListener('click', function(){ activarTab(tab.dataset.cat); });
  tab.addEventListener('keydown', function(e){
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const tabs = $$('.tab-btn');
    const i = tabs.indexOf(tab);
    const sig = tabs[(e.key === 'ArrowRight' ? i + 1 : i - 1 + tabs.length) % tabs.length];
    sig.focus(); activarTab(sig.dataset.cat);
  });
});
function activarTab(cat){
  $$('.tab-btn').forEach(function(t){ t.setAttribute('aria-selected', t.dataset.cat === cat ? 'true' : 'false'); });
  $$('.panel-cat').forEach(function(p){ p.classList.toggle('activa', p.id === 'panel-' + cat); });
}

const RESIDUOS = [
  { n:'Plátano', cl:['platano','banana','guineo'], cat:'organicos', e:'🍌', c:'Orgánico: compóstalo o bótalo en la bolsa verde.' },
  { n:'Restos de comida', cl:['comida','sobras','sobra','tortilla','arroz','frijoles'], cat:'organicos', e:'🍎', c:'Orgánico: al contenedor con tapa; ideal para composta.' },
  { n:'Cáscaras de fruta', cl:['cascara','naranja','manzana','mango','limon','papaya'], cat:'organicos', e:'🍊', c:'Orgánico: perfecto para la composta casera.' },
  { n:'Hojas y jardín', cl:['hoja','hojas','jardin','pasto','hierba','poda'], cat:'organicos', e:'🍂', c:'Orgánico: sepáralo del resto para poder compostarlo.' },
  { n:'Cascarón de huevo', cl:['huevo','casaron','cascaron'], cat:'organicos', e:'🥚', c:'Orgánico: se degrada rápido, aplánalo antes.' },
  { n:'Café y filtros', cl:['cafe','filtro','posos'], cat:'organicos', e:'☕', c:'Orgánico: excelente abono para plantas.' },
  { n:'Botella PET', cl:['pet','botella','envase','garrafon'], cat:'reciclables', e:'🧴', c:'Reciclable: enjuágala, aplástala y deposítala separada.' },
  { n:'Cartón', cl:['carton','caja','cajas'], cat:'reciclables', e:'📦', c:'Reciclable: dóblalo y mantenlo seco.' },
  { n:'Papel', cl:['papel','periodico','revista','cuaderno'], cat:'reciclables', e:'📄', c:'Reciclable: limpio y seco.' },
  { n:'Lata', cl:['lata','latas','aluminio','atun','refresco'], cat:'reciclables', e:'🥫', c:'Reciclable: enjuaga y aplasta.' },
  { n:'Vidrio', cl:['vidrio','frasco','tarro','botella de vidrio'], cat:'reciclables', e:'🫙', c:'Reciclable: enjuaga y entrégalo sin tapa. Si está roto, envuélvelo.' },
  { n:'Plástico duro', cl:['plastico','cubeta','tupper','silla'], cat:'reciclables', e:'🪣', c:'Reciclable si está limpio: busca el símbolo de reciclaje.' },
  { n:'Colillas y papel sanitario', cl:['colilla','cigarro','papel higienico','sanitario'], cat:'noreciclables', e:'🚬', c:'No reciclable: bolsa cerrada a la basura común.' },
  { n:'Pañales', cl:['panal','panales'], cat:'noreciclables', e:'🍼', c:'No reciclable: bolsa bien cerrada.' },
  { n:'Empaques metalizados', cl:['metalizado','papita','dulce','snack'], cat:'noreciclables', e:'🍪', c:'No reciclable normalmente: bótalo cerrado.' },
  { n:'Plástico sucio', cl:['sucio','graso','contaminado'], cat:'noreciclables', e:'🥡', c:'No reciclable si está contaminado con comida.' },
  { n:'Pilas', cl:['pila','pilas','bateria','baterias'], cat:'especiales', e:'🔋', c:'Especial: punto de acopio, nunca a la basura común.' },
  { n:'Focos', cl:['foco','focos','bombilla','tubo','lampara'], cat:'especiales', e:'💡', c:'Especial: contiene materiales peligrosos.' },
  { n:'Medicamentos', cl:['medicamento','medicina','pastilla','jarabe'], cat:'especiales', e:'💊', c:'Especial: entrégalo en farmacias con programa de acopio.' },
  { n:'Electrónicos', cl:['electronico','celular','cable','audifonos','cargador','raee'], cat:'especiales', e:'📱', c:'Especial: campañas de reciclaje electrónico (RAEE).' },
  { n:'Aceite de cocina', cl:['aceite','grasa'], cat:'especiales', e:'🛢️', c:'Especial: guárdalo en frasco y llévalo a un punto de acopio.' }
];
const CATS_INFO = {
  organicos:   { t:'🟢 Orgánicos', cls:'verde' },
  reciclables: { t:'🔵 Inorgánicos reciclables', cls:'' },
  noreciclables:{ t:'⚫ Inorgánicos no reciclables', cls:'gris' },
  especiales:  { t:'🔴 Residuos especiales', cls:'ambar' }
};
function tokensDe(t){ return normalizar(t).split(/[^a-z0-9ñ]+/).filter(Boolean); }
const inputResiduo = $('#inputResiduo');
let tOutBusq = null;
inputResiduo.addEventListener('input', function(){
  clearTimeout(tOutBusq);
  const q = inputResiduo.value;
  if (!q.trim()){
    $('#resultadosResiduo').innerHTML = '<p class="pista-buscador">✍️ Escribe el nombre de un residuo y te decimos a qué categoría pertenece.</p>';
    $('#estadoBusqueda').textContent = '';
    return;
  }
  tOutBusq = setTimeout(function(){ buscarResiduo(q); }, 200);
});
function buscarResiduo(consulta){
  const tq = tokensDe(consulta);
  const qn = normalizar(consulta);
  const hallados = RESIDUOS.filter(function(r){
    const grupos = r.cl.concat([r.n]);
    return grupos.some(function(clave){
      const cn = normalizar(clave);
      if (cn === qn) return true;
      return tokensDe(clave).some(function(tc){
        return tq.some(function(x){ return tc === x || (x.length >= 3 && tc.indexOf(x) === 0) || (tc.length >= 4 && x.indexOf(tc) === 0); });
      });
    });
  }).slice(0, 6);
  const cont = $('#resultadosResiduo');
  cont.innerHTML = '';
  if (!hallados.length){
    $('#estadoBusqueda').textContent = 'Sin resultados';
    const v = document.createElement('div'); v.className = 'sin-resultados';
    v.innerHTML = '🤔 <strong>No encontramos ese residuo.</strong><br>Consulta las categorías generales o intenta con otra palabra.';
    cont.appendChild(v); return;
  }
  $('#estadoBusqueda').textContent = hallados.length + ' resultado(s)';
  hallados.forEach(function(r, i){
    const info = CATS_INFO[r.cat];
    const el = document.createElement('div'); el.className = 'resultado-residuo'; el.style.animationDelay = (i * 40) + 'ms';
    const em = document.createElement('span'); em.className = 'rr-emoji'; em.textContent = r.e; em.setAttribute('aria-hidden','true');
    const inf = document.createElement('div'); inf.className = 'rr-info';
    const st = document.createElement('strong'); st.textContent = r.n;
    const ch = document.createElement('span'); ch.className = 'chip ' + info.cls; ch.textContent = info.t; ch.style.margin = '.15rem 0'; ch.style.display = 'inline-flex';
    const p = document.createElement('p'); p.style.cssText = 'font-size:.78rem;color:var(--muted)'; p.textContent = r.c;
    inf.append(st, ch, p);
    el.append(em, inf);
    cont.appendChild(el);
  });
}

/* ============================================================
   MÓDULO 18 · REPORTES CIUDADANOS
   ============================================================ */
let reportesLocales = Array.isArray(almacen.datos.reportes) ? almacen.datos.reportes : [];
let publicaciones = Array.isArray(almacen.datos.publicaciones) ? almacen.datos.publicaciones : semillasPublicaciones();
// Sincroniza el estado global con los arrays vivos (perfil, insignias y contexto)
estado.reportes = reportesLocales;
estado.publicaciones = publicaciones;

function semillasPublicaciones(){
  const ahora = Date.now();
  return [
    { id: uid(), ejemplo: true, nombre: 'Cuenta de ejemplo', colonia: 'Centro', tipo: 'Duda', texto: '¿A qué hora pasa la recolección los sábados? En la app puedo revisar la ruta de mi colonia.', ts: ahora - 35*60000, likes: 5, votado: false, comentarios: [] },
    { id: uid(), ejemplo: true, nombre: 'Cuenta de ejemplo', colonia: 'La Floresta', tipo: 'Propuesta', texto: 'Propongo una jornada de limpieza el próximo fin de semana. ¿Quién se apunta?', ts: ahora - 90*60000, likes: 11, votado: false, comentarios: [{autor: 'Comentario de ejemplo', texto: '¡Yo me apunto!', ts: ahora - 60*60000}] },
    { id: uid(), ejemplo: true, nombre: 'Cuenta de ejemplo', colonia: 'El Agustín', tipo: 'Aviso', texto: 'Recuerda separar orgánicos e inorgánicos la noche antes del paso del camión.', ts: ahora - 200*60000, likes: 8, votado: false, comentarios: [] }
  ];
}

/* Ubicación del reporte */
$('#repUsarGPS').addEventListener('click', async function(){
  toast('⏳ Buscando tu ubicación…', 'info', 2200);
  try {
    const loc = await dataLayer.getUserLocation();
    estado.ubicacionReporte = { lat: loc.lat, lng: loc.lng };
    estado._usoUbicacion = true;
    actualizarCoordenadasReporte();
    verificarInsignias();
    toast('✓ Ubicación asignada al reporte.', 'exito');
  } catch(err){
    marcarError('errRepUbic', err.message + ' Puedes elegir el punto en el mapa.');
  }
});
$('#repElegirMapa').addEventListener('click', function(){
  activarElegirMapa('reporte');
});
$('#repQuitarUbicacion').addEventListener('click', function(){
  estado.ubicacionReporte = null;
  if (marcadorSeleccion){ mapa.removeLayer(marcadorSeleccion); marcadorSeleccion = null; }
  actualizarCoordenadasReporte();
});
function actualizarCoordenadasReporte(){
  const el = $('#repCoordenadas');
  if (estado.ubicacionReporte){
    el.textContent = '📍 Ubicación asignada: ' + estado.ubicacionReporte.lat.toFixed(5) + ', ' + estado.ubicacionReporte.lng.toFixed(5);
    limpiarError('errRepUbic');
  } else {
    el.textContent = 'Sin ubicación asignada. El reporte se guardará sin coordenadas.';
  }
}

/* Fotografía */
/* Reduce la foto a un peso ligero (≈120 KB o menos) para que la app siga
   siendo rápida con datos móviles y para no llenar el almacenamiento local. */
function comprimirFoto(img){
  let w = img.width, h = img.height, cal = 0.72;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  for (let intento = 0; intento < 6; intento++){
    if (w > 1000 || h > 1000){ const k = Math.min(1000 / w, 1000 / h); w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }
    cv.width = w; cv.height = h;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const url = cv.toDataURL('image/jpeg', cal);
    if (url.length <= 160 * 1024 || cal <= 0.4) return url;
    cal -= 0.12;
  }
  return cv.toDataURL('image/jpeg', 0.4);
}
$('#repFoto').addEventListener('change', function(){
  limpiarError('errRepFoto');
  const f = this.files && this.files[0];
  estado.fotoData = null;
  $('#fotoPreview').classList.remove('visible');
  if (!f) return;
  if (!/^image\//.test(f.type)){ marcarError('errRepFoto','El archivo no es una imagen válida.'); this.value = ''; return; }
  if (f.size > 5 * 1024 * 1024){ marcarError('errRepFoto','La imagen supera 5 MB. Elige una más ligera.'); this.value = ''; return; }
  const lector = new FileReader();
  lector.onload = function(){
    const img = new Image();
    img.onload = function(){
      try { estado.fotoData = comprimirFoto(img); }
      catch(e){ marcarError('errRepFoto','No se pudo procesar la imagen.'); return; }
      $('#fotoPreviewImg').src = estado.fotoData;
      $('#fotoPreview').classList.add('visible');
    };
    img.onerror = function(){ marcarError('errRepFoto','La imagen no se pudo leer.'); };
    img.src = lector.result;
  };
  lector.onerror = function(){ marcarError('errRepFoto','No se pudo leer el archivo.'); };
  lector.readAsDataURL(f);
});
$('#fotoQuitar').addEventListener('click', function(){
  estado.fotoData = null;
  $('#repFoto').value = '';
  $('#fotoPreview').classList.remove('visible');
});

/* Validación y envío */
$('#repDescripcion').addEventListener('input', function(){
  $('#contadorRep').textContent = this.value.length + ' / 500';
  if (this.value.trim().length >= 15) limpiarError('errRepDesc');
});
$('#repTipo').addEventListener('change', function(){ if (this.value) limpiarError('errRepTipo'); });
$('#repNombre').addEventListener('input', function(){ limpiarError('errRepNombre'); });

function marcarError(id, msg){ const e = $('#' + id); e.textContent = '⚠️ ' + msg; e.classList.add('visible'); }
function limpiarError(id){ $('#' + id).classList.remove('visible'); }

$('#formReporte').addEventListener('submit', function(e){
  e.preventDefault();
  let ok = true;
  const nombre = $('#repNombre').value.trim();
  if (nombre.length > 40){ marcarError('errRepNombre','Máximo 40 caracteres.'); ok = false; } else limpiarError('errRepNombre');
  const tipo = $('#repTipo').value;
  if (!tipo){ marcarError('errRepTipo','Selecciona el tipo de reporte.'); ok = false; } else limpiarError('errRepTipo');
  const desc = $('#repDescripcion').value.trim();
  if (desc.length < 15){ marcarError('errRepDesc','Describe el problema con al menos 15 caracteres.'); ok = false; }
  else if (desc.length > 500){ marcarError('errRepDesc','Máximo 500 caracteres.'); ok = false; }
  else limpiarError('errRepDesc');
  if (!ok){
    toast('Revisa el formulario: hay campos por corregir.', 'error');
    const inv = $('.campo.invalido input, .campo.invalido select, .campo.invalido textarea');
    if (inv) inv.focus();
    return;
  }
  const reporte = {
    id: uid(), nombre: nombre || 'Anónimo', colonia: $('#repColonia').value, tipo: tipo,
    texto: desc, ts: Date.now(), foto: estado.fotoData || null,
    ubicacion: estado.ubicacionReporte ? { lat: estado.ubicacionReporte.lat, lng: estado.ubicacionReporte.lng } : null,
    estado: 'recibido', usuario_id: sesion.usuario ? sesion.usuario.id : null
  };
  dataLayer.createReport(reporte).then(function(){
    registrarAccion('reporte', 'Envió un reporte: ' + tipo, PTS.reporte);
    verificarInsignias();
    toast('✓ Reporte enviado correctamente' + (reporte.estado_sync === 'Sincronizado con la nube' ? ' (sincronizado en la nube).' : ' (guardado en este dispositivo).') + ' Gracias por participar.', 'exito');
    // reset
    e.target.reset();
    aplicarIdentidad(); // el nombre bloqueado vuelve a su valor (no queda en blanco)
    estado.fotoData = null; $('#fotoPreview').classList.remove('visible');
    estado.ubicacionReporte = null; actualizarCoordenadasReporte();
    $('#contadorRep').textContent = '0 / 500';
    renderReportes();
  });
});

function renderReportes(){
  const cont = $('#listaReportes');
  cont.innerHTML = '';
  $('#reportesVacio').classList.toggle('visible', !reportesLocales.length);
  reportesLocales.slice().sort(function(a,b){ return b.ts - a.ts; }).forEach(function(r){
    const art = document.createElement('article'); art.className = 'tarjeta-reporte';
    const cab = document.createElement('div'); cab.className = 'cab-reporte';
    const av = document.createElement('div'); av.className = 'avatar'; av.textContent = iniciales(r.nombre); av.setAttribute('aria-hidden','true');
    const meta = document.createElement('div'); meta.className = 'meta';
    const st = document.createElement('strong'); st.textContent = r.nombre;
    const sm = document.createElement('small'); sm.textContent = tiempoRelativo(r.ts) + ' · ' + r.colonia;
    meta.append(st, sm);
    const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = r.tipo;
    cab.append(av, meta, chip);
    const txt = document.createElement('p'); txt.className = 'txt-reporte'; txt.textContent = r.texto;
    art.append(cab, txt);
    if (r.foto){
      const im = document.createElement('img'); im.className = 'foto-reporte'; im.alt = 'Fotografía del reporte';
      im.loading = 'lazy'; im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
      im.src = r.foto;
      im.addEventListener('error', function(){ if (im.parentNode) im.parentNode.removeChild(im); });
      art.appendChild(im);
    }
    const pie = document.createElement('div'); pie.className = 'pie-reporte';
    const est = document.createElement('span'); est.className = 'chip gris'; est.textContent = (estado._nube ? '☁️ ' : '💾 ') + (r.estado_sync || 'copia local');
    pie.appendChild(est);
    // Estado de seguimiento: lo cambia la moderación, no quien reportó.
    const info = ESTADOS_REPORTE[r.estado] || ESTADOS_REPORTE.recibido;
    const seg = document.createElement('span'); seg.className = 'chip ' + info.chip;
    seg.textContent = '📋 ' + info.txt;
    seg.title = 'Estado del seguimiento. Solo el equipo del proyecto puede cambiarlo.';
    pie.appendChild(seg);
    if (r.oculto){
      const oc = document.createElement('span'); oc.className = 'chip gris'; oc.textContent = '🚫 Oculto por moderación';
      pie.appendChild(oc);
    }
    if (r.ubicacion){
      const ub = document.createElement('span'); ub.className = 'chip';
      ub.textContent = '📍 Aprox. ' + Number(r.ubicacion.lat).toFixed(3) + ', ' + Number(r.ubicacion.lng).toFixed(3) + ' (±100 m)';
      ub.title = 'La ubicación se difumina antes de guardarse para no publicar la dirección exacta de quien reportó.';
      pie.appendChild(ub);
    }
    const bDel = document.createElement('button'); bDel.type = 'button'; bDel.className = 'btn-eliminar'; bDel.style.marginLeft = 'auto';
    bDel.setAttribute('aria-label','Eliminar reporte'); bDel.title = 'Eliminar reporte';
    const sv = document.createElementNS('http://www.w3.org/2000/svg','svg'); sv.setAttribute('class','icono');
    const us = document.createElementNS('http://www.w3.org/2000/svg','use'); us.setAttribute('href','#i-basura');
    sv.appendChild(us); bDel.appendChild(sv);
    bDel.addEventListener('click', function(){
      const esMio = !!(sesion.usuario && r.usuario_id && r.usuario_id === sesion.usuario.id);
      confirmarAccion(
        '¿Eliminar reporte?',
        esMio
          ? 'Se borrará de este dispositivo y de la nube. Esta acción no se puede deshacer.'
          : 'No publicaste este reporte con tu cuenta, así que solo se borrará de este dispositivo: seguirá visible para el resto de la comunidad. Puedes pedir a la moderación que lo oculte.',
        'Sí, eliminar'
      ).then(function(okDel){
        if (!okDel) return;
        borrarEnNube('reportes', r).then(function(res){
          reportesLocales = reportesLocales.filter(function(x){ return x.id !== r.id; });
          estado.reportes = reportesLocales; // mantiene la referencia sincronizada tras el filtro
          estado.eliminadosRep.push(r.id); almacen.datos.eliminadosRep = estado.eliminadosRep;
          almacen.datos.reportes = reportesLocales; guardar();
          renderReportes(); verificarInsignias();
          if (res.ok) toast('🗑️ Reporte eliminado de este dispositivo y de la nube.', 'info');
          else if (res.motivo === 'sin-conexion') toast('💾 Eliminado aquí, pero sin conexión no se pudo borrar en la nube.', 'alerta', 5000);
          else if (res.motivo === 'sin-cuenta') toast('💾 Eliminado solo de este dispositivo (sigue visible en la nube).', 'alerta', 5000);
          else toast('💾 Eliminado de este dispositivo. La nube no lo confirmó.', 'alerta', 5000);
        });
      });
    });
    pie.appendChild(bDel);
    art.appendChild(pie);
    cont.appendChild(art);
  });
}

/* ============================================================
   MÓDULO 19 · COMUNIDAD
   ============================================================ */
$('#postTexto').addEventListener('input', function(){ $('#contadorPost').textContent = this.value.length + ' / 500'; });
$('#postNombre').addEventListener('input', function(){ limpiarError('errPostNombre'); });
$('#postTipo').addEventListener('change', function(){ if (this.value) limpiarError('errPostTipo'); });

$('#formPost').addEventListener('submit', function(e){
  e.preventDefault();
  let ok = true;
  const nombre = $('#postNombre').value.trim();
  if (nombre.length > 40){ marcarError('errPostNombre','Máximo 40 caracteres.'); ok = false; } else limpiarError('errPostNombre');
  const tipo = $('#postTipo').value;
  if (!tipo){ marcarError('errPostTipo','Selecciona un tipo.'); ok = false; } else limpiarError('errPostTipo');
  const texto = $('#postTexto').value.trim();
  if (texto.length < 10){ marcarError('errPostTexto','Escribe al menos 10 caracteres.'); ok = false; }
  else if (texto.length > 500){ marcarError('errPostTexto','Máximo 500 caracteres.'); ok = false; }
  else limpiarError('errPostTexto');
  if (!ok){ toast('Revisa el formulario antes de publicar.', 'error'); return; }

  const post = { id: uid(), ejemplo: false, nombre: nombre || 'Anónimo', colonia: (ZONAS[estado.coloniaId] || {}).nombre || 'Ciudad Guzmán', tipo: tipo, texto: texto, ts: Date.now(), likes: 0, votado: false, comentarios: [], usuario_id: sesion.usuario ? sesion.usuario.id : null };
  dataLayer.createPost(post).then(function(){
    registrarAccion('participacion', 'Publicó en la comunidad', PTS.participacion);
    toast('✓ Publicación realizada' + (post._nube ? ' y compartida en la nube.' : ' (guardada en este dispositivo).') + ' ¡Gracias por participar!', 'exito');
    e.target.reset();
    $('#contadorPost').textContent = '0 / 500';
    aplicarIdentidad(); // el nombre bloqueado vuelve a su valor (no queda en blanco)
    renderMuro();
  });
});

function nodoPost(p){
  const art = document.createElement('article'); art.className = 'publicacion'; art.dataset.id = p.id;
  const cab = document.createElement('div'); cab.className = 'pub-cab';
  const av = document.createElement('div'); av.className = 'avatar'; av.textContent = iniciales(p.nombre); av.style.background = p.ejemplo ? 'var(--muted)' : 'var(--primary)';
  const meta = document.createElement('div'); meta.className = 'meta';
  const st = document.createElement('strong'); st.textContent = p.nombre;
  const sm = document.createElement('small'); sm.textContent = tiempoRelativo(p.ts) + ' · ' + p.colonia;
  meta.append(st, sm);
  const chT = document.createElement('span'); chT.className = 'chip'; chT.textContent = p.tipo;
  cab.append(av, meta, chT);
  if (p.ejemplo){ const chE = document.createElement('span'); chE.className = 'chip gris'; chE.textContent = 'Ejemplo'; cab.appendChild(chE); }
  const tx = document.createElement('p'); tx.className = 'txt-post'; tx.textContent = p.texto;
  art.append(cab, tx);

  const pie = document.createElement('div'); pie.className = 'pub-pie';
  const bLike = document.createElement('button'); bLike.type = 'button'; bLike.className = 'btn-accion' + (p.votado ? ' votado' : '');
  bLike.setAttribute('aria-label', p.votado ? 'Ya apoyaste esta publicación' : 'Me importa esta publicación');
  const icL = document.createElementNS('http://www.w3.org/2000/svg','svg'); icL.setAttribute('class','icono');
  const uL = document.createElementNS('http://www.w3.org/2000/svg','use'); uL.setAttribute('href','#i-like');
  icL.appendChild(uL);
  const num = document.createElement('span'); num.textContent = String(p.likes);
  bLike.append(icL, document.createTextNode(' Me importa '), num);
  bLike.addEventListener('click', function(){
    if (p.votado){ toast('Ya registraste tu apoyo. 💚', 'info', 2400); return; }
    const antes = p.likes;
    p.likes += 1; p.votado = true;   // optimista: se ve al instante
    renderMuro();
    dataLayer.votePost(p.id).then(function(res){
      if (res.ok){ registrarAccion('participacion', 'Apoyó una publicación', PTS.ayuda); renderMuro(); return; }
      if (res.error === 'ya'){ toast('Ya habías apoyado esto desde este dispositivo.', 'info', 3000); renderMuro(); return; }
      p.likes = antes; p.votado = false;
      renderMuro();
      toast(res.error, 'error', 4200);
    });
  });
  const bCom = document.createElement('button'); bCom.type = 'button'; bCom.className = 'btn-accion';
  const icC = document.createElementNS('http://www.w3.org/2000/svg','svg'); icC.setAttribute('class','icono');
  const uC = document.createElementNS('http://www.w3.org/2000/svg','use'); uC.setAttribute('href','#i-comentar');
  icC.appendChild(uC);
  bCom.append(icC, document.createTextNode(' Comentar (' + (p.comentarios || []).length + ')'));
  bCom.addEventListener('click', function(){ $('#com-' + p.id).classList.toggle('abiertos'); });
  const bSh = document.createElement('button'); bSh.type = 'button'; bSh.className = 'btn-accion';
  const icS = document.createElementNS('http://www.w3.org/2000/svg','svg'); icS.setAttribute('class','icono');
  const uS = document.createElementNS('http://www.w3.org/2000/svg','use'); uS.setAttribute('href','#i-compartir');
  icS.appendChild(uS);
  bSh.append(icS, document.createTextNode(' Compartir'));
  bSh.addEventListener('click', function(){ compartirPost(p); });
  pie.append(bLike, bCom, bSh);
  // Solo quien la publicó puede borrarla (y la base de datos lo comprueba).
  if (sesion.usuario && p.usuario_id && p.usuario_id === sesion.usuario.id){
    const bOwn = document.createElement('button'); bOwn.type = 'button'; bOwn.className = 'btn-accion';
    const icD = document.createElementNS('http://www.w3.org/2000/svg','svg'); icD.setAttribute('class','icono');
    const usD = document.createElementNS('http://www.w3.org/2000/svg','use'); usD.setAttribute('href','#i-basura');
    icD.appendChild(usD);
    bOwn.appendChild(icD, document.createTextNode(' Borrar'));
    bOwn.addEventListener('click', function(){
      confirmarAccion('¿Borrar tu publicación?', 'Se eliminará de la nube y de este dispositivo, junto con sus comentarios y sus "me importa". No se puede deshacer.', 'Sí, borrar').then(function(ok){
        if (!ok) return;
        borrarEnNube('publicaciones', p).then(function(res){
          publicaciones = publicaciones.filter(function(x){ return x.id !== p.id; });
          almacen.datos.publicaciones = publicaciones; guardar();
          renderMuro();
          toast(res.ok ? '🗑️ Publicación borrada.' : '💾 Se quitó de este dispositivo, pero la nube no confirmó el borrado.', 'info', 4200);
        });
      });
    });
    pie.appendChild(bOwn);
  }
  art.appendChild(pie);

  const com = document.createElement('div'); com.className = 'comentarios'; com.id = 'com-' + p.id;
  (p.comentarios || []).forEach(function(c){
    const fila = document.createElement('div'); fila.className = 'comentario';
    const a = document.createElement('strong'); a.textContent = c.autor + ':';
    const t = document.createElement('span'); t.className = 'c-txt'; t.textContent = ' ' + c.texto;
    fila.append(a, t);
    if (c.local){
      const chip = document.createElement('span'); chip.className = 'chip gris'; chip.style.marginLeft = '.35rem';
      chip.textContent = 'copia local'; fila.appendChild(chip);
    }
    com.appendChild(fila);
  });
  const fCom = document.createElement('form'); fCom.className = 'comentario-form';
  const inC = document.createElement('input'); inC.type = 'text'; inC.maxLength = 200; inC.placeholder = 'Escribe un comentario…'; inC.setAttribute('aria-label','Escribir comentario');
  const bEn = document.createElement('button'); bEn.type = 'submit'; bEn.className = 'btn btn-secundario btn-chico'; bEn.textContent = 'Enviar';
  fCom.append(inC, bEn);
  fCom.addEventListener('submit', function(ev){
    ev.preventDefault();
    const t = inC.value.trim();
    if (t.length < 2){ toast('Escribe un comentario más largo.', 'error', 2400); return; }
    // Sin conexión: se guarda solo aquí y se etiqueta como copia local.
    if (!estado._nube){
      p.comentarios = p.comentarios || [];
      p.comentarios.push({ autor: nombreFirma(), texto: t, ts: Date.now(), local: true });
      almacen.datos.publicaciones = publicaciones; guardar();
      estado._numComentarios = (estado._numComentarios || 0) + 1;
      registrarAccion('participacion', 'Comentó en una publicación', PTS.ayuda);
      inC.value = '';
      renderMuro();
      setTimeout(function(){ const el = $('#com-' + p.id); if (el) el.classList.add('abiertos'); }, 50);
      toast('Comentario guardado en este dispositivo (copia local).', 'info');
      return;
    }
    inC.value = ''; bEn.disabled = true;
    rpcNube('crear_comentario', { p_publicacion_id: p.id, p_texto: t, p_autor: nombreFirma(), p_huella: huellaDispositivo() })
      .then(function(r){
        bEn.disabled = false;
        if (!r.ok){ toast(mensajeComentario(r), 'error', 4200); return; }
        const c = r.data || {};
        p.comentarios = p.comentarios || [];
        p.comentarios.push({ id: c.id, autor: c.autor || nombreFirma(), texto: c.texto || t, ts: Number(c.ts) || Date.now(), propio: true });
        almacen.datos.publicaciones = publicaciones; guardar();
        estado._numComentarios = (estado._numComentarios || 0) + 1;
        registrarAccion('participacion', 'Comentó en una publicación', PTS.ayuda);
        renderMuro();
        setTimeout(function(){ const el = $('#com-' + p.id); if (el) el.classList.add('abiertos'); }, 50);
      });
  });
  com.appendChild(fCom);
  art.appendChild(com);
  return art;
}

function renderMuro(){
  const muro = $('#muro');
  muro.innerHTML = '';
  $('#muroVacio').classList.toggle('visible', !publicaciones.length);
  publicaciones.slice().sort(function(a,b){ return b.ts - a.ts; }).forEach(function(p){ muro.appendChild(nodoPost(p)); });
}

function compartirPost(p){
  const texto = p.nombre + ' (' + p.tipo + ') · ' + p.colonia + ':\n\n' + p.texto + '\n\n— Compartido desde BASURA Y MÁS';
  if (navigator.share){
    const urlSitio = (location.protocol === 'http:' || location.protocol === 'https:') ? location.href.split('#')[0] : null;
    navigator.share({ title: 'BASURA Y MÁS', text: texto, url: urlSitio || undefined }).catch(function(){ /* cancelado por el usuario */ });
  } else {
    $('#shareTexto').value = texto;
    abrirModal('modalShare');
  }
}
$('#btnCopiarShare').addEventListener('click', function(){
  const ta = $('#shareTexto');
  ta.select();
  try {
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value);
    else document.execCommand('copy');
    toast('📋 Texto copiado.', 'exito', 2400);
    cerrarModal('modalShare');
  } catch(e){ toast('Selecciona el texto y cópialo manualmente.', 'alerta'); }
});

/* ============================================================
   MÓDULO 20 · PERFIL / CONFIG / RESET
   ============================================================ */
$('#formPerfil').addEventListener('submit', function(e){
  e.preventDefault();
  const n = $('#pNombre').value.trim();
  if (n.length > 40){ marcarError('errPNombre','Máximo 40 caracteres.'); return; }
  limpiarError('errPNombre');
  estado.nombrePerfil = n || 'Anónimo';
  almacen.datos.nombrePerfil = estado.nombrePerfil; guardar();
  if (!sesion.usuario) aplicarIdentidad(); // con sesión activa el nombre lo manda la cuenta
  renderPerfil();
  toast('✓ Perfil actualizado.', 'exito');
});

/* ============================================================
   MÓDULO 20b · CUENTA: EVENTOS DE INTERFAZ
   ============================================================ */
$('#btnCuenta').addEventListener('click', function(){ pintarModalCuenta(); abrirModal('modalCuenta'); });
function pintarModalCuenta(){
  const con = !!sesion.usuario;
  $('#cuentaSinSesion').hidden = con;
  $('#cuentaConSesion').hidden = !con;
  $('#formLogin').hidden = true; $('#formRegistro').hidden = true;
  limpiarError('errLoginEmail'); limpiarError('errLoginPass'); limpiarError('errLoginGeneral');
  limpiarError('errRegNombre'); limpiarError('errRegEmail'); limpiarError('errRegPass'); limpiarError('errRegGeneral');
  if (con){
    $('#cuentaNombreTxt').textContent = sesion.usuario.nombre || 'Vecino';
    $('#cuentaEmailTxt').textContent = sesion.usuario.email || '';
    $('#cuentaAvatar').textContent = iniciales(sesion.usuario.nombre || 'V');
    $('#cuentaChipSesion').textContent = 'Sesión activa';
    $('#cuentaNuevoNombre').value = sesion.usuario.nombre || '';
  }
}
$('#btnVerLogin').addEventListener('click', function(){ $('#formLogin').hidden = false; $('#formRegistro').hidden = true; $('#cLoginEmail').focus(); });

/* --- Recuperación de contraseña --- */
let tokenRecuperacion = null;
$('#btnOlvidePass').addEventListener('click', function(){
  const email = $('#cLoginEmail').value.trim();
  if (!email){ marcarError('errLoginEmail','Escribe tu correo para enviarte el enlace.'); return; }
  limpiarError('errLoginEmail'); limpiarError('errLoginGeneral');
  const btn = this; btn.disabled = true;
  pedirRecuperacion(email).then(function(res){
    btn.disabled = false;
    if (!res.ok){ marcarError('errLoginGeneral', res.error); return; }
    toast('📧 Si ' + email + ' tiene cuenta, recibirás un enlace para crear una contraseña nueva.', 'exito', 6000);
  });
});
$('#formNuevaPass').addEventListener('submit', function(e){
  e.preventDefault();
  const p1 = $('#npPass1').value, p2 = $('#npPass2').value;
  if (p1.length < 6){ marcarError('errNuevaPass','La contraseña necesita al menos 6 caracteres.'); return; }
  if (p1 !== p2){ marcarError('errNuevaPass','Las dos contraseñas no coinciden.'); return; }
  limpiarError('errNuevaPass');
  if (!tokenRecuperacion){ marcarError('errNuevaPass','Este enlace ya venció. Pide uno nuevo desde "Iniciar sesión".'); return; }
  const btn = $('#btnGuardarPass'); btn.disabled = true; btn.textContent = 'Guardando…';
  cambiarPassword(tokenRecuperacion, p1).then(function(res){
    btn.disabled = false; btn.textContent = 'Guardar contraseña';
    if (!res.ok){ marcarError('errNuevaPass', res.error); return; }
    tokenRecuperacion = null;
    $('#npPass1').value = ''; $('#npPass2').value = '';
    cerrarModal('modalNuevaPass');
    toast('🔑 Contraseña actualizada. Ya puedes iniciar sesión.', 'exito', 5200);
  });
});
$('#btnVerRegistro').addEventListener('click', function(){ $('#formRegistro').hidden = false; $('#formLogin').hidden = true; $('#cRegNombre').focus(); });

$('#formLogin').addEventListener('submit', function(e){
  e.preventDefault();
  const email = $('#cLoginEmail').value.trim(), pass = $('#cLoginPass').value;
  if (!email){ marcarError('errLoginEmail','Escribe tu correo.'); return; } limpiarError('errLoginEmail');
  if (!pass){ marcarError('errLoginPass','Escribe tu contraseña.'); return; } limpiarError('errLoginPass');
  const btn = $('#btnLogin'); btn.disabled = true; btn.textContent = 'Entrando…';
  iniciarSesion(email, pass).then(function(res){
    btn.disabled = false; btn.textContent = 'Entrar';
    if (!res.ok){ marcarError('errLoginGeneral', res.error); return; }
    aplicarIdentidad(); pintarModalCuenta(); renderPerfil();
    cerrarModal('modalCuenta');
    toast('👋 ¡Bienvenido de vuelta, ' + nombreFirma() + '!', 'exito', 4200);
  });
});

$('#formRegistro').addEventListener('submit', function(e){
  e.preventDefault();
  const nombre = $('#cRegNombre').value.trim(), email = $('#cRegEmail').value.trim(), pass = $('#cRegPass').value;
  if (nombre.length > 40){ marcarError('errRegNombre','Máximo 40 caracteres.'); return; } limpiarError('errRegNombre');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ marcarError('errRegEmail','Escribe un correo válido.'); return; } limpiarError('errRegEmail');
  if (pass.length < 6){ marcarError('errRegPass','La contraseña necesita al menos 6 caracteres.'); return; } limpiarError('errRegPass');
  const btn = $('#btnRegistro'); btn.disabled = true; btn.textContent = 'Creando…';
  crearCuenta(nombre, email, pass).then(function(res){
    btn.disabled = false; btn.textContent = 'Crear mi cuenta';
    if (!res.ok){ marcarError('errRegGeneral', res.error); return; }
    marcarOnboardingVisto();
    aplicarIdentidad(); pintarModalCuenta(); renderPerfil();
    cerrarModal('modalCuenta');
    lanzarConfeti();
    toast('🎉 ¡Cuenta creada! Ahora participas como ' + nombreFirma() + '.', 'logro', 5200);
  });
});

$('#formCuentaNombre').addEventListener('submit', function(e){
  e.preventDefault();
  if (!sesion.usuario) return;
  const n = $('#cuentaNuevoNombre').value.trim();
  if (n.length > 40){ marcarError('errCuentaNombre','Máximo 40 caracteres.'); return; }
  if (!n){ marcarError('errCuentaNombre','Escribe un nombre.'); return; }
  limpiarError('errCuentaNombre');
  sesion.usuario.nombre = n;
  estado.nombrePerfil = n; almacen.datos.nombrePerfil = n; guardar();
  fetch(NUBE.url + 'perfiles?id=eq.' + sesion.usuario.id, {
    method: 'PATCH', headers: cabecerasNube({ 'Prefer': 'return=minimal' }), body: JSON.stringify({ nombre: n, nombre_edicado: true })
  }).catch(function(){});
  sesion.usuario.nombreElegido = true;
  aplicarIdentidad(); pintarModalCuenta(); renderPerfil();
  toast('✓ Nombre actualizado: ' + n, 'exito');
});

$('#btnCerrarSesion').addEventListener('click', function(){
  confirmarAccion('¿Cerrar sesión?', 'Dejarás de firmar con tu cuenta y volverás a participar como invitado. Tus publicaciones anteriores conservan tu nombre.', 'Sí, cerrar sesión').then(function(ok){
    if (!ok) return;
    cerrarSesion(); pintarModalCuenta(); renderPerfil();
  });
});

/* --- Bienvenida de primera visita (onboarding) --- */
function verOnboarding(){
  if (!almacen.ok) return false;
  try { return localStorage.getItem('bym.onboarding.v1') === 'visto'; } catch(e){ return true; }
}
function marcarOnboardingVisto(){
  try { localStorage.setItem('bym.onboarding.v1', 'visto'); } catch(e){}
}
$('#btnBienvenidaCrear').addEventListener('click', function(){
  marcarOnboardingVisto();
  cerrarModal('modalBienvenida');
  pintarModalCuenta(); $('#formRegistro').hidden = false;
  abrirModal('modalCuenta');
  setTimeout(function(){ $('#cRegNombre').focus(); }, 60);
});
$('#btnBienvenidaLogin').addEventListener('click', function(){
  marcarOnboardingVisto();
  cerrarModal('modalBienvenida');
  pintarModalCuenta(); $('#formLogin').hidden = false;
  abrirModal('modalCuenta');
  setTimeout(function(){ $('#cLoginEmail').focus(); }, 60);
});
$('#btnBienvenidaInvitado').addEventListener('click', function(){
  marcarOnboardingVisto();
  cerrarModal('modalBienvenida');
  toast('Exploras como invitado. Cuando quieras, crea tu cuenta desde 👤 arriba.', 'info', 4200);
});
$('#btnAbrirCuentaPerfil').addEventListener('click', function(){
  pintarModalCuenta();
  if (!sesion.usuario) $('#formRegistro').hidden = false;
  abrirModal('modalCuenta');
});
// Si la bienvenida se cierra con Escape o clic en el fondo, no molestar de nuevo
$('#modalBienvenida').addEventListener('click', function(e){ if (e.target === this) marcarOnboardingVisto(); });
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && $('#modalBienvenida').classList.contains('abierto')) marcarOnboardingVisto();
});
$('#cfgColonia').addEventListener('change', function(){ seleccionarColonia(this.value, true); });

$('#btnConfig').addEventListener('click', function(){
  $('#cfgTema').checked = estado.tema === 'dark';
  $('#cfgNotif').checked = estado.notif;
  $('#cfgColonia').value = estado.coloniaId;
  $('#cfgDemo').checked = estado.demo;
  abrirModal('modalConfig');
});
/* ---------- Las tres páginas de información ----------
   Se muestran desde el engranaje (Configuración) y también desde los
   enlaces del pie de página: nada de esto queda escondido. */
function mostrarAcerca(){
  mostrarInfo('Acerca del proyecto', [
    '<strong>BASURA Y MÁS</strong> es una plataforma cívica y ecológica desarrollada como proyecto de <strong>Filosofía II (FILOSOFARTE)</strong> por <strong>Daniel Alvarez</strong> para el <strong>CBTis 226</strong>.',
    'Propone una forma de conectar a la ciudadanía de <strong>Ciudad Guzmán, Jalisco</strong> con la información de recolección, la separación de residuos y la participación comunitaria.',
    'Fuentes de datos: mapa y vialidades de <strong>OpenStreetMap</strong>, rutas calculadas con <strong>OSRM</strong>, geocodificación con <strong>Nominatim</strong>. Los puntos de recolección son <strong>generados por el sistema</strong> sobre las calles reales de toda la ciudad y sobre la ruta de cada colonia (cada 400 m aprox.); no son contenedores municipales confirmados, y el GPS de vehículos <strong>no está conectado</strong>; cuando exista una fuente municipal, la app está preparada para integrarla.',
    '<strong>Lo que NO hace:</strong> no está conectada a ningún sistema del municipio, no manda correos ni notificaciones automáticas, y no recoge datos personales de terceros. No inventa horarios ni tarifas que no estén en las fuentes citadas.',
    '<strong>Código abierto:</strong> todo el proyecto está en <a href="https://github.com/Daniel3557/basura-y-mas" target="_blank" rel="noopener noreferrer">GitHub</a>.',
    '“El progreso sin conciencia no es progresión.”'
  ]);
}
function mostrarPrivacidad(){
  mostrarInfo('Política de privacidad', [
    '<strong>Qué Guardamos:</strong> lo que tú escribes (reportes y publicaciones), un nombre o apodo opcional, y la ubicación <em>si</em> decides adjuntarla a un reporte. Nada más.',
    '<strong>Ubicación:</strong> solo se pide cuando la activas y se usa para calcular rutas cercanas o situar un reporte. Se envía a OpenStreetMap/Mapbox para calcular rutas y a Supabase si adjuntas un reporte. <strong>El punto exacto no se guarda nunca:</strong> la coordenada se redondea a unos 100 metros antes de escribirla, así que no se puede deducir la dirección de tu casa.',
    '<strong>Fotografías:</strong> las eliges tú con el botón de la cámara; se reducen de tamaño y se guardan junto con tu reporte, en este dispositivo y en la nube.',
    '<strong>Tu cuenta:</strong> puedes crearla con tu correo (Supabase Auth) o participar sin cuenta como invitado o anónimo. El correo <strong>nunca se muestra</strong> a los demás: tu nombre público es el que elegiste o, si no elegiste, “Vecino”.',
    '<strong>Tus datos y los de otros:</strong> puedes borrar tu propia publicación y tu propio reporte desde la app. No puedes borrar ni editar lo de otras personas, ni el contenido que el equipo del proyecto haya moderado.',
    '<strong>Dónde viven:</strong> en una base de datos Supabase (PostgreSQL) con políticas de seguridad a nivel de fila, y también en tu navegador (para que la app funcione sin conexión). Puedes borrar lo local en <em>Configuración → Restablecer datos locales</em>.',
    '<strong>Eco y la IA:</strong> si preguntas algo que las reglas de la app no saben, tu pregunta y los datos que la app ya te enseña (colonias, guía de residuos, tus puntos y el nombre del punto más cercano) se mandan al servidor de la aplicación, que los pasa a un modelo de lenguaje de NVIDIA para redactar la respuesta. <strong>Nunca</strong> se envían tu nombre, tu correo ni tus coordenadas. La clave de ese servicio está en el servidor y no se puede leer desde el navegador. Si el servidor no está disponible, Eco contesta solo con las reglas de la app.',
    '<strong>Cuando preguntas por tu actividad:</strong> si escribes algo como "¿en qué colonia he reportado más?", Eco puede consultar tus propios reportes y publicaciones, tus acciones y tus insignias. Solo se consulta en ese caso: preguntar por un residuo o por un horario no manda nada tuyo. Lo que vuelve al servidor son resúmenes ya contados (por ejemplo "por colonia: Centro 3, La Floresta 1") y, si se necesitan, hasta 110 caracteres del texto de tus últimos reportes. <strong>No</strong> sale tu nombre de perfil, tu correo ni las coordenadas. Cuando esto ocurre, el chat lo escribe debajo de la respuesta.',
    '<strong>Errores de la app:</strong> si el proyecto activa <span title="Sentry, servicio de seguimiento de errores">Sentry</span> para detectar fallos técnicos, se envían solo el tipo de error y el navegador. <strong>Nunca</strong> se envía tu nombre, tu correo ni el texto de lo que escribes. Ahora mismo está <strong>desactivado</strong>: no se envía nada a ningún servicio de ese tipo.',
    '<strong>Consejo:</strong> comparte responsablemente; no publiques datos sensibles de otras personas. Si ves algo que no debería estar publicado, dilo por el enlace de contacto y lo ocultamos.'
  ]);
}
$('#btnAcerca').addEventListener('click', function(){ cerrarModal('modalConfig'); mostrarAcerca(); });
$('#btnPrivacidad').addEventListener('click', function(){ cerrarModal('modalConfig'); mostrarPrivacidad(); });
$('#linkAcerca').addEventListener('click', mostrarAcerca);
$('#linkPrivacidad').addEventListener('click', mostrarPrivacidad);
$('#linkContacto').addEventListener('click', function(){ $('#btnContacto').click(); });
$('#btnResetDatos').addEventListener('click', function(){
  confirmarAccion('¿Restablecer datos locales?',    'Se borrarán perfil, puntos, insignias y los datos locales de este dispositivo. Los reportes y publicaciones ya sincronizados con la nube permanecerán en la base de datos. La app volverá a su estado inicial.','Sí, restablecer').then(function(ok){
    if (!ok) return;
    almacen.borrar();
    try { localStorage.removeItem('bym.osm.v1'); } catch(e){}
    location.reload();
  });
});

/* ============================================================
   MÓDULO 20c · MODERACIÓN, EXPORTACIÓN Y BORRADO PROPIO
   ------------------------------------------------------------
   · El panel solo aparece si la base de datos dice que la cuenta es
     administradora (función es_admin). Ocultar el botón NO es la
     protección: cada acción vuelve a preguntárselo al servidor.
   · El CSV se genera en el navegador con los datos que la app ya
     tiene; no hace falta ninguna clave secreta para hacerlo.
   ============================================================ */

/* ---------- ¿Esta cuenta administra el proyecto? ---------- */
function comprobarAdmin(){
  if (!sesion.usuario) { estado._admin = false; mostrarBotonModeracion(false); return Promise.resolve(false); }
  return rpcNube('es_admin', {}).then(function(r){
    estado._admin = !!(r.ok && r.data === true);
    mostrarBotonModeracion(estado._admin);
    if (estado._admin && estado.vista === 'moderacion') renderModeracion();
    return estado._admin;
  }).catch(function(){ estado._admin = false; mostrarBotonModeracion(false); return false; });
}
function mostrarBotonModeracion(visible){
  const b = $('#btnIrModeracion');
  if (b) b.hidden = !visible;
}

/* ---------- Panel ---------- */
let modFilas = { reportes: [], publicaciones: [] };
function renderModeracion(){
  const contR = $('#modReportes'), contP = $('#modPublicaciones');
  if (!contR) return;
  contR.innerHTML = ''; contP.innerHTML = '';
  $('#modReportesVacio').classList.toggle('visible', !modFilas.reportes.length);
  $('#modPublicacionesVacio').classList.toggle('visible', !modFilas.publicaciones.length);

  const ocultos = modFilas.reportes.concat(modFilas.publicaciones).filter(function(f){ return f.oculto; }).length;
  const pendientes = modFilas.reportes.filter(function(f){ return f.estado !== 'atendido'; }).length;
  $('#modResumen').textContent = modFilas.reportes.length + ' reportes · ' + modFilas.publicaciones.length + ' publicaciones · ' + pendientes + ' sin atender · ' + ocultos + ' ocultos';

  modFilas.reportes.forEach(function(f){ contR.appendChild(nodoModeracion(f, 'reportes')); });
  modFilas.publicaciones.forEach(function(f){ contP.appendChild(nodoModeracion(f, 'publicaciones')); });
}

function nodoModeracion(f, tabla){
  const art = document.createElement('article'); art.className = 'tarjeta-reporte';
  const cab = document.createElement('div'); cab.className = 'cab-reporte';
  const meta = document.createElement('div'); meta.className = 'meta';
  const st = document.createElement('strong'); st.textContent = f.nombre || 'Anónimo';
  const sm = document.createElement('small'); sm.textContent = tiempoRelativo(f.ts) + ' · ' + f.colonia + ' · ' + (tabla === 'reportes' ? 'Reporte' : 'Publicación');
  meta.append(st, sm);
  cab.append(meta);
  const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = f.tipo;
  cab.appendChild(chip);
  if (f.oculto){
    const oc = document.createElement('span'); oc.className = 'chip gris'; oc.textContent = '🚫 Oculto';
    cab.appendChild(oc);
  }
  art.appendChild(cab);
  const txt = document.createElement('p'); txt.className = 'txt-reporte'; txt.textContent = f.texto;
  art.appendChild(txt);

  const pie = document.createElement('div'); pie.className = 'pie-reporte';
  pie.style.gap = '.4rem';

  if (tabla === 'reportes'){
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Estado de seguimiento del reporte');
    sel.style.cssText = 'border:2px solid var(--border-strong);border-radius:var(--radius-sm);padding:.35rem .5rem;background:var(--card);font-size:.8rem';
    Object.keys(ESTADOS_REPORTE).forEach(function(k){
      const o = document.createElement('option'); o.value = k; o.textContent = ESTADOS_REPORTE[k].txt;
      if (f.estado === k) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function(){
      rpcNube('marcar_seguimiento', { p_id: f.id, p_estado: this.value }).then(function(r){
        if (!r.ok){ toast('No se pudo cambiar el estado.', 'error'); sel.value = f.estado; return; }
        f.estado = this.value; renderModeracion();
        toast('📋 Reporte marcado como ' + ESTADOS_REPORTE[this.value].txt.toLowerCase() + '.', 'exito');
      }.bind(this));
    });
    pie.appendChild(sel);
  } else {
    const info = document.createElement('span'); info.className = 'chip gris';
    info.textContent = '💚 ' + (f.likes || 0) + ' · 💬 ' + (f.n_comentarios || 0);
    pie.appendChild(info);
  }

  const bOcultar = document.createElement('button');
  bOcultar.type = 'button'; bOcultar.className = 'btn btn-secundario btn-chico';
  const svO = document.createElementNS('http://www.w3.org/2000/svg','svg'); svO.setAttribute('class','icono');
  const usO = document.createElementNS('http://www.w3.org/2000/svg','use'); usO.setAttribute('href', f.oculto ? '#i-ojo' : '#i-x');
  svO.appendChild(usO);
  bOcultar.appendChild(svO, document.createTextNode(f.oculto ? ' Mostrar' : ' Ocultar'));
  bOcultar.addEventListener('click', function(){
    const nuevo = !f.oculto;
    rpcNube('moderar', { p_tabla: tabla, p_id: f.id, p_oculto: nuevo, p_motivo: nuevo ? 'Revisión manual del equipo del proyecto' : null }).then(function(r){
      if (!r.ok){ toast('No se pudo cambiar la visibilidad.', 'error'); return; }
      f.oculto = nuevo;
      toast(nuevo ? '🚫 Contenido oculto de la vista pública (se conserva).' : '✅ Contenido visible de nuevo.', 'exito');
      renderModeracion();
      ssyncReportes(); ssyncPublicaciones();
    });
  });
  pie.appendChild(bOcultar);
  art.appendChild(pie);
  return art;
}

function cargarModeracion(){
  if (!estado._admin) return Promise.resolve();
  return rpcNube('pendientes_moderacion', {}).then(function(r){
    if (!r.ok || !Array.isArray(r.data)) return;
    modFilas = { reportes: [], publicaciones: [] };
    r.data.forEach(function(f){
      (f.tabla === 'reportes' ? modFilas.reportes : modFilas.publicaciones).push({
        id: f.id, nombre: f.nombre, colonia: f.colonia, tipo: f.tipo, texto: f.texto,
        estado: f.estado, oculto: f.oculto, oculto_motivo: f.oculto_motivo, usuario_id: f.usuario_id, ubicacion: f.ubicacion || '',
        likes: f.likes, n_comentarios: f.n_comentarios, ts: Number(f.ts)
      });
    });
    if (estado.vista === 'moderacion') renderModeracion();
  });
}

/* ---------- Exportar CSV (sin claves, todo en el navegador) ---------- */
function escaparCSV(valor){
  const s = String(valor === null || valor === undefined ? '' : valor);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function descargarCSV(nombre, cabeceras, filas){
  // Punto y coma como separador: es lo que Excel en español abre solo.
  const cuerpo = [cabeceras.join(';')].concat(filas.map(function(f){ return f.map(escaparCSV).join(';'); })).join('\r\n');
  const BOM = '﻿';   // Excel necesita UTF-8 con BOM para los acentos
  const blob = new Blob([BOM + cuerpo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}
function exportarReportesCSV(){
  if (!estado._admin || !modFilas.reportes.length){ toast('No hay reportes que exportar.', 'info'); return; }
  const cab = ['id', 'fecha', 'colonia', 'tipo', 'estado', 'texto', 'ubicacion_aprox', 'con_cuenta', 'oculto', 'motivo_oculto'];
  const filas = modFilas.reportes.map(function(f){
    const d = new Date(Number(f.ts));
    return [f.id, d.toISOString(), f.colonia, f.tipo, f.estado, f.texto, f.ubicacion || '', f.usuario_id ? 'sí' : 'no', f.oculto ? 'sí' : 'no', f.oculto_motivo || ''];
  });
  descargarCSV('reportes-basura-y-mas-' + new Date().toISOString().slice(0, 10) + '.csv', cab, filas);
  toast('📄 CSV descargado con ' + filas.length + ' reportes.', 'exito');
}

/* ---------- Borrar lo propio ---------- */
/** Intenta borrar en la nube. Devuelve true/false; si no se pudo,
    el contenido se queda en el dispositivo y se avisa con claridad. */
function borrarEnNube(tabla, fila){
  if (!sesion.usuario || !fila.usuario_id || fila.usuario_id !== sesion.usuario.id){
    return Promise.resolve({ ok: false, motivo: 'sin-cuenta' });
  }
  return fetch(NUBE.url + tabla + '?id=eq.' + encodeURIComponent(fila.id), {
    method: 'DELETE', headers: cabecerasNube({ Prefer: 'return=minimal' })
  }).then(function(r){
    if (r.status === 204) return { ok: true };
    if (!r.status) return { ok: false, motivo: 'sin-conexion' };
    return { ok: false, motivo: 'error' };
  }).catch(function(){ return { ok: false, motivo: 'sin-conexion' }; });
}

/* ---------- Enlaces de la vista de moderación ---------- */
/* ---------- Contacto y envío al municipio ----------
   Rellenar DESTINO.correo con la dirección REAL a la que el proyecto
   debe enviar los reportes. Se deja vacía a propósito: no se inventa
   ningún dato oficial del municipio, y con un destinatario inventado
   los correos se irían a un sitio equivocado sin que nadie se entere.
   Mientras esté vacía, la app ofrece las dos vías que sí funcionan:
   descargar el CSV y copiar un resumen para pegarlo a mano. */
const DESTINO = {
  correo: '',                    // ← completar con la cuenta institucional real
  area: 'Servicios Públicos',    // nombre del área, tal como lo confirme el municipio
  enlace: ''                     // enlace oficial (formulario web, WhatsApp…) si lo hay
};
$('#btnContacto').addEventListener('click', function(){
  cerrarModal('modalConfig');
  const cuerpo = [
    '<strong>Cómo llegan los reportes al municipio</strong>',
    '<strong>1. Exportar CSV.</strong> Desde el panel de moderación, el botón <em>Exportar CSV</em> descarga todos los reportes en una hoja de cálculo lista para Excel (separador ";", UTF-8). Es la vía que funciona hoy y no depende de ningún servicio de correo.',
    '<strong>2. Copiar el resumen.</strong> El botón de abajo pone en el portapapeles un resumen de los reportes pendientes, para pegarlo en un correo o en un mensaje al área correspondiente.',
    '<strong>3. Correo automático.</strong> Requiere desplegar la función de borde <code>supabase/functions/resumen-reportes</code> y configurar el remitente con Resend. Está escrito en el repositorio pero <strong>no está desplegado ni verificado</strong>.',
    '<strong>Destinatario:</strong> ' + (DESTINO.correo
      ? 'los reportes se envían a <strong>' + DESTINO.correo + '</strong> (' + DESTINO.area + ').'
      : '<strong>pendiente de configurar.</strong> El equipo del proyecto aún no ha confirmado la dirección oficial, y la app no la inventa. Hasta que se rellene, usa el CSV o el resumen copiado.'),
    '<strong>Importante:</strong> esta app <strong>no está conectada a ningún sistema municipal</strong>. Los reportes los ve el equipo del proyecto; llegar al área de Servicios Públicos depende de que alguien los entregue.'
  ];
  mostrarInfo('Contacto y envío al municipio', cuerpo);
  const acciones = $('#infoContenido');
  if (acciones){
    const fila = document.createElement('div');
    fila.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.9rem';
    const b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'btn btn-secundario btn-chico'; b1.textContent = '📋 Copiar resumen';
    b1.addEventListener('click', function(){
      const t = textoResumenReportes();
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ toast('📋 Resumen copiado.', 'exito'); }).catch(function(){ toast('No se pudo copiar. Selecciona el texto a mano.', 'error'); });
      else toast('Tu navegador no permite copiar automáticamente.', 'error');
    });
    const b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'btn btn-secundario btn-chico'; b2.textContent = '🖨️ Imprimir resumen';
    b2.addEventListener('click', function(){ window.print(); });
    fila.append(b1, b2);
    acciones.appendChild(fila);
  }
});
/** Resumen en texto plano de los reportes que aún no están atendidos. */
function textoResumenReportes(){
  const lista = (modFilas.reportes || []).filter(function(f){ return f.estado !== 'atendido' && !f.oculto; });
  const lineas = lista.map(function(f, i){
    const d = new Date(Number(f.ts));
    return (i + 1) + '. [' + f.estado + '] ' + f.colonia + ' · ' + f.tipo + ' — ' + f.texto;
  });
  return 'BASURA Y MÁS · Resumen de reportes ciudadanos (' + new Date().toLocaleDateString('es-MX') + ')\n' +
         'Proyecto FILOSOFARTE · CBTis 226\n\n' +
         (lineas.length ? lineas.join('\n') : 'No hay reportes pendientes.') +
         '\n\nNota: la ubicación se guarda difuminada a unos 100 metros por privacidad.';
}

$('#btnIrModeracion').addEventListener('click', function(){
  cerrarModal('modalConfig');
  irA('moderacion');
  cargarModeracion().then(function(){ renderModeracion(); });
});
$('#btnRefrescarMod').addEventListener('click', function(){
  cargarModeracion().then(function(){ renderModeracion(); toast('🔄 Panel actualizado.', 'info', 2000); });
});
$('#btnExportarCsv').addEventListener('click', exportarReportesCSV);

/* ============================================================
   MÓDULO 21 · SCROLL / CONEXIÓN / ERRORES GLOBALES
   ============================================================ */
window.addEventListener('scroll', function(){
  $('#appHeader').classList.toggle('con-sombra', (window.scrollY || 0) > 6);
}, { passive: true });

window.addEventListener('online', function(){ toast('🌐 Conexión restablecida.', 'exito', 3000); });
window.addEventListener('offline', function(){ toast('Sin conexión: el mapa y las rutas necesitan internet.', 'error', 5500); });

/* ============================================================
   OBSERVABILIDAD DE ERRORES (Sentry, opcional)
   ------------------------------------------------------------
   Qué se envía y qué NO:
     · se envía: nombre del error, archivo y línea, navegador.
     · NO se envía: correos, nombres, ni el texto de reportes o
       publicaciones, ni los identificadores de cuenta. Los errores
       de red se descartan porque solo dicen "no hay conexión", que
       la app ya le avisa a la persona con un toast.

   Mientras dsn esté vacío NO se carga nada: ni una petición extra
   ni una sola línea de un tercero. El proyecto funciona igual sin
   esto; es ayuda para el desarrollo, no una dependencia.

   CÓMO ACTIVARLO
     1) Crea un proyecto en sentry.io (plan gratuito, para un
        proyecto escolar).
     2) Copia la Client Key (DSN) de Settings → Client Keys.
     3) Pégala en la constante DSN de más abajo y sube el cambio.
     La DSN NO es una contraseña: es pública y va incrustada en el
     código por diseño. Aun asi, solo puede enviar eventos, no leer.
   ============================================================ */
const OBSERVABILIDAD = {
  dsn: '',            // ← pegar aquí la DSN de sentry.io
  entorno: 'produccion'
};
function iniciarObservabilidad(){
  if (!OBSERVABILIDAD.dsn || window.Sentry) return;
  const s = document.createElement('script');
  s.src = 'https://browser.sentry-cdn.com/8.47.0/bundle.min.js';
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.onload = function(){
    if (!window.Sentry) return;
    window.Sentry.init({
      dsn: OBSERVABILIDAD.dsn,
      environment: OBSERVABILIDAD.entorno,
      sendDefaultPii: false,
      tracesSampleRate: 0,                       // solo errores, nada de rendimiento
      ignoreErrors: [/leaflet/i, /L\./i, /ResizeObserver/i],
      beforeSend: function(ev){
        // Nunca sale de Sentry lo que la gente escribió.
        if (ev && ev.extra) delete ev.extra.texto;
        if (ev && ev.request && ev.request.url) ev.request.url = ev.request.url.split('?')[0];
        const noEnviar = /fetch|network|failed|load failed|aborted|timeout/i;
        const m = String((ev && ev.exception && ev.exception.values && ev.exception.values[0] && ev.exception.values[0].value) || '');
        if (noEnviar.test(m)) return null;       // ya se le avisó con un toast
        return ev;
      }
    });
  };
  s.onerror = function(){ /* si no carga, la app sigue igual */ };
  document.head.appendChild(s);
}
/** Envía el error a Sentry si está activo. Nunca rompe nada. */
function reportarError(e){
  try {
    if (window.Sentry && typeof window.Sentry.captureException === 'function'){
      window.Sentry.captureException(e);
    }
  } catch (x){ /* reportar un fallo al reportar un fallo no sirve de nada */ }
}

window.addEventListener('error', function(e){
  if (e && e.target && e.target !== window) return;           // fallo de un recurso (imagen, fuente), no del código
  if (e && e.message && /leaflet|L\./i.test(e.message)) return;
  console.warn(e && e.error);
  reportarError(e && e.error ? e.error : new Error(String((e && e.message) || 'error desconocido')));
  toast('Ocurrió un problema inesperado, pero la app sigue funcionando.', 'error', 4000);
});

window.addEventListener('unhandledrejection', function(e){
  console.warn('Promesa rechazada:', e && e.reason);
  const m = String((e && e.reason && (e.reason.message || e.reason.error)) || '');
  if (/fetch|network|failed|load failed|aborted/i.test(m)) return; // sin conexión: ya se avisó antes
  reportarError((e && e.reason) || new Error('Promesa rechazada: ' + m));
  toast('Algo no pudo sincronizarse. Tus datos siguen guardados en este dispositivo.', 'error', 5000);
});

/* ============================================================
   MÓDULO 22 · INICIALIZACIÓN
   ============================================================ */
function iniciar(){
  aplicarTema(estado.tema);
  pintarSelectColonias();
  iniciarObservabilidad();   // no hace nada mientras la DSN esté vacía
  initNube();
  actualizarHeaderNivel();
  pintarBotonNotif();
  pintarConciencia();
  renderReportes();
  renderMuro();
  renderInsignias();
  renderPerfil();
  verificarInsignias(); // recupera insignias pendientes de sesiones anteriores
  $('#pNombre').value = estado.nombrePerfil;
  $('#pColonia').value = estado.coloniaId;
  setDemoUI(estado.demo);
  aplicarIdentidad();
  actualizarBotonCuenta();

  // Onboarding de primera visita: invita a crear cuenta (o entrar como invitado).
  // Se omite si ya hay una sesión guardada (aunque aún se esté restaurando).
  if (!verOnboarding() && !obtenerSesion()){
    setTimeout(function(){ abrirModal('modalBienvenida'); }, 900);
  }

  // Vuelve de "Olvidé mi contraseña": el enlace trae el token en la URL.
  const rec = leerEnlaceRecuperacion();
  if (rec){
    history.replaceState(null, '', location.pathname + location.search);
    if (rec.error){
      toast('El enlace de recuperación no es válido: ' + rec.error, 'error', 6000);
    } else {
      tokenRecuperacion = rec.token;
      abrirModal('modalNuevaPass');
      setTimeout(function(){ $('#npPass1').focus(); }, 120);
    }
  }

  if (typeof L === 'undefined'){
    // Leaflet no cargó (sin internet): la app sigue funcionando sin mapa
    $('#listaPuntos').innerHTML = '<div class="vacio visible" style="padding:1.1rem"><p style="font-size:.85rem">El mapa no pudo cargarse sin conexión. Con internet, recarga la página para activarlo.</p></div>';
    toast('Sin conexión: el mapa no está disponible ahora.', 'error', 6000);
  } else {
    initMapa();
    $('#rutaSelect').value = estado.coloniaId;
    // Precarga de la ruta de la colonia guardada (en segundo plano)
    cargarRutaColonia(false);
  }

  // Reloj de tiempos relativos
  setInterval(function(){
    $$('#muro .publicacion').forEach(function(art){
      const p = publicaciones.find(function(x){ return x.id === art.dataset.id; });
      if (p){ const sm = art.querySelector('.meta small'); if (sm) sm.textContent = tiempoRelativo(p.ts) + ' · ' + p.colonia; }
    });
  }, 60000);

  const ocultar = function(){
    const l = $('#loader');
    if (!l) return;
    l.classList.add('oculto');
    setTimeout(function(){ if (l.parentNode) l.parentNode.removeChild(l); }, 500);
  };
  if (document.readyState === 'complete') setTimeout(ocultar, 350);
  else window.addEventListener('load', function(){ setTimeout(ocultar, 350); });
  setTimeout(ocultar, 4000);
}
/* ============================================================
   MÓDULO 23 · ECO, EL ASISTENTE DE LA APP
   ------------------------------------------------------------
   Eco tiene dos niveles, y por eso nunca depende de internet:

   1. Reglas (siempre). Un buscador que entiende las preguntas que
      la app ya sabe contestar y responde SOLO con datos de este
      mismo archivo: las colonias de ZONAS, la guía de RESIDUOS, los
      niveles e insignias, los estados de un reporte y los tipos
      que admite el formulario. Auditable entero leyendo el bloque.
   2. IA (opcional). Si ninguna regla entiende la pregunta, esta se
      manda a /api/eco, una función del servidor que la redacta un
      modelo de lenguaje con los MISMOS datos de la app como
      referencia. La clave vive en una variable de entorno del
      servidor: aquí, en app.js, no hay ninguna clave ni llamada a
      un tercero. Si el servidor no responde, se cae de vuelta a las
      reglas sin inventar nada.

   Las respuestas sobre datos de esta app (punto más cercano con
   ubicación real, horarios del camión, puntos e insignias, qué
   datos guarda la app) llevan `verificada: true` y NUNCA se
   delegan: son las que no pueden fallar y las que no dependen de
   la conexión. La IA solo responde lo que no es un dato medido.

   Todo lo que dice el usuario se trata como texto no confiable:
   se normaliza, se comparan palabras clave y SIEMPRE se pinta con
   textContent. Nunca se interpreta como HTML ni como instrucciones.
   Lo que sale del dispositivo, cuando hay IA, es la pregunta y
   datos que la app ya muestra en pantalla: nunca el nombre, el
   correo ni las coordenadas.
   ============================================================ */

/* Reglas que Eco no puede romper. Se responden ANTES que cualquier otra
   cosa del chat: si alguien intenta cambiarlas, estas ganan. */
const ECO_LEMA = 'La tecnología también puede cuidar nuestro hogar.';
const ECO_FRASE = 'El progreso sin conciencia no es progresión.';
const ECO_SIN_GPS =
  'No puedo mostrar una posición en vivo del camión porque el sistema no tiene una señal GPS activa. ' +
  'Prefiero decírtelo claro antes que inventarte una ubicación o un horario.';
const ECO_NO_MUNICIPAL =
  'Esto no son datos oficiales del municipio: son puntos que el sistema propone a partir de las calles ' +
  'reales del mapa. Para el horario oficial conviene consultar al ayuntamiento.';
const ECO_SIN_DATO =
  'No tengo ese dato. No estoy conectado al ayuntamiento ni a un modelo de lenguaje, así que ' +
  'prefiero decirte "no lo sé" antes que inventarlo.';
const ECO_ETIQUETA_VISTA = {
  inicio: 'Inicio', mapa: 'el mapa', guia: 'Reciclaje', reportes: 'Reportes',
  comunidad: 'Comunidad', perfil: 'tu perfil'
};

const ECO_CHIPS = [
  '¿Cuándo pasa el camión?',
  'Punto más cercano',
  'Botella de plástico',
  'Cómo reportar',
  'Mi ruta',
  'Puntos e insignias',
  'Privacidad'
];

/* Consejo de educación ambiental. `f` dice de dónde sale el texto, para no
   presentar una recomendación mía como si fuera un dato medido. */
const ECO_TIPOS = [
  { t: 'Enjuaga y aplasta los envases', f: 'recomendación de la guía de la app',
    d: 'Un envase vacío, limpio y aplastado ocupa menos espacio y se procesa mejor que uno sucio y lleno de aire.' },
  { t: 'Separa el orgánico en su propia bolsa', f: 'recomendación de la guía de la app',
    d: 'Una bolsa separada para restos de comida y jardín evita que el recyclable se contamine y quite el olor.' },
  { t: 'Lo especial nunca va al contenedor común', f: 'dato de la guía de la app',
    d: 'Pilas, focos, medicamentos, aceite de cocina y electrónicos van a punto de acopio o a campañas de acopio.' },
  { t: 'El cascarón de huevo sirve de composta', f: 'dato de la guía de la app',
    d: 'Aplánalo antes de tirarlo: se degrada rápido y sirve de abono para las plantas.' },
  { t: 'Envuelve el vidrio roto antes de moverlo', f: 'recomendación de la guía de la app',
    d: 'Ponlo en una bolsa o en cartón para que nadie se corte al recogerlo.' },
  { t: 'Registra tu acción todos los días', f: 'función de la app',
    d: 'Cada día que separas residuos puedes registrarlo en Inicio y sumas ' + PTS.accion + ' puntos. Solo cuenta una vez al día.' }
];

/* ---------- Utilidades de texto ---------- */
function ecoTiene(t){
  for (let i = 1; i < arguments.length; i++) if (t.indexOf(arguments[i]) !== -1) return true;
  return false;
}
/** Busca una palabra completa (con acentos ya normalizados) para evitar
    que "rfc" se active dentro de otra palabra. */
function ecoPalabra(t, w){
  return new RegExp('(^|[^a-z0-9])' + w + '([^a-z0-9]|$)').test(t);
}
function ecoTexto(s){ return String(s == null ? '' : s); }

/** Palabras clave → respuesta. El orden importa: primero las guardas de
    seguridad, después lo más específico, al final lo general. */
function ecoResponder(pregunta){
  const t = normalizar(pregunta);
  if (!t) return null;

  /* --- 0. Guardas de seguridad: nada de lo que sigue las desactiva --- */
  if (ecoTiene(t, 'ignora tus reglas', 'ignora las reglas', 'olvida tus reglas', 'cambia tus reglas',
      'nuevas reglas', 'reglas nuevas', 'sin reglas', 'sin restricciones', 'actua como',
      'actua de otro modo', 'eres ahora', 'nuevo prompt', 'prompt del sistema', 'system prompt',
      'modo desarrollador', 'developer mode', 'cambia tus instrucciones', 'instruccion del sistema')){
    return {
      verificada: true,
      texto: 'Mis reglas no se cambian desde el chat. Sigo siendo Eco: no invento datos, no me conecto ' +
        'al ayuntamiento y lo que te digo sale de esta app.\n\nLo que sí puedo hacer es bastante: guías de separación, ' +
        'rutas y puntos propuestos, reportes, puntos e insignias.'
    };
  }
  if (ecoTiene(t, 'mi contrasena es', 'dime tu contrasena', 'tu contrasena es', 'dame la contrasena',
      'cual es mi contrasena', 'contrasena de', 'password de', 'clave de', 'api key', 'token de',
      'clave anonima', 'anon key', 'sb_secret', 'sb_publishable')){
    return {
      verificada: true,
      texto: 'No te pido ni te doy contraseñas, tokens ni claves. Eco no necesita ningún secreto para ' +
        'ayudarte: la clave que hay en el servidor no está en esta página ni se puede leer desde ella.'
    };
  }
  if (ecoTiene(t, 'tarjeta de credito', 'tarjeta de debito', 'datos bancarios', 'numero de cuenta',
      'clabe', 'salario', 'banco') || ecoPalabra(t, 'rfc') || ecoPalabra(t, 'curp')){
    return {
      verificada: true,
      texto: 'Esto es una app de residuos: no necesito ni guardo datos bancarios ni documentos personales. ' +
        'Para tu reporte solo hace falta una descripción, una foto opcional y el punto del mapa.'
    };
  }
  if (ecoTiene(t, 'datos de otro', 'datos de otra', 'correo de otra', 'correo de otro', 'privado de otra',
      'privado de otro', 'hackear', 'acceder a la cuenta de', 'ver la cuenta de', 'de otro usuario',
      'de otra persona', 'de otro vecino')){
    return {
      verificada: true,
      texto: 'No puedo mostrarte datos ni cuentas de otras personas. Lo que cada quien publica es suyo, ' +
        'y los reportes se guardan con la ubicación difuminada a unos 100 metros justamente para no ' +
        'exponer a nadie. Tampoco puedo modificar nada a nombre de otro usuario.'
    };
  }
  if (ecoTiene(t, 'ejecuta este', 'ejecutar este codigo', 'ejecuta codigo', 'corre este codigo',
      'haz un fetch', 'hazte un bot', 'haz un bot', 'javascript:', 'inyectar', 'drop table',
      'cambia el codigo')){
    return {
      verificada: true,
      texto: 'No ejecuto código ni abro lo que me mandes. Lo que escribas lo trato como texto: no lo ' +
        'convierto en HTML, no lo ejecuto y no cambia lo que soy.'
    };
  }
  /* La ficha pide responder en español salvo que se pida otro idioma. */
  if (ecoTiene(t, ' hello', ' hi ', ' where ', ' what ', ' how ', ' why ', ' recycle ', ' trash ', ' garbage ')){
    return {
      verificada: true,
      texto: 'Hola 🙂 Yo respondo en español, como toda la app. Pregúntame lo que quieras en español y te ' +
        'ayudo con residuos, rutas, reportes y puntos.'
    };
  }

  /* --- 1. Navegación ("¿dónde está X?"). Va antes que todo lo demás
        porque pregunta por la ubicación de una función, no por la función.
        Las dos únicas preguntas de ubicación que se apartan son las del
        punto más cercano y las del camión: esas tienen su propia regla. --- */
  if (ecoTiene(t, 'donde esta', 'donde queda', 'donde encuentro', 'como abro', 'seccion', 'menu',
      'navegacion', 'en que parte', 'como llego a') &&
      !ecoTiene(t, 'punto mas cercano', 'mas cercano', 'camion', 'horario', 'gps', 'posicion')){
    return {
      texto: 'Está todo en la barra de navegación de la izquierda (abajo en el celular):',
      lista: [
        'La ruta y los puntos de recolección están en Mapa.',
        'La guía para separar cada residuo está en Reciclaje.',
        'Los reportes ciudadanos están en Reportes.',
        'Publicaciones, comentarios y me gusta están en Comunidad.',
        'Tus puntos, nivel e insignias están en Mi perfil.',
        'Tu resumen del día está en Inicio.'
      ]
    };
  }


  /* --- 1b. Preguntas sobre TU actividad: las contesta la app, no el modelo.
         Va despues de las guardas y de las reglas de datos de la app, y
         antes de la IA: un núero sobre tu actividad no puede depender de
         que un modelo lo redacte bien. --- */
  if (ecoEsPreguntaPersonal(pregunta) || ecoTiene(t, 'patron', 'patrones', 'cada cuanto', 'cada cuánto')){
    const r = ecoRespuestaPersonal(t);
    if (r) return r;
  }

  /* --- 1c. Simulación: "si hago esto, ¿qué nivel alcanzo?" ---
     Esto lo resuelve la app, no el modelo. Medido: con la herramienta
     "simular_acciones" el modelo recibía el sí/no correcto y aun así
     recalculaba y se equivocaba ("255 es menor que 220"). Sumar y
     comparar es determinista; por eso va aquí y no en la IA. */
  if (ecoTiene(t, 'alcanzo', 'alcanzare', 'llegaria', 'me quedaria') &&
      ecoTiene(t, 'nivel', 'puntos', 'si hago', 'si mando', 'si publico', 'si registro', 'si envio')){
    const r = ecoSimularAcciones(pregunta);
    if (r.indexOf('No entendi') === 0 || r.indexOf('No entendí') === 0){
      return {
        verificada: true,
        texto: 'Puedo calcularlo, pero no entendí qué acciones planeas hacer. Dímelo así: ' +
          '"si mando 2 reportes y 3 publicaciones, ¿alcanzo el nivel 3?".'
      };
    }
    return { verificada: true, texto: r.replace('RESPUESTA CORRECTA: ', ''), ir: 'perfil' };
  }
  /* --- 2. Reportes ciudadanos (antes que camión: "el camión no pasó" también
        se reporta, y ahí toca explicar cómo, no el horario) --- */
  if (ecoTiene(t, 'reportar', 'reporte', 'reportes', 'quejarse', 'avisar', 'contenedor lleno',
      'camion no paso', 'ruta incorrecta', 'basura en la calle')){
    if (ecoTiene(t, 'tipo', 'cuales son los tipos')){
      return {
        texto: 'El formulario acepta cinco tipos: contenedor lleno, basura en la calle, camión no pasó, ' +
          'ruta incorrecta y otro.',
        ir: 'reportes'
      };
    }
    return {
      texto: 'Sí, te ayudo. Los pasos son:\n\n' +
        '1. Entra a Reportes.\n' +
        '2. Elige el tipo: contenedor lleno, basura en la calle, camión no pasó, ruta incorrecta u otro.\n' +
        '3. Marca el punto en el mapa o usa tu ubicación actual.\n' +
        '4. Escribe qué pasó y, si quieres, adjunta una foto.\n' +
        '5. Revisa y envía.\n\n' +
        'Tu ubicación se guarda difuminada a unos 100 metros, para que se vea la zona sin decir ' +
        'exactamente dónde estás.',
      ir: 'reportes'
    };
  }

  /* --- 3. Camión, horarios, GPS y tiempos de llegada --- */
  if (ecoTiene(t, 'camion', 'horario', 'que hora', 'cuando pasa', 'pasara', 'tiempo de llegada', 'gps',
      'posicion', 'sigue al camion', 'esta en', 'llego') &&
      !ecoTiene(t, 'reportar', 'reporte', 'reportes', 'quejarse', 'avisar')){
    const col = ZONAS[estado.coloniaId];
    const nombreColonia = ecoColoniaEnTexto(t) || (col ? col.nombre : null);
    let estadoRuta = '';
    if (rutaActiva && (!nombreColonia || rutaActiva.zona === nombreColonia)){
      estadoRuta = '\n\nLo que sí está cargado ahora mismo es la ruta de ' + rutaActiva.zona + ': circuito de ' +
        fmtDistancia(rutaActiva.distanciaM) + ' con ' + puntosActuales.length + ' puntos propuestos, cada ' +
        INTERVALO_PUNTOS + ' m. Eso es el recorrido, no el horario.';
    }
    return {
      verificada: true,
      texto: '🚛 ' + ECO_SIN_GPS +
        (nombreColonia ? ' Estoy viendo la colonia que tienes seleccionada (' + nombreColonia + '),' +
          ' pero el sistema no sabe a qué hora pasa.' : '') +
        estadoRuta +
        '\n\nLo que sí puedo hacer: enseñarte el recorrido y los puntos propuestos de tu colonia.',
      ir: 'mapa'
    };
  }

  /* --- 4. Punto más cercano: aquí sí hay datos reales, si hay ubicación --- */
  if (ecoTiene(t, 'punto mas cercano', 'mas cercano', 'cerca de mi', 'punto de recoleccion mas cercano',
      'cual es el punto', 'donde deposito', 'donde tiro cerca')){
    const r = ecoPuntoCercanoReal();
    if (r.accion === 'geo'){
      return {
        verificada: true,
        texto: 'Para decirte cuál es el punto más cercano necesito tu ubicación. El navegador te va a ' +
          'pedir permiso; solo se usa para calcular distancias y no se comparte con nadie.',
        acciones: [{ etiqueta: '📍 Usar mi ubicación', fn: ecoUsarMiUbicacion }]
      };
    }
    if (r.accion === 'mapa'){
      return {
        texto: 'Ya sé dónde estás, pero la ruta todavía no termina de calcularse. En cuanto esté lista te ' +
          'puedo decir el punto más cercano y a qué distancia.',
        ir: 'mapa'
      };
    }
    return {
      verificada: true,
      texto: r.texto + '\n\n' + ECO_NO_MUNICIPAL,
      ir: 'mapa'
    };
  }

  /* --- 5. Estado de la ruta de su colonia --- */
  if (ecoTiene(t, 'estado de la ruta', 'como va mi ruta', 'mi ruta esta', 'ya llego el camion',
      'la ruta activo', 'tengo ruta cargada')){
    if (!rutaActiva){
      return {
        verificada: true,
        texto: 'Todavía no hay ninguna ruta cargada. Se calcula al abrir el mapa, con las calles reales ' +
          'de OpenStreetMap. Si no hay conexión, no se puede calcular y la app lo dice.',
        ir: 'mapa'
      };
    }
    return {
      verificada: true,
      texto: '🚛 Ruta de ' + rutaActiva.zona + ' cargada: circuito de ' + fmtDistancia(rutaActiva.distanciaM) +
        ' sobre ' + rutaActiva.fuente + ', con ' + puntosActuales.length + ' puntos propuestos cada ' +
        INTERVALO_PUNTOS + ' m.\n\n' +
        'Ojo con la diferencia: esto es el recorrido. El horario y la hora de llegada del camión no ' +
        'los tiene el sistema.',
      ir: 'mapa'
    };
  }

  /* --- 6. Rutas y colonias --- */
  if (ecoTiene(t, 'ruta', 'mapa', 'colonia', 'colonias', 'punto de recoleccion', 'puntos de recoleccion')){
    const lista = Object.keys(ZONAS).map(function(k){ return ZONAS[k].nombre; });
    const col = ZONAS[estado.coloniaId];
    const pedida = ecoColoniaEnTexto(t);
    const tieneRuta = pedida ? lista.indexOf(pedida) !== -1 : false;
    let foco;
    if (pedida && !tieneRuta){
      foco = pedida + ' sí está en el catálogo de colonias de Ciudad Guzmán, pero todavía no tiene ' +
        'ruta: la app solo dibuja ' + lista.length + ' (' + lista.join(', ') + ').\n\n' +
        'Lo que sí puedes hacer es reportar un problema de tu colonia en la pestaña Reportes: ' +
        'queda guardado de qué colonia es, aunque no haya recorrido calculado.\n\n';
    } else if (pedida){
      foco = 'De las colonias con ruta, ' + pedida + ' es la que mencionas.\n\n';
    } else {
      foco = col ? 'Tienes seleccionada ' + col.nombre + '.\n\n' : '';
    }
    return {
      texto: foco + 'La app tiene ' + lista.length + ' colonias con ruta: ' + lista.join(', ') + ', ' +
        'y puede registrar reportes en ' + (COLONIAS.length + lista.length) + ' colonias.\n\n' +
        'En el mapa eliges la tuya en el selector de arriba y ves el recorrido con los puntos ' +
        'propuestos. ' + ECO_NO_MUNICIPAL,
      ir: (pedida && !tieneRuta) ? 'reportes' : 'mapa'
    };
  }

  /* --- 7. Reciclaje: primero el residuo concreto --- */
  if (ecoTiene(t, 'que hago con', 'como separo', 'donde va', 'que va', 'residuo', 'reciclar', 'basura',
      'separar', 'tirar', 'botella', 'papel', 'carton', 'vidrio', 'plastico', 'pila', 'aceite',
      'electronico', 'medicamento', 'organico', 'compost', 'metal', 'lata', 'boton')){
    const r = buscarEcoResiduo(t);
    if (r) return { texto: r, ir: 'guia' };
    // "qué son los residuos especiales" no es un residuo: es una categoría.
    if (ecoTiene(t, 'organicos', 'inorganicos', 'reciclables', 'no reciclables', 'especiales', 'categoria',
        'cuales son las categorias')){
      return { texto: ecoResumenCategorias(), lista: ecoListaCategorias(), ir: 'guia' };
    }
    if (ecoTiene(t, 'basura', 'reciclar', 'separar', 'donde va')){
      return { texto: ecoResumenCategorias(), lista: ecoListaCategorias(), ir: 'guia' };
    }
    return {
      texto: ECO_SIN_DATO + '\n\nPrueba con un nombre más común ("botella PET", "cartón", "pilas", "aceite") ' +
        'o busca tú mismo entre los ' + RESIDUOS.length + ' residuos con guía.',
      ir: 'guia'
    };
  }

  /* --- 8. Las cuatro categorías de la guía --- */
  if (ecoTiene(t, 'organicos', 'inorganicos', 'reciclables', 'no reciclables', 'especiales', 'categoria',
      'cuales son las categorias')){
    return { texto: ecoResumenCategorias(), lista: ecoListaCategorias(), ir: 'guia' };
  }

  /* --- 9. Comunidad: publicaciones, comentarios, votos y actividades --- */
  if (ecoTiene(t, 'comunidad', 'publicacion', 'publicar', 'comentario', 'comentar', 'me gusta', 'like',
      'voto', 'votar', 'evento', 'jornada', 'taller', 'accion')){
    return {
      texto: 'En Comunidad puedes:\n\n' +
        '· Publicar una idea o un aviso (con tu nombre de perfil, o como Anónimo).\n' +
        '· Comentar lo que ponen tus vecinos.\n' +
        '· Dar un me gusta a las publicaciones que te parezcan buenas.\n\n' +
        'Publicar o comentar da ' + PTS.participacion + ' puntos. Y ojo con una cosa: las actividades ' +
        'que aparecen (jornada de limpieza, taller de compostaje) son propuestas de ejemplo para ' +
        'demostrar la plataforma, no eventos oficiales del municipio.',
      ir: 'comunidad'
    };
  }

  /* --- 10. Puntos, niveles e insignias --- */
  if (ecoTiene(t, 'puntos', 'insignia', 'insignias', 'nivel', 'recompensa', 'progreso', 'logro')){
    const n = nivelDe(estado.puntos || 0);
    return {
      verificada: true,
      texto: 'Así funciona lo que ganas:\n\n' +
        '· Acción ecológica del día: +' + PTS.accion + ' puntos.\n' +
        '· Reporte enviado: +' + PTS.reporte + '.\n' +
        '· Publicación o comentario: +' + PTS.participacion + '.\n\n' +
        'Hay ' + NIVELES.length + ' niveles. Vas en el ' + n.nivel + ' ("' + n.nombre + '") con ' +
        (estado.puntos || 0) + ' puntos.\n\n' +
        'Las ' + INSIGNIAS.length + ' insignias se desbloquean solas según lo que hagas: ' +
        INSIGNIAS.map(function(i){ return i.icono + ' ' + i.nombre; }).join(', ') + '.\n\n' +
        'Una cosa honesta: yo no te puedo dar puntos a mano. Los calcula la app.',
      ir: 'perfil'
    };
  }

  /* --- 11. Educación ambiental --- */
  if (ecoTiene(t, 'consejo', 'consejos', 'tip', 'tips', 'aprender', 'aprender a', 'que puedo hacer para',
      'cuidar el ambiente', 'medio ambiente', 'contaminacion', 'contaminar', 'sustentable')){
    const elegido = ecoConsejoPara(t);
    if (elegido) return { texto: elegido, ir: 'guia' };
    return {
      texto: 'Te dejo consejos que sí están respaldados por la guía de la app:',
      lista: ECO_TIPOS.slice(0, 4).map(function(c){ return c.t + ' — ' + c.d; }),
      ir: 'guia'
    };
  }

  /* --- 12. Privacidad --- */
  if (ecoTiene(t, 'privacidad', 'datos', 'guardan', 'informacion', 'rastreo', 'cookie', 'seguridad',
      'mis datos')){
    return {
      verificada: true,
      texto: 'Esto es lo que guarda la app:\n\n' +
        '· Tu cuenta (correo y el nombre que eliges). El correo nunca se muestra como nombre público.\n' +
        '· Lo que publicas y comentas, con tu nombre de perfil.\n' +
        '· Los reportes, con la ubicación difuminada a unos 100 metros.\n' +
        '· Tu sesión y tu progreso, también en este navegador, para que la app funcione sin conexión.\n\n' +
        (ecoHayIA
          ? 'Y cuando no hay respuesta en mis reglas, tu pregunta sale de este dispositivo hacia el ' +
            'servidor de la app para que un modelo de lenguaje la redacte. Se van tu pregunta y datos ' +
            'que ya están a la vista en la app (colonias, guía de residuos, tus puntos y el nombre del ' +
            'punto más cercano). Nunca tu nombre, ni tu correo, ni tus coordenadas.\n\n'
          : 'Ahora mismo contesto solo con las reglas de esta app: no sale nada de tu dispositivo.\n\n') +
        'Todo está escrito en el pie, en "Política de privacidad".'
    };
  }

  /* --- 13. Cuenta --- */
  if (ecoTiene(t, 'cuenta', 'registrar', 'iniciar sesion', 'correo', 'password', 'contrasena', 'perdi mi')){
    return {
      texto: 'Puedes usar Basura y Más de dos formas:\n\n' +
        '· Como invitado: todo menos publicar con tu nombre. Sin cuenta.\n' +
        '· Con cuenta: para publicar, comentar y que tu reporte quede a tu nombre.\n\n' +
        'Si olvidaste la contraseña, la app manda un enlace al correo con el que te registraste. ' +
        'Aviso honesto: hoy ese correo solo llega a correos del propio proyecto, porque falta conectar ' +
        'un servidor de correo.'
    };
  }

  /* --- 14. Quién es y qué puede hacer --- */
  if (ecoTiene(t, 'quien eres', 'presentate', 'como te llamas', 'que puedes hacer', 'que es esto',
      'como uso', 'como funciona', 'ayuda', 'para que sirves')){
    return {
      verificada: true,
      texto: 'Soy Eco, el asistente de Basura y Más. ' + ECO_LEMA + '\n\n' +
        'Funciono en dos niveles. Primero contesto con las reglas de la app: no necesitan internet y no ' +
        'pueden equivocarse porque solo repiten lo que está aquí (guía de residuos, rutas, reportes, ' +
        'puntos e insignias). Si no hay regla que entienda tu pregunta, se la paso al servidor de la app ' +
        'y la redacta un modelo de lenguaje, siempre con esos mismos datos de referencia. La clave de ese ' +
        'servidor no está en esta página: no se puede leer desde el navegador.\n\n' +
        'Lo que nunca hago: dar horarios ni hora de llegada del camión, porque no hay GPS conectado, y no ' +
        'presentar como oficial un punto que la app propone. Si no lo sé, te lo digo.\n\n' +
        '"' + ECO_FRASE + '"',
      acciones: [{ etiqueta: '→ Ir a Inicio', ir: 'inicio' }]
    };
  }



  /* --- 17. Si ninguna regla entiende la pregunta, no se improvisa: lo dice --- */
  return null;
}

/* ---------- Datos reales que usa Eco ---------- */

/** Devuelve el nombre de una colonia si la persona la menciona.
    Mira las 6 con ruta y el catálogo completo, y las prueba de más
    larga a más corta: si no, "San José" se comería a
    "La Cantera San José". Solo cuenta comomentionada si sale como
    palabra suelta, no dentro de otra. */
function ecoColoniaEnTexto(t){
  const conRuta = Object.keys(ZONAS).map(function(k){ return ZONAS[k].nombre; });
  const todas = conRuta.concat(COLONIAS).filter(function(n, i, a){ return a.indexOf(n) === i; });
  const orden = todas.slice().sort(function(a, b){ return b.length - a.length; });
  for (let i = 0; i < orden.length; i++){
    const n = normalizar(orden[i]);
    if (n.length < 3) continue;   // más corto que eso daría falsos positivos
    if (ecoPalabra(t, n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) return orden[i];
  }
  return null;
}

/** Punto de recolección más cercano a la ubicación ya conocida. Solo usa
    datos calculados de verdad: la geometría de la ruta y la posición del
    propio usuario. Distancia en línea recta, no por calle. */
function ecoPuntoCercanoReal(){
  if (!estado.ubicacion) return { accion: 'geo' };
  if (!puntosActuales.length || !rutaActiva) return { accion: 'mapa' };
  const cerca = puntoMasCercano();
  if (!cerca) return { accion: 'mapa' };
  return {
    texto: '📍 El punto propuesto más cercano a tu ubicación es el #' +
      String(cerca.p.numero).padStart(2, '0') + ' de la ruta de ' + rutaActiva.zona + ', a ' +
      fmtDistancia(cerca.d) + ' en línea recta.\n\nEl tiempo a pie o en vehículo por calle lo calcula ' +
      'el mapa cuando hay conexión; yo no te lo estimo de memoria.'
  };
}

/** Pide la ubicación al navegador y responde con el punto más cercano. */
async function ecoUsarMiUbicacion(){
  ecoMensajeEco('⏳ Pidiendo permiso de ubicación…');
  try {
    const loc = await dataLayer.getUserLocation();
    estado.ubicacion = { lat: loc.lat, lng: loc.lng };
    estado._usoUbicacion = true;
    if (mapa){
      pintarMarcadorUsuario(estado.ubicacion);
      mapa.setView([loc.lat, loc.lng], 16, { animate: !REDUCIR.matches });
    }
    if (puntosActuales.length) evaluarPuntoCercano();
    registrarAccion('ruta', 'Usó su ubicación para buscar la ruta', PTS.ayuda);
    verificarInsignias();
    const r = ecoPuntoCercanoReal();
    ecoMensajeEco(r.texto ? ('✓ Ubicación lista.\n\n' + r.texto + '\n\n' + ECO_NO_MUNICIPAL) : '✓ Ubicación lista.');
    ecoPintarAcciones([{ etiqueta: '→ Ir a el mapa', ir: 'mapa' }]);
  } catch (err) {
    ecoMensajeEco('No pude obtener tu ubicación (' + (err.message || 'sin permiso') + '). ' +
      'No pasa nada: puedes elegir tu punto tocando el mapa.');
  }
}

function ecoResumenCategorias(){
  return 'La guía separa los residuos en cuatro grupos:';
}
function ecoListaCategorias(){
  return Object.keys(CATS_INFO).map(function(k){
    const n = RESIDUOS.filter(function(r){ return r.cat === k; }).length;
    return CATS_INFO[k].t + ': ' + n + ' residuos con guía.';
  });
}

/** Elige el consejo de ECO_TIPOS que mejor encaja con la pregunta. */
function ecoConsejoPara(t){
  let mejor = null, mejorLargo = 0;
  for (let i = 0; i < ECO_TIPOS.length; i++){
    const c = ECO_TIPOS[i];
    const palabras = normalizar(c.t + ' ' + c.d).split(/[^a-z0-9]+/)
      .filter(function(p){ return p.length > 4; });
    let coincide = 0;
    palabras.forEach(function(p){ if (t.indexOf(p) !== -1) coincide++; });
    if (coincide > mejorLargo){ mejor = c; mejorLargo = coincide; }
  }
  if (!mejor) return null;
  return mejor.t + '\n\n' + mejor.d + '\n\nFuente: ' + mejor.f + '.';
}

/** Busca el residuo con la misma lógica de palabras que usa la guía. */
function buscarEcoResiduo(t){
  for (let i = 0; i < RESIDUOS.length; i++){
    const r = RESIDUOS[i];
    if (r.cl.some(function(c){ return t.indexOf(normalizar(c)) !== -1; })){
      const cat = CATS_INFO[r.cat];
      return r.e + ' ' + r.n + ' → ' + r.c + '\n\nCategoría: ' + (cat ? cat.t : r.cat) + '.';
    }
  }
  return null;
}

/* ---------- Eco con IA (opcional) ----------
   Lo que se manda al servidor es lo MÍNIMO y todo público: la pregunta
   y los datos que la app ya enseña en pantalla. Nunca el nombre, ni el
   correo, ni las coordenadas: para eso no hay nada que mandar. */
/** Conclusión de un reparto, en una frase: el más y cuántos. */
function ecoConclusion(lista, campo){
  if (!lista || !lista.length) return null;
  const c = ecoReparto(lista, campo, '');
  // Sin ancla al principio: ecoReparto antepone " (total N): ".
  const primero = /el más es ([^,]+), con (\d+)/.exec(c);
  if (primero) return primero[1] + ', con ' + primero[2] + ' de ' +
    (lista.length === 1 ? 'tu único dato' : 'tus ' + lista.length + ' datos');
  const empate = /hay empate entre ([^,]+) y ([^,]+), con (\d+) cada uno/.exec(c);
  if (empate) return empate[1] + ' y ' + empate[2] + ', con ' + empate[3] + ' cada uno';
  return null;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/* En español no todos los días pluralizan igual: lunes, martes, miércoles,
   jueves y viernes ya son plurales. Con un "s" a secas salía "los luness". */
const DIAS_PLURAL = { domingo: 'domingos', lunes: 'lunes', martes: 'martes',
  'miércoles': 'miércoles', jueves: 'jueves', viernes: 'viernes', 'sábado': 'sábados' };
const MINIMO_PATRON = 4;   // con menos de 4 reportes no se afirma ningún patrón

/** Patrones sobre tus reportes: cuándo reportas, qué combinas y cada cuánto.
    Con pocos datos NO se inventa un patrón: se dice que no hay muestra
    suficiente. Es la diferencia entre observar algo y suponerlo. */
function ecoPatrones(rep){
  if (!rep || !rep.length){
    return { suficiente: false, patrones: [],
      texto: 'No tienes reportes guardados, así que no hay ningún patrón que buscar.' };
  }
  const L = [];
  const patrones = [];
  const porDia = {}, porHora = {}, porPareja = {};
  let suma = 0;
  rep.forEach(function(r){
    const d = new Date(Number(r.ts) || 0);
    const dia = DIAS[d.getDay()];
    porDia[dia] = (porDia[dia] || 0) + 1;
    porHora[d.getHours()] = (porHora[d.getHours()] || 0) + 1;
    const par = (r.colonia || 'sin colonia') + ' + ' + (r.tipo || 'sin tipo');
    porPareja[par] = (porPareja[par] || 0) + 1;
    suma += Number(r.ts) || 0;
  });

  /* Día de la semana: solo se afirma si el ganador repite. */
  const clavesDia = Object.keys(porDia).sort(function(a, b){ return porDia[b] - porDia[a]; });
  const diaTop = clavesDia[0];
  if (rep.length >= MINIMO_PATRON && porDia[diaTop] >= 2 && clavesDia.length > 1 &&
      porDia[diaTop] > (porDia[clavesDia[1]] || 0)){
    patrones.push('reportas más los ' + (DIAS_PLURAL[diaTop] || diaTop));
    L.push('Tu día de más reportes es el ' + diaTop + ' (' + porDia[diaTop] + ' de ' + rep.length + ').');
  }

  /* Hora del día. */
  const clavesHora = Object.keys(porHora).sort(function(a, b){ return porHora[b] - porHora[a]; });
  const horaTop = Number(clavesHora[0]);
  if (rep.length >= MINIMO_PATRON && porHora[clavesHora[0]] >= 2){
    const franja = horaTop < 12 ? 'mañana' : horaTop < 19 ? 'tarde' : 'noche';
    patrones.push('reportas sobre todo de ' + (horaTop < 12 ? 'mañana' : horaTop < 19 ? 'tarde' : 'noche'));
    L.push('La hora a la que más reportas son las ' + horaTop + ':00, o sea por la ' + franja + '.');
  }

  /* Colonia + tipo: la combinación que más se repite. */
  const clavesPar = Object.keys(porPareja).sort(function(a, b){ return porPareja[b] - porPareja[a]; });
  if (rep.length >= MINIMO_PATRON && porPareja[clavesPar[0]] >= 2){
    patrones.push('combinas "' + clavesPar[0] + '"');
    L.push('Lo que más se repite es "' + clavesPar[0] + '" (' + porPareja[clavesPar[0]] + ' veces).');
  }

  /* Cada cuánto reportas. */
  const tiempos = rep.map(function(r){ return Number(r.ts) || 0; })
    .filter(function(t){ return t > 0; }).sort(function(a, b){ return a - b; });
  if (tiempos.length >= 2){
    const dias = [];
    for (let i = 1; i < tiempos.length; i++) dias.push((tiempos[i] - tiempos[i - 1]) / 86400000);
    const media = dias.reduce(function(a, b){ return a + b; }, 0) / dias.length;
    L.push('Entre un reporte y el siguiente pasan unos ' + (media < 1 ? 'mismo día' : media.toFixed(1) + ' días') + ' de media.');
  }

  /* antiquity del último reporte. */
  const ultimo = Math.max.apply(null, tiempos.length ? tiempos : [0]);
  if (ultimo){
    const dias = Math.max(0, Math.round((Date.now() - ultimo) / 86400000));
    L.push('Tu último reporte es de hace ' + (dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : dias + ' días') + '.');
  }

  if (!patrones.length){
    L.unshift(rep.length < MINIMO_PATRON
      ? 'Solo llevas ' + rep.length + ' ' + (rep.length === 1 ? 'reporte' : 'reportes') +
        ', y con menos de ' + MINIMO_PATRON + ' no se puede ver un patrón sin inventarlo.'
      : 'Con tus ' + rep.length + ' reportes no sale un patrón claro: reportas repartido.');
  }
  return { suficiente: patrones.length > 0, patrones: patrones, texto: L.join(' ') };
}

/** Las preguntas sobre TU actividad las responde la app, no el modelo.
    Motivo medido: con la herramienta "consultar_datos" el modelo daba los
    números correctos y aun así escribía la colonia equivocada. Un dato
    sobre tu actividad no puede depender de que un modelo redacte bien. */
function ecoRespuestaPersonal(t){
  const rep = ecoMisReportes();
  const acc = estado.acciones || [];
  if (ecoTiene(t, 'colonia') && ecoTiene(t, 'mas', 'reparto', 'reporto', 'reportar')){
    const c = ecoConclusion(rep, 'colonia');
    if (!c) return { texto: 'Todavía no hay ningún reporte guardado, así que no hay colonia donde más hayas reportado.' };
    return {
      verificada: true,
      texto: 'Es en ' + c + '.\n\n' + (rep.length === 1
        ? 'Solo llevas un reporte, así que no hay comparación que hacer.'
        : 'Lo conté sobre tus ' + rep.length + ' reportes guardados.'),
      ir: 'reportes'
    };
  }
  if (ecoTiene(t, 'patron', 'patrones', 'cada cuanto', 'cada cuánto', 'ultimo reporte', 'último reporte',
      'reciente', 'dia de la semana', 'día de la semana', 'hora') ||
      (ecoTiene(t, DIAS) && ecoTiene(t, 'reporto', 'reportar', 'mis', 'mi'))){
    // Sin estas palabras la pregunta no va de tus reportes, aunque diga
    // "patrón": "¿qué es un patrón de reciclaje?" es otra cosa.
    if (!ecoTiene(t, 'reporto', 'reportar', 'cuando', 'cada cuanto', 'cada cuánto', 'dia', 'día',
        'hora', 'reciente', 'ultimo', 'último', 'mis', 'mi', 'yo', 'he')){
      return null;
    }
    const p = ecoPatrones(rep);
    return { verificada: true, texto: p.texto, ir: 'reportes' };
  }
  if (ecoTiene(t, 'tipo') && ecoTiene(t, 'mas', 'repetido', 'frecuencia', 'hago', 'reporto')){
    const c = ecoConclusion(rep, 'tipo');
    if (!c) return { texto: 'No tienes reportes guardados todavía, así que no hay ningún tipo que se repita.' };
    return {
      verificada: true,
      texto: 'El tipo que más has reportado es ' + c + '.\n\nConté tus ' + rep.length + ' reportes guardados.',
      ir: 'reportes'
    };
  }
  if (ecoTiene(t, 'cuantos reportes', 'cuantas veces he reportado', 'mis reportes', 'cuantos he reportado')){
    return {
      verificada: true,
      texto: 'Llevas ' + rep.length + ' ' + (rep.length === 1 ? 'reporte guardado' : 'reportes guardados') + '.\n\n' +
        (sesion.usuario ? 'Con la sesión iniciada, son los tuyos.'
          : 'Aviso: sin cuenta no puedo decir cuáles son tuyos y cuáles son de otros vecinos.'),
      ir: 'reportes'
    };
  }
  if (ecoTiene(t, 'insignia', 'insignias', 'medalla')){
    const faltan = INSIGNIAS.filter(function(i){ return (estado.insignias || []).indexOf(i.id) === -1; });
    return {
      verificada: true,
      texto: 'Tienes ' + (estado.insignias || []).length + ' de ' + INSIGNIAS.length + ' insignias.\n\n' +
        (faltan.length
          ? 'Te faltan: ' + faltan.map(function(i){ return i.icono + ' ' + i.nombre; }).join(', ') + '.'
          : '¡Las tienes todas!'),
      ir: 'perfil'
    };
  }
  if (ecoTiene(t, 'accion', 'acciones', 'dias', 'días', 'racha')){
    if (!acc.length){
      return {
        verificada: true,
        texto: 'Todavía no has registrado ninguna acción ecológica. La primera te da ' + PTS.accion +
          ' puntos y la insignia "Primera acción".',
        ir: 'perfil'
      };
    }
    const dias = (estado.diasAccion || []).length;
    return {
      verificada: true,
      texto: 'Llevas ' + acc.length + ' ' + (acc.length === 1 ? 'acción ecológica' : 'acciones ecológicas') +
        ' registradas en ' + dias + ' ' + (dias === 1 ? 'día' : 'días') + ' distinto' + (dias === 1 ? '' : 's') + '.\n\n' +
        'La insignia "Separador responsable" se desbloquea con 3 días distintos: ' +
        (dias >= 3 ? 'ya la tienes.' : 'te faltan ' + (3 - dias) + '.'),
      ir: 'perfil'
    };
  }
  return null;
}

let ecoHayIA = false;          // ¿el servidor tiene un modelo detrás?
let ecoEstadoCargado = false;  // ya se preguntó en esta sesión

/** Datos de referencia que ve el modelo. Sin datos personales.
    El catálogo entero (78 nombres) solo se manda cuando la pregunta
    habla de colonias: son ~400 tokens que en el resto de preguntas
    serían peso muerto y tiempo de más para un modelo de 11B. */
function ecoContextoIA(pregunta){
  const L = [];
  L.push('Colonias con ruta en la app: ' +
    Object.keys(ZONAS).map(function(k){ return ZONAS[k].nombre; }).join(', ') + '.');
  const nPregunta = normalizar(pregunta || '');
  if (ecoTiene(nPregunta, 'colonia', 'colonias') || ecoColoniaEnTexto(nPregunta)){
    L.push('Estas son todas las colonias de Ciudad Guzmán que la app reconoce (' + COLONIAS.length +
      '): ' + COLONIAS.join(', ') + '. De ellas, SOLO tienen ruta en el mapa las 6 de la lista de arriba: ' +
      'si te preguntan por cualquier otra, dile que esa colonia todavía no tiene ruta en la app y ' +
      'ofrécele reportar el problema desde la pestaña Reportes.');
  }
  const col = ZONAS[estado.coloniaId];
  if (col) L.push('El usuario tiene seleccionada la colonia ' + col.nombre + '.');
  L.push(rutaActiva
    ? 'Ruta cargada ahora mismo: ' + rutaActiva.zona + ', recorrido de ' + fmtDistancia(rutaActiva.distanciaM) +
      ' sobre ' + rutaActiva.fuente + ', con ' + puntosActuales.length + ' puntos propuestos cada ' + INTERVALO_PUNTOS + ' m.'
    : 'Ahora mismo no hay ninguna ruta cargada en el mapa.');
  const cerca = ecoPuntoCercanoReal();
  const m = cerca.texto ? /#(\d+) de la ruta de ([^,]+), a ([^\n]+ en línea recta)/.exec(cerca.texto) : null;
  L.push(m
    ? 'Punto propuesto más cercano a la ubicación del usuario: #' + m[1] + ' de la ruta de ' + m[2] + ', a ' + m[3] + '.'
    : 'El usuario todavía no ha dado su ubicación, así que no hay punto más cercano que calcular.');
  const n = nivelDe(estado.puntos || 0);
  L.push('Puntos del usuario: ' + (estado.puntos || 0) + '. Nivel ' + n.nivel + ' (' + n.nombre + '); el siguiente nivel empieza en ' + n.sig + ' puntos.');
  L.push('Puntos por acción: registrar acción ecológica +' + PTS.accion + ', enviar reporte +' + PTS.reporte + ', publicar o comentar +' + PTS.participacion + ', ayudar +' + PTS.ayuda + '.');
  L.push('Insignias de la app (' + INSIGNIAS.length + '): ' +
    INSIGNIAS.map(function(i){ return i.icono + ' ' + i.nombre; }).join(', ') + '.');
  L.push('Categorías de la guía: ' + Object.keys(CATS_INFO).map(function(k){
    const n2 = RESIDUOS.filter(function(r){ return r.cat === k; }).length;
    return CATS_INFO[k].t + ' (' + n2 + ')';
  }).join(' | ') + '.');
  L.push('Guía de residuos (' + RESIDUOS.length + '):\n' + RESIDUOS.map(function(r){
    return '- ' + r.e + ' ' + r.n + ' [' + r.cat + ']: ' + r.c;
  }).join('\n'));
  const sel = $('#repTipo');
  if (sel && sel.options){
    const tipos = Array.prototype.slice.call(sel.options).map(function(o){ return o.value; })
      .filter(function(v){ return v; });
    L.push('Tipos de reporte que admite el formulario: ' + tipos.join(', ') + '.');
  }
  L.push('Secciones de la app: Inicio, Mapa, Reciclaje (guía), Reportes, Comunidad, Mi perfil.');
  L.push('Aviso: los puntos de recolección los propone el sistema con las calles reales del mapa (OpenStreetMap), no son puntos municipales oficiales. No hay GPS del camión ni horario de recolección.');
  return L.join('\n');
}

/** Pregunta al propio servidor si hay IA. No revela nada del secreto. */
function ecoEstadoIA(forzar){
  if (ecoEstadoCargado && !forzar) return Promise.resolve(ecoHayIA);
  return fetch('/api/eco', { headers: { 'Accept': 'application/json' } })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){ ecoHayIA = !!(j && j.ok && j.ia); })
    .catch(function(){ ecoHayIA = false; })
    .then(function(){
      ecoEstadoCargado = true;
      ecoPintarEstadoIA();
      return ecoHayIA;
    });
}
function ecoPintarEstadoIA(){
  const e = $('#ecoEstado');
  if (!e) return;
  e.className = 'eco-estado ' + (ecoHayIA ? 'con-ia' : 'sin-ia');
  e.textContent = ecoHayIA
    ? 'IA disponible: lo que no esté en mis reglas lo redacta un modelo de lenguaje en el servidor de la app. ' +
      'De aquí salen tu pregunta y datos que ya están a la vista (colonias, guía de residuos, tus puntos y el nombre del punto más cercano). Nunca tu nombre, tu correo ni tu ubicación. ' +
      'Y si le preguntas algo sobre tu propia actividad ("¿en qué colonia he reportado más?"), puede consultar tus reportes y publicaciones: solo en ese caso, y te aviso debajo de la respuesta.'
    : 'Sin IA en el servidor: contesto solo con las reglas de esta app, sin conexión. Si una regla no entiende tu pregunta, te lo digo en vez de inventar.';
}

/** Llamada a /api/eco. Nunca lanza: devuelve {ok, respuesta|error} o
    {ok:true, herramientas} cuando el modelo pide consultar algo. */
function ecoFetchIA(pregunta, permiteDatos, ronda, resultados, historial){
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = setTimeout(function(){ if (ctrl) ctrl.abort(); }, 35000);
  return fetch('/api/eco', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pregunta: pregunta.slice(0, 400),
      contexto: ecoContextoIA(pregunta),
      permiteDatos: !!permiteDatos,
      ronda: ronda || 1,
      resultados: resultados || [],
      historial: historial || []
    }),
    signal: ctrl ? ctrl.signal : undefined
  }).then(function(r){
    return r.json().catch(function(){ return null; }).then(function(j){
      if (!r.ok || !j || !j.ok) return { ok: false, error: (j && j.error) || 'red' };
      if (j.herramientas && j.herramientas.length) return { ok: true, herramientas: j.herramientas };
      if (j.respuesta) return { ok: true, respuesta: j.respuesta };
      return { ok: false, error: 'vacia' };
    });
  }).catch(function(){
    return { ok: false, error: 'red' };
  }).then(function(r){
    clearTimeout(t);
    return r;
  });
}

/* ---------- Herramientas que ejecuta el navegador ----------
   El modelo solo PIDE; los datos y las cuentas están aquí. Por eso la
   calculadora no es un eval: es un analizador propio que solo entiende
   números y + - * / % ( ), y devuelve null ante cualquier otra cosa. */
function ecoCalcular(entrada){
  const s = ecoTexto(entrada).replace(/\s+/g, '');
  if (!s || s.length > 120 || !/^[0-9+\-*/%().]+$/.test(s)) return null;
  let i = 0;
  const fin = function(){ return i >= s.length; };
  const numero = function(){
    const t = s.slice(i).match(/^\d+(\.\d+)?/);
    if (!t){ i = -1; return null; }
    i += t[0].length;
    return Number(t[0]);
  };
  const factor = function(){
    if (fin()){ i = -1; return null; }
    if (s[i] === '+' || s[i] === '-'){ const signo = s[i] === '-' ? -1 : 1; i++; const v = factor(); return v === null ? null : signo * v; }
    if (s[i] === '('){ i++; const v = expresion(); if (s[i] !== ')'){ i = -1; return null; } i++; return v; }
    return numero();
  };
  const termino = function(){
    let v = factor();
    if (v === null) return null;
    while (!fin() && '*/%'.indexOf(s[i]) !== -1){
      const op = s[i]; i++;
      const d = factor();
      if (d === null) return null;
      if ((op === '/' || op === '%') && d === 0) return null;   // dividir entre cero no da resultado
      v = op === '*' ? v * d : op === '/' ? v / d : v % d;
    }
    return v;
  };
  const expresion = function(){
    let v = termino();
    if (v === null) return null;
    while (!fin() && (s[i] === '+' || s[i] === '-')){
      const op = s[i]; i++;
      const d = termino();
      if (d === null) return null;
      v = op === '+' ? v + d : v - d;
    }
    return v;
  };
  if (i < 0) return null;
  const r = expresion();
  if (r === null || !isFinite(r)) return null;
  return Math.round(r * 1e6) / 1e6;
}

/** ¿La pregunta es sobre la actividad del propio usuario? Solo entonces se
    ofrece la herramienta que lee sus datos. */
function ecoEsPreguntaPersonal(pregunta, historial){
  const t = normalizar(pregunta);
  if (ecoTiene(t, 'mis ', 'mi ', 'yo ', 'conmigo', 'he reportado', 'he publicado',
      'he registrado', 'he hecho', 'lo que he', 'cuanto llevo', 'llevo ', 'mi historial',
      'mi actividad', 'mi progreso', 'mis datos')) return true;
  if (/(^|[^a-z])(mis|mi|yo)([^a-z]|$)/.test(t)) return true;
  // "¿y los míos?" no lleva nada de lo de arriba, pero solo tiene sentido
  // con los datos de la persona: se pregunta con la conversación delante.
  if (historial && historial.length){
    for (let i = historial.length - 1; i >= 0; i--){
      if (historial[i].rol !== 'yo') continue;
      const h = normalizar(historial[i].texto);
      if (/(^|[^a-z])(mis|mi|yo|mios|mias)([^a-z]|$)/.test(h) ||
          ecoTiene(h, 'he reportado', 'he publicado', 'lo que he', 'mi actividad')) return true;
      break;   // solo el último turno del usuario manda
    }
  }
  return false;
}

/** Cuenta por campo y devuelve el total y el más repetido, YA CALCULADOS.
    La app elige el máximo; el modelo no tiene que comparar nada. */
function ecoReparto(lista, campo, etiqueta){
  if (!lista || !lista.length) return etiqueta + ': no hay nada.';
  const c = {};
  lista.forEach(function(x){
    const k = ecoTexto(x[campo] || 'sin dato').slice(0, 40);
    c[k] = (c[k] || 0) + 1;
  });
  const claves = Object.keys(c).sort(function(a, b){ return c[b] - c[a]; });
  const max = c[claves[0]];
  const tope = claves.filter(function(k){ return c[k] === max; });
  const resto = claves.map(function(k){ return k + ' (' + c[k] + ')'; }).join(', ');
  return etiqueta + ' (total ' + lista.length + '): ' +
    (tope.length > 1
      ? 'hay empate entre ' + tope.join(' y ') + ', con ' + max + ' cada uno'
      : 'el más es ' + claves[0] + ', con ' + max) +
    '. Todos: ' + resto + '.';
}
function ecoContar(lista, campo){
  const c = {};
  lista.forEach(function(x){
    const k = ecoTexto(x[campo] || 'sin dato').slice(0, 40);
    c[k] = (c[k] || 0) + 1;
  });
  return Object.keys(c).sort(function(a, b){ return c[b] - c[a]; })
    .map(function(k){ return k + ': ' + c[k]; }).join(', ');
}
function ecoMisReportes(){
  const todos = (estado.reportes || []).filter(function(r){ return !r.oculto; });
  if (sesion.usuario){
    return todos.filter(function(r){ return r.usuario_id && r.usuario_id === sesion.usuario.id; });
  }
  return todos;
}
function ecoMes(ts){
  const d = new Date(Number(ts) || 0);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
/** Los tres repartos de golpe, cada uno YA CONCLUIDO (con su máximo).
    El modelo no compara ni cuenta: solo lee. */
function ecoRepartos(rep){
  if (!rep || !rep.length) return 'Sin repartos: no hay reportes.';
  return ecoReparto(rep, 'colonia', 'Por colonia') + '\n' +
    ecoReparto(rep, 'tipo', 'Por tipo de reporte') + '\n' +
    ecoReparto(rep.map(function(r){ return { m: ecoMes(r.ts) }; }), 'm', 'Por mes');
}

/** La herramienta "consultar_datos". Devuelve texto, nunca objetos: lo que
    sale de aquí es lo único que el modelo ve de la actividad del usuario. */
function ecoConsultarDatos(que){
  const rep = ecoMisReportes();
  const mine = (estado.publicaciones || []).filter(function(p){
    return !p.ejemplo && sesion.usuario && p.usuario_id && p.usuario_id === sesion.usuario.id;
  });
  const acc = estado.acciones || [];
  if (que === 'resumen'){
    const quien = sesion.usuario ? 'con tu cuenta iniciada' : 'sin cuenta: no puedo separar lo tuyo de lo de los demás';
    return 'Reportes visibles en la app: ' + rep.length + '. Publicaciones tuyas: ' + mine.length +
      '. Acciones ecológicas registradas: ' + acc.length + ' en ' + (estado.diasAccion || []).length +
      ' días distintos. Puntos: ' + (estado.puntos || 0) + '. Insignias: ' + (estado.insignias || []).length +
      ' de ' + INSIGNIAS.length + '. (' + quien + ')\n' + ecoRepartos(rep);
  }
  if (que === 'reportes'){
    if (!rep.length) return 'No hay ningún reporte en la app todavía.';
    const cuenta = sesion.usuario ? '' : ' (sin cuenta no puedo decir cuáles son tuyos)';
    // Las CONCLUSIONES van primero: si el modelo lee de arriba abajo y ve
    // primero las filas, se confunde y dice "no tengo información".
    return ecoRepartos(rep) + '\nUltimos reportes:\n' + rep.slice(0, 6).map(function(r){
      return ecoMes(r.ts) + ' · ' + (r.colonia || 'sin colonia') + ' · ' + (r.tipo || 'sin tipo') +
        ' · ' + ((ESTADOS_REPORTE[r.estado] || {}).txt || 'sin estado') +
        (r.foto ? ' · con foto' : '') +
        (r.texto ? ' · dice: "' + ecoTexto(r.texto).slice(0, 110) + '"' : '');
    }).join('\n') + cuenta;
  }
  if (que === 'publicaciones'){
    if (!mine.length) return 'No tienes publicaciones propias guardadas en este dispositivo.';
    return mine.slice(0, 8).map(function(p){
      return ecoMes(p.ts) + ' · ' + (p.colonia || 'sin colonia') + ' · ' + (p.tipo || 'sin tipo') +
        ' · ' + p.likes + ' me gusta · ' + ((p.comentarios || []).length) + ' comentarios' +
        (p.texto ? ' · dice: "' + ecoTexto(p.texto).slice(0, 110) + '"' : '');
    }).join('\n');
  }
  if (que === 'acciones'){
    if (!acc.length) return 'Todavía no has registrado ninguna acción ecológica.';
    const dias = (estado.diasAccion || []).length;
    // Racha: días consecutivos hacia atrás desde el último registro.
    let racha = 0;
    const marcas = acc.map(function(a){ return ecoTexto(ecoMes(a.ts)); })
      .filter(function(v, i, a){ return a.indexOf(v) === i; }).sort();
    if (marcas.length){
      const hoy = new Date();
      const claveHoy = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
      let dia = hoy;
      while (racha < marcas.length){
        const k = dia.getFullYear() + '-' + String(dia.getMonth() + 1).padStart(2, '0');
        if (marcas.indexOf(k) === -1) break;
        racha++;
        dia.setDate(dia.getDate() - 1);
      }
      if (racha === 0 && marcas.indexOf(claveHoy) === -1){
        // No registraste hoy: la racha se corta en 0 pero los dias siguen contando.
        racha = 0;
      }
    }
    return 'Llevas ' + acc.length + ' acciones ecológicas registradas en ' + dias + ' días distintos. ' +
      (racha > 0 ? 'Tu racha actual es de ' + racha + ' días seguidos. ' : 'Hoy todavía no registraste una acción, así que tu racha está en 0. ') +
      'La insignia "Separador responsable" se desbloquea con 3 días distintos, así que ' +
      (dias >= 3 ? 'ya la tienes.' : 'te faltan ' + (3 - dias) + '.' ) + '\n' +
      acc.slice(0, 6).map(function(a){
        return new Date(Number(a.ts) || 0).toLocaleDateString('es-MX') + ' · ' + (a.texto || a.tipo || 'acción');
      }).join('\n');
  }
  if (que === 'insignias'){
    const tiene = estado.insignias || [];
    const faltan = INSIGNIAS.filter(function(i){ return tiene.indexOf(i.id) === -1; });
    return 'Tienes ' + tiene.length + ' de ' + INSIGNIAS.length + ': ' +
      (tiene.length ? tiene.join(', ') : 'ninguna todavía') +
      '. Te faltan: ' + (faltan.length ? faltan.map(function(i){ return i.nombre; }).join(', ') : 'ninguna');
  }
  if (que === 'patrones'){
    return ecoPatrones(rep).texto;
  }
  if (que === 'por_colonia' || que === 'por_tipo' || que === 'por_mes'){
    return ecoRepartos(rep);
  }
  // Cualquier otra cosa ("reportes", "mis datos", "todo") cae en el
  // resumen completo: es mejor darle de más que quedarse corto.
  const quien = sesion.usuario ? 'con tu cuenta iniciada' : 'sin cuenta: no puedo separar lo tuyo de lo de los demás';
  return 'No reconozco "' + que + '", así que te paso el resumen completo. ' +
    'Reportes visibles en la app: ' + rep.length + '. Publicaciones tuyas: ' + mine.length +
    '. Acciones ecológicas: ' + acc.length + ' en ' + (estado.diasAccion || []).length +
    ' días distintos. Puntos: ' + (estado.puntos || 0) + '. Insignias: ' + (estado.insignias || []).length +
    ' de ' + INSIGNIAS.length + '. (' + quien + ')\n' + ecoRepartos(rep);
}

/** Simula lo que pasaría con las acciones que el usuario propone y DEVUELVE
    LA CONCLUSIÓN. Sumar y comparar es trabajo de la app: el modelo solo la
    lee. Medido: con "calcular" el modelo acertaba la suma y luego se
    equivocaba al comparar ("275 es menor que 220"). */
function ecoSimularAcciones(entrada){
  const cuenta = { accion: 0, reporte: 0, participacion: 0, ayuda: 0 };
  const texto = ecoTexto(Array.isArray(entrada) ? entrada.join(' ') : entrada).toLowerCase();
  const meter = function(cantidad, tipo){
    cuenta[tipo] += Math.min(cantidad, 99);
  };
  const clase = function(palabra){
    if (/reporte|queja/.test(palabra)) return 'reporte';
    if (/publicacion|comentario|publico/.test(palabra)) return 'participacion';
    if (/accion|ecologica/.test(palabra)) return 'accion';
    if (/ayud|comparto/.test(palabra)) return 'ayuda';
    return null;
  };
  // "2 reportes y 3 publicaciones" cuenta dos y tres, no uno y uno.
  let m;
  const conNumero = /(\d+)\s*([a-z]+)/g;
  let encontró = false;
  while ((m = conNumero.exec(texto)) !== null){
    const t = clase(m[2]);
    if (t){ meter(Number(m[1]), t); encontró = true; }
  }
  if (!encontró){
    texto.split(/[^a-z]+/).forEach(function(p){
      const t = clase(p);
      if (t) meter(1, t);
    });
  }
  if (!(cuenta.accion || cuenta.reporte || cuenta.participacion || cuenta.ayuda)){
    return 'No entendí qué acciones quieres simular. Nómbralas así: "2 reportes y 3 publicaciones".';
  }
  const gana = cuenta.accion * PTS.accion + cuenta.reporte * PTS.reporte +
    cuenta.participacion * PTS.participacion + cuenta.ayuda * PTS.ayuda;
  const antes = estado.puntos || 0;
  const despues = antes + gana;
  const n1 = nivelDe(antes), n2 = nivelDe(despues);
  const partes = [];
  if (cuenta.reporte) partes.push(cuenta.reporte + ' reporte(s) (+' + (cuenta.reporte * PTS.reporte) + ')');
  if (cuenta.participacion) partes.push(cuenta.participacion + ' publicación(es) o comentario(s) (+' + (cuenta.participacion * PTS.participacion) + ')');
  if (cuenta.accion) partes.push(cuenta.accion + ' acción(es) ecológica(s) (+' + (cuenta.accion * PTS.accion) + ')');
  if (cuenta.ayuda) partes.push(cuenta.ayuda + ' ayuda(s) (+' + (cuenta.ayuda * PTS.ayuda) + ')');
  const veredicto = n2.nivel > n1.nivel
    ? 'SÍ, alcanzarías el nivel ' + n2.nivel + ' ("' + n2.nombre + '").'
    : 'NO, no alcanzarías otro nivel todavía: te quedarías en "' + n1.nombre + '".';
  // Corto y con la respuesta al principio. Medido: con un texto largo el
  // modelo se lo releía, lo recalculaba y acababa equivocándose.
  return 'RESPUESTA CORRECTA: ' + veredicto + ' Llevas ' + antes + ' puntos; con ' +
    partes.join(' + ') + ' ganarías ' + gana + ' y quedarías en ' + despues + '.';
}

/** Ejecuta lo que el modelo pidió y devuelve el texto que vuelve al servidor. */
function ecoEjecutarHerramienta(h){
  const nombre = ecoTexto(h && h.nombre).slice(0, 40);
  let resultado;
  try {
    if (nombre === 'calcular'){
      const n = ecoCalcular(h.datos && h.datos.expresion);
      resultado = (n === null)
        ? 'No pude calcular esa expresión: solo admito números y los operadores + - * / % y paréntesis.'
        : 'Resultado: ' + n;
    } else if (nombre === 'simular_acciones'){
      resultado = ecoSimularAcciones(h.datos && h.datos.acciones);
    } else if (nombre === 'consultar_datos'){
      resultado = ecoConsultarDatos(ecoTexto(h.datos && h.datos.que).slice(0, 30));
    } else {
      resultado = 'Esa herramienta no existe en esta app.';
    }
  } catch(e){
    resultado = 'La herramienta falló al ejecutarse.';
  }
  return { nombre: nombre, argumentos: ecoTexto(h && h.argumentos).slice(0, 300),
    resultado: ecoTexto(resultado).slice(0, 1200) };
}

function ecoBloquear(b){
  const i = $('#ecoInput'), btn = $('#ecoEnviar');
  if (i) i.disabled = b;
  if (btn){ btn.disabled = b; btn.textContent = b ? 'Pensando…' : 'Enviar'; }
}

/** Vista que sugiere el atajo, deducida de la pregunta. */
function ecoVistaSugerida(pregunta){
  const t = normalizar(pregunta);
  if (ecoTiene(t, 'recicl', 'residuo', 'basura', 'separar', 'reciclaje', 'guia')) return 'guia';
  if (ecoTiene(t, 'mapa', 'ruta', 'punto', 'colonia')) return 'mapa';
  if (ecoTiene(t, 'reporte', 'reportar', 'queja')) return 'reportes';
  if (ecoTiene(t, 'comunidad', 'publica', 'comentario', 'me gusta', 'vecino')) return 'comunidad';
  if (ecoTiene(t, 'punto', 'insignia', 'nivel', 'progreso', 'perfil')) return 'perfil';
  return null;
}

/** La conversación que ya está pintada en pantalla, para que el modelo
    sepa de qué se está hablando. Se lee del chat en vez de guardarse en
    otro sitio: si el chat está vacío, no hay memoria que enviar. Solo se
    mandan los últimos turnos y el texto va recortado. */
const ECO_TURNOS_MEMORIA = 6;
function ecoHistorial(){
  const chat = $('#ecoChat');
  if (!chat) return [];
  const turnos = [];
  Array.prototype.forEach.call(chat.children, function(el){
    const clase = el.className || '';
    const texto = (el.textContent || '').trim();
    if (!texto) return;
    if (clase.indexOf('eco-msg-yo') !== -1) turnos.push({ rol: 'yo', texto: texto });
    else if (clase.indexOf('eco-msg-eco') !== -1) turnos.push({ rol: 'eco', texto: texto });
  });
  return turnos.slice(-ECO_TURNOS_MEMORIA).map(function(t){
    return { rol: t.rol, texto: t.texto.slice(0, 400) };
  });
}

/** Pregunta a la IA. El modelo puede pedir herramientas; se ejecutan
    aquí (los datos están aquí) y se le devuelven para que redacte. Si no
    hay IA o falla, se cae a las reglas: nunca se muestra una respuesta
    inventada ni se pierde la pregunta. */
function ecoPreguntarIA(pregunta, historial){
  const personal = ecoEsPreguntaPersonal(pregunta, historial);
  ecoEstadoIA().then(function(hay){
    if (!hay){ ecoResponderReglas(pregunta); return; }
    ecoBloquear(true);
    const espera = ecoMensajeEspera();
    let ronda = 1, resultados = [], usadas = [];

    function paso(){
      ecoFetchIA(pregunta, personal, ronda, resultados, historial).then(function(r){
        if (!r.ok){
          ecoBloquear(false);
          ecoQuitarMensaje(espera);
          ecoResponderReglas(pregunta, r.error);
          return;
        }
        // El modelo puede pedir herramientas y seguir pensando: se le
        // devuelven los resultados y vuelve a redactar. El tope está en el
        // servidor; aquí solo se respeta lo que él devuelve.
        if (r.herramientas && ronda < ECO_RONDAS){
          resultados = r.herramientas.map(ecoEjecutarHerramienta);
          usadas = usadas.concat(r.herramientas.map(function(h){ return ecoTexto(h.nombre); }));
          ecoMensajePoner(espera, usadas.length ? 'Consultando tus datos…' : 'Pensando…');
          ronda = Math.max(ronda + 1, Number(r.ronda) || 1);
          paso();
          return;
        }
        ecoBloquear(false);
        ecoMensajePoner(espera, r.respuesta);
        ecoMensajeFuente(usadas.length);
        const v = ecoVistaSugerida(pregunta);
        if (v) ecoPintarAcciones([{ etiqueta: '→ Ir a ' + (ECO_ETIQUETA_VISTA[v] || 'esa sección'), ir: v }]);
      });
    }
    paso();
  });
}

/** Las reglas de la app. Ahora son el RESPALDO: solo se pintan cuando la
    IA no está, falló o se quedó sin cuota. Las cuentas y los datos los
    sigue haciendo la app a través de las herramientas. */
function ecoResponderReglas(pregunta, error){
  const r = ecoResponder(pregunta);
  if (r){ ecoPintarRespuesta(r); return; }
  ecoMensajeEco(ecoSinRespuesta(error));
}

function ecoSinRespuesta(error){
  const causa = {
    'tiempo': 'El servidor tardó demasiado y no alcanzó a responder. ',
    'cuota': 'El servidor alcanzó su límite de uso por ahora. ',
    'demasiadas': 'Has preguntado demasiado rápido. Espera un minuto. ',
    'sin-clave': 'El servidor no tiene IA configurada. ',
    'vacia': 'El modelo no devolvió nada. ',
    'red': 'No hay conexión con el servidor de Eco. '
  }[error] || 'No pude responder. ';
  return 'Esa no la sé todavía 🤔\n\n' + causa + 'Sin servidor solo puedo contestarte lo que tiene esta app:\n\n' +
    '· Rutas de recolección y puntos propuestos.\n' +
    '· El punto más cercano a tu ubicación.\n' +
    '· Cómo separar un residuo concreto.\n' +
    '· Cómo enviar un reporte.\n' +
    '· Comunidad, puntos e insignias.\n' +
    '· Qué datos guarda la app.\n\n' +
    'Prefiero decirte "no lo sé" antes que inventarte una respuesta.';
}

/* ---------- Interfaz de Eco ---------- */
function ecoAbrir(){
  const chat = $('#ecoChat');
  if (chat && !chat.children.length){
    ecoMensajeEco(
      'Hola, soy Eco 🌿\n\n' + ECO_LEMA + '\n\nTe ayudo con lo que tiene esta app: rutas y puntos ' +
      'propuestos, cómo separar residuos, reportes, comunidad y tus puntos. Pregúntame con tus palabras.\n\n' +
      'Una aclaración importante: no tengo conexión con el ayuntamiento ni GPS del camión, así que de ' +
      'eso no te puedo dar datos. Prefiero decirte "no lo sé" antes que inventarte algo.'
    );
  }
  renderChipsEco();
  abrirModal('modalEco');
  ecoEstadoIA();
  setTimeout(function(){ const i = $('#ecoInput'); if (i) i.focus(); }, 120);
}
function ecoMensajeEco(texto){
  const chat = $('#ecoChat');
  if (!chat) return null;
  const d = document.createElement('div');
  d.className = 'eco-msg eco-msg-eco';
  d.textContent = texto;      // textContent: lo que escriba el usuario nunca se interpreta como HTML
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  return d;
}
/** Burbuja de espera mientras el servidor redacta. */
function ecoMensajeEspera(){
  const d = ecoMensajeEco('Pensando…');
  if (d) d.classList.add('eco-espera');
  return d;
}
function ecoMensajePoner(d, texto){
  if (!d) return ecoMensajeEco(texto);
  d.textContent = texto;
  d.classList.remove('eco-espera');
  const chat = $('#ecoChat');
  if (chat) chat.scrollTop = chat.scrollHeight;
  return d;
}
function ecoQuitarMensaje(d){
  if (d && d.parentNode) d.parentNode.removeChild(d);
}
/** Nota al pie de una respuesta redactada por el modelo. */
function ecoMensajeFuente(herramientas){
  const chat = $('#ecoChat');
  if (!chat) return;
  if (herramientas && herramientas.length){
    const n = document.createElement('div');
    n.className = 'eco-fuente eco-fuente-datos';
    n.textContent = '🔎 Para contestarte, Eco consultó ' + ecoTexto(herramientas.join(', ')).slice(0, 120) +
      '. Salieron del dispositivo solo esos datos, y solo porque la pregunta era sobre tu actividad.';
    chat.appendChild(n);
  }
  const d = document.createElement('div');
  d.className = 'eco-fuente';
  d.textContent = '✍️ Redactado por un modelo de lenguaje en el servidor, con los datos de esta app. Si te da un horario del camión, no le creas: aquí no hay ese dato.';
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}
function ecoMensajeYo(texto){
  const chat = $('#ecoChat');
  if (!chat) return;
  const d = document.createElement('div');
  d.className = 'eco-msg eco-msg-yo';
  d.textContent = texto;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}
/** Lista con viñetas dentro de una burbuja de Eco. */
function ecoMensajeLista(items){
  const chat = $('#ecoChat');
  if (!chat) return;
  const d = document.createElement('div');
  d.className = 'eco-msg eco-msg-eco';
  const ul = document.createElement('ul');
  ul.className = 'eco-lista';
  items.forEach(function(it){
    const li = document.createElement('li');
    li.textContent = it;
    ul.appendChild(li);
  });
  d.appendChild(ul);
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}
/** Botones de acción. Cada uno es un .eco-chip suelto dentro del chat:
    sin esto se estiraría a todo el ancho de la burbuja. */
function ecoPintarAcciones(acciones){
  const chat = $('#ecoChat');
  if (!chat || !acciones || !acciones.length) return;
  acciones.forEach(function(a){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'eco-chip';
    b.style.marginTop = '.35rem';
    b.textContent = a.etiqueta;
    b.addEventListener('click', function(){
      if (a.fn){ a.fn(); return; }
      cerrarModal('modalEco');
      if (a.ir) irA(a.ir);
    });
    chat.appendChild(b);
  });
  chat.scrollTop = chat.scrollHeight;
}
function renderChipsEco(){
  const cont = $('#ecoChips');
  if (!cont) return;
  cont.replaceChildren();               // ni una vez innerHTML en este módulo
  ECO_CHIPS.forEach(function(p){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'eco-chip';
    b.textContent = p;
    b.addEventListener('click', function(){ ecoPreguntar(p); });
    cont.appendChild(b);
  });
}
/** Pinta una respuesta de las reglas: texto, lista, acciones y atajo. */
function ecoPintarRespuesta(r){
  if (!r) return false;
  ecoMensajeEco(ecoTexto(r.texto));
  if (r.lista) ecoMensajeLista(r.lista);
  if (r.acciones) ecoPintarAcciones(r.acciones);
  // Ofrece el atajo, pero solo a vistas abiertas para todo el mundo:
  // el panel de moderación nunca se ofrece desde aquí.
  if (r.ir && r.ir !== 'moderacion'){
    ecoPintarAcciones([{ etiqueta: '→ Ir a ' + (ECO_ETIQUETA_VISTA[r.ir] || 'esa sección'), ir: r.ir }]);
  }
  return true;
}
/* Orden de decisión: primero el modelo, que es quien conversa. Las reglas
   quedan como respaldo cuando no hay IA o falla. Lo que la app sabe con
   exactitud (puntos, cuentas, patrones, el punto más cercano) no se pierde:
   el modelo lo pide con las herramientas y se lo devolvemos ya resuelto. */
const ECO_RONDAS = 3;
function ecoPreguntar(pregunta){
  // El historial se lee ANTES de pintar la pregunta nueva, para no mandar
  // dos veces el mismo turno.
  const historial = ecoHistorial();
  ecoMensajeYo(pregunta);
  ecoPreguntarIA(pregunta, historial);
}

const btnEco = $('#btnEco');
if (btnEco) btnEco.addEventListener('click', ecoAbrir);
const formEco = $('#ecoForm');
if (formEco){
  formEco.addEventListener('submit', function(e){
    e.preventDefault();
    const i = $('#ecoInput');
    const q = (i.value || '').trim();
    if (!q) return;
    i.value = '';
    ecoPreguntar(q);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();

if ('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(function(){ /* sin service worker la app funciona igual */ });
  });
}

})();
