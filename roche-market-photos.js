/* Roche 商城自动配图 v0.1.0
 * 自动搜索 Openverse 公开图片；不调用 Roche.ai、不读取 API 密钥。
 * 只替换商城占位图，不改商品数据库、购买和聊天逻辑。
 * 搜索词会发送到 api.openverse.org；结果为商品示意图，非实物保证。
 */
(() => {
  'use strict';
  window.RocheMarketPhotos?.destroy();
  const VERSION = '0.1.0', KEY = 'roche.marketPhotos.v1';
  const HOST = 'https://api.openverse.org/v1/images/';
  // Vetted category examples keep the starter experience usable; unfamiliar goods still use online search.
  const starter = {"durian ice cream":[{"url":"https://live.staticflickr.com/7520/15471240144_3a6d5e102a_z.jpg","fallback":"https://live.staticflickr.com/7520/15471240144_3a6d5e102a_z.jpg","title":"Durian Ice Cream","creator":"brownpau","source":"https://www.flickr.com/photos/44124483743@N01/15471240144","license":"by","licenseUrl":"https://creativecommons.org/licenses/by/2.0/","score":30}],"shampoo bottle":[{"url":"https://upload.wikimedia.org/wikipedia/commons/9/93/Head_%26_Shoulders_shampoo_bottle.jpg","fallback":"https://upload.wikimedia.org/wikipedia/commons/9/93/Head_%26_Shoulders_shampoo_bottle.jpg","title":"File:Head & Shoulders shampoo bottle.jpg（洗发水品类示意）","creator":"רנדום","source":"https://commons.wikimedia.org/w/index.php?curid=10119831","license":"by-sa","licenseUrl":"https://creativecommons.org/licenses/by-sa/3.0/","score":30}],"Bang Olufsen":[{"url":"https://cdn.dummyjson.com/product-images/mobile-accessories/amazon-echo-plus/thumbnail.webp","fallback":"https://cdn.dummyjson.com/product-images/mobile-accessories/amazon-echo-plus/thumbnail.webp","title":"Amazon Echo Plus（音箱品类示意，非 B&O 实物）","creator":"DummyJSON demo product catalog","source":"https://dummyjson.com/products/99","license":"","licenseUrl":"","score":30}]};
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { state = {}; }
  state.items = state.items && typeof state.items === 'object' ? state.items : {};
  state.queries = state.queries && typeof state.queries === 'object' ? state.queries : {};
  state.enabled = state.enabled !== false;
  if (state.revision !== 5) { state.items = {}; state.queries = {}; state.revision = 5; }
  let stopped = false, scheduled = false, busy = false, nextAt = 0, modal, panel;
  const records = new Set(), byImage = new WeakMap(), queue = new Map(), requests = new Set();
  const pendingQueries = new Map();
  let searchTail = Promise.resolve();
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const save = () => {
    for (const key of ['items', 'queries']) {
      const rows = Object.entries(state[key]);
      if (rows.length > 500) state[key] = Object.fromEntries(rows.sort((a,b) => (b[1].time || 0) - (a[1].time || 0)).slice(0, 400));
    }
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  };
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
  const button = (text, action, cls = '') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); action(); }); return b; };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const rules = [
    [/榴莲|durian/i, /冰|ice|gelato|sorbet/i, 'durian ice cream'],
    [/糯米|sticky rice/i, /芒果|mango/i, 'mango sticky rice'],
    [/提拉米苏|tiramisu/i, null, 'tiramisu'], [/冰淇淋|冰激凌|冰酪|gelato|ice cream/i, null, 'ice cream'],
    [/蛋糕|cake/i, null, 'cake dessert'], [/榴莲|durian/i, null, 'durian dessert'],
    [/甜品|甜点|dessert/i, null, 'dessert'], [/披萨|比萨|pizza/i, null, 'pizza'],
    [/汉堡|burger/i, null, 'hamburger'], [/寿司|sushi/i, null, 'sushi'],
    [/拉面|ramen/i, null, 'ramen'], [/牛排|steak/i, null, 'steak dish'],
    [/意面|意大利面|pasta/i, null, 'pasta dish'], [/沙拉|salad/i, null, 'salad'],
    [/炸鸡|fried chicken/i, null, 'fried chicken'], [/火锅|hot pot/i, null, 'hot pot food'],
    [/饺子|dumpling/i, null, 'dumplings'], [/咖啡|coffee/i, null, 'coffee cup'],
    [/奶茶|bubble tea/i, null, 'bubble tea'], [/巧克力|chocolate/i, null, 'chocolate'],
    [/三明治|sandwich/i, null, 'sandwich'], [/烤肉|烧烤|barbecue/i, null, 'barbecue food'],
    [/红酒|葡萄酒|wine/i, null, 'wine bottle'], [/香槟|champagne/i, null, 'champagne bottle'],
    [/洗发|shampoo/i, null, 'shampoo bottle'], [/沐浴|shower gel|body wash/i, null, 'shower gel bottle'],
    [/牙膏|toothpaste/i, null, 'toothpaste tube'], [/香水|perfume/i, null, 'perfume bottle'],
    [/护肤|精华|面霜|skincare/i, null, 'cosmetics skincare'], [/口红|lipstick/i, null, 'lipstick'],
    [/吹风机|hair dryer/i, null, 'hair dryer'], [/剃须|shaver|razor/i, null, 'electric shaver'],
    [/耳机|headphone|earbuds|airpods/i, null, 'headphones'], [/音响|音箱|扬声器|speaker/i, null, 'loudspeaker'],
    [/switch/i, /支架|stand/i, 'Nintendo Switch stand'], [/switch/i, null, 'Nintendo Switch console'],
    [/相机|camera/i, null, 'digital camera'], [/手机|iphone|smartphone/i, null, 'smartphone'],
    [/电脑|laptop|macbook/i, null, 'laptop'], [/键盘|keyboard/i, null, 'computer keyboard'],
    [/手表|watch/i, null, 'wristwatch'], [/项链|necklace/i, null, 'necklace jewelry'],
    [/戒指|ring/i, null, 'jewelry ring'], [/耳环|earring/i, null, 'earrings jewelry'],
    [/包包|手袋|handbag/i, null, 'handbag'], [/背包|backpack/i, null, 'backpack'],
    [/运动鞋|球鞋|sneakers/i, null, 'sneakers shoes'], [/鞋|shoes/i, null, 'shoes'],
    [/衬衫|shirt/i, null, 'shirt clothing'], [/外套|大衣|coat|jacket/i, null, 'coat fashion'],
    [/裙|dress/i, null, 'dress fashion'], [/毛衣|sweater/i, null, 'sweater'],
    [/裤|trousers|jeans/i, null, 'trousers'], [/雨伞|umbrella/i, null, 'umbrella'],
    [/花束|鲜花|bouquet/i, null, 'flower bouquet'], [/蜡烛|candle/i, null, 'candle'],
    [/玩偶|毛绒|plush/i, null, 'plush toy'], [/书籍|小说|图书|book/i, null, 'books'],
    [/眼镜|sunglasses/i, null, 'sunglasses'], [/家具|沙发|sofa/i, null, 'sofa furniture']
  ];
  function queriesFor(title) {
    if (/bang\s*(?:&|and)\s*olufsen|b&o/i.test(title) && /音响|音箱|speaker/i.test(title)) return ['Bang Olufsen','loudspeaker enclosure'];
    for (const [a,b,q] of rules) if (a.test(title) && (!b || b.test(title))) {
      // Category keywords are intentionally used: generated model numbers may not exist.
      return [q];
    }
    const clean = title.replace(/[\[\]{}<>"'|\\]/g, ' ').replace(/\b\d+(?:\.\d+)?\s*(?:ml|g|kg|cm|mm)\b/gi, '').replace(/旗舰版|豪华版|限定版|套装|精选|高端|正品/g, ' ').trim();
    return [normalize(clean).slice(0, 90)];
  }
  function photoUrl(item) {
    const url = safeUrl(item.url);
    // Flickr supplies a documented 640px size suffix; avoid decoding multi-megapixel originals.
    if (/^https:\/\/live\.staticflickr\.com\//.test(url) && /_[a-z]\.jpe?g$/i.test(url)) return url.replace(/_[a-z](\.jpe?g)$/i, '_z$1');
    const commons=url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/)([a-f0-9]\/[^/]+\/)([^/]+\.(?:jpg|jpeg|png|webp))$/i);
    if (commons) return commons[1]+'thumb/'+commons[2]+commons[3]+'/640px-'+commons[3];
    return safeUrl(item.thumbnail);
  }
  function rank(item, query) {
    const title = normalize(item.title).toLowerCase();
    const text = title + ' ' + (item.tags || []).map(t => t.name).join(' ').toLowerCase();
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    let score = tokens.reduce((s,t) => s + (title.includes(t) ? 5 : text.includes(t) ? 1 : -3), 0);
    if (title.replace(/[^a-z0-9]/g,'') === query.toLowerCase().replace(/[^a-z0-9]/g,'')) score += 2;
    if (/\b(stand|stall|shop|store|sign|advert|logo|poster|menu|museum|exhibition|people|driver|circuit|schematic|diagram|cap|lid|bottom|inside|internal|ginger)\b/.test(title) && !/\b(stand|poster|museum)\b/.test(query)) score -= 18;
    if (item.width && item.height) score -= Math.abs(Math.log(item.width / item.height));
    if (/bottle/.test(query) && item.height > item.width * 1.2) score += 9;
    if (/bottle/.test(query) && item.width > item.height * 1.1) score -= 6;
    return score;
  }
  async function search(query, source='wikimedia', useStarter=true) {
    if (!query) return [];
    const cacheKey=source+'|'+query;
    const cached = state.queries[cacheKey];
    if (cached && Date.now() - cached.time < (cached.results.length ? 30 * 864e5 : 864e5)) return cached.results;
    if (useStarter && starter[query]) return starter[query];
    if (pendingQueries.has(cacheKey)) return pendingQueries.get(cacheKey);
    const task = searchTail.catch(() => {}).then(async () => {
      if (Date.now() < nextAt) await wait(nextAt - Date.now());
      if (stopped || !state.enabled) return [];
      const day = new Date().toLocaleDateString('en-CA');
      if (state.day !== day) { state.day = day; state.requests = 0; }
      if ((state.requests || 0) >= 150) throw Error('今天已达到插件的搜图上限，明天继续；已有配图照常显示。');
      state.requests = (state.requests || 0) + 1; nextAt = Date.now() + 3500; save();
      const controller = new AbortController(); requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 18000);
      try {
        const u = new URL(HOST); u.search = new URLSearchParams({q:query,page_size:'12',mature:'false',format:'json'});
        if(source)u.searchParams.set('source',source);
        const response = await fetch(u.href, {signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
        if (response.status === 429) { nextAt = Date.now() + Math.max(60000, Math.min(3600000, Number(response.headers.get('Retry-After')) * 1000 || 60000)); throw Error('搜图服务暂时限流，稍后会继续；不会改用收费 API。'); }
        if (!response.ok) throw Error('搜图服务暂不可用（' + response.status + '）');
        const json = await response.json();
        const results = (json.results || []).filter(x => !x.mature && !(x.unstable__sensitivity || []).length && (!x.filesize || x.filesize<6000000) && (!x.width || !x.height || x.width*x.height<8000000) && !/\.(svg|png|gif|pdf)(?:\?|$)/i.test(x.url||'') && photoUrl(x) && x.license_url && x.foreign_landing_url && rank(x,query)>=2)
          .map(x => ({url:photoUrl(x),fallback:safeUrl(x.url),title:String(x.title || ''),creator:String(x.creator || ''),source:safeUrl(x.foreign_landing_url),license:String(x.license || ''),licenseUrl:safeUrl(x.license_url),score:rank(x,query)}))
          .sort((a,b) => b.score - a.score).slice(0, 8);
        state.queries[cacheKey] = {time:Date.now(),results}; save(); return results;
      } catch (error) {
        if (error.name === 'AbortError') throw Error('图片搜索超时；可稍后在配图面板里重试。');
        if (error instanceof TypeError) throw Error('连接不到图片搜索服务，请检查网络后重试。');
        throw error;
      } finally { clearTimeout(timeout); requests.delete(controller); }
    }).finally(() => pendingQueries.delete(cacheKey));
    searchTail = task.catch(() => {});
    pendingQueries.set(cacheKey,task); return task;
  }
  function placeholder(src) {
    if (!src.startsWith('data:image/svg+xml')) return false;
    try {
      const svg = src.includes(';base64,') ? atob(src.split(',')[1]) : decodeURIComponent(src.slice(src.indexOf(',') + 1));
      return svg.includes('MARKET #') || (svg.includes('#f1f5f9') && svg.includes('<path') && svg.includes('<text'));
    } catch { return false; }
  }
  const style = el('style'); style.id = 'rmp-styles';
  style.textContent = `
  .market-app .rmp-media{position:relative!important;isolation:isolate;background:#f3f4f5!important;overflow:hidden!important;border-radius:14px!important}
  .market-app .rmp-media.rmp-home{aspect-ratio:1!important}
  .market-app .rmp-media.rmp-eats{height:auto!important;aspect-ratio:16/10!important}
  .market-app .rmp-media.rmp-detail{aspect-ratio:1!important}
  .market-app .rmp-media img.rmp-photo{display:block!important;width:100%!important;height:100%!important;object-fit:cover!important;transform:none!important}
  .market-app .rmp-media.rmp-product img.rmp-photo{object-fit:contain!important;padding:8px!important;background:#fff!important;box-sizing:border-box!important}
  .market-app .rmp-media:not(.rmp-ready) img.rmp-photo{visibility:hidden!important}
  .market-app .rmp-media.rmp-ready:after{display:none}
  .market-app .rmp-media:not(.rmp-ready):after{content:attr(data-rmp-status);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:#8b9098;font:12px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;pointer-events:none;background:linear-gradient(140deg,#f5f5f7,#e9ecef);z-index:0}
  .rmp-credit{position:absolute!important;bottom:8px!important;left:8px!important;z-index:8!important;max-width:calc(100% - 18px);padding:4px 7px!important;border:0!important;border-radius:20px!important;background:rgba(255,255,255,.88)!important;color:#51545a!important;font:10px/1.2 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif!important;cursor:pointer;backdrop-filter:blur(8px)}
  .rmp-toolbar{position:fixed;right:14px;bottom:calc(86px + env(safe-area-inset-bottom));z-index:70;border:1px solid #e5e7eb!important;border-radius:22px!important;padding:9px 13px!important;background:#fffef5ee!important;color:#30343a!important;font:12px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif!important;box-shadow:0 3px 16px #0000000d}
  .rmp-shade{position:fixed;inset:0;z-index:2147483000;background:#0005;display:flex;align-items:flex-end;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#26282b}
  .rmp-sheet{box-sizing:border-box;background:#fff;border-radius:24px 24px 0 0;padding:22px 20px calc(24px + env(safe-area-inset-bottom));width:100%;max-width:540px;max-height:85dvh;overflow:auto;box-shadow:0 -10px 60px #0002}
  .rmp-sheet h2{font-size:18px;margin:0 38px 10px 0;font-weight:600}.rmp-sheet p{font-size:13px;line-height:1.65;color:#6b7280;margin:10px 0}
  .rmp-row{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:12px 0}.rmp-sheet button{font-family:inherit;font-size:13px;cursor:pointer}
  .rmp-action{background:#f2f3f5;border:0;border-radius:12px;padding:11px 13px;color:#34363a;margin:8px 0}.rmp-sheet input{box-sizing:border-box;width:100%;background:#f5f6f8;border:1px solid #e5e7eb;border-radius:12px;padding:12px;font-family:inherit;font-size:14px;color:#202124}
  .rmp-results{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:14px 0}.rmp-option{padding:0;border:0;background:#f4f5f6;border-radius:12px;overflow:hidden}.rmp-option img{width:100%;aspect-ratio:1;object-fit:cover;display:block}.rmp-option span{display:block;padding:7px;font-size:10px;line-height:1.4}
  .rmp-sheet a{color:#47566b;text-decoration:underline}.rmp-close{float:right;background:#f2f3f5;border:0;border-radius:50%;width:30px;height:30px;color:#555}
  `;
  document.head.append(style);
  function syncButton() {
    if(stopped){panel?.remove();panel=null;return;}
    const root = document.querySelector('.market-app');
    if (!root) { panel?.remove(); panel = null; return; }
    if (!panel) { panel = button('自动配图', () => openSettings(), 'rmp-toolbar'); root.append(panel); }
    panel.textContent = !state.enabled ? '配图已暂停' : busy ? '正在配图…' : '自动配图';
  }
  function setNote(rec, text) { if (rec.wrap.dataset.rmpStatus !== text) rec.wrap.dataset.rmpStatus = text; }
  function clearPhoto(rec) {
    rec.token = (rec.token || 0) + 1;
    rec.img.onload = rec.img.onerror = null;
    rec.wrap.classList.remove('rmp-ready');
    if (rec.img.getAttribute('src') !== rec.original) rec.img.setAttribute('src',rec.original);
  }
  function applyPhoto(rec, item) {
    if (stopped || !rec.img.isConnected) return;
    if(rec.failedUrl===item.url){setNote(rec,'图片暂时加载失败\n点“配图”更换');return;}
    const token = rec.token = (rec.token || 0) + 1;
    rec.img.onload = () => { if (!stopped && token === rec.token) {
      rec.wrap.classList.add('rmp-ready'); rec.credit.textContent = '示意图 · 配图';
      if(item.fallback && rec.img.getAttribute('src')===item.fallback && item.url!==item.fallback){item.url=item.fallback;save();}
    } };
    rec.img.onerror = () => {
      if (stopped || token !== rec.token) return;
      if (item.fallback && rec.img.getAttribute('src') !== item.fallback) { rec.img.src = item.fallback; return; }
      rec.failedUrl=item.url;clearPhoto(rec); setNote(rec,'图片暂时加载失败\n点“配图”更换'); rec.credit.textContent = '配图';
    };
    rec.img.referrerPolicy = 'no-referrer'; rec.img.decoding = 'async'; rec.img.loading = 'lazy';
    if (rec.img.getAttribute('src') !== item.url) rec.img.src = item.url;
    if (rec.img.complete && rec.img.naturalWidth) rec.img.onload();
  }
  function update(rec) {
    if (!rec.img.isConnected) return;
    const item = state.items[rec.key];
    if (item?.disabled) { clearPhoto(rec); setNote(rec,'已关闭这件商品的配图'); return; }
    if (item?.url) { applyPhoto(rec,item); return; }
    if (!state.enabled) { clearPhoto(rec); setNote(rec,'自动配图已暂停'); return; }
    if (item?.failed && Date.now() - item.time < 864e5) { setNote(rec,item.message || '暂未找到合适图片\n点“配图”重试'); return; }
    setNote(rec,'等待配图'); near.observe(rec.img);
  }
  function updateTitle(key) { for (const rec of records) if (rec.key === key) update(rec); }
  function discover() {
    scheduled = false; if (stopped) return;
    for (const rec of records) if (!rec.img.isConnected) { near.unobserve(rec.img); records.delete(rec); }
    syncButton();
    const root = document.querySelector('.market-app'); if (!root) return;
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      const existing = byImage.get(img);
      if (existing) {
        const saved=state.items[existing.key];
        if (!placeholder(src) && src!==saved?.url && src!==saved?.fallback) {
          near.unobserve(img);records.delete(existing);existing.token++;img.onload=img.onerror=null;
          existing.credit.remove();img.classList.remove('rmp-photo');existing.wrap.classList.remove('rmp-media','rmp-home','rmp-eats','rmp-detail','rmp-ready');byImage.delete(img);continue;
        }
        if (placeholder(src) && src !== existing.original) { near.unobserve(img); records.delete(existing); existing.credit.remove(); byImage.delete(img); }
        else { if (src === existing.original && state.items[existing.key]?.url) update(existing); continue; }
      }
      if (!placeholder(src) || img.classList.contains('object-contain')) continue;
      const wrap = img.parentElement;
      let card = wrap, heading;
      for (let i=0; i<4 && card && card!==root; i++,card=card.parentElement) {
        heading = card.querySelector('h3,h1'); if (heading) break;
      }
      if (!heading) continue;
      const title = normalize(heading.textContent); if (!title) continue;
      const rec = {img,wrap,card,title,key:title,original:src,originalAlt:img.getAttribute('alt'),token:0};
      rec.credit = button('配图', () => openItem(rec), 'rmp-credit');
      wrap.classList.add('rmp-media', heading.tagName==='H1' ? 'rmp-detail' : wrap.classList.contains('h-40') ? 'rmp-eats' : 'rmp-home');
      if(!/ice cream|dessert|sticky rice|cake|pizza|hamburger|sushi|ramen|steak|pasta|salad|chicken|hot pot|dumpling|coffee|tea|chocolate|sandwich|barbecue|wine|champagne/i.test(queriesFor(title)[0]))wrap.classList.add('rmp-product');
      img.classList.add('rmp-photo'); img.alt = title + '（商品示意图）';
      wrap.append(rec.credit); byImage.set(img,rec); records.add(rec); update(rec);
    }
  }
  function schedule() { if (!stopped && !scheduled) { scheduled = true; requestAnimationFrame(discover); } }
  const near = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const rec = byImage.get(entry.target); near.unobserve(entry.target);
      if (rec) { queue.set(rec.key,rec); pump(); }
    }
  },{rootMargin:'200px 0px'});
  async function pump() {
    if (busy || stopped || !state.enabled) return;
    busy = true; syncButton();
    try {
      while (queue.size && !stopped && state.enabled) {
        const [key,rec] = queue.entries().next().value; queue.delete(key);
        if (!rec.img.isConnected || state.items[key]?.url || state.items[key]?.disabled) continue;
        setNote(rec,'正在寻找相近图片…');
        try {
          let found = [];
          for (const q of queriesFor(rec.title)) { found = await search(q); if (found.length) break; }
          if(!found.length)found=await search(queriesFor(rec.title)[0],'');
          if (stopped) break;
          if (state.items[key]?.url || state.items[key]?.disabled) continue; // A manual choice wins over an older request.
          state.items[key] = found.length ? {...found[0],time:Date.now()} : {failed:true,time:Date.now(),message:'暂未找到相近图片\n点“配图”换个搜索词'};
        } catch (error) {
          if (stopped || !state.enabled) break;
          if (!state.items[key]?.url && !state.items[key]?.disabled) state.items[key] = {failed:true,time:Date.now(),message:error.message};
        }
        save(); updateTitle(key);
      }
    } finally { busy = false; syncButton(); }
  }
  function sheet(title) {
    modal?.remove(); modal = el('div','rmp-shade');
    const box = el('section','rmp-sheet'); box.setAttribute('role','dialog'); box.setAttribute('aria-modal','true'); box.setAttribute('aria-label',title);
    box.append(button('×',() => { modal?.remove(); modal=null; },'rmp-close'),el('h2','',title));
    modal.append(box); modal.addEventListener('click', e => { if (e.target===modal) { modal.remove(); modal=null; } });
    document.body.append(modal); return box;
  }
  function openSettings() {
    const box = sheet('商城自动配图 · 试用版');
    box.append(el('p','','根据商品名称自动搜索公开图片，不调用你的聊天或翻译模型 API。搜索词会发送至 Openverse；AI 虚构商品使用相近示意图。'));
    box.append(button(state.enabled?'暂停自动搜图':'开启自动搜图',() => {
      state.enabled=!state.enabled;save(); if(!state.enabled) { queue.clear();for(const c of requests)c.abort(); }
      else { for(const rec of records)update(rec);pump(); }
      openSettings();syncButton();
    },'rmp-action'));
    box.append(el('p','','已保存 '+Object.values(state.items).filter(x=>x.url).length+' 件商品的配图。只保存直链和来源，不把大图写进主题。'));
    box.append(button('重试当前页面配图失败的商品',() => {
      for(const rec of records)if(state.items[rec.key]?.failed||rec.failedUrl){rec.failedUrl='';if(state.items[rec.key]?.failed)delete state.items[rec.key];update(rec);}
      save();modal?.remove();modal=null;
    },'rmp-action'));
    box.append(el('p','','点商品图片左下角“配图”，可以查看来源、换图或重新搜索。商品生成仍使用 Roche 原来的 API 设置。'));
  }
  function openItem(rec) {
    const box = sheet(rec.title),current = state.items[rec.key];
    box.append(el('p','','图片仅供外观示意。可以直接用自动配图，也可以在这里选择另一张。'));
    if(current?.url) {
      const line=el('p'); line.append(document.createTextNode((current.title||'自定义图片')+(current.creator?' · '+current.creator:'')+' '));
      for(const [label,url]of [['图片来源',current.source],[current.license?.toUpperCase(),current.licenseUrl]])if(label&&safeUrl(url)){const a=el('a','',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';line.append(a,document.createTextNode(' '));}
      box.append(line);
    }
    const input=el('input');input.value=queriesFor(rec.title)[0];input.placeholder='换个搜索词';input.setAttribute('aria-label','图片搜索词');box.append(input);
    const result=el('div'),notice=el('p','','搜图服务有免费使用额度；失败不会改用付费模型。');
    const run=async()=>{
      const q=normalize(input.value).slice(0,90);if(!q)return;
      if(!state.enabled){notice.textContent='请先在自动配图面板开启搜图。';return;}
      result.replaceChildren();notice.textContent='正在搜索…';
      try{
        // User search shares the same global queue pacing; cached requests are free to reuse.
        const items=await search(q,'wikimedia',false);if(!box.isConnected)return;
        result.className='rmp-results';
        for(const item of items){const pick=button('',()=>{state.items[rec.key]={...item,time:Date.now()};save();updateTitle(rec.key);modal?.remove();modal=null;},'rmp-option');const image=el('img');image.src=item.url;image.loading='lazy';image.referrerPolicy='no-referrer';image.alt=item.title;pick.append(image,el('span','',item.title||'选择这张'));result.append(pick);}
        notice.textContent=items.length?'点图片即可更换，并固定保存。':'没有找到图片，可以换个更简单的品类词。';
      }catch(error){notice.textContent=error.message;}
    };
    box.append(button('搜索图片',run,'rmp-action'),notice,result);
    input.addEventListener('keydown',e=>{if(e.key==='Enter')run();});
    box.append(button(current?.disabled?'恢复自动配图':'这件商品不配图',()=>{
      if(current?.disabled)delete state.items[rec.key];else state.items[rec.key]={disabled:true,time:Date.now()};
      save();updateTitle(rec.key);modal?.remove();modal=null;
    },'rmp-action'));
  }
  const observer = new MutationObserver(mutations => {
    if (mutations.some(m => m.type==='attributes' || [...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1 && !(n.classList?.contains('rmp-credit') || n.classList?.contains('rmp-toolbar') || n.closest?.('.rmp-shade'))))) schedule();
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  const api = window.RocheMarketPhotos = {version:VERSION,destroy(){
    stopped=true;observer.disconnect();near.disconnect();queue.clear();for(const c of requests)c.abort();
    panel?.remove();modal?.remove();style.remove();
    for(const rec of records){rec.img.onload=rec.img.onerror=null;rec.img.src=rec.original;rec.img.classList.remove('rmp-photo');if(rec.originalAlt===null)rec.img.removeAttribute('alt');else rec.img.alt=rec.originalAlt;rec.wrap.classList.remove('rmp-media','rmp-home','rmp-eats','rmp-detail','rmp-ready','rmp-product');delete rec.wrap.dataset.rmpStatus;rec.credit.remove();}
    records.clear();
  }};
  try { window.RochePlugin?.register({id:'roche-market-photos',name:'商城自动配图 · 试用版',version:VERSION}); } catch(error) { console.warn('[Roche Market Photos] register',error); }
  discover();
})();
