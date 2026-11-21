import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(DIST_DIR, 'x-art-stitcher.user.js');

const MODULE_ORDER = [
  'config.js',
  'gm.js',
  'url.js',
  'interceptor.js',
  'detector.js',
  'stitcher.js',
  'dom.js',
  'icons.js',
  'ui.js',
  'main.js',
];

function stripModuleSyntax(source) {
  // Remove single-line and multi-line relative ES module imports.
  let cleaned = source.replace(/^import\s+[\s\S]*?from\s+['"]\.\/[^'"]+['"];\s*\n?/gm, '');
  // Strip leading `export ` keyword while preserving declarations.
  cleaned = cleaned.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '');
  return cleaned.trim();
}

function toTemplateLiteral(text) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `\`\n${escaped}\n\``;
}

function build() {
  const meta = fs.readFileSync(path.join(SRC_DIR, 'meta.js'), 'utf8').trim();
  const stylesCss = fs.readFileSync(path.join(SRC_DIR, 'styles.css'), 'utf8').trim();

  const sections = MODULE_ORDER.map((filename) => {
    const raw = fs.readFileSync(path.join(SRC_DIR, filename), 'utf8');
    let code = stripModuleSyntax(raw);
    if (filename === 'main.js') {
      code = code.replace("'__XAS_STYLES_CSS__'", toTemplateLiteral(stylesCss));
    }
    return `  // --- ${filename} ---\n${code
      .split('\n')
      .map((line) => (line.length ? `  ${line}` : ''))
      .join('\n')}`;
  });

  const bundle = [
    meta,
    '',
    '(() => {',
    "  'use strict';",
    '',
    sections.join('\n\n'),
    '})();',
    '',
  ].join('\n');

  // Verify bundled JS parses cleanly without syntax or duplicate binding errors.
  new vm.Script(bundle, { filename: 'x-art-stitcher.user.js' });

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, bundle, 'utf8');
  console.log(`Built ${path.relative(ROOT, OUT_FILE)} (${bundle.length} bytes)`);
}

build();
