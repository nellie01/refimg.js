/* Roche 自然主动 v1.3.1
 * Enhance browser Director DMs. Adaptive mode invokes the native generator;
 * planning and message generation share one request, without a separate planning call.
 * Native apps and already scheduled server jobs cannot be intercepted by this browser plugin.
 */
(() => {
 'use strict';
 window.RocheNaturalInitiative?.destroy?.();
 const KEY='roche.naturalInitiative.v1', VERSION='1.3.1', original=window.fetch;
 if(typeof original!=='function'||!window.RochePlugin?.register)return;
 const defaults={enabled:true,min:25,max:110,unanswered:2,quiet:false,periods:[{start:'01:00',end:'07:00'}],realistic:false,sharing:true};
 let saved;try{saved=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{saved={};}
 const cfg={...defaults,...saved.config}, records=saved.records||{};
 let active=true, observer, queued=false, last='已就绪，等待下一次开口机会。', matched=0, bridge=null, bridgeAttempted=false, bridgeDetail='', ticking=false, trial=null;
 const panels=new Set(), pending=new Set(), automatic=new Map();
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
 const isMessageTest=meta=>!!trial?.busy&&trial.key===meta.key&&trial.mode==='send';
 function rules(meta,rec){
  if(isMessageTest(meta))return `\n\n【用户手动点击：测试发一条】
这一次是用户明确要求的单次发送测试，请生成一条可见私聊消息，用于验证模型生成和聊天发送链路。此轮覆盖前文“可以保持安静/没有动机不说话”的可选规则，不作是否开口的判断，不输出 [保持安静] 或空白；日常自动检查仍按原自然判断规则执行。
依照当前角色的人设、说话语言、翻译设置、最近聊天及已有场景，生成一句自然、简短、不要求回复的话。可以轻轻接续已有话题或表达一句符合角色性格的想法；没有依据就用不涉及具体事件的简短表达。不要编造对方刚做了什么，不凭空改变双方地点，不追问“在干嘛/怎么不回/忙完了吗”，不要复述最近发过的原句。
仅输出一行：[消息] ${meta.char}：正文。正文不可为空。不输出图片、计划、解释、测试报告或其他标签；不要在正文里说“正在测试”“我决定发消息”或“保持沉默”。这次只测试文字发送，不生成图片。\n`;
  return `\n\n【自然主动 · 行为判断】
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
  if(/^\s*\[保持安静\]\s*$/m.test(text))return {text:'',reason:'silence'};
  text=text.replace(/\[下次检查\s*[:：]\s*\d{1,4}\s*\]/g,'').replace(/^```[^\n]*\n|\n```\s*$/g,'').trim();
  if(!text)return {text:'',reason:'empty'};
  const lines=text.split('\n').map(s=>s.trim()),accepted=[];let repeated=0,valid=0;
  for(const line of lines){
   const match=line.match(/^\[(消息|私信|Message|msg|图片|Image)\]\s*([^:：\n]+)[:：]\s*(.+)$/i);
   if(!match)continue;
   const image=/^(图片|Image)$/i.test(match[1]);if(image&&isMessageTest(meta))continue;
   valid++;
   if(!image&&meta.recent.includes(norm(match[3]))){repeated++;continue;}
   accepted.push('['+(image?'图片':'消息')+'] '+meta.char+'：'+match[3].trim());
  }
  return {text:accepted.slice(0,isMessageTest(meta)?1:2).join('\n'),reason:accepted.length?'content':valid&&repeated===valid?'duplicate':'format'};
 }
 function rewriteReply(p,meta,depth=0,limit={sent:0}){
  if(!p||typeof p!=='object'||depth>3)return {body:p,known:false,has:false};
  let known=false,has=false,nextMinutes=null;const out={...p},reasons=new Set(),previews=[];
  const clean=t=>{known=true;const hint=t.match(/\[下次检查\s*[:：]\s*(\d{1,4})\s*\]/);if(hint)nextMinutes=bound(hint[1],15,720,60);const r=cleanReply(t,meta);if(isMessageTest(meta)&&r.text){if(limit.sent)r.text='';else limit.sent++;}has ||= !!r.text;reasons.add(r.reason);previews.push(t);return r.text;};
  const merge=r=>{known=true;has ||= r.has;nextMinutes=r.nextMinutes??nextMinutes;reasons.add(r.reason);if(r.preview)previews.push(r.preview);};
  if(Array.isArray(p.choices))out.choices=p.choices.map(c=>c.message&&typeof c.message.content==='string'?{...c,message:{...c.message,content:clean(c.message.content)}}:c);
  if(Array.isArray(p.content))out.content=p.content.map(c=>c.type==='text'?{...c,text:clean(c.text||'')}:c);
  if(typeof p.content==='string')out.content=clean(p.content);
  if(Array.isArray(p.candidates))out.candidates=p.candidates.map(c=>({...c,content:c.content?{...c.content,parts:(c.content.parts||[]).map(a=>typeof a.text==='string'?{...a,text:clean(a.text)}:a)}:c.content}));
  if(p.body&&typeof p.body==='string'){try{const r=rewriteReply(JSON.parse(p.body),meta,depth+1,limit);if(r.known){out.body=JSON.stringify(r.body);merge(r);}}catch{}}
  if(p.data&&typeof p.data==='object'){const r=rewriteReply(p.data,meta,depth+1,limit);if(r.known){out.data=r.body;merge(r);}}
  const reason=has?'content':['format','duplicate','silence','empty'].find(s=>reasons.has(s))||'empty';
  return {body:out,known,has,nextMinutes,reason,preview:Array.from(previews.join('\n')).slice(0,600).join('')};
 }
 function note(s){last=s;for(const p of panels){const el=p.querySelector('[data-state]');if(el)el.textContent=last;const count=p.querySelector('[data-count]');if(count)count.textContent='已识别 '+matched+' 次检查';}}
 async function wrapped(input,init){
  if(!active||!cfg.enabled)return original.call(this,input,init);
  const request=input instanceof Request?input:null;
  if(String(init?.method||request?.method||'GET').toUpperCase()!=='POST')return original.call(this,input,init);
  let raw=init?.body;
  if(raw===undefined&&request){if(!/json/i.test(request.headers.get('content-type')||''))return original.call(this,input,init);try{raw=await request.clone().text();}catch{return original.call(this,input,init);}}
  if(typeof raw!=='string'||raw.length>2000000||!raw.includes('Short Term Memory')||!raw.includes('本轮模式'))return original.call(this,input,init);
  let job;try{job=prepare(JSON.parse(raw));}catch{return original.call(this,input,init);}
  if(!job)return original.call(this,input,init);
  matched++;const {meta,rec}=job,testing=!!trial?.busy&&trial.key===meta.key;
  // Server-side scheduled delivery is not under this page's control: enhance new job prompts only.
  const url=String(request?.url||input),scheduled=job.cloud&&/\/api\/schedule(?:\?|$)/.test(url);
  const permit=automatic.get(meta.key),ownCheck=!!permit&&!permit.used&&cfg.realistic;
  const managed=cfg.realistic&&!!bridge&&!!navigator.locks?.request&&localStorage.getItem('noir_webpush_char_activity_enabled')!=='true';
  if(!scheduled&&!testing&&managed&&!ownCheck){note(meta.char+'：真人模式由本页安排时机，本次原定时未调用模型。');return emptyResponse();}
  if(!scheduled&&(pending.has(meta.key)||quietNow()||testing&&trial.requests>0||!testing&&((!ownCheck&&Date.now()<rec.next)||rec.rounds>=cfg.unanswered))){
   note(meta.char+'：这次保持安静，未调用模型。');return emptyResponse();
  }
  if(ownCheck)permit.used=true;
  const next={...init,body:JSON.stringify(job.body)};
  const target=request?new Request(request,next):input;
  if(testing){trial.requests++;trial.phase='waiting';trial.message='已接入后台私聊请求，正在等待模型判断…';paintTrial();}
  pending.add(meta.key);
  try{
   note(meta.char+'：结合上下文判断是否值得开口。');
   const response=await original.call(this,target,request?undefined:next);
   if(!response.ok){if(testing){trial.phase='error';trial.message='聊天接口返回 HTTP '+response.status+'，请检查原系统 API 设置。';paintTrial();}note(meta.char+'：原接口返回错误，未重试。');return response;}
   if(scheduled){note(meta.char+'：新云端任务已加入自然主动规则；云端送达不受本页冷却控制。');return response;}
   let parsed;try{parsed=await response.clone().json();}catch{if(testing){trial.phase='error';trial.message='接口已返回，但当前返回格式未识别；请检查 API 返回设置。';paintTrial();}note('返回格式无法识别，保留原系统处理。');return response;}
   if(!active||!cfg.enabled)return response;
   const r=rewriteReply(parsed,meta);
   if(!r.known){if(testing){trial.phase='error';trial.message='接口已返回，但未找到支持的消息格式。';paintTrial();}note('返回格式无法识别，保留原系统处理。');return response;}
   const noContent={silence:'模型明确返回了 [保持安静]。',empty:'模型返回空白，没有消息正文。',duplicate:'模型返回的内容与近期消息重复，已被过滤。',format:'模型返回了内容，但不符合消息格式，未发送。'}[r.reason]||'未取得可发送的内容。';
   if(testing){trial.preview=r.preview;trial.phase=r.has?'content':trial.mode==='send'||r.reason==='format'?'error':'quiet';trial.message=r.has?'已收到消息内容，正在交给聊天系统。':(trial.mode==='send'?'发送测试未完成：':'本次自然判断：')+noContent;paintTrial();}
   rec.seen=Date.now();
   rec.next=Date.now()+60000*(cfg.realistic?(r.nextMinutes||45+Math.random()*75):(r.has?cfg.min+Math.random()*(cfg.max-cfg.min):5+Math.random()*10));
   if(r.has)rec.rounds++;
   save();note(meta.char+(r.has?'：返回了消息内容，交给原系统发送。':'：'+noContent));
   const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
   return new Response(JSON.stringify(r.body),{status:response.status,statusText:response.statusText,headers});
  }catch(error){if(testing){trial.phase='error';trial.message='请求中断或网络失败；没有自动重试。';paintTrial();}note(meta.char+'：请求中断，插件未自动重试。');throw error;}finally{pending.delete(meta.key);}
 }
 window.fetch=wrapped;
 function isNativeRunner(fn){
  if(typeof fn!=='function')return false;
  const source=Function.prototype.toString.call(fn).replace(/\s+/g,'');
  // Verified against the original and current obfuscated native generator.
  // Require the six-argument signature AND every field of its native scheduled-job payload.
  const args=source.match(/^async\(([$\w]+),([$\w]+)=!1,([$\w]+),[$\w]+=[\s\S]{1,120},[$\w]+,[$\w]+=0\)=>\{/);
  return !!args&&source.includes('&&void0!=='+args[3]+'){')&&['model:','messages:','temperature:','stream:!1','provider:','endpoint:','apiKey:','payload:','chatId:','charId:','jobKey:','pushType:','chatTitle:','delayMs:'].every(key=>source.includes(key));
 }
 function isNativeState(state){return !!state&&typeof state==='object'&&Array.isArray(state.conversations)&&Array.isArray(state.contacts)&&Array.isArray(state.personas)&&state.messages&&typeof state.messages==='object';}
 async function loadBridge(){
  if(bridge||bridgeAttempted)return bridge;bridgeAttempted=true;
  const loaded=[...document.querySelectorAll('script[src],link[href]')].map(el=>el.src||el.href).concat(performance.getEntriesByType('resource').map(r=>r.name));
  const entries=[...new Set(loaded)].filter(s=>{try{const url=new URL(s,location.href);return url.origin===location.origin&&/\/ai-core-[\w-]+\.js$/.test(url.pathname);}catch{return false;}}).reverse().slice(0,3);
  if(!entries.length){bridgeDetail='未找到已加载的私聊模块；请先打开一次角色聊天再检查。';return null;}
  for(const entry of entries)try{
   const module=await import(entry),name=new URL(entry,location.href).pathname.split('/').pop();
   // Explicit adapters also keep isolated compatibility fixtures possible.
   const verified={'ai-core-CQV3BCOz.js':['t','dV'],'ai-core-De7sMNqT.js':['w','dZ']},adapter=verified[name];
   if(adapter&&isNativeState(module[adapter[0]])&&typeof module[adapter[1]]==='function'){bridge={state:module[adapter[0]],run:module[adapter[1]],build:name};break;}
   const values=Object.values(module),states=[...new Set(values.filter(isNativeState))],runners=[...new Set(values.filter(isNativeRunner))];
   if(states.length===1&&runners.length===1){bridge={state:states[0],run:runners[0],build:name};break;}
   bridgeDetail='已加载 '+name+'，但私聊函数特征未通过核对；未调用模型。';
  }catch{bridgeDetail='私聊模块读取失败；请刷新网页后重试。';}
  if(bridge)bridgeDetail='已识别原生私聊接口 · '+bridge.build;
  return bridge;
 }
 async function adaptiveTick(){
  if(!active||!cfg.enabled||!cfg.realistic||ticking||trial?.busy||quietNow())return;
  if(localStorage.getItem('noir_webpush_char_activity_enabled')==='true'){note('真人模式暂未接管：请先关闭系统后台动态的云端定时，本页不能控制服务器已排队任务。');return;}
  const core=await loadBridge();if(!core){note('当前 Roche 版本暂未识别真人调度接口；自然主动规则仍可工作，请勿依赖真人模式的时机安排。');return;}
  const perform=async()=>{
   if(ticking||!active||!cfg.enabled||!cfg.realistic)return;ticking=true;
   try{
    const state=core.state;let count=0;
    for(const conv of state.conversations){
     if(!active||!cfg.enabled||!cfg.realistic||quietNow()||count>=3)break;
     if(conv.type==='group'||conv.isGroup||!conv.localSettings?.directMessageActivity?.enabled||conv.localSettings?.isBlocked)continue;
     const info=conversationInfo(core,conv);if(!info)continue;
     const {char,key}=info;
     const messages=(state.messages?.[conv.id]||[]).filter(m=>!m.isSystem&&m.type!=='system_notice').sort((a,b)=>a.timestamp-b.timestamp);
     const lastUser=[...messages].reverse().find(m=>m.isMe);
     let rec=records[key];
     if(!rec){rec=records[key]={seen:Date.now(),rounds:0,next:Date.now()+60000*(15+Math.random()*30),user:'',observedUserId:lastUser?.id||''};save();continue;}
     if(lastUser&&rec.observedUserId!==lastUser.id){rec.observedUserId=lastUser.id;rec.rounds=0;rec.next=Date.now()+60000*(15+Math.random()*30);save();continue;}
     if(Date.now()<rec.next||rec.rounds>=cfg.unanswered||pending.has(key))continue;
     // Native invocation preserves its focus, active-chat, blocked-contact and trajectory guards.
     // Do not change the user's original interval or turn on any conversation's activity switch.
     rec.next=Date.now()+10*60000;save();count++;
     // Reserve a single request before native preparation. The reservation backoff
     // prevents rapid resubmission but must not block this very request in wrapped().
     const permit={used:false};automatic.set(key,permit);
     try{await core.run(char.id,false,undefined,'message',conv.id,0);}
     finally{if(automatic.get(key)===permit)automatic.delete(key);}
    }
   }catch{note('真人模式本次调度中断，稍后再检查；没有自动重发请求。');}finally{ticking=false;}
  };
  if(navigator.locks?.request)await navigator.locks.request('roche-natural-initiative-scheduler',{ifAvailable:true},lock=>lock?perform():undefined);
  else note('当前浏览器不支持真人模式所需的多窗口协调；继续使用原系统检查和自然主动规则。');
 }
 const adaptiveTimer=setInterval(()=>adaptiveTick().catch(()=>{}),60000);
 const icons={sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',moon:'<path d="M20.8 13.1A9 9 0 0 1 10.9 3.2 9 9 0 1 0 20.8 13.1Z"/>',check:'<path d="m5 12 4 4L19 6"/>',arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>'};
 const icon=name=>'<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icons[name]+'</svg>';
 const css=`
 [data-natural-initiative]{--ni-ink:#272727;--ni-muted:#828282;--ni-line:#ebebeb;--ni-accent:#111111;box-sizing:border-box!important;display:block!important;width:100%;max-width:560px;min-width:0;margin:20px auto;padding:18px;background:#f6f6f6;color:var(--ni-ink);border:1px solid #ededed;border-radius:24px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;text-align:left;letter-spacing:0;isolation:isolate}
 [data-natural-initiative] *{box-sizing:border-box!important;letter-spacing:normal}
 [data-natural-initiative] [hidden]{display:none!important}
 [data-natural-initiative] h3,[data-natural-initiative] h4,[data-natural-initiative] p{margin:0;padding:0;font:inherit;color:inherit}
 [data-natural-initiative] button,[data-natural-initiative] input,[data-natural-initiative] select{font:inherit!important;text-transform:none!important;letter-spacing:0!important;box-shadow:none!important;margin:0;color:var(--ni-ink);outline-offset:3px}
 [data-natural-initiative] button{border:0;cursor:pointer;min-width:0;line-height:1.4;background:transparent}
 [data-natural-initiative] button:disabled{opacity:.45;cursor:default}
 [data-natural-initiative] button:focus-visible,[data-natural-initiative] input:focus-visible,[data-natural-initiative] select:focus-visible,[data-natural-initiative] summary:focus-visible{outline:2px solid #818181}
 [data-natural-initiative] .ni-top{display:flex;align-items:center;gap:11px;margin-bottom:18px}
 [data-natural-initiative] .ni-icon{display:grid;place-items:center;width:39px;height:39px;border:1px solid #e4e4e4;border-radius:13px;color:var(--ni-accent);background:#ededed;flex:none}
 [data-natural-initiative] h3{font-weight:650;font-size:19px;line-height:1.3}
 [data-natural-initiative] .ni-sub{color:var(--ni-muted);font-size:11px;margin-top:3px}
 [data-natural-initiative] .ni-version{margin-left:auto;padding:4px 8px;font-size:10px;color:#8b8b8b;background:#ececec;border-radius:7px;white-space:nowrap}
 [data-natural-initiative] .ni-card{background:#fff;border:1px solid var(--ni-line);border-radius:17px;padding:15px;margin-top:10px}
 [data-natural-initiative] .ni-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
 [data-natural-initiative] h4,[data-natural-initiative] .ni-label{font-size:14px;font-weight:600;line-height:1.45}
 [data-natural-initiative] .ni-hint{font-size:11px;line-height:1.65;color:var(--ni-muted);margin-top:4px;overflow-wrap:anywhere}
 [data-natural-initiative] .ni-switch{position:relative;display:block;flex:0 0 42px;width:42px;height:26px;cursor:pointer}
 [data-natural-initiative] .ni-switch input{appearance:none!important;-webkit-appearance:none!important;position:absolute;inset:0;width:42px!important;height:26px!important;border:0!important;border-radius:20px!important;padding:0!important;background:#e0e0e0!important;cursor:pointer;transition:background .18s}
 [data-natural-initiative] .ni-switch input:checked{background:var(--ni-accent)!important}
 [data-natural-initiative] .ni-switch span{pointer-events:none;position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0002;transition:transform .18s}
 [data-natural-initiative] .ni-switch input:checked+span{transform:translateX(16px)}
 [data-natural-initiative] .ni-segment{display:grid;grid-template-columns:1fr 1fr;gap:3px;background:#f2f2f2;border-radius:11px;padding:4px;margin-top:12px}
 [data-natural-initiative] .ni-segment button{font-size:12px!important;padding:9px 5px;border-radius:8px;color:#828282}
 [data-natural-initiative] .ni-segment button[aria-pressed="true"]{background:#fff;color:var(--ni-accent);font-weight:600;box-shadow:0 1px 4px #3838380d!important}
 [data-natural-initiative] .ni-mode-note{font-size:12px;line-height:1.7;color:#717171;margin-top:11px;min-height:40px}
 [data-natural-initiative] .ni-timing{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin-top:12px}
 [data-natural-initiative] .ni-num{display:flex;align-items:center;justify-content:center;gap:4px;background:#f8f8f8;border:1px solid var(--ni-line);border-radius:10px;padding:9px 6px;min-width:0}
 [data-natural-initiative] .ni-num input{appearance:textfield;-moz-appearance:textfield;width:45px!important;min-width:0!important;max-width:100%;border:0!important;background:transparent!important;padding:0!important;text-align:center;font-size:17px!important;line-height:1.4!important;font-weight:600!important}
 [data-natural-initiative] input::-webkit-inner-spin-button{appearance:none}
 [data-natural-initiative] .ni-num span,[data-natural-initiative] .ni-dash{font-size:10px;color:#959595}
 [data-natural-initiative] .ni-divider{border-top:1px solid var(--ni-line);margin-top:13px;padding-top:13px}
 [data-natural-initiative] .ni-limit{max-width:90px;flex:none;padding:7px 9px}
 [data-natural-initiative] .ni-limit input{width:24px!important;font-size:15px!important}
 [data-natural-initiative] .ni-quiet-title{display:flex;align-items:center;gap:7px}
 [data-natural-initiative] .ni-quiet-title svg{width:17px;height:17px;color:var(--ni-accent)}
 [data-natural-initiative] .ni-period{display:grid;grid-template-columns:minmax(0,1fr) 12px minmax(0,1fr) 28px;gap:5px;align-items:center;margin-top:9px}
 [data-natural-initiative] input[type="time"]{appearance:none!important;-webkit-appearance:none!important;display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;min-height:39px;border:1px solid var(--ni-line)!important;border-radius:10px!important;padding:8px 5px!important;background:#f8f8f8!important;text-align:center;font-size:13px!important;line-height:1.4!important}
 [data-natural-initiative] input[type="time"]::-webkit-date-and-time-value{min-width:0;text-align:center}
 [data-natural-initiative] input[type="time"]::-webkit-calendar-picker-indicator{display:none}
 [data-natural-initiative] .ni-remove{height:32px;padding:0;font-size:20px!important;color:#9f9f9f}
 [data-natural-initiative] .ni-add{display:block;width:100%;padding:10px;margin-top:10px;border:1px dashed #e2e2e2;border-radius:10px;color:var(--ni-accent);font-size:12px!important}
 [data-natural-initiative] .ni-meta{font-size:10px;color:#929292}
 [data-natural-initiative] .ni-status{display:flex;align-items:flex-start;gap:7px;font-size:12px;line-height:1.65;margin-top:11px;color:#5f5f5f;overflow-wrap:anywhere}
 [data-natural-initiative] .ni-dot{flex:none;width:6px;height:6px;border-radius:50%;margin-top:7px;background:#757575}
 [data-natural-initiative] [data-enabled="false"] .ni-dot{background:#b7b7b7}
 [data-natural-initiative] .ni-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:8px;margin-top:13px}
 [data-natural-initiative] .ni-btn{padding:10px 7px;border:1px solid #e2e2e2;border-radius:10px;background:#f7f7f7;font-size:12px!important;font-weight:550}
 [data-natural-initiative] .ni-primary{background:var(--ni-accent);border-color:var(--ni-accent);color:#fff}
 [data-natural-initiative] select{appearance:auto!important;display:block;width:100%!important;max-width:100%;min-width:0;margin-top:12px;padding:10px;border:1px solid var(--ni-line);border-radius:10px;background:#fbfbfb;font-size:12px!important}
 [data-natural-initiative] .ni-report{margin-top:12px;padding:10px 11px;background:#f7f7f7;border-radius:10px}
 [data-natural-initiative] .ni-report-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;font-size:11px;padding:4px 0;line-height:1.55}
 [data-natural-initiative] .ni-report-row span:last-child{max-width:67%;text-align:right;overflow-wrap:anywhere;color:#696969}
 [data-natural-initiative] .ni-report-row[data-ok="false"] span:last-child{color:#7a7a7a}
 [data-natural-initiative] .ni-trial{font-size:12px;line-height:1.7;padding:11px;margin-top:11px;border-radius:10px;background:#f1f1f1;color:#575757;overflow-wrap:anywhere}
 [data-natural-initiative] .ni-trial[data-phase="error"]{background:#f5f5f5;color:#727272}
 [data-natural-initiative] .ni-decision{display:block;width:100%;padding:10px 0 2px;color:#666;font-size:11px!important;text-decoration:underline;text-underline-offset:3px}
 [data-natural-initiative] .ni-response pre{max-height:160px;overflow:auto;margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#666}
 [data-natural-initiative] .ni-help{padding:13px 4px 0;color:#8c8c8c;font-size:11px;line-height:1.75}
 [data-natural-initiative] .ni-help summary{cursor:pointer;color:#727272;list-style:none;display:flex;align-items:center;gap:7px}
 [data-natural-initiative] .ni-help summary::before{content:'+';font-size:15px}
 [data-natural-initiative] .ni-help[open] summary::before{content:'−'}
 [data-natural-initiative] .ni-help p{margin-top:8px}
 [data-natural-initiative] .ni-footer{font-size:10px;color:#a1a1a1;text-align:center;padding-top:14px}
 @media(max-width:360px){[data-natural-initiative]{padding:12px;border-radius:19px}[data-natural-initiative] .ni-card{padding:12px}[data-natural-initiative] .ni-report-row{gap:6px}}
 @media(prefers-reduced-motion:reduce){[data-natural-initiative] .ni-switch input,[data-natural-initiative] .ni-switch span{transition:none}}
 `;
 function conversationInfo(core,conv){
  if(!conv)return null;
  const char=core.state.contacts?.find(c=>String(c.id)===String(conv.contactId||conv.id))||core.state.contacts?.find(c=>conv.participants?.includes(c.id));
  const persona=core.state.personas?.find(p=>p.id===(conv.localSettings?.myActivePersonaId||core.state.activePersonaId));
  if(!char?.name||!persona?.name)return null;
  return {conv,char,key:hash(char.name+'\n'+(char.handle||'')+'\n'+persona.name)};
 }
 function fillTargets(root,core){
  const select=root.querySelector('[data-target]'),previous=select.value||String(core.state.aiRequestState?.activeConversationId||'');
  const conversations=core.state.conversations.filter(c=>(c.type==='dm'||c.type==='direct')&&conversationInfo(core,c));
  select.replaceChildren();
  for(const conv of conversations){const info=conversationInfo(core,conv),option=document.createElement('option');option.value=conv.id;option.textContent=info.char.name+(conv.localSettings?.directMessageActivity?.enabled?'':' · 漫谈未开启');select.append(option);}
  if(!select.options.length){const option=document.createElement('option');option.value='';option.textContent='暂无可识别的私聊';select.append(option);}
  if([...select.options].some(o=>o.value===previous))select.value=previous;
  select.hidden=false;return conversationInfo(core,core.state.conversations.find(c=>String(c.id)===select.value));
 }
 async function inspect(root){
  const button=root.querySelector('[data-inspect]');button.disabled=true;
  try{
   if(!bridge)bridgeAttempted=false;
   const core=await loadBridge(),info=core?fillTargets(root,core):null;
   const cloud=localStorage.getItem('noir_webpush_char_activity_enabled')==='true';
   const rows=[['自然主动',cfg.enabled?'已开启':'请先打开上方总开关',cfg.enabled],['网页接入',core?'已适配，可试运行':bridgeDetail||'未适配此版本，暂不能手动试运行',!!core],['原会话漫谈',info?(info.conv.localSettings?.directMessageActivity?.enabled?'已开启 · '+info.char.name:'请先开启此角色的“启用漫谈”'):core?'暂无可用私聊，请先打开一次角色聊天':'待网页接入后读取',!!info?.conv.localSettings?.directMessageActivity?.enabled],['勿扰时段',quietNow()?'当前勿扰，不会试运行':'当前可检查',!quietNow()],['云端定时',cloud?'已开启；单次测试可用，真人自动调度需关闭':'未开启',!cloud]];
   if(cfg.realistic)rows.push(['多窗口协调',navigator.locks?.request?'支持':'此浏览器暂不支持',!!navigator.locks?.request]);
   const box=root.querySelector('[data-report]');box.replaceChildren();box.hidden=false;
   for(const [label,value,ok] of rows){const row=document.createElement('div');row.className='ni-report-row';row.dataset.ok=ok;const a=document.createElement('span'),b=document.createElement('span');a.textContent=label;b.textContent=value;row.append(a,b);box.append(row);}
   for(const button of root.querySelectorAll('[data-test],[data-decision]'))button.disabled=!!trial?.busy||!active||!cfg.enabled||!core||!info||!info.conv.localSettings?.directMessageActivity?.enabled||quietNow();
   return {core,info,cloud};
  }catch{const box=root.querySelector('[data-report]');box.hidden=false;box.textContent='检查未完成，请刷新页面后再试。';for(const button of root.querySelectorAll('[data-test],[data-decision]'))button.disabled=true;return {};}
  finally{button.disabled=false;}
 }
 function paintTrial(){
  for(const root of panels){const el=root.querySelector('[data-trial]');el.hidden=!trial;if(trial){el.textContent=trial.message;el.dataset.phase=trial.phase;}const response=root.querySelector('[data-response]');response.hidden=!trial?.preview;root.querySelector('[data-response-text]').textContent=trial?.preview||'';if(trial?.busy)for(const button of root.querySelectorAll('[data-test],[data-decision]'))button.disabled=true;}
 }
 async function testOnce(root,mode='send'){
  if(trial?.busy||ticking){note('已有一次检查正在处理，请等它结束后再试。');return;}
  const {core,info}=await inspect(root);
  if(!active||!core||!info||!cfg.enabled||quietNow()||!info.conv.localSettings?.directMessageActivity?.enabled)return;
  if(pending.has(info.key)||core.state.aiRequestState?.typingStatus?.[info.conv.id]){note('这个角色还有请求未结束，请稍后再试。');return;}
  trial={key:info.key,mode,busy:true,requests:0,phase:'starting',preview:'',message:'正在读取 '+info.char.name+' 的上下文…'};paintTrial();
  const before=new Set((core.state.messages?.[info.conv.id]||[]).map(m=>m.id));
  const slow=setTimeout(()=>{if(trial?.busy){trial.message='本次处理超过 90 秒，仍在等待原系统。请勿重复点击；可以查看 API 服务商的请求记录。';paintTrial();}},90000);
  try{
   // A deliberate one-shot test skips normal timing and native hot-chat/life delays.
   // It still respects this plugin's master switch, quiet hours and native focus guards.
   // An undefined delay uses the local request path in both verified native versions,
   // including when cloud scheduling is enabled. Do not change the global cloud switch.
   await core.run(info.char.id,true,undefined,'message',info.conv.id,0);
   if(!active)return;
   if(!trial.requests){trial.phase='error';trial.message='未捕获到可识别的后台私聊请求。可能被原系统专注限制拦下，或当前版本走了其他请求入口；这次无法确认接入。';}
   else if(trial.phase==='content'){
    const added=(core.state.messages?.[info.conv.id]||[]).filter(m=>!before.has(m.id)&&!m.isMe&&!m.isSystem&&m.type!=='system_notice');
    trial.message=added.length?(mode==='send'?'测试发送成功：':'自然判断已发送：')+'已在 '+info.char.name+' 的聊天中新增 '+added.length+' 条消息，请返回查看。':'模型已返回内容，但暂未确认聊天入库；请返回会话查看。';
   }else if(trial.phase==='waiting'||trial.phase==='starting'){trial.phase='error';trial.message='原系统已结束本轮，但插件未确认最终结果。请查看聊天与 API 请求记录，先不要重复试运行。';}
  }catch{trial.phase='error';trial.message='试运行中断；请检查原系统 API 和网络，没有自动重试。';}
  finally{clearTimeout(slow);if(trial){trial.busy=false;paintTrial();}for(const p of panels)await inspect(p);}
 }
 function panel(){
  const root=document.createElement('section');root.dataset.naturalInitiative='';
  const toggle=(key,label)=>'<label class="ni-switch"><input type="checkbox" role="switch" data-key="'+key+'" aria-label="'+label+'"><span></span></label>';
  root.innerHTML='<style>'+css+'</style><header class="ni-top"><div class="ni-icon">'+icon('sun')+'</div><div><h3>自然主动</h3><p class="ni-sub">有话再说，没话就安静</p></div><span class="ni-version">v'+VERSION+'</span></header>'+
  '<div class="ni-card ni-row"><div><h4>启用自然主动</h4><p class="ni-hint">让每次开口，都有一点缘由</p></div>'+toggle('enabled','启用自然主动')+'</div>'+
  '<div class="ni-card"><h4>相处节奏</h4><div class="ni-segment" role="group" aria-label="主动模式"><button type="button" data-mode="normal">普通模式</button><button type="button" data-mode="realistic">真人模式</button></div><p class="ni-mode-note" data-mode-note></p><div data-normal><div class="ni-timing"><label class="ni-num"><input type="number" data-key="min" min="5" max="720" aria-label="最短冷却分钟"><span>分钟</span></label><span class="ni-dash">至</span><label class="ni-num"><input type="number" data-key="max" min="5" max="1440" aria-label="最长冷却分钟"><span>分钟</span></label></div><p class="ni-hint">一次主动后，随机安静这么久</p></div><div class="ni-row ni-divider"><div><p class="ni-label">留一点空间</p><p class="ni-hint">你没回复时，最多主动几轮</p></div><label class="ni-num ni-limit"><input type="number" data-key="unanswered" min="1" max="5" aria-label="未回复最多主动轮数"><span>轮</span></label></div><div class="ni-row ni-divider"><div><p class="ni-label">日常小分享</p><p class="ni-hint">依据人设与场景，延伸生活小事</p></div>'+toggle('sharing','允许日常小分享')+'</div></div>'+
  '<div class="ni-card"><div class="ni-row"><div><h4 class="ni-quiet-title">'+icon('moon')+' 勿扰时间</h4><p class="ni-hint">按这台设备的时间，留一段安静</p></div>'+toggle('quiet','启用勿扰时间')+'</div><div data-quiet-body><div data-periods></div><button type="button" class="ni-add" data-add>＋ 新增时段</button><p class="ni-hint">支持跨午夜；起止相同表示全天勿扰</p></div></div>'+
  '<div class="ni-card" data-enabled="true"><div class="ni-row"><h4>检查与测试</h4><span class="ni-meta" data-count>已识别 '+matched+' 次检查</span></div><div class="ni-status"><i class="ni-dot"></i><p data-state aria-live="polite"></p></div><select data-target aria-label="选择试运行角色" hidden></select><div class="ni-report" data-report hidden></div><div class="ni-actions"><button type="button" class="ni-btn" data-inspect>检查接入 · 免费</button><button type="button" class="ni-btn ni-primary" data-test disabled>测试发一条</button></div><p class="ni-hint">明确要求模型生成一条文字，直接发到所选角色聊天。<br>会调用你的聊天模型，可能计费；不自动重试。</p><button type="button" class="ni-decision" data-decision disabled>模拟自然判断 · 可能保持安静</button><div class="ni-trial" data-trial role="status" hidden></div><details class="ni-help ni-response" data-response hidden><summary>本次模型返回 · 最多600字</summary><pre data-response-text></pre></details></div>'+
  '<details class="ni-help"><summary>怎么测试？</summary><p>① 打开此处总开关，保留角色原来的“启用漫谈”。点“检查接入”，选择要测试的角色。</p><p>② 点“测试发一条”：本轮明确要求模型按角色人设、已有聊天生成一句话，用来检查消息能否真正出现在聊天中。只在这次测试跳过是否开口的判断，日常模式仍可安静。若模型未按要求输出，会显示失败原因，并可展开查看本次返回。</p><p>③ “模拟自然判断”使用日常规则，允许沉默。它用于观察此刻有没有开口动机；也会调用模型，可能计费。明确沉默、空白、重复过滤、格式错误会分别显示。</p><p>④ 想验证日常效果，开启真人模式，退出聊天到小手机首页，保持网页运行。首次通常留出15～45分钟，再结合上下文决定是否开口；观察它是否承接前文，有没有反复追问。一次发送测试不能验证长期节奏。</p><p>⑤ 想验证勿扰，新增一段覆盖当前时间的时段并开启勿扰，再检查接入，应提示“当前勿扰”。结束后删除测试时段。</p></details>'+
  '<details class="ni-help"><summary>运行与计费说明</summary><p>沿用原后台私聊的上下文和 API。模型判断与生成合并在一次调用中；选择安静也可能计费。免费检查不会调用聊天模型。</p><p>真人模式需要已适配的网页版与多窗口协调功能。网页被挂起或关闭时，本地调度暂停；已有云端任务不受本页控制，单次试运行可在云端开关开启时使用；日常真人调度需先关闭系统云端定时。</p><p>设置自动保存。关闭上方总开关立即恢复原系统行为；从插件管理禁用或卸载后请刷新页面。</p></details><p class="ni-footer">设置自动保存 · 只保存在当前浏览器</p>';
  root.querySelector('[data-add]').onclick=()=>{if(cfg.periods.length>=12)return;cfg.periods.push({start:'13:00',end:'14:00'});save();paintPeriods();};
  const changed=()=>{normalize();save();syncPanels();note(cfg.enabled?'设置已保存，等待下一次开口机会。':'自然主动已关闭，请打开上方总开关。');};
  for(const el of root.querySelectorAll('[data-key]'))el.addEventListener('change',()=>{const key=el.dataset.key;cfg[key]=el.type==='checkbox'?el.checked:Number(el.value);changed();});
  for(const el of root.querySelectorAll('[data-mode]'))el.onclick=()=>{cfg.realistic=el.dataset.mode==='realistic';changed();};
  root.querySelector('[data-inspect]').onclick=()=>inspect(root);
  root.querySelector('[data-target]').onchange=()=>inspect(root);
  root.querySelector('[data-test]').onclick=()=>testOnce(root);
  root.querySelector('[data-decision]').onclick=()=>testOnce(root,'decision');
  panels.add(root);syncPanels();paintPeriods();paintTrial();root.querySelector('[data-state]').textContent=cfg.enabled?last:'自然主动已关闭，请打开上方总开关。';return root;
 }
 function syncPanels(){for(const root of panels){for(const input of root.querySelectorAll('[data-key]')){const key=input.dataset.key;if(input.type==='checkbox')input.checked=cfg[key];else input.value=cfg[key];}for(const button of root.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String((button.dataset.mode==='realistic')===cfg.realistic));root.querySelector('[data-normal]').hidden=cfg.realistic;root.querySelector('[data-mode-note]').textContent=cfg.realistic?'让角色根据上下文和生活日程，决定下次适合开口的机会。':'沿用原系统的检查时机，有话才说；发过消息后，给彼此留一点空隙。';root.querySelector('[data-quiet-body]').hidden=!cfg.quiet;root.querySelector('[data-enabled]').dataset.enabled=cfg.enabled;for(const button of root.querySelectorAll('[data-test],[data-decision]'))button.disabled=true;root.querySelector('[data-report]').hidden=true;}}
 function paintPeriods(){for(const p of panels){const box=p.querySelector('[data-periods]');box.replaceChildren();cfg.periods.forEach((range,index)=>{const row=document.createElement('div');row.className='ni-period';for(const key of ['start','end']){const input=document.createElement('input');input.type='time';input.value=range[key];input.setAttribute('aria-label','勿扰时段'+(index+1)+(key==='start'?'开始':'结束'));input.onchange=()=>{if(minute(input.value)===null)return;range[key]=input.value;save();for(const panel of panels)for(const button of panel.querySelectorAll('[data-test],[data-decision]'))button.disabled=true;paintPeriods();};row.append(input);if(key==='start'){const dash=document.createElement('span');dash.className='ni-dash';dash.textContent='—';row.append(dash);}}const remove=document.createElement('button');remove.type='button';remove.className='ni-remove';remove.textContent='×';remove.setAttribute('aria-label','删除勿扰时段'+(index+1));remove.onclick=()=>{cfg.periods.splice(index,1);save();for(const panel of panels)for(const button of panel.querySelectorAll('[data-test],[data-decision]'))button.disabled=true;paintPeriods();};row.append(remove);box.append(row);});p.querySelector('[data-add]').disabled=cfg.periods.length>=12;}}
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
  window.RocheNaturalInitiative={getStatus:()=>({version:VERSION,enabled:cfg.enabled,realistic:cfg.realistic,adaptiveSupported:!!bridge,build:bridge?.build||'',connection:bridgeDetail,matched,status:last}),destroy(){active=false;clearInterval(adaptiveTimer);automatic.clear();observer?.disconnect();if(window.fetch===wrapped)window.fetch=original;for(const p of panels)p.remove();panels.clear();}};
})();
