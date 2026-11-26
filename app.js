const STORAGE_KEY = 'wellmoney-ledger-v1';
const META_KEY = `${STORAGE_KEY}-meta`;
const DEFAULTS = {
  daily: ['餐飲','交通','購物','居家','帳單','娛樂','醫療','其他支出','薪資','副業收入','其他收入'],
  claw: ['娃娃','零食','場租','其他成本','機台營收'],
  stock: ['股票買進','股票賣出','股利','其他投資'],
  travel: ['基金存入','基金提領']
};
const GROUP_NAMES = {daily:'日常開銷',claw:'娃娃機',stock:'股票投資',travel:'夢想旅遊基金'};
const ICONS = {'餐飲':'☕','交通':'↗','購物':'✳','居家':'⌂','帳單':'▤','娛樂':'♡','醫療':'＋','其他支出':'◦','薪資':'↙','副業收入':'✦','其他收入':'✳','娃娃':'♧','零食':'🍬','場租':'⌂','其他成本':'◦','機台營收':'♧','股票買進':'↗','股票賣出':'↙','股利':'⌁','其他投資':'◦','基金存入':'✈','基金提領':'↗'};
const COLORS = ['#729a7b','#e7aa79','#95a9c3','#c5a4b2','#d3c184','#8eb8b0','#e18e79','#aaa3c4','#98b4d2','#d8a77d'];
const $ = selector => document.querySelector(selector);

function todayISO(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function migrateEntry(entry){
  if(entry.major)return entry;
  let major=entry.category?.includes('娃娃機')?'claw':entry.type==='investment'?'stock':'daily';
  let category=entry.category||'其他支出';
  if(major==='claw')category=category.includes('進帳')?'機台營收':category.includes('成本')?'其他成本':'其他成本';
  if(major==='stock')category=category==='股利'?'股利':category==='股票賣出'?'股票賣出':category==='股票買入'?'股票買進':'其他投資';
  return {...entry,major,category,legacy:true};
}
function readEntries(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]').map(migrateEntry)}catch{return []}}
let entries=readEntries();
function readMeta(){
  let oldFund={};try{oldFund=JSON.parse(localStorage.getItem(`${STORAGE_KEY}-fund`)||'{}')||{}}catch{}
  if(Number(oldFund.balance)>0&&!entries.some(e=>e.major==='travel'))entries.push({id:'legacy-trip-fund',major:'travel',category:'基金存入',amount:Number(oldFund.balance),type:'income',date:todayISO(),title:'既有夢想基金餘額',createdAt:0});
  let saved={};try{saved=JSON.parse(localStorage.getItem(META_KEY)||'{}')||{}}catch{}
  return {customClaw:[],quotes:{},trip:{name:'夢想旅遊基金',target:0},...saved,trip:{name:saved.trip?.name||'夢想旅遊基金',target:Number(saved.trip?.target)||Number(oldFund.target)||0}};
}
let meta=readMeta(), activeFilter='all', showAll=false;
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(entries));localStorage.setItem(META_KEY,JSON.stringify(meta))}
function escapeHTML(value=''){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function money(amount){return 'NT$'+Math.round(Math.abs(Number(amount)||0)).toLocaleString('zh-TW')}
function unitMoney(amount){return 'NT$'+Math.abs(Number(amount)||0).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})+' / 股'}
function signedMoney(amount){const n=Number(amount)||0;return `${n>=0?'+':'-'}${money(n)}`}
function multiMoney(map){const parts=Object.entries(map).filter(([,v])=>Math.abs(v)>.005);return parts.length?parts.map(([,v])=>`${v<0?'−':''}${money(v)}`).join(' · '):money(0)}
function signedMultiMoney(map){const parts=Object.entries(map).filter(([,v])=>Math.abs(v)>.005);return parts.length?parts.map(([,v])=>signedMoney(v)).join(' · '):signedMoney(0)}
function monthEntries(){return entries.filter(e=>e.date?.startsWith($('#monthPicker').value))}
function incomeEntry(e){return e.major==='claw'?e.category==='機台營收':e.major==='daily'?(['薪資','副業收入','其他收入'].includes(e.category)||e.type==='income'):e.major==='stock'?['股票賣出','股利'].includes(e.category):false}
function dateLabel(value){const d=new Date(`${value}T12:00:00`);return `${d.getMonth()+1}月${d.getDate()}日`}
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
function pnlPercent(holdings){const hs=holdings.filter(h=>h.qty>0),cost=hs.reduce((s,h)=>s+h.cost,0),pnl=hs.reduce((s,h)=>s+h.pnl,0);return hs.length?`台股 ${pnl>=0?'+':''}${cost?(pnl/cost*100).toFixed(2):'0.00'}%`:'尚無持倉'}
function statFor(items,major){const selected=items.filter(e=>e.major===major);if(major==='daily'){const es=selected.filter(e=>!incomeEntry(e));return {value:es.reduce((s,e)=>s+Number(e.amount||0),0),count:es.length}}if(major==='claw'){const inc=selected.filter(incomeEntry).reduce((s,e)=>s+Number(e.amount||0),0),cost=selected.filter(e=>!incomeEntry(e)).reduce((s,e)=>s+Number(e.amount||0),0);return {value:inc-cost,count:selected.length}}if(major==='stock'){const hs=portfolio();return {value:hs.reduce((s,h)=>s+h.value,0),count:hs.filter(h=>h.qty>0).length}}const value=entries.filter(e=>e.major==='travel').reduce((s,e)=>s+(e.category==='基金存入'?Number(e.amount||0):-Number(e.amount||0)),0);return {value,count:selected.length}}

function stockDetailRows(symbol){
  const rows=entries.filter(e=>e.major==='stock'&&e.symbol&&e.symbol.toUpperCase().replace(/\.(TW|TWO)$/,'')===symbol&&['股票買進','股票賣出','股利'].includes(e.category)).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||0)-(b.createdAt||0));
  return rows.map(e=>{const fee=(Number(e.commission)||0)+(Number(e.tax)||0),trade=['股票買進','股票賣出'].includes(e.category),qty=Number(e.quantity)||0,price=Number(e.price)||0,subtotal=e.category==='股票買進'?-(Number(e.amount)||qty*price)-fee:e.category==='股票賣出'?(Number(e.amount)||qty*price)-fee:(Number(e.amount)||0)-fee;return `<tr><td>${escapeHTML(e.date||'')}</td><td>${escapeHTML(e.category)}</td><td>${trade?qty.toLocaleString('zh-TW')+' 股':'—'}</td><td>${trade?unitMoney(price):'—'}</td><td>${money(e.commission)} / ${money(e.tax)}</td><td class="${subtotal>=0?'pnl-positive':'pnl-negative'}">${signedMoney(subtotal)}</td><td><button class="delete-entry detail-delete" data-delete="${escapeHTML(e.id)}" aria-label="刪除這筆${escapeHTML(e.category)}紀錄">刪除</button></td></tr>`}).join('');
}
function renderHoldings(holdings){
  $('#holdingsList').innerHTML=holdings.length?holdings.map(h=>{const details=stockDetailRows(h.symbol),avg=h.qty?h.cost/h.qty:0;return `<div class="holding-card"><div class="holding-row"><div class="holding-ticker"><strong>${escapeHTML(h.symbol)}</strong><small>台幣 · ${h.qty.toLocaleString()} 股</small></div><div><span>平均成本</span><strong>${h.qty?unitMoney(avg):'—'}</strong></div><div><span>持倉成本</span><strong>${money(h.displayCost)}</strong></div><div><span>現價</span><strong>${h.price?unitMoney(h.price):'—'}</strong><small>${h.updatedAt?'更新 '+new Date(h.updatedAt).toLocaleString('zh-TW',{hour12:false}):'尚無報價'}</small></div><div><span>市值</span><strong>${money(h.displayValue)}</strong></div><div class="holding-pnl ${h.displayPnl>=0?'positive':'negative'}"><span>未實現損益</span><strong>${signedMoney(h.displayPnl)}</strong><small>${h.displayPnl>=0?'+':''}${h.pct.toFixed(2)}%</small></div><div class="holding-pnl ${h.displayRealized>=0?'positive':'negative'}"><span>已實現損益</span><strong>${signedMoney(h.displayRealized)}</strong></div><button class="holding-quote" data-symbol="${escapeHTML(h.symbol)}">更新</button></div><details class="holding-details"><summary>詳細明細（${details? (details.match(/<tr>/g)||[]).length:0} 筆）</summary><div class="holding-detail-scroll"><table><thead><tr><th>日期</th><th>類型</th><th>股數</th><th>單價</th><th>手續費／稅</th><th>小計</th><th>操作</th></tr></thead><tbody>${details||'<tr><td colspan="7">尚無交易明細</td></tr>'}</tbody></table></div></details></div>`}).join(''):'<div class="empty-small holdings-empty">新增股票買進紀錄後，這裡會自動彙整各檔持倉。</div>';
}
function render(){
  const items=monthEntries(),holdings=portfolio();
  const dailyIncome=items.filter(e=>e.major==='daily'&&incomeEntry(e)).reduce((s,e)=>s+Number(e.amount||0),0);
  const dailyExpense=items.filter(e=>e.major==='daily'&&!incomeEntry(e)).reduce((s,e)=>s+Number(e.amount||0),0);
  const dailyBalance=dailyIncome-dailyExpense;
  const clawItems=items.filter(e=>e.major==='claw'),clawRevenue=clawItems.filter(incomeEntry).reduce((s,e)=>s+Number(e.amount||0),0),clawExpense=clawItems.filter(e=>!incomeEntry(e)).reduce((s,e)=>s+Number(e.amount||0),0),clawNet=clawRevenue-clawExpense;
  $('#incomeTotal').textContent=money(dailyIncome);$('#expenseTotal').textContent=money(dailyExpense);$('#dailyBalanceTotal').textContent=signedMoney(dailyBalance);$('#dailyBalanceTotal').classList.toggle('pnl-positive',dailyBalance>=0);$('#dailyBalanceTotal').classList.toggle('pnl-negative',dailyBalance<0);$('#clawIncomeTotal').textContent=signedMoney(clawNet);const clawCard=$('#clawIncomeTotal').closest('.summary-card');clawCard.classList.add('claw-net-card');clawCard.querySelector('.card-top>span').textContent='娃娃機淨損益';$('#clawIncomeCount').textContent='本月營收減總支出';clawCard.querySelector('.amount').classList.toggle('pnl-positive',clawNet>=0);clawCard.querySelector('.amount').classList.toggle('pnl-negative',clawNet<0);
  $('#incomeCount').textContent=items.filter(e=>e.major==='daily'&&incomeEntry(e)).length+' 筆';$('#expenseCount').textContent=items.filter(e=>e.major==='daily'&&!incomeEntry(e)).length+' 筆';$('#clawIncomeCount').textContent=items.filter(e=>e.major==='claw'&&incomeEntry(e)).length+' 筆娃娃機營收';$('#expenseMonthTag').textContent=$('#monthPicker').value.replace('-',' / ');
  const daily=statFor(items,'daily'),claw=statFor(items,'claw'),travel=statFor(items,'travel');$('#dailyStat').textContent=money(daily.value);$('#dailyCount').textContent=`本月 ${daily.count} 筆支出`;
  $('#clawStat').textContent=signedMoney(claw.value);$('#clawCount').textContent='本月娃娃機淨損益';
  $('#stockStat').textContent=multiMoney(groupedByCurrency(holdings,'value'));$('#stockCount').textContent=`${holdings.filter(h=>h.qty>0).length} 檔持倉`;
  $('#travelStat').textContent=money(travel.value);$('#travelCount').textContent=`${meta.trip.name||'旅遊基金'} · 目前累積`;
  const pnl=groupedRoundedByCurrency(holdings,'displayPnl'),cost=groupedRoundedByCurrency(holdings,'displayCost'),value=groupedRoundedByCurrency(holdings,'displayValue'),realized=groupedRoundedByCurrency(holdings,'displayRealized');
  $('#portfolioCost').textContent=multiMoney(cost);$('#portfolioValue').textContent=multiMoney(value);
  const currencies=[...new Set([...Object.keys(pnl),...Object.keys(realized)])],totalPnl=Object.fromEntries(currencies.map(c=>[c,(pnl[c]||0)+(realized[c]||0)]));$('#portfolioPnl').textContent=signedMultiMoney(totalPnl);$('#portfolioRealized').textContent=signedMultiMoney(realized);$('#portfolioPnl').classList.toggle('pnl-positive',Object.values(totalPnl).every(v=>v>=0));$('#portfolioPnl').classList.toggle('pnl-negative',Object.values(totalPnl).some(v=>v<0));$('#portfolioRealized').classList.toggle('pnl-positive',Object.values(realized).every(v=>v>=0));$('#portfolioRealized').classList.toggle('pnl-negative',Object.values(realized).some(v=>v<0));
  $('#tripNameHeading').textContent=meta.trip.name||'夢想旅遊基金';$('#tripDescription').textContent=meta.trip.target?`為 ${meta.trip.name||'這趟旅程'}，慢慢存下一點。`:'為下一趟旅程，慢慢存下一點。';
  $('#fundAmount').textContent=money(travel.value);$('#fundBar').style.width=(meta.trip.target?Math.max(0,Math.min(100,travel.value/meta.trip.target*100)):0)+'%';$('#fundTargetText').textContent=meta.trip.target?`目標 ${money(meta.trip.target)} · 還差 ${money(Math.max(0,meta.trip.target-travel.value))}`:'設定旅遊目標與金額';
  const expensesForChart=items.filter(e=>e.major==='daily'&&!incomeEntry(e)),sums={};
  $('.breakdown-panel .panel-heading h3').textContent='本月日常支出分布';$('.breakdown-panel .panel-heading p').textContent='僅統計日常開銷細項，娃娃機成本另列。';
  expensesForChart.forEach(e=>{const label=e.category;sums[label]=(sums[label]||0)+Number(e.amount||0)});
  const expenseTotal=Object.values(sums).reduce((a,b)=>a+b,0),parts=Object.entries(sums).sort((a,b)=>b[1]-a[1]);$('#donutTotal').textContent=money(expenseTotal);let offset=0;
  $('#donut').style.background=parts.length?`conic-gradient(${parts.map(([name,amount],i)=>{const start=offset;offset+=amount/expenseTotal*100;return `${COLORS[i%COLORS.length]} ${start}% ${offset}%`}).join(',')})`:'conic-gradient(#e8e8e2 0% 100%)';
  $('#categoryList').innerHTML=parts.length?parts.slice(0,6).map(([name,amount],i)=>`<div class="category-item"><span class="category-dot" style="--dot:${COLORS[i%COLORS.length]}"></span><span class="category-name">${escapeHTML(name)}</span><strong>${money(amount)}</strong><small>${Math.round(amount/expenseTotal*100)}%</small></div>`).join(''):'<div class="empty-small">記下第一筆支出，這裡就會慢慢長出你的花費地圖。</div>';
  if(!$('#clawSummary'))$('#clawBreakdown').insertAdjacentHTML('beforebegin','<div class="claw-summary-strip" id="clawSummary"><div><span>本月總收入／營收</span><strong id="clawRevenueStat"></strong><small id="clawRevenueCount"></small></div><div><span>本月總支出</span><strong id="clawExpenseStat"></strong><small>各成本細項加總</small></div><div><span>本月淨損益</span><strong id="clawNetStat"></strong><small>總收入減總支出</small></div></div>');
  $('#clawRevenueStat').textContent=money(clawRevenue);$('#clawRevenueCount').textContent=`${clawItems.filter(incomeEntry).length} 筆營收`;$('#clawExpenseStat').textContent=money(clawExpense);$('#clawNetStat').textContent=signedMoney(clawNet);$('#clawNetStat').classList.toggle('pnl-positive',clawNet>=0);$('#clawNetStat').classList.toggle('pnl-negative',clawNet<0);
  const clawDetails=[...DEFAULTS.claw,...meta.customClaw],clawStats=clawDetails.map(name=>{const es=items.filter(e=>e.major==='claw'&&e.category===name),inc=es.filter(incomeEntry).reduce((s,e)=>s+Number(e.amount||0),0),costSum=es.filter(e=>!incomeEntry(e)).reduce((s,e)=>s+Number(e.amount||0),0);return {name,inc,cost:costSum,net:inc-costSum,count:es.length}}).filter(x=>x.count);
  $('#clawBreakdown').innerHTML=clawStats.length?clawStats.map(x=>`<div class="claw-detail-row"><span>${escapeHTML(x.name)}</span><small>${x.count}筆</small><span>收入 ${money(x.inc)} · 支出 ${money(x.cost)}</span><strong class="${x.net>=0?'pnl-positive':'pnl-negative'}">淨損益 ${signedMoney(x.net)}</strong></div>`).join(''):'<div class="empty-small">這個月還沒有娃娃機細項紀錄。</div>';
  renderHoldings(holdings);
  $('.transaction-heading p').textContent='選擇日常開銷或娃娃機等分類，可逐筆查看與刪除紀錄。';
  const visible=entries.filter(e=>activeFilter==='all'||e.major===activeFilter).sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||0)-(a.createdAt||0)),shown=showAll?visible:visible.slice(0,7);$('#recordCount').textContent=`${visible.length} 筆紀錄`;
  $('#transactionList').innerHTML=shown.length?shown.map(e=>{const positive=incomeEntry(e)||e.category==='基金存入',description=e.major==='claw'?`娃娃機 · ${e.category}`:GROUP_NAMES[e.major]||'日常開銷',amount=e.major==='stock'&&e.quantity?`${e.quantity} 股 × ${unitMoney(e.price)}`:`${positive?'+':'−'}${money(e.amount,e.currency)}`;return `<div class="transaction-row"><span class="transaction-icon ${ticketClass(e)}">${ICONS[e.category]||'◦'}</span><div class="transaction-main"><strong>${escapeHTML(e.title||e.symbol||e.category)}</strong><span>${escapeHTML(description)}${e.note?' · '+escapeHTML(e.note):''}</span></div><time>${dateLabel(e.date)}</time><strong class="transaction-amount ${positive?'positive':''}">${amount}</strong><button class="delete-entry" data-delete="${escapeHTML(e.id)}" aria-label="刪除紀錄">刪除</button></div>`}).join(''):'<div class="empty-state"><span>✳</span><strong>這裡還很清爽</strong><p>新增第一筆紀錄，開始認識你的金錢流向。</p><button class="text-button" data-empty-add>＋ 新增第一筆</button></div>';
}

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2500)}
function deleteEntry(id){const entry=entries.find(x=>String(x.id)===String(id));if(!entry)return;if(!confirm(`確定刪除「${entry.title||entry.category}」這筆紀錄嗎？刪除後會立即更新相關統計。`))return;entries=entries.filter(x=>String(x.id)!==String(id));save();render();toast('紀錄已刪除，相關統計已更新')}
function categoriesFor(major){return major==='claw'?[...DEFAULTS.claw,...meta.customClaw]:DEFAULTS[major]||DEFAULTS.daily}
function updateCategoryForm(){
  if(!$('#feesField')){$('#priceField').insertAdjacentHTML('afterend','<div class="form-grid full hidden" id="feesField"><label class="field"><span>手續費（元）</span><input id="commission" type="number" min="0" step="any" value="0" placeholder="0"></label><label class="field"><span>證交稅（元）</span><input id="tax" type="number" min="0" step="any" value="0" placeholder="0"></label></div>')}
  const major=$('#majorCategory').value,claw=major==='claw',stock=major==='stock';$('#category').innerHTML=categoriesFor(major).map(c=>`<option>${escapeHTML(c)}</option>`).join('');
  $('#categoryField').classList.toggle('hidden',claw);$('#clawDetailField').classList.toggle('hidden',!claw);$('#categoryField').querySelector('span').textContent=stock?'交易類型':'紀錄類別';
  const updateFields=()=>{const trade=stock&&['股票買進','股票賣出'].includes($('#category').value),stockRecord=stock&&$('#category').value!=='其他投資';$('#symbolField').classList.toggle('hidden',!stockRecord);$('#quantityField').classList.toggle('hidden',!trade);$('#priceField').classList.toggle('hidden',!trade);$('#manualPriceField').classList.toggle('hidden',!trade);$('#feesField').classList.toggle('hidden',!stockRecord);$('#amountField').classList.toggle('hidden',trade);$('#title').placeholder=stock?'股票公司名稱或備註':'例如：午餐、生活消費';if(stock&&trade)$('#title').value=$('#category').value;$('#price').placeholder=$('#category').value==='股票買進'?'買進成交單價':'賣出成交單價';$('#lookupStatus').textContent=$('#category').value==='股利'?'輸入領取股利的台股代號，股利金額填在金額欄。':'本機 Python 服務查詢 Yahoo 奇摩股市台股報價，新台幣計價。'};
  $('#category').onchange=updateFields;updateFields();
}
function openModal(major='daily'){ $('#entryForm').reset();$('#majorCategory').value=major;$('#date').value=todayISO();$('#fundDate').value=todayISO();$('#normalFields').classList.remove('hidden');$('#fundFields').classList.add('hidden');$('#customCategoryField').classList.add('hidden');$('#modalTitle').textContent='新增一筆紀錄';updateCategoryForm();if(major==='claw')$('#clawDetail').value=DEFAULTS.claw[0];$('#modal').classList.add('open');$('#modal').setAttribute('aria-hidden','false');document.body.classList.add('modal-open')}
function openFundModal(){openModal('travel');$('#normalFields').classList.add('hidden');$('#fundFields').classList.remove('hidden');$('#modalTitle').textContent='旅遊基金存入／提領'}
function closeModal(){$('#modal').classList.remove('open');$('#modal').setAttribute('aria-hidden','true');document.body.classList.remove('modal-open')}
function makeEntry(major,category,amount,extra={}){return {id:crypto.randomUUID?.()||String(Date.now()+Math.random()),major,category,amount:Number(amount)||0,date:$('#date').value,title:$('#title').value.trim()||category,note:$('#note').value.trim(),createdAt:Date.now(),...extra}}
function stockSymbols(raw){const s=raw.trim().toUpperCase().replace(/\.(TW|TWO)$/,'');if(/^\d{4,6}$/.test(s))return s;throw Error('請輸入台股代號，例如 2330 或 0050。')}
async function fetchQuote(raw){const symbol=stockSymbols(raw),r=await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`),d=await r.json();if(!r.ok)throw Error(d.error||'無法取得台股報價');if(Number(d.price)>0)return {...d,currency:'TWD'};throw Error('查無報價，請使用手動輸入現價。')}
async function lookupQuote(symbolOverride){const raw=(symbolOverride||$('#symbol').value).trim();if(!raw){toast('請先輸入台股代號');return}try{stockSymbols(raw)}catch(error){$('#lookupStatus').textContent=error.message;toast(error.message);return}const button=$('#lookupPrice');button.disabled=true;$('#lookupStatus').textContent='正在查詢台股市價…';try{const quote=await fetchQuote(raw),key=raw.toUpperCase().replace(/\.(TW|TWO)$/,'');meta.quotes[key]={price:Number(quote.price),currency:'TWD',updatedAt:quote.updatedAt||new Date().toISOString(),source:quote.source||'Yahoo Finance'};$('#symbol').value=key;$('#manualPrice').value=quote.price;$('#lookupStatus').textContent=`現價 ${unitMoney(quote.price)} · ${meta.quotes[key].source} · ${new Date(meta.quotes[key].updatedAt).toLocaleString('zh-TW',{hour12:false})}`;save();render();toast('台股市價已更新')}catch(error){$('#lookupStatus').textContent=`${error.message} 輸入手動現價即可繼續。`;toast('報價暫時無法取得，可手動輸入現價')}finally{button.disabled=false}}

$('#monthPicker').value=todayISO().slice(0,7);$('#todayLabel').textContent=new Date().toLocaleDateString('zh-TW',{year:'numeric',month:'long',day:'numeric'})+' · YOUR MONEY JOURNAL';
$('#monthPicker').onchange=render;$('#addTop').onclick=()=>openModal();$('#majorCategory').onchange=updateCategoryForm;
document.querySelectorAll('[data-quick]').forEach(button=>button.onclick=()=>button.dataset.quick==='fund'?openFundModal():openModal(({daily:'daily',stock:'stock',claw:'claw'})[button.dataset.quick]));
document.querySelectorAll('[data-major]').forEach(button=>button.onclick=()=>{activeFilter=button.dataset.major;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter===activeFilter));render();$('#transactions').scrollIntoView({behavior:'smooth'})});
$('#clawDetail').innerHTML=[...DEFAULTS.claw,...meta.customClaw,'＋ 自訂細項'].map(c=>`<option>${escapeHTML(c)}</option>`).join('');$('#clawDetail').onchange=()=>$('#customCategoryField').classList.toggle('hidden',$('#clawDetail').value!=='＋ 自訂細項');
$('#lookupPrice').onclick=()=>lookupQuote();$('#symbol').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();lookupQuote()}});
$('#manualPrice').onchange=()=>{const symbol=$('#symbol').value.trim().toUpperCase().replace(/\.(TW|TWO)$/,''),price=Number($('#manualPrice').value);if(!/^\d{4,6}$/.test(symbol)||price<=0)return;meta.quotes[symbol]={price,currency:'TWD',updatedAt:new Date().toISOString(),source:'手動輸入'};$('#lookupStatus').textContent=`手動現價 ${unitMoney(price)} · ${new Date(meta.quotes[symbol].updatedAt).toLocaleString('zh-TW',{hour12:false})}`;save();render()};
$('#entryForm').onsubmit=e=>{
  e.preventDefault();const major=$('#majorCategory').value;
  if(major==='travel'){
    const amount=Number($('#fundAmountInput').value),action=$('#fundAction').value;if(amount<=0){toast('請輸入大於 0 的金額');return}
    const balance=entries.filter(x=>x.major==='travel').reduce((s,x)=>s+(x.category==='基金存入'?x.amount:-x.amount),0);if(action==='withdraw'&&amount>balance){toast('提領金額不能超過目前已存金額');return}
    entries.push({id:crypto.randomUUID?.()||String(Date.now()),major,category:action==='deposit'?'基金存入':'基金提領',amount,type:action==='deposit'?'income':'expense',date:$('#fundDate').value,title:action==='deposit'?'旅遊基金存入':'旅遊基金提領',note:$('#fundNote').value.trim(),createdAt:Date.now()});save();closeModal();render();toast('旅遊基金紀錄已儲存 ✈');return;
  }
  let category=major==='claw'?$('#clawDetail').value:$('#category').value;
  if(major==='claw'&&category==='＋ 自訂細項'){category=$('#customCategory').value.trim();if(!category){toast('請輸入細項類別名稱');return}if(!meta.customClaw.includes(category)){meta.customClaw.push(category);const option=document.createElement('option');option.value=category;option.textContent=category;$('#clawDetail').insertBefore(option,$('#clawDetail').lastElementChild)}$('#clawDetail').value=category}
  const stock=major==='stock',quantity=Number($('#quantity').value),price=Number($('#price').value),symbol=$('#symbol').value.trim().toUpperCase().replace(/\.(TW|TWO)$/,''),trade=stock&&['股票買進','股票賣出'].includes(category);
  if(trade&&(!/^\d{4,6}(\.TW(O)?)?$/.test(symbol)||quantity<=0||price<=0)){toast('請輸入有效台股代號、股數與成交單價');return}
  if(stock&&category==='股利'&&!/^\d{4,6}$/.test(symbol)){toast('請輸入這筆股利所屬的台股代號');return}
  if(stock&&category==='股票賣出'){const holding=portfolio().find(h=>h.symbol===symbol);if(!holding||holding.qty<quantity){toast('賣出股數超過目前持股');return}}
  const amount=trade?quantity*price:Number($('#amount').value);if(amount<=0){toast('請輸入大於 0 的金額');return}
  const commission=stock?Number($('#commission').value)||0:0,tax=stock?Number($('#tax').value)||0:0;
  const extra=trade?{symbol,quantity,price,commission,tax,currency:'TWD',manualPrice:Number($('#manualPrice').value)||undefined,quoteUpdatedAt:meta.quotes[symbol]?.updatedAt}:stock&&category==='股利'?{symbol,commission,tax,currency:'TWD'}:{};
  const entry=makeEntry(major,category,amount,extra);if(major==='daily'&&['薪資','副業收入','其他收入'].includes(category))entry.type='income';if(major==='claw')entry.type=category==='機台營收'?'income':'expense';if(stock)entry.type='investment';entries.push(entry);save();closeModal();render();toast('紀錄已儲存 ✳');
};
$('#fundActionBtn').onclick=openFundModal;
$('#setGoalBtn').onclick=()=>{const name=prompt('這趟旅程的目標名稱？',meta.trip.name||'日本旅行');if(name===null)return;const target=Number(prompt('旅遊基金目標金額（元）',meta.trip.target||''));if(target<=0)return;meta.trip={name:name.trim()||'夢想旅遊基金',target};save();render();toast('旅遊目標已更新 ✈')};
$('#addDetailBtn').onclick=()=>{const name=prompt('新增娃娃機細項類別名稱');if(!name?.trim())return;const detail=name.trim();if([...DEFAULTS.claw,...meta.customClaw].includes(detail)){toast('這個細項已經存在');return}meta.customClaw.push(detail);const option=document.createElement('option');option.value=detail;option.textContent=detail;$('#clawDetail').insertBefore(option,$('#clawDetail').lastElementChild);save();render();toast('已新增娃娃機細項')};
$('#filters').onclick=e=>{const button=e.target.closest('[data-filter]');if(!button)return;activeFilter=button.dataset.filter;showAll=false;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===button));render()};
$('#seeAll').onclick=()=>{showAll=!showAll;$('#seeAll').innerHTML=showAll?'收起 <span>↑</span>':'查看全部 <span>→</span>';render()};
$('#transactionList').onclick=e=>{if(e.target.closest('[data-empty-add]'))openModal();const button=e.target.closest('[data-delete]');if(button)deleteEntry(button.dataset.delete)};
$('#holdingsList').onclick=e=>{const deleteButton=e.target.closest('[data-delete]');if(deleteButton){deleteEntry(deleteButton.dataset.delete);return}const button=e.target.closest('[data-symbol]');if(button)lookupQuote(button.dataset.symbol)};
$('#refreshQuotes').onclick=async()=>{const symbols=[...new Set(portfolio().filter(h=>h.qty>0).map(h=>h.symbol))];if(!symbols.length){toast('尚無股票持倉');return}$('#quoteStatus').textContent='更新報價中…';for(const symbol of symbols)await lookupQuote(symbol);$('#quoteStatus').textContent='報價更新完成 · '+new Date().toLocaleString('zh-TW',{hour12:false})};
$('#exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({version:2,entries,meta},null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`好好理財備份-${todayISO()}.json`;link.click();URL.revokeObjectURL(link.href)};
$('#importFile').onchange=async e=>{try{const data=JSON.parse(await e.target.files[0].text());if(!Array.isArray(data.entries))throw Error();if(confirm(`備份中有 ${data.entries.length} 筆紀錄。匯入會取代目前資料，確定嗎？`)){entries=data.entries.map(migrateEntry);meta=data.meta||meta;save();render();toast('資料已成功還原')}}catch{toast('檔案格式不正確，無法匯入')}e.target.value=''};
$('#closeModal').onclick=closeModal;$('#modal').onclick=e=>{if(e.target===$('#modal'))closeModal()};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
render();



