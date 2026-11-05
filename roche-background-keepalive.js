/* Roche 后台保活 v0.1.0 (experimental)
 * User-started background audio with measured timer continuity.
 * No API requests, no notification scheduling, no claim of persistent iOS execution.
 */
(() => {
  'use strict';
  if (!window.RochePlugin?.register) return;
  window.RocheBackgroundKeepalive?.destroy?.();
  const VERSION = '0.1.0', KEY = 'roche.backgroundKeepalive.v1', STEP = 5000;
  const roots = new Set();
  let alive = true, intent = false, starting = false, player = null, source = '', timer = null;
  let lastTick = 0, session = null, hidden = null, history = [], interrupted = false;
  let message = '尚未开启。点击后会播放轻微的沙沙声。', lastSaved = 0;
  try {
    const old = JSON.parse(localStorage.getItem(KEY) || '{}');
    history = Array.isArray(old.history) ? old.history.slice(0, 8) : [];
    interrupted = !!old.running;
    if (interrupted) message = '上次没有正常停止，可能刷新了页面或被系统回收。请手动重新开启。';
  } catch {}
  const now = () => Date.now();
  const seconds = ms => Math.max(0, Math.round(ms / 1000));
  const duration = ms => seconds(ms) < 60 ? seconds(ms) + ' 秒' : Math.floor(seconds(ms) / 60) + ' 分 ' + seconds(ms) % 60 + ' 秒';
  const clock = ms => new Date(ms).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  function persist(force = false) {
    if (!force && now() - lastSaved < 15000) return;
    lastSaved = now();
    try { localStorage.setItem(KEY, JSON.stringify({running:intent, history:history.slice(0,8)})); } catch {}
  }
  function snapshot() {
    return {
      version:VERSION, experimental:true, requested:intent, starting,
      audio:!player ? 'stopped' : player.error ? 'error' : player.paused ? 'paused' : 'playing',
      visibility:document.visibilityState, message,
      session:session ? {...session} : null,
      currentBackground:hidden ? {...hidden, duration:Math.max(0, now() - hidden.start), maxGap:Math.max(hidden.maxGap, now() - lastTick)} : null,
      history:history.map(item => ({...item})), interrupted
    };
  }
  function sample(at, count) {
    if (!intent || !session) return;
    const gap = Math.max(0, at - lastTick);
    session.maxGap = Math.max(session.maxGap, gap);
    if (hidden) {
      hidden.maxGap = Math.max(hidden.maxGap, gap);
      if (count) hidden.samples++;
    }
    lastTick = at;
  }
  function finishHidden(at) {
    if (!hidden) return;
    sample(at, false);
    const item = {...hidden, end:at, duration:Math.max(0, at-hidden.start)};
    history.unshift(item);
    history = history.slice(0,8);
    hidden = null;
    persist(true);
  }
  function beat() {
    if (!intent || !alive) return;
    sample(now(), true);
    persist();
    if (document.visibilityState === 'visible') render();
  }
  function visibility() {
    if (!intent) return;
    const at = now();
    if (document.visibilityState === 'hidden' && !hidden) {
      sample(at, false);
      hidden = {start:at, samples:0, maxGap:0, pauses:0};
    } else if (document.visibilityState === 'visible' && hidden) finishHidden(at);
    persist(true);
    render();
  }
  // A short, deterministic, audible noise file. Generated on demand, never downloaded.
  // Real media playback is required for this experiment; this is not a silent oscillator.
  function noiseWav() {
    const rate = 16000, count = rate * 8;
    const data = new ArrayBuffer(44 + count * 2), view = new DataView(data);
    const word = (offset, value) => { for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
    word(0,'RIFF'); view.setUint32(4,data.byteLength-8,true); word(8,'WAVE'); word(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    word(36,'data'); view.setUint32(40,count*2,true);
    let random = 714159, filtered = 0;
    for (let i=0;i<count;i++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      filtered = filtered * 0.82 + ((random >>> 0) / 4294967296 * 2 - 1) * 0.18;
      const fade = Math.min(1,i/800,(count-1-i)/800);
      view.setInt16(44+i*2,Math.round(filtered*0.08*32767*fade),true);
    }
    return new Blob([data], {type:'audio/wav'});
  }
  function changed(event) {
    if (!intent || !alive) return;
    if (event.type === 'playing') message = '音频正在播放。后台任务是否连续运行，请看下方实测记录。';
    if (event.type === 'pause') {
      if (hidden) hidden.pauses++;
      message = '音频已暂停。回到这里，点击“继续播放”重新开启。';
    }
    if (event.type === 'error') message = '音频播放失败，代码 ' + (player?.error?.code || '未知') + '。请停止后重新开启。';
    persist(true); render();
  }
  async function start() {
    if (!alive || starting || intent && player && !player.paused && !player.error) return;
    starting = true;
    try {
      if (!player) {
        player = document.createElement('audio');
        player.loop = true; player.preload = 'auto'; player.setAttribute('playsinline','');
        player.setAttribute('aria-label','后台保活实验音频');
        player.style.display = 'none';
        source = URL.createObjectURL(noiseWav()); player.src = source;
        for (const type of ['playing','pause','error']) player.addEventListener(type,changed);
        document.body.append(player);
      }
      if (!intent) {
        intent = true; interrupted = false;
        session = {start:now(), maxGap:0}; lastTick = now();
        if (document.visibilityState === 'hidden') hidden = {start:now(),samples:0,maxGap:0,pauses:0};
        timer = setInterval(beat,STEP);
      }
      message = '正在启动音频…'; persist(true);
      // Called synchronously from the user's button, before any await can lose activation.
      const playback = player.play();
      render();
      await playback;
      if (alive && intent) message = player.paused ? '音频已暂停，请点击“继续播放”。' : '音频正在播放。现在可退到桌面或锁屏测试。';
    } catch (error) {
      if (alive && intent) {
        stop();
        message = error?.name === 'NotAllowedError' ? '系统没有允许播放。请在本页亲手点击开启，再退到后台。' : '未能启动音频（'+(error?.name || '播放错误')+'），尚未开始保活实验。';
      }
    } finally { starting = false; if (alive) render(); }
  }
  function stop() {
    if (hidden) finishHidden(now());
    intent = false;
    clearInterval(timer); timer = null;
    if (player) {
      for (const type of ['playing','pause','error']) player.removeEventListener(type,changed);
      player.pause(); player.removeAttribute('src'); player.load(); player.remove(); player = null;
    }
    if (source) URL.revokeObjectURL(source);
    source = ''; message = '已停止，音频和本插件的检查任务已释放。';
    persist(true); render();
  }
  const css = `
  [data-roche-keepalive]{box-sizing:border-box!important;max-width:540px;margin:18px auto;padding:18px;color:#171717;background:#f5f5f5;border:1px solid #e8e8e8;border-radius:24px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;text-align:left}
  [data-roche-keepalive] *{box-sizing:border-box!important}
  [data-roche-keepalive] [hidden]{display:none!important}
  [data-roche-keepalive] h3,[data-roche-keepalive] h4,[data-roche-keepalive] p{margin:0;font:inherit;color:inherit}
  [data-roche-keepalive] h3{font-size:21px;font-weight:650;line-height:1.4}
  [data-roche-keepalive] h4{font-size:14px;font-weight:600}
  [data-roche-keepalive] .bk-top{display:flex;gap:12px;align-items:center;margin:2px 0 18px}
  [data-roche-keepalive] .bk-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:15px;background:#111;color:#fff;flex:none}
  [data-roche-keepalive] .bk-icon svg{width:23px;height:23px}
  [data-roche-keepalive] .bk-sub{color:#888;font-size:11px;margin-top:2px}
  [data-roche-keepalive] .bk-card{padding:16px;background:#fff;border:1px solid #e9e9e9;border-radius:17px;margin-top:10px}
  [data-roche-keepalive] .bk-tag{display:inline-block;padding:3px 7px;border-radius:6px;background:#eee;color:#777;font-size:10px;white-space:nowrap}
  [data-roche-keepalive] .bk-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
  [data-roche-keepalive] .bk-hint{font-size:12px;line-height:1.7;color:#888;margin-top:8px;overflow-wrap:anywhere}
  [data-roche-keepalive] .bk-status{margin-top:12px;font-size:12px;line-height:1.7;color:#555;overflow-wrap:anywhere;min-height:40px}
  [data-roche-keepalive] .bk-actions{display:grid;grid-template-columns:1.6fr 1fr;gap:8px;margin-top:14px}
  [data-roche-keepalive] button{appearance:none!important;font:inherit!important;font-size:13px!important;line-height:1.5!important;padding:12px 8px!important;margin:0!important;min-width:0;border:1px solid #dedede!important;border-radius:11px!important;background:#fafafa!important;color:#222!important;text-transform:none;cursor:pointer;box-shadow:none!important}
  [data-roche-keepalive] button.bk-primary{background:#111!important;color:white!important;border-color:#111!important}
  [data-roche-keepalive] button:disabled{opacity:.4;cursor:default}
  [data-roche-keepalive] button:focus-visible,[data-roche-keepalive] summary:focus-visible{outline:2px solid #777;outline-offset:3px}
  [data-roche-keepalive] .bk-result{padding:12px 0;border-top:1px solid #eee;margin-top:12px}
  [data-roche-keepalive] .bk-result:first-child{border-top:0;margin-top:0}
  [data-roche-keepalive] .bk-result b{font-weight:550;font-size:12px}
  [data-roche-keepalive] .bk-result p{font-size:11px;color:#888;margin-top:5px;line-height:1.7}
  [data-roche-keepalive] details{font-size:12px;color:#888;padding:14px 3px 0}
  [data-roche-keepalive] summary{cursor:pointer;color:#666}
  [data-roche-keepalive] details p{margin-top:9px}
  [data-roche-keepalive] .bk-footer{color:#aaa;font-size:10px;text-align:center;padding-top:16px}
  @media(max-width:340px){[data-roche-keepalive]{padding:12px}[data-roche-keepalive] .bk-card{padding:13px}}
  `;
  function render() {
    const state = snapshot();
    for (const root of roots) {
      root.querySelector('[data-bk-status]').textContent = message;
      root.querySelector('[data-bk-audio]').textContent = state.audio === 'playing' ? '正在播放' : state.audio === 'paused' ? '已暂停' : state.audio === 'error' ? '播放失败' : '未开启';
      const startButton = root.querySelector('[data-bk-start]');
      startButton.textContent = starting ? '正在启动…' : state.audio === 'paused' ? '继续播放' : intent ? '音频已开启' : '开启音频保活';
      startButton.disabled = starting || intent && state.audio === 'playing';
      root.querySelector('[data-bk-stop]').disabled = !intent && !starting;
      const recent = root.querySelector('[data-bk-results]'); recent.replaceChildren();
      if (!history.length) { const p=document.createElement('p');p.className='bk-hint';p.textContent='开启后退到桌面或锁屏 2～5 分钟，再回来查看记录。测试本身不调用聊天 API。';recent.append(p); }
      for (const item of history) {
        const row=document.createElement('div');row.className='bk-result';
        const title=document.createElement('b');title.textContent=clock(item.start)+' · 后台 '+duration(item.duration);
        const numbers=document.createElement('p');numbers.textContent='后台本地检查 '+item.samples+' 次 · 最大检查间隔 '+duration(item.maxGap)+(item.pauses?' · 音频暂停 '+item.pauses+' 次':'');
        const result=document.createElement('p');
        result.textContent=item.duration < 60000 ? '时间较短，建议再测试 2～5 分钟。' : item.samples === 0 ? '这段后台期间，没有观察到本插件的定时检查。' : item.maxGap > STEP*4 ? '观察到了明显的检查间隔，后台运行未保持连续。' : '这段时间观察到了持续检查；仍不能保证之后不会被系统暂停。';
        row.append(title,numbers,result);recent.append(row);
      }
    }
  }
  function panel() {
    const root=document.createElement('section');root.dataset.rocheKeepalive='';
    root.innerHTML='<style>'+css+'</style><header class="bk-top"><div class="bk-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 13H3v6h4v-6H4Zm16 0h1v6h-4v-6h3ZM18 19a5 5 0 0 1-5 3h-2"/></svg></div><div><h3>后台保活</h3><p class="bk-sub">让网页尝试在后台继续运行</p></div></header>'+
      '<div class="bk-card"><div class="bk-row"><h4>音频保活</h4><span class="bk-tag">实验版 v'+VERSION+'</span></div><p class="bk-hint">手动开启后循环播放轻微沙沙声。请先调低手机音量，按舒适程度调整；可能影响其他音乐的播放。</p><p class="bk-status" data-bk-status role="status" aria-live="polite"></p><div class="bk-row"><span class="bk-sub">音频状态</span><span class="bk-tag" data-bk-audio></span></div><div class="bk-actions"><button type="button" class="bk-primary" data-bk-start>开启音频保活</button><button type="button" data-bk-stop disabled>停止</button></div></div>'+
      '<div class="bk-card"><h4>后台实测记录</h4><div data-bk-results></div><p class="bk-hint">记录的是网页定时任务实际执行情况。音频继续播放，不等于网页任务一定继续运行。</p></div>'+
      '<details><summary>使用说明</summary><p>开启后可回到 Roche 的其他页面，音频会继续。刷新、退出后需手动再次开启；没有自动播放。</p><p>保持自然主动原来的设置即可。本插件不修改主动消息的触发规则，不额外调用模型，不新建定时消息或云端任务。</p><p>iPhone 是否允许网页脚本继续运行受系统控制，这个实验不能保证长期保活。请分别测试退到桌面和锁屏；主动消息是否产生，还取决于原来的触发条件。</p><p>本地只保留最近 8 次后台时段的时间和计数，不读取聊天或 API 密钥。停止即释放本插件的音频和定时检查；卸载后请刷新页面。</p></details><p class="bk-footer">手动开启 · 随时停止 · 黑白界面</p>';
    root.querySelector('[data-bk-start]').onclick=start;
    root.querySelector('[data-bk-stop]').onclick=stop;
    roots.add(root);render();return root;
  }
  document.addEventListener('visibilitychange',visibility);
  function leaving() { persist(true); }
  function returning() { visibility(); }
  window.addEventListener('pagehide',leaving);
  window.addEventListener('pageshow',returning);
  window.RochePlugin.register({id:'roche-background-keepalive',name:'后台保活 · 实验版',version:VERSION,apps:[{
    id:'roche-background-keepalive-settings',name:'后台保活',icon:'headphones',
    mount(container){container.replaceChildren(panel());},
    unmount(container){for(const root of roots)if(container.contains(root))roots.delete(root);container.replaceChildren();}
  }]});
  window.RocheBackgroundKeepalive={start,stop,getStatus:snapshot,destroy(){
    stop();alive=false;
    document.removeEventListener('visibilitychange',visibility);
    window.removeEventListener('pagehide',leaving);window.removeEventListener('pageshow',returning);
    for(const root of roots)root.remove();roots.clear();
  }};
})();
