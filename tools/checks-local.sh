#!/usr/bin/env bash
# Las mismas comprobaciones sin red del workflow, para correrlas antes de
# pushear. No es el CI: solo el Avisa de que algo se rompió.
cd "$(dirname "$0")/.." || exit 1
ok=0
fail=0
chk(){ if eval "$2" >/dev/null 2>&1; then echo "  ok   $1"; ok=$((ok+1)); else echo "  FALLA $1"; fail=$((fail+1)); fi }

echo "1 · Sintaxis de app.js y sw.js"
node --check app.js >/dev/null 2>&1 && node --check sw.js >/dev/null 2>&1 && ok=$((ok+1)) && echo "  ok   app.js y sw.js" || { echo "  FALLA app.js o sw.js"; fail=$((fail+1)); }
chk "api/eco.js, dev-server, tests" "node --check api/eco.js && node --check tools/dev-server.js && node --check tests/eco-api.js && node --check tests/eco-reglas.js"

echo "2 · La clave de la IA no está en el repositorio"
chk "ninguna clave versionada" "! (git ls-files -z | xargs -0 grep -lE 'nvapi-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,}')"
chk ".env ignorado" "grep -qx '.env' .gitignore"
chk "api/eco.js lee process.env" "grep -q 'process.env.NVIDIA_API_KEY' api/eco.js"

echo "3 · /api/eco aguanta sus propias defensas"
chk "tests/eco-api.js" "node tests/eco-api.js"

echo "4 · Las cuentas de Eco las hace la app, no el modelo"
chk "tests/eco-reglas.js" "node tests/eco-reglas.js"
chk "ecoCalcular sin eval ni Function" "! sed -n '/function ecoCalcular/,/^}/p' app.js | grep -qE 'eval\(|new Function'"

echo "5 · La CSP no se abre para la IA"
chk "la IA no necesita abrir la CSP" "! grep -E 'integrate\.api\.nvidia|openai\.com|anthropic\.com|generativelanguage\.googleapis' vercel.json"

echo "6 · index.html no lleva CSS ni JS incrustados"
chk "sin <style>" "! grep -q '<style>' index.html"
chk "sin <script> con código" "! grep -qE '<script>[^<]' index.html"

echo "7 · El módulo Eco no usa HTML ni código peligroso"
patrones='innerHTML *=  document\.write  eval\(  new Function  insertAdjacentHTML'
mal=0
while IFS= read -r patron; do
  [ -z "$patron" ] && continue
  if sed -n '/MÓDULO 23/,/^})();/p' app.js | grep -qE "$patron"; then
    echo "  FALLA Eco usa $patron"; mal=1
  fi
done <<< "$patrones"
if [ "$mal" = 0 ]; then echo "  ok   Eco pinta con textContent"; ok=$((ok+1)); else fail=$((fail+1)); fi

echo "8 · Archivos referenciados existen"
for f in estilos.css app.js sw.js manifest.webmanifest icon.svg icon-192.png icon-512.png api/eco.js; do
  [ -f "$f" ] || { echo "  FALLA falta $f"; fail=$((fail+1)); }
done
chk "sw.js precachea estilos.css, app.js y deja /api/ a la red" \
  "grep -q \"'./estilos.css'\" sw.js && grep -q \"'./app.js'\" sw.js && grep -q \"pathname.indexOf('/api/')\" sw.js"

echo "9 · La sincronización no puede reventar contra la nube"
chk "usuario_id normalizado en upsertNube" "grep -q 'copia.usuario_id = (sesion.usuario && sesion.usuario.id) || null' app.js"
chk "filtra _pendiente en publicaciones" "grep -q 'p._pendiente && !esperaDemasiado(p)' app.js"
chk "filtra _pendiente en reportes" "grep -q 'x._pendiente && !esperaDemasiado(x)' app.js"

echo "10 · JSON válidos"
chk "vercel.json y manifest" "node -e \"JSON.parse(require('fs').readFileSync('vercel.json','utf8'))\" && node -e \"JSON.parse(require('fs').readFileSync('manifest.webmanifest','utf8'))\""
chk "JSON-LD del index.html" "node -e \"
const fs=require('fs');const h=fs.readFileSync('index.html','utf8');
const m=h.match(/<script type=\\\"application\\\\/ld\\\\+json\\\">([\\s\\S]*?)<\\\\/script>/);
if(!m){console.error('falta el JSON-LD');process.exit(1)}
JSON.parse(m[1]);
\""

echo "11 · La CSP cubre lo que la app usa"
chk "los 8 orígenes y sin unsafe-eval" "node -e \"
const fs=require('fs');
const v=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const csp=(v.headers[0].headers.find(h=>h.key==='Content-Security-Policy')||{}).value||'';
const obligatorios=['https://unpkg.com','fonts.googleapis.com','fonts.gstatic.com','*.supabase.co','*.tile.openstreetmap.org','router.project-osrm.org','nominatim.openstreetmap.org','api.mapbox.com'];
const falta=obligatorios.filter(d=>!csp.includes(d));
if(falta.length){console.error('falta: '+falta.join(', '));process.exit(1)}
if(csp.includes(\\\"'unsafe-eval'\\\")){console.error('unsafe-eval');process.exit(1)}
if(!/script-src[^;]*'self'/.test(csp)){console.error('script-src sin self');process.exit(1)}
\""

echo "12 · Cero caracteres CJK en el código"
chk "0 CJK" "node -e \"
const fs=require('fs'),path=require('path');let n=0;
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){
  if(e.name==='.git'||e.name==='node_modules'||e.name==='.freebuff')continue;
  const p=path.join(d,e.name);
  if(e.isDirectory()){w(p);continue}
  if(!/\.(js|html|css|json|md|sql|yml|webmanifest|txt)$/.test(e.name))continue;
  if(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3040-\u30FF\uAC00-\uD7AF]/u.test(fs.readFileSync(p,'utf8'))){n++;console.error('CJK en '+p)}
}})(process.cwd());
if(n)process.exit(1);
\""

echo "13 · La caché del service worker está al día"
chk "bym-v13" "grep -q \"const CACHE = 'bym-v13'\" sw.js"
echo "14 · El service worker no esconde las actualizaciones"
chk "tests/sw-cache.js" "node tests/sw-cache.js"
chk "tests/sw-cache-atrapa.js" "node tests/sw-cache-atrapa.js"

echo
echo "$ok comprobaciones en orden, $fail fallos."
[ "$fail" = 0 ] || exit 1