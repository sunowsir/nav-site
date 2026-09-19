const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require(path.join(process.cwd(), 'node_modules', 'jsdom'));

(async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const js = fs.readFileSync('assets/app.js', 'utf8');
  const sitesRaw = fs.readFileSync('data/sites.json', 'utf8');

  const dom = new JSDOM(html.replace('<script src="assets/app.js"></script>', ''), {
    url: 'http://127.0.0.1:8080/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        if (typeof url === 'string' && url.indexOf('sites.json') >= 0) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(sitesRaw)) });
        }
        return Promise.reject(new Error('mock: ' + url));
      };
      window.URL = window.URL || { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
      const lsData = { 'hubble.view': 'compact' };
      window.localStorage = {
        getItem(k) { return lsData[k] || null; },
        setItem(k, v) { lsData[k] = String(v); },
        removeItem(k) { delete lsData[k]; }
      };
      // 屏蔽 canvas 报错
      window.HTMLCanvasElement.prototype.getContext = function() { return null; };
    }
  });

  const ctx = dom.getInternalVMContext();
  // 把 initBackground 替换成 noop，避开 jsdom canvas 报错
  vm.runInContext(js.replace(/function initBackground\(\)[\s\S]*?if \(document\.readyState/g, 'function initBackground(){ if(document.readyState'), ctx);
  await new Promise(r => setTimeout(r, 400));
  const d = dom.window.document;

  console.log('=== compact 视图渲染结果 ===');
  console.log('groups:', d.querySelectorAll('.group').length);
  console.log('compact-view:', d.querySelectorAll('.compact-view').length);
  console.log('row-card:', d.querySelectorAll('.row-card').length);
  console.log('lock-card:', d.querySelectorAll('.lock-card').length);
  console.log('site-lock-card:', d.querySelectorAll('.site-lock-card').length);
  console.log('state-loading:', d.querySelectorAll('.state-loading').length);
  console.log('state-error:', d.querySelectorAll('.state-error').length);
  console.log('app innerHTML length:', d.getElementById('app')?.innerHTML.length || 0);

  const cv = d.querySelector('.compact-view');
  if (cv) {
    console.log('compact-view 子元素数:', cv.children.length);
    console.log('compact-view 首子:', cv.children[0]?.className);
  }
  const grp = d.querySelector('.group');
  if (grp) {
    console.log('group 子元素数:', grp.children.length);
    console.log('group 完整 outerHTML 头 400:');
    console.log(grp.outerHTML.slice(0, 400));
  }
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
