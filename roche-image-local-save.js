/* Roche 图片本地保存保护 v1.2.0
 * Existing FoxAPI GPT-image requests and direct Roche ImgBB uploads.
 * Prefer base64; if the service still returns a URL, read it once immediately.
 * Verify an ImgBB direct link before the native app can replace a local image.
 */
(() => {
 'use strict';
 window.RocheImageLocalSave?.destroy?.();
 const upstream=window.fetch;if(typeof upstream!=='function')return;
 const state={version:'1.2.0',active:true,formattedRequests:0,inlineResults:0,convertedResults:0,unsavedResults:0,lastStatus:'等待下一次正常生图。',lastURL:'',hostVerified:0,hostBlocked:0,hostStatus:'等待下一次 ImgBB 上传。'};
 let panel,observer,paintQueued=false;
 const matches=url=>{try{const u=new URL(String(url),location.href);return u.protocol==='https:'&&u.hostname==='foxapi.chat'&&/^\/(?:v1\/)?images\/(?:generations|edits)\/?$/.test(u.pathname);}catch{return false;}};
 const isModel=model=>/gpt[-_. ]?image-/i.test(String(model||''));
 const https=url=>{try{const u=new URL(String(url));return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const isImgBBUpload=url=>{try{const u=new URL(String(url),location.href);return u.origin==='https://api.imgbb.com'&&!u.username&&!u.password&&/^\/1\/upload\/?$/.test(u.pathname);}catch{return false;}};
 function note(text){state.lastStatus=text;paint();try{window.Roche?.ui?.toast?.(text);}catch{}}
 function probeImgBB(url,signal){return new Promise(resolve=>{
  if(signal?.aborted){resolve('图片验证已取消');return;}
  const image=new Image(),timer=setTimeout(()=>finish('等待直链加载超时'),15000),cancel=()=>finish('图片验证已取消');let finished=false;
  function finish(reason){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);image.onload=image.onerror=null;image.removeAttribute('src');resolve(reason);}
  image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0?'':'直链没有返回可显示的图片');
  image.onerror=()=>finish('直链暂时无法加载');signal?.addEventListener('abort',cancel,{once:true});image.src=url;
 });}
 async function guardImgBB(response,signal){
  if(!response.ok)return response;
  let link='',reason='';
  try{const result=await response.clone().json();link=result?.success===false?'':https(typeof result?.data?.url==='string'?result.data.url.trim():'');
   if(!link||new URL(link).origin!=='https://i.ibb.co')reason='ImgBB 没有返回有效的图片直链';
   else reason=await probeImgBB(link,signal);
  }catch{reason='无法验证 ImgBB 返回的图片';}
  if(!reason){state.hostVerified++;state.hostStatus='最近一次直链已确认可以显示。';paint();return response;}
  state.hostBlocked++;state.hostStatus=reason+'，已保留本地原图。';paint();
  if(state.hostBlocked===1){try{window.Roche?.ui?.toast?.(state.hostStatus);}catch{}}
  // The native uploader already treats non-2xx responses as failures and skips replacement.
  return new Response(state.hostStatus,{status:502,headers:{'Content-Type':'text/plain; charset=utf-8'}});
 }
 function formatJSON(payload,url,depth=0){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||depth>2)return null;
  if(payload.url&&payload.body&&payload.bodyEncoding!=='base64'){
   let nested;try{nested=typeof payload.body==='string'?JSON.parse(payload.body):payload.body;}catch{return null;}
   const fixed=formatJSON(nested,payload.url,depth+1);if(!fixed)return null;
   return {...payload,body:typeof payload.body==='string'?JSON.stringify(fixed):fixed};
  }
  if(!matches(url)||!isModel(payload.model))return null;
  return {...payload,response_format:'b64_json'};
 }
 function raster(bytes){return bytes[0]===255&&bytes[1]===216||bytes[0]===137&&String.fromCharCode(...bytes.slice(1,4))==='PNG'||String.fromCharCode(...bytes.slice(0,4))==='RIFF'||String.fromCharCode(...bytes.slice(0,4))==='GIF8';}
 function base64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader(),timer=setTimeout(()=>{reader.abort();reject(Error('读取图片数据超过 15 秒。'));},15000);reader.onload=()=>{clearTimeout(timer);resolve(String(reader.result).split(',')[1]);};reader.onerror=reader.onabort=()=>{clearTimeout(timer);reject(Error('无法读取图片数据。'));};reader.readAsDataURL(blob);});}
 async function readRemote(url,signal){
  const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,20000);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  try{const response=await Reflect.apply(upstream,window,[url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'}]);if(!response.ok)throw Error('图片原地址返回 HTTP '+response.status);
   const blob=await response.blob();if(!blob.size||blob.size>32*1024*1024)throw Error('图片为空或超过 32 MB。');if(!raster(new Uint8Array(await blob.slice(0,16).arrayBuffer())))throw Error('图片原地址返回的不是可识别图片。');return await base64(blob);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 }
 async function localResponse(response,signal){
  if(!response.ok||!/(?:application|text)\/.*json/i.test(response.headers.get('content-type')||''))return response;
  let payload;try{payload=await response.clone().json();}catch{return response;}
  if(payload?.body&&typeof payload.status==='number'){
   let body;try{body=payload.bodyEncoding==='base64'?decodeURIComponent(escape(atob(payload.body))):String(payload.body);}catch{return response;}
   const inner=new Response(body,{status:payload.status,headers:payload.headers||{'Content-Type':'application/json'}}),converted=await localResponse(inner,signal);if(converted===inner)return response;
   const text=await converted.text();return new Response(JSON.stringify({...payload,status:converted.status,headers:{...payload.headers,'content-type':'application/json'},body:text,bodyEncoding:'text'}),{status:response.status,headers:{'Content-Type':'application/json'}});
  }
  if(payload?.data?.some?.(item=>item?.b64_json)||payload?.b64_json){state.inlineResults++;note('生图接口已返回完整图片数据，交由系统保存本地。');return response;}
  const items=Array.isArray(payload?.data)?payload.data:payload?.url?[{url:payload.url}]:[];
  if(!items.some(item=>https(item?.url)))return response;
  const data=[];try{for(const item of items){if(item.b64_json){data.push(item);continue;}const url=https(item?.url);if(!url)throw Error('接口返回的图片地址无效。');state.lastURL=url;note('接口仍返回外链，正在读取并转换成本地图片数据…');data.push({...item,url:undefined,b64_json:await readRemote(url,signal)});}
   state.convertedResults+=data.length;note('图片已转为完整数据，交由系统保存本地。');return new Response(JSON.stringify({...payload,url:undefined,data}),{status:200,headers:{'Content-Type':'application/json'}});
  }catch(error){state.unsavedResults++;let detail=error.name==='AbortError'?'读取图片超时或已取消':error instanceof TypeError?'浏览器无法读取图片原地址（网络或跨域）':String(error.message||'读取失败');note('生图已返回，但本地保存失败：'+detail+'。未自动重新生图。');
   // HTTP 200 + explicit error prevents Roche's edit fallback from issuing a
   // second paid generation for a result already generated by the provider.
   return new Response(JSON.stringify({error:{code:'local_image_save_failed',message:state.lastStatus}}),{status:200,headers:{'Content-Type':'application/json'}});
  }
 }
 async function wrapped(input,init){
  const args=arguments;if(!state.active)return Reflect.apply(upstream,this,args);
  let request,url,body,headers,should=false;
  try{url=typeof input==='string'||input instanceof URL?String(input):input.url;}catch{return Reflect.apply(upstream,this,args);}
  if(isImgBBUpload(url)&&String(init?.method??input?.method??'GET').toUpperCase()==='POST')return guardImgBB(await Reflect.apply(upstream,this,args),init?.signal??input?.signal);
  try{if(!matches(url)&&!(typeof init?.body==='string'&&init.body.includes('foxapi.chat')))return Reflect.apply(upstream,this,args);request=new Request(input instanceof Request?input.clone():input,init);url=request.url;if(request.method.toUpperCase()!=='POST')return Reflect.apply(upstream,this,args);
   const type=request.headers.get('content-type')||'';headers=new Headers(request.headers);
   if(/application\/json/i.test(type)){const payload=await request.clone().json(),fixed=formatJSON(payload,url);if(!fixed)return Reflect.apply(upstream,this,args);body=JSON.stringify(fixed);should=true;}
   else if(matches(url)&&/multipart\/form-data/i.test(type)){const form=await request.clone().formData();if(!isModel(form.get('model')))return Reflect.apply(upstream,this,args);form.set('response_format','b64_json');body=form;headers.delete('content-type');should=true;}
   else return Reflect.apply(upstream,this,args);
   request=new Request(request,{body,headers});
  }catch{return Reflect.apply(upstream,this,args);}
  if(!should)return Reflect.apply(upstream,this,args);state.formattedRequests++;note('已要求本次生图返回完整图片数据，等待服务商结果。');
  const response=await Reflect.apply(upstream,this,[request]);return localResponse(response,request.signal);
 }
 function paint(){if(!state.active||paintQueued)return;paintQueued=true;queueMicrotask(()=>{paintQueued=false;if(!state.active)return;
  if(!panel?.isConnected){const title=[...document.querySelectorAll('h1')].find(n=>n.textContent.trim()==='图床与图片同步'),main=title?.closest('header')?.parentElement?.querySelector('main');if(!main)return;panel=document.createElement('section');panel.style.cssText='padding:20px;margin:16px 0;border:1px solid #eee;border-radius:18px;background:#fafafa;color:#333;font:13px/1.6 -apple-system,sans-serif';panel.innerHTML='<strong>图片本地保存保护 · v'+state.version+'</strong><p data-imgbb-status></p><p data-local-image-status></p><p data-local-image-counts></p><button type="button">打开最近未能保存的图片</button>';panel.querySelector('button').addEventListener('click',()=>{const url=https(state.lastURL);if(url)window.open(url,'_blank','noopener,noreferrer');});main.append(panel);}
  const host=panel.querySelector('[data-imgbb-status]'),hostText='ImgBB：验证通过 '+state.hostVerified+' 张，保护本地原图 '+state.hostBlocked+' 张。'+state.hostStatus;if(host.textContent!==hostText)host.textContent=hostText;
  const status=panel.querySelector('[data-local-image-status]'),counts=panel.querySelector('[data-local-image-counts]'),text=state.lastStatus,countText='本次页面：已收到图片数据 '+state.inlineResults+' 次，外链已转换 '+state.convertedResults+' 张，未能保存 '+state.unsavedResults+' 次。';if(status.textContent!==text)status.textContent=text;if(counts.textContent!==countText)counts.textContent=countText;panel.querySelector('button').hidden=!state.lastURL;
 });}
 window.fetch=wrapped;observer=new MutationObserver(paint);observer.observe(document.body,{subtree:true,childList:true});paint();
 window.RocheImageLocalSave={version:state.version,getStatus(){return {version:state.version,active:state.active,formattedRequests:state.formattedRequests,inlineResults:state.inlineResults,convertedResults:state.convertedResults,unsavedResults:state.unsavedResults,lastStatus:state.lastStatus,hostVerified:state.hostVerified,hostBlocked:state.hostBlocked,hostStatus:state.hostStatus};},destroy(){state.active=false;observer.disconnect();panel?.remove();if(window.fetch===wrapped)window.fetch=upstream;}};
 window.RochePlugin?.register?.({id:'roche-image-local-save',name:'图片本地保存保护',version:state.version});
})();
