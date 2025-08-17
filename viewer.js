// Vista sólo lectura: muestra números ocupados desde el CSV publicado
import { } from './main.js'; // no reusa lógica de envío; sólo estilos compartidos

const CONFIG = {
  sheetCsvUrl: (typeof window !== 'undefined' && window.SHEET_CSV_URL) || undefined,
  // Si no se puede leer de window (no expuesto), copia el mismo valor que usas en main.js:
  fallbackSheetCsvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR9ZblmvJXvYqOMriTLNy0CLS9CPJH-jl333dbI3GrWBTcwmVDYuM4xFEEpg5KdkdMFC5rXeDG2FcnL/pub?output=csv',
  csvNumberHeader: 'número',
  csvNumberColIndex: null,
  totalNumbers: 50,
  autoRefreshMs: 10000,
};

const SHEET_CSV_URL = (() => {
  const u = (CONFIG.sheetCsvUrl || CONFIG.fallbackSheetCsvUrl || '').trim();
  if(!u) return '';
  if(/\/export\?format=csv/i.test(u)) return u;
  if(/\/pub\?output=csv/i.test(u)) return u;
  if(/\/pub$/i.test(u)) return u + '?output=csv';
  if(/\/edit/i.test(u)) return u.replace(/\/edit.*$/i,'') + '/export?format=csv&gid=0';
  return u;
})();

function $(sel){return document.querySelector(sel)}

function setStatus(msg, type='info'){
  const el = $('#status');
  if(el){
    el.textContent = msg || '';
    el.style.color = type === 'error' ? '#ff6b6b' : type === 'success' ? '#7ce38b' : '#9fb3c8';
  }
}

function parseCSV(text){
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
  row.push(cur);
  rows.push(row);
  return rows;
}

async function fetchTakenNumbers(){
  if(!SHEET_CSV_URL){ setStatus('Hoja no configurada', 'error'); return new Set(); }
  try{
    const bust = (SHEET_CSV_URL.includes('?') ? '&' : '?') + 'cb=' + Date.now();
    const res = await fetch(SHEET_CSV_URL + bust, { cache: 'no-store' });
    const text = await res.text();
    const rows = parseCSV(text).filter(r=>r.length && r.some(c=>c!==''));
    if(rows.length===0) return new Set();
    const headers = rows[0].map(h=>String(h||'').trim().toLowerCase());
    let idx = -1;
    if(Number.isInteger(CONFIG.csvNumberColIndex)){
      idx = CONFIG.csvNumberColIndex;
    }else{
      const wanted = String(CONFIG.csvNumberHeader||'').normalize('NFD').replace(/\p{Diacritic}/gu,'');
      idx = headers.findIndex(h=>{
        const norm = h.normalize('NFD').replace(/\p{Diacritic}/gu,'');
        return /^(numero|nro|num)$/.test(norm) || norm===wanted;
      });
    }
    const body = rows.slice(1);
    const nums = new Set();
    if(idx === -1){
      for(const r of body){
        const v = r[r.length-1];
        const n = parseInt(String(v||'').trim(),10);
        if(!isNaN(n)) nums.add(n);
      }
      return nums;
    }
    for(const r of body){
      const v = r[idx];
      const n = parseInt(String(v||'').trim(),10);
      if(!isNaN(n)) nums.add(n);
    }
    return nums;
  }catch(e){
    console.error('Error CSV', e);
    setStatus('No se pudo cargar la disponibilidad.', 'error');
    return new Set();
  }
}

function renderGrid(taken){
  const grid = $('#grid');
  grid.innerHTML='';
  const frag = document.createDocumentFragment();
  for(let i=1;i<=CONFIG.totalNumbers;i++){
    const btn = document.createElement('button');
    btn.type='button';
    btn.className = 'number'+(taken.has(i)?' taken':'');
    btn.textContent = String(i);
    btn.disabled = true; // sólo lectura
    frag.appendChild(btn);
  }
  grid.appendChild(frag);
}

async function tick(){
  const taken = await fetchTakenNumbers();
  renderGrid(taken);
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  const last = document.getElementById('lastUpdate');
  if(last) last.textContent = `Última actualización: ${hh}:${mm}:${ss}`;
}

(async function init(){
  setStatus('Cargando…');
  await tick();
  setStatus('');
  setInterval(tick, CONFIG.autoRefreshMs);
})();
