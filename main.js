// Configuración: pega el ID de tu Google Sheet publicado y el enlace de tu Google Form
// Lee README.md para el paso a paso de configuración sin APIs.
const CONFIG = {
  // URL CSV público del Google Sheet (hoja con las reservas):
  // Ejemplo: https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=0
  sheetCsvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR9ZblmvJXvYqOMriTLNy0CLS9CPJH-jl333dbI3GrWBTcwmVDYuM4xFEEpg5KdkdMFC5rXeDG2FcnL/pub?output=csv', // Ajuste automático a export CSV más abajo
  // URL del Google Form que recibe los envíos (usar POST a formResponse)
  // Ejemplo: https://docs.google.com/forms/d/e/FORM_ID/formResponse
  formPostUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfuVset921dRpHSJW2Ef9Q1SCl1hj8afPYLc-EuWO1OXmajrg/formResponse', // Se normaliza a /formResponse
  // Mapea los campos del form a los entry IDs del Google Form
  fields: {
    nombre: 'entry.1112988975', // entry.xxxxxx del campo "Nombre"
    numero: 'entry.1160308339', // entry.xxxxxx del campo "Número"
  },
  // (Opcional) Campos ocultos comunes de Google Forms: rellena tras capturar un envío manual si es necesario
  // Usa DevTools -> Network -> formResponse (Form Data) para ver cuáles aparecen.
  hidden: {
    // fvv: '1',
    // draftResponse: '[]',
    // pageHistory: '0',
    // fbzx: '' // valor token largo que cambia; si lo dejas vacío normalmente no es obligatorio
  },
  // Activar modo debug (o añade ?debug=1 a la URL)
  debug: false,
  // Nombre exacto de la columna de número en el CSV (opcional, ignora acentos y mayus)
  csvNumberHeader: 'número',
  // Alternativamente, usa índice de columna (0-based). Si se define, tiene prioridad.
  csvNumberColIndex: null,
  // Intervalo de auto-refresh en ms (null para desactivar)
  autoRefreshMs: 15000,
  // (Opcional) Campos extra constantes para satisfacer requeridos del Form sin mostrarlos en UI
  // Ej: extraConstantFields: { 'entry.234567': 'N/A', 'entry.345678': 'N/A' }
  extraConstantFields: {},
  // (Opcional) TTL para "bloqueos vistos" desde CSV: si el CSV fluctúa, mantiene bloqueados
  // los números observados recientemente para evitar desbloqueos temporales.
  stickySeenTtlMs: 5 * 60 * 1000 // 5 minutos
};

// Normalización de URLs (permite pegar links "share" /viewform y convertirlos)
const SHEET_CSV_URL = (() => {
  if(!CONFIG.sheetCsvUrl) return '';
  const u = CONFIG.sheetCsvUrl.trim();
  // Ya es un export directo
  if(/\/export\?format=csv/i.test(u)) return u;
  // Publicado (pub?output=csv) => usar tal cual
  if(/\/pub\?output=csv/i.test(u)) return u;
  // Enlace que termina en /pub => añadir output=csv
  if(/\/pub$/i.test(u)) return u + '?output=csv';
  // Enlace de edición estándar /edit...
  if(/\/edit/i.test(u)) return u.replace(/\/edit.*$/i,'') + '/export?format=csv&gid=0';
  // Si nada coincide, lo dejamos como está (probablemente un CSV ya proxy o similar)
  return u;
})();

const FORM_POST_URL = (() => {
  if(!CONFIG.formPostUrl) return '';
  return CONFIG.formPostUrl.replace(/\/viewform.*$/, '/formResponse');
})();

const TOTAL_NUMBERS = 50;
let takenSet = new Set();
let selected = null;
// Bloqueos locales temporales para cubrir la latencia del Sheet
const PENDING_TTL_MS = 2 * 60 * 1000; // 2 minutos
const pendingLocks = new Map(); // numero -> expiry timestamp
// Bloqueos "vistos" en CSV recientemente para suavizar oscilaciones del CSV publicado
const seenLocks = new Map(); // numero -> expiry timestamp
const URL_PARAMS = new URLSearchParams(location.search);
if(URL_PARAMS.get('debug')==='1') CONFIG.debug = true;

function isMapped(key){
  return Boolean(CONFIG.fields && CONFIG.fields[key]);
}

function $(sel){return document.querySelector(sel)}
function $all(sel){return Array.from(document.querySelectorAll(sel))}

function setStatus(msg, type='info'){
  const el = $('#status');
  el.textContent = msg || '';
  el.style.color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#7ce38b' : '#9fb3c8';
}

function fetchWithTimeout(url, options={}, timeoutMs=8000){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeoutMs);
  const opts = { ...options, signal: controller.signal };
  return fetch(url, opts).finally(()=>clearTimeout(id));
}

function parseCSV(text){
  // Pequeño parser CSV que soporta comillas dobles
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    const next = text[i+1];
    if(inQuotes){
      if(ch === '"' && next === '"'){ cur += '"'; i++; continue; }
      if(ch === '"'){ inQuotes = false; continue; }
      cur += ch;
    }else{
      if(ch === '"'){ inQuotes = true; continue; }
      if(ch === ','){ row.push(cur); cur=''; continue; }
      if(ch === '\n'){ row.push(cur); rows.push(row); row=[]; cur=''; continue; }
      if(ch === '\r'){ continue; }
      cur += ch;
    }
  }
  // push last cell
  row.push(cur);
  rows.push(row);
  return rows;
}

// Obtiene la lista de números comprados y el nombre del comprador
async function fetchBoughtNumbers(){
  if(!SHEET_CSV_URL){
    console.warn('sheetCsvUrl no configurado');
    return [];
  }
  try{
    const bust = (SHEET_CSV_URL.includes('?') ? '&' : '?') + 'cb=' + Date.now();
    const res = await fetchWithTimeout(SHEET_CSV_URL + bust, { cache: 'no-store' }, 7000);
    if(!res.ok) throw new Error('No se pudo leer el Sheet (HTTP '+res.status+')');
    const text = await res.text();
    const rows = parseCSV(text).filter(r=>r.length && r.some(c=>c!==''));
    if(rows.length === 0) return [];
    const headers = rows[0].map(h=>String(h||'').trim().toLowerCase());
    // Busca índice de número y nombre
    let idxNum = -1, idxName = -1;
    if(Number.isInteger(CONFIG.csvNumberColIndex)){
      idxNum = CONFIG.csvNumberColIndex;
    } else {
      const wanted = String(CONFIG.csvNumberHeader||'').normalize('NFD').replace(/\p{Diacritic}/gu,'');
      idxNum = headers.findIndex(h=>{
        const norm = h.normalize('NFD').replace(/\p{Diacritic}/gu,'');
        return /^(numero|nro|num)$/.test(norm) || norm===wanted;
      });
    }
    // Busca columna de nombre
    idxName = headers.findIndex(h=>/^(nombre|comprador|name)$/i.test(h));
    const body = rows.slice(1);
    const bought = [];
    for(const r of body){
      const vNum = idxNum>-1 ? r[idxNum] : r[r.length-1];
      const vName = idxName>-1 ? r[idxName] : '';
      const n = parseInt(String(vNum||'').trim(),10);
      if(!isNaN(n)) bought.push({numero:n, nombre:String(vName||'').trim()});
    }
    return bought;
  }catch(e){
    console.error('Error obteniendo CSV', e, 'URL usada:', SHEET_CSV_URL);
    setStatus('No se pudo cargar disponibilidad. Verifica que el Sheet esté publicado como CSV.', 'error');
    return [];
  }
}

// Renderiza la vista de consulta: tabla de comprados y lista de disponibles
function renderConsulta(boughtList){
  const consultaDiv = document.getElementById('consulta');
  consultaDiv.innerHTML = '';
  // Tabla de comprados
  const table = document.createElement('table');
  table.className = 'bought-table';
  table.innerHTML = `<thead><tr><th>Número</th><th>Comprador</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  boughtList.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.numero}</td><td>${item.nombre||'-'}</td>`;
    tbody.appendChild(tr);
  });
  consultaDiv.appendChild(table);
  // Lista de disponibles
  const allNumbers = Array.from({length:TOTAL_NUMBERS}, (_,i)=>i+1);
  const boughtNums = new Set(boughtList.map(x=>x.numero));
  const disponibles = allNumbers.filter(n=>!boughtNums.has(n));
  const dispDiv = document.createElement('div');
  dispDiv.className = 'disponibles-list';
  dispDiv.innerHTML = `<strong>Números disponibles:</strong> ${disponibles.length ? disponibles.join(', ') : 'Ninguno'}`;
  consultaDiv.appendChild(dispDiv);
}

function selectNumber(n){
  if(takenSet.has(n)) return;
  selected = n;
  $('#numero').value = String(n);
  $all('.number').forEach(el=>{
    el.classList.toggle('selected', parseInt(el.dataset.n,10)===n);
  });
}

function validate(){
  let ok = true;
  function setErr(name, msg){
    const small = document.querySelector(`small[data-for="${name}"]`);
    if(small) small.textContent = msg || '';
    if(msg) ok = false;
  }
  const nombre = $('#nombre').value.trim();
  const numero = $('#numero').value.trim();

  // nombre siempre requerido si está mapeado (y en nuestra app lo está por defecto)
  if(isMapped('nombre')) setErr('nombre', nombre?'' : 'Requerido');
  // número solo si está mapeado
  if(isMapped('numero')){
    if(!numero) setErr('numero','Elige un número');
    const n = parseInt(numero,10);
    if(numero && (isNaN(n) || n<1 || n>TOTAL_NUMBERS)) setErr('numero','Número fuera de rango');
  }

  if(isMapped('numero') && numero && takenSet.has(parseInt(numero,10))){
    setErr('numero','Ese número ya fue tomado, elige otro');
  }

  return ok;
}

async function submitForm(evt){
  evt.preventDefault();
  const submitBtn = document.getElementById('submit');
  submitBtn && (submitBtn.disabled = true);
  setStatus('Enviando…');
  if(!validate()){
    setStatus('Revisa los campos resaltados.', 'error');
    submitBtn && (submitBtn.disabled = false);
    return;
  }
  // Revalidación de disponibilidad justo antes de enviar
  if(isMapped('numero')){
    try{
      const latest = await fetchTakenNumbers();
      const numStr = $('#numero').value.trim();
      const numVal = parseInt(numStr,10);
      if(latest.has(numVal)){
        takenSet = latest;
        renderGrid();
        setStatus('Ese número acaba de ser tomado. Elige otro.', 'error');
        submitBtn && (submitBtn.disabled = false);
        return;
      }
    }catch(err){
      console.error('Error verificando disponibilidad previa al envío', err);
      setStatus('No se pudo verificar disponibilidad. Intenta de nuevo.', 'error');
      submitBtn && (submitBtn.disabled = false);
      return;
    }
  }
  if(!FORM_POST_URL){
    setStatus('Falta configurar la URL del Google Form', 'error');
    submitBtn && (submitBtn.disabled = false);
    return;
  }
  const mappedKeys = Object.keys(CONFIG.fields||{}).filter(k=>isMapped(k));
  if(mappedKeys.length===0){
    setStatus('No hay campos mapeados para enviar al Form.', 'error');
    submitBtn && (submitBtn.disabled = false);
    return;
  }
  try{
  const payload = new URLSearchParams();
  const vals = {
    nombre: $('#nombre').value.trim(),
    numero: $('#numero').value.trim(),
  };
  if(isMapped('nombre')) payload.set(CONFIG.fields.nombre, vals.nombre);
  if(isMapped('numero')) payload.set(CONFIG.fields.numero, vals.numero);
  // Campos extra constantes (para Forms con preguntas requeridas que no usamos en UI)
  if(CONFIG.extraConstantFields){
    Object.entries(CONFIG.extraConstantFields).forEach(([entryId, value])=>{
      if(entryId && value!=null) payload.set(entryId, String(value));
    });
  }
  // Añade hidden fields si están definidos
  if(CONFIG.hidden){
    Object.entries(CONFIG.hidden).forEach(([k,v])=>{ if(v) payload.set(k,v); });
  }

  if(CONFIG.debug){
    console.log('[DEBUG] POST URL:', FORM_POST_URL);
    console.log('[DEBUG] Payload entries:', Array.from(payload.entries()));
  }

  const res = await fetchWithTimeout(FORM_POST_URL, {
      method: 'POST',
      mode: 'no-cors', // Google Forms no habilita CORS, usamos no-cors
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload.toString(),
    }, 10000);
    // En modo no-cors no hay status legible; asumimos éxito si no hubo error de red
    if(isMapped('numero')){
      setStatus('¡Número reservado! Verificando...', 'success');
      // Lock inmediato para evitar condiciones de carrera locales
  const n = parseInt(vals.numero,10);
  takenSet.add(n);
  addPendingLock(n);
      renderGrid();
    }else{
      setStatus('¡Envío realizado! (solo nombre)', 'success');
    }
    // Limpia selección
    selected = null;
    $('#form').reset();
    if(isMapped('numero')){
      // Verificación diferida: re-carga disponibilidad tras 6s
      setTimeout(async ()=>{
        const after = await fetchTakenNumbers();
        const n = parseInt(vals.numero,10);
        if(!after.has(n)){
          // Mantén el lock local durante la ventana de gracia
          addPendingLock(n);
          setStatus('Reserva enviada. Confirmando con la hoja…', 'info');
          if(CONFIG.debug){
            console.warn('[DEBUG] Número no apareció tras verificación, revisa mapping de entry.* y que Form esté vinculado al Sheet publicado.');
          }
        }else{
          setStatus('¡Número reservado! Gracias.', 'success');
          takenSet = after; // sincroniza por si hubo otros cambios
          renderGrid();
        }
      }, 6000);
    }
  }catch(e){
    console.error(e);
    setStatus('No se pudo enviar. Intenta de nuevo.', 'error');
  }
  finally{
    submitBtn && (submitBtn.disabled = false);
  }
}

function addPendingLock(n){
  const now = Date.now();
  pendingLocks.set(n, now + PENDING_TTL_MS);
  cleanPendingLocks();
}

function cleanPendingLocks(){
  const now = Date.now();
  for(const [n, exp] of pendingLocks.entries()){
    if(exp <= now) pendingLocks.delete(n);
  }
}

function getEffectiveTaken(){
  cleanPendingLocks();
  const eff = new Set(takenSet);
  for(const n of pendingLocks.keys()) eff.add(n);
  // Limpia y aplica seenLocks
  const now = Date.now();
  for(const [n, exp] of seenLocks.entries()){
    if(exp <= now) { seenLocks.delete(n); continue; }
    eff.add(n);
  }
  return eff;
}

async function init(){
  setStatus('Cargando disponibilidad…');
  // Elementos para consulta
  let consultaDiv = document.getElementById('consulta');
  if(!consultaDiv){
    consultaDiv = document.createElement('div');
    consultaDiv.id = 'consulta';
    consultaDiv.style.margin = '2em 0';
    document.body.appendChild(consultaDiv);
  }
  // Botón refrescar y etiqueta de última actualización deben existir antes del primer refresh
  const refreshBtn = document.getElementById('refresh');
  const lastUpdateEl = document.getElementById('lastUpdate');

  function setLastUpdate(){
    if(lastUpdateEl){
      const d = new Date();
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      const ss = String(d.getSeconds()).padStart(2,'0');
      lastUpdateEl.textContent = `Última actualización: ${hh}:${mm}:${ss}`;
    }
  }

  async function refreshConsulta(){
    const boughtList = await fetchBoughtNumbers();
    renderConsulta(boughtList);
    setLastUpdate();
  }

  // Listeners
  $('#form').addEventListener('submit', submitForm);
  refreshBtn && refreshBtn.addEventListener('click', async ()=>{
    refreshBtn.disabled = true; await refreshConsulta(); refreshBtn.disabled = false;
  });

  // Auto-refresh configurable
  if(CONFIG.autoRefreshMs){
    setInterval(async ()=>{
      try{ await refreshConsulta(); }catch{}
    }, CONFIG.autoRefreshMs);
  }

  // Primer refresh ya con helpers definidos
  await refreshConsulta();
  setStatus('');
}

init();
