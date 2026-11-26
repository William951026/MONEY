import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDii5zEL4FkAm9bajcRpiuaEqYiCIHxwBg",
  authDomain: "money-yeh.firebaseapp.com",
  projectId: "money-yeh",
  storageBucket: "money-yeh.firebasestorage.app",
  messagingSenderId: "1029574818482",
  appId: "1:1029574818482:web:3746921871e987770fe7ab",
  measurementId: "G-T47EX72GJH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

let currentUser = null;
let isSyncingFromCloud = false;

const STORAGE_KEY = 'wellmoney-ledger-v1';
const META_KEY = `${STORAGE_KEY}-meta`;
const DEFAULTS = {
  daily: ['餐飲','交通','購物','居家','帳單','娛樂','醫療','其他支出','薪資','副業收入','其他收入'],
  claw: ['娃娃','零食','場租','其他成本','機台營收'],
  stock: ['股票買進','股票賣出','股利','其他投資'],
  travel: ['基金存入','基金提領']
};
const GROUP_NAMES = {
  daily:'日常開銷',
  claw:'娃娃機',
  stock:'股票投資',
  travel:'夢想旅遊基金'
};
const ICONS = {
  '餐飲':'☕','交通':'↗','購物':'✳','居家':'⌂','帳單':'▤','娛樂':'♡','醫療':'＋','其他支出':'◦','薪資':'↙','副業收入':'✦','其他收入':'✳',
  '娃娃':'♧','零食':'🍬','場租':'⌂','其他成本':'◦','機台營收':'♧',
  '股票買進':'↗','股票賣出':'↙','股利':'⌁','其他投資':'◦',
  '基金存入':'✈','基金提領':'↗'
};
const COLORS = ['#729a7b','#e7aa79','#95a9c3','#c5a4b2','#d3c184','#8eb8b0','#e18e79','#aaa3c4','#98b4d2','#d8a77d'];
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function todayISO(){
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function currentMonthISO(){
  return todayISO().slice(0, 7);
}

function migrateEntry(entry){
  if(!entry || typeof entry !== 'object') return null;
  if(entry.major) return entry;
  let major = entry.category?.includes('娃娃機') ? 'claw' : entry.type === 'investment' ? 'stock' : 'daily';
  let category = entry.category || '其他支出';
  if(major === 'claw') category = category.includes('進帳') ? '機台營收' : '其他成本';
  if(major === 'stock') category = ['股利','股票賣出','股票買入'].includes(category) ? category : '其他投資';
  return { ...entry, major, category, legacy: true };
}

function readEntries(){
  try{
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(migrateEntry).filter(Boolean) : [];
  }catch{
    return [];
  }
}

let entries = readEntries();

function normalizeMeta(raw = {}){
  const safeRaw = raw && typeof raw === 'object' ? raw : {};
  return {
    customClaw: Array.isArray(safeRaw.customClaw) ? safeRaw.customClaw : [],
    quotes: safeRaw.quotes && typeof safeRaw.quotes === 'object' ? safeRaw.quotes : {},
    trip: {
      name: safeRaw.trip?.name || '夢想旅遊基金',
      target: Number(safeRaw.trip?.target) || 0
    }
  };
}

function readMeta(){
  let oldFund = {};
  try{
    oldFund = JSON.parse(localStorage.getItem(`${STORAGE_KEY}-fund`) || '{}') || {};
  }catch{}
  if(Number(oldFund.balance) > 0 && !entries.some(e => e.major === 'travel')){
    entries.push({
      id: 'legacy-trip-fund',
      major: 'travel',
      category: '基金存入',
      amount: Number(oldFund.balance),
      type: 'income',
      date: todayISO(),
      title: '既有夢想基金餘額',
      createdAt: 0
    });
  }
  let saved = {};
  try{
    saved = JSON.parse(localStorage.getItem(META_KEY) || '{}') || {};
  }catch{}
  return normalizeMeta({
    ...saved,
    trip: {
      name: saved.trip?.name || '夢想旅遊基金',
      target: Number(saved.trip?.target) || Number(oldFund.target) || 0
    }
  });
}

let meta = readMeta();
let activeFilter = 'all';
let showAll = false;
let toastTimer = null;

function toast(message){
  let el = $('#toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:9999;background:#1f2937;color:#fff;padding:10px 14px;border-radius:10px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.25);transition:opacity .2s;';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.opacity = '1';
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 200);
  }, 2600);
}

function escapeHTML(value = ''){
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function money(amount){
  return 'NT$' + Math.round(Math.abs(Number(amount) || 0)).toLocaleString('zh-TW');
}

function unitMoney(amount){
  return 'NT$' + Math.abs(Number(amount) || 0).toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' / 股';
}

function signedMoney(amount){
  const n = Number(amount) || 0;
  return `${n >= 0 ? '+' : '-'}${money(n)}`;
}

function dateLabel(value){
  if(!value) return '';
  const d = new Date(`${value}T12:00:00`);
  if(Number.isNaN(d.getTime())) return String(value);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function incomeEntry(e){
  return e.major === 'claw' ? e.category === '機台營收'
    : e.major === 'daily' ? (['薪資','副業收入','其他收入'].includes(e.category) || e.type === 'income')
    : e.major === 'stock' ? ['股票賣出','股利'].includes(e.category)
    : false;
}

function ticketClass(e){
  return e.major === 'daily' ? (incomeEntry(e) ? 'income' : 'expense')
    : e.major === 'claw' ? 'claw'
    : e.major === 'stock' ? 'invest'
    : 'travel';
}

async function syncToCloud(uid){
  if(!uid || isSyncingFromCloud) return;
  try{
    await setDoc(doc(db, 'users', uid), {
      entries,
      meta,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }catch(err){
    console.error('雲端同步失敗：', err);
    toast('雲端同步失敗，已先存至本機');
  }
}

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  localStorage.setItem(META_KEY, JSON.stringify(meta));
  if(currentUser){
    syncToCloud(currentUser.uid);
  }
}

function refreshClawSelectOptions(){
  const clawSelect = $('#clawDetail');
  if(!clawSelect) return;
  const prev = clawSelect.value;
  const list = [...DEFAULTS.claw, ...meta.customClaw, '＋ 自訂細項'];
  clawSelect.innerHTML = list.map(c => `<option>${escapeHTML(c)}</option>`).join('');
  if(prev && list.includes(prev)) clawSelect.value = prev;
}

async function loadFromCloud(uid){
  isSyncingFromCloud = true;
  try{
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if(snap.exists()){
      const data = snap.data() || {};
      if(Array.isArray(data.entries)){
        entries = data.entries.map(migrateEntry).filter(Boolean);
      }
      meta = normalizeMeta(data.meta || {});
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      localStorage.setItem(META_KEY, JSON.stringify(meta));
      refreshClawSelectOptions();
      render();
      toast('已載入雲端資料 ☁');
    }else if(entries.length > 0 || meta.trip.target > 0 || meta.customClaw.length > 0){
      await setDoc(ref, {
        entries,
        meta,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      toast('已將本機資料同步至雲端 ☁');
    }
  }catch(err){
    console.error('讀取雲端資料失敗：', err);
    toast('讀取雲端資料失敗，目前顯示本機資料');
  }finally{
    isSyncingFromCloud = false;
  }
}

function updateAuthUI(){
  const statusEl = $('#authStatus') || $('#userStatus');
  const loginBtn = $('#googleLoginBtn') || $('#loginBtn');
  const logoutBtn = $('#logoutBtn');
  if(currentUser){
    if(statusEl) statusEl.textContent = `已登入：${currentUser.displayName || currentUser.email || 'Google 使用者'}`;
    if(loginBtn) loginBtn.style.display = 'none';
    if(logoutBtn) logoutBtn.style.display = '';
  }else{
    if(statusEl) statusEl.textContent = '尚未登入（本機模式）';
    if(loginBtn) loginBtn.style.display = '';
    if(logoutBtn) logoutBtn.style.display = 'none';
  }
}

async function handleGoogleLogin(){
  try{
    await signInWithPopup(auth, googleProvider);
  }catch(err){
    console.error('Google 登入失敗：', err);
    toast(`登入失敗：${err?.code || '請稍後再試'}`);
  }
}

async function handleLogout(){
  try{
    await signOut(auth);
    toast('已登出');
  }catch(err){
    console.error('登出失敗：', err);
    toast('登出失敗');
  }
}

function monthEntries(){
  const picker = $('#monthPicker');
  const month = picker?.value || currentMonthISO();
  return entries.filter(e => e.date?.startsWith(month));
}

function portfolio(){
  const map = {};
  entries
    .filter(e => e.major === 'stock' && e.symbol && ['股票買進','股票賣出','股利'].includes(e.category))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || ((a.createdAt || 0) - (b.createdAt || 0)))
    .forEach(e => {
      const symbol = String(e.symbol).toUpperCase().replace(/\.(TW|TWO)$/, '');
      const g = map[symbol] || { symbol, qty: 0, cost: 0, realized: 0, currency: 'TWD', transactions: 0 };
      g.transactions++;
      const qty = Number(e.quantity) || 0;
      const price = Number(e.price) || 0;
      const fees = (Number(e.commission) || 0) + (Number(e.tax) || 0);
      if(e.category === '股票買進'){
        g.qty += qty;
        g.cost += qty * price + fees;
      }else if(e.category === '股票賣出' && g.qty > 0){
        const sold = Math.min(qty, g.qty);
        const avg = g.cost / g.qty;
        g.cost -= avg * sold;
        g.qty -= sold;
        g.realized += (price * sold - fees) - avg * sold;
      }else if(e.category === '股利'){
        g.realized += (Number(e.amount) || 0) - fees;
      }
      map[symbol] = g;
    });

  return Object.values(map).map(g => {
    const quote = meta.quotes[g.symbol];
    const last = entries.filter(e => String(e.symbol || '').toUpperCase().replace(/\.(TW|TWO)$/, '') === g.symbol).at(-1);
    g.price = Number(quote?.price) || Number(last?.manualPrice) || 0;
    g.updatedAt = quote?.updatedAt || last?.quoteUpdatedAt || null;
    g.value = g.qty * g.price;
    g.displayCost = Math.round(g.cost);
    g.displayValue = Math.round(g.value);
    g.displayPnl = g.displayValue - g.displayCost;
    g.displayRealized = Math.round(g.realized);
    g.pct = g.displayCost ? (100 * g.displayPnl) / g.displayCost : 0;
    return g;
  }).filter(g => g.qty > 0 || g.realized !== 0 || g.transactions > 0);
}

function statFor(items, major){
  const selected = items.filter(e => e.major === major);
  if(major === 'daily'){
    const es = selected.filter(e => !incomeEntry(e));
    return { value: es.reduce((s, e) => s + Number(e.amount || 0), 0), count: es.length };
  }
  if(major === 'claw'){
    const inc = selected.filter(incomeEntry).reduce((s, e) => s + Number(e.amount || 0), 0);
    const cost = selected.filter(e => !incomeEntry(e)).reduce((s, e) => s + Number(e.amount || 0), 0);
    return { value: inc - cost, count: selected.length };
  }
  if(major === 'stock'){
    const hs = portfolio();
    return { value: hs.reduce((s, h) => s + h.value, 0), count: hs.filter(h => h.qty > 0).length };
  }
  const value = entries.filter(e => e.major === 'travel').reduce((s, e) => s + (e.category === '基金存入' ? Number(e.amount || 0) : -Number(e.amount || 0)), 0);
  return { value, count: selected.length };
}

function stockDetailRows(symbol){
  const rows = entries
    .filter(e => e.major === 'stock' && e.symbol && String(e.symbol).toUpperCase().replace(/\.(TW|TWO)$/, '') === symbol && ['股票買進','股票賣出','股利'].includes(e.category))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || ((a.createdAt || 0) - (b.createdAt || 0)));

  return rows.map(e => {
    const fee = (Number(e.commission) || 0) + (Number(e.tax) || 0);
    const trade = ['股票買進','股票賣出'].includes(e.category);
    const qty = Number(e.quantity) || 0;
    const price = Number(e.price) || 0;
    const subtotal = e.category === '股票買進' ? -(Number(e.amount) || qty * price) - fee
      : e.category === '股票賣出' ? (Number(e.amount) || qty * price) - fee
      : (Number(e.amount) || 0) - fee;
    return `<tr><td>${escapeHTML(e.date || '')}</td><td>${escapeHTML(e.category)}</td><td>${trade ? qty.toLocaleString('zh-TW') + ' 股' : '—'}</td><td>${trade ? unitMoney(price) : '—'}</td><td>${money(e.commission)} / ${money(e.tax)}</td><td class="${subtotal >= 0 ? 'pnl-positive' : 'pnl-negative'}">${signedMoney(subtotal)}</td><td><button class="delete-entry detail-delete" data-delete="${escapeHTML(e.id)}" aria-label="刪除這筆${escapeHTML(e.category)}紀錄">刪除</button></td></tr>`;
  }).join('');
}

function renderHoldings(holdings){
  const listEl = $('#holdingsList');
  if(!listEl) return;
  listEl.innerHTML = holdings.length ? holdings.map(h => {
    const details = stockDetailRows(h.symbol);
    const avg = h.qty ? h.cost / h.qty : 0;
    return `<div class="holding-card"><div class="holding-row"><div class="holding-ticker"><strong>${escapeHTML(h.symbol)}</strong><small>台幣 · ${h.qty.toLocaleString('zh-TW')} 股</small></div><div><span>平均成本</span><strong>${h.qty ? unitMoney(avg) : '—'}</strong></div><div><span>持倉成本</span><strong>${money(h.displayCost)}</strong></div><div><span>現價</span><strong>${h.price ? unitMoney(h.price) : '—'}</strong><small>${h.updatedAt ? '更新 ' + new Date(h.updatedAt).toLocaleString('zh-TW') : ''}</small></div><div><span>未實現損益</span><strong class="${h.displayPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${signedMoney(h.displayPnl)}</strong><small>${h.pct ? h.pct.toFixed(1) + '%' : ''}</small></div></div>${details ? `<table class="detail-table"><thead><tr><th>日期</th><th>類別</th><th>數量</th><th>單價</th><th>手續費/證交稅</th><th>小計</th><th>操作</th></tr></thead><tbody>${details}</tbody></table>` : ''}</div>`;
  }).join('') : '<p class="empty-hint">目前尚無股票持倉或交易紀錄。</p>';
}

function renderEntriesList(mItems){
  const listEl = $('#entriesList');
  if(!listEl) return;
  const filtered = activeFilter === 'all' ? mItems : mItems.filter(e => e.major === activeFilter);
  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || '') || ((b.createdAt || 0) - (a.createdAt || 0)));
  const visible = showAll ? sorted : sorted.slice(0, 15);
  listEl.innerHTML = visible.length ? visible.map(e => {
    const icon = ICONS[e.category] || '◦';
    const isInc = incomeEntry(e);
    return `<div class="entry-item ${ticketClass(e)}"><div class="entry-icon">${escapeHTML(icon)}</div><div class="entry-main"><strong>${escapeHTML(e.title || e.category || '未命名紀錄')}</strong><small>${escapeHTML(dateLabel(e.date))} · ${escapeHTML(GROUP_NAMES[e.major] || e.major)} · ${escapeHTML(e.category || '')}</small></div><div class="entry-amount ${isInc ? 'positive' : ''}">${isInc ? '+' : '-'}${money(e.amount)}</div><button class="delete-entry" data-delete="${escapeHTML(e.id)}" aria-label="刪除紀錄">刪除</button></div>`;
  }).join('') : '<p class="empty-hint">這個月份還沒有收支紀錄。</p>';
}

function render(){
  const mItems = monthEntries();
  const dailyIncome = mItems.filter(e => e.major === 'daily' && incomeEntry(e)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const dailyExpense = statFor(mItems, 'daily').value;
  const dailyBalance = dailyIncome - dailyExpense;
  const clawStat = statFor(mItems, 'claw');
  const stockStat = statFor(mItems, 'stock');
  const travelStat = statFor(mItems, 'travel');

  if($('#monthIncome')) $('#monthIncome').textContent = money(dailyIncome);
  if($('#monthExpense')) $('#monthExpense').textContent = money(dailyExpense);
  if($('#monthBalance')) $('#monthBalance').textContent = signedMoney(dailyBalance);
  if($('#clawNet')) $('#clawNet').textContent = signedMoney(clawStat.value);
  if($('#stockTotal')) $('#stockTotal').textContent = money(stockStat.value);
  if($('#travelTotal')) $('#travelTotal').textContent = money(travelStat.value);

  renderHoldings(portfolio());
  renderEntriesList(mItems);
  updateAuthUI();
}

function openModal(major = 'daily'){
  const modal = $('#entryModal');
  if(!modal) return;
  modal.classList.add('open');
  modal.style.display = 'flex';
  const dateInput = $('#entryDate');
  if(dateInput && !dateInput.value) dateInput.value = todayISO();
  const majorSelect = $('#entryMajor');
  if(majorSelect && major) majorSelect.value = major;
}

function closeModal(){
  const modal = $('#entryModal');
  if(!modal) return;
  modal.classList.remove('open');
  modal.style.display = 'none';
}

function bindEvents(){
  const monthPicker = $('#monthPicker');
  if(monthPicker){
    if(!monthPicker.value) monthPicker.value = currentMonthISO();
    monthPicker.addEventListener('change', render);
  }

  const loginBtn = $('#googleLoginBtn') || $('#loginBtn');
  if(loginBtn) loginBtn.addEventListener('click', handleGoogleLogin);

  const logoutBtn = $('#logoutBtn');
  if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  $$('[data-open-modal], #addEntryBtn, .open-entry-btn').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.openModal || 'daily'));
  });

  $$('[data-close-modal], #closeModalBtn, .modal-close').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  const entryForm = $('#entryForm');
  if(entryForm){
    entryForm.addEventListener('submit', e => {
      e.preventDefault();
      const major = $('#entryMajor')?.value || 'daily';
      const category = $('#entryCategory')?.value || $('#clawDetail')?.value || '其他支出';
      const title = ($('#entryTitle')?.value || '').trim();
      const amount = Number($('#entryAmount')?.value || 0);
      const date = $('#entryDate')?.value || todayISO();
      const type = $('#entryType')?.value || 'expense';
      if(!amount || amount <= 0){
        toast('請輸入大於 0 的金額');
        return;
      }
      entries.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        major,
        category,
        title: title || category,
        amount,
        type,
        date,
        createdAt: Date.now()
      });
      save();
      render();
      entryForm.reset();
      if($('#entryDate')) $('#entryDate').value = todayISO();
      closeModal();
      toast('已新增紀錄');
    });
  }

  document.addEventListener('click', e => {
    const delBtn = e.target.closest('[data-delete]');
    if(delBtn){
      const id = delBtn.dataset.delete;
      entries = entries.filter(item => item.id !== id);
      save();
      render();
      toast('已刪除紀錄');
      return;
    }
    const filterBtn = e.target.closest('[data-filter]');
    if(filterBtn){
      activeFilter = filterBtn.dataset.filter || 'all';
      renderEntriesList(monthEntries());
    }
  });
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  updateAuthUI();
  if(user){
    await loadFromCloud(user.uid);
  }else{
    entries = readEntries();
    meta = readMeta();
    refreshClawSelectOptions();
    render();
  }
});

refreshClawSelectOptions();
bindEvents();
render();