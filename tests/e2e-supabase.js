/* ============================================================
   BASURA Y MÁS · Verificación E2E contra Supabase
   ------------------------------------------------------------
   Ejecuta el flujo completo sin navegador: crear cuenta, perfil,
   publicar, subir una foto, límites de tamaño, like, comentario,
   intento de vandalismo, suplantación, renovación de token y
   recuperación de contraseña.

   Uso (desde la carpeta del proyecto):
       node tests/e2e-supabase.js

   IMPORTANTE · esta prueba crea datos de prueba en la nube.
   Las tablas no tienen política de borrado (por seguridad), así que
   al terminar hay que limpiarlos desde el SQL Editor de Supabase:

     delete from storage.objects where name like 'reportes/e2e-%';
     delete from public.comentarios  where publicacion_id like 'e2e-%';
     delete from public.likes_votos  where publicacion_id like 'e2e-%';
     delete from public.publicaciones where id like 'e2e-%';
     delete from public.reportes   where id like 'e2e-%';
     delete from auth.users        where email like 'e2e.bym+%@gmail.com';

   Salida esperada: "✅ Todas las comprobaciones pasaron".
   ============================================================ */
const REF = 'https://rmnnqggasqxlpntcffrz.supabase.co';
const KEY = 'sb_publishable_uxNAAYBRnfq8anL_RAzheA_3Mz8joIn';
const REST = REF + '/rest/v1/';
const AUTH = REF + '/auth/v1/';
const STO = REF + '/storage/v1/object/';
const STAMP = Date.now();
const EMAIL = `e2e.bym+${STAMP}@gmail.com`;
const PASS = 'Prueba1234!.';
const JPEG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
let sesion = null;
let fallos = 0;

function anon(extra) {
  return Object.assign({ apikey: KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY }, extra || {});
}
function conSesion(extra) {
  return Object.assign({ apikey: KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sesion ? sesion.token : KEY) }, extra || {});
}
async function json(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
  return { status: r.status, ok: r.ok, data: d };
}
function check(nombre, cond, detalle) {
  console.log((cond ? '  OK   ' : '  FALLA') + ' · ' + nombre + (cond ? '' : '  → ' + JSON.stringify(detalle)));
  if (!cond) fallos++;
}

(async function () {
  console.log('\n=== 1. Crear cuenta (sin confirmar correo) ===');
  const signup = await json(AUTH + 'signup', { method: 'POST', headers: anon(), body: JSON.stringify({ email: EMAIL, password: PASS }) });
  check('signup responde 200', signup.ok, signup.data);
  sesion = { token: signup.data.access_token, refresh_token: signup.data.refresh_token, user: signup.data.user };
  check('recibe access_token', !!(sesion && sesion.token), signup.data);
  const uid = sesion.user.id;

  console.log('\n=== 2. Perfil creado por el trigger ===');
  const perfiles = await json(REST + 'perfiles?id=eq.' + uid + '&select=id,nombre', { headers: conSesion() });
  check('perfil existe', Array.isArray(perfiles.data) && perfiles.data.length === 1, perfiles.data);
  check('nombre = prefijo del correo', perfiles.data[0] && perfiles.data[0].nombre === EMAIL.split('@')[0], perfiles.data);

  console.log('\n=== 3. Renombrar el perfil (PATCH propio) ===');
  const ren = await json(REST + 'perfiles?id=eq.' + uid, { method: 'PATCH', headers: conSesion({ Prefer: 'return=representation' }), body: JSON.stringify({ nombre: 'Vecino E2E' }) });
  check('nombre actualizado', ren.data && ren.data[0] && ren.data[0].nombre === 'Vecino E2E', ren.data);

  console.log('\n=== 4. Publicar con cuenta (usuario_id propio) ===');
  const postId = 'e2e-post-' + STAMP;
  const post = { id: postId, nombre: 'Vecino E2E', colonia: 'Centro', tipo: 'Propuesta', texto: 'Publicación de verificación automática.', likes: 0, comentarios: [], ts: Date.now(), usuario_id: uid };
  const insPost = await json(REST + 'publicaciones', { method: 'POST', headers: conSesion({ Prefer: 'return=representation', resolution: 'merge-duplicates' }), body: JSON.stringify([post]) });
  check('publicación insertada', insPost.ok && insPost.data.length === 1, insPost.data);
  check('usuario_id correcto', insPost.data[0] && insPost.data[0].usuario_id === uid, insPost.data);

  console.log('\n=== 5. Subir foto a Supabase Storage ===');
  const ruta = 'reportes-fotos/reportes/' + postId + '.jpg';
  const bytes = Buffer.from(JPEG_B64, 'base64');
  const up = await fetch(STO + ruta, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + sesion.token, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: bytes });
  check('subida de foto 200', up.status === 200, await up.text());
  const urlPublica = STO + 'public/' + ruta;
  const get = await fetch(urlPublica);
  check('foto pública accesible', get.status === 200 && (get.headers.get('content-type') || '').indexOf('image') === 0, get.status + ' ' + get.headers.get('content-type'));
  const bytesBack = Buffer.from(await get.arrayBuffer());
  check('archivo íntegro', bytesBack.length === bytes.length, bytesBack.length + ' vs ' + bytes.length);

  console.log('\n=== 6. Reporte con la foto como URL ===');
  const repId = 'e2e-rep-' + STAMP;
  const rep = { id: repId, nombre: 'Vecino E2E', colonia: 'Centro', tipo: 'Basura acumulada', texto: 'Reporte de verificación automática.', foto: urlPublica, ubicacion: { lat: 19.7, lng: -103.4 }, estado: 'Sincronizado con la nube', ts: Date.now(), usuario_id: uid };
  const insRep = await json(REST + 'reportes', { method: 'POST', headers: conSesion({ Prefer: 'return=representation', resolution: 'merge-duplicates' }), body: JSON.stringify([rep]) });
  check('reporte insertado', insRep.ok && insRep.data.length === 1, insRep.data);
  check('foto guardada como URL (no data URL)', insRep.data[0] && String(insRep.data[0].foto).indexOf('https://') === 0, insRep.data[0] && insRep.data[0].foto);

  console.log('\n=== 7. Límites de tamaño (texto de 5000 caracteres) ===');
  const largo = await json(REST + 'publicaciones', { method: 'POST', headers: conSesion(), body: JSON.stringify([{ id: 'e2e-largo-' + STAMP, nombre: 'X', colonia: 'Centro', tipo: 'Aviso', texto: 'a'.repeat(5000), likes: 0, comentarios: [], ts: Date.now(), usuario_id: uid }]) });
  check('texto gigante rechazado (23514)', largo.status === 400 && JSON.stringify(largo.data).indexOf('23514') !== -1, largo.data);

  console.log('\n=== 8. Invitado: like y comentario sí funcionan ===');
  const huella = 'e2e-huella-' + STAMP;
  const rpcLike = (h) => json(REST + 'rpc/dar_like', { method: 'POST', headers: anon(), body: JSON.stringify({ p_publicacion_id: postId, p_huella: h }) });
  const like1 = await rpcLike(huella);
  check('like por RPC aplicado (=1)', like1.ok && like1.data === 1, like1.data);
  const like2 = await rpcLike(huella);
  check('segundo like del mismo dispositivo rechazado', !like2.ok && /ya registraste/i.test(JSON.stringify(like2.data)), like2.data);
  const like3 = await rpcLike(huella + '-otro');
  check('otro dispositivo puede apoyar (=2)', like3.ok && like3.data === 2, like3.data);
  const inflar = await json(REST + 'publicaciones?id=eq.' + postId, { method: 'PATCH', headers: anon({ Prefer: 'return=representation' }), body: JSON.stringify({ likes: 1000000 }) });
  check('no se pueden inflar likes por PATCH', inflar.data && inflar.data[0] && inflar.data[0].likes === 2, inflar.data);
  const bajar = await json(REST + 'publicaciones?id=eq.' + postId, { method: 'PATCH', headers: anon({ Prefer: 'return=representation' }), body: JSON.stringify({ likes: 0 }) });
  check('no se pueden bajar likes por PATCH', bajar.data && bajar.data[0] && bajar.data[0].likes === 2, bajar.data);
  const meter = await json(REST + 'publicaciones?id=eq.' + postId, { method: 'PATCH', headers: anon({ Prefer: 'return=representation' }), body: JSON.stringify({ comentarios: [{ autor: 'Invitado', texto: '¡Me apunto!', ts: Date.now() }] }) });
  check('comentario NO se puede meter por PATCH (ahora es tabla)', meter.data && meter.data[0] && meter.data[0].comentarios.length === 0, meter.data);
  const com = await json(REST + 'rpc/crear_comentario', { method: 'POST', headers: anon(), body: JSON.stringify({ p_publicacion_id: postId, p_texto: '¡Me apunto!', p_autor: 'Invitado', p_huella: huella }) });
  check('comentario creado por RPC', com.ok && com.data && com.data.texto === '¡Me apunto!', com.data);
  const leerCom = await json(REST + 'comentarios?publicacion_id=eq.' + postId + '&select=autor,texto', { headers: anon() });
  check('comentario visible en la tabla', leerCom.ok && leerCom.data.length === 1, leerCom.data);
  const insertDirecto = await json(REST + 'comentarios', { method: 'POST', headers: anon(), body: JSON.stringify([{ publicacion_id: postId, texto: 'injection', emisor: 'x', ts: Date.now() }]) });
  check('insert directo en comentarios bloqueado', !insertDirecto.ok, insertDirecto.data);

  console.log('\n=== 9. Invitado NO puede reescribir el texto ===');
  const vanda = await json(REST + 'publicaciones?id=eq.' + postId, { method: 'PATCH', headers: anon({ Prefer: 'return=representation' }), body: JSON.stringify({ texto: 'TEXTO VANDALIZADO', nombre: 'Hacker' }) });
  check('texto intacto', vanda.data && vanda.data[0] && vanda.data[0].texto === post.texto, vanda.data);
  check('nombre intacto', vanda.data && vanda.data[0] && vanda.data[0].nombre === 'Vecino E2E', vanda.data);

  console.log('\n=== 10. Invitado NO puede firmarse como otro ===');
  const suplanta = await json(REST + 'publicaciones', { method: 'POST', headers: anon(), body: JSON.stringify([{ id: 'e2e-fraude-' + STAMP, nombre: 'Suplantado', colonia: 'Centro', tipo: 'Aviso', texto: 'me hago pasar por otro', likes: 0, comentarios: [], ts: Date.now(), usuario_id: uid }]) });
  check('suplantación bloqueada (42501)', suplanta.status === 401, suplanta.data);

  console.log('\n=== 11. Renovación del token (refresh) ===');
  const refresh = await json(AUTH + 'token?grant_type=refresh_token', { method: 'POST', headers: anon(), body: JSON.stringify({ refresh_token: sesion.refresh_token }) });
  check('nuevo access_token', !!(refresh.data && refresh.data.access_token), refresh.data);
  if (refresh.data && refresh.data.access_token) {
    sesion.token = refresh.data.access_token;
    const otra = await json(REST + 'publicaciones?id=eq.' + postId + '&select=likes,comentarios', { headers: conSesion() });
    check('el token renovado da acceso', otra.ok, otra.data);
  }

  console.log('\n=== 12. Recuperación de contraseña (envío de correo) ===');
  const rec = await json(AUTH + 'recover', { method: 'POST', headers: anon(), body: JSON.stringify({ email: EMAIL, redirect_to: 'https://basura-y-mas.vercel.app/' }) });
  check('recover responde 200 (o 5xx de SMTP)', rec.ok, rec.data);

  console.log('\n=== 13. Estado final (la limpieza es manual, ver cabecera del archivo) ===');
  const fin = await json(REST + 'publicaciones?id=like.e2e-*&select=id', { headers: anon() });
  const finRep = await json(REST + 'reportes?id=like.e2e-*&select=id', { headers: anon() });
  check('filas de prueba visibles para limpiar', (fin.data || []).length + (finRep.data || []).length > 0,
    'ejecuta el DELETE de la cabecera en el SQL Editor');
  console.log('  → ejecuta los 4 DELETE de la cabecera de este archivo en el SQL Editor de Supabase.');

  console.log('\n' + (fallos ? '❌ ' + fallos + ' comprobaciones fallaron' : '✅ Todas las comprobaciones pasaron'));
  process.exit(fallos ? 1 : 0);
})();
