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

// Obtiene lista de números comprados y nombre del comprador
async function fetchBoughtNumbers(){
  if(!SHEET_CSV_URL){ setStatus('Hoja no configurada', 'error'); return []; }
  try{
    const bust = (SHEET_CSV_URL.includes('?') ? '&' : '?') + 'cb=' + Date.now();
    const res = await fetch(SHEET_CSV_URL + bust, { cache: 'no-store' });
    const text = await res.text();
    const rows = parseCSV(text).filter(r=>r.length && r.some(c=>c!==''));
    if(rows.length===0) return [];
    const headers = rows[0].map(h=>String(h||'').trim().toLowerCase());
    let idxNum = -1, idxName = -1;
    if(Number.isInteger(CONFIG.csvNumberColIndex)){
      idxNum = CONFIG.csvNumberColIndex;
    }else{
      const wanted = String(CONFIG.csvNumberHeader||'').normalize('NFD').replace(/\p{Diacritic}/gu,'');
      idxNum = headers.findIndex(h=>{
        const norm = h.normalize('NFD').replace(/\p{Diacritic}/gu,'');
        return /^(numero|nro|num)$/.test(norm) || norm===wanted;
      });
    }
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
    console.error('Error CSV', e);
    setStatus('No se pudo cargar la disponibilidad.', 'error');
    return [];
  }
}

// Renderiza tabla de comprados y lista de disponibles
function renderConsulta(boughtList){
  const grid = $('#grid');
  grid.innerHTML = '';
  // Tabla de comprados mejorada
  const table = document.createElement('table');
  table.className = 'bought-table';
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.innerHTML = `<thead><tr style='background:#f5f5f5;'><th style='padding:8px;border-bottom:2px solid #ccc;'>Número</th><th style='padding:8px;border-bottom:2px solid #ccc;'>Comprador</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  boughtList.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.style.background = idx%2===0 ? '#fff' : '#f9f9f9';
    tr.innerHTML = `<td style='padding:8px;border-bottom:1px solid #eee;text-align:center;'>${item.numero}</td><td style='padding:8px;border-bottom:1px solid #eee;font-weight:600;color:#2a5d9f;'>${item.nombre||'-'}</td>`;
    tbody.appendChild(tr);
  });
  grid.appendChild(table);
  // Lista de disponibles mejorada
  const allNumbers = Array.from({length:CONFIG.totalNumbers}, (_,i)=>i+1);
  const boughtNums = new Set(boughtList.map(x=>x.numero));
  const disponibles = allNumbers.filter(n=>!boughtNums.has(n));
  const dispDiv = document.createElement('div');
  dispDiv.className = 'disponibles-list';
  dispDiv.style.marginTop = '2em';
  dispDiv.innerHTML = `<strong style='font-size:1.1em;'>Números disponibles:</strong> ` +
    (disponibles.length ? disponibles.map(n => `<span style='display:inline-block;background:#e3f7e3;color:#2a5d9f;border-radius:12px;padding:4px 10px;margin:2px 2px;font-weight:600;'>${n}</span>`).join('') : '<span style="color:#ff6b6b;font-weight:600;">Ninguno</span>');
  grid.appendChild(dispDiv);
}

async function tick(){
  const boughtList = await fetchBoughtNumbers();
  renderConsulta(boughtList);
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
