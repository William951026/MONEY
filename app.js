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
  daily: '日常開銷',
  claw: '娃娃機',
  stock: '股票投資',
  travel: '夢想旅遊基金'
};
const ICONS = {
  '餐飲':'☕','交通':'↗','購物':'✳','居家':'⌂','帳單':'▤','娛樂':'♡','醫療':'＋','其他支出':'◦','薪資':'↙','副業收入':'✦','其他收入':'✳',
  '娃娃':'♧','零食':'🍬','場租':'⌂','其他成本':'◦','機台營收':'♧',
  '股票買進':'↗','股票賣出':'↙','股利':'⌁','其他投資':'◦',
  '基金存入':'✈','基金提領':'↗'
};
const COLORS = ['#729a7b','#e7aa79','#95a9c3','#c5a4b2','#d3c184','#8eb8b0','#e18e79','#aaa3c4','#98b4d2','#d8a77d'];

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

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

function normalizeMeta(raw = {}){
  const safe = raw && typeof raw === 'object' ? raw : {};
  return {
    customClaw: Array.isArray(safe.customClaw) ? safe.customClaw : [],
    quotes: safe.quotes && typeof safe.quotes === 'object' ? safe.quotes : {},
    trip: {
      name: safe.trip?.name || '夢想旅遊基金',
      target: Number(safe.trip?.target) || 0
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

let entries = readEntries();
let meta = readMeta();
let activeFilter = 'all';
let showAll = false;
let toastTimer = null;

function toast(msg){
  const el = $('#toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function escapeHTML(v = ''){
  return String(v).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function money(n){
  return 'NT$' + Math.round(Math.abs(Number(n) || 0)).toLocaleString('zh-TW');
}

function unitMoney(n){
  return 'NT$' + Math.abs(Number(n) || 0).toLocaleString('zh-TW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' / 股';
}

function signedMoney(n){
  const val = Number(n) || 0;
  return `${val >= 0 ? '+' : '-'}${money(val)}`;
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
      refreshCategoryOptions();
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
  const statusEl = $('#authStatus');
  const loginBtn = $('#googleLoginBtn');
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

function refreshCategoryOptions(){
  const major = $('#majorCategory')?.value || 'daily';
  const catSel = $('#category');
  const clawSel = $('#clawDetail');

  if(clawSel){
    const prev = clawSel.value;
    const clawList = [...DEFAULTS.claw, ...meta.customClaw, '＋ 自訂細項'];
    clawSel.innerHTML = clawList.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    if(prev && clawList.includes(prev)) clawSel.value = prev;
  }

  if(catSel){
    const list = major === 'claw'
      ? [...DEFAULTS.claw, ...meta.customClaw, '＋ 自訂細項']
      : (DEFAULTS[major] || DEFAULTS.daily);
    catSel.innerHTML = list.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  }

  toggleFormFields();
}

function toggleFormFields(){
  const major = $('#majorCategory')?.value || 'daily';
  const isFund = major === 'travel';
  const isStock = major === 'stock';
  const isClaw = major === 'claw';
  const catVal = isClaw ? ($('#clawDetail')?.value || $('#category')?.value) : $('#category')?.value;
  const isCustom = catVal === '＋ 自訂細項';

  $('#normalFields')?.classList.toggle('hidden', isFund);
  $('#fundFields')?.classList.toggle('hidden', !isFund);

  $('#categoryField')?.classList.toggle('hidden', isClaw);
  $('#clawDetailField')?.classList.toggle('hidden', !isClaw);
  $('#customCategoryField')?.classList.toggle('hidden', !isCustom);

  $('#quantityField')?.classList.toggle('hidden', !isStock);
  $('#priceField')?.classList.toggle('hidden', !isStock);
  $('#symbolField')?.classList.toggle('hidden', !isStock);
  $('#manualPriceField')?.classList.toggle('hidden', !isStock);
}

function openModal(presetMajor = 'daily'){
  const modal = $('#modal');
  if(!modal) return;
  const major = presetMajor === 'fund' ? 'travel' : presetMajor;
  if($('#majorCategory')) $('#majorCategory').value = major;
  refreshCategoryOptions();

  if(!$('#date')?.value && $('#date')) $('#date').value = todayISO();
  if(!$('#fundDate')?.value && $('#fundDate')) $('#fundDate').value = todayISO();

  const titles = {
    daily: ['新增一筆日常紀錄', '選擇日常收支細項並填入金額。'],
    claw: ['新增一筆娃娃機紀錄', '記錄機台營收、補貨成本或場租。'],
    stock: ['新增一筆股票紀錄', '記錄股票買進、賣出或股利。'],
    travel: ['旅遊基金存入／提領', '為你的夢想旅遊基金增加或提領金額。']
  };
  const [t, desc] = titles[major] || ['新增一筆紀錄', '選擇主分類並填入紀錄內容。'];
  if($('#modalTitle')) $('#modalTitle').textContent = t;
  const descEl = modal.querySelector('.modal-description');
  if(descEl) descEl.textContent = desc;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    if(major === 'travel') $('#fundAmountInput')?.focus();
    else $('#amount')?.focus();
  }, 50);
}

function closeModal(){
  const modal = $('#modal');
  if(!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function monthEntries(){
  const m = $('#monthPicker')?.value || currentMonthISO();
  return entries.filter(e => e.date?.startsWith(m));
}

function portfolio(){
  const map = {};
  entries
    .filter(e => e.major === 'stock' && e.symbol && ['股票買進','股票賣出','股利'].includes(e.category))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || ((a.createdAt || 0) - (b.createdAt || 0)))
    .forEach(e => {
      const symbol = String(e.symbol).toUpperCase().replace(/\.(TW|TWO)$/, '');
      const g = map[symbol] || { symbol, qty: 0, cost: 0, realized: 0, transactions: 0 };
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

function renderBreakdown(mItems){
  const monthLabel = $('#monthPicker')?.value || currentMonthISO();
  if($('#expenseMonthTag')) $('#expenseMonthTag').textContent = monthLabel;

  const expItems = mItems.filter(e => (e.major === 'daily' && !incomeEntry(e)) || (e.major === 'claw' && !incomeEntry(e)));
  const totalExp = expItems.reduce((s, e) => s + Number(e.amount || 0), 0);
  if($('#donutTotal')) $('#donutTotal').textContent = money(totalExp);

  const byCat = {};
  expItems.forEach(e => {
    const k = e.category || '其他支出';
    byCat[k] = (byCat[k] || 0) + Number(e.amount || 0);
  });
  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const donut = $('#donut');
  if(donut){
    if(!totalExp || !sorted.length){
      donut.style.background = 'conic-gradient(#e6e4dc 0deg 360deg)';
    }else{
      let deg = 0;
      const segs = sorted.map(([, val], idx) => {
        const start = deg;
        deg += (val / totalExp) * 360;
        const color = COLORS[idx % COLORS.length];
        return `${color} ${start.toFixed(1)}deg ${deg.toFixed(1)}deg`;
      });
      donut.style.background = `conic-gradient(${segs.join(', ')})`;
    }
  }

  const listEl = $('#categoryList');
  if(listEl){
    listEl.innerHTML = sorted.length ? sorted.slice(0, 6).map(([cat, val], idx) => {
      const pct = totalExp ? Math.round((val / totalExp) * 100) : 0;
      const color = COLORS[idx % COLORS.length];
      return `<div class="category-row"><span class="cat-swatch" style="background:${color}"></span><span class="cat-name">${escapeHTML(cat)}</span><span class="cat-pct">${pct}%</span><strong>${money(val)}</strong></div>`;
    }).join('') : '<p class="empty-hint">本月尚無支出明細。</p>';
  }
}

function renderClawBreakdown(mItems){
  const el = $('#clawBreakdown');
  if(!el) return;
  const clawItems = mItems.filter(e => e.major === 'claw');
  const map = {};
  clawItems.forEach(e => {
    const k = e.category || '其他成本';
    const sign = incomeEntry(e) ? 1 : -1;
    map[k] = (map[k] || 0) + sign * Number(e.amount || 0);
  });
  const rows = Object.entries(map);
  el.innerHTML = rows.length ? rows.map(([cat, val]) => `<div class="claw-item"><span>${escapeHTML(cat)}</span><strong class="${val >= 0 ? 'pnl-positive' : 'pnl-negative'}">${signedMoney(val)}</strong></div>`).join('') : '<p class="empty-hint">本月尚無娃娃機紀錄。</p>';
}

function renderStocks(holdings){
  const totalCost = holdings.reduce((s, h) => s + h.displayCost, 0);
  const totalVal = holdings.reduce((s, h) => s + h.displayValue, 0);
  const totalRealized = holdings.reduce((s, h) => s + h.displayRealized, 0);
  const totalPnl = (totalVal - totalCost) + totalRealized;

  if($('#portfolioCost')) $('#portfolioCost').textContent = money(totalCost);
  if($('#portfolioValue')) $('#portfolioValue').textContent = money(totalVal);
  if($('#portfolioPnl')) $('#portfolioPnl').textContent = signedMoney(totalPnl);
  if($('#portfolioRealized')) $('#portfolioRealized').textContent = signedMoney(totalRealized);

  const listEl = $('#holdingsList');
  if(!listEl) return;
  listEl.innerHTML = holdings.length ? holdings.map(h => {
    const avg = h.qty ? h.cost / h.qty : 0;
    return `<div class="holding-card"><div class="holding-row"><div class="holding-ticker"><strong>${escapeHTML(h.symbol)}</strong><small>持有 ${h.qty.toLocaleString('zh-TW')} 股</small></div><div><span>平均成本</span><strong>${h.qty ? unitMoney(avg) : '—'}</strong></div><div><span>持倉成本</span><strong>${money(h.displayCost)}</strong></div><div><span>現價</span><strong>${h.price ? unitMoney(h.price) : '—'}</strong></div><div><span>未實現損益</span><strong class="${h.displayPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}">${signedMoney(h.displayPnl)}</strong><small>${h.pct ? h.pct.toFixed(1) + '%' : ''}</small></div></div></div>`;
  }).join('') : '<p class="empty-hint">目前尚無股票持倉紀錄。</p>';
}

function renderFund(){
  const saved = entries.filter(e => e.major === 'travel').reduce((s, e) => s + (e.category === '基金存入' ? Number(e.amount || 0) : -Number(e.amount || 0)), 0);
  const target = Number(meta.trip?.target) || 0;
  const pct = target > 0 ? Math.min(100, Math.max(0, Math.round((saved / target) * 100))) : 0;

  if($('#tripNameHeading')) $('#tripNameHeading').textContent = meta.trip?.name || '夢想旅遊基金';
  if($('#fundAmount')) $('#fundAmount').textContent = money(saved);
  if($('#fundBar')) $('#fundBar').style.width = `${pct}%`;
  if($('#fundTargetText')){
    $('#fundTargetText').textContent = target > 0 ? `目標 ${money(target)}（${pct}%）` : '設定旅遊目標與金額';
  }
}

function renderTransactions(mItems){
  const listEl = $('#transactionList');
  const countEl = $('#recordCount');
  const filtered = activeFilter === 'all' ? mItems : mItems.filter(e => e.major === activeFilter);
  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || '') || ((b.createdAt || 0) - (a.createdAt || 0)));
  if(countEl) countEl.textContent = `${sorted.length} 筆紀錄`;
  if(!listEl) return;

  const visible = showAll ? sorted : sorted.slice(0, 20);
  listEl.innerHTML = visible.length ? visible.map(e => {
    const icon = ICONS[e.category] || '◦';
    const isInc = incomeEntry(e) || (e.major === 'travel' && e.category === '基金存入');
    return `<div class="tx-item ${ticketClass(e)}"><div class="tx-icon">${escapeHTML(icon)}</div><div class="tx-main"><strong>${escapeHTML(e.title || e.category || '未命名紀錄')}</strong><small>${escapeHTML(dateLabel(e.date))} · ${escapeHTML(GROUP_NAMES[e.major] || e.major)} · ${escapeHTML(e.category || '')}${e.note ? ' · ' + escapeHTML(e.note) : ''}</small></div><div class="tx-amount ${isInc ? 'positive' : ''}">${isInc ? '+' : '-'}${money(e.amount)}</div><button class="delete-btn" data-delete="${escapeHTML(e.id)}" aria-label="刪除紀錄">刪除</button></div>`;
  }).join('') : '<p class="empty-hint">這個月份或篩選條件下沒有紀錄。</p>';
}

function render(){
  if($('#todayLabel')) $('#todayLabel').textContent = `今天是 ${dateLabel(todayISO())}`;
  const mItems = monthEntries();

  const dailyIncome = mItems.filter(e => e.major === 'daily' && incomeEntry(e)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const dailyExpense = statFor(mItems, 'daily').value;
  const dailyIncomeCount = mItems.filter(e => e.major === 'daily' && incomeEntry(e)).length;
  const dailyExpenseCount = statFor(mItems, 'daily').count;
  const clawStat = statFor(mItems, 'claw');
  const stockStat = statFor(mItems, 'stock');
  const travelStat = statFor(mItems, 'travel');

  if($('#incomeTotal')) $('#incomeTotal').textContent = money(dailyIncome);
  if($('#incomeCount')) $('#incomeCount').textContent = `${dailyIncomeCount} 筆`;
  if($('#expenseTotal')) $('#expenseTotal').textContent = money(dailyExpense);
  if($('#expenseCount')) $('#expenseCount').textContent = `${dailyExpenseCount} 筆`;
  if($('#dailyBalanceTotal')) $('#dailyBalanceTotal').textContent = signedMoney(dailyIncome - dailyExpense);
  if($('#clawIncomeTotal')) $('#clawIncomeTotal').textContent = signedMoney(clawStat.value);

  if($('#dailyStat')) $('#dailyStat').textContent = money(dailyExpense);
  if($('#dailyCount')) $('#dailyCount').textContent = `本月 ${dailyExpenseCount} 筆支出`;
  if($('#clawStat')) $('#clawStat').textContent = signedMoney(clawStat.value);
  if($('#stockStat')) $('#stockStat').textContent = money(stockStat.value);
  if($('#travelStat')) $('#travelStat').textContent = money(travelStat.value);

  renderBreakdown(mItems);
  renderClawBreakdown(mItems);
  renderStocks(portfolio());
  renderFund();
  renderTransactions(mItems);
  updateAuthUI();
}

function bindEvents(){
  if($('#monthPicker') && !$('#monthPicker').value){
    $('#monthPicker').value = currentMonthISO();
  }
  $('#monthPicker')?.addEventListener('change', render);

  $('#googleLoginBtn')?.addEventListener('click', async () => {
    try{
      await signInWithPopup(auth, googleProvider);
    }catch(err){
      console.error('Google 登入失敗：', err);
      toast(`登入失敗：${err?.code || '請稍後再試'}`);
    }
  });

  $('#logoutBtn')?.addEventListener('click', async () => {
    try{
      await signOut(auth);
      toast('已登出');
    }catch(err){
      console.error('登出失敗：', err);
      toast('登出失敗');
    }
  });

  $('#addTop')?.addEventListener('click', () => openModal('daily'));
  $('#fundActionBtn')?.addEventListener('click', () => openModal('travel'));
  $('#closeModal')?.addEventListener('click', closeModal);
  $('#modal')?.addEventListener('click', e => {
    if(e.target === $('#modal')) closeModal();
  });

  $$('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.quick));
  });

  $('#majorCategory')?.addEventListener('change', refreshCategoryOptions);
  $('#category')?.addEventListener('change', toggleFormFields);
  $('#clawDetail')?.addEventListener('change', toggleFormFields);

  $('#addDetailBtn')?.addEventListener('click', () => {
    const name = prompt('輸入新的娃娃機細項名稱：')?.trim();
    if(!name) return;
    if(!meta.customClaw.includes(name)){
      meta.customClaw.push(name);
      save();
      refreshCategoryOptions();
      render();
      toast(`已新增細項「${name}」`);
    }
  });

  $('#setGoalBtn')?.addEventListener('click', () => {
    const nameInput = prompt('旅遊目標名稱：', meta.trip?.name || '夢想旅遊基金');
    if(nameInput === null) return;
    const targetInput = prompt('旅遊目標金額（元）：', String(meta.trip?.target || 50000));
    if(targetInput === null) return;
    const targetNum = Math.max(0, Number(targetInput) || 0);
    meta.trip = {
      name: (nameInput || '').trim() || '夢想旅遊基金',
      target: targetNum
    };
    save();
    render();
    toast('已更新旅遊目標');
  });

  $('#refreshQuotes')?.addEventListener('click', () => {
    const holdings = portfolio();
    if(!holdings.length){
      toast('目前沒有股票持倉可更新');
      return;
    }
    holdings.forEach(h => {
      const inputPrice = prompt(`請輸入 ${h.symbol} 目前現價（元）：`, String(h.price || ''));
      if(inputPrice !== null && inputPrice.trim() !== ''){
        const p = Number(inputPrice);
        if(!Number.isNaN(p) && p >= 0){
          meta.quotes[h.symbol] = { price: p, updatedAt: Date.now() };
        }
      }
    });
    save();
    render();
    toast('已更新股票現價');
  });

  $('#entryForm')?.addEventListener('submit', e => {
    e.preventDefault();
    const major = $('#majorCategory')?.value || 'daily';

    if(major === 'travel'){
      const action = $('#fundAction')?.value || 'deposit';
      const amt = Number($('#fundAmountInput')?.value || 0);
      const date = $('#fundDate')?.value || todayISO();
      const note = ($('#fundNote')?.value || '').trim();
      if(!amt || amt <= 0){
        toast('請輸入大於 0 的金額');
        return;
      }
      entries.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        major: 'travel',
        category: action === 'withdraw' ? '基金提領' : '基金存入',
        title: action === 'withdraw' ? '旅遊基金提領' : '旅遊基金存入',
        amount: amt,
        type: action === 'withdraw' ? 'expense' : 'income',
        date,
        note,
        createdAt: Date.now()
      });
      save();
      render();
      e.target.reset();
      if($('#fundDate')) $('#fundDate').value = todayISO();
      closeModal();
      toast('已儲存旅遊基金紀錄');
      return;
    }

    let category = major === 'claw' ? ($('#clawDetail')?.value || '其他成本') : ($('#category')?.value || '其他支出');
    if(category === '＋ 自訂細項'){
      const custom = ($('#customCategory')?.value || '').trim();
      if(!custom){
        toast('請輸入自訂細項名稱');
        return;
      }
      if(major === 'claw' && !meta.customClaw.includes(custom)){
        meta.customClaw.push(custom);
      }
      category = custom;
    }

    const qty = Number($('#quantity')?.value || 0);
    const price = Number($('#price')?.value || 0);
    const manualPrice = Number($('#manualPrice')?.value || 0);
    const symbol = ($('#symbol')?.value || '').trim().toUpperCase();
    let amount = Number($('#amount')?.value || 0);
    if(major === 'stock' && !amount && qty > 0 && price > 0){
      amount = Math.round(qty * price);
    }

    if(!amount || amount <= 0){
      toast('請輸入大於 0 的金額');
      return;
    }

    const title = ($('#title')?.value || '').trim() || symbol || category;
    const note = ($('#note')?.value || '').trim();
    const date = $('#date')?.value || todayISO();

    if(major === 'stock' && symbol && manualPrice > 0){
      meta.quotes[symbol.replace(/\.(TW|TWO)$/, '')] = { price: manualPrice, updatedAt: Date.now() };
    }

    entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      major,
      category,
      title,
      amount,
      quantity: major === 'stock' ? qty : undefined,
      price: major === 'stock' ? price : undefined,
      symbol: major === 'stock' ? symbol : undefined,
      manualPrice: major === 'stock' && manualPrice > 0 ? manualPrice : undefined,
      date,
      note,
      createdAt: Date.now()
    });

    save();
    render();
    e.target.reset();
    if($('#date')) $('#date').value = todayISO();
    refreshCategoryOptions();
    closeModal();
    toast('已儲存這筆紀錄');
  });

  $('#filters')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if(!btn) return;
    activeFilter = btn.dataset.filter || 'all';
    $$('#filters .filter').forEach(b => b.classList.toggle('active', b === btn));
    renderTransactions(monthEntries());
  });

  $$('[data-major]').forEach(card => {
    card.addEventListener('click', () => {
      const m = card.dataset.major || 'all';
      activeFilter = m;
      $$('#filters .filter').forEach(b => b.classList.toggle('active', b.dataset.filter === m));
      renderTransactions(monthEntries());
      $('#transactions')?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  $('#seeAll')?.addEventListener('click', () => {
    showAll = !showAll;
    $('#seeAll').innerHTML = showAll ? '收合紀錄 <span>↑</span>' : '查看全部 <span>→</span>';
    renderTransactions(monthEntries());
  });

  document.addEventListener('click', e => {
    const delBtn = e.target.closest('[data-delete]');
    if(!delBtn) return;
    const id = delBtn.dataset.delete;
    entries = entries.filter(item => item.id !== id);
    save();
    render();
    toast('已刪除紀錄');
  });

  $('#exportBtn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ entries, meta, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wellmoney-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已匯出資料備份');
  });

  $('#importFile')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const parsed = JSON.parse(text);
      if(Array.isArray(parsed.entries)){
        entries = parsed.entries.map(migrateEntry).filter(Boolean);
      }
      if(parsed.meta){
        meta = normalizeMeta(parsed.meta);
      }
      save();
      refreshCategoryOptions();
      render();
      toast('已匯入備份資料');
    }catch(err){
      console.error('匯入失敗：', err);
      toast('備份檔案格式不正確');
    }
    e.target.value = '';
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
    refreshCategoryOptions();
    render();
  }
});

refreshCategoryOptions();
bindEvents();
render();