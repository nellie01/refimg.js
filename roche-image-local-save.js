/* Roche 图片本地保存保护 v1.0.0
 * For FoxAPI GPT Image requests only: request b64_json in the existing request.
 * Does not generate images on installation, retry requests, upload images,
 * access API settings, or modify existing messages. Expired images need originals.
 */
(() => {
  'use strict';
  window.RocheImageLocalSave?.destroy?.();
  const upstream = window.fetch;
  if (typeof upstream !== 'function') return;
  const state = { version:'1.0.0', active:true, formattedRequests:0 };
  const paths = new Set(['/v1/images/generations','/v1/images/edits']);
  const sendOriginal = (receiver,args) => Reflect.apply(upstream,receiver,args);
  async function wrapped(input,init) {
    const originalArgs = arguments;
    if (!state.active) return sendOriginal(this,originalArgs);
    let url,method;
    try {
      url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
      method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    } catch { return sendOriginal(this,originalArgs); }
    if (url.protocol !== 'https:' || url.hostname !== 'foxapi.chat' || method !== 'POST' || !paths.has(url.pathname.replace(/\/$/,''))) return sendOriginal(this,originalArgs);
    let next;
    try {
      const request = new Request(input instanceof Request ? input.clone() : input,init);
      const type = request.headers.get('content-type') || '';
      const headers = new Headers(request.headers);
      let body,model,currentFormat;
      if (/application\/json/i.test(type)) {
        const payload = await request.clone().json();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendOriginal(this,originalArgs);
        model = String(payload.model || ''); currentFormat = payload.response_format;
        if (!/^gpt-image-/i.test(model) || currentFormat && currentFormat !== 'url') return sendOriginal(this,originalArgs);
        body = JSON.stringify({...payload,response_format:'b64_json'});
      } else if (/multipart\/form-data/i.test(type)) {
        const form = await request.clone().formData();
        model = String(form.get('model') || ''); currentFormat = form.get('response_format');
        if (!/^gpt-image-/i.test(model) || currentFormat && currentFormat !== 'url') return sendOriginal(this,originalArgs);
        form.set('response_format','b64_json'); body = form;
        // Let the browser generate the new multipart boundary.
        headers.delete('content-type');
      } else return sendOriginal(this,originalArgs);
      next = new Request(request,{body,headers});
    } catch { return sendOriginal(this,originalArgs); }
    state.formattedRequests++;
    // Deliberately outside catch: a failed network request must never be resent.
    return Reflect.apply(upstream,this,[next]);
  }
  window.fetch = wrapped;
  window.RocheImageLocalSave = {
    version:state.version,
    getStatus(){return {version:state.version,active:state.active,formattedRequests:state.formattedRequests};},
    destroy(){state.active=false;if(window.fetch===wrapped)window.fetch=upstream;}
  };
  window.RochePlugin?.register?.({id:'roche-image-local-save',name:'图片本地保存保护 · FoxAPI',version:state.version});
})();
