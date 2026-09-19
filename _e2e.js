// Hubble E2E - 用 jsdom + vm 模拟真实浏览器
const fs = require('fs');
const vm = require('vm');
const { JSDOM, ResourceLoader } = require('jsdom');

(async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const js = fs.readFileSync('assets/app.js', 'utf8');

  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8080/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: 'usable',
  });
  const { window } = dom;
  const { document } = window;

  // 拦截 fetch，转发到真实本地服务
  const origFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const fullUrl = url.startsWith('http') ? url : 'http://127.0.0.1:8080' + url;
    return origFetch(fullUrl, opts);
  };

  // 加载 app.js（HTML 里的 <script src> jsdom 会自动 fetch，但保险起见也手动）
  await new Promise(r => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r);
    else r();
  });

  // 等 init 完成（fetch 是异步）
  await new Promise(r => setTimeout(r, 1500));

  let pass = 0, fail = 0;
  const t = (name, cond, extra='') => {
    if (cond) { pass++; console.log('  ✅', name); }
    else { fail++; console.log('  ❌', name, extra); }
  };

  console.log('--- 首页渲染 ---');
  const groups = document.querySelectorAll('.group');
  t(`分组数 = ${groups.length} (期望 2)`, groups.length === 2);
  const cards = document.querySelectorAll('.card');
  t(`卡片数 = ${cards.length} (期望 9)`, cards.length === 9);
  const titles = Array.from(document.querySelectorAll('.group-title')).map(e => e.textContent);
  t('含"开发工具"', titles.some(s => s.indexOf('开发工具') >= 0));
  t('含"AI 工具"', titles.some(s => s.indexOf('AI 工具') >= 0));
  t('无遮罩 (无 .search-panel 显示)', document.getElementById('search-panel')?.hidden === true);

  // 卡片有正确的字段
  const firstCard = document.querySelector('.card');
  t('卡片有 href', !!firstCard?.href);
  t('卡片有 target=_blank', firstCard?.target === '_blank');
  t('卡片显示 .card-name', !!firstCard?.querySelector('.card-name'));
  t('卡片显示 .card-domain', !!firstCard?.querySelector('.card-domain'));
  t('卡片显示 .card-avatar', !!firstCard?.querySelector('.card-avatar'));

  console.log('--- 健康探测 ---');
  // 等待 probe 完成
  await new Promise(r => setTimeout(r, 3500));
  const statusEls = document.querySelectorAll('[data-role="status"]');
  t(`状态字段存在 (${statusEls.length} 个)`, statusEls.length === 9);
  // 至少有一张卡是 up
  const upCards = document.querySelectorAll('.card[data-status="up"]');
  t(`至少 1 张卡显示为 up (实际 ${upCards.length})`, upCards.length >= 1);

  console.log('--- 搜索 ---');
  document.getElementById('search-btn').click();
  t('搜索按钮可点开', !document.getElementById('search-panel').hidden);
  const input = document.getElementById('search-input');
  input.value = 'git';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  const r1 = document.querySelectorAll('.search-result');
  t(`搜 "git" 命中 ${r1.length} 条 (>=1)`, r1.length >= 1);
  document.getElementById('search-close').click();
  t('搜索面板可关闭', document.getElementById('search-panel').hidden);

  console.log('--- 跳转到 /settings ---');
  const settingsLink = document.querySelector('a[href="/settings"]');
  t('顶部有"设置"链接', !!settingsLink);
  t('设置链接 href = /settings', settingsLink?.getAttribute('href') === '/settings');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('E2E 异常:', e); process.exit(1); });
