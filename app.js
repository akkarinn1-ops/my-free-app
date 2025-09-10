// ====== storage helpers ======
const KEY = 'entries_v1'; // [{id,date,amount,cat,memo,ts}]
const load = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const saveAll = (a) => localStorage.setItem(KEY, JSON.stringify(a));

// ====== state ======
let today = new Date();
let viewY = today.getFullYear();
let viewM = today.getMonth(); // 0-11
let selectedDate = toISO(new Date());

// ====== dom ======
const grid = document.getElementById('grid');
const ym = document.getElementById('ym');
const monthSum = document.getElementById('monthSum');
const dateI = document.getElementById('date');
const amountI = document.getElementById('amount');
const catI = document.getElementById('cat');
const memoI = document.getElementById('memo');
const listEl = document.getElementById('list');
const selTitle = document.getElementById('selTitle');

dateI.value = selectedDate;

// PWA SW
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

// ====== utils ======
function toISO(d){ // yyyy-mm-dd in local
  const y=d.getFullYear(), m=d.getMonth()+1, dd=d.getDate();
  return `${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}
function fmtJPY(n){ return Number(n).toLocaleString('ja-JP'); }

// ====== calendar render ======
function renderCalendar(){
  ym.textContent = `${viewY}年 ${viewM+1}月`;
  grid.innerHTML = '';

  const first = new Date(viewY, viewM, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewY, viewM+1, 0).getDate();
  const prevDays = new Date(viewY, viewM, 0).getDate();

  const entries = load();
  const map = new Map(); // dateStr -> {sum, cnt}
  for(const e of entries){
    const m = map.get(e.date) || {sum:0,cnt:0};
    m.sum += Number(e.amount)||0;
    m.cnt += 1;
    map.set(e.date, m);
  }

  // cells: 42 (6 weeks)
  const cells = [];
  // prev month padding
  for(let i=startDow-1;i>=0;i--){
    const d = prevDays - i;
    const dt = toISO(new Date(viewY, viewM-1, d));
    cells.push({d, dt, off:true});
  }
  // current month
  for(let d=1; d<=daysInMonth; d++){
    const dt = toISO(new Date(viewY, viewM, d));
    cells.push({d, dt, off:false});
  }
  // next padding
  while(cells.length%7) {
    const d = cells.length - (startDow + daysInMonth) + 1;
    const dt = toISO(new Date(viewY, viewM+1, d));
    cells.push({d, dt, off:true});
  }

  // draw
  let monthTotal = 0;
  for(const cell of cells){
    const div = document.createElement('div');
    div.className = 'day' + (cell.off?' off':'');
    if(cell.dt === selectedDate) div.classList.add('selected');

    const m = map.get(cell.dt);
    const sum = m ? m.sum : 0;
    const cnt = m ? m.cnt : 0;
    if(!cell.off) monthTotal += sum;

    div.innerHTML = `
      <div class="d">${cell.d}</div>
      ${sum? `<div class="sum">¥${fmtJPY(sum)}</div>`:''}
      ${cnt? `<div class="cnt">${cnt}件</div>`:''}
    `;
    div.onclick = () => {
      selectedDate = cell.dt;
      dateI.value = selectedDate;
      renderCalendar();
      renderList();
    };
    grid.appendChild(div);
  }
  monthSum.textContent = `この月の合計: ¥${fmtJPY(monthTotal)}`;
}

// ====== list render ======
function renderList(){
  const items = load().filter(e => e.date === selectedDate).sort((a,b)=>b.ts-a.ts);
  selTitle.textContent = `${selectedDate} の記録（${items.length}件）`;
  listEl.innerHTML = '';
  for(const it of items){
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div class="left">
        <div><span class="amt">¥${fmtJPY(it.amount)}</span> / ${it.cat}</div>
        <div class="muted">${new Date(it.ts).toLocaleTimeString()} - ${it.memo?escapeHTML(it.memo):''}</div>
      </div>
      <div class="right">
        <button data-id="${it.id}" class="del">削除</button>
      </div>`;
    listEl.appendChild(row);
  }
  // wire delete
  listEl.querySelectorAll('.del').forEach(btn=>{
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const arr = load().filter(x=> String(x.id)!==String(id));
      saveAll(arr);
      renderCalendar(); renderList();
    };
  });
}
function escapeHTML(s){ return s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// ====== actions ======
document.getElementById('prev').onclick = ()=>{ if(viewM===0){viewM=11;viewY--;} else viewM--; renderCalendar(); };
document.getElementById('next').onclick = ()=>{ if(viewM===11){viewM=0;viewY++;} else viewM++; renderCalendar(); };

document.getElementById('save').onclick = ()=>{
  const date = dateI.value || toISO(new Date());
  const amount = Number(amountI.value||0);
  if(!amount){ alert('金額が空です'); return; }
  const cat = catI.value || 'その他';
  const memo = memoI.value || '';
  const arr = load();
  arr.push({ id: Date.now()+''+Math.random().toString(16).slice(2), date, amount, cat, memo, ts: Date.now() });
  saveAll(arr);
  amountI.value=''; memoI.value='';
  selectedDate = date;
  renderCalendar(); renderList();
};

document.getElementById('export').onclick = ()=>{
  const blob = new Blob([JSON.stringify(load(), null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'fuel-ledger-export.json'; a.click();
  URL.revokeObjectURL(url);
};

// init
viewY = new Date().getFullYear();
viewM = new Date().getMonth();
renderCalendar();
renderList();
