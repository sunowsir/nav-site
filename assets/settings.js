/* =============================================================================
 * Hubble - 设置页 settings.js
 *
 * 模块清单：
 *   1. CONFIG    主题列表、默认值、字段定义
 *   2. UTIL      与 app.js 共享的工具函数（不重复造轮子）
 *   3. UI        表单组件：field / range / heading
 *   4. PANEL     5 个面板：brand / theme / groups / fields / data
 *   5. EDIT      站点编辑弹窗
 *   6. SAVE      数据保存 + 自动重载调度器
 *   7. BOOT      init / bindNav
 * ============================================================================= */
(function () {
  'use strict';

  /* ===========================================================================
   * 1. CONFIG
   * =========================================================================*/
  var CONFIG = {
    THEMES: [
      { id: 'atelier',   name: 'Atelier',    desc: '瑞士设计 / 编辑风',   preview: 'preview-atelier' },
      { id: 'brutalist', name: 'Brutalist',  desc: '新粗野主义 / 警示黄', preview: 'preview-brutalist' },
      { id: 'nocturne',  name: 'Nocturne',   desc: '暗色奢华 / 香槟金',   preview: 'preview-nocturne' },
    ],
    DEFAULTS: {
      themes: {
        aurora:    { bgImage:'', bgOpacity:0.30, bgBlur:0, particleDensity: 80 },
        editorial: { bgImage:'', bgOpacity:0.25, bgBlur:0, particleDensity: 40 },
        neon:      { bgImage:'', bgOpacity:0.40, bgBlur:0, particleDensity: 100 },
      },
    },
  };

  /* ===========================================================================
   * 2. UTIL
   * =========================================================================*/
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function safeStr(v) { return v == null ? '' : String(v); }
  function escapeHtml(s) {
    return safeStr(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (k === 'checked' || k === 'disabled') { if (attrs[k]) e.setAttribute(k, ''); }
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else if (c) e.appendChild(c);
    });
    return e;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsGetJSON(k, fb) {
    try { return JSON.parse(lsGet(k) || JSON.stringify(fb)); }
    catch (e) { return fb; }
  }

  /* ===========================================================================
   * 3. UI（表单组件）
   * =========================================================================*/
  var UI = {
    /* 通用输入行（label + input + 可选"上传"按钮） */
    field: function (label, id, value, placeholder, onChange, opts) {
      opts = opts || {};
      var wrap = el('div', { class: 'field-row' });
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'stretch';
      wrap.style.gap = '6px';
      wrap.appendChild(el('label', { text: label, class: 'field-row-label' }));

      var inputRow = el('div', { class: 'input-row' });
      inputRow.style.display = 'flex';
      inputRow.style.gap = '8px';
      inputRow.style.alignItems = 'center';

      var input = el('input', { type: 'text' });
      if (id) input.id = id;
      input.value = value || '';
      input.placeholder = placeholder || (opts.upload ? '填写 URL 或点击右侧上传文件' : '请输入文本');
      input.style.flex = '1';
      input.addEventListener('input', function () { onChange(input.value.trim()); });
      inputRow.appendChild(input);

      if (opts.upload) {
        var uploadLabel = el('label', { class: 'ghost-btn small', text: '📁 上传' });
        uploadLabel.style.cursor = 'pointer';
        uploadLabel.style.flexShrink = '0';
        var fileInput = el('input', { type: 'file' });
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', function () {
          if (fileInput.files && fileInput.files[0]) doUpload(fileInput.files[0], input, onChange, wrap);
        });
        uploadLabel.appendChild(fileInput);
        inputRow.appendChild(uploadLabel);
        // 拖拽
        ['dragenter', 'dragover'].forEach(function (ev) {
          input.addEventListener(ev, function (e) { e.preventDefault(); inputRow.style.background = 'var(--surface-2)'; });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
          input.addEventListener(ev, function (e) { e.preventDefault(); inputRow.style.background = ''; });
        });
        input.addEventListener('drop', function (e) {
          var files = e.dataTransfer && e.dataTransfer.files;
          if (files && files[0]) doUpload(files[0], input, onChange, wrap);
        });
      }
      wrap.appendChild(inputRow);
      return wrap;
    },
    /* 滑块（label + 当前值 + range） */
    range: function (label, id, value, min, max, step, onChange) {
      var wrap = el('div', { class: 'field-row' });
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'stretch';
      wrap.style.gap = '6px';
      var top = el('div', { class: 'range-top' });
      top.style.display = 'flex';
      top.style.justifyContent = 'space-between';
      top.style.alignItems = 'center';
      var lab = el('label', { text: label });
      lab.className = 'field-row-label';
      var valSpan = el('span', { class: 'range-val', text: String(value) });
      valSpan.style.fontFamily = 'monospace';
      valSpan.style.fontSize = '13px';
      valSpan.style.color = 'var(--accent)';
      top.appendChild(lab); top.appendChild(valSpan);
      wrap.appendChild(top);
      var input = el('input', { type: 'range' });
      if (id) input.id = id;
      input.min = min; input.max = max; input.step = step;
      input.value = value;
      input.style.width = '100%';
      // rAF 节流：拖动时 60fps 内只调一次 onChange
      var rafId = null;
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        valSpan.textContent = String(v);
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(function () { onChange(v); rafId = null; });
      });
      wrap.appendChild(input);
      return wrap;
    },
    /* 小标题 */
    heading: function (text) {
      var h = el('h3', { text: text });
      h.className = 'settings-subheading';
      return h;
    },
    /* 提示 */
    hint: function (html) {
      var h = el('p', { class: 'hint' });
      h.innerHTML = html;
      return h;
    },
  };

  /* 文件上传 */
  function doUpload(file, input, onChange, wrap) {
    if (file.size > 10 * 1024 * 1024) { toast('文件超过 10MB', 'error'); return; }
    if (!file.type.startsWith('image/')) { toast('只支持图片', 'error'); return; }
    toast('上传中…');
    var fd = new FormData();
    fd.append('file', file);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.onload = function () {
      try {
        var r = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && r.files && r.files[0]) {
          input.value = r.files[0].url;
          onChange(r.files[0].url);
          // 显示预览
          var prev = wrap.querySelector('.upload-preview');
          if (prev) prev.remove();
          if (r.files[0].url) {
            var p = el('div', { class: 'upload-preview' });
            p.style.cssText = 'margin-top:8px;padding:8px;background:var(--surface);border-radius:8px;display:inline-block';
            var img = el('img');
            img.src = r.files[0].url;
            img.style.cssText = 'height:60px;max-width:200px;object-fit:contain';
            p.appendChild(img);
            wrap.appendChild(p);
          }
          toast('已上传到 /data/uploads');
        } else toast('上传失败：' + (r.error || ('HTTP ' + xhr.status)), 'error');
      } catch (e) { toast('解析响应失败', 'error'); }
    };
    xhr.onerror = function () { toast('网络错误', 'error'); };
    xhr.send(fd);
  }

  function toast(msg, type) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    t.style.background = type === 'error' ? 'var(--danger)' : 'var(--text)';
    t.style.color = type === 'error' ? 'white' : 'var(--bg)';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2400);
  }

  /* ===========================================================================
   * 4. PANEL（5 个面板的渲染）
   * =========================================================================*/
  var Panel = {
    /* 品牌面板：logo + 标题 + 副标题 */
    brand: function (box) {
      var b = data.brand || {};
      box.innerHTML = '';
      box.appendChild(UI.field('品牌 Logo', 'brand-logo', b.customLogo || '',
        '填写 URL 或点击右侧上传图片',
        function (v) { data.brand.customLogo = v; markDirty(); reapplyLive(); },
        { upload: true, liveOn: 'change' }));
      box.appendChild(UI.field('自定义标题', 'brand-title', b.customTitle || '',
        '留空用 sites.json 的 title',
        function (v) { data.brand.customTitle = v; markDirty(); }));
      box.appendChild(UI.field('自定义副标题', 'brand-subtitle', b.customSubtitle || '',
        '留空用 sites.json 的 subtitle',
        function (v) { data.brand.customSubtitle = v; markDirty(); }));
    },
    /* 当前主题面板：主题切换 + 该主题的 cfg */
    currentTheme: function (box) {
      box.innerHTML = '';
      var themeId = data.theme || 'aurora';
      data.themes[themeId] = data.themes[themeId] || Object.assign({}, CONFIG.DEFAULTS.themes[themeId]);
      // 主题名标签（点击下方大卡片来切主题）
      var themeName = (CONFIG.THEMES.find(function (t) { return t.id === themeId; }) || { name: themeId }).name;
      box.appendChild(UI.hint('当前主题：<strong>' + escapeHtml(themeName) + '</strong>（点击上方卡片切换）'));
      box.appendChild(UI.field('背景图片', 'theme-bg', data.themes[themeId].bgImage || '',
        '填写 URL 或上传图片，留空用默认主题色',
        function (v) { data.themes[themeId].bgImage = v; markDirty(); reapplyLive(); },
        { upload: true, liveOn: 'change' }));
      box.appendChild(UI.range('背景透明度', 'theme-opacity', data.themes[themeId].bgOpacity, 0, 1, 0.05,
        function (v) { data.themes[themeId].bgOpacity = v; markDirty(); reapplyLive(); }));
      box.appendChild(UI.range('背景模糊度 (px)', 'theme-blur', data.themes[themeId].bgBlur, 0, 30, 1,
        function (v) { data.themes[themeId].bgBlur = v; markDirty(); reapplyLive(); }));
      box.appendChild(UI.range('粒子密度', 'theme-particles', data.themes[themeId].particleDensity, 0, 200, 10,
        function (v) { data.themes[themeId].particleDensity = v; markDirty(); reapplyLive(); }));
    },
    /* 主题预览网格（点击切主题） */
    themes: function (box) {
      box.innerHTML = '';
      CONFIG.THEMES.forEach(function (t) {
        var card = el('div', { class: 'theme-card' + (data.theme === t.id ? ' active' : '') });
        card.dataset.themeId = t.id;
        card.appendChild(el('div', { class: 'theme-card-preview ' + t.preview }));
        card.appendChild(el('div', { class: 'theme-card-name', text: t.name }));
        card.appendChild(el('div', { class: 'theme-card-desc', text: t.desc }));
        card.addEventListener('click', function () {
          data.theme = t.id;
          document.documentElement.setAttribute('data-theme', t.id);
          $$('.theme-card').forEach(function (c) { c.classList.remove('active'); });
          card.classList.add('active');
          markDirty();
          Panel.currentTheme($('#current-theme-panel'));
        });
        box.appendChild(card);
      });
    },
    /* 分组与站点编辑 */
    groups: function (box) {
      box.innerHTML = '';
      (data.groups || []).forEach(function (g, gi) {
        box.appendChild(GroupEditor.render(g, gi));
      });
    },
    /* 全局字段（外观区用） */
    fields: function () {
      var s = data.settings || {};
      function setVal(id, v) { var e = $('#' + id); if (e != null) e.value = v; }
      function setCheck(id, v) { var e = $('#' + id); if (e != null) e.checked = !!v; }
      setVal('set-cardSize', s.cardSize || 'lg');
      setVal('set-density', s.density || 'comfortable');
      setVal('set-maxSites', s.maxSites || 200);
      setCheck('set-showGroupTitle', s.showGroupTitle !== false);
      var f = s.fields || {};
      $$('[data-field]').forEach(function (cb) {
        cb.checked = f[cb.dataset.field] !== false;
      });
    },
  };

  /* ===========================================================================
   * GroupEditor：单个分组的编辑器（标题、id、密码、所有站点行、添加行）
   * =========================================================================*/
  var GroupEditor = {
    render: function (g, gi) {
      var block = el('div', { class: 'group-editor', 'data-group-index': String(gi) });

      // header
      var head = el('div', { class: 'group-editor-header' });
      var titleInput = el('input', { type: 'text' });
      titleInput.value = g.title || '';
      titleInput.placeholder = '分组标题';
      titleInput.addEventListener('input', function () { g.title = titleInput.value; markDirty(); });
      var idInput = el('input', { type: 'text' });
      idInput.value = g.id || '';
      idInput.placeholder = 'id';
      idInput.style.maxWidth = '120px';
      idInput.addEventListener('input', function () { g.id = idInput.value; markDirty(); });
      var delBtn = el('button', { class: 'ghost-btn small', text: '删除分组' });
      delBtn.addEventListener('click', function () {
        if (!confirm('确认删除分组「' + (g.title || '') + '」及其所有站点？')) return;
        data.groups.splice(gi, 1);
        markDirty();
        Panel.groups($('#groups-editor'));
      });
      head.appendChild(titleInput);
      head.appendChild(idInput);
      head.appendChild(delBtn);
      block.appendChild(head);

      // 密码行
      var pwdRow = el('div', { class: 'group-pwd-row' });
      var pwdLabel = el('span', { class: 'site-sched-label', text: '分组密码' });
      var pwdInput = el('input', { type: 'password' });
      pwdInput.value = g.password || '';
      pwdInput.placeholder = '留空=无密码（公开）';
      pwdInput.className = 'glass-input';
      pwdInput.addEventListener('input', function () {
        g.password = pwdInput.value;
        markDirty();
        pwdHint.textContent = pwdInput.value ? '已设置 · 不填则删除密码' : '公开分组';
        pwdHint.style.color = pwdInput.value ? 'var(--success)' : 'var(--text-subtle)';
      });
      var pwdHint = el('span', { class: 'group-pwd-hint', text: g.password ? '已设置' : '公开分组' });
      pwdHint.style.color = g.password ? 'var(--success)' : 'var(--text-subtle)';
      pwdRow.appendChild(pwdLabel);
      pwdRow.appendChild(pwdInput);
      pwdRow.appendChild(pwdHint);
      block.appendChild(pwdRow);

      // 站点行
      (g.sites || []).forEach(function (s, si) {
        var row = el('div', { class: 'site-row' });
        var iName = el('input', { type: 'text' }); iName.value = s.name || ''; iName.placeholder = '名称';
        iName.addEventListener('input', function () { s.name = iName.value; markDirty(); });
        var iUrl = el('input', { type: 'text' }); iUrl.value = s.url || ''; iUrl.placeholder = 'https://...';
        iUrl.addEventListener('input', function () { s.url = iUrl.value; markDirty(); });
        var iDesc = el('input', { type: 'text' }); iDesc.value = s.desc || ''; iDesc.placeholder = '描述';
        iDesc.addEventListener('input', function () { s.desc = iDesc.value; markDirty(); });
        var rmBtn = el('button', { text: '删除' });
        rmBtn.addEventListener('click', function () {
          g.sites.splice(si, 1);
          markDirty();
          Panel.groups($('#groups-editor'));
        });
        row.appendChild(iName); row.appendChild(iUrl); row.appendChild(iDesc); row.appendChild(rmBtn);
        block.appendChild(row);
      });

      // 添加站点行
      var addRow = el('div', { class: 'add-site-row' });
      var nName = el('input', { type: 'text' }); nName.placeholder = '名称';
      var nUrl = el('input', { type: 'text' }); nUrl.placeholder = 'https://...'; nUrl.type = 'url';
      var nDesc = el('input', { type: 'text' }); nDesc.placeholder = '描述（可选）';
      var addBtn = el('button', { text: '+ 添加站点' });
      function tryAdd() {
        var name = nName.value.trim();
        var url = nUrl.value.trim();
        if (!name || !url) return;
        g.sites.push({ name: name, url: url, desc: nDesc.value.trim() });
        markDirty();
        Panel.groups($('#groups-editor'));
      }
      addBtn.addEventListener('click', tryAdd);
      [nName, nUrl, nDesc].forEach(function (i) {
        i.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); tryAdd(); }
        });
      });
      addRow.appendChild(nName); addRow.appendChild(nUrl); addRow.appendChild(nDesc); addRow.appendChild(addBtn);
      block.appendChild(addRow);

      // 自动获取按钮行
      var autoRow = el('div', { style: 'margin-top:8px;display:flex;gap:8px;align-items:center' });
      var autoBtn = el('button', { class: 'ghost-btn small', text: '✨ 自动获取' });
      autoBtn.addEventListener('click', function () {
        var url = nUrl.value.trim();
        if (!url) { toast('请先填 URL', 'error'); return; }
        toast('抓取中…');
        fetch('/api/meta', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url: url }) })
          .then(function (r) { return r.json(); })
          .then(function (meta) {
            if (meta.description && !nDesc.value) { nDesc.value = meta.description; }
            if (meta.title && !nName.value) { nName.value = meta.title.slice(0, 30); }
            if (!meta.description && !meta.title) toast('没抓到内容', 'error');
            else toast('已自动填充');
          })
          .catch(function (e) { toast('抓取失败：' + e.message, 'error'); });
      });
      var autoHint = el('span', { text: '输入 URL 后点击，自动从网页抓取标题和描述' });
      autoHint.style.fontSize = '11px';
      autoHint.style.color = 'var(--text-subtle)';
      autoRow.appendChild(autoBtn);
      autoRow.appendChild(autoHint);
      block.appendChild(autoRow);

      return block;
    },
  };

  /* ===========================================================================
   * 5. EDIT（站点编辑面板）
   * =========================================================================*/
  function openEditPanel(site) {
    if (state.editTarget) closeEditPanel();
    state.editTarget = site;

    var panel = el('div', { id: 'edit-panel', class: 'overlay' });
    panel.innerHTML = '<div class="edit-modal">' +
      '<header class="edit-header"><h3>编辑站点</h3><button class="ghost-btn small" id="edit-close">关闭</button></header>' +
      '<div class="edit-body">' +
        '<div class="field-row"><label>原名</label><span>' + escapeHtml(site.name) + '</span></div>' +
        '<div class="field-row"><label>URL</label><span style="word-break:break-all">' + escapeHtml(site.url) + '</span></div>' +
        '<div class="field-row"><label>自定义名称</label><input type="text" id="edit-name" placeholder="留空使用原名" value="' + escapeHtml(site.customName || '') + '"></div>' +
        '<div class="field-row"><label>自定义副标题/描述</label><input type="text" id="edit-desc" placeholder="留空使用原描述" value="' + escapeHtml(site.customDesc || '') + '"></div>' +
        '<div class="field-row"><label>自定义 Logo URL</label><input type="text" id="edit-logo" placeholder="留空自动获取" value="' + escapeHtml(site.customLogo || '') + '"></div>' +
        '<div class="field-row"><label>卡片方向</label><select id="edit-orient"><option value="horizontal"' + (site.orient==='horizontal'?' selected':'') + '>横屏（默认）</option><option value="vertical"' + (site.orient==='vertical'?' selected':'') + '>竖屏（紧凑）</option></select></div>' +
        '<p class="hint">✦ 留空字段会使用原值；填了则覆盖。修改后自动保存。</p>' +
      '</div></div>';

    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target === panel) closeEditPanel(); });
    $('#edit-close').addEventListener('click', closeEditPanel);

    function bind(id, key) {
      var e = $('#' + id);
      if (!e) return;
      e.addEventListener('input', function () {
        site[key] = e.value.trim();
        saveAndRerender();
      });
    }
    bind('edit-name', 'customName');
    bind('edit-desc', 'customDesc');
    bind('edit-logo', 'customLogo');
    $('#edit-orient').addEventListener('change', function (e) {
      site.orient = e.target.value;
      saveAndRerender();
    });
  }

  function closeEditPanel() {
    var p = $('#edit-panel');
    if (p) p.remove();
    state.editTarget = null;
  }

  /* ===========================================================================
   * 6. SAVE（保存 + 自动重载调度器）
   * =========================================================================*/
  function saveAndRerender() {
    return fetch('/api/sites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function () {
      // 通知主页重渲染（如果还在）
      if (window.HubbleRerender) window.HubbleRerender();
      // 重新拉一次服务器配置（确保一致）
      return load();
    })
    .then(function () {
      markSaved();
      toast('已保存');
    })
    .catch(function (e) { toast('保存失败：' + e.message, 'error'); });
  }

  function markDirty() {
    dirty = true;
    var sBtn = $('#save-btn');
    if (sBtn) { sBtn.disabled = false; sBtn.textContent = '保存 *'; }
  }
  function markSaved() {
    dirty = false;
    var sBtn = $('#save-btn');
    if (sBtn) { sBtn.disabled = true; sBtn.textContent = '已保存 ✓'; setTimeout(function () { sBtn.textContent = '保存'; }, 1800); }
  }

  /* 实时预览（仅改主题相关 + 品牌，不重建 DOM） */
  function reapplyLive() {
    if (!data) return;
    if (data.theme) {
      document.documentElement.setAttribute('data-theme', data.theme);
    }
    var h1 = $('#site-title');
    if (h1) h1.textContent = (data.brand && data.brand.customTitle) || data.title || 'Hubble';
    var sub = $('#site-subtitle');
    if (sub) sub.textContent = (data.brand && data.brand.customSubtitle) || data.subtitle || '';
  }

  /* ===========================================================================
   * 7. BOOT
   * =========================================================================*/
  var state = { data: null, editTarget: null };
  var data = null;  // 全局访问点（与 state.data 同步）
  var dirty = false;

  function load() {
    return fetch('/api/sites').then(function (r) { return r.json(); }).then(function (d) {
      data = d;
      // 合并默认主题配置
      data.themes = data.themes || {};
      Object.keys(CONFIG.DEFAULTS.themes).forEach(function (k) {
        data.themes[k] = Object.assign({}, CONFIG.DEFAULTS.themes[k], data.themes[k] || {});
      });
      data.brand = data.brand || { customTitle: '', customSubtitle: '', customLogo: '' };
      if (data.theme) document.documentElement.setAttribute('data-theme', data.theme);
    });
  }

  function bindForm() {
    function on(id, ev, fn) { var e = $('#' + id); if (e) e.addEventListener(ev, fn); }
    on('set-cardSize', 'change', function (e) {
      data.settings = data.settings || {}; data.settings.cardSize = e.target.value; markDirty();
    });
    on('set-density', 'change', function (e) {
      data.settings = data.settings || {}; data.settings.density = e.target.value; markDirty();
    });
    on('set-maxSites', 'input', function (e) {
      data.settings = data.settings || {}; data.settings.maxSites = parseInt(e.target.value) || 200; markDirty();
    });
    on('set-showGroupTitle', 'change', function (e) {
      data.settings = data.settings || {}; data.settings.showGroupTitle = e.target.checked; markDirty();
    });
    $$('[data-field]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        data.settings = data.settings || {};
        data.settings.fields = data.settings.fields || {};
        data.settings.fields[cb.dataset.field] = cb.checked;
        markDirty();
      });
    });
    on('add-group-btn', 'click', function () {
      data.groups = data.groups || [];
      var id = 'g' + Date.now();
      data.groups.push({ id: id, title: '新分组', sites: [] });
      markDirty();
      Panel.groups($('#groups-editor'));
      // 切到 groups 导航
      $$('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
      var groupsBtn = $$('.nav-btn').find(function (b) { return b.dataset.section === 'groups'; });
      if (groupsBtn) groupsBtn.click();
    });
    on('export-btn', 'click', function () {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: 'sites-export-' + new Date().toISOString().slice(0, 10) + '.json' });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    on('import-input', 'change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function (ev) {
        try {
          var obj = JSON.parse(String(ev.target.result));
          if (!obj || !Array.isArray(obj.groups)) throw new Error('格式错误');
          data = obj;
          markDirty();
          fillAndRender();
          toast('已导入，记得点保存');
        } catch (err) { toast('导入失败：' + err.message, 'error'); }
      };
      r.readAsText(f);
    });
    on('probe-now-btn', 'click', function () {
      fetch('/api/scheduler/fetch', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (r) { toast('立即抓取完成（' + (r.count || 0) + ' 个）'); })
        .catch(function (e) { toast('抓取失败：' + e.message, 'error'); });
    });
    on('auto-fill-all-btn', 'click', function () {
      if (!confirm('自动抓取所有站点的标题和描述？会覆盖当前未填的字段。')) return;
      var urls = [];
      (data.groups || []).forEach(function (g) {
        (g.sites || []).forEach(function (s) {
          if (s.url && (!s.desc || !s.name)) urls.push(s.url);
        });
      });
      if (urls.length === 0) { toast('没有需要补全的站点'); return; }
      toast('开始抓取 ' + urls.length + ' 个站点…');
      var done = 0;
      urls.forEach(function (u) {
        fetch('/api/meta', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url: u }) })
        .then(function (r) { return r.json(); })
        .then(function (meta) {
          (data.groups || []).forEach(function (g) {
            (g.sites || []).forEach(function (s) {
              if (s.url === u) {
                if (meta.title && !s.customName) s.name = meta.title.slice(0, 30);
                if (meta.description && !s.customDesc) s.desc = meta.description;
                if (meta.logo && !s.customLogo) s.customLogo = meta.logo;
              }
            });
          });
          done++;
          if (done === urls.length) {
            markDirty();
            Panel.groups($('#groups-editor'));
            toast('全部抓取完成');
          }
        });
      });
    });
    on('reset-btn', 'click', function () {
      if (!confirm('确认重置为默认配置？此操作不可恢复。')) return;
      data = {
        title: 'Hubble', subtitle: '一站式个人网址导航', theme: 'aurora',
        brand: { customTitle: '', customSubtitle: '', customLogo: '' },
        settings: {
          maxSites: 200,
          fields: { name: true, domain: true, desc: true, latency: true, status: true },
          cardSize: 'lg', density: 'comfortable', showGroupTitle: true,
        },
        groups: [],
      };
      fillAndRender();
      markDirty();
      document.documentElement.setAttribute('data-theme', 'aurora');
    });
    on('save-btn', 'click', saveAndRerender);
    // 离开提醒
    window.addEventListener('beforeunload', function (e) {
      if (dirty) { e.preventDefault(); e.returnValue = '有未保存的更改'; }
    });
  }

  function bindNav() {
    $$('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sec = btn.dataset.section;
        $$('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        $$('.settings-section').forEach(function (s) { s.hidden = s.dataset.section !== sec; });
        // 切到主题时刷新当前主题面板
        if (sec === 'theme') Panel.currentTheme($('#current-theme-panel'));
      });
    });
  }

  function fillAndRender() {
    Panel.fields();
    Panel.groups($('#groups-editor'));
    Panel.themes($('#theme-grid'));
    Panel.brand($('#brand-panel'));
    Panel.currentTheme($('#current-theme-panel'));
    reapplyLive();
  }

  function init() {
    load().then(function () {
      fillAndRender();
      bindNav();
      bindForm();
    }).catch(function (err) {
      var main = $('.settings-main');
      if (main) {
        main.innerHTML = '';
        main.appendChild(el('div', { class: 'state-error', text: '加载配置失败：' + err.message }));
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* 暴露给 app.js 用 */
  window.HubbleSettings = {
    openEditPanel: openEditPanel,
    closeEditPanel: closeEditPanel,
    rerender: fillAndRender,
  };

})();
