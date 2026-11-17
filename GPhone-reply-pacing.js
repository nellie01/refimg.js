/* GPhone · 回复打字节奏 v1.0.2
   只在当前可见聊天中排列新回复的显示顺序，不修改消息或调用 AI。
   短句较快、长句较慢；原网页已等待的时间会计入停顿。
   仅有自然的回复间隔，不添加提示、按钮或额外气泡，保留原生输入状态。
   旧聊天/历史记录不重播，离开页面会释放待显示消息。
*/
(() => {
  'use strict';
  window.GPhoneReplyPacing?.stop();
  const id = 'gphone-reply-pacing';
  const contexts = new Map();
  const hidden = new Map();
  let stopped = false, scheduled = false;
  const now = () => Date.now();
  const settings = { minMs:850, maxMs:5500, latinMs:35, hanMs:85, baseMs:550, stableMs:300 };
  function sourceText(row) {
    const node = row.querySelector('.chat-bubble--text .message-text');
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('.translation-block,.translation-content,script,style').forEach(part => part.remove());
    return (copy.textContent || '').replace(/\s+/gu, ' ').trim();
  }
  function delayFor(text, random = Math.random()) {
    let duration = settings.baseMs;
    for (const character of [...String(text)]) {
      if (/\s/u.test(character)) continue;
      duration += /\p{Script=Han}/u.test(character) ? settings.hanMs
        : /[,.!?;，。！？；…]/u.test(character) ? 100 : settings.latinMs;
    }
    return Math.round(Math.min(settings.maxMs, Math.max(settings.minMs, duration * (.9 + .2 * random))));
  }
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    .chat-viewport-root [data-gprp-hidden] {display:none!important}
  `;
  document.head.append(style);

  function rows(root) {
    return [...root.querySelectorAll('.chat-scroll-area .chat-message-row')].flatMap(wrapper => {
      const message = wrapper.querySelector('[id^="msg-"]');
      const bubble = wrapper.querySelector('.chat-message[data-message-side],.chat-message--received,.chat-message--sent');
      if (!message || !bubble) return [];
      return [{ id:message.id, wrapper, side:bubble.dataset.messageSide || (bubble.classList.contains('chat-message--sent') ? 'sent' : 'received') }];
    });
  }
  function nativeTyping(root) { return Boolean(root.querySelector('.chat-scroll-area .typing-dot')); }
  function identity(root) { return (root.querySelector('.chat-header-title')?.textContent || '') + '\n' + (root.querySelector('.chat-header-avatar')?.getAttribute('style') || ''); }
  function nearBottom(view) { return view.scroll.scrollHeight - view.scroll.scrollTop - view.scroll.clientHeight < 90; }
  function reveal(item) {
    const original = hidden.get(item.wrapper);
    if (!original) return;
    item.wrapper.removeAttribute('data-gprp-hidden');
    if (original.aria === null) item.wrapper.removeAttribute('aria-hidden');
    else item.wrapper.setAttribute('aria-hidden', original.aria);
    if (!original.inert) item.wrapper.removeAttribute('inert');
    hidden.delete(item.wrapper);
  }
  function conceal(item) {
    if (!hidden.has(item.wrapper)) hidden.set(item.wrapper, {aria:item.wrapper.getAttribute('aria-hidden'), inert:item.wrapper.hasAttribute('inert')});
    item.wrapper.setAttribute('data-gprp-hidden', '');
    item.wrapper.setAttribute('aria-hidden', 'true');
    item.wrapper.setAttribute('inert', '');
  }
  function flush(view) {
    clearTimeout(view.timer); view.timer = null;
    for (const item of view.queue) reveal(item);
    view.queue.length = 0;
  }
  function arm(view) {
    flush(view);
    view.started = now(); view.lastShown = 0;
    view.liveUntil = now() + 180000;
  }
  function pump(view) {
    clearTimeout(view.timer); view.timer = null;
    if (stopped || !view.root.isConnected || document.visibilityState === 'hidden') {flush(view);return;}
    while(view.queue.length && !view.queue[0].wrapper.isConnected) {reveal(view.queue.shift());}
    const first=view.queue[0];
    if (!first) return;
    const text=sourceText(first.wrapper);
    if (text!==first.text) {first.text=text;first.stable=now();first.duration=null;}
    const stableWait = settings.stableMs - (now()-first.stable);
    if (stableWait>0) {view.timer=setTimeout(()=>pump(view),stableWait);return;}
    if (first.duration===null) first.duration=text ? delayFor(text) : 600;
    // Count model/native waiting time toward the first bubble, and count the
    // existing native inter-message pause toward every following bubble.
    const due=(view.lastShown || view.started || first.arrived)+first.duration;
    if (now()<due) {view.timer=setTimeout(()=>pump(view),due-now());return;}
    const follow=view.follow;
    reveal(first); view.queue.shift(); view.lastShown=now();
    if (follow) view.scroll.scrollTop=view.scroll.scrollHeight;
    if (view.queue.length) pump(view);
  }
  function close(view) {
    flush(view);clearTimeout(view.bootstrap);
    view.scroll.removeEventListener('scroll',view.onScroll);
    contexts.delete(view.root);
  }
  function create(root) {
    const scroll=root.querySelector('.chat-scroll-area');if(!scroll)return null;
    const view={root,scroll,seen:new Set(),previous:[],queue:[],timer:null,started:0,lastShown:0,liveUntil:0,readyAt:now()+800,nativeWas:nativeTyping(root),identity:identity(root),follow:true};
    view.onScroll=()=>{view.follow=nearBottom(view);};
    scroll.addEventListener('scroll',view.onScroll,{passive:true});
    view.bootstrap=setTimeout(schedule,810);
    contexts.set(root,view);return view;
  }
  function scanView(view) {
    const current=rows(view.root), ids=current.map(item=>item.id), typing=nativeTyping(view.root);
    const changedIdentity=identity(view.root)!==view.identity;
    const overlap=ids.some(key=>view.seen.has(key));
    const replaced=view.previous.length>0 && ids.length>0 && !overlap;
    if (changedIdentity || replaced || document.visibilityState==='hidden') {
      flush(view);view.seen=new Set(ids);view.previous=ids;view.identity=identity(view.root);
      view.started=0;view.lastShown=0;view.liveUntil=0;view.nativeWas=typing;return;
    }
    if (now()<view.readyAt) {current.forEach(item=>view.seen.add(item.id));view.previous=ids;view.nativeWas=typing;return;}
    if (typing && !view.nativeWas) {
      if (!view.queue.length) {view.started=now();view.lastShown=0;}
      view.liveUntil=now()+180000;
    }
    if (typing && view.liveUntil>now()) view.liveUntil=now()+180000;
    if (!typing && view.nativeWas && view.liveUntil>0) view.liveUntil=now()+15000;
    view.nativeWas=typing;
    let last=-1;
    for (let i=0;i<current.length;i++) if (view.seen.has(current[i].id)) last=i;
    for (let i=0;i<current.length;i++) {
      const item=current[i];if(view.seen.has(item.id))continue;
      view.seen.add(item.id);
      if(i<=last)continue; // Prepended history never enters the live queue.
      if(item.side==='sent') {arm(view);continue;}
      if(view.liveUntil<=now())continue;
      item.arrived=now();item.text=sourceText(item.wrapper);item.stable=now();item.duration=null;
      conceal(item);view.queue.push(item);
    }
    // If Vue replaces a queued row, keep its new DOM node concealed, without
    // replacing or moving Vue's message content itself.
    const byId=new Map(current.map(item=>[item.id,item]));
    for(const item of view.queue) {
      const next=byId.get(item.id);
      if(next && next.wrapper!==item.wrapper) {
        const original=hidden.get(item.wrapper);
        reveal(item);item.wrapper=next.wrapper;
        if(original)hidden.set(item.wrapper,original);
        conceal(item);
      }
    }
    view.previous=ids;
    pump(view);
  }
  function scan() {
    scheduled=false;if(stopped)return;
    for(const view of contexts.values()) if(!view.root.isConnected || view.root.querySelector('.chat-scroll-area')!==view.scroll)close(view);
    for(const root of document.querySelectorAll('.chat-viewport-root')) {
      const view=contexts.get(root)||create(root);if(view)scanView(view);
    }
  }
  function schedule() {if(!stopped&&!scheduled){scheduled=true;queueMicrotask(scan);}}
  function onAction(event) {
    const target=event.target;
    if (!(target instanceof Element))return;
    const root=target.closest('.chat-viewport-root'),view=root&&contexts.get(root);if(!view)return;
    const send=event.type==='click' && target.closest('.chat-input-send:not(:disabled)');
    const enter=event.type==='keydown' && event.key==='Enter' && !event.shiftKey && !event.isComposing && target.matches('.chat-input-textarea');
    if(send||enter)arm(view);
  }
  function onHidden() {
    if(document.visibilityState==='hidden')for(const view of contexts.values()){flush(view);view.liveUntil=0;view.started=0;}
    schedule();
  }
  function onPageHide() {for(const view of contexts.values()){flush(view);view.liveUntil=0;view.started=0;}}
  document.addEventListener('click',onAction,true);
  document.addEventListener('keydown',onAction,true);
  document.addEventListener('visibilitychange',onHidden);
  window.addEventListener('pagehide',onPageHide);
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  window.GPhoneReplyPacing={
    version:'1.0.2',
    delayFor,
    showNow(){for(const view of contexts.values()){flush(view);view.liveUntil=0;}},
    stop(){
      stopped=true;observer.disconnect();
      document.removeEventListener('click',onAction,true);
      document.removeEventListener('keydown',onAction,true);
      document.removeEventListener('visibilitychange',onHidden);
      window.removeEventListener('pagehide',onPageHide);
      for(const view of [...contexts.values()])close(view);
      for(const wrapper of [...hidden.keys()])reveal({wrapper});
      style.remove();
    }
  };
  window.RochePlugin?.register?.({id,name:'GPhone 回复打字节奏',version:'1.0.2',apps:[]});
  schedule();
})();
