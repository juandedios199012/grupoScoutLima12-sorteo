// ...existing code...

function fetchBoughtNumbers() {
  setStatus('Cargando disponibilidad…');
  return fetch(SHEET_CSV_URL)
    .then(r => r.text())
    .then(csv => {
      const rows = parseCSV(csv);
      if (!rows.length) throw new Error('No hay datos');
  const header = rows[0].map(h => h.trim().toLowerCase());
  window._csvHeaderRow = rows[0];
  const numIdx = header.indexOf(CONFIG.csvNumberHeader);
  if (numIdx === -1) throw new Error('No se encontró la columna de números');
  CONFIG.csvNumberColIndex = numIdx;
  const buyers = rows.slice(1).filter(r => r[numIdx] && r[numIdx].trim());
  window._csvRows = rows;
  return buyers;
    });
}

function renderConsulta(buyers) {
  const total = CONFIG.totalNumbers;
  const boughtNumbers = buyers.map(r => r[CONFIG.csvNumberColIndex]).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
  const availableNumbers = [];
  for (let i = 1; i <= total; i++) {
    if (!boughtNumbers.includes(i)) availableNumbers.push(i);
  }

  // Renderizar números disponibles arriba de la tabla
  const availableDiv = document.createElement('div');
  availableDiv.className = 'available-numbers';
  availableDiv.innerHTML = `<strong>Números disponibles:</strong> ` + availableNumbers.map(n => `<span class="num">${n}</span>`).join(' ');

  // Renderizar tabla de compradores
  const table = document.createElement('table');
  table.className = 'buyers-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr><th>Nombre</th><th>Número</th></tr>`;
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  // Detectar índice de columna 'nombre' usando el header real del CSV
  let nombreIdx = 1; // Por defecto, después de fecha/hora
  if (window._csvHeaderRow) {
    const h = window._csvHeaderRow.map(h => h.trim().toLowerCase());
    const idx = h.indexOf('nombre');
    if (idx !== -1) nombreIdx = idx;
  }
  buyers.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${row[nombreIdx] || ''}</td><td>${row[CONFIG.csvNumberColIndex]}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  // Insertar en el contenedor principal
  const card = document.querySelector('.card');
  if (card) {
    card.innerHTML = '';
    card.appendChild(availableDiv);
    card.appendChild(table);
    setStatus('Consulta actualizada', 'success');
  }
}

function mainConsulta() {
  fetchBoughtNumbers()
    .then(buyers => {
      renderConsulta(buyers);
    })
    .catch(e => {
      setStatus('Error al cargar: ' + (e.message || e), 'error');
    });
}

window.addEventListener('DOMContentLoaded', mainConsulta);
// Vista sólo lectura: muestra números ocupados desde el CSV publicado
import { } from './main.js'; // no reusa lógica de envío; sólo estilos compartidos

const CONFIG = {
  sheetCsvUrl: (typeof window !== 'undefined' && window.SHEET_CSV_URL) || undefined,
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

// ...aquí va el resto del código de consulta y renderizado...
