#!/usr/bin/env node
// Writes Claude Code session Q&A history to a temp file and opens it,
// so the content never enters the model context via stdout.

const fs = require('fs');
const path = require('path');
const os = require('os');


const cwd = process.argv[2] || process.cwd();
const userProfile = process.env.USERPROFILE || os.homedir();

function toSlug(dir) {
  let p = dir.replace(/\\/g, '/');
  p = p.replace(/^([a-zA-Z]):\//, (_, drive) => drive.toUpperCase() + '--');
  p = p.replace(/^\/([a-zA-Z])\//, (_, drive) => drive.toUpperCase() + '--');
  p = p.replace(/\//g, '-');
  return p;
}

const slug = toSlug(cwd);
const projectDir = path.join(userProfile, '.claude', 'projects', slug);

if (!fs.existsSync(projectDir)) {
  console.log(`No project directory found: ${projectDir}`);
  process.exit(1);
}

const jsonlFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
if (jsonlFiles.length === 0) {
  console.log('No session file found.');
  process.exit(1);
}

const jsonlFile = jsonlFiles
  .map(f => ({ f, mtime: fs.statSync(path.join(projectDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0].f;

const filePath = path.join(projectDir, jsonlFile);
const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');

let count = 0;
const output = [];

lines.forEach(line => {
  try {
    const obj = JSON.parse(line);
    if (obj.type !== 'user' && obj.type !== 'assistant') return;

    count++;
    const role = obj.type === 'user' ? 'User' : 'Assistant';
    const msg = obj.message;
    let content = '';

    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }

    if (!content.trim()) return;

    output.push(`=== #${count} [${role}] ===`);
    output.push(content);
    output.push('');
  } catch (e) {}
});

output.push(`--- Total: ${count} messages ---`);

// Write to a fixed output file (not stdout)
const outFile = path.join(cwd, 'hello-output.txt');
fs.writeFileSync(outFile, output.join('\n'), 'utf8');

// Only this short line enters model context
const winPath = outFile.replace(/\//g, '\\');
console.log(`Done. ${count} messages written to: ${winPath}`);
