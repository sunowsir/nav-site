// 直接用 node + node-fetch + 解开 IIFE 自己模拟
const fs = require('fs');
const vm = require('vm');

// 读 app.js 把 IIFE 拆出来手动跑
let js = fs.readFileSync('assets/app.js', 'utf8');
const sites = JSON.parse(fs.readFileSync('data/sites.json', 'utf8'));

// 检查 render / makeSiteLockCard 是否能 throw
// 找关键代码段
console.log('--- sites.json ---');
console.log('groups:', sites.groups.length);
sites.groups.forEach(g => {
  console.log(`  ${g.title}: password=${g.password ? 'YES' : 'no'}, sites=${g.sites.length}`);
  g.sites.forEach(s => {
    console.log(`    - ${s.name}: site_pwd=${s.password ? 'YES' : 'no'}`);
  });
});

console.log('\n--- 模拟 render 逻辑 ---');
// 模拟 visibleSites / lockedSites 分类
sites.groups.forEach(g => {
  const groupLocked = !!g.password;
  console.log(`\n分组 [${g.title}] groupLocked=${groupLocked}`);
  if (groupLocked) {
    console.log('  → 走 groupLocked 分支：插入 makeLockCard(g)，return');
    return;
  }
  const visible = [], locked = [];
  g.sites.forEach(s => {
    const effectivePwd = s.password || (g.password || '');
    console.log(`  站点 ${s.name}: effectivePwd=${effectivePwd ? 'YES' : 'no'}`);
    if (effectivePwd) locked.push(s);
    else visible.push(s);
  });
  console.log(`  visibleSites=${visible.length}, lockedSites=${locked.length}`);
});
