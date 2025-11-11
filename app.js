// ====== storage helpers ======
const KEY = 'entries_v1'; // [{id,date,amount,cat,memo,ts}]
const load = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const saveAll = (a) => localStorage.setItem(KEY, JSON.stringify(a));

// ====== version ======
const VERSION = '2025.09.12-fuel-01';
(() => {
  const vEl = document.getElementById('ver');
  if (vEl) vEl.textContent = VERSION;
  console.log('Fuel Ledger VERSION', VERSION);
})();

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

// ---- OCR（Tesseract.js） ----
const receiptI = document.getElementById('receipt');
const ocrBtn = document.getElementById('ocr');
const ocrStatus = document.getElementById('ocrStatus');

if (ocrBtn) {
  ocrBtn.onclick = async () => {
    const file = receiptI && receiptI.files && receiptI.files[0];
    if (!file) return alert('レシート画像を選んでね');
    if (typeof Tesseract === 'undefined') return alert('OCRライブラリの読込に失敗しました。再読み込みしてね。');

    try {
      ocrBtn.disabled = true;
      ocrStatus.textContent = '前処理中...';

      // 画像縮小＆2値化
      const dataURL = await toPreprocessedDataURL(file, 1600, 165);

      // OCR
      ocrStatus.textContent = 'OCR実行中...';
      const { data } = await Tesseract.recognize(dataURL, 'jpn', {
        logger: m => {
          if (m.status && m.progress != null) {
            ocrStatus.textContent = `${m.status} ${(m.progress * 100 | 0)}%`;
          }
        }
      });

      const text = (data && data.text) ? data.text : '';
      const amount = pickAmount(text);

      if (amount) amountI.value = amount;
      ocrStatus.textContent = amount
        ? `OCR完了 ✅ 金額候補: ¥${amount}`
        : 'OCR完了 ✅（金額見つからず）';

      memoI.value = memoI.value ? (memoI.value + '\n' + text) : text;
    } catch (e) {
      console.error(e);
      if (ocrStatus) ocrStatus.textContent = 'OCR失敗 🥲';
      alert('OCRでエラー。明るい場所で正面から撮影すると精度が上がります。');
    } finally {
      ocrBtn.disabled = false;
    }
  };
}

// 画像前処理（縮小＋2値化）
async function toPreprocessedDataURL(file, maxW = 1600, thresh = 165) {
  const img = await fileToImage(file);
  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const a = id.data;
  for (let i = 0; i < a.length; i += 4) {
    const y = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const v = y > thresh ? 255 : 0;
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return cvs.toDataURL('image/png');
}
function fileToImage(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = r.result;
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// 全角→半角 + 数字直前の空白除去
function normalizeJP(s) {
  return (s || '')
    .normalize('NFKC')
    .replace(/[①-⑨]/g, ch => String(' 123456789'.indexOf(ch))) // ①〜⑨ → 1〜9
    .replace(/\s+(?=\d)/g, '');
}

// 金額抽出ロジック
function pickAmount(text) {
  const normText = normalizeJP(text);
  const lines = normText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const yenRegex = /([¥￥]?\s*\d[\d,]*)/g;
  const hotWords = /(合計|合計金額|お支払|お支払い|総計|現計|計)/;

  // 「合計」などの行を優先（3桁以上）
  for (const ln of lines) {
    if (hotWords.test(ln)) {
      const m = [...ln.matchAll(yenRegex)]
        .map(x => x[1])
        .map(s => Number(String(s).replace(/[^\d]/g, '')))
        .filter(n => isFinite(n) && n >= 100); // 3桁以上
      if (m.length) {
        return String(Math.max(...m)); // 最大値を採用
      }
    }
  }

  // 全体から最大値
  const all = [...normText.matchAll(yenRegex)]
    .map(x => x[1])
    .map(s => Number(String(s).replace(/[^\d]/g, '')))
    .filter(n => isFinite(n) && n >= 100);
  if (!all.length) return null;
  return String(Math.max(...all));
}

dateI.value = selectedDate;

// ====== utils ======
function toISO(d) {
  const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
function fmtJPY(n) { return Number(n).toLocaleString('ja-JP'); }

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
  for (const e of entries) {
    const m = map.get(e.date) || { sum: 0, cnt: 0 };
    m.sum += Number(e.amount) || 0;
    m.cnt += 1;
    map.set(e.date, m);
  }

  const cells = [];
  // 前月パディング
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevDays - i;
    const dt = toISO(new Date(viewY, viewM - 1, d));
    cells.push({ d, dt, off: true });
  }
  // 当月
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = toISO(new Date(viewY, viewM, d));
    cells.push({ d, dt, off: false });
  }
  // 次月パディング
  while (cells.length % 7) {
    const d = cells.length - (startDow + daysInMonth) + 1;
    const dt = toISO(new Date(viewY, viewM + 1, d));
    cells.push({ d, dt, off: true });
  }

  let monthTotal = 0;
  for (const cell of cells) {
    const div = document.createElement('div');
    div.className = 'day' + (cell.off ? ' off' : '');
    if (cell.dt === selectedDate) div.classList.add('selected');

    const m = map.get(cell.dt);
    const sum = m ? m.sum : 0;
    const cnt = m ? m.cnt : 0;
    if (!cell.off) monthTotal += sum;

    div.innerHTML = `
      <div class="d">${cell.d}</div>
      ${sum ? `<div class="sum">¥${fmtJPY(sum)}</div>` : ''}
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
  monthSum.textContent = `この月の合計: ¥${fmtJPY(monthTotal)}`;
}

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
        <div><span class="amt">¥${fmtJPY(it.amount)}</span> / ${it.cat}</div>
        <div class="muted">${new Date(it.ts).toLocaleTimeString()} - ${it.memo ? escapeHTML(it.memo) : ''}</div>
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
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

// ====== actions ======
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');

if (prevBtn) {
  prevBtn.onclick = () => {
    if (viewM === 0) { viewM = 11; viewY--; } else viewM--;
    renderCalendar();
    renderList(); // ← 追加
  };
}
if (nextBtn) {
  nextBtn.onclick = () => {
    if (viewM === 11) { viewM = 0; viewY++; } else viewM++;
    renderCalendar();
    renderList(); // ← 追加
  };
}

const saveBtn = document.getElementById('save');
if (saveBtn) {
  saveBtn.onclick = () => {
    const date = dateI.value || toISO(new Date());
    const amount = Number(amountI.value || 0);
    if (!amount) { alert('金額が空です'); return; }
    const cat = catI.value || 'その他';
    const memo = memoI.value || '';
    const arr = load();
    arr.push({
      id: Date.now() + '' + Math.random().toString(16).slice(2),
      date, amount, cat, memo, ts: Date.now()
    });
    saveAll(arr);
    amountI.value = ''; memoI.value = '';
    selectedDate = date;
    renderCalendar(); renderList();
  };
}

const exportBtn = document.getElementById('export');
if (exportBtn) {
  exportBtn.onclick = () => {
    const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'fuel-ledger-export.json'; a.click();
    URL.revokeObjectURL(url);
  };
}

// ====== PWA SW ======
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// init
viewY = new Date().getFullYear();
viewM = new Date().getMonth();
renderCalendar();
renderList();



