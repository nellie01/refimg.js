/* Roche 自然主动 v1.0.0
 * Enhance browser Director DMs. Adaptive mode invokes the native generator;
 * planning and message generation share one request, without a separate planning call.
 * Native apps and already scheduled server jobs cannot be intercepted by this browser plugin.
 */
(() => {
 'use strict';
 window.RocheNaturalInitiative?.destroy?.();
 const KEY='roche.naturalInitiative.v1', VERSION='1.0.0', original=window.fetch;
 if(typeof original!=='function'||!window.RochePlugin?.register)return;
 const defaults={enabled:true,min:25,max:110,unanswered:2,quiet:false,periods:[{start:'01:00',end:'07:00'}],realistic:false,sharing:true};
 let saved;try{saved=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{saved={};}
 const cfg={...defaults,...saved.config}, records=saved.records||{};
 let active=true, observer, queued=false, last='已就绪，等待原系统下一次后台私聊检查。', matched=0, bridge=null, bridgeAttempted=false, ticking=false;
 const panels=new Set(), pending=new Set();
 const bound=(v,a,b,f)=>Number.isFinite(Number(v))?Math.max(a,Math.min(b,Math.round(Number(v)))):f;
 const minute=s=>/^\d{2}:\d{2}$/.test(s)&&Number(s.slice(0,2))<24&&Number(s.slice(3))<60?Number(s.slice(0,2))*60+Number(s.slice(3)):null;
 function normalize(){cfg.min=bound(cfg.min,5,720,25);cfg.max=bound(cfg.max,cfg.min,1440,110);cfg.unanswered=bound(cfg.unanswered,1,5,2);cfg.periods=(Array.isArray(cfg.periods)?cfg.periods:defaults.periods).filter(p=>minute(p?.start)!==null&&minute(p?.end)!==null).slice(0,12);}
 normalize();
 function save(){const keys=Object.keys(records).sort((a,b)=>(records[b].seen||0)-(records[a].seen||0));for(const k of keys.slice(100))delete records[k];try{localStorage.setItem(KEY,JSON.stringify({config:cfg,records}));}catch{last='浏览器未能保存插件设置。';}}
 const hash=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);};
 const norm=s=>String(s).replace(/『翻译：[\s\S]*?』/g,'').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
 function textOf(v){if(typeof v==='string')return v;if(Array.isArray(v))return v.map(x=>x?.text||'').join('\n');return v?.parts?textOf(v.parts):'';}
 function systemText(p){return [textOf(p.system),textOf(p.systemInstruction),textOf(p.system_instruction),textOf(p.instructions),...(p.messages||[]).filter(m=>m.role==='system'||m.role==='developer').map(m=>textOf(m.content))].join('\n');}
 function identify(p){
  const text=systemText(p);
  // Two independent native markers. Ordinary chats, feed posts, group chats and images are untouched.
  if(!text.includes('【本轮模式：私聊】')||!text.includes('【近期聊天记忆 (Short Term Memory)】')||!text.includes('本轮私聊')&&!text.includes('本轮目标】延续当前私聊语境'))return null;
  const char=text.match(/【当前角色 \(You\)】\s*名字\(Name\):\s*([^\n]+)/)?.[1]?.trim();
  const me=text.match(/【你的聊天对象 \(Me\)】\s*名字\(Name\):\s*([^\n]+)/)?.[1]?.trim();
  const handle=text.match(/账号\(Handle\):\s*([^\n]+)/)?.[1]?.trim()||'';
  if(!char||!me)return null;
  const memory=text.split('--- Start of Memory ---')[1]?.split('--- End of Memory ---')[0]||'';
  const lines=memory.split('\n').map(s=>s.trim()).filter(s=>s.startsWith(char+':')||s.startsWith(me+':'));
  let unanswered=0;for(let i=lines.length-1;i>=0;i--){if(lines[i].startsWith(me+':'))break;if(lines[i].startsWith(char+':'))unanswered++;}
  let userIndex=-1;lines.forEach((s,i)=>{if(s.startsWith(me+':'))userIndex=i;});
  const lastUser=userIndex<0?'':lines.slice(Math.max(0,userIndex-3),userIndex+1).join('\n');
  return {key:hash(char+'\n'+handle+'\n'+me),char,text,memory,unanswered,user:hash(lastUser),recent:lines.filter(s=>s.startsWith(char+':')).slice(-12).map(s=>norm(s.slice(char.length+1)))};
 }
 function rules(meta,rec){return `\n\n【自然主动 · 行为判断】
这次只是一次可选择开口的机会，不是发消息的命令。先默默判断有没有具体的新动机；没有就只输出 [保持安静]，不要为了达到消息数量要求硬聊。判断过程不输出。
1. 从近期记忆确认对方最后说去做什么、是否已经回来、有没有约定。对方说去洗澡、上课、开会、工作、睡觉、赶路或稍后回复，就按上下文和合理时长理解。不要因为过去一段时间就问“人呢/怎么不回/在干嘛/忙完了吗”，不要把沉默当作冷落，更不能擅自认定对方已经回来了。
2. 同时确认你自己上一轮说去做什么、今天的轨迹和当地时间。事情合理推进后，可以带回一个具体的结果、感受或小细节；不要每轮都宣布同一件事完成。睡觉、专注、忙碌时通常保持安静。真实发生的约定、合理到点的提醒和具体关心可以优先，但不要编造紧急情况。
3. ${cfg.sharing?'允许基于人设、当前场景和已有活动作小幅度的虚构日常延伸，例如做饭时的小插曲、路上注意到的小事、听到一首想分享的歌；像自己想起对方才顺手说一句。不要无缘无故切换地点、凭空见面、编造对方的行为、真实新闻或搜索结果。缺少场景依据就安静，不要每次制造新奇事件。':'只承接已知聊天、明确的约定和已有轨迹，不自行编造新事件。'}
4. 分享可以是不需要回答的一句话，不必句句以问题结尾，也不必接“你呢”。不要重复已经说过的关心、同一趣事或同一个话题，不用“刚好看到”当万能开场。依据角色性格说话，不要套统一温柔模板。
5. 如果角色已连续发出未获回应的内容，通常等对方回应；不要换几个同义句继续追问。此轮记录中连续角色消息条数约为 ${meta.unanswered}（气泡数，不等于轮数）。
6. 有具体值得说的内容时，沿用原系统 [消息] 角色名：正文 的格式、原语言和翻译设置。以1-2个短气泡为宜。不输出计划、理由、评分、JSON或“我决定保持安静”。没有话说时只输出 [保持安静]。只有明确有自然配图需要时才沿用原图片规则，不为了主动而生图。
${rec.rounds?'本插件已观察到你在同一末条用户消息之后返回过 '+rec.rounds+' 次主动内容，应更克制。':''}
${cfg.realistic?'真人模式已开启。结合角色当地时间、当前生活轨迹、忙碌状态、明确约定和对方安排，安排下一次适合考虑开口的时机。在最后另起一行输出 [下次检查:分钟数]，分钟数15至720。比如一小时后做完饭再考虑分享，而不是固定每半小时问候。此行仅用于安排，不发送给聊天对象；到了那个时间仍可继续保持安静。':''}
时间过去本身不是新话题；对方不回复也不要求你这轮一定跟进。\n`;}
 function inject(p,extra){
  const out={...p};
  if(Array.isArray(p.messages)&&p.messages.some(m=>m.role==='system'))out.messages=p.messages.map(m=>m.role==='system'?{...m,content:typeof m.content==='string'?m.content+extra:[...(m.content||[]),{type:'text',text:extra}]}:m);
  else if(p.system!==undefined)out.system=typeof p.system==='string'?p.system+extra:[...(p.system||[]),{type:'text',text:extra}];
  else if(p.systemInstruction||p.system_instruction){const k=p.systemInstruction?'systemInstruction':'system_instruction';out[k]={...p[k],parts:[...(p[k].parts||[]),{text:extra}]};}
  else if(typeof p.instructions==='string')out.instructions=p.instructions+extra;
  return out;
 }
 function prepare(p,depth=0){
  if(!p||typeof p!=='object'||depth>3)return null;
  // Native push schedule and generic API proxy wrappers; preserve routing and credentials verbatim.
  if(p.payload&&typeof p.payload==='object'){const r=prepare(p.payload,depth+1);if(r)return {...r,body:{...p,payload:r.body},cloud:p.pushType==='char_direct_message'||r.cloud};}
  if(p.url&&p.body&&p.bodyEncoding!=='base64'){
   let b;try{b=typeof p.body==='string'?JSON.parse(p.body):p.body;}catch{return null;}
   const r=prepare(b,depth+1);if(r)return {...r,body:{...p,body:typeof p.body==='string'?JSON.stringify(r.body):r.body}};
  }
  const meta=identify(p);if(!meta)return null;
  const rec=records[meta.key]||{rounds:0,next:0,seen:Date.now(),user:meta.user};
  if(rec.user!==meta.user){const first=!rec.user;rec.user=meta.user;rec.rounds=0;if(!first)rec.next=cfg.realistic?Date.now()+60000*(15+Math.random()*30):0;}
  records[meta.key]=rec;
  return {body:inject(p,rules(meta,rec)),meta,rec,cloud:false};
 }
 function quietNow(){const d=new Date(),n=d.getHours()*60+d.getMinutes();return cfg.quiet&&cfg.periods.some(p=>{const a=minute(p.start),b=minute(p.end);return a===b|| (a<b?n>=a&&n<b:n>=a||n<b);});}
 function emptyResponse(){const value={choices:[{index:0,message:{role:'assistant',content:''},finish_reason:'stop'}],content:[],candidates:[{content:{role:'model',parts:[{text:''}]},finishReason:'STOP'}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}};return new Response(JSON.stringify({...value,status:200,body:JSON.stringify(value),headers:{'content-type':'application/json'}}),{status:200,headers:{'Content-Type':'application/json'}});}
 function cleanReply(text,meta){
  if(text.includes('[保持安静]'))return '';
  const lines=text.split('\n').map(s=>s.trim()).filter(s=>/^\[(?:消息|私信|Message|msg|图片|Image)\]/i.test(s));
  return lines.filter(line=>{if(/^\[(?:图片|Image)\]/i.test(line))return true;const body=line.replace(/^\[[^\]]+\]\s*[^:：]+[:：]/,'');return !meta.recent.includes(norm(body));}).slice(0,2).join('\n');
 }
 function rewriteReply(p,meta,depth=0){
  if(!p||typeof p!=='object'||depth>3)return {body:p,known:false,has:false};
  let known=false,has=false,nextMinutes=null;const out={...p};
  const clean=t=>{known=true;const hint=t.match(/\[下次检查\s*[:：]\s*(\d{1,4})\s*\]/);if(hint)nextMinutes=bound(hint[1],15,720,60);const s=cleanReply(t,meta);has ||= !!s;return s;};
  if(Array.isArray(p.choices))out.choices=p.choices.map(c=>c.message&&typeof c.message.content==='string'?{...c,message:{...c.message,content:clean(c.message.content)}}:c);
  if(Array.isArray(p.content))out.content=p.content.map(c=>c.type==='text'?{...c,text:clean(c.text||'')}:c);
  if(typeof p.content==='string')out.content=clean(p.content);
  if(Array.isArray(p.candidates))out.candidates=p.candidates.map(c=>({...c,content:c.content?{...c.content,parts:(c.content.parts||[]).map(a=>typeof a.text==='string'?{...a,text:clean(a.text)}:a)}:c.content}));
  if(p.body&&typeof p.body==='string'){try{const r=rewriteReply(JSON.parse(p.body),meta,depth+1);if(r.known){out.body=JSON.stringify(r.body);known=true;has ||= r.has;nextMinutes=r.nextMinutes;}}catch{}}
  if(p.data&&typeof p.data==='object'){const r=rewriteReply(p.data,meta,depth+1);if(r.known){out.data=r.body;known=true;has ||= r.has;nextMinutes=r.nextMinutes;}}
  return {body:out,known,has,nextMinutes};
 }
 function note(s){last=s;for(const p of panels){const el=p.querySelector('[data-state]');if(el)el.textContent=last+'（已识别 '+matched+' 次检查）';}}
 async function wrapped(input,init){
  if(!active||!cfg.enabled)return original.call(this,input,init);
  const request=input instanceof Request?input:null;
  if(String(init?.method||request?.method||'GET').toUpperCase()!=='POST')return original.call(this,input,init);
  let raw=init?.body;
  if(raw===undefined&&request){if(!/json/i.test(request.headers.get('content-type')||''))return original.call(this,input,init);try{raw=await request.clone().text();}catch{return original.call(this,input,init);}}
  if(typeof raw!=='string'||raw.length>2000000||!raw.includes('Short Term Memory')||!raw.includes('本轮模式'))return original.call(this,input,init);
  let job;try{job=prepare(JSON.parse(raw));}catch{return original.call(this,input,init);}
  if(!job)return original.call(this,input,init);
  matched++;const {meta,rec}=job;
  // Server-side scheduled delivery is not under this page's control: enhance new job prompts only.
  const url=String(request?.url||input),scheduled=job.cloud&&/\/api\/schedule(?:\?|$)/.test(url);
  if(!scheduled&&(pending.has(meta.key)||quietNow()||Date.now()<rec.next||rec.rounds>=cfg.unanswered)){
   note(meta.char+'：这次保持安静，未调用模型。');return emptyResponse();
  }
  const next={...init,body:JSON.stringify(job.body)};
  const target=request?new Request(request,next):input;
  pending.add(meta.key);
  try{
   note(meta.char+'：结合上下文判断是否值得开口。');
   const response=await original.call(this,target,request?undefined:next);
   if(!response.ok){note(meta.char+'：原接口返回错误，未重试。');return response;}
   if(scheduled){note(meta.char+'：新云端任务已加入自然主动规则；云端送达不受本页冷却控制。');return response;}
   let parsed;try{parsed=await response.clone().json();}catch{note('返回格式无法识别，保留原系统处理。');return response;}
   if(!active||!cfg.enabled)return response;
   const r=rewriteReply(parsed,meta);
   if(!r.known){note('返回格式无法识别，保留原系统处理。');return response;}
   rec.seen=Date.now();
   rec.next=Date.now()+60000*(cfg.realistic?(r.nextMinutes||45+Math.random()*75):(r.has?cfg.min+Math.random()*(cfg.max-cfg.min):5+Math.random()*10));
   if(r.has)rec.rounds++;
   save();note(meta.char+(r.has?'：返回了自然主动内容，交给原系统发送。':'：没有新的开口动机，这次不发消息。'));
   const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
   return new Response(JSON.stringify(r.body),{status:response.status,statusText:response.statusText,headers});
  }catch(error){note(meta.char+'：请求中断，插件未自动重试。');throw error;}finally{pending.delete(meta.key);}
 }
 window.fetch=wrapped;
 async function loadBridge(){
  if(bridge||bridgeAttempted)return bridge;bridgeAttempted=true;
  // Fail closed when the app changes its exports. Never guess a minified function.
  const entry=[...document.querySelectorAll('script[src],link[href]')].map(el=>el.src||el.href).concat(performance.getEntriesByType('resource').map(r=>r.name)).find(s=>/\/ai-core-CQV3BCOz\.js(?:\?|$)/.test(s));
  if(!entry)return null;
  try{const module=await import(entry);if(Array.isArray(module.t?.conversations)&&typeof module.dV==='function')bridge={state:module.t,run:module.dV};}catch{}
  return bridge;
 }
 async function adaptiveTick(){
  if(!active||!cfg.enabled||!cfg.realistic||ticking||quietNow())return;
  if(localStorage.getItem('noir_webpush_char_activity_enabled')==='true'){note('真人模式暂未接管：请先关闭系统后台动态的云端定时，本页不能控制服务器已排队任务。');return;}
  const core=await loadBridge();if(!core){note('当前 Roche 版本暂未识别真人调度接口；自然主动规则仍可工作，请勿依赖真人模式的时机安排。');return;}
  const perform=async()=>{
   if(ticking||!active||!cfg.enabled||!cfg.realistic)return;ticking=true;
   try{
    const state=core.state;let count=0;
    for(const conv of state.conversations){
     if(!active||!cfg.enabled||!cfg.realistic||quietNow()||count>=3)break;
     if(conv.type==='group'||conv.isGroup||!conv.localSettings?.directMessageActivity?.enabled||conv.localSettings?.isBlocked)continue;
     const char=state.contacts?.find(c=>String(c.id)===String(conv.contactId||conv.id));
     const persona=state.personas?.find(p=>p.id===(conv.localSettings?.myActivePersonaId||state.activePersonaId));
     if(!char?.name||!persona?.name)continue;
     const key=hash(char.name+'\n'+(char.handle||'')+'\n'+persona.name);
     const messages=(state.messages?.[conv.id]||[]).filter(m=>!m.isSystem&&m.type!=='system_notice').sort((a,b)=>a.timestamp-b.timestamp);
     const lastUser=[...messages].reverse().find(m=>m.isMe);
     let rec=records[key];
     if(!rec){rec=records[key]={seen:Date.now(),rounds:0,next:Date.now()+60000*(15+Math.random()*30),user:'',observedUserId:lastUser?.id||''};save();continue;}
     if(lastUser&&rec.observedUserId!==lastUser.id){rec.observedUserId=lastUser.id;rec.rounds=0;rec.next=Date.now()+60000*(15+Math.random()*30);save();continue;}
     if(Date.now()<rec.next||rec.rounds>=cfg.unanswered||pending.has(key))continue;
     // Native invocation preserves its focus, active-chat, blocked-contact and trajectory guards.
     // Do not change the user's original interval or turn on any conversation's activity switch.
     rec.next=Date.now()+10*60000;save();count++;
     await core.run(char.id,false,undefined,'message',conv.id,0);
    }
   }catch{note('真人模式本次调度中断，稍后再检查；没有自动重发请求。');}finally{ticking=false;}
  };
  if(navigator.locks?.request)await navigator.locks.request('roche-natural-initiative-scheduler',{ifAvailable:true},lock=>lock?perform():undefined);
  else note('当前浏览器不支持真人模式所需的多窗口协调；继续使用原系统检查和自然主动规则。');
 }
 const adaptiveTimer=setInterval(()=>adaptiveTick().catch(()=>{}),60000);
 function panel(){
  const root=document.createElement('section');root.dataset.naturalInitiative='';
  root.style.cssText='font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#27272a;background:#fafafa;border-radius:18px;padding:20px;margin:16px 0;text-align:left';
  root.innerHTML='<strong style="font-size:17px">自然主动</strong><small style="display:block;color:#888">v'+VERSION+' · 有话再说，没话就安静</small><p>沿用后台漫谈的上下文与 API；检查机会不保证发消息。</p><label><input type="checkbox" data-key="enabled"> 启用自然主动</label><div style="display:grid;gap:10px;margin-top:14px"><label><input type="checkbox" data-key="realistic"> 真人模式</label><small>依据角色日程和上下文决定下次开口机会，忽略原私发间隔。仅在支持的网页版、网页仍运行时生效；云端定时任务不支持此模式。</small><label>普通模式：主动后至少安静 <input type="number" data-key="min" min="5" max="720" style="width:65px"> 分钟</label><label>随机延长至 <input type="number" data-key="max" min="5" max="1440" style="width:65px"> 分钟</label><label>你没回时，最多再主动 <input type="number" data-key="unanswered" min="1" max="5" style="width:50px"> 次</label><label><input type="checkbox" data-key="sharing"> 允许符合人设、场景的日常小分享</label><label><input type="checkbox" data-key="quiet"> 勿扰时间（本机时间）</label><div data-periods></div><button type="button" data-add>＋ 新增时段</button><small>跨午夜也可以；开始与结束相同表示全天勿扰。</small></div><p data-state style="font-size:12px;color:#71717a"></p><p style="font-size:12px;color:#888">判断和生成合并在原来的一次调用中，保持安静的模型判断也可能计费。关闭网页后不会额外运行；已有云端任务不会追溯修改。关闭插件需关闭此开关或禁用后刷新页面。</p>';
  root.querySelector('[data-add]').onclick=()=>{if(cfg.periods.length>=12)return;cfg.periods.push({start:'13:00',end:'14:00'});save();paintPeriods();};
  for(const el of root.querySelectorAll('[data-key]')){const key=el.dataset.key;if(el.type==='checkbox')el.checked=cfg[key];else el.value=cfg[key];el.addEventListener('change',()=>{cfg[key]=el.type==='checkbox'?el.checked:Number(el.value);normalize();save();for(const p of panels)for(const input of p.querySelectorAll('[data-key]')){const k=input.dataset.key;if(input.type==='checkbox')input.checked=cfg[k];else input.value=cfg[k];}note(cfg.enabled?'设置已保存，等待下一次原系统检查。':'自然主动已关闭，恢复原系统行为。');});}
  panels.add(root);paintPeriods();root.querySelector('[data-state]').textContent=last;return root;
 }
 function paintPeriods(){for(const p of panels){const box=p.querySelector('[data-periods]');box.replaceChildren();cfg.periods.forEach((range,index)=>{const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0';for(const key of ['start','end']){const input=document.createElement('input');input.type='time';input.value=range[key];input.style.cssText='min-width:0;flex:1;border:1px solid #ddd;border-radius:9px;padding:8px';input.onchange=()=>{if(minute(input.value)===null)return;range[key]=input.value;save();};row.append(input);if(key==='start')row.append(document.createTextNode('～'));}const remove=document.createElement('button');remove.textContent='删除';remove.onclick=()=>{cfg.periods.splice(index,1);save();paintPeriods();};row.append(remove);box.append(row);});}}
 function mountSettings(){
  for(const p of panels)if(!p.isConnected)panels.delete(p);
  for(const el of document.querySelectorAll('h1,h2,h3,h4,div.uppercase')){
   if(el.children.length||!/^后台漫谈\s*\(Director\)$/.test(el.textContent.trim()))continue;
   const parent=el.parentElement;if(!parent||!parent.textContent.includes('私发频率')&&!parent.textContent.includes('启用漫谈'))continue;
   if(!parent.querySelector('[data-natural-initiative]'))parent.append(panel());
  }
 }
 observer=new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;if(active)mountSettings();},200);});
 observer.observe(document.body,{childList:true,subtree:true});mountSettings();
 window.RochePlugin.register({id:'roche-natural-initiative',name:'自然主动',version:VERSION,apps:[{id:'roche-natural-initiative-settings',name:'自然主动',icon:'chat_bubble_outline',mount(container){container.replaceChildren(panel());},unmount(container){for(const p of panels)if(container.contains(p))panels.delete(p);container.replaceChildren();}}]});
 window.RocheNaturalInitiative={getStatus:()=>({version:VERSION,enabled:cfg.enabled,realistic:cfg.realistic,adaptiveSupported:!!bridge,matched,status:last}),destroy(){active=false;clearInterval(adaptiveTimer);observer?.disconnect();if(window.fetch===wrapped)window.fetch=original;for(const p of panels)p.remove();panels.clear();}};
})();
