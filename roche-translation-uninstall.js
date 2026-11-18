/* 我方翻译 · 一次性卸载清理 v1.0.0。只删除本翻译插件自有数据。 */
(() => {
  'use strict';
  const SELF = 'roche-translation-uninstall';
  if (document.getElementById(SELF)) return;
  window.RochePlugin?.register({id:SELF,name:'我方翻译 · 一次性卸载清理',version:'1.0.0'});
  const ids = new Set([SELF,'roche-same-round-translation','gphone-same-round-translation']);
  const storageOwned = key => /^roche\.(?:selfTranslate|sameRoundTranslation|translationBinding)(?:\.|$)/.test(key);
  function ownedPlugin(record) {
    if (ids.has(record?.id) || ids.has(record?.registeredId)) return true;
    try {
      const url = new URL(record.sourceUrl || record.entryUrl);
      const file = url.pathname.split('/').pop().toLowerCase();
      return (url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/nellie01/refimg.js/')) && ['roche-same-round-translation.js','gphone-same-round-translation.js','roche-translation-binding.js','roche-translation-uninstall.js'].includes(file);
    } catch { return false; }
  }
  function openDB() {
    return new Promise((resolve,reject)=>{
      let settled = false;
      const timer = setTimeout(()=>finish(Error('本机数据库读取超时。')),10000);
      const finish = (error,db) => { if (settled) { db?.close(); return; } settled=true;clearTimeout(timer);error?reject(error):resolve(db); };
      try {
        const request = indexedDB.open('Roche_db');
        request.onupgradeneeded = ()=>{request.transaction.abort();finish(Error('未找到原站数据库，没有创建或修改新数据库。'));};
        request.onerror = request.onblocked = ()=>finish(Error('数据库暂时不可用，请关闭其他同网址页面后重试。'));
        request.onsuccess = ()=>finish(null,request.result);
      } catch { finish(Error('无法读取本机数据库。')); }
    });
  }
  async function uninstall() {
    // Stop known runtimes before removing their data; no generic timer/network resets.
    for (const name of ['RocheTranslationBinding','RocheSameRoundTranslation','RocheSelfTranslate']) {
      const runtime = window[name];
      if (runtime && typeof runtime.destroy === 'function') runtime.destroy();
    }
    const db = await openDB();
    let plugins = 0, privateRows = 0;
    try {
      const stores = ['plugins','plugin_storage'].filter(name=>db.objectStoreNames.contains(name));
      if (!stores.length) throw Error('未找到插件安装表，未能确认卸载完成。');
      await new Promise((resolve,reject)=>{
        const tx = db.transaction(stores,'readwrite');
        tx.oncomplete = resolve; tx.onerror = tx.onabort = ()=>reject(Error('插件卸载未完成，请关闭其他页面后重试。'));
        const ownerIds = new Set(ids);
        const clearPrivate = ()=>{
          if (!stores.includes('plugin_storage')) return;
          const cursor = tx.objectStore('plugin_storage').openCursor();
          cursor.onsuccess = ()=>{const row=cursor.result;if (!row)return;if(ownerIds.has(row.value?.pluginId)){row.delete();privateRows++;}row.continue();};
        };
        if (stores.includes('plugins')) {
          const cursor = tx.objectStore('plugins').openCursor();
          cursor.onsuccess = ()=>{
            const row=cursor.result;
            if (!row) { clearPrivate();return; }
            if (ownedPlugin(row.value)) { ownerIds.add(row.value.id);if(row.value.registeredId)ownerIds.add(row.value.registeredId);row.delete();plugins++; }
            row.continue();
          };
        } else clearPrivate();
      });
    } finally { db.close(); }
    let localRows = 0;
    for (const storage of [localStorage,sessionStorage]) {
      const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(storageOwned(key))keys.push(key);}
      for (const key of keys) { storage.removeItem(key);localRows++; }
    }
    for (const selector of ['#roche-translation-binding','.rrt-native','.rrt-request-status','.rmt-output']) document.querySelectorAll(selector).forEach(el=>el.remove());
    await new Promise(resolve=>setTimeout(resolve,300));
    for (const storage of [localStorage,sessionStorage]) for(let i=0;i<storage.length;i++) if(storageOwned(storage.key(i))) throw Error('旧翻译记录又被写入：请关闭其他同网址页面后，再点清理。');
    const verify=await openDB();
    try {
      if(verify.objectStoreNames.contains('plugins'))await new Promise((resolve,reject)=>{
        const tx=verify.transaction('plugins','readonly'),request=tx.objectStore('plugins').getAll();let rows=[];
        request.onsuccess=()=>{rows=request.result;};
        tx.oncomplete=()=>rows.some(ownedPlugin)?reject(Error('安装项仍在被写入，请等待安装结束后重试清理。')):resolve();
        tx.onerror=tx.onabort=()=>reject(Error('尚未完成卸载核对，请重试。'));
      });
    }finally{verify.close();}
    return {plugins,privateRows,localRows};
  }
  const panel=document.createElement('section');panel.id=SELF;
  panel.style.cssText='position:fixed;inset:12% 6% auto;z-index:2147483647;background:white;color:#27272a;border:1px solid #ddd;border-radius:18px;padding:22px;font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 12px 48px #0004';
  const title=document.createElement('strong');title.textContent='彻底卸载我方翻译';
  const description=document.createElement('p');description.textContent='先关闭其他同网址页面。这里仅删除我方翻译的安装项、缓存译文、设置、旧密钥、待办和调用记录；保留聊天、角色、原站 API 预设、功能挂载及其他插件。这个清理入口也会一并卸载。';
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='不会请求任何模型，也不会清空网站数据。';
  const button=document.createElement('button');button.type='button';button.textContent='确认卸载并清除翻译记录';button.style.cssText='border:0;border-radius:12px;background:#18181b;color:white;padding:12px 16px;font:inherit';
  button.addEventListener('click',async()=>{
    button.disabled=true;status.textContent='正在停止旧脚本并清理…';
    try {
      const result=await uninstall();
      status.textContent='清理完成：卸载 '+result.plugins+' 个翻译安装项，删除 '+result.localRows+' 条本机记录和 '+result.privateRows+' 条插件私有数据。请刷新小手机页面，让安装列表更新；随后完全关闭小手机及同网址页面，再重新打开。';
      button.textContent='清理完成，请刷新页面';
    } catch (error) { status.textContent='尚未确认清理完成：'+error.message;button.disabled=false;button.textContent='重试清理'; }
  });
  panel.append(title,description,status,button);document.body.append(panel);
})();
