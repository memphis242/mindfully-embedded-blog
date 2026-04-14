#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.env.MEB_ROOT || path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const HEADER_TEMPLATE_PATH = path.join(TEMPLATES_DIR, 'header.html');
const FOOTER_TEMPLATE_PATH = path.join(TEMPLATES_DIR, 'footer.html');
const HEADER_TOKEN = '<!-- @site-header -->';
const FOOTER_TOKEN = '<!-- @site-footer -->';
const HEADER_BLOCK_REGEX = /<header class="site-header">[\s\S]*?<\/header>/;
const FOOTER_BLOCK_REGEX = /<footer class="site-footer container">[\s\S]*?<\/footer>/;

function walkHtmlFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkHtmlFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function run() {
  if (!fs.existsSync(HEADER_TEMPLATE_PATH)) {
    throw new Error(`Missing header template: ${HEADER_TEMPLATE_PATH}`);
  }
  if (!fs.existsSync(FOOTER_TEMPLATE_PATH)) {
    throw new Error(`Missing footer template: ${FOOTER_TEMPLATE_PATH}`);
  }

  const headerMarkup = fs.readFileSync(HEADER_TEMPLATE_PATH, 'utf8');
  const footerMarkup = fs.readFileSync(FOOTER_TEMPLATE_PATH, 'utf8');
  const htmlFiles = walkHtmlFiles(PUBLIC_DIR);

  let applied = 0;
  let unchanged = 0;

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');

    let next = content;

    if (next.includes(HEADER_TOKEN)) {
      next = next.replaceAll(HEADER_TOKEN, headerMarkup);
    } else if (HEADER_BLOCK_REGEX.test(next)) {
      next = next.replace(HEADER_BLOCK_REGEX, headerMarkup);
    }

    if (next.includes(FOOTER_TOKEN)) {
      next = next.replaceAll(FOOTER_TOKEN, footerMarkup);
    } else if (FOOTER_BLOCK_REGEX.test(next)) {
      next = next.replace(FOOTER_BLOCK_REGEX, footerMarkup);
    }

    if (next === content) {
      unchanged += 1;
      continue;
    }

    fs.writeFileSync(file, `${next}\n`, 'utf8');
    applied += 1;
  }

  console.log(`Applied header/footer templates to ${applied} page(s).`);
  if (unchanged > 0) {
    console.log(
      `${unchanged}/${unchanged + applied} pages skipped (no header/footer token or block found).`
    );
  }
}

/* c8 ignore start */
if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error(`Template applicator script failed: ${err.message}`);
    process.exitCode = 1;
  }
}
/* c8 ignore stop */

module.exports = {
  walkHtmlFiles,
  run,
};
