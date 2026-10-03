// ============================================================
// BASURA Y MÁS · Envío del resumen de reportes por correo
// Proyecto FILOSOFARTE · Filosofía II · Daniel Alvarez · CBTis 226
// ------------------------------------------------------------
// ESTA FUNCIÓN NO ESTÁ DESPLEGADA NI PROBADA.
//
// Para activarla hacen falta tres cosas que el equipo del proyecto
// debe hacer a mano (no se puede hacer desde el navegador sin
// exponer la clave):
//
//   1) Crear el archivo de secretos de Supabase:
//        supabase secrets set RESEND_API_KEY=re_... \
//                            RESEND_FROM=Basura y Mas <correo@tu-dominio.com> \
//                            CORREO_DESTINO=direccion@oficial.example
//      (CORREO_DESTINO debe ser una dirección REAL confirmada por el
//      municipio. El código NO trae ninguna por defecto.)
//
//   2) Desplegar:
//        supabase functions deploy resumen-reportes
//
//   3) Configurar en Authentication → URL Configuration:
//        Site URL  = https://basura-y-mas.vercel.app
//        Redirect  = https://basura-y-mas.vercel.app
//
// CÓMO LA LLAMA LA APP
//   POST https://<proyecto>.supabase.co/functions/v1/resumen-reportes
//   Authorization: Bearer <access_token del usuario administrador>
//   Body: {} (opcionalmente {"dias": 7})
//
// La función vuelve a preguntar a la base de datos si quien llama es
// administrador (public.es_admin), aunque la app ya lo haya comprobado:
// ocultar un botón no es una medida de seguridad.
//
// ─────────────────────────────────────────────────────────────
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const REF = Deno.env.get('SUPABASE_URL') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const RESEND = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM = Deno.env.get('RESEND_FROM') ?? ''
const DESTINO = Deno.env.get('CORREO_DESTINO') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function esc(t: string): string {
  return String(t ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── 1. ¿Quién llama? (JWT del rol authenticated) ──────────────────
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Falta la sesión.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
  const token = auth.slice(7)
  const supabase = createClient(REF, ANON, { global: { headers: { Authorization: auth } } })
  const { data: usr, error: eUsr } = await supabase.auth.getUser(token)
  if (eUsr || !usr.user) {
    return new Response(JSON.stringify({ error: 'Sesión inválida.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // ── 2. ¿Es administradora? (la base de datos manda) ─────────────
  const { data: esAdmin, error: eAd } = await supabase.rpc('es_admin')
  if (eAd || esAdmin !== true) {
    return new Response(JSON.stringify({ error: 'Solo una cuenta administradora.' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // ── 3. Sin destinatario configurado no se envía nada ─────────────
  if (!DESTINO || !RESEND || !FROM) {
    return new Response(JSON.stringify({
      error: 'Falta configuración: RESEND_API_KEY, RESEND_FROM y/o CORREO_DESTINO.',
    }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // ── 4. Resumen de los últimos días ───────────────────────────────
  let dias = 7
  try {
    const cuerpo = await req.json()
    if (cuerpo && Number.isFinite(Number(cuerpo.dias))) dias = Math.min(90, Math.max(1, Number(cuerpo.dias)))
  } catch { /* body opcional */ }

  const desde = Date.now() - dias * 86400000
  const { data: reportes, error: eRep } = await supabase
    .from('reportes')
    .select('id,nombre,colonia,tipo,texto,estado,ubicacion,ts,oculto')
    .gte('ts', desde)
    .order('ts', { ascending: false })
    .limit(500)

  if (eRep) {
    return new Response(JSON.stringify({ error: 'No se pudieron leer los reportes.' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  const filas = (reportes ?? []).filter((r: any) => !r.oculto)
  const porEstado = filas.reduce((acc: Record<string, number>, r: any) => {
    acc[r.estado] = (acc[r.estado] ?? 0) + 1
    return acc
  }, {})
  const porColonia = filas.reduce((acc: Record<string, number>, r: any) => {
    acc[r.colonia] = (acc[r.colonia] ?? 0) + 1
    return acc
  }, {})

  const fecha = new Date().toLocaleDateString('es-MX')
  const lista = filas.map((r: any) => {
    const d = new Date(Number(r.ts))
    const ub = r.ubicacion
      ? `${Number(r.ubicacion.lat).toFixed(3)}, ${Number(r.ubicacion.lng).toFixed(3)} (±100 m)`
      : 'sin ubicación'
    return `<li><strong>${esc(r.colonia)} · ${esc(r.tipo)}</strong> [${esc(r.estado)}] — ${esc(r.texto)}<br><small>${esc(d.toLocaleString('es-MX'))} · ${esc(ub)}</small></li>`
  }).join('')

  const asunto = `BASURA Y MÁS · ${filas.length} reportes ciudadanos (últimos ${dias} días)`

  const html = `<!doctype html><html lang="es"><body style="font-family:system-ui,sans-serif;color:#161D17;line-height:1.5">
    <h2 style="color:#2E7D32">BASURA Y MÁS · Resumen de reportes</h2>
    <p><strong>${esc(fecha)}</strong> · últimos ${dias} días · ${filas.length} reportes visibles</p>
    <p><strong>Por estado:</strong> ${Object.entries(porEstado).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ') || 'sin datos'}</p>
    <p><strong>Por colonia:</strong> ${Object.entries(porColonia).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ') || 'sin datos'}</p>
    <hr>
    <ul>${lista || '<li>No hay reportes en este periodo.</li>'}</ul>
    <hr>
    <p style="font-size:12px;color:#5A6A5E">Proyecto FILOSOFARTE · Filosofía II · CBTis 226.<br>
    La ubicación de cada reporte se guarda difuminada a unos 100 metros para proteger la privacidad de quien reporta.<br>
    El detalle completo está en el CSV que exporta el panel de moderación.</p>
  </body></html>`

  // ── 5. Envío con Resend ──────────────────────────────────────────
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [DESTINO], subject: asunto, html }),
  })

  if (!res.ok) {
    const detalle = await res.text()
    // NO se devuelve el cuerpo de Resend al navegador: puede incluir la
    // propia clave en algunos errores de la API.
    console.error('Resend respondió', res.status, detalle.slice(0, 400))
    return new Response(JSON.stringify({ error: 'El proveedor de correo rechazó el envío.' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  const salida = await res.json()
  return new Response(JSON.stringify({ ok: true, enviados: filas.length, id: salida?.id ?? null }), {
    status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
  })
})