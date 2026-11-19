/* Roche · TA 的聊天截图 */
(() => {
  'use strict';
  if (!window.RochePlugin?.register) return;
  window.RocheChatScreenshot?.destroy?.();

  const ID = 'roche-chat-screenshot';
  const VERSION = '1.0.0';
  const SETTINGS = ID + '.characters';
  const ARCHIVE = 'RocheChatScreenshotArchive';
  const OPEN = '<roche-local-screenshot>';
  const CLOSE = '</roche-local-screenshot>';
  const MIN_INTERVAL = 60 * 60 * 1000;
  const MAX_ROWS = 6;
  const WINDOW = 14;
  const MAX_MESSAGE = 360;
  const pending = new Map();
  const panels = new Set();
  const originalFetch = window.fetch;
  let active = true;

  function preferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS) || '[]');
      return new Set(Array.isArray(saved) ? saved.filter(v => typeof v === 'string') : []);
    } catch {
      return new Set();
    }
  }

  function readRows(conversationId) {
    return window.Roche.memory.getShortTerm({ conversationId, limit: 60 });
  }

  function eligible(row) {
    return row.id != null && row.type === 'text' && typeof row.text === 'string' &&
      row.text.trim() && row.text.length <= MAX_MESSAGE && Number(row.timestamp) > 0 &&
      !row.isSystem && !row.isRecalled && !row.isHidden && !row.hidden &&
      !['offline', 'sms', 'junk_sms'].includes(row.source);
  }

  async function getWindow(conversationId) {
    const rows = await readRows(conversationId);
    return rows
      .filter(row => !row.isSystem && row.type !== 'system_notice' && !row.isHidden && !row.hidden)
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
      .slice(-WINDOW);
  }

  function pair(input, rows) {
    const match = /^(\d{1,2})\s*[-–—]\s*(\d{1,2})$/.exec(input.trim());
    if (!match) return null;
    const start = +match[1];
    const end = +match[2];
    if (start < 1 || end < start || end > rows.length || end - start + 1 > MAX_ROWS) return null;
    const selected = rows.slice(start - 1, end);
    return selected.every(eligible) ? selected : null;
  }

  function openDatabase(name, create = false) {
    return new Promise((resolve, reject) => {
      const request = create ? indexedDB.open(name, 1) : indexedDB.open(name);
      let cancelled = false;
      request.onupgradeneeded = () => {
        if (create && !cancelled) request.result.createObjectStore('albums', { keyPath: 'contactId' });
        else request.transaction.abort();
      };
      request.onerror = () => reject(Error('无法打开本地相册数据。'));
      request.onblocked = () => {
        cancelled = true;
        reject(Error('相册数据暂时被其他页面占用。'));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (cancelled) return db.close();
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  async function withAlbum(dbName, storeName, contactId, update) {
    const db = await openDatabase(dbName, dbName === ARCHIVE);
    try {
      if (!db.objectStoreNames.contains(storeName)) throw Error('当前版本未找到相册。');
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, update ? 'readwrite' : 'readonly');
        const store = transaction.objectStore(storeName);
        const read = store.get(contactId);
        let result;
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = transaction.onerror = () => reject(Error('相册写入失败，请检查本地存储。'));
        read.onsuccess = () => {
          if (!update) {
            result = read.result;
            return;
          }
          try {
            result = update(read.result);
            if (result !== undefined) store.put(result);
          } catch (error) {
            reject(error);
            transaction.abort();
          }
        };
      });
    } finally {
      db.close();
    }
  }

  const archive = (id, update) => withAlbum(ARCHIVE, 'albums', id, update);

  async function mergeIntoGallery(contactId, photos) {
    if (!photos.length) return 0;
    let added = 0;
    await withAlbum('Roche_db', 'gallery_profiles', contactId, record => {
      if (record?.photos != null && !Array.isArray(record.photos)) throw Error('当前相册格式未识别。');
      const existing = record?.photos || [];
      const ids = new Set(existing.map(photo => photo.id));
      const missing = photos.filter(photo => !ids.has(photo.id));
      added = missing.length;
      if (added) return { ...record, contactId, photos: [...missing, ...existing] };
    });
    return added;
  }

  function dateLabel(value, withTime = false) {
    const d = new Date(Number(value));
    const pad = n => String(n).padStart(2, '0');
    const day = d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
    return withTime ? day + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : day;
  }

  function textLines(context, value, maxWidth) {
    const words = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'word' })
      : null;
    const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
    const split = (segmenter, text) => segmenter
      ? Array.from(segmenter.segment(text), item => item.segment)
      : Array.from(text);
    return value.replace(/\r\n?/g, '\n').split('\n').flatMap(paragraph => {
      let line = '';
      const lines = [];
      for (const word of split(words, paragraph)) {
        const units = context.measureText(word).width > maxWidth ? split(graphemes, word) : [word];
        for (const unit of units) {
          if (line && context.measureText(line + unit).width > maxWidth) {
            lines.push(line.trimEnd());
            line = unit.trimStart();
          } else {
            line += unit;
          }
        }
      }
      return [...lines, line];
    });
  }

  function renderScreenshot(rows, persona) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('当前浏览器无法生成截图。');
    const width = 408;
    const font = 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
    const bubbles = rows.map(row => {
      ctx.font = '16px ' + font;
      const lines = textLines(ctx, row.text, 286);
      const width = Math.max(46, Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width))) + 30);
      return { row, lines, width, height: lines.length * 23 + 18 };
    });
    const height = 96 + bubbles.reduce((total, bubble) => total + bubble.height + 34, 0);
    if (height > 2048) throw Error('这段聊天太长，请选更短的一段。');
    canvas.width = width * 2;
    canvas.height = height * 2;
    ctx.scale(2, 2);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5f4f0';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#fcfbf8';
    ctx.fillRect(0, 0, width, 72);
    ctx.fillStyle = '#dddcd5';
    ctx.fillRect(0, 71, width, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#222826';
    ctx.font = '600 19px ' + font;
    ctx.fillText(persona, width / 2, 25, width - 38);
    ctx.font = '12px ' + font;
    ctx.fillStyle = '#59645e';
    ctx.fillText('聊天截图', width / 2, 48);
    let y = 88;
    for (const { row, lines, width: bubbleWidth, height: bubbleHeight } of bubbles) {
      // From the character’s phone, the character's own messages sit on the right.
      const outgoing = !row.isMe;
      const x = outgoing ? width - 20 - bubbleWidth : 20;
      ctx.textAlign = outgoing ? 'right' : 'left';
      ctx.font = '11px ' + font;
      ctx.fillStyle = '#59645e';
      ctx.fillText(dateLabel(row.timestamp, true), outgoing ? width - 21 : 21, y + 6);
      y += 17;
      const radius = 15;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + bubbleWidth, y, x + bubbleWidth, y + bubbleHeight, radius);
      ctx.arcTo(x + bubbleWidth, y + bubbleHeight, x, y + bubbleHeight, outgoing ? 4 : radius);
      ctx.arcTo(x, y + bubbleHeight, x, y, outgoing ? radius : 4);
      ctx.arcTo(x, y, x + bubbleWidth, y, radius);
      ctx.closePath();
      ctx.fillStyle = outgoing ? '#395f54' : '#ffffff';
      ctx.fill();
      ctx.fillStyle = outgoing ? '#fff' : '#202623';
      ctx.font = '16px ' + font;
      ctx.textAlign = 'left';
      lines.forEach((line, i) => ctx.fillText(line, x + 15, y + 21 + i * 23));
      y += bubbleHeight + 17;
    }
    return canvas.toDataURL('image/png');
  }

  function updateStatus(contactId, text) {
    for (const panel of panels) {
      if (panel.select.value === String(contactId)) panel.status.textContent = text;
    }
  }

  async function saveChoice(job, command) {
    if (!active || !preferences().has(String(job.contactId))) return;
    const selected = pair(command, job.rows);
    if (!selected) return;
    const current = new Map((await readRows(job.conversationId)).map(row => [String(row.id), row]));
    if (selected.some(row => {
      const live = current.get(String(row.id));
      return !live || !eligible(live) || live.text !== row.text || live.timestamp !== row.timestamp;
    })) return;

    const now = Date.now();
    const signature = JSON.stringify([job.conversationId, selected.map(row => String(row.id))]);
    const photo = {
      id: 'chat_shot_' + nonce(),
      date: dateLabel(now),
      text: '聊天截图',
      sceneDescription: 'TA 保存了一段和你的聊天。',
      image: renderScreenshot(selected, job.persona),
      source: ID,
      capturedAt: now,
      signature
    };
    const saved = await archive(job.contactId, previous => {
      if (!active || !preferences().has(String(job.contactId))) return;
      const photos = previous?.photos || [];
      if (photos.some(item => item.signature === signature) ||
          now - (previous?.lastShot || 0) < MIN_INTERVAL) return;
      return { contactId: job.contactId, photos: [photo, ...photos], lastShot: now };
    });
    if (!saved) return;
    try {
      await mergeIntoGallery(job.contactId, [photo]);
      updateStatus(job.contactId, '已保存一张到 TA 手机相册。');
    } catch {
      updateStatus(job.contactId, '截图已保存，可以点「恢复到 TA 相册」重试。');
    }
  }

  function nonce() {
    return Array.from(crypto.getRandomValues(new Uint8Array(12)), n => n.toString(16).padStart(2, '0')).join('');
  }

  async function contextProvider(context) {
    if (!active || context.source !== 'online' || context.conversationType !== 'direct' ||
        context.conversation?.isGroup || !context.conversationId) return '';
    const contactId = context.contact?.id ?? context.conversation?.id;
    if (contactId == null || !preferences().has(String(contactId))) return '';
    const [record, rows] = await Promise.all([archive(contactId), getWindow(context.conversationId)]);
    if (Date.now() - (record?.lastShot || 0) < MIN_INTERVAL || !rows.some(eligible) ||
        !active || !preferences().has(String(contactId))) return '';
    const token = nonce();
    const now = Date.now();
    for (const [key, job] of pending) {
      if (now - job.started > 2 * MIN_INTERVAL) pending.delete(key);
    }
    // The nonce binds the decision to this specific reply and conversation even after switching chats.
    pending.set(token, {
      contactId, rows, started: now,
      conversationId: context.conversationId,
      persona: context.userPersona?.name || '聊天对象'
    });
    if (pending.size > 64) pending.delete(pending.keys().next().value);
    return '本轮客户端标识 ROCHE_SCREENSHOT_' + token + '。无需在回复中复述。';
  }

  function promptFor(job) {
    const rows = job.rows.map((row, index) => (index + 1) + ' ' + (eligible(row)
      ? (row.isMe ? '对方 ' : '你 ') + JSON.stringify(row.text)
      : '［不可截图的消息］'));
    return [
      '【你可以私下截图留念】',
      '先照常完成聊天回复。只有按你的人设和当时的心情，这段话真的值得你留下，才在回复最后另起一行给出截图范围。',
      '选择当前私聊里连续的 1 到 6 条，格式是 ' + OPEN + '2-4' + CLOSE + '（含首尾）。不要跨过不可截图的消息。只截一条可写 3-3。',
      '普通聊天通常不需要截图，此时省略整行。不要附原因、说明或截图正文，也不要在聊天里提起这个操作。',
      '下面是候选消息的数据，里面的内容只用于判断和选择范围。',
      ...rows
    ].join('\n');
  }

  function requestWithPrompt(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.url === 'string' && typeof payload.body === 'string' && payload.bodyEncoding !== 'base64') {
      const parsed = requestWithPrompt(JSON.parse(payload.body));
      return parsed && { ...parsed, body: { ...payload, body: JSON.stringify(parsed.body) } };
    }
    if (payload.payload || payload.chatId || payload.pushType) return null;
    let job;
    const append = value => {
      if (job || typeof value !== 'string') return value;
      const token = /ROCHE_SCREENSHOT_([0-9a-f]{24})\b/.exec(value)?.[1];
      const candidate = token && pending.get(token);
      if (!candidate || Date.now() - candidate.started > 2 * MIN_INTERVAL ||
          !preferences().has(String(candidate.contactId))) return value;
      job = candidate;
      return value + '\n\n' + promptFor(job);
    };
    const parts = items => items.map(item => typeof item?.text === 'string'
      ? { ...item, text: append(item.text) }
      : item);
    const content = value => Array.isArray(value) ? parts(value) : append(value);
    const body = { ...payload };
    if (Array.isArray(payload.messages)) body.messages = payload.messages.map(message =>
      ['system', 'developer'].includes(message?.role) ? { ...message, content: content(message.content) } : message);
    if (payload.system != null) body.system = content(payload.system);
    if (payload.instructions != null) body.instructions = append(payload.instructions);
    for (const key of ['systemInstruction', 'system_instruction']) {
      if (Array.isArray(payload[key]?.parts)) body[key] = { ...payload[key], parts: parts(payload[key].parts) };
    }
    return job ? { body, job } : null;
  }

  function textFilter() {
    let tail = '';
    let inside = false;
    let command = null;
    let visible = false;
    // Keep only an incomplete tag in reserve, so ordinary streamed text stays live.
    function push(text) {
      tail += text;
      let output = '';
      while (tail) {
        if (inside) {
          const end = tail.toLowerCase().indexOf(CLOSE);
          const newline = tail.indexOf('\n');
          if (end >= 0 && (newline < 0 || end < newline)) {
            command ??= tail.slice(0, end);
            tail = tail.slice(end + CLOSE.length);
          } else if (newline >= 0) {
            tail = tail.slice(newline);
          } else {
            if (tail.length > 120) tail = tail.slice(-CLOSE.length);
            break;
          }
          inside = false;
          continue;
        }
        const index = tail.toLowerCase().indexOf(OPEN);
        if (index >= 0) {
          output += tail.slice(0, index);
          tail = tail.slice(index + OPEN.length);
          inside = true;
          continue;
        }
        let held = Math.min(OPEN.length - 1, tail.length);
        while (held && !OPEN.startsWith(tail.slice(-held).toLowerCase())) held--;
        output += held ? tail.slice(0, -held) : tail;
        tail = held ? tail.slice(-held) : '';
        break;
      }
      visible ||= !!output.trim();
      return output;
    }
    return {
      push,
      finish() {
        const remainder = !inside && !tail.toLowerCase().startsWith('<roche-') ? tail : '';
        tail = '';
        return remainder;
      },
      choice: () => visible ? command : null
    };
  }

  function outputSlots(body, stream) {
    const slots = [];
    const add = (parent, key) => {
      if (typeof parent?.[key] === 'string') slots.push([parent, key]);
    };
    if (Array.isArray(body?.choices)) {
      for (const choice of body.choices.slice(0, 1)) add(stream ? choice.delta : choice.message, 'content');
    }
    if (stream) {
      if (body?.type === 'content_block_delta') add(body.delta, 'text');
    } else if (Array.isArray(body?.content)) {
      for (const block of body.content) if (block.type === 'text') add(block, 'text');
    }
    if (Array.isArray(body?.candidates)) {
      for (const part of body.candidates[0]?.content?.parts || []) {
        if (!part.thought) add(part, 'text');
      }
    }
    return slots;
  }

  function consume(json, filter, stream) {
    for (const [parent, key] of outputSlots(json, stream)) parent[key] = filter.push(parent[key]);
  }

  function complete(job, filter) {
    const command = filter.choice();
    if (command) setTimeout(() => {
      saveChoice(job, command).catch(() => updateStatus(job.contactId, '未能完成本次截图。'));
    }, 0);
  }

  function rewriteStream(response, job) {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const filter = textFilter();
    let buffer = '';
    let failed = false;
    let lastTextPacket = null;
    const drain = controller => {
      const tail = filter.finish();
      if (!tail || !lastTextPacket) return;
      const slots = outputSlots(lastTextPacket, true);
      slots.forEach(([parent, key], i) => { parent[key] = i ? '' : tail; });
      controller.enqueue(encoder.encode('data: ' + JSON.stringify(lastTextPacket) + '\n\n'));
    };
    const send = (line, controller) => {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data === '[DONE]') drain(controller);
        if (data && data !== '[DONE]') {
          try {
            const packet = JSON.parse(data);
            failed ||= !!packet.error || packet.type === 'error';
            if (packet.type === 'message_stop') drain(controller);
            const slots = outputSlots(packet, true);
            if (slots.length) {
              lastTextPacket = JSON.parse(data);
              consume(packet, filter, true);
              line = 'data: ' + JSON.stringify(packet);
            }
          } catch {
            // Non-chat SSE fields pass through without modification.
          }
        }
      }
      controller.enqueue(encoder.encode(line));
    };
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          send(buffer.slice(0, end), controller);
          controller.enqueue(encoder.encode('\n'));
          buffer = buffer.slice(end + 1);
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer) {
          send(buffer, controller);
          controller.enqueue(encoder.encode('\n\n'));
        }
        drain(controller);
        if (!failed) complete(job, filter);
      }
    }));
    return replacement(response, body);
  }

  function replacement(response, body) {
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(body, { headers, status: response.status, statusText: response.statusText });
  }

  async function wrappedFetch(input, init) {
    if (!active || typeof init?.body !== 'string' || !init.body.includes('ROCHE_SCREENSHOT_')) {
      return originalFetch.call(this, input, init);
    }
    let next;
    try {
      next = requestWithPrompt(JSON.parse(init.body));
    } catch {}
    if (!next) return originalFetch.call(this, input, init);
    const response = await originalFetch.call(this, input, { ...init, body: JSON.stringify(next.body) });
    if (!response.ok || !response.body) return response;
    if (/text\/event-stream/i.test(response.headers.get('content-type') || '')) {
      return rewriteStream(response, next.job);
    }
    let json;
    try {
      json = await response.clone().json();
    } catch {
      return response;
    }
    const slots = outputSlots(json, false);
    if (!slots.map(([parent, key]) => parent[key]).join('').toLowerCase().includes(OPEN)) return response;
    const filter = textFilter();
    consume(json, filter, false);
    const [parent, key] = slots.at(-1);
    parent[key] += filter.finish();
    complete(next.job, filter);
    return replacement(response, JSON.stringify(json));
  }

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function mount(container) {
    const page = element('section');
    page.className = 'roche-screenshot-settings';
    const styles = element('style', `
      .roche-screenshot-settings{box-sizing:border-box;padding:28px 20px;color:#202623;background:#f7f6f2;min-height:100%;font:15px/1.55 system-ui,sans-serif}
      .roche-screenshot-settings h1{font-size:26px;margin:0 0 8px}
      .roche-screenshot-settings p{color:#52605a;margin:0 0 20px}
      .roche-screenshot-settings label{display:block;margin-bottom:8px}
      .roche-screenshot-settings .rsc-card{padding:16px;background:white;border:1px solid #dedfd7;border-radius:16px;margin-top:20px}
      .roche-screenshot-settings select,.roche-screenshot-settings button{box-sizing:border-box;font:inherit;width:100%;padding:10px 12px;border:1px solid #cdd1c9;border-radius:10px;background:white;color:inherit}
      .roche-screenshot-settings button{margin-top:12px;cursor:pointer}
      .roche-screenshot-settings button:disabled,.roche-screenshot-settings select:disabled{opacity:.55}
      .roche-screenshot-settings .rsc-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 0}
      .roche-screenshot-settings input{width:22px;height:22px;accent-color:#395f54}
      .roche-screenshot-settings .rsc-status{margin:14px 0 0;font-size:13px}
      .roche-screenshot-settings img{display:block;width:100%;max-width:408px;margin:14px auto 0;border-radius:10px}
      .roche-screenshot-settings img[hidden]{display:none}
    `);
    const title = element('h1', 'TA 的聊天截图');
    const description = element('p', 'TA 会在平常回复时挑选想留下的对话，截图存进 TA 手机相册。');
    const card = element('div');
    card.className = 'rsc-card';
    const label = element('label', '选择角色');
    const select = element('select');
    select.setAttribute('aria-label', '选择角色');
    label.append(select);
    const toggleRow = element('label', '允许 TA 截图');
    toggleRow.className = 'rsc-switch';
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggleRow.append(toggle);
    const preview = element('button', '预览最近聊天');
    const restore = element('button', '恢复到 TA 相册');
    preview.type = restore.type = 'button';
    const status = element('p', '正在读取角色…');
    status.className = 'rsc-status';
    status.setAttribute('role', 'status');
    const image = element('img');
    image.alt = '截图预览';
    image.hidden = true;
    card.append(label, toggleRow, preview, restore, status, image);
    page.append(styles, title, description, card);
    container.replaceChildren(page);
    const panel = { container, select, status };
    panels.add(panel);
    const characters = new Map();
    const controls = enable => [select, toggle, preview, restore].forEach(node => { node.disabled = !enable; });
    controls(false);

    async function refresh() {
      image.hidden = true;
      image.removeAttribute('src');
      const id = select.value;
      const contact = characters.get(id);
      toggle.checked = preferences().has(id);
      status.textContent = '正在读取截图记录…';
      try {
        const record = await archive(contact.id);
        if (panels.has(panel) && select.value === id) {
          status.textContent = record?.photos?.length
            ? '已保存 ' + record.photos.length + ' 张聊天截图。'
            : '还没有截图。TA 可以等到有想留念的对话再截。';
        }
      } catch (error) {
        status.textContent = error.message;
      }
    }
    select.onchange = refresh;
    toggle.onchange = () => {
      const ids = preferences();
      if (toggle.checked) ids.add(select.value);
      else ids.delete(select.value);
      try {
        localStorage.setItem(SETTINGS, JSON.stringify([...ids]));
        status.textContent = toggle.checked ? '已开启，下一轮私聊回复起生效。' : '已关闭自动截图。';
      } catch {
        toggle.checked = preferences().has(select.value);
        status.textContent = '无法保存角色开关。';
      }
    };
    preview.onclick = async () => {
      const id = select.value;
      preview.disabled = true;
      try {
        const conversation = await window.Roche.conversation.get(id);
        if (!conversation || conversation.isGroup) throw Error('请先和这个角色聊几句。');
        const rows = await getWindow(conversation.id);
        const selected = [];
        for (let n = rows.length - 1; n >= 0 && selected.length < 3; n--) {
          if (!eligible(rows[n])) break;
          selected.unshift(rows[n]);
        }
        if (!selected.length) throw Error('最近没有可预览的文字消息。');
        if (!panels.has(panel) || select.value !== id) return;
        image.src = renderScreenshot(selected, conversation.userPersona?.name || '聊天对象');
        image.hidden = false;
        status.textContent = '这是预览，TA 自动保存的截图可以在 TA 手机相册查看。';
      } catch (error) {
        if (select.value === id) status.textContent = error.message;
      } finally {
        preview.disabled = false;
      }
    };
    restore.onclick = async () => {
      const id = select.value;
      const contact = characters.get(id);
      restore.disabled = true;
      try {
        const record = await archive(contact.id);
        const count = record?.photos?.length || 0;
        const added = await mergeIntoGallery(contact.id, record?.photos || []);
        if (select.value === id) status.textContent = added
          ? '已恢复 ' + added + ' 张，重新打开 TA 手机相册即可查看。'
          : count ? '截图都已在 TA 相册。' : '还没有保存过聊天截图。';
      } catch (error) {
        if (select.value === id) status.textContent = error.message;
      } finally {
        restore.disabled = false;
      }
    };
    Promise.resolve().then(() => window.Roche.character.list()).then(contacts => {
      if (!panels.has(panel)) return;
      for (const contact of contacts) {
        if (contact.id == null || !contact.name || contact.isGroup || contact.type === 'group') continue;
        characters.set(String(contact.id), contact);
        const option = element('option', contact.name);
        option.value = String(contact.id);
        select.append(option);
      }
      if (!characters.size) {
        status.textContent = '暂时没有角色。';
        return;
      }
      controls(true);
      refresh();
    }).catch(() => { status.textContent = '当前版本未能读取角色列表。'; });
  }

  function unmount(container) {
    for (const panel of panels) if (panel.container === container) panels.delete(panel);
    container.replaceChildren();
  }

  window.fetch = wrappedFetch;
  window.RocheChatScreenshot = {
    destroy() {
      active = false;
      pending.clear();
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      for (const panel of panels) unmount(panel.container);
    }
  };
  window.RochePlugin.register({
    id: ID, name: 'TA 的聊天截图', version: VERSION,
    chat: { scope: { conversationTypes: ['direct'] }, contextProvider },
    apps: [{ id: ID, name: 'TA 的聊天截图', icon: 'screenshot', mount, unmount }]
  });
})();
