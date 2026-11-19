/* Roche · TA 的聊天截图 */
(() => {
  'use strict';
  if (!window.RochePlugin?.register) return;
  window.RocheChatScreenshot?.destroy?.();

  const ID = 'roche-chat-screenshot';
  const VERSION = '1.1.0';
  const SETTINGS = ID + '.characters';
  const ACTIVITY = ID + '.activity';
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
  let roundStamp = 0;

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

  function timeLabel(value) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(Number(value));
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
    const messageFont = '500 17px ' + font;
    let previousDay;
    const bubbles = rows.map(row => {
      ctx.font = messageFont;
      const lines = textLines(ctx, row.text, 294);
      const width = Math.max(48, Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width))) + 28);
      const day = dateLabel(row.timestamp);
      const date = day === previousDay ? null : day;
      previousDay = day;
      return { row, lines, width, height: lines.length * 24 + 18, date };
    });
    const height = 98 + bubbles.reduce((total, bubble) =>
      total + bubble.height + 27 + (bubble.date ? 36 : 0), 0);
    if (height > 2048) throw Error('这段聊天太长，请选更短的一段。');
    canvas.width = width * 2;
    canvas.height = height * 2;
    ctx.scale(2, 2);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f4f7';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, 80);
    ctx.fillStyle = '#dce2ea';
    ctx.fillRect(0, 79, width, 1);

    const avatar = ctx.createLinearGradient(20, 18, 64, 62);
    avatar.addColorStop(0, '#d5e4fc');
    avatar.addColorStop(1, '#b7cce9');
    ctx.fillStyle = avatar;
    ctx.beginPath();
    ctx.arc(43, 40, 22, 0, Math.PI * 2);
    ctx.fill();
    const name = String(persona).trim() || '聊天对象';
    const initial = name.match(/[\p{L}\p{N}]/u)?.[0].toUpperCase() || '·';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#243c58';
    ctx.font = '600 18px ' + font;
    ctx.fillText(initial, 43, 41);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#192436';
    ctx.font = '600 19px ' + font;
    ctx.fillText(name, 77, 31, width - 98);
    ctx.font = '12px ' + font;
    ctx.fillStyle = '#536376';
    ctx.fillText('私聊截图', 77, 53);

    let y = 91;
    for (const { row, lines, width: bubbleWidth, height: bubbleHeight, date } of bubbles) {
      if (date) {
        ctx.textAlign = 'center';
        ctx.font = '500 11px ' + font;
        const labelWidth = Math.ceil(ctx.measureText(date).width);
        const lineWidth = (width - labelWidth) / 2 - 42;
        ctx.fillStyle = '#d4dce7';
        ctx.fillRect(22, y + 11, lineWidth, 1);
        ctx.fillRect(width - 22 - lineWidth, y + 11, lineWidth, 1);
        ctx.fillStyle = '#52647a';
        ctx.fillText(date, width / 2, y + 11);
        y += 36;
      }
      // From the character’s phone, the character's own messages sit on the right.
      const outgoing = !row.isMe;
      const x = outgoing ? width - 22 - bubbleWidth : 22;
      const radius = 18;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + bubbleWidth, y, x + bubbleWidth, y + bubbleHeight, radius);
      ctx.arcTo(x + bubbleWidth, y + bubbleHeight, x, y + bubbleHeight, outgoing ? 6 : radius);
      ctx.arcTo(x, y + bubbleHeight, x, y, outgoing ? radius : 6);
      ctx.arcTo(x, y, x + bubbleWidth, y, radius);
      ctx.closePath();
      ctx.fillStyle = outgoing ? '#dbe8fb' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = outgoing ? '#cfddf1' : '#e0e5ec';
      ctx.stroke();
      ctx.fillStyle = '#192436';
      ctx.font = messageFont;
      ctx.textAlign = 'left';
      lines.forEach((line, i) => ctx.fillText(line, x + 14, y + 21 + i * 24));
      ctx.textAlign = outgoing ? 'right' : 'left';
      ctx.fillStyle = '#536376';
      ctx.font = '11px ' + font;
      ctx.fillText(timeLabel(row.timestamp), outgoing ? width - 25 : 25, y + bubbleHeight + 11);
      y += bubbleHeight + 27;
    }
    return canvas.toDataURL('image/png');
  }

  function activityLog() {
    try {
      return Object.assign(Object.create(null), JSON.parse(localStorage.getItem(ACTIVITY) || '{}'));
    } catch {
      return Object.create(null);
    }
  }

  function formatActivity(record) {
    if (!record) return '还没有处理过开启后的私聊回复。';
    const waiting = record.readyAt > Date.now();
    const next = waiting ? '。' + dateLabel(record.readyAt, true) + ' 后的私聊回复可以再次判断' : '';
    return dateLabel(record.stamp, true) + ' · ' + record.text + next;
  }

  function updateActivity(job, text, readyAt = 0, saved = false) {
    const id = String(job.contactId);
    if (!active || !preferences().has(id)) return;
    const log = activityLog();
    const previous = log[id];
    if (previous?.stamp > job.stamp || (previous?.stamp === job.stamp && previous.saved)) return;
    const record = { stamp: job.stamp, text, readyAt, saved };
    log[id] = record;
    try { localStorage.setItem(ACTIVITY, JSON.stringify(log)); } catch {}
    for (const panel of panels) {
      if (panel.select.value === id) panel.activity.textContent = formatActivity(record);
    }
  }

  async function saveChoice(job, command) {
    if (!active || !preferences().has(String(job.contactId))) return;
    const selected = pair(command, job.rows);
    if (!selected) return updateActivity(job, 'TA 选中的范围无法截图');
    const current = new Map((await readRows(job.conversationId)).map(row => [String(row.id), row]));
    if (selected.some(row => {
      const live = current.get(String(row.id));
      return !live || !eligible(live) || live.text !== row.text || live.timestamp !== row.timestamp;
    })) return updateActivity(job, '选中的消息已更改或撤回');

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
    let skipped = '';
    let readyAt = 0;
    const saved = await archive(job.contactId, previous => {
      if (!active || !preferences().has(String(job.contactId))) return;
      const photos = previous?.photos || [];
      if (photos.some(item => item.signature === signature)) {
        skipped = '这段已经截过';
        return;
      }
      readyAt = (previous?.lastShot || 0) + MIN_INTERVAL;
      if (now < readyAt) {
        skipped = '刚存过截图，本轮跳过';
        return;
      }
      return { contactId: job.contactId, photos: [photo, ...photos], lastShot: now };
    });
    if (!saved) {
      if (skipped) updateActivity(job, skipped, readyAt);
      return;
    }
    try {
      await mergeIntoGallery(job.contactId, [photo]);
      updateActivity(job, '已存进 TA 手机相册', now + MIN_INTERVAL, true);
    } catch {
      updateActivity(job, '已在本地留存，点「恢复到 TA 相册」可补存', now + MIN_INTERVAL, true);
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
    const stamp = roundStamp = Math.max(Date.now(), roundStamp + 1);
    const job = { contactId, stamp };
    let record;
    let rows;
    try {
      [record, rows] = await Promise.all([archive(contactId), getWindow(context.conversationId)]);
    } catch {
      updateActivity(job, '无法读取本地聊天或截图记录');
      return '';
    }
    if (!active || !preferences().has(String(contactId))) return '';
    const readyAt = (record?.lastShot || 0) + MIN_INTERVAL;
    if (Date.now() < readyAt) {
      updateActivity(job, '刚存过截图，本轮跳过', readyAt);
      return '';
    }
    if (!rows.some(eligible)) {
      updateActivity(job, '最近没有可截图的文字消息');
      return '';
    }
    const token = nonce();
    const now = Date.now();
    for (const [key, job] of pending) {
      if (now - job.started > 2 * MIN_INTERVAL) pending.delete(key);
    }
    // The nonce binds the decision to this specific reply and conversation even after switching chats.
    pending.set(token, {
      contactId, rows, started: now, stamp,
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
      '和你们有关的承诺、意外共鸣、只属于你们的玩笑，或对方提到想留下这一刻，都可能值得截图，仍由你决定。',
      '选择当前私聊里连续的 1 到 6 条，格式是 ' + OPEN + '2-4' + CLOSE + '（含首尾）。不要跨过不可截图的消息。只截一条可写 3-3。',
      '普通聊天通常不需要截图，此时省略整行。不要附原因、说明或截图正文，也不需要单独发消息通知对方。',
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
      hasReply: () => visible,
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
    if (command !== null) {
      setTimeout(() => {
        saveChoice(job, command).catch(() => updateActivity(job, '未能完成本次截图'));
      }, 0);
    } else {
      updateActivity(job, filter.hasReply() ? '本轮没有选中要截图的内容' : '本轮未收到可判断的回复');
    }
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
        if (failed) updateActivity(job, '本轮接口异常，未完成截图判断');
        else complete(job, filter);
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
    let response;
    try {
      response = await originalFetch.call(this, input, { ...init, body: JSON.stringify(next.body) });
    } catch (error) {
      updateActivity(next.job, '本轮回复中断，未完成截图判断');
      throw error;
    }
    if (!response.ok || !response.body) {
      updateActivity(next.job, '本轮接口异常，未完成截图判断');
      return response;
    }
    if (/text\/event-stream/i.test(response.headers.get('content-type') || '')) {
      return rewriteStream(response, next.job);
    }
    let json;
    try {
      json = await response.clone().json();
    } catch {
      updateActivity(next.job, '本轮回复格式未识别');
      return response;
    }
    const slots = outputSlots(json, false);
    const text = slots.map(([parent, key]) => parent[key]).join('');
    if (!text.toLowerCase().includes(OPEN)) {
      updateActivity(next.job, text.trim() ? '本轮没有选中要截图的内容' : '本轮未收到可判断的回复');
      return response;
    }
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
      .roche-screenshot-settings{box-sizing:border-box;padding:24px clamp(14px,5vw,24px);color:#192436;background:#f2f4f7;min-height:100%;font:15px/1.5 system-ui,sans-serif}
      .roche-screenshot-settings>*:not(style){max-width:440px;margin-inline:auto}
      .roche-screenshot-settings h1{font-size:25px;margin-top:0;margin-bottom:6px;font-weight:700}
      .roche-screenshot-settings p{color:#536376;margin-top:0;margin-bottom:0;font-size:13px;overflow-wrap:anywhere}
      .roche-screenshot-settings .rsc-card{box-sizing:border-box;padding:16px;background:#fff;border:1px solid #dce2ea;border-radius:18px;margin-top:16px}
      .roche-screenshot-settings .rsc-role,.roche-screenshot-settings .rsc-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:600}
      .roche-screenshot-settings select,.roche-screenshot-settings button{box-sizing:border-box;font:inherit;min-height:44px;border:1px solid #d5dee9;border-radius:11px;background:#fff;color:inherit}
      .roche-screenshot-settings select{min-width:0;max-width:63%;padding:0 9px}
      .roche-screenshot-settings button{padding:6px 9px;cursor:pointer}
      .roche-screenshot-settings button:focus-visible,.roche-screenshot-settings input:focus-visible,.roche-screenshot-settings select:focus-visible{outline:2px solid #4e6e9b;outline-offset:3px}
      .roche-screenshot-settings button:disabled,.roche-screenshot-settings select:disabled{opacity:.55}
      .roche-screenshot-settings .rsc-switch{margin-top:12px;padding-top:12px;border-top:1px solid #e9edf2;min-height:44px;cursor:pointer}
      .roche-screenshot-settings input{appearance:none;box-sizing:border-box;width:44px;height:26px;border:1px solid #c7d0db;border-radius:20px;flex:0 0 auto;background:#e5e9ef;margin:0;position:relative;cursor:pointer}
      .roche-screenshot-settings input:before{content:'';position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:white;box-shadow:0 1px 3px #253b562e}
      .roche-screenshot-settings input:checked{background:#283c56;border-color:#283c56}
      .roche-screenshot-settings input:checked:before{left:21px}
      .roche-screenshot-settings h2{font-size:15px;margin:0 0 5px}
      .roche-screenshot-settings .rsc-activity{min-height:39px}
      .roche-screenshot-settings .rsc-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
      .roche-screenshot-settings .rsc-actions button{flex:1 1 120px;font-size:13px;font-weight:600}
      .roche-screenshot-settings .rsc-actions button:first-child{background:#e8eff9;border-color:#e0e8f4;color:#203854}
      .roche-screenshot-settings .rsc-status:not(:empty){margin-top:10px}
      .roche-screenshot-settings img{display:block;width:100%;max-width:408px;box-sizing:border-box;margin:14px auto 0;border:1px solid #dce2ea;border-radius:12px}
      .roche-screenshot-settings img[hidden]{display:none}
    `);
    const title = element('h1', 'TA 的聊天截图');
    const description = element('p', 'TA 在回复私聊时决定是否留下一段话。每个角色一小时最多保存一张。');
    const card = element('div');
    card.className = 'rsc-card';
    const label = element('label', '选择角色');
    label.className = 'rsc-role';
    const select = element('select');
    select.setAttribute('aria-label', '选择角色');
    label.append(select);
    const toggleRow = element('label', '允许 TA 截图');
    toggleRow.className = 'rsc-switch';
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggleRow.append(toggle);
    const activityCard = element('div');
    activityCard.className = 'rsc-card';
    const activityTitle = element('h2', '最近一轮');
    const activity = element('p', '正在读取角色…');
    activity.className = 'rsc-activity';
    activity.setAttribute('aria-live', 'polite');
    const actions = element('div');
    actions.className = 'rsc-actions';
    const preview = element('button', '预览最近聊天');
    const restore = element('button', '恢复到 TA 相册');
    preview.type = restore.type = 'button';
    const status = element('p');
    status.className = 'rsc-status';
    status.setAttribute('role', 'status');
    const image = element('img');
    image.alt = '截图预览';
    image.hidden = true;
    card.append(label, toggleRow);
    actions.append(preview, restore);
    activityCard.append(activityTitle, activity, actions, status, image);
    page.append(styles, title, description, card, activityCard);
    container.replaceChildren(page);
    const panel = { container, select, activity };
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
      activity.textContent = toggle.checked ? formatActivity(activityLog()[id]) : '此角色的自动截图已关闭。';
      status.textContent = '';
      try {
        const record = await archive(contact.id);
        if (panels.has(panel) && select.value === id) {
          status.textContent = record?.photos?.length
            ? '已留存 ' + record.photos.length + ' 张，可到 TA 手机相册查看。'
            : '';
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
        activity.textContent = toggle.checked ? formatActivity(activityLog()[select.value]) : '此角色的自动截图已关闭。';
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
        activity.textContent = '暂时没有角色。';
        return;
      }
      controls(true);
      refresh();
    }).catch(() => { activity.textContent = '当前版本未能读取角色列表。'; });
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
