/* =============================================================================
 * Hubble - 后端（零依赖 Node 内置 HTTP）
 *
 * 职责：
 *   1. 静态文件服务（/、/settings、/uploads/...）
 *   2. /api/sites  读写 sites.json
 *   3. /api/probe  HEAD 批量探活
 *   4. /api/meta    抓 og:description + og:image
 *   5. /api/upload  multipart/form-data 文件上传
 *   6. /api/scheduler  列出 / 立即抓取 / 重载调度
 *
 * 设计原则：
 *   - 一个 server.js 一个主文件，按"路由 → 处理器 → 帮助器"分层
 *   - 写操作半途失败要回滚（不要半写状态）
 *   - 调度器只在数据真变化时重载
 *   - 错误统一 JSON 输出
 * ============================================================================= */
'use strict';

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');

/* ----------------------------- 0. 日志模块 ----------------------------- */

/**
 * 结构化日志
 * - LOG_LEVEL = debug | info | warn | error（默认 info）
 * - 每行格式：`[ISO时间] [LEVEL] [模块] 消息`
 * - 写 stdout（容器内 stdout 即 docker logs -f 输出）
 * - 错误同时带 stack trace
 */
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CURRENT_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LOG_LEVELS.info;

function fmtTime() {
  // ISO 字符串 + 毫秒 + 时区（方便 docker logs 直接看）
  return new Date().toISOString();
}

function shouldLog(level) {
  return LOG_LEVELS[level] >= CURRENT_LEVEL;
}

const Logger = {
  debug: function (module, msg, extra) {
    if (!shouldLog('debug')) return;
    console.log(formatLine('DEBUG', module, msg, extra));
  },
  info: function (module, msg, extra) {
    if (!shouldLog('info')) return;
    console.log(formatLine('INFO', module, msg, extra));
  },
  warn: function (module, msg, extra) {
    if (!shouldLog('warn')) return;
    console.warn(formatLine('WARN', module, msg, extra));
  },
  error: function (module, msg, err) {
    if (!shouldLog('error')) return;
    let line = formatLine('ERROR', module, msg);
    if (err && err.stack) line += '\n' + err.stack;
    else if (err) line += ' ' + err;
    console.error(line);
  },
  /* 每次请求都打一条 access log（标准 Apache combined） */
  access: function (req, res, durationMs) {
    if (!shouldLog('info')) return;
    const ua = req.headers['user-agent'] || '-';
    console.log(formatLine('INFO', 'http', `${req.method} ${req.url} ${res.statusCode} ${durationMs}ms "${ua}"`));
  },
};

function formatLine(level, module, msg, extra) {
  let line = `[${fmtTime()}] [${level}] [${module}] ${msg}`;
  if (extra) {
    try { line += ' ' + JSON.stringify(extra); }
    catch (e) { line += ' ' + String(extra); }
  }
  return line;
}

/* ----------------------------- 0. 常量与配置 ----------------------------- */

const ROOT       = __dirname;
const DATA_DIR   = process.env.DATA_DIR
                || (fs.existsSync('/data') && fs.statSync('/data').isDirectory() ? '/data' : ROOT);
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
// UPLOAD_DIR 独立可配。优先级：环境变量 > DATA_DIR/uploads > ROOT/uploads
// 这样即使挂载出错，fallback 也能找到文件
const UPLOAD_DIR_CANDIDATES = [
  process.env.UPLOAD_DIR,
  path.join(DATA_DIR, 'uploads'),
  path.join(ROOT, 'uploads'),
].filter(Boolean);
const UPLOAD_DIR = UPLOAD_DIR_CANDIDATES.find(function (d) {
  try { return fs.existsSync(d) && fs.statSync(d).isDirectory(); }
  catch (e) { return false; }
}) || path.join(DATA_DIR, 'uploads');

const PORT            = parseInt(process.env.PORT || '8080', 10);
const PROBE_TIMEOUT   = parseInt(process.env.PROBE_TIMEOUT   || '5000',  10);
const PROBE_CONCURR   = parseInt(process.env.PROBE_CONCURRENCY || '8', 10);
const COOLDOWN_MS     = 30 * 1000;
const MAX_ATTEMPTS    = 3;
const UPLOAD_MAX_SIZE = 10 * 1024 * 1024;  // 单文件 10MB
const SCHEDULER_SCAN_INTERVAL = 30 * 1000;  // 30 秒扫一次配置变化

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
};

/* ----------------------------- 1. 启动自检 ----------------------------- */

// 首次启动如果挂载卷里没有 sites.json，从镜像自带版本拷贝一份
if (DATA_DIR !== ROOT && !fs.existsSync(SITES_FILE)) {
  try { fs.copyFileSync(path.join(ROOT, 'sites.json'), SITES_FILE); }
  catch (e) { Logger.error('boot', '初始化拷贝失败', e); }
}
if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); }
  catch (e) { Logger.error('boot', '创建 uploads 失败', e); }
}
Logger.info('boot', 'SITES_FILE = ' + SITES_FILE);
Logger.info('boot', 'UPLOAD_DIR  = ' + UPLOAD_DIR);

/* ----------------------------- 2. 通用帮助器 ----------------------------- */

function sendJSON(res, status, body, extraHeaders) {
  const text = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }, extraHeaders || {}));
  res.end(text);
}

function sendText(res, status, text, type) {
  res.writeHead(status, {
    'Content-Type': (type || 'text/plain') + '; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function safeStr(v){ return v == null ? '' : String(v); }

/* ----------------------------- 3. sites.json 读写（含回滚） ----------------------------- */

/**
 * 同步读取 sites.json。
 * 注意：读到的对象是 JSON.parse 出来的，**外部直接修改不影响磁盘**，必须显式 PUT 才落盘。
 */
function readSites() {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(SITES_FILE, 'utf8')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 写 sites.json，**带 .bak 备份与回滚**：
 *   1. 先读当前文件 → 写 .bak
 *   2. 原子写 tmp → rename 替换
 *   3. 失败时从 .bak 回滚
 * 这样在写半途断电/容器崩溃时，磁盘上始终有一份可用数据。
 */
function writeSites(data) {
  let backupPath = null;
  try {
    if (fs.existsSync(SITES_FILE)) {
      backupPath = SITES_FILE + '.bak';
      fs.copyFileSync(SITES_FILE, backupPath);
    }
    const tmp = SITES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, SITES_FILE);
    return { ok: true };
  } catch (e) {
    if (backupPath && fs.existsSync(backupPath)) {
      try { fs.copyFileSync(backupPath, SITES_FILE); } catch (_) {}
    }
    return { ok: false, error: e.message };
  }
}

/* ----------------------------- 4. 探测与抓取 ----------------------------- */

/** 单 URL HEAD 探测（解析延迟 + 状态码） */
function probeSite(targetUrl) {
  return new Promise(function (resolve) {
    let parsed;
    try { parsed = new URL(targetUrl); }
    catch (e) { return resolve({ ok: false, status: null, latency: null, error: 'invalid-url' }); }
    const lib  = parsed.protocol === 'https:' ? https : http;
    const opts = {
      method: 'HEAD',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: (parsed.pathname || '/') + (parsed.search || ''),
      timeout: PROBE_TIMEOUT,
      headers: { 'User-Agent': 'Hubble-Health-Probe/1.0' },
    };
    const start = Date.now();
    const req = lib.request(opts, function (res) {
      const latency = Date.now() - start;
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, latency: latency, error: null });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (err) { resolve({ ok: false, status: null, latency: null, error: err.message }); });
    req.end();
  });
}

/** 简单 worker pool 控制并发 */
async function probeAll(targets) {
  const results = new Array(targets.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= targets.length) return;
      results[idx] = await probeSite(targets[idx]);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(PROBE_CONCURR, targets.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/** 单 URL 抓 og:description + og:image */
function fetchMeta(targetUrl) {
  return new Promise(function (resolve) {
    let parsed;
    try { parsed = new URL(targetUrl); }
    catch (e) { return resolve({ description: null, logo: null }); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const opts = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      timeout: PROBE_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 Hubble/1.0',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    };
    const req = lib.request(opts, function (res) {
      // 跟随一次 3xx
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        try {
          const next = new URL(res.headers.location, targetUrl).toString();
          return resolve(fetchMeta(next));
        } catch (e) { return resolve({ description: null, logo: null }); }
      }
      const chunks = [];
      let total = 0;
      const LIMIT = 200 * 1024;  // 200KB 足够解析 meta
      res.on('data', function (c) {
        if (total < LIMIT) { chunks.push(c); total += c.length; }
      });
      res.on('end', function () {
        const html = Buffer.concat(chunks).toString('utf8');
        resolve(parseHtmlMeta(html, parsed));
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function () { resolve({ description: null, logo: null }); });
    req.end();
  });
}

function parseHtmlMeta(html, parsed) {
  function get(re) {
    var m = html.match(re);
    return m ? m[1].trim() : null;
  }
  var desc = get(/<meta\s+name=["']description["']\s+content=["']([^"']{1,500})["']/i)
          || get(/<meta\s+content=["']([^"']{1,500})["']\s+name=["']description["']/i)
          || get(/<meta\s+property=["']og:description["']\s+content=["']([^"']{1,500})["']/i)
          || get(/<meta\s+content=["']([^"']{1,500})["']\s+property=["']og:description["']/i)
          || get(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']{1,500})["']/i);
  var ogImage = get(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
              || get(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
  var favicon = get(/<link\s+rel=["'](?:icon|shortcut icon)["']\s+href=["']([^"']+)["']/i)
             || '/favicon.ico';
  function absolutize(u) {
    if (!u) return null;
    try { return new URL(u, parsed).toString(); } catch (e) { return null; }
  }
  var logo = absolutize(ogImage) || absolutize(favicon);
  if (desc) {
    desc = desc.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    if (desc.length > 200) desc = desc.slice(0, 200) + '…';
  }
  return { description: desc || null, logo: logo || null };
}

/* ----------------------------- 5. multipart 解析（零依赖） ----------------------------- */

/**
 * 极简 multipart/form-data 解析器。
 * 限制：
 *   - 单文件最大 10MB（超过直接断连）
 *   - 文件名安全化（剥离路径，只保留 basename + 随机后缀）
 *   - 返回 [{ field, filename, url, size }] 数组
 *   - 失败时不写任何文件
 */
function parseMultipart(buffer, boundary) {
  const results = [];
  const boundaryBuf = Buffer.from('--' + boundary);
  let pos = 0;
  while (pos < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, pos);
    if (idx < 0) break;
    const start = idx + boundaryBuf.length;
    const nextIdx = buffer.indexOf(boundaryBuf, start);
    if (nextIdx < 0) break;
    // multipart 内 part header / body 分隔：\r\n\r\n
    const sep = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a]);
    const headerEnd = buffer.indexOf(sep, start);
    if (headerEnd < 0 || headerEnd >= nextIdx) { pos = nextIdx; continue; }
    const headerStr = buffer.slice(start, headerEnd).toString('utf8');
    const data     = buffer.slice(headerEnd + 4, nextIdx - 2);  // 去末尾 \r\n
    const nameMatch  = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    if (!filenameMatch) { pos = nextIdx; continue; }
    const origName = filenameMatch[1];
    const ext = path.extname(origName).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const safeName = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
    results.push({
      field: nameMatch[1],
      filename: origName,
      filenameSafe: safeName,
      data: data,
      size: data.length,
    });
    pos = nextIdx;
  }
  return results;
}

/* ----------------------------- 6. 静态文件服务 ----------------------------- */

function serveStatic(req, res, pathname) {
  // 防止路径穿越
  const safe = path.normalize(pathname).replace(/^([./\\]+)/, '');
  // /uploads/ 走 UPLOAD_DIR（持久化卷）
  if (safe === 'uploads' || safe.startsWith('uploads/')) {
    const filePath = path.join(UPLOAD_DIR, safe.replace(/^uploads\/?/, ''));
    if (!filePath.startsWith(UPLOAD_DIR)) return sendText(res, 403, 'Forbidden');
    return serveFile(res, filePath, true);
  }
  // 其他走 ROOT（/app 容器内或 sandbox）
  let filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) return sendText(res, 403, 'Forbidden');
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  // 友好 URL：/settings 自动映射到 settings.html
  if (!fs.existsSync(filePath)) {
    const candidate = filePath + '.html';
    if (fs.existsSync(candidate)) filePath = candidate;
    else return sendText(res, 404, 'Not Found');
  }
  return serveFile(res, filePath, false);
}

function serveFile(res, filePath, immutable) {
  // 校验文件是否存在，不存在直接返回 404
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendText(res, 404, 'Not Found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*', // 允许跨域加载图片
    'Cache-Control': immutable
      ? 'public, max-age=31536000, immutable'
      : (ext === '.html' || ext === '.json' ? 'no-cache' : 'public, max-age=3600'),
  };

  res.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  stream.on('error', function () {
    if (!res.headersSent) sendText(res, 500, 'Server Error');
  });
  stream.pipe(res);
}

/* ----------------------------- 7. 调度器（定时抓取站点信息） ----------------------------- */

const schedState = {
  timers: new Map(),           // key -> setInterval handle
  status: {},                  // key -> { lastFetched, lastError, lastResult, nextRefresh }
  scheduledKeys: new Set(),    // 当前已加载的 key（用于 diff）
};

/** 把 groupId+url 拼成稳定 key */
function siteKey(gid, url) { return safeStr(gid) + '::' + safeStr(url); }

/** 读取 sites.json 拿到所有 autoFetch=true 的站点 */
function gatherScheduledSites() {
  const r = readSites();
  if (!r.ok) return [];
  const list = [];
  (r.data.groups || []).forEach(function (g) {
    (g.sites || []).forEach(function (s) {
      if (s.autoFetch) {
        list.push({
          groupId: safeStr(g.id),
          groupTitle: safeStr(g.title),
          url: s.url,
          name: s.name,
          interval: Math.max(1, parseInt(s.fetchInterval) || 5),
        });
      }
    });
  });
  return list;
}

/** 立即抓一个站点的描述 + 延迟，写回 sites.json */
async function fetchSiteInfo(groupId, url) {
  const start = Date.now();
  try {
    const probe = await probeSite(url);
    const meta  = await fetchMeta(url);
    const r = readSites();
    if (!r.ok) {
      Logger.error('scheduler', '读 sites.json 失败', new Error(r.error));
      return { ok: false, error: 'read fail' };
    }
    let updated = false;
    (r.data.groups || []).forEach(function (g) {
      if (safeStr(g.id) !== groupId) return;
      (g.sites || []).forEach(function (s) {
        if (s.url === url) {
          s.lastProbe = {
            ok: probe.ok, status: probe.status,
            latency: probe.latency, error: probe.error,
            at: Date.now(),
          };
          // 不覆盖用户已填的自定义值
          if (meta.title && !s.customName) s.name = String(meta.title).slice(0, 30);
          if (meta.description && !s.customDesc) s.desc = meta.description;
          if (meta.logo && !s.customLogo) s.customLogo = meta.logo;
          updated = true;
        }
      });
    });
    if (updated) {
      const w = writeSites(r.data);
      if (!w.ok) Logger.error('scheduler', '写 sites.json 失败', new Error(w.error));
    }
    const ms = Date.now() - start;
    Logger.info('scheduler', `抓取 ${url} 完成 ${ms}ms`, {
      ok: probe.ok, status: probe.status, latency: probe.latency,
      hasTitle: !!meta.title, hasDesc: !!meta.description, hasLogo: !!meta.logo,
    });
    return { ok: true, probe, meta };
  } catch (e) {
    Logger.error('scheduler', '抓取失败: ' + url, e);
    return { ok: false, error: e.message };
  }
}

/** 重新加载调度器：diff 配置 → 只为新增/变化的 key 重设 interval */
function reloadScheduler() {
  const sites = gatherScheduledSites();
  const wantedKeys = new Set(sites.map(function (s) { return siteKey(s.groupId, s.url); }));

  // 移除已不需要的 timer
  let removed = 0;
  for (const [k, handle] of schedState.timers) {
    if (!wantedKeys.has(k)) {
      clearInterval(handle);
      schedState.timers.delete(k);
      schedState.status[k] = undefined;
      removed++;
    }
  }
  if (removed > 0) Logger.info('scheduler', `移除 ${removed} 个过期任务`);

  // 为新增/变化的 key 安排任务
  let added = 0;
  sites.forEach(function (s) {
    const k = siteKey(s.groupId, s.url);
    if (schedState.timers.has(k)) return;
    added++;
    // 首次跑一次（不阻塞启动）
    setTimeout(function () {
      fetchSiteInfo(s.groupId, s.url).then(function (r) {
        schedState.status[k] = {
          lastFetched: Date.now(),
          lastError: r.ok ? null : r.error,
          lastResult: r.ok ? (r.probe && r.probe.ok ? 'up' : 'down') : 'error',
          nextRefresh: Date.now() + s.interval * 60 * 1000,
        };
      });
    }, 1500 + added * 200);  // 错开启动，避免同时打目标站
    // 周期抓
    const handle = setInterval(function () {
      fetchSiteInfo(s.groupId, s.url).then(function (r) {
        schedState.status[k] = {
          lastFetched: Date.now(),
          lastError: r.ok ? null : r.error,
          lastResult: r.ok ? (r.probe && r.probe.ok ? 'up' : 'down') : 'error',
          nextRefresh: Date.now() + s.interval * 60 * 1000,
        };
      });
    }, s.interval * 60 * 1000);
    schedState.timers.set(k, handle);
  });

  if (added > 0) Logger.info('scheduler', '新增 ' + added + ' 个任务（共 ' + schedState.timers.size + ' 个）');
}

/* ----------------------------- 8. 路由处理 ----------------------------- */

/** 读取二进制 Buffer Body（用于文件上传，避免破坏二进制图片） */
function readBufferBody(req, maxSize) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let totalSize = 0;
    let tooBig = false;

    req.on('data', function (c) {
      totalSize += c.length;
      if (totalSize > maxSize) {
        tooBig = true;
        req.destroy();
        reject(new Error('payload too large'));
      } else {
        chunks.push(c);
      }
    });

    req.on('end', function () {
      if (!tooBig) resolve(Buffer.concat(chunks));
    });
    req.on('error', function (e) { reject(e); });
  });
}

/** 读取 JSON Body */
function readJsonBody(req, maxSize) {
  return readBufferBody(req, maxSize || 1024 * 1024).then(function (buf) {
    return JSON.parse(buf.toString('utf8'));
  });
}

/** 读取 Multipart Body */
function readMultipartBody(req, contentType) {
  return readBufferBody(req, UPLOAD_MAX_SIZE + 1024).then(function (buf) {
    const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!m) throw new Error('missing boundary');
    return parseMultipart(buf, m[1] || m[2]);
  });
}

/** OPTIONS 预检（CORS） */
function handleOptions(req, res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

/** 路由表：path -> method -> handler(req, res, pathname, query) */
const routes = [
  { match: /^\/api\/sites$/,           methods: { GET: handleGetSites, PUT: handlePutSites } },
  { match: /^\/api\/probe$/,           methods: { POST: handleProbe } },
  { match: /^\/api\/meta$/,            methods: { POST: handleMeta } },
  { match: /^\/api\/upload$/,          methods: { POST: handleUpload } },
  { match: /^\/api\/scheduler$/,       methods: { GET: handleSchedulerList, POST: handleSchedulerReload } },
  { match: /^\/api\/scheduler\/fetch$/, methods: { POST: handleSchedulerFetch } },
  { match: /^\/api\/scheduler\/reload$/, methods: { POST: handleSchedulerReload } },
];

function handleGetSites(req, res) {
  const r = readSites();
  if (!r.ok) return sendJSON(res, 500, { error: r.error });
  sendJSON(res, 200, r.data);
}

function handlePutSites(req, res) {
  readJsonBody(req, 5 * 1024 * 1024).then(function (data) {
    if (!data || !Array.isArray(data.groups)) {
      return sendJSON(res, 400, { error: 'missing groups' });
    }
    const w = writeSites(data);
    if (!w.ok) return sendJSON(res, 500, { error: w.error });
    // 配置变了，调度器重载
    reloadScheduler();
    sendJSON(res, 200, { ok: true });
  }).catch(function (e) {
    sendJSON(res, 400, { error: e.message });
  });
}

function handleProbe(req, res) {
  readJsonBody(req).then(function (data) {
    if (!data || !Array.isArray(data.urls)) {
      Logger.warn('probe', 'missing urls in request body');
      return sendJSON(res, 400, { error: 'missing urls' });
    }
    Logger.info('probe', `批量探测 ${data.urls.length} 个 URL`);
    probeAll(data.urls).then(function (results) {
      var upCount = results.filter(function (r) { return r.ok; }).length;
      Logger.info('probe', `探测完成 ${upCount}/${results.length} 可达`);
      sendJSON(res, 200, { results: results });
    });
  }).catch(function (e) {
    Logger.warn('probe', '请求失败', e);
    sendJSON(res, 400, { error: e.message });
  });
}

function handleMeta(req, res) {
  readJsonBody(req, 64 * 1024).then(function (data) {
    if (!data || typeof data.url !== 'string') {
      Logger.warn('meta', 'missing url');
      return sendJSON(res, 400, { error: 'missing url' });
    }
    Logger.info('meta', `抓取元数据: ${data.url}`);
    fetchMeta(data.url).then(function (meta) {
      Logger.info('meta', `抓取完成: ${data.url}`, {
        hasDesc: !!meta.description,
        hasLogo: !!meta.logo,
      });
      sendJSON(res, 200, meta);
    });
  }).catch(function (e) {
    Logger.warn('meta', '抓取失败', e);
    sendJSON(res, 400, { error: e.message });
  });
}

function handleUpload(req, res) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data')) {
    Logger.warn('upload', `非 multipart 请求: ${contentType.slice(0, 40)}`);
    return sendJSON(res, 400, { error: 'expected multipart/form-data' });
  }
  Logger.info('upload', '接收上传请求');
  readMultipartBody(req, contentType).then(function (files) {
    if (files.length === 0) {
      Logger.warn('upload', '解析后无文件');
      return sendJSON(res, 400, { error: 'no files' });
    }
    const saved = [];
    files.forEach(function (f) {
      const filePath = path.join(UPLOAD_DIR, f.filenameSafe);
      try {
        fs.writeFileSync(filePath, f.data);
        saved.push({
          field: f.field,
          filename: f.filename,
          url: '/uploads/' + f.filenameSafe,
          size: f.size,
        });
      } catch (e) {
        Logger.error('upload', '保存失败: ' + f.filenameSafe, e);
      }
    });
    Logger.info('upload', `已保存 ${saved.length} 个文件`, {
      total: saved.reduce((s, f) => s + f.size, 0),
    });
    sendJSON(res, 200, { files: saved });
  }).catch(function (e) {
    Logger.warn('upload', '解析失败', e);
    sendJSON(res, 400, { error: e.message });
  });
}

function handleSchedulerList(req, res) {
  const sites = gatherScheduledSites();
  const tasks = sites.map(function (s) {
    const st = schedState.status[siteKey(s.groupId, s.url)] || {};
    return Object.assign({
      groupId: s.groupId, groupTitle: s.groupTitle,
      url: s.url, name: s.name, interval: s.interval,
    }, st);
  });
  Logger.debug('scheduler', `list: ${tasks.length} tasks`);
  sendJSON(res, 200, { tasks: tasks, totalScheduled: schedState.timers.size });
}

function handleSchedulerReload(req, res) {
  Logger.info('scheduler', '手动重载');
  reloadScheduler();
  sendJSON(res, 200, { ok: true, total: schedState.timers.size });
}

function handleSchedulerFetch(req, res) {
  const sites = gatherScheduledSites();
  Logger.info('scheduler', `手动触发抓取 ${sites.length} 个站点`);
  Promise.all(sites.map(function (s) {
    return fetchSiteInfo(s.groupId, s.url);
  })).then(function () {
    Logger.info('scheduler', `手动抓取完成 ${sites.length} 个`);
    sendJSON(res, 200, { ok: true, count: sites.length });
  }).catch(function (e) {
    Logger.error('scheduler', '手动抓取失败', e);
    sendJSON(res, 500, { error: e.message });
  });
}

/* ----------------------------- 9. 主 server ----------------------------- */

/**
 * HTTP request 包装：每个请求都打 access log（标准 combined 格式）
 * 实现方式：给 res.end 打 patch，第一次调用时记录耗时 + 打 log
 */
const server = http.createServer(function (req, res) {
  const start = Date.now();

  // 给 res.end 打补丁：第一次调用时打 access log
  const origEnd = res.end.bind(res);
  let logged = false;
  res.end = function (chunk, encoding, cb) {
    if (!logged) {
      logged = true;
      const ms = Date.now() - start;
      Logger.access(req, res, ms);
    }
    return origEnd(chunk, encoding, cb);
  };

  // CORS 预检
  if (req.method === 'OPTIONS') return handleOptions(req, res);

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  // 路由匹配
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (route.match.test(pathname)) {
      const handler = route.methods[req.method];
      if (handler) return handler(req, res, pathname, parsed.query);
      return sendText(res, 405, 'Method Not Allowed');
    }
  }

  // 静态文件
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, pathname);
  }

  sendText(res, 405, 'Method Not Allowed');
});

server.listen(PORT, '0.0.0.0', function () {
  Logger.info('boot', 'listening on http://0.0.0.0:' + PORT + ' (log level: ' + (process.env.LOG_LEVEL || 'info') + ')');
  // 启动后 2 秒首次加载调度器（避免阻塞 listen）
  setTimeout(reloadScheduler, 2000);
  // 之后每 30 秒扫一次配置变化（用户改设置后无需重启）
  setInterval(reloadScheduler, SCHEDULER_SCAN_INTERVAL);
});
