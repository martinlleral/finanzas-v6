/**
 * Tests de autenticación del Apps Script.
 *
 * Mockea PropertiesService y compañía para poder correr checkAuth_ fuera de
 * Google. Cubre el modo de falla que motivó el cambio: hasta la v3 el token
 * era una constante del .gs y checkAuth_ DEJABA PASAR TODO cuando valía el
 * placeholder del repo — así que pegar el archivo apagaba la autenticación en
 * silencio, sin ninguna señal.
 *
 * Uso:  node tools/auth-test.js server/apps_script.gs
 *
 * Contra la versión previa pasan 2 de 11. Entre las que fallan está
 * "el viejo placeholder ya NO abre la puerta", que es exactamente el agujero.
 */
const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
let PROPS={};
global.PropertiesService={getScriptProperties:()=>({
  getProperty:k=>PROPS[k]===undefined?null:PROPS[k],
  setProperty:(k,v)=>{PROPS[k]=v;}})};
global.Utilities={getUuid:()=>'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                  formatDate:()=>'2026-01-01'};
global.Logger={log:()=>{}};
global.SpreadsheetApp={getActiveSpreadsheet:()=>({getSheetByName:()=>null,getSheets:()=>[null]}),flush:()=>{}};
global.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
global.ContentService={createTextOutput:t=>({setMimeType:()=>t}),MimeType:{JSON:'json'}};
global.Session={getScriptTimeZone:()=>'UTC'};
eval(src);

const casos=[];
const t=(n,f)=>{try{casos.push([n,f()])}catch(e){casos.push([n,'ERROR: '+e.message])}};

PROPS={};
t('sin token configurado → RECHAZA (falla cerrado)', ()=>{
  try{ checkAuth_({parameter:{token:'loquesea'}}); return false; }
  catch(e){ return /no configurado/.test(e.message); }});

PROPS={SECRET_TOKEN:'token-real-123'};
t('token correcto por query → pasa', ()=>checkAuth_({parameter:{token:'token-real-123'}})===true);
t('token correcto por body → pasa', ()=>checkAuth_({postData:{contents:JSON.stringify({token:'token-real-123'})}})===true);
t('token incorrecto → Unauthorized', ()=>{
  try{ checkAuth_({parameter:{token:'token-falso'}}); return false; }
  catch(e){ return e.message==='Unauthorized'; }});
t('sin token en el request → Unauthorized', ()=>{
  try{ checkAuth_({parameter:{}}); return false; }
  catch(e){ return e.message==='Unauthorized'; }});
t('prefijo correcto NO alcanza (comparación completa)', ()=>{
  try{ checkAuth_({parameter:{token:'token-real'}}); return false; }
  catch(e){ return e.message==='Unauthorized'; }});

PROPS={SECRET_TOKEN:'   '};
t('token solo espacios → tratado como no configurado', ()=>{
  try{ checkAuth_({parameter:{token:'   '}}); return false; }
  catch(e){ return /no configurado/.test(e.message); }});

PROPS={SECRET_TOKEN:'abc'};
t('el viejo placeholder ya NO abre la puerta', ()=>{
  try{ checkAuth_({parameter:{token:'CAMBIAR-POR-UN-TOKEN-RANDOM-DE-32-CHARS'}}); return false; }
  catch(e){ return e.message==='Unauthorized'; }});

PROPS={};
t('setupToken genera y persiste', ()=>{const n=setupToken(); return n.length>=32 && PROPS.SECRET_TOKEN===n;});
t('verificarToken true con token', ()=>verificarToken()===true);
PROPS={};
t('verificarToken false sin token', ()=>verificarToken()===false);

let mal=0;
for(const [n,r] of casos){ if(r!==true){mal++; console.log('❌',n,'→',r);} else console.log('✅',n); }
console.log(`\n${casos.length-mal}/${casos.length} pasaron`);
process.exit(mal?1:0);
