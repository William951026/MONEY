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
const META_KEY = `${STORAGE_KEY}-meta`; const DEFAULTS = { daily: ['餐飲','交通','購物','居家','帳單','娛樂','醫療','其他支出','薪資','副業收入','其他收入'], claw: ['娃娃','零食','場租','其他成本','機台營收'], stock: ['股票買進','股票賣出','股利','其他投資'], travel: ['基金存入','基金提領'] }; const GROUP_NAMES = {daily:'日常開銷',claw:'娃娃機',stock:'股票投資',travel:'夢想旅遊基金'}; const ICONS = {'餐飲':'☕','交通':'↗','購物':'✳','居家':'⌂','帳單':'▤','娛樂':'♡','醫療':'＋','其他支出':'◦','薪資':'↙','副業收入':'✦','其他收入':'✳','娃娃':'♧','零食':'🍬','場租':'⌂','其他成本':'◦','機台營收':'♧','股票買進':'↗','股票賣出':'↙','股利':'⌁','其他投資':'◦','基金存入':'✈','基金提領':'↗'}; const COLORS = ['#729a7b','#e7aa79','#95a9c3','#c5a4b2','#d3c184','#8eb8b0','#e18e79','#aaa3c4','#98b4d2','#d8a77d']; const $ = selector => document.querySelector(selector);  function todayISO(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)} function migrateEntry(entry){ if(entry.major)return entry; let major=entry.category?.includes('娃娃機')?'claw':entry.type==='investment'?'stock':'daily'; let category=entry.category\vert{}\vert{}'其他支出'; if(major==='claw')category=category.includes('進帳')?'機台營收':category.includes('成本')?'其他成本':'其他成本'; if(major==='stock')category=category==='股利'?'股利':category==='股票賣出'?'股票賣出':category==='股票買入'?'股票買進':'其他投資'; return {...entry,major,category,legacy:true}; } function readEntries(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)\vert{}\vert{}'[]').map(migrateEntry)}catch{return []}} let entries=readEntries(); function normalizeMeta(raw={}){ return { customClaw: Array.isArray(raw.customClaw) ? raw.customClaw : [], quotes: raw.quotes && typeof raw.quotes === 'object' ? raw.quotes : {}, trip: { name: raw.trip?.name \vert{}\vert{} '夢想旅遊基金', target: Number(raw.trip?.target) \vert{}\vert{} 0 } }; } function readMeta(){ let oldFund={};try{oldFund=JSON.parse(localStorage.getItem(`${STORAGE_KEY}-fund`)||'{}')||{}}catch{}
  if(Number(oldFund.balance)>0&&!entries.some(e=>e.major==='travel'))entries.push({id:'legacy-trip-fund',major:'travel',category:'基金存入',amount:Number(oldFund.balance),type:'income',date:todayISO(),title:'既有夢想基金餘額',createdAt:0});
  let saved={};try{saved=JSON.parse(localStorage.getItem(META_KEY)||'{}')||{}}catch{}
  return normalizeMeta({...saved,trip:{name:saved.trip?.name||'夢想旅遊基金',target:Number(saved.trip?.target)||Number(oldFund.target)||0}});
}
let meta=readMeta(), activeFilter='all', showAll=false;

async function syncToCloud(uid){
  if(!uid || isSyncingFromCloud)return;
  try{
    await setDoc(doc(db,'users',uid),{
      entries,
      meta,
      updatedAt:new Date().toISOString()
    },{merge:true});
  }catch(err){
    console.error('雲端同步失敗：',err);
    toast('雲端同步失敗，已先存至本機');
  }
}

function save(){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(entries));
  localStorage.setItem(META_KEY,JSON.stringify(meta));
  if(currentUser){
    syncToCloud(currentUser.uid);
  }
}

function refreshClawSelectOptions(){
  const clawSelect=$('#clawDetail');
  if(!clawSelect)return;
  const prev=clawSelect.value;
  const list=[...DEFAULTS.claw,...meta.customClaw,'＋ 自訂細項'];
  clawSelect.innerHTML=list.map(c=>`<option>${escapeHTML(c)}</option>`).join(''); if(prev && list.includes(prev))clawSelect.value=prev; }  async function loadFromCloud(uid){ isSyncingFromCloud=true; try{ const ref=doc(db,'users',uid); const snap=await getDoc(ref); if(snap.exists()){ const data=snap.data()\vert{}\vert{}{}; if(Array.isArray(data.entries)){ entries=data.entries.map(migrateEntry); } meta=normalizeMeta(data.meta\vert{}\vert{}{}); localStorage.setItem(STORAGE_KEY,JSON.stringify(entries)); localStorage.setItem(META_KEY,JSON.stringify(meta)); refreshClawSelectOptions(); render(); toast('已載入雲端資料 ☁'); }else if(entries.length>0 \vert{}\vert{} meta.trip.target>0 \vert{}\vert{} meta.customClaw.length>0){ await setDoc(ref,{ entries, meta, updatedAt:new Date().toISOString() },{merge:true}); toast('已將本機資料同步至雲端 ☁'); } }catch(err){ console.error('讀取雲端資料失敗：',err); toast('讀取雲端資料失敗，目前顯示本機資料'); }finally{ isSyncingFromCloud=false; } }  function escapeHTML(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))} function money(amount){return 'NT$'+Math.round(Math.abs(Number(amount)\vert{}\vert{}0)).toLocaleString('zh-TW')} function unitMoney(amount){return 'NT$'+Math.abs(Number(amount)\vert{}\vert{}0).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})+' / 股'} function signedMoney(amount){const n=Number(amount)\vert{}\vert{}0;return `${n>=0?'+':'-'}${money(n)}`} function multiMoney(map){const parts=Object.entries(map).filter(([,v])=>Math.abs(v)>.005);return parts.length?parts.map(([,v])=>`${v<0?'−':''}${money(v)}`).join(' · '):money(0)} function signedMultiMoney(map){const parts=Object.entries(map).filter(([,v])=>Math.abs(v)>.005);return parts.length?parts.map(([,v])=>signedMoney(v)).join(' · '):signedMoney(0)} function monthEntries(){return entries.filter(e=>e.date?.startsWith($('#monthPicker').value))} function incomeEntry(e){return e.major==='claw'?e.category==='機台營收':e.major==='daily'?(['薪資','副業收入','其他收入'].includes(e.category)\vert{}\vert{}e.type==='income'):e.major==='stock'?['股票賣出','股利'].includes(e.category):false} function dateLabel(value){const d=new Date(`${value}T12:00:00`);return `${d.getMonth()+1}月${d.getDate()}日`}
function ticketClass(e){return e.major==='daily'?(incomeEntry(e)?'income':'expense'):e.major==='claw'?'claw':e.major==='stock'?'invest':'travel'}

function portfolio(){
  const map={};
  entries.filter(e=>e.major==='stock'&&e.symbol&&['股票買進','股票賣出','股利'].includes(e.category)).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0)).forEach(e=>{
    const symbol=e.symbol.toUpperCase().replace(/\.(TW|TWO)$/,''),g=map[symbol]||{symbol,qty:0,cost:0,realized:0,currency:'TWD',transactions:0};g.transactions++;
    const qty=Number(e.quantity)||0,price=Number(e.price)||0;
    const fees=(Number(e.commission)||0)+(Number(e.tax)||0);
    if(e.category==='股票買進'){g.qty+=qty;g.cost+=qty*price+fees}
    else if(e.category==='股票賣出'&&g.qty>0){const sold=Math.min(qty,g.qty),avg=g.cost/g.qty;g.cost-=avg*sold;g.qty-=sold;g.realized+=(price*sold-fees)-avg*sold}
    else if(e.category==='股利')g.realized+=(Number(e.amount)||0)-fees;
    map[symbol]=g;
  });
  return Object.values(map).map(g=>{const quote=meta.quotes[g.symbol],last=entries.filter(e=>e.symbol?.toUpperCase().replace(/\.(TW|TWO)$/,'')===g.symbol).at(-1);g.price=Number(quote?.price)||Number(last?.manualPrice)||0;g.updatedAt=quote?.updatedAt||last?.quoteUpdatedAt||null;g.value=g.qty*g.price;g.displayCost=Math.round(g.cost);g.displayValue=Math.round(g.value);g.displayPnl=g.displayValue-g.displayCost;g.displayRealized=Math.round(g.realized);g.pct=g.displayCost?100*g.displayPnl/g.displayCost:0;return g}).filter(g=>g.qty>0||g.realized!==0||g.transactions>0);
}
function groupedByCurrency(holdings,key){return holdings.reduce((out,h)=>{out[h.currency]=(out[h.currency]||0)+(h[key]||0);return out},{})}
function groupedRoundedByCurrency(holdings,key){return holdings.reduce((out,h)=>{out[h.currency]=(out[h.currency]||0)+Math.round(h[key]||0);return out},{})}
function statFor(items,major){const selected=items.filter(e=>e.major===major);if(major==='daily'){const es=selected.filter(e=>!incomeEntry(e));return {value:es.reduce((s,e)=>s+Number(e.amount||0),0),count:es.length}}if(major==='claw'){const inc=selected.filter(incomeEntry).reduce((s,e)=>s+Number(e.amount||0),0),cost=selected.filter(e=>!incomeEntry(e)).reduce((s,e)=>s+Number(e.amount||0),0);return {value:inc-cost,count:selected.length}}if(major==='stock'){const hs=portfolio();return {value:hs.reduce((s,h)=>s+h.value,0),count:hs.filter(h=>h.qty>0).length}}const value=entries.filter(e=>e.major==='travel').reduce((s,e)=>s+(e.category==='基金存入'?Number(e.amount||0):-Number(e.amount||0)),0);return {value,count:selected.length}}

function stockDetailRows(symbol){
  const rows=entries.filter(e=>e.major==='stock'&&e.symbol&&e.symbol.toUpperCase().replace(/\.(TW|TWO)$/,'')===symbol&&['股票買進','股票賣出','股利'].includes(e.category)).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0));
  return rows.map(e=>{const fee=(Number(e.commission)||0)+(Number(e.tax)||0),trade=['股票買進','股票賣出'].includes(e.category),qty=Number(e.quantity)||0,price=Number(e.price)||0,subtotal=e.category==='股票買進'?-(Number(e.amount)||qty*price)-fee:e.category==='股票賣出'?(Number(e.amount)||qty*price)-fee:(Number(e.amount)||0)-fee;return `<tr><td>${escapeHTML(e.date\vert{}\vert{}'')}</td><td>${escapeHTML(e.category)}</td><td>${trade?qty.toLocaleString('zh-TW')+' 股':'—'}</td><td>${trade?unitMoney(price):'—'}</td><td>${money(e.commission)} /${money(e.tax)}</td><td class="${subtotal>=0?'pnl-positive':'pnl-negative'}">${signedMoney(subtotal)}</td><td><button class="delete-entry detail-delete" data-delete="${escapeHTML(e.id)}" aria-label="刪除這筆${escapeHTML(e.category)}紀錄">刪除</button></td></tr>`}).join('');
}
function renderHoldings(holdings){
  $('#holdingsList').innerHTML=holdings.length?holdings.map(h=>{const details=stockDetailRows(h.symbol),avg=h.qty?h.cost/h.qty:0;return `<div class="holding-card"><div class="holding-row"><div class="holding-ticker"><strong>${escapeHTML(h.symbol)}</strong><small>台幣 · ${h.qty.toLocaleString()} 股</small></div><div><span>平均成本</span><strong>${h.qty?unitMoney(avg):'—'}</strong></div><div><span>持倉成本</span><strong>${money(h.displayCost)}</strong></div><div><span>現價</span><strong>${h.price?unitMoney(h.price):'—'}</strong><small>${h.updatedAt?'更新 '+new Date(h.updatedAt).toLocale