/* GPhone · 群聊全员头像 v1.1.0
   用本地消息的会话编号定位当前群，再读取成员头像；不分析正文、不改数据、不调用 AI。
   未发言的成员也会显示；头像多时横向滑动。 */
(() => {
  'use strict';
  window.GPhoneGroupMembers?.stop();
  const id = 'gphone-group-members';
  const views = new Map();
  const resolved = new WeakMap();
  const finding = new WeakSet();
  function anchors(root) {
    return [...root.querySelectorAll('.chat-scroll-area [id^="msg-"]')].slice(0, 3).map(node => node.id.slice(4));
  }
  function messageConversation(keys) {
    if (!keys.length || !window.indexedDB) return Promise.resolve('');
    return new Promise(resolve => {
      let settled = false, db;
      const finish = value => {
        if (settled) return;
        settled = true; clearTimeout(timer); db?.close(); resolve(value);
      };
      const timer = setTimeout(() => finish(''), 3000);
      let request;
      try { request = indexedDB.open('Roche_db'); } catch { finish(''); return; }
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = request.onblocked = () => finish('');
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        if (!db.objectStoreNames.contains('messages')) { finish(''); return; }
        try {
          const tx = db.transaction('messages', 'readonly');
          const ids = new Set();
          for (const key of keys) {
            const record = tx.objectStore('messages').get(key);
            record.onsuccess = () => {
              const value = record.result?.conversationId;
              if (value != null && String(value)) ids.add(String(value));
            };
          }
          tx.oncomplete = () => finish(ids.size === 1 ? [...ids][0] : '');
          tx.onabort = tx.onerror = () => finish('');
        } catch { finish(''); }
      };
    });
  }
  async function identify(root) {
    if (stopped || finding.has(root)) return;
    const keys = anchors(root);
    const fingerprint = JSON.stringify(keys);
    const title = root.querySelector('.chat-header-title')?.textContent.trim() || '';
    const speakers = [...root.querySelectorAll('.chat-message--received .chat-message-avatar[data-sender-id]')].map(el=>el.dataset.senderId).filter(Boolean);
    finding.add(root);
    try {
      const current = () => !stopped && root.isConnected && JSON.stringify(anchors(root)) === fingerprint;
      const exact = await messageConversation(keys);
      if (!current()) return;
      if (exact) {
        resolved.set(root,{id:exact,fingerprint});
        schedule();
        return;
      }
      // A freshly rendered message may not have been persisted yet. Only use
      // a unique title+roster match with native group-only sender labels.
      if (!title || !speakers.length || !root.querySelector('.chat-message-sender-name') || !window.Roche?.conversation?.list) return;
      const groups = await window.Roche.conversation.list({isGroup:true});
      const matches = groups.filter(group => [group.handle,group.name,group.title,group.displayName].includes(title)
        && speakers.every(id=>(group.members||[]).map(String).includes(String(id))));
      if (current() && root.querySelector('.chat-header-title')?.textContent.trim() === title && matches.length === 1) {
        resolved.set(root,{id:String(matches[0].id),title,speakers:JSON.stringify(speakers),fingerprint});
        schedule();
      }
    } catch(error) { console.warn('[GPhone group members] Roster lookup:',error?.message || error); }
    finally {finding.delete(root);}
  }
  let frame = null;
  let stopped = false;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    .chat-viewport-root[data-gg-members] .chat-header-profile {
      display:flex!important;flex-direction:column!important;align-items:center!important;
      min-width:0!important;gap:4px!important;
    }
    .chat-viewport-root[data-gg-members] .chat-header-profile>.chat-header-avatar {display:none!important}
    .chat-viewport-root[data-gg-members] .gg-member-strip {
      display:block;width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;
      padding:2px 0;box-sizing:border-box;scrollbar-width:none;
      touch-action:pan-x;overscroll-behavior-x:contain;
      -webkit-overflow-scrolling:touch;
    }
    .chat-viewport-root[data-gg-members] .gg-member-strip::-webkit-scrollbar {display:none}
    .chat-viewport-root[data-gg-members] .gg-member-list {
      display:flex;align-items:center;width:max-content;margin:0 auto;padding:0 2px;
      gap:0;min-height:38px;
    }
    .chat-viewport-root[data-gg-members] .gg-member {
      position:relative;display:grid;place-items:center;flex:0 0 36px;
      width:36px;height:36px;margin:0 0 0 -5px;
      border:2px solid var(--gg-avatar-bg,#d8d8de);border-radius:50%;
      box-sizing:border-box;overflow:hidden;
      background:var(--gg-avatar-bg,#d8d8de);color:var(--gg-ink,#333);
      font:500 13px/1 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;
    }
    .chat-viewport-root[data-gg-members] .gg-member:first-child {margin-left:0}
    .chat-viewport-root[data-gg-members] .gg-member img {
      position:absolute;inset:0;display:block;width:100%;height:100%;
      object-fit:cover;border-radius:inherit;
    }
  `;
  document.head.append(style);

  // Use the exact component ID where available, otherwise persistent message
  // metadata. A title+roster fallback must identify one group unambiguously.
  function chatId(root) {
    for (let vm = root.__vueParentComponent, depth = 0; vm && depth < 30; vm = vm.parent, depth++) {
      if ((vm.type?.__name === 'Chat' || vm.type?.name === 'Chat') && vm.props?.chatId != null) {
        return String(vm.props.chatId);
      }
    }
    const match=resolved.get(root);
    if (!match || match.fingerprint !== JSON.stringify(anchors(root))) return '';
    if (!Object.hasOwn(match,'title')) return match.id;
    const title=root.querySelector('.chat-header-title')?.textContent.trim() || '';
    const speakers=[...root.querySelectorAll('.chat-message--received .chat-message-avatar[data-sender-id]')].map(el=>el.dataset.senderId).filter(Boolean);
    return match && match.title===title && match.speakers===JSON.stringify(speakers) ? match.id : '';
  }
  function picture(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, location.href);
      return ['https:', 'http:', 'blob:'].includes(url.protocol)
        || (url.protocol === 'data:' && /^data:image\//i.test(value)) ? url.href : '';
    } catch { return ''; }
  }
  function initials(name) { return [...String(name || '?').trim()].slice(0, 1).join('').toUpperCase() || '?'; }
  function remove(view) {
    view.strip?.remove();
    view.root.removeAttribute('data-gg-members');
    view.signature = null;
    view.strip = null;
  }
  function draw(view, conversation, persona) {
    const profiles = new Map((conversation.memberProfiles || []).map(member => [String(member.id), member]));
    const people = [], seen = new Set();
    function add(member) {
      const key = String(member?.id || '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      people.push({ id:key, name:member.displayName || member.handle || member.name || '群成员', avatar:picture(member.avatar) });
    }
    for (const key of conversation.members || []) add(profiles.get(String(key)) || {id:String(key)});
    // The user persona may not be included in the native character member IDs.
    if (persona?.id) add(persona);
    if (!people.length) { remove(view); return; }
    const profile = view.root.querySelector('.chat-header-profile');
    if (!profile) return;
    const signature = JSON.stringify(people);
    if (signature === view.signature && view.strip?.isConnected && view.strip.parentElement === profile) return;
    const scroll = view.strip?.scrollLeft || 0;
    const strip = document.createElement('div');
    strip.className = 'gg-member-strip';
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', '群成员头像，可横向滑动');
    const list = document.createElement('div');
    list.className = 'gg-member-list';
    list.setAttribute('role', 'list');
    for (const person of people) {
      const cell = document.createElement('span');
      cell.className = 'gg-member';
      cell.dataset.memberId = person.id;
      cell.setAttribute('role', 'listitem');
      cell.setAttribute('aria-label', person.name);
      cell.title = person.name;
      cell.textContent = initials(person.name);
      if (person.avatar) {
        const image = document.createElement('img');
        image.alt = '';
        image.decoding = 'async';
        image.src = person.avatar;
        image.addEventListener('error', () => image.remove(), {once:true});
        cell.append(image);
      }
      list.append(cell);
    }
    strip.append(list);
    view.strip?.remove();
    profile.prepend(strip);
    strip.scrollLeft = scroll;
    view.root.dataset.ggMembers = 'ready';
    view.strip = strip;
    view.signature = signature;
  }
  async function load(view) {
    const api = window.Roche;
    if (view.loading || !api?.conversation?.get) return;
    view.loading = true;
    view.updated = Date.now();
    try {
      const conversation = await api.conversation.get(view.id);
      if (stopped || views.get(view.root) !== view || chatId(view.root) !== view.id || !view.root.isConnected) return;
      if (!conversation?.isGroup && conversation?.type !== 'group') { remove(view); return; }
      const persona = conversation.userPersona
        || await api.persona?.getUserPersonaForConversation?.(view.id);
      if (stopped || views.get(view.root) !== view || chatId(view.root) !== view.id || !view.root.isConnected) return;
      draw(view, conversation, persona);
    } catch (error) {
      // Keep the native group avatar when the host API is unavailable.
      if (!view.strip) view.root.removeAttribute('data-gg-members');
      console.warn('[GPhone group members] Could not read current roster:', error?.message || error);
    } finally { view.loading = false; }
  }
  function scan() {
    frame = null;
    if (stopped || document.visibilityState === 'hidden') return;
    for (const [root, view] of views) {
      if (!root.isConnected || chatId(root) !== view.id) { remove(view); views.delete(root); }
    }
    for (const root of document.querySelectorAll('.chat-viewport-root')) {
      const key = chatId(root);
      if (!key) { identify(root); continue; }
      let view = views.get(root);
      if (!view) { view = {root, id:key, updated:0, loading:false, signature:null, strip:null}; views.set(root, view); }
      if (Date.now() - view.updated >= 4000 || (view.strip && !view.strip.isConnected)) load(view);
    }
  }
  function schedule() { if (!stopped && frame === null) frame = requestAnimationFrame(scan); }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {childList:true, subtree:true});
  const timer = setInterval(schedule, 4000);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('focus', schedule);
  window.GPhoneGroupMembers = {
    version:'1.1.0',
    refresh() { for (const view of views.values()) view.updated = 0; schedule(); },
    stop() {
      stopped = true;
      observer.disconnect();clearInterval(timer);
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('focus', schedule);
      for (const view of views.values()) remove(view);
      views.clear();style.remove();
    }
  };
  window.RochePlugin?.register?.({id, name:'GPhone 群聊全员头像', version:'1.1.0', apps:[]});
  schedule();
})();
