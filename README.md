# refimg.js
(function() {
  "use strict";

  var PLUGIN_ID = "refimg";
  var ROOT_CLASS = "roche-plugin-refimg";

  var state = {
    roche: null, containerEl: null,
    imageBase64: null, imageName: "",
    prompt: "", busy: false,
    resultUrl: null, errorMsg: ""
  };

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function render() {
    if (!state.containerEl) return;
    var html = '<div class="' + ROOT_CLASS + '" style="padding:16px;font-family:-apple-system,sans-serif">';
    html += '<div style="font-size:18px;font-weight:700;margin-bottom:12px">参考图生图</div>';

    html += '<input type="file" id="refimg-file" accept="image/*" onchange="window.__refimg.onPickImage(event)" style="display:none">';
    html += '<button onclick="document.getElementById(\'refimg-file\').click()" style="padding:10px 16px;border-radius:10px;border:1px solid #ccc;background:#f5f5f5">选择参考图</button>';

    if (state.imageBase64) {
      html += '<div style="margin:12px 0"><img src="' + state.imageBase64 + '" style="max-width:160px;max-height:160px;border-radius:10px;display:block"></div>';
      html += '<div style="font-size:12px;color:#888;margin-bottom:12px">已选择：' + escapeHtml(state.imageName) + '</div>';
    }

    html += '<textarea id="refimg-prompt" placeholder="描述你想要的画面，比如：保持这个人物的样子，让她穿古装站在樱花树下" style="width:100%;min-height:80px;padding:10px;border-radius:10px;border:1px solid #ccc;box-sizing:border-box;margin:12px 0" oninput="window.__refimg.onPromptInput(event)">' + escapeHtml(state.prompt) + '</textarea>';

    html += '<button onclick="window.__refimg.generate()" ' + (state.busy ? "disabled" : "") + ' style="width:100%;padding:12px;border-radius:12px;border:none;background:#1c1c1e;color:#fff;font-weight:600">' + (state.busy ? "生成中…" : "生成图片") + '</button>';

    if (state.errorMsg) {
      html += '<div style="margin-top:14px;padding:12px;border-radius:10px;background:#fbe9e9;color:#b8433c;font-size:13px;white-space:pre-wrap">' + escapeHtml(state.errorMsg) + '</div>';
    }
    if (state.resultUrl) {
      html += '<div style="margin-top:14px"><div style="font-size:13px;color:#666;margin-bottom:6px">生成结果：</div><img src="' + escapeHtml(state.resultUrl) + '" style="width:100%;border-radius:10px;display:block"></div>';
    }
    html += '</div>';
    state.containerEl.innerHTML = html;
  }

  function onPickImage(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function() { state.imageBase64 = reader.result; state.imageName = file.name; render(); };
    reader.readAsDataURL(file);
  }
  function onPromptInput(ev) { state.prompt = ev.target.value; }

  function extractResultUrl(r) {
    if (!r) return null;
    if (typeof r === "string") return r;
    if (r.url) return r.url;
    if (r.imageUrl) return r.imageUrl;
    if (r.data && r.data[0]) { var d = r.data[0]; if (d.url) return d.url; if (d.b64_json) return "data:image/png;base64," + d.b64_json; }
    if (r.images && r.images[0]) return r.images[0].url || r.images[0];
    if (r.b64_json) return "data:image/png;base64," + r.b64_json;
    return null;
  }

  function tryAllImageApis(roche, imageBase64, prompt) {
    var ai = roche.ai || {};
    var attempts = [];
    if (typeof ai.image === "function") attempts.push(function() { return ai.image({ prompt: prompt, image: imageBase64, referenceImage: imageBase64 }); });
    if (typeof ai.generateImage === "function") attempts.push(function() { return ai.generateImage({ prompt: prompt, image: imageBase64, referenceImage: imageBase64 }); });
    if (typeof ai.editImage === "function") attempts.push(function() { return ai.editImage({ prompt: prompt, image: imageBase64 }); });
    if (typeof ai.imageEdit === "function") attempts.push(function() { return ai.imageEdit({ prompt: prompt, image: imageBase64 }); });
    if (ai.images && typeof ai.images.generate === "function") attempts.push(function() { return ai.images.generate({ prompt: prompt, image: imageBase64 }); });
    if (ai.images && typeof ai.images.edit === "function") attempts.push(function() { return ai.images.edit({ prompt: prompt, image: imageBase64 }); });

    if (!attempts.length) {
      var aiKeys = Object.keys(ai);
      return Promise.reject(new Error("没找到任何生图接口。roche.ai 里现有的方法是：" + (aiKeys.length ? aiKeys.join("，") : "（空）") + "\n\n把这段文字截图发我，我来对症下药。"));
    }
    function tryNext(i, lastErr) {
      if (i >= attempts.length) return Promise.reject(lastErr || new Error("所有已知接口都调用失败了"));
      return Promise.resolve().then(attempts[i]).catch(function(e) { return tryNext(i + 1, e); });
    }
    return tryNext(0, null);
  }

  function generate() {
    if (state.busy) return;
    if (!state.imageBase64) { alert("请先选择一张参考图"); return; }
    if (!state.prompt || !state.prompt.trim()) { alert("请输入想要的画面描述"); return; }
    state.busy = true; state.errorMsg = ""; state.resultUrl = null; render();
    tryAllImageApis(state.roche, state.imageBase64, state.prompt.trim()).then(function(r) {
      var url = extractResultUrl(r);
      state.busy = false;
      if (!url) { state.errorMsg = "接口调用成功了，但没找到图片地址，返回内容是：\n" + JSON.stringify(r).substring(0, 500) + "\n\n把这段文字截图发我。"; }
      else { state.resultUrl = url; }
      render();
    }).catch(function(e) {
      state.busy = false;
      state.errorMsg = "生成失败：\n" + (e && e.message ? e.message : String(e));
      render();
    });
  }

  window.__refimg = { onPickImage: onPickImage, onPromptInput: onPromptInput, generate: generate };

  window.RochePlugin.register({
    id: PLUGIN_ID,
    name: "参考图生图",
    mount: function(container, roche) {
      state.roche = roche; state.containerEl = container;
      state.imageBase64 = null; state.imageName = ""; state.prompt = "";
      state.busy = false; state.resultUrl = null; state.errorMsg = "";
      render();
    },
    unmount: function(container) { state.containerEl = null; }
  });
})();
