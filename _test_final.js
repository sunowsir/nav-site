// E2E：用 jsdom 真实跑一遍新版本
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require(path.join(process.cwd(), 'node_modules', 'jsdom'));

(async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const js = fs.readFileSync('assets/app.js', 'utf8');
  const sites = fs.readFileSync('sites.json', 'utf8');

  // 把外部 script 替换为内联
  const cleanHtml = html.replace('<script src="assets/app.js"></script>', '');

  const dom = new JSDOM(cleanHtml, {
    url: 'http://127.0.0.1:8080/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        const u = typeof url === 'string' ? url : (url && url.url) || '';
        if (u.indexOf('sites.json') >= 0) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(sites)) });
        }
        if (u.indexOf('/api/probe') >= 0) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) });
        }
        return Promise.reject(new Error('mock: ' + u));
      };
    }
  });
  const ctx = dom.getInternalVMContext();
  vm.runInContext(js, ctx);

  // 等 init() 完成
  await new Promise(r => setTimeout(r, 600));

  const { document } = window = dom.window;
  let pass = 0, fail = 0;
  const t = (name, cond, extra='') => {
    if (cond) { pass++; console.log('  ✅', name); }
    else { fail++; console.log('  ❌', name, extra); }
  };

  console.log('=== 渲染验证 ===');
  const groups = document.querySelectorAll('.group');
  t(`渲染了 ${groups.length} 个分组（>=1）`, groups.length >= 1, `actual=${groups.length}`);

  const cards = document.querySelectorAll('.card');
  t(`渲染了 ${cards.length} 张卡片（>=1）`, cards.length >= 1, `actual=${cards.length}`);

  // 关键：完全没有 search-panel
  const searchPanels = document.querySelectorAll('.search-panel, [id*="search"]');
  t(`无任何 search 元素 (实际 ${searchPanels.length})`, searchPanels.length === 0);

  // 关键：完全没有 modal/overlay
  const overlays = document.querySelectorAll('.overlay, [class*="modal"]');
  t(`无任何 overlay/modal 元素 (实际 ${overlays.length})`, overlays.length === 0);

  // 卡片字段
  if (cards.length > 0) {
    const c = cards[0];
    t('卡片有 href', !!c.href);
    t('卡片 target=_blank', c.target === '_blank');
    t('卡片含 name', !!c.querySelector('.card-name'));
    t('卡片含 domain', !!c.querySelector('.card-domain'));
    t('卡片含 avatar', !!c.querySelector('.card-avatar'));
    t('卡片有 status 字段', !!c.querySelector('[data-role="status"]'));
    t('卡片有 latency 字段', !!c.querySelector('[data-role="latency"]'));
  }

  console.log('=== 设置入口 ===');
  const setLink = document.querySelector('a[href="/settings"]');
  t('顶部有"设置"链接', !!setLink);
  t('设置链接文字是"设置"', setLink?.textContent === '设置');

  console.log('=== 主题应用 ===');
  const theme = document.documentElement.getAttribute('data-theme');
  t('data-theme 已应用 (midnight/light 等)', !!theme, `actual=${theme}`);

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
