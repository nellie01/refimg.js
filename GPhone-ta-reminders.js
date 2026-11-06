/* GPhone · TA 手机提醒事项 v1.1.0 */
(() => {
  'use strict';
  if (!window.RochePlugin?.register) return;
  const id = 'gphone-ta-reminders';
  const storageKey = id + '.lists.v1';
  const listSelector = '[data-v-84b6dad5].w-full.h-full';
  const detailSelector = '[data-v-7ef33549].w-full.h-full';
  const types = [
    ['today', '今天', '#007aff', 'sun'],
    ['scheduled', '计划', '#e83745', 'calendar'],
    ['all', '全部', '#414148', 'list'],
    ['urgent', '紧急', '#ed276d', 'flag'],
    ['done', '完成', '#65747e', 'check']
  ];
  const lists = [
    ['work', '工作', '#5856d6', 'list'],
    ['shopping', '日常采购', '#168a46', 'bag'],
    ['life', '生活', '#ac5600', 'list'],
    ['inbox', '未分类', '#68717d', 'list']
  ];
  const paths = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1"/>',
    flag: '<path d="M5 22V3c5-4 9 4 14 0v12c-5 4-9-4-14 0"/>',
    check: '<path d="m5 12 5 5L19 7"/>',
    bag: '<rect x="4" y="8" width="16" height="13" rx="3"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/>'
  };
  window.GPhoneTAReminders?.stop();
  const nativeFetch = window.fetch;
  let intercepting = true;
  function remindersPrompt(prompt) {
    if (typeof prompt !== 'string' || !/^你正在模拟角色 "[^\n]+" 生成手机备忘录。/.test(prompt)
      || !prompt.includes('条**近期**的备忘录/待办事项。')
      || !prompt.includes('[[MEMO_START]]') || !prompt.includes('[[MEMO_END]]')) return prompt;
    const goal = prompt.lastIndexOf('\n【任务目标】\n');
    if (goal < 0) return prompt;
    return prompt.slice(0, goal) + `

【任务目标】
遵守上文指定的数量。每条只写一件实际可执行或已完成的提醒事项，按角色语言和人设写。标题用简短的行动句。长篇叙述、内心独白和日记体改为一两句必要的备注。不同的事分开写。
保留以下格式，Content 的第一行必须是机器可读的单行 JSON 标记。list 只能用 work（工作）、shopping（日常采购）、life（生活）、inbox（确实无法归类）。due 是任务到期日 YYYY-MM-DD，按角色时区计算，可为未来日期，无明确日期写空字符串。time 是明确时间 HH:MM，无则写空字符串。仅明确紧急才用 urgent:true，仅确定已完成才用 done:true。
Date 是记录日期，使用角色的今天或过去一周中的实际记录日期。不要把 Date 和 due 混用。

[[MEMO_START]]
Date: YYYY-MM-DD
Title: 简短的行动标题
Content:
@gphone-reminder {"list":"life","due":"","time":"","urgent":false,"done":false}
一两句必要备注，没备注可省略。仅有真正的子步骤时才用 - [ ] 或 - [x]。
[[MEMO_END]]

直接输出这些区块，不加代码围栏。`;
  }
  function fetchWithReminders(input, init) {
    if (intercepting && typeof init?.body === 'string' && init.body.includes('[[MEMO_START]]')) {
      try {
        const payload = JSON.parse(init.body);
        const proxied = payload.bodyEncoding === 'text' && typeof payload.url === 'string' && typeof payload.body === 'string';
        const body = proxied ? JSON.parse(payload.body) : payload;
        const slots = [
          [body, 'system'],
          ...(Array.isArray(body.messages) ? body.messages.filter(message => message?.role === 'system').map(message => [message, 'content']) : []),
          ...(Array.isArray(body.system_instruction?.parts) ? body.system_instruction.parts.map(part => [part, 'text']) : [])
        ];
        let changed = false;
        for (const [node, key] of slots) {
          const prompt = remindersPrompt(node?.[key]);
          if (prompt === node?.[key]) continue;
          node[key] = prompt;
          changed = true;
        }
        if (changed) init = { ...init, body: JSON.stringify(proxied ? { ...payload, body: JSON.stringify(body) } : body) };
      } catch {
        // Leave unrelated or unrecognized requests intact.
      }
    }
    return nativeFetch.call(this, input, init);
  }
  window.fetch = fetchWithReminders;
  const el = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  function button(label, className, action) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = action;
    return node;
  }
  function badge(color, icon) {
    const node = el('span', 'gpr-badge');
    node.style.background = color;
    node.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths[icon] + '</svg>';
    return node;
  }
  function localDate(date = new Date()) {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map((part, i) => String(part).padStart(i ? 2 : 4, '0')).join('-');
  }
  function readMeta() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }
  function writeMeta(recordId, next) {
    const saved = readMeta();
    Object.defineProperty(saved, recordId, { value: next, enumerable: true, configurable: true });
    localStorage.setItem(storageKey, JSON.stringify(saved));
  }
  const recordKey = (title, date, content) => JSON.stringify([title.trim(), date.trim(), content.trim()]);
  const validDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const date = new Date(value + 'T12:00:00');
    return localDate(date) === value ? value : '';
  };
  const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '';
  const plain = text => text.replace(/\*\*|__|`/g, '').trim();
  function inferList(text) {
    if (/\b(?:buy|buying|grocer\w*|supermarket|shopping|ordered|reorder|order confirmation|shopping list)\b|采购|购物|超市|下单|买(?:了|菜|药|花|牛奶|东西)/iu.test(text)) return 'shopping';
    if (/\b(?:office|meeting|rota|roster|deployment|workplace|colleague|briefing|deadline|report|shift)\b|工作|会议|同事|排班|纪要|项目|上班/iu.test(text)) return 'work';
    if (/\b(?:appointment|hair|haircut|shelf|home|valet|family|dinner|house|doctor|gym|laundry|dentist)\b|生活|家里|回家|聚餐|理发|染发|看病|取车|锻炼/iu.test(text)) return 'life';
    return 'inbox';
  }
  function inferDue(text, base) {
    const explicit = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    if (explicit) return validDate(explicit);
    const offset = /\bday after tomorrow\b|后天/iu.test(text) ? 2
      : /\btomorrow\b|明天/iu.test(text) ? 1 : /\btoday\b|今天|今晚/iu.test(text) ? 0 : null;
    if (offset === null || !validDate(base)) return '';
    const date = new Date(base + 'T12:00:00');
    date.setDate(date.getDate() + offset);
    return localDate(date);
  }
  function inferTime(text) {
    const clock = text.match(/(?:\b(?:at|before|by)\s+|[到前]\s*)([01]\d|2[0-3]):?([0-5]\d)\b/iu);
    return clock ? clock[1] + ':' + clock[2] : '';
  }
  function parseReminder(row) {
    let format = null;
    const steps = [];
    const notes = [];
    const lines = row.content.replace(/\r\n?/g, '\n').split('\n');
    const marker = lines[0]?.trim().match(/^@gphone-reminder\s+(\{.*\})$/i);
    if (marker) {
      try {
        const data = JSON.parse(marker[1]);
        if (lists.some(([key]) => key === data.list)) {
          format = { list: data.list, due: validDate(data.due), time: validTime(data.time), urgent: data.urgent === true, done: data.done === true };
          lines.shift();
        }
      } catch {}
    }
    for (const line of lines) {
      const check = line.match(/^\s*(?:[-*+]\s+)?\[([ xX~])\]\s+(.+)/);
      if (check) {
        if (check[1] !== '~') steps.push({ title: plain(check[2]), done: check[1].toLowerCase() === 'x' });
      } else {
        notes.push(line);
      }
    }
    return { format, steps: steps.filter(step => step.title), notes: notes.join('\n').trim() };
  }
  function reminderItems(row, recordId, metadata) {
    const saved = recordId && Object.hasOwn(metadata, recordId) ? metadata[recordId] || {} : {};
    const { format, steps, notes } = parseReminder(row);
    const children = !format && steps.length > 1;
    return (format || !steps.length ? [null] : steps).map((step, index) => {
      const originalTitle = plain(row.title);
      const vagueTitle = /^(?:owed|todo|to do|note|notes|content|tomorrow|today|提醒|待办|明天|今天)\s*[:：]?$/iu.test(originalTitle);
      const firstSentence = plain(notes).match(/^[^\n.!?。！？]+/)?.[0];
      const title = step?.title || (vagueTitle && !format && firstSentence?.length <= 100 ? firstSentence : originalTitle) || '提醒事项';
      const taskKey = children ? JSON.stringify([index, title]) : null;
      const task = taskKey ? saved.tasks?.[taskKey] : saved;
      const context = plain(row.title) + '\n' + notes;
      const list = inferList(title);
      const time = format ? format.time : inferTime(title);
      const meta = format || {
        list: list !== 'inbox' ? list : inferList(context),
        due: inferDue(title, row.date) || inferDue(context.slice(0, 220), row.date),
        time,
        urgent: /^(?:urgent\b|紧急)|\b(?:asap|urgent)\b|尽快/iu.test(title),
        done: step ? step.done : /(?:[—–-]\s*|\[)done\]?\s*$|[（(]已完成[）)]$/iu.test(title)
      };
      return { ...row, id: recordId, taskKey, title, notes,
        steps: format ? steps : [], meta: { ...meta, ...saved, ...task } };
    });
  }
  function saveItem(item, changes) {
    const saved = readMeta()[item.id] || {};
    const next = item.taskKey
      ? { ...saved, tasks: { ...saved.tasks, [item.taskKey]: { ...saved.tasks?.[item.taskKey], ...changes } } }
      : { ...saved, ...changes };
    writeMeta(item.id, next);
  }
  // Match the native rows to persistent IDs. An ambiguous match stays read-only.
  function matchRecords(rows) {
    if (!rows.length) return Promise.resolve(new Map());
    const wanted = new Set(rows.map(row => row.key));
    return new Promise(resolve => {
      const matches = new Map();
      const request = indexedDB.open('Roche_db');
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = request.onblocked = () => resolve(new Map());
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('memos', 'readonly');
          const cursor = tx.objectStore('memos').openCursor();
          tx.oncomplete = () => { db.close(); resolve(matches); };
          tx.onabort = () => { db.close(); resolve(new Map()); };
          cursor.onsuccess = () => {
            const item = cursor.result;
            if (!item) return;
            const { title, date, content } = item.value;
            if (typeof title === 'string' && typeof date === 'string' && typeof content === 'string') {
              const key = recordKey(title, date, content);
              if (wanted.has(key)) matches.set(key, matches.has(key) ? null : String(item.primaryKey));
            }
            item.continue();
          };
        } catch {
          db.close();
          resolve(new Map());
        }
      };
    });
  }
  const style = el('style');
  style.textContent = `
    [data-gpr-list]{background:#f2f2f7!important;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif!important}
    [data-gpr-list]>.sticky,[data-gpr-list]>.gpr-search{background:#f2f2f7!important}
    [data-gpr-list="category"],[data-gpr-list="category"]>.sticky,[data-gpr-list="category"]>.gpr-search{background:#fff!important}
    [data-gpr-list="reminder"],[data-gpr-list="reminder"]>.sticky{background:#fff!important}
    [data-gpr-list="reminder"]>.sticky,[data-gpr-list="reminder"]>.gpr-search{display:none!important}
    [data-gpr-list]>.sticky .tracking-widest{opacity:0}
    [data-gpr-list]>.sticky button,[data-gpr-detail]>.gpr-detail-bar button{border-radius:999px;background:#fff!important;color:#17171b!important;min-width:42px;min-height:40px}
    [data-gpr-list]>.sticky button .material-symbols-outlined{color:#17171b!important}
    [data-gpr-list] .gpr-search input{border:0!important;box-shadow:none!important;background:#e6e6ed!important;border-radius:12px!important;min-height:37px}
    [data-gpr-list] .gpr-native-group,[data-gpr-list] .gpr-native-empty,[data-gpr-list] .gpr-native-count{display:none!important}
    [data-gpr-list] .gpr-native-scroll{padding-bottom:max(24px,env(safe-area-inset-bottom))!important;min-height:0}
    .gpr-panel{color:#151519;padding:2px 0 16px;line-height:1.25}
    .gpr-panel button,.gpr-editor button{font-family:inherit;cursor:pointer;border:0}
    .gpr-panel button:focus-visible,.gpr-editor button:focus-visible{outline:2px solid #007aff;outline-offset:-3px}
    .gpr-title{font-size:34px;font-weight:750;letter-spacing:-.035em;line-height:1.13;margin:3px 0 17px}
    .gpr-back{padding:7px 12px;margin:4px 0 12px;border-radius:999px;background:#f2f2f7;color:#0068db;font-size:15px}
    .gpr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .gpr-tile{background:#fff;border-radius:16px;text-align:left;display:grid;grid-template-columns:1fr auto;gap:7px;align-items:center;padding:11px 13px;min-height:78px;color:#151519}
    .gpr-tile[aria-pressed=true],.gpr-category[aria-pressed=true]{background:#e8f3ff;box-shadow:inset 0 0 0 1px #007aff44}
    .gpr-tile:last-child{grid-column:span 2;min-height:54px;grid-template-columns:auto 1fr auto}
    .gpr-tile:last-child .gpr-count{grid-column:3;grid-row:1}
    .gpr-tile:last-child .gpr-tile-name{grid-column:2;grid-row:1}
    .gpr-count{font-size:23px;font-weight:720;line-height:1}
    .gpr-tile-name{font-size:15px;color:#48484c;font-weight:650}
    .gpr-badge{border-radius:50%;width:28px;height:28px;display:inline-grid;place-items:center;color:white;flex:none}
    .gpr-badge svg{width:16px;height:16px}
    .gpr-subtitle{margin:22px 0 8px;font-size:23px;font-weight:750;letter-spacing:-.025em}
    .gpr-box{border-radius:16px;background:#fff;overflow:hidden}
    .gpr-category{display:flex;gap:10px;align-items:center;width:100%;min-height:44px;padding:6px 12px;background:#fff;text-align:left;font-size:16px;color:#161617}
    .gpr-category+.gpr-category,.gpr-item+.gpr-item{border-top:1px solid #ececf0}
    .gpr-category-count{margin-left:auto;color:#63636d;font-size:14px}
    .gpr-caption{margin:0 0 8px;color:#666671;font-size:13px}
    .gpr-row-group{font-size:15px;font-weight:700;margin:14px 0 6px}
    .gpr-item{display:flex;align-items:flex-start;gap:5px;padding:2px 6px;min-width:0}
    .gpr-ring,.gpr-info{background:transparent;flex:none;width:34px;min-height:44px;color:#007aff;display:grid;place-items:center}
    .gpr-ring::before{content:"";width:19px;height:19px;border:2px solid #a4a4af;border-radius:50%;box-sizing:border-box}
    .gpr-ring[aria-pressed=true]::before{content:"✓";background:#007aff;border-color:#007aff;color:#fff;font-size:12px;line-height:15px}
    .gpr-ring:disabled,.gpr-info:disabled{opacity:.38;cursor:default}
    .gpr-info{font-size:20px}
    .gpr-open{padding:10px 0;text-align:left;background:transparent;min-width:0;flex:1;color:#18181c;overflow-wrap:anywhere}
    .gpr-item-title{font-size:16px;line-height:1.28;display:block}
    .gpr-item[data-done] .gpr-item-title{color:#676773;text-decoration:line-through}
    .gpr-item-meta{display:block;font-size:13px;margin-top:4px;color:#656570}
    .gpr-preview{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#62626d;font-size:13px;margin-top:4px;line-height:1.35}
    .gpr-empty{color:#666671;text-align:center;padding:34px 10px;font-size:15px}
    .gpr-overlay{position:absolute;inset:0;z-index:45;background:#0005;display:flex;align-items:flex-end}
    .gpr-editor{width:100%;box-sizing:border-box;max-height:90%;overflow:auto;background:#fff;border-radius:24px 24px 0 0;padding:20px 18px max(20px,env(safe-area-inset-bottom));font:16px/1.35 -apple-system,BlinkMacSystemFont,sans-serif;color:#17171b}
    .gpr-editor h2{margin:0 0 6px;font-size:24px}
    .gpr-editor p{margin:0 0 14px;font-size:14px;color:#656570;overflow-wrap:anywhere}
    .gpr-editor label{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:46px;border-bottom:1px solid #ededf0}
    .gpr-editor input,.gpr-editor select{max-width:60%;font:inherit;color:#19191d;accent-color:#007aff}
    .gpr-actions{display:flex;justify-content:space-between;margin-top:16px;gap:10px}
    .gpr-actions button{border-radius:999px;font-size:16px;padding:10px 18px;background:#eeeef4;color:#0068db}
    .gpr-actions button:last-child{background:#007aff;color:white}
    .gpr-reminder{padding-top:6px}
    .gpr-reminder-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:8px}
    .gpr-reminder-bar button,.gpr-original{padding:9px 13px;border-radius:999px;background:#f2f2f7;color:#0068db;font-size:15px}
    .gpr-reminder h1{margin-bottom:12px;overflow-wrap:anywhere}
    .gpr-reminder h2{font-size:16px;font-weight:650;margin:0 0 10px}
    .gpr-reminder .gpr-box{background:#f2f2f7;padding:13px 14px;margin:12px 0}
    .gpr-reminder p{font-size:15px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
    .gpr-reminder .gpr-item{align-items:center;padding-left:0}
    .gpr-reminder .gpr-item-title{padding:9px 0}
    .gpr-reminder .gpr-caption{margin-top:14px}
    .gpr-original{margin-top:14px}
    [data-gpr-detail]{background:white!important;color:#16161a!important}
    [data-gpr-detail] .gpr-detail-scroll{padding-inline:18px!important;padding-top:12px!important;min-width:0}
    [data-gpr-detail] .gpr-detail-date{text-align:left!important;margin-bottom:8px!important}
    [data-gpr-detail] .gpr-detail-title{font-size:clamp(24px,7vw,34px);letter-spacing:-.032em;line-height:1.16;color:#101014;margin:0 0 18px;overflow-wrap:anywhere}
    [data-gpr-detail] .gpr-title-input:disabled{display:none!important}
    [data-gpr-detail] .gpr-check-icon{font-size:0!important;display:inline-grid;place-items:center;width:20px;height:20px;flex:none;border:2px solid #a4a4af;border-radius:50%;box-sizing:border-box;margin:3px 5px 0 0}
    [data-gpr-detail] .gpr-check-icon[data-checked]{background:#007aff;border-color:#007aff;color:#fff}
    [data-gpr-detail] .gpr-check-icon[data-checked]::before{content:"✓";font:700 12px/1 system-ui}
  `;
  document.head.append(style);
  const state = new Map();
  let frame = null;
  function readRows(scroll) {
    const rows = [];
    for (const group of scroll.children) {
      if (!group.querySelector(':scope > h3')) continue;
      const found = [...group.querySelectorAll('.cursor-pointer')].flatMap(row => {
        const title = row.children[0]?.firstElementChild?.textContent;
        const date = row.children[1]?.children[0]?.textContent;
        const content = row.children[1]?.children[1]?.textContent;
        return title && date && typeof content === 'string'
          ? [{ row, title, date, content, key: recordKey(title, date, content) }] : [];
      });
      if (found.length) {
        group.classList.add('gpr-native-group');
        rows.push(...found);
      }
    }
    return rows;
  }
  function editor(root, item, meta, save) {
    root.querySelector('.gpr-overlay')?.remove();
    const overlay = el('div', 'gpr-overlay');
    const sheet = el('form', 'gpr-editor');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '事项设置');
    sheet.append(el('h2', '', '事项设置'), el('p', '', item.title));
    const list = el('select');
    for (const [value, label] of lists) {
      const option = el('option', '', label);
      option.value = value;
      list.append(option);
    }
    list.value = meta.list || 'inbox';
    const date = el('input');
    date.type = 'date';
    date.value = meta.due || '';
    const time = el('input');
    time.type = 'time';
    time.value = meta.time || '';
    const urgent = el('input');
    urgent.type = 'checkbox';
    urgent.checked = Boolean(meta.urgent);
    for (const [label, control] of [['清单', list], ['计划日期', date], ['计划时间', time], ['标为紧急', urgent]]) {
      const field = el('label', '', label);
      field.append(control);
      sheet.append(field);
    }
    const warning = el('p');
    warning.setAttribute('role', 'alert');
    const actions = el('div', 'gpr-actions');
    const close = () => overlay.remove();
    const submit = button('完成', '');
    submit.type = 'submit';
    actions.append(button('取消', '', close), submit);
    sheet.append(warning, actions);
    sheet.onsubmit = event => {
      event.preventDefault();
      try {
        saveItem(item, { list: list.value, due: date.value, time: date.value ? time.value : '', urgent: urgent.checked });
        close();
        save();
      } catch {
        warning.textContent = '本机存储不可用，设置未保存。';
      }
    };
    overlay.onclick = event => { if (event.target === overlay) close(); };
    overlay.onkeydown = event => { if (event.key === 'Escape') close(); };
    overlay.append(sheet);
    root.append(overlay);
    list.focus();
  }
  function toggleItem(item, changes, refresh) {
    try {
      saveItem(item, changes);
      refresh();
    } catch {
      window.alert('本机存储不可用，状态未保存。');
    }
  }
  function completionButton(done, recordId, action) {
    const toggle = button(undefined, 'gpr-ring', action);
    toggle.disabled = !recordId;
    toggle.setAttribute('aria-pressed', String(Boolean(done)));
    toggle.setAttribute('aria-label', done ? '恢复为待办' : '标为完成');
    return toggle;
  }
  function detail(view, item) {
    const { meta } = item;
    const refresh = () => render(view);
    const [, category, color] = lists.find(([key]) => key === meta.list) || lists.at(-1);
    const page = el('section', 'gpr-reminder');
    const toolbar = el('div', 'gpr-reminder-bar');
    const back = button('‹ ' + ([...types, ...lists].find(([key]) => key === view.filter)?.[1] || '提醒事项'), '', () => {
      view.detail = null;
      refresh();
      view.scroll.scrollTop = view.previousScroll || 0;
    });
    const settings = button('事项设置', '', () => editor(view.root, item, meta, refresh));
    settings.disabled = !item.id;
    toolbar.append(back, settings);
    const title = el('h1', 'gpr-title', item.title);
    title.style.color = color;
    page.append(toolbar, title, el('p', 'gpr-caption', [category, meta.urgent && '紧急'].filter(Boolean).join(' · ')));
    const todo = el('section', 'gpr-box');
    todo.append(el('h2', '', '待办事项'));
    const addLine = (label, done, action) => {
      const row = el('div', 'gpr-item');
      if (done) row.dataset.done = '';
      row.append(completionButton(done, item.id, action), el('span', 'gpr-item-title', label));
      todo.append(row);
    };
    addLine(meta.done ? '已完成' : '标为完成', meta.done, () => toggleItem(item, { done: !meta.done }, refresh));
    for (const [index, step] of item.steps.entries()) {
      const key = JSON.stringify([index, step.title]);
      const done = meta.steps?.[key] ?? step.done;
      addLine(step.title, done, () => toggleItem(item, { steps: { ...meta.steps, [key]: !done } }, refresh));
    }
    page.append(todo);
    const scheduleBox = el('section', 'gpr-box');
    scheduleBox.append(el('h2', '', '计划'), el('p', '', meta.due ? [meta.due, meta.time].filter(Boolean).join(' ') : '未设日期'));
    page.append(scheduleBox);
    if (item.notes) {
      const notes = el('section', 'gpr-box');
      notes.append(el('h2', '', '备注'), el('p', '', plain(item.notes).replace(/^>\s*/gm, '')));
      page.append(notes);
    }
    page.append(button('查看原备忘录', 'gpr-original', () => item.row.click()));
    view.root.dataset.gprList = 'reminder';
    view.panel.replaceChildren(page);
  }
  function render(view) {
    const { root, panel, rows, ids } = view;
    const metadata = readMeta();
    const items = rows.flatMap(row => reminderItems(row, ids.get(row.key), metadata));
    if (view.detail) {
      const item = items.find(item => item.key === view.detail.key && item.taskKey === view.detail.taskKey);
      if (item) {
        detail(view, item);
        return;
      }
      view.detail = null;
    }
    const today = localDate();
    function includes(item, filter) {
      const { done, due, urgent, list = 'inbox' } = item.meta;
      if (filter === 'all') return !done;
      if (filter === 'done') return Boolean(done);
      if (done) return false;
      if (filter === 'today') return due === today;
      if (filter === 'scheduled') return Boolean(due);
      if (filter === 'urgent') return Boolean(urgent);
      return list === filter;
    }
    const select = value => {
      view.filter = value;
      render(view);
      view.scroll.scrollTop = 0;
    };
    const heading = el('h1', 'gpr-title', '提醒事项');
    const grid = el('div', 'gpr-grid');
    for (const [key, label, color, icon] of types) {
      const tile = button(undefined, 'gpr-tile', () => select(key));
      tile.setAttribute('aria-pressed', String(view.filter === key));
      tile.append(badge(color, icon), el('strong', 'gpr-count', items.filter(item => includes(item, key)).length), el('span', 'gpr-tile-name', label));
      grid.append(tile);
    }
    const categories = el('div', 'gpr-box');
    for (const [key, label, color, icon] of lists) {
      const category = button(undefined, 'gpr-category', () => select(key));
      category.setAttribute('aria-pressed', String(view.filter === key));
      category.append(badge(color, icon), el('span', '', label), el('span', 'gpr-category-count', items.filter(item => includes(item, key)).length + ' ›'));
      categories.append(category);
    }
    const result = el('section');
    result.dataset.gprResults = '';
    const filter = view.filter || 'all';
    const [, label, color] = [...types, ...lists].find(([key]) => key === filter);
    const subheading = el('h1', 'gpr-title', label);
    subheading.style.color = color;
    result.append(subheading);
    const selected = items.filter(item => includes(item, filter));
    if (!selected.length) result.append(el('p', 'gpr-empty', view.pending ? '正在读取事项…' : '没有提醒事项'));
    const groups = new Map();
    for (const item of selected) {
      const group = filter === 'scheduled' ? item.meta.due : filter === 'all' ? item.meta.list || 'inbox' : '';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    const groupOrder = filter === 'scheduled' ? [...groups.keys()].sort() : filter === 'all' ? lists.map(([key]) => key).filter(key => groups.has(key)) : [...groups.keys()];
    for (const key of groupOrder) {
      const category = lists.find(([id]) => id === key);
      if (key) {
        const title = el('h3', 'gpr-row-group', category?.[1] || (key === today ? '今天' : key));
        title.style.color = category?.[2] || color;
        result.append(title);
      }
      const box = el('div', 'gpr-box');
      for (const item of groups.get(key)) {
        const row = el('div', 'gpr-item');
        if (item.meta.done) row.dataset.done = '';
        const toggle = completionButton(item.meta.done, item.id, () => toggleItem(item, { done: !item.meta.done }, () => render(view)));
        const open = button(undefined, 'gpr-open', () => {
          view.detail = { key: item.key, taskKey: item.taskKey };
          view.previousScroll = view.scroll.scrollTop;
          render(view);
          view.scroll.scrollTop = 0;
        });
        open.append(el('span', 'gpr-item-title', item.title));
        const summary = [item.meta.due && ['计划', item.meta.due, item.meta.time].filter(Boolean).join(' '), item.meta.urgent && '紧急'].filter(Boolean);
        if (summary.length) open.append(el('span', 'gpr-item-meta', summary.join(' · ')));
        if (item.notes) open.append(el('span', 'gpr-preview', plain(item.notes)));
        const info = button('ⓘ', 'gpr-info', () => editor(root, item, item.meta, () => render(view)));
        info.disabled = !item.id;
        info.setAttribute('aria-label', '设置清单、日期和紧急程度');
        row.append(toggle, open, info);
        box.append(row);
      }
      result.append(box);
    }
    root.dataset.gprList = view.filter ? 'category' : 'home';
    if (view.filter) {
      panel.replaceChildren(button('‹ 所有清单', 'gpr-back', () => select(null)), result);
    } else {
      panel.replaceChildren(heading, grid, el('h2', 'gpr-subtitle', '我的清单'), categories);
      if (root.querySelector('input[placeholder="搜索"]')?.value.trim()) panel.append(result);
    }
  }
  function updateList(root) {
    const scroll = [...root.children].find(node => node.classList.contains('overflow-y-auto'));
    const search = root.querySelector('input[placeholder="搜索"]');
    if (!scroll || !search) return;
    let view = state.get(root);
    if (!view || view.scroll !== scroll) {
      const panel = el('div', 'gpr-panel');
      root.dataset.gprList = '';
      search.parentElement?.parentElement?.classList.add('gpr-search');
      scroll.classList.add('gpr-native-scroll');
      for (const node of root.children) {
        if (node !== scroll && /^\s*\d+\s*个备忘录\s*$/.test(node.textContent)) node.classList.add('gpr-native-count');
      }
      scroll.prepend(panel);
      view = { root, scroll, panel, rows: [], ids: new Map(), filter: null, keys: null };
      state.set(root, view);
    }
    const rows = readRows(scroll);
    for (const node of scroll.children) {
      if (node.textContent.trim() === '无备忘录 (点击右上角刷新)') node.classList.add('gpr-native-empty');
    }
    const keys = JSON.stringify(rows.map(row => row.key));
    const searching = Boolean(search.value.trim());
    if (view.keys === keys && rows.every((item, i) => item.row === view.rows[i]?.row)) {
      if (view.searching !== searching) {
        view.searching = searching;
        render(view);
      }
      return;
    }
    view.searching = searching;
    view.keys = keys;
    view.rows = rows;
    view.ids = new Map();
    view.pending = rows.length > 0;
    render(view);
    matchRecords(rows).then(ids => {
      if (!root.isConnected || state.get(root) !== view || view.rows !== rows) return;
      view.ids = ids;
      view.pending = false;
      render(view);
    });
  }
  function updateDetail(root) {
    const input = root.querySelector('input[placeholder="标题"]');
    if (!input) return;
    root.dataset.gprDetail = '';
    root.firstElementChild?.classList.add('gpr-detail-bar');
    const scroll = input.parentElement;
    scroll.classList.add('gpr-detail-scroll');
    scroll.firstElementChild?.classList.add('gpr-detail-date');
    input.classList.add('gpr-title-input');
    let title = scroll.querySelector('.gpr-detail-title');
    if (!title) {
      title = el('h1', 'gpr-detail-title');
      input.before(title);
    }
    title.hidden = !input.disabled;
    if (title.textContent !== input.value) title.textContent = input.value;
    for (const icon of scroll.querySelectorAll('.material-symbols-outlined')) {
      const text = icon.textContent.trim();
      if (text !== 'check_box' && text !== 'check_box_outline_blank') continue;
      icon.classList.add('gpr-check-icon');
      icon.toggleAttribute('data-checked', text === 'check_box');
      icon.setAttribute('aria-label', text === 'check_box' ? '已完成' : '未完成');
      icon.setAttribute('role', 'img');
    }
  }
  function scan() {
    frame = null;
    for (const root of state.keys()) if (!root.isConnected) state.delete(root);
    document.querySelectorAll(listSelector).forEach(updateList);
    document.querySelectorAll(detailSelector).forEach(updateDetail);
  }
  function schedule() {
    if (frame === null) frame = requestAnimationFrame(scan);
  }
  function onSearch(event) {
    if (event.target.matches?.('input[placeholder="搜索"]') && event.target.closest(listSelector)) schedule();
  }
  document.addEventListener('input', onSearch);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  window.GPhoneTAReminders = {
    stop() {
      intercepting = false;
      observer.disconnect();
      document.removeEventListener('input', onSearch);
      if (window.fetch === fetchWithReminders) window.fetch = nativeFetch;
      if (frame !== null) cancelAnimationFrame(frame);
      style.remove();
      document.querySelectorAll('.gpr-panel,.gpr-detail-title,.gpr-overlay').forEach(node => node.remove());
      document.querySelectorAll('[data-gpr-list],[data-gpr-detail]').forEach(root => {
        delete root.dataset.gprList;
        delete root.dataset.gprDetail;
      });
      document.querySelectorAll('.gpr-check-icon').forEach(icon => {
        icon.removeAttribute('role');
        icon.removeAttribute('aria-label');
      });
      state.clear();
    }
  };
  window.RochePlugin.register({ id, name: 'TA 手机 · 提醒事项', version: '1.1.0', apps: [] });
  schedule();
})();
