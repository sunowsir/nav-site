/* =============================================================================
 * Hubble - 前端 app.js
 *
 * 模块清单（顺序加载）：
 *   1. CONFIG    主题 / 视图常量
 *   2. UTIL      DOM、安全字符串、localStorage 帮助器
 *   3. AUTH      解锁状态管理（localStorage）
 *   4. CARD      三种卡片：siteCard / compactRow / lockCard / siteLockCard
 *   5. RENDER    renderGroup / renderGrid / renderList / renderCompact
 *   6. THEME     主题切换、视图切换、品牌应用
 *   7. PROBE      健康探测
 *   8. BG        动态背景（背景图 + 主题色/渐变，无粒子）
 *   9. BOOT      init / safeCall 启动入口
 *
 * 架构原则：
 *   - IIFE 隔离全局
 *   - 每个模块命名空间清晰
 *   - 主流程 try/catch，单点失败不连累全局
 *   - 视图模式用对象查表，不用 if/else 链
 * ============================================================================= */
(function () {
  'use strict';

  /* ===========================================================================
   * 1. CONFIG
   * =========================================================================*/
  var CONFIG = {
    THEMES: [
      { id: 'atelier',   name: 'Atelier' },
      { id: 'brutalist', name: 'Brutalist' },
      { id: 'nocturne',  name: 'Nocturne' },
    ],
    VIEWS: {
      grid:    { label: '网格', render: 'renderGrid' },
      list:    { label: '列表', render: 'renderList' },
      compact: { label: '紧凑', render: 'renderCompact' },
    },
    STORAGE: {
      VIEW:      'hubble.view',
      UNLOCKED:  'hubble.unlockedGroups',
      ATTEMPTS:  'hubble.pwdAttempts',
      ATTEMPTS_COOLDOWN_MS: 30000,
      ATTEMPTS_MAX: 3,
    },
    PROBE_INTERVAL_MS: 5 * 60 * 1000,  // 每 5 分钟自动探测
    PARTICLE_LAYER_DISABLED: true,       // 强制禁用粒子层（保留为 future flag）
  };

  /* ===========================================================================
   * 2. UTIL
   * =========================================================================*/
  var Util = {
    $:        function (sel, root) { return (root || document).querySelector(sel); },
    $$:       function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    safeStr:  function (v) { return v == null ? '' : String(v); },
    escapeHtml: function (s) {
      return Util.safeStr(s).replace(/[&<>"']/g, function (c) {
        return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
      });
    },
    hostFromUrl: function (u) {
      try { return new URL(Util.safeStr(u)).hostname.replace(/^www\./, ''); }
      catch (e) { return ''; }
    },
    initials: function (name) {
      var t = Util.safeStr(name).trim();
      if (!t) return '?';
      if (/[\u4e00-\u9fa5]/.test(t[0])) return t[0];
      var p = t.split(/\s+/).filter(Boolean);
      if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
      return t.slice(0, 2).toUpperCase();
    },
    /* localStorage 安全读写 */
    lsGet: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    lsSet: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    lsGetJSON: function (k, fb) {
      try { var v = JSON.parse(Util.lsGet(k) || JSON.stringify(fb)); return v; }
      catch (e) { return fb; }
    },
    lsSetJSON: function (k, v) { try { Util.lsSet(k, JSON.stringify(v)); } catch (e) {} },
    /* 简单的 addEventListener 包装 */
    on: function (el, ev, fn) { if (el) el.addEventListener(ev, fn); },
    /* 统一的"修改可能改视图的设置"：立刻重渲 + 标脏 */
    markDirty: function () {
      dirty = true;
      var sBtn = $('#save-btn');
      if (sBtn) { sBtn.disabled = false; sBtn.textContent = '保存 *'; }
    },
  };

  /* ===========================================================================
   * 3. AUTH（解锁状态）
   * =========================================================================*/
  var Auth = {
    isGroupUnlocked: function (gid) {
      var m = Util.lsGetJSON(CONFIG.STORAGE.UNLOCKED, {});
      return !!m[gid];
    },
    markGroupUnlocked: function (gid) {
      var m = Util.lsGetJSON(CONFIG.STORAGE.UNLOCKED, {});
      m[gid] = true;
      Util.lsSetJSON(CONFIG.STORAGE.UNLOCKED, m);
    },
    clearGroupUnlocked: function (gid) {
      var m = Util.lsGetJSON(CONFIG.STORAGE.UNLOCKED, {});
      delete m[gid];
      Util.lsSetJSON(CONFIG.STORAGE.UNLOCKED, m);
    },
    siteKey: function (gid, url) { return Util.safeStr(gid) + '::' + Util.safeStr(url); },
    isSiteUnlocked: function (gid, url) {
      var m = Util.lsGetJSON(CONFIG.STORAGE.UNLOCKED, {});
      return !!m[Auth.siteKey(gid, url)];
    },
    markSiteUnlocked: function (gid, url) {
      var m = Util.lsGetJSON(CONFIG.STORAGE.UNLOCKED, {});
      m[Auth.siteKey(gid, url)] = true;
      Util.lsSetJSON(CONFIG.STORAGE.UNLOCKED, m);
    },
    /* 密码尝试冷却 */
    attempts: function () { return Util.lsGetJSON(CONFIG.STORAGE.ATTEMPTS, {}); },
    recordFail: function (gid) {
      var a = Auth.attempts();
      a[gid] = a[gid] || { count: 0 };
      a[gid].count++;
      if (a[gid].count >= CONFIG.STORAGE.ATTEMPTS_MAX) {
        a[gid].until = Date.now() + CONFIG.STORAGE.ATTEMPTS_COOLDOWN_MS;
      }
      Util.lsSetJSON(CONFIG.STORAGE.ATTEMPTS, a);
    },
    resetAttempts: function (gid) {
      var a = Auth.attempts();
      delete a[gid];
      Util.lsSetJSON(CONFIG.STORAGE.ATTEMPTS, a);
    },
    isInCooldown: function (gid) {
      var a = Auth.attempts()[gid];
      return !!(a && a.until && Date.now() < a.until);
    },
    cooldownLeft: function (gid) {
      var a = Auth.attempts()[gid];
      if (!a || !a.until) return 0;
      return Math.max(0, a.until - Date.now());
    },
  };

  /* ===========================================================================
   * 4. CARD（站点卡片）
   * =========================================================================*/
  var Card = {
    /* 多源 avatar：用户自定义 → Clearbit → Google favicon → 首字母 */
    makeAvatar: function (host, init, customLogo) {
      var wrap = document.createElement('div');
      wrap.className = 'card-avatar';
      wrap.setAttribute('data-init', init);
      var urls = customLogo
        ? [customLogo,
           'https://logo.clearbit.com/' + encodeURIComponent(host),
           'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=128']
        : ['https://logo.clearbit.com/' + encodeURIComponent(host),
           'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=128'];
      var idx = 0;
      function tryNext() {
        if (idx >= urls.length) {
          wrap.dataset.fallback = '1';
          wrap.innerHTML = '';
          var s = document.createElement('span');
          s.textContent = init;
          wrap.appendChild(s);
          return;
        }
        var img = document.createElement('img');
        img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
        img.src = urls[idx++];
        img.onerror = tryNext;
        wrap.innerHTML = '';
        wrap.appendChild(img);
      }
      tryNext();
      return wrap;
    },
    /* 状态点 + 延迟标签 */
    makeMeta: function () {
      var meta = document.createElement('div');
      meta.className = 'card-meta';
      var st = document.createElement('span');
      st.className = 'card-status';
      st.dataset.role = 'status';
      st.textContent = '检查中…';
      var lt = document.createElement('span');
      lt.className = 'card-latency';
      lt.dataset.role = 'latency';
      meta.appendChild(st);
      meta.appendChild(lt);
      return meta;
    },
    /* 合并用户自定义字段 */
    mergeEffective: function (site) {
      return {
        name: site.customName || site.name,
        desc: site.customDesc || site.desc,
        logoUrl: site.customLogo || null,
        url: site.url,
        orient: site.orient || 'horizontal',
      };
    },
    /* 网格/列表通用大卡 */
    siteCard: function (site) {
      var e = Card.mergeEffective(site);
      var a = document.createElement('a');
      a.className = 'card';
      a.href = e.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.dataset.name = Util.safeStr(e.name).toLowerCase();
      a.dataset.desc = Util.safeStr(e.desc).toLowerCase();
      a.dataset.url = e.url;
      a.dataset.status = 'checking';
      a.dataset.domain = Util.hostFromUrl(e.url);

      a.appendChild(Card.makeAvatar(Util.hostFromUrl(e.url), Util.initials(e.name), e.logoUrl));

      var body = document.createElement('div');
      body.className = 'card-body';
      var n = document.createElement('p'); n.className = 'card-name'; n.textContent = e.name; body.appendChild(n);
      var d = document.createElement('p'); d.className = 'card-domain'; d.textContent = Util.hostFromUrl(e.url); body.appendChild(d);
      if (e.desc) {
        var ds = document.createElement('p'); ds.className = 'card-desc'; ds.textContent = e.desc; body.appendChild(ds);
      }
      a.appendChild(body);
      a.appendChild(Card.makeMeta());

      // 鼠标位置追踪（CSS 变量）
      a.addEventListener('mousemove', function (ev) {
        var r = a.getBoundingClientRect();
        a.style.setProperty('--mx', ((ev.clientX - r.left) / r.width * 100) + '%');
        a.style.setProperty('--my', ((ev.clientY - r.top) / r.height * 100) + '%');
      });
      // 右键 / 长按 → 站点编辑面板（settings.js 提供）
      a.addEventListener('contextmenu', function (ev) { ev.preventDefault(); if (window.HubbleEdit) window.HubbleEdit.open(site); });
      return a;
    },
    /* 紧凑视图横条 */
    compactRow: function (site) {
      var e = Card.mergeEffective(site);
      var a = document.createElement('a');
      a.className = 'row-card';
      a.href = e.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.dataset.name = Util.safeStr(e.name).toLowerCase();
      a.dataset.desc = Util.safeStr(e.desc).toLowerCase();
      a.dataset.url = e.url;
      a.dataset.status = 'checking';
      a.dataset.domain = Util.hostFromUrl(e.url);

      a.appendChild(Card.makeAvatar(Util.hostFromUrl(e.url), Util.initials(e.name), e.logoUrl));

      var info = document.createElement('div');
      info.className = 'row-info';
      var n = document.createElement('span'); n.className = 'row-name'; n.textContent = e.name; info.appendChild(n);
      var d = document.createElement('span'); d.className = 'row-domain'; d.textContent = Util.hostFromUrl(e.url); info.appendChild(d);
      a.appendChild(info);
      a.appendChild(Card.makeMeta());
      return a;
    },
  };

  /* ===========================================================================
   * 5. RENDER（视图 + 分组）
   * =========================================================================*/
  var Render = {
    /* 视图渲染器：grid / list / compact → 返回 grid 容器 */
    grid: function (sites) {
      var grid = document.createElement('div');
      grid.className = 'grid';
      sites.forEach(function (s) { grid.appendChild(Card.siteCard(s)); });
      return grid;
    },
    list: function (sites) {
      var list = document.createElement('div');
      list.className = 'list-view';
      sites.forEach(function (s) { list.appendChild(Card.siteCard(s)); });
      return list;
    },
    compact: function (sites) {
      var list = document.createElement('div');
      list.className = 'compact-view';
      sites.forEach(function (s) { list.appendChild(Card.compactRow(s)); });
      return list;
    },
    /* 单个分组的渲染（决定锁/可见分类） */
    group: function (g) {
      var sites = g.sites || [];
      if (sites.length === 0) return null;

      var hasGroupPwd = !!g.password;
      var groupUnlocked = Auth.isGroupUnlocked(g.id);
      var visibleSites = [];
      var lockedCards  = [];

      sites.forEach(function (s) {
        var hasSitePwd = !!s.password;
        if (hasSitePwd) {
          if (Auth.isSiteUnlocked(g.id, s.url)) visibleSites.push(s);
          else lockedCards.push({ g: g, s: s, kind: 'site' });
        } else if (hasGroupPwd) {
          if (groupUnlocked) visibleSites.push(s);
          else lockedCards.push({ g: g, s: s, kind: 'group' });
        } else {
          visibleSites.push(s);
        }
      });

      // 分组级锁：直接显示大锁定卡（不重复渲染每个站点）
      if (hasGroupPwd && !groupUnlocked) {
        var sec = document.createElement('section');
        sec.className = 'group';
        sec.dataset.groupId = Util.safeStr(g.id);
        sec.appendChild(Lock.groupCard(g));
        return sec;
      }

      var sec = document.createElement('section');
      sec.className = 'group';
      sec.dataset.groupId = Util.safeStr(g.id);

      // 标题 + 计数 + 重新锁定
      var h2 = document.createElement('h2');
      h2.className = 'group-title';
      h2.textContent = g.title;
      var cnt = document.createElement('span');
      cnt.className = 'group-count';
      cnt.textContent = lockedCards.length
        ? visibleSites.length + '/' + sites.length
        : String(visibleSites.length);
      h2.appendChild(cnt);
      if (hasGroupPwd) {
        var relock = document.createElement('button');
        relock.className = 'ghost-btn small';
        relock.textContent = '🔒 重新锁定';
        relock.addEventListener('click', function () {
          Auth.clearGroupUnlocked(g.id);
          Render.main();
        });
        h2.appendChild(relock);
      }
      sec.appendChild(h2);

      // 视图渲染
      if (visibleSites.length > 0) {
        var view = Util.lsGet(CONFIG.STORAGE.VIEW) || 'grid';
        var renderer = Render[view] || Render.grid;
        sec.appendChild(renderer(visibleSites));
      }
      // 站点级锁
      lockedCards.forEach(function (c) {
        if (c.kind === 'site') sec.appendChild(Lock.siteCard(c.g, c.s));
      });

      return sec;
    },
    /* 主渲染：清空 #app，按视图渲染所有分组 */
    main: function () {
      var app = Util.$('#app');
      if (!app || !state.data) return;
      app.innerHTML = '';
      Theme.apply(state.data.theme);
      Theme.applyBrand(state.data);
      var groups = (state.data.groups || []).filter(function (g) { return g.sites && g.sites.length > 0; });
      if (groups.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'state-loading';
        empty.textContent = '还没有任何站点。';
        app.appendChild(empty);
        Render.applyFilter();
        return;
      }
      groups.forEach(function (g) {
        var sec = Render.group(g);
        if (sec) app.appendChild(sec);
      });
      Render.applyFilter();
    },
    /* 搜索过滤：隐藏不匹配的卡片 */
    applyFilter: function () {
      var q = (state.query || '').trim().toLowerCase();
      Util.$$('.card, .row-card').forEach(function (c) {
        if (!q) { c.classList.remove('hidden'); return; }
        var hit = (c.dataset.name || '').indexOf(q) >= 0
               || (c.dataset.desc || '').indexOf(q) >= 0
               || (c.dataset.domain || '').indexOf(q) >= 0;
        c.classList.toggle('hidden', !hit);
      });
      Util.$$('.group').forEach(function (g) {
        var visible = g.querySelectorAll('.card:not(.hidden), .row-card:not(.hidden)').length;
        g.style.display = visible === 0 ? 'none' : '';
      });
    },
  };

  /* ===========================================================================
   * 6. THEME（主题 / 品牌 / 视图切换）
   * =========================================================================*/
  var Theme = {
    apply: function (themeId) {
      if (!themeId) return;
      document.documentElement.setAttribute('data-theme', themeId);
    },
    applyBrand: function (data) {
      if (!data) return;
      var b = data.brand || {};
      var title = b.customTitle || data.title || 'Hubble';
      var subtitle = b.customSubtitle || data.subtitle || '';
      var h1 = Util.$('#site-title'); if (h1) h1.textContent = title;
      var sub = Util.$('#site-subtitle'); if (sub) sub.textContent = subtitle;
      document.title = title;
      // 顶栏 brand-mark 自定义 logo
      var mark = Util.$('.brand-mark');
      if (mark && b.customLogo) {
        mark.innerHTML = '';
        var img = document.createElement('img');
        img.src = b.customLogo;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:50%';
        img.onerror = function () {
          mark.innerHTML = '';
          mark.style.background = 'radial-gradient(circle,var(--accent) 0 25%,transparent 26%)';
          mark.style.border = '2px solid var(--accent)';
        };
        mark.appendChild(img);
        mark.style.background = 'transparent';
        mark.style.border = 'none';
      }
    },
    renderSwitcher: function () {
      // 已删除顶栏主题切换器入口（统一在 settings 页改）
    },
    renderViewSwitcher: function () {
      var box = Util.$('#view-switcher');
      if (!box) return;
      var current = Util.lsGet(CONFIG.STORAGE.VIEW) || 'grid';
      Util.$$('.view-btn', box).forEach(function (b) {
        b.classList.toggle('active', b.dataset.view === current);
        b.onclick = function () {
          Util.lsSet(CONFIG.STORAGE.VIEW, b.dataset.view);
          Util.$$('.view-btn', box).forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          Render.main();
        };
      });
    },
  };

  /* ===========================================================================
   * 7. PROBE（健康探测）
   * =========================================================================*/
  var Probe = {
    run: function () {
      if (!state.data) return Promise.resolve();
      var cards = Util.$$('.card, .row-card');
      if (cards.length === 0) return Promise.resolve();
      var urls = cards.map(function (c) { return c.href; });
      return fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urls }),
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !Array.isArray(data.results)) return;
        cards.forEach(function (c, i) {
          var r = data.results[i]; if (!r) return;
          var status = 'unknown';
          if (r.ok && r.latency != null) status = r.latency < 800 ? 'up' : 'slow';
          else status = 'down';
          c.dataset.status = status;
          var stEl = c.querySelector('[data-role="status"]');
          if (stEl) {
            stEl.textContent = status === 'up' ? '● 在线' : status === 'slow' ? '● 较慢' : status === 'down' ? '● 不可达' : '● 未知';
            stEl.dataset.s = status;
          }
          var ltEl = c.querySelector('[data-role="latency"]');
          if (ltEl) {
            if (r.latency != null) {
              ltEl.textContent = r.latency + 'ms';
              ltEl.dataset.fast = r.latency < 500 ? 'true' : 'false';
            } else ltEl.textContent = '—';
          }
        });
      })
      .catch(function (err) { console.warn('[Hubble] probe failed:', err); });
    },
    scheduleLoop: function () {
      setInterval(Probe.run, CONFIG.PROBE_INTERVAL_MS);
    },
  };

  /* ===========================================================================
   * 8. BG（动态背景）—— 彻底无粒子
   * =========================================================================*/
  var BG = {
    cache: {},  // url -> Image
    canvas: null,
    ctx: null,
    w: 0,
    h: 0,
    raf: 0,

    init: function () {
      BG.canvas = Util.$('#bg-canvas');
      if (!BG.canvas) return;
      BG.ctx = BG.canvas.getContext('2d');
      if (!BG.ctx) return;
      BG.resize();
      BG.render();
      var rt;
      window.addEventListener('resize', function () {
        clearTimeout(rt);
        rt = setTimeout(function () { BG.resize(); BG.render(); }, 200);
      });
      new MutationObserver(function () {
        var cfg = BG.cfg();
        if (cfg.bgImage) BG.preload(cfg.bgImage);
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    },
    resize: function () {
      var dpr = window.devicePixelRatio || 1;
      BG.w = BG.canvas.width = window.innerWidth * dpr;
      BG.h = BG.canvas.height = window.innerHeight * dpr;
      BG.canvas.style.width = window.innerWidth + 'px';
      BG.canvas.style.height = window.innerHeight + 'px';
    },
    /* 读当前主题的 cfg（背景图/透明度/模糊度） */
    cfg: function () {
      var theme = document.documentElement.getAttribute('data-theme') || 'nocturne';
      if (state.data && state.data.themes && state.data.themes[theme]) {
        return state.data.themes[theme];
      }
      return { bgImage: '', bgOpacity: 1, bgBlur: 0 };
    },
    preload: function (url) {
      if (!url || (BG.cache[url] && BG.cache[url].complete)) return;
      var img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload  = function () {
        console.log('[Hubble BG] 背景图已加载:', url, img.naturalWidth + 'x' + img.naturalHeight);
        BG.cache[url] = img;
      };
      img.onerror = function () {
        console.warn('[Hubble BG] 背景图加载失败:', url);
        delete BG.cache[url];
      };
      img.src = url;
      BG.cache[url] = img;
    },
    render: function () {
      BG.ctx.clearRect(0, 0, BG.w, BG.h);
      var cfg = BG.cfg();
      var drewBg = false;

      // 1. 背景图优先（如果有）
      if (cfg.bgImage) {
        var img = BG.cache[cfg.bgImage];
        if (img && img.complete && img.naturalWidth > 0) {
          drewBg = true;
          if (!document.body.classList.contains('has-bg-image')) {
            document.body.classList.add('has-bg-image');
          }
          var opacity = (cfg.bgOpacity == null) ? 1 : cfg.bgOpacity;
          var blur = cfg.bgBlur || 0;
          var ratio = Math.max(BG.w / img.naturalWidth, BG.h / img.naturalHeight);
          var iw = img.naturalWidth * ratio;
          var ih = img.naturalHeight * ratio;
          BG.ctx.save();
          BG.ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
          if (blur > 0) BG.ctx.filter = 'blur(' + blur + 'px)';
          BG.ctx.drawImage(img, (BG.w - iw) / 2, (BG.h - ih) / 2, iw, ih);
          BG.ctx.restore();
        } else if (document.body.classList.contains('has-bg-image')) {
          document.body.classList.remove('has-bg-image');
        }
        BG.preload(cfg.bgImage);
      } else if (document.body.classList.contains('has-bg-image')) {
        document.body.classList.remove('has-bg-image');
      }

      // 2. 没图时画主题色/渐变底（CSS 字符串直接喂给 ctx.fillStyle）
      if (!drewBg) {
        var root = getComputedStyle(document.documentElement);
        var bg = root.getPropertyValue('--bg-grad').trim() || root.getPropertyValue('--bg').trim();
        BG.ctx.fillStyle = bg || '#0a0a0c';
        BG.ctx.fillRect(0, 0, BG.w, BG.h);
      }

      BG.raf = requestAnimationFrame(BG.render);
    },
  };

  /* ===========================================================================
   * 9. BOOT（启动 + 全局状态）
   * =========================================================================*/
  var state = {
    data: null,
    query: '',
  };
  var dirty = false;

  function bindEvents() {
    var input = Util.$('#search-input');
    if (input) {
      input.addEventListener('input', function (e) {
        state.query = e.target.value;
        Render.applyFilter();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { input.value = ''; state.query = ''; Render.applyFilter(); input.blur(); }
      });
    }
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (input) { input.focus(); input.select(); }
      }
    });
  }

  function init() {
    /* 预加载当前主题的背景图（如果有） */
    var cfg0 = (function () {
      var theme = document.documentElement.getAttribute('data-theme') || 'nocturne';
      return (state.data && state.data.themes && state.data.themes[theme]) || {};
    })();
    if (cfg0.bgImage) BG.preload(cfg0.bgImage);

    return fetch('/api/sites')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.data = data;
        Render.main();
        Theme.renderViewSwitcher();
        return Probe.run();
      })
      .then(function () { Probe.scheduleLoop(); })
      .catch(function (err) {
        console.error('[Hubble] init error:', err);
        var app = Util.$('#app');
        if (app) {
          app.innerHTML = '';
          var e = document.createElement('div');
          e.className = 'state-loading';
          e.textContent = '加载失败：' + (err && err.message || err);
          app.appendChild(e);
        }
      });
  }

  /* 单点失败不影响全局 */
  function safeCall(name, fn) {
    try { fn(); }
    catch (e) { console.error('[Hubble] ' + name + ' error:', e); }
  }

  function start() {
    safeCall('initBackground', BG.init);
    safeCall('bindEvents', bindEvents);
    safeCall('init', init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* 调试入口（让 settings.js / 控制台能直接调） */
  window.Hubble = {
    state: state,
    CONFIG: CONFIG,
    Auth: Auth,
    Render: Render,
    BG: BG,
    Theme: Theme,
    Probe: Probe,
  };

  /* 设置页用：触发主重渲染（点保存后调用） */
  window.HubbleRerender = Render.main;

})();
