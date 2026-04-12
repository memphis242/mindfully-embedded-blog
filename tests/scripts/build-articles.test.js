// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function mkTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'meb-build-'));
}

function write(p, c) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c, 'utf8');
}

describe('build-articles script', () => {
  it('builds article outputs from markdown', () => {
    const root = mkTmpRoot();

    write(
      path.join(root, 'content/articles/post.md'),
      `---
title: T
slug: t
date: 2026-01-01
summary: S
tags: [a]
readTime: 1 min
published: true
---

Hello`
    );

    const prevRoot = process.env.MEB_ROOT;
    try {
      process.env.MEB_ROOT = root;
      const modPath = require.resolve('../../scripts/build-articles.js');
      delete require.cache[modPath];
      const { run } = require(modPath);
      run();
    } finally {
      process.env.MEB_ROOT = prevRoot;
    }

    const index = fs.readFileSync(path.join(root, 'public/articles/index.html'), 'utf8');
    const json = fs.readFileSync(path.join(root, 'public/articles/articles.json'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'public/articles/generated/t.html'), 'utf8');

    expect(index).toContain('Articles');
    expect(json).toContain('"slug": "t"');
    expect(page).toContain('Hello');
  });

  it('fails for missing required frontmatter', () => {
    const root = mkTmpRoot();
    write(path.join(root, 'content/articles/bad.md'), '# no frontmatter');

    const prevRoot = process.env.MEB_ROOT;
    try {
      process.env.MEB_ROOT = root;
      const modPath = require.resolve('../../scripts/build-articles.js');
      delete require.cache[modPath];
      const { run } = require(modPath);
      expect(() => run()).toThrow(/missing required frontmatter/i);
    } finally {
      process.env.MEB_ROOT = prevRoot;
    }
  });
});
