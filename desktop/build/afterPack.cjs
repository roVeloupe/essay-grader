'use strict';
/**
 * electron-builder 的 extraResources 会漏掉 node_modules（builder 默认忽略依赖目录），
 * 导致打包后 opencode2api 起不来。这里在打包完成后整目录复制一次，
 * 保证 resources/backend/opencode2api 自带 node_modules，用户机器无需联网安装。
 */
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const src = path.resolve(__dirname, '..', '..', 'opencode2api');
  const dest = path.join(appOutDir, 'resources', 'backend', 'opencode2api');

  if (!fs.existsSync(src)) {
    console.warn('[afterPack] 跳过：源目录不存在', src);
    return;
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  fs.cpSync(src, dest, {
    recursive: true,
    filter(source) {
      const rel = path.relative(src, source).replace(/\\/g, '/');
      if (!rel) return true;
      if (rel === '.git' || rel.startsWith('.git/')) return false;
      if (rel.startsWith('node_modules/.bin')) return false;
      if (rel.endsWith('.log')) return false;
      return true;
    },
  });

  const depCount = fs.existsSync(path.join(dest, 'node_modules'))
    ? fs.readdirSync(path.join(dest, 'node_modules')).length
    : 0;
  console.log(`[afterPack] backend -> ${dest}（依赖 ${depCount} 项）`);
};
