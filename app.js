// ====== storage helpers ======
const KEY = 'entries_v1';
const load = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const saveAll = (a) => localStorage.setItem(KEY, JSON.stringify(a));

// ====== version ======
const VERSION = '2025.09.12-ocr-improved-01';
console.log('APP VERSION', VERSION);
window.addEventListener('DOMContentLoaded', () => {
  const v = document.getElementById('ver');
  if (v) v.textContent = VERSION;
});

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
// あるかもしれない拡張フィールド（無ければundefinedでOK）
const litersI = document.getElementById('liters');
const unitI   = document.getElementById('unit');

// ---- OCR（Tesseract.js） ----
const receiptI = document.getElementById('receipt');
const ocrBtn = document.getElementById('ocr');
const ocrStatus = document.getElementById('ocrStatus');

ocrBtn.onclick = async () => {
  const file = receiptI.files && receiptI.files[0];
  if (!file) return alert('レシート画像を選んでね');
  if (typeof Tesseract === 'undefined') return alert('OCRライブラリの読込に失敗しました。再読み込みしてね。');

  try {
    ocrBtn.disabled = true;
    ocrStatus.textContent = '前処理中...';

    // 画像読込→前処理（解像度UP + 大津の二値化）
    const img = await fileToImage(file);
    const preCanvas = preprocessImage(img); // Canvas

    // OCR（日本語+辞書OFF）
    ocrStatus.textContent = 'OCR実行中...';
    const { data } = await Tesseract.recognize(preCanvas, 'jpn', {
      tessedit_pageseg_mode: 3,
      load_system_dawg: 0,
      load_freq_dawg: 0,
      logger: m => {
        if (m.status && m.progress != null) {
          ocrStatus.textContent = `${m.status} ${(m.progress*100|0)}%`;
        }
      }
    });

    const raw = data.text || '';
    // 抽出（合計/税/L/@/日付）
    const ext = smartExtract(raw);

    // 金額
    if (ext.total) amountI.value = ext.total;
    // 日付（あればセット）
    if (ext.date && dateI) dateI.value = ext.date.replaceAll('/','-');
    // L と 単価
    if (litersI && ext.liters != null) litersI.value = ext.liters;
    if (unitI   && ext.unit   != null) unitI.value   = ext.unit;

    // メモに全文追記
    memoI.value = memoI.value ? (memoI.value + '\n' + raw) : raw;

    // ステータス表示
    const bits = [];
    if (ext.total) bits.push(`金額 ¥${fmtJPY(ext.total)}`);
    if (ext.tax!=null) bits.push(`税 ¥${fmtJPY(ext.tax)}`);
    if (ext.liters!=null) bits.push(`${ext.liters}L`);
    if (ext.unit!=null) bits.push(`@${ext.unit}円/L`);
    if (ext.date) bits.push(ext.date);
    const amtEl = amountI;
    const litEl = litersI;
    const uniEl = unitI;
    
    const amt = Number(amtEl?.value || 0);
    const lit = Number(litEl?.value || 0);
    const uni = Number(uniEl?.value || 0);
    
    if (!amt && lit && uni) amtEl.value = String(Math.round(lit * uni));
    if (!uni && amt && lit) uniEl.value = String(+(amt / lit).toFixed(1));
    if (!lit && amt && uni) litEl.value = String(+(amt / uni).toFixed(2));

    ocrStatus.textContent = `OCR完了 ✅ ${bits.join(' / ') || '（候補なし）'}`;
  } catch (e) {
    console.error(e);
    ocrStatus.textContent = 'OCR失敗 🥲';
    alert('OCRでエラー。明るい場所で、正面から大きめに撮ると精度が上がります。');
  } finally {
    ocrBtn.disabled = false;
  }
};

// ====== 画像入出力・前処理 ======
function fileToImage(file){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=r.result; };
    r.onerror = rej; r.readAsDataURL(file);
  });
}

// 解像度UP + グレースケール + 大津の二値化
function preprocessImage(img){
  const maxTarget = 1500; // 最大辺1500pxまで拡大
  const maxDim = Math.max(img.width, img.height);
  const scale = maxDim < maxTarget ? (maxTarget / maxDim) : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let a = imageData.data;

  // グレースケール + ヒストグラム
  const hist = new Uint32Array(256);
  for (let i=0;i<a.length;i+=4){
    const y = Math.round(0.299*a[i] + 0.587*a[i+1] + 0.114*a[i+2]);
    hist[y]++; a[i]=a[i+1]=a[i+2]=y;
  }
  // 大津のしきい値
  const total = canvas.width*canvas.height;
  let sum1 = 0; for(let t=0;t<256;t++) sum1 += t*hist[t];
  let sumB=0,wB=0,maxVar=0,th=128;
  for(let t=0;t<256;t++){
    wB += hist[t]; if(wB===0) continue;
    const wF = total - wB; if(wF===0) break;
    sumB += t*hist[t];
    const mB = sumB / wB;
    const mF = (sum1 - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if(between>maxVar){ maxVar=between; th=t; }
  }
  // 二値化
  for (let i=0;i<a.length;i+=4){
    const bin = a[i] >= th ? 255 : 0;
    a[i]=a[i+1]=a[i+2]=bin;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ====== 正規化・抽出群 ======
// 全角→半角 + 数字前空白除去 + 丸数字①〜⑨→1〜9
function normalizeJP(s){
  return (s||'')
    .normalize('NFKC')
    .replace(/\s+(?=\d)/g,'')
    .replace(/[①②③④⑤⑥⑦⑧⑨]/g, m => '①②③④⑤⑥⑦⑧⑨'.indexOf(m)+1 );
}

// 金額候補（総額/税/L/@/日付）を賢く抽出
function smartExtract(text){
  const s = normalizeJP(text).replace(/￥/g,'¥');
  const lines = s.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);

  // 1) 金額候補収集
  const yenAfter = /([¥￥]?\s*\d[\d\s,．｡・･'’`´\-]*\d)\s*円/gi;
  const numAny   = /[¥￥]?\s*\d[\d\s,．｡・･'’`´\-]*\d/gi;
  const toInt = v => Number(String(v).replace(/[^\d]/g,''));
  const inRange = n => n>=100 && n<=100000;

  const amounts = []; // {val,line,isYen,isTotalHint,isTaxHint}
  for(const ln of lines){
    const isTotalHint = /(合計|合計金額|総計|お支払|お支払い|現計|ご請求|TOTAL)/i.test(ln);
    const isTaxHint   = /(税|消費|税込|内)/.test(ln);
    // 円つき
    for(const m of ln.matchAll(yenAfter)){
      const v = toInt(m[1]); if(inRange(v)) amounts.push({val:v,line:ln,isYen:true,isTotalHint,isTaxHint});
    }
    // 円なし（保険）
    for(const m of ln.matchAll(numAny)){
      const v = toInt(m[0]); if(inRange(v)) amounts.push({val:v,line:ln,isYen:false,isTotalHint,isTaxHint});
    }
  }

  // 2) L / 単価@ / 日付
  const toNum = v => Number(String(v).replace(/[^0-9.]/g,''));
  let liters = null;
  let unit = null;
  let date = pickDateFrom(s);

  // L: 33.96L / 33.96 ℓ / 給油量: 33.96L
  const lMatch = s.match(/(?:給油量[:：]?\s*)?(\d{1,3}(?:\.\d{1,2})?)\s*(?:L|ℓ|l)\b/i);
  if (lMatch) liters = toNum(lMatch[1]);

  // @単価: @163.0 / 単価 163.0 / 163.0円/L
  const uMatch = s.match(/[@＠]\s*(\d{2,4}(?:\.\d{1,2})?)\b|\b単価\s*[:：]?\s*(\d{2,4}(?:\.\d{1,2})?)\b|\b(\d{2,4}(?:\.\d{1,2})?)\s*円\s*\/?\s*(?:L|ℓ|l)\b/i);
  if (uMatch) unit = toNum(uMatch[1]||uMatch[2]||uMatch[3]);

  // 3) 総額決定：合計系ヒント最大 → 税×11ペア → 円つき最大 → 全体最大
  const excludeWords = /(税|内|消費|税込|小計|TEL|伝No|承認|番号)/;
  const totalHinted = amounts
    .filter(a => a.isTotalHint && !excludeWords.test(a.line))
    .sort((a,b)=>b.val-a.val);
  if (totalHinted.length) return { total: totalHinted[0].val, tax: Math.round(totalHinted[0].val/11), liters, unit, date };

  const taxes = amounts.filter(a => a.isTaxHint).map(a=>a.val);
  let best=null, bestErr=1e9;
  for(const t of taxes){
    for(const a of amounts){
      if (a.val<=t) continue;
      const expect = t*11;
      const err = Math.abs(a.val - expect);
      const rel = err/expect;
      if ((err<=30 || rel<=0.02) && err<bestErr){ best=a; bestErr=err; }
    }
  }
  if (best) return { total: best.val, tax: Math.round(best.val/11), liters, unit, date };

  const yenOnly = amounts.filter(a=>a.isYen && !excludeWords.test(a.line)).sort((a,b)=>b.val-a.val);
  if (yenOnly.length) return { total: yenOnly[0].val, tax: Math.round(yenOnly[0].val/11), liters, unit, date };

  const all = amounts.filter(a=>!excludeWords.test(a.line)).sort((a,b)=>b.val-a.val);
  if (all.length) return { total: all[0].val, tax: Math.round(all[0].val/11), liters, unit, date };

  return { total:null, tax:null, liters, unit, date };
}

// 日付抽出（YYYY/MM/DD or YY/MM/DD も許容）
function pickDateFrom(text){
  const t = text; // 既にnormalizeJP後
  const p1 = /(\d{4})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})日?/;
  const p2 = /(\d{2})[\/\-\.年](\d{1,2})[\/\-\.月](\d{1,2})日?/;
  let m = t.match(p1) || t.match(p2);
  if (!m) return null;
  let yy = m[1], mo = m[2], dd = m[3];
  if (yy.length===2) yy = '20'+yy;
  if (mo.length===1) mo = '0'+mo;
  if (dd.length===1) dd = '0'+dd;
  return `${yy}/${mo}/${dd}`;
}

// ====== PWA SW ======
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'NEW_SW_ACTIVATED') {
      const el = document.getElementById('ocrStatus');
      if (el) el.textContent = `新バージョン準備OK → 画面を再読み込みで適用（${e.data.version}）`;
    }
  });
}
const frBtn = document.getElementById('forceReload');
if (frBtn) frBtn.onclick = async () => {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } finally {
    location.reload();
  }
};

// ====== utils ======
function toISO(d){
  const y=d.getFullYear(), m=d.getMonth()+1, dd=d.getDate();
  return `${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
}
function fmtJPY(n){ return Number(n).toLocaleString('ja-JP'); }

// ====== calendar render ======
function renderCalendar() {
  ym.textContent = `${viewY}年 ${viewM + 1}月`;
  grid.innerHTML = '';

  const first = new Date(viewY, viewM, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const prevDays = new Date(viewY, viewM, 0).getDate();

  const entries = load();
  const map = new Map(); // dateStr -> {sum, cnt}
  const entries = load();
  const map = new Map(); // dateStr -> {sum, cnt, lit}
  for (const e of entries) {
    const m = map.get(e.date) || { sum:0, cnt:0, lit:0 };
    m.sum += Number(e.amount)||0;
    m.cnt += 1;
    m.lit += Number(e.liters)||0;   // ★ 追加
    map.set(e.date, m);
  }


  const cells = [];
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevDays - i;
    const dt = toISO(new Date(viewY, viewM - 1, d));
    cells.push({ d, dt, off: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = toISO(new Date(viewY, viewM, d));
    cells.push({ d, dt, off: false });
  }
  while (cells.length % 7) {
    const d = cells.length - (startDow + daysInMonth) + 1;
    const dt = toISO(new Date(viewY, viewM + 1, d));
    cells.push({ d, dt, off: true });
  }

  let monthTotal = 0;
  let monthLit = 0;
  
  for (const cell of cells) {
    const div = document.createElement('div');
    div.className = 'day' + (cell.off ? ' off' : '');
    if (cell.dt === selectedDate) div.classList.add('selected');
  
    const m = map.get(cell.dt);
    const sum = m ? m.sum : 0;
    const cnt = m ? m.cnt : 0;
    const lit = m ? m.lit : 0;
    if (!cell.off) {
      monthTotal += sum;
      monthLit += lit;
    }
  
    const avgUnit = (lit > 0) ? Math.round(sum / lit) : null;
  
    div.innerHTML = `
      <div class="d">${cell.d}</div>
      ${sum ? `<div class="sum">¥${fmtJPY(sum)}</div>` : ''}
      ${lit ? `<div class="cnt">${lit.toFixed(1)}L${avgUnit ? ` @${avgUnit}円/L` : ''}</div>` : ''}
      ${cnt ? `<div class="cnt">${cnt}件</div>` : ''}
    `;
    div.onclick = () => {
      selectedDate = cell.dt;
      dateI.value = selectedDate;
      renderCalendar();
      renderList();
    };
    grid.appendChild(div);
  }
  
  monthSum.textContent =
    `この月の合計: ¥${fmtJPY(monthTotal)}` +
    (monthLit ? `（${monthLit.toFixed(1)}L @${Math.round(monthTotal/Math.max(monthLit,1))}円/L）` : '');


// ====== list render ======
function renderList() {
  const items = load().filter(e => e.date === selectedDate).sort((a, b) => b.ts - a.ts);
  selTitle.textContent = `${selectedDate} の記録（${items.length}件）`;
  listEl.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
  <div class="left">
    <div>
      <span class="amt">¥${fmtJPY(it.amount)}</span> / ${it.cat}
      ${ (it.liters ? ` ・ ${(+it.liters).toFixed(2)}L` : '') }
      ${ (it.unit   ? ` ・ @${(+it.unit).toFixed(1)}円/L` : '') }
    </div>
    <div class="muted">
      ${new Date(it.ts).toLocaleTimeString()} - ${it.memo ? escapeHTML(it.memo) : ''}
    </div>
  </div>
  <div class="right">
    <button data-id="${it.id}" class="del">削除</button>
  </div>`;

    listEl.appendChild(row);
  }
  listEl.querySelectorAll('.del').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const arr = load().filter(x => String(x.id) !== String(id));
      saveAll(arr);
      renderCalendar(); renderList();
    };
  });
}
function escapeHTML(s) { return s.replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

// ====== actions ======
document.getElementById('prev').onclick = () => { if (viewM === 0) { viewM = 11; viewY--; } else viewM--; renderCalendar(); };
document.getElementById('next').onclick = () => { if (viewM === 11) { viewM = 0; viewY++; } else viewM++; renderCalendar(); };

document.getElementById('save').onclick = () => {
  const date   = dateI.value || toISO(new Date());
  const amount = Number(amountI.value || 0);
  if (!amount) { alert('金額が空です'); return; }

  const cat    = catI.value || 'その他';
  const memo   = memoI.value || '';

  // ★ 追加: L と 単価（数値にしておく）
  const liters = litersI ? Number(litersI.value || 0) : 0;
  const unit   = unitI   ? Number(unitI.value   || 0) : 0;

  const arr = load();
  arr.push({
    id: Date.now() + '' + Math.random().toString(16).slice(2),
    date, amount, cat, memo,
    liters,         // ★追加
    unit,           // ★追加
    ts: Date.now()
  });
  saveAll(arr);

  amountI.value = '';
  if (litersI) litersI.value = '';
  if (unitI)   unitI.value   = '';
  memoI.value  = '';

  selectedDate = date;
  renderCalendar();
  renderList();
};

document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
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







