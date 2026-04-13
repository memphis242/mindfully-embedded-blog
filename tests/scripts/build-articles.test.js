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
  it('covers ROOT resolution with and without MEB_ROOT', () => {
    const prevRoot = process.env.MEB_ROOT;
    try {
      process.env.MEB_ROOT = '/tmp/meb-custom-root';
      let modPath = require.resolve('../../scripts/build-articles.js');
      delete require.cache[modPath];
      let mod = require(modPath);
      expect(typeof mod.run).toBe('function');

      process.env.MEB_ROOT = '';
      modPath = require.resolve('../../scripts/build-articles.js');
      delete require.cache[modPath];
      mod = require(modPath);
      expect(typeof mod.assertFrontmatter).toBe('function');
    } finally {
      process.env.MEB_ROOT = prevRoot;
    }
  });

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
    const feed = fs.readFileSync(path.join(root, 'public/feed.xml'), 'utf8');

    expect(index).toContain('Articles');
    expect(index).toContain('Subscribe via RSS');
    expect(json).toContain('"slug": "t"');
    expect(page).toContain('Hello');
    expect(page).toContain('application/rss+xml');
    expect(feed).toContain('<rss version="2.0"');
    expect(feed).toContain('<content:encoded><![CDATA[');
    expect(feed).toContain('<guid isPermaLink="true">https://mindfullyembedded.com/articles/generated/t.html</guid>');
    expect(feed).toContain('<description>S</description>');
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

  it('covers helper branches and template fallbacks', () => {
    const modPath = require.resolve('../../scripts/build-articles.js');
    delete require.cache[modPath];
    const mod = require(modPath);

    expect(mod.escapeHtml(`<'&">`)).toContain('&lt;');
    expect(mod.articleIndexTemplate('')).toContain('No published articles yet');
    expect(mod.escapeXml(`<'&">`)).toContain('&lt;');
    expect(mod.rssDate('2026-01-01')).toMatch(/GMT$/);
    expect(
      mod.rssItem({
        title: 'T',
        summary: 'S',
        date: '2026-01-01',
        url: '/articles/generated/t.html',
        tags: ['x', 'y'],
        htmlBody: '<p>body</p>',
      })
    ).toContain('<category>x</category>');
    expect(mod.rssFeed([])).toContain('<channel>');
    expect(
      mod.rssFeed([
        {
          title: 'T',
          summary: 'S',
          date: '2026-01-01',
          url: '/articles/generated/t.html',
          tags: [],
          htmlBody: '<p>body</p>',
        },
      ])
    ).toContain('<item>');

    expect(() =>
      mod.assertFrontmatter(
        {
          title: 'T',
          slug: 's',
          date: '2026-01-01',
          summary: 'S',
          tags: 'not-array',
          readTime: '1 min',
          published: true,
        },
        'x.md'
      )
    ).toThrow(/tags/);

    expect(() =>
      mod.assertFrontmatter(
        {
          title: 'T',
          slug: 's',
          date: '2026-01-01',
          summary: 'S',
          tags: [],
          readTime: '1 min',
          published: 'yes',
        },
        'x.md'
      )
    ).toThrow(/published/);

    expect(() =>
      mod.assertFrontmatter(
        {
          title: 'T',
          slug: 's',
          date: 'not-a-date',
          summary: 'S',
          tags: [],
          readTime: '1 min',
          published: true,
        },
        'x.md'
      )
    ).toThrow(/invalid 'date'/);
  });

  it('covers removeDirContents no-op and deletion branch', () => {
    const root = mkTmpRoot();
    const modPath = require.resolve('../../scripts/build-articles.js');
    delete require.cache[modPath];
    const mod = require(modPath);
    const missing = path.join(root, 'missing-dir');
    expect(() => mod.removeDirContents(missing)).not.toThrow();

    const dir = path.join(root, 'dir');
    write(path.join(dir, 'file.txt'), 'x');
    mod.removeDirContents(dir);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
