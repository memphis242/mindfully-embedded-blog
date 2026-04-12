// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'meb-template-'));
}

function write(p, c) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c, 'utf8');
}

describe('apply-templates script', () => {
  it('replaces footer token and legacy footer blocks', () => {
    const root = mkTmpRoot();

    write(path.join(root, 'templates/footer.html'), '<footer class="site-footer container"><p>Footer</p></footer>');
    write(path.join(root, 'public/a.html'), '<html><body><!-- @site-footer --></body></html>');
    write(
      path.join(root, 'public/b.html'),
      '<html><body><footer class="site-footer container"><p>Old</p></footer></body></html>'
    );

    const prevRoot = process.env.MEB_ROOT;
    try {
      process.env.MEB_ROOT = root;
      const modPath = require.resolve('../../scripts/apply-templates.js');
      delete require.cache[modPath];
      const { run } = require(modPath);
      run();
    } finally {
      process.env.MEB_ROOT = prevRoot;
    }

    const a = fs.readFileSync(path.join(root, 'public/a.html'), 'utf8');
    const b = fs.readFileSync(path.join(root, 'public/b.html'), 'utf8');

    expect(a).toContain('<p>Footer</p>');
    expect(b).toContain('<p>Footer</p>');
    expect(b).not.toContain('<p>Old</p>');
  });

  it('fails if footer template is missing', () => {
    const root = mkTmpRoot();
    write(path.join(root, 'public/a.html'), '<html><body><!-- @site-footer --></body></html>');

    const prevRoot = process.env.MEB_ROOT;
    try {
      process.env.MEB_ROOT = root;
      const modPath = require.resolve('../../scripts/apply-templates.js');
      delete require.cache[modPath];
      const { run } = require(modPath);
      expect(() => run()).toThrow(/Missing footer template/);
    } finally {
      process.env.MEB_ROOT = prevRoot;
    }
  });
});
