#!/usr/bin/env node
// Writes Claude Code session Q&A history to a temp file,
// then optionally summarizes it via SiliconFlow API.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');


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

const winPath = outFile.replace(/\//g, '\\');
console.log(`Done. ${count} messages written to: ${winPath}`);

// --- Summarize via SiliconFlow API ---
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
if (!SILICONFLOW_API_KEY) {
  console.log('Skipped summary: set SILICONFLOW_API_KEY env var to enable.');
  process.exit(0);
}

const MAX_CHARS = 12000;
const qaText = output.join('\n').slice(0, MAX_CHARS);

const body = JSON.stringify({
  model: 'Qwen/Qwen2.5-7B-Instruct',
  messages: [
    { role: 'system', content: '你是一个对话总结助手。请用中文对以下对话历史进行简洁的总结，包括：1) 主要讨论的话题 2) 关键决策和结论 3) 待办事项（如有）。' },
    { role: 'user', content: qaText }
  ],
  max_tokens: 1024,
  temperature: 0.3
});

const hostname = 'api.siliconflow.cn';
console.log(`Calling summary API: https://${hostname}/v1/chat/completions`);

const req = https.request({
  hostname: hostname,
  path: '/v1/chat/completions',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
  }
}, (res) => {
  console.log(`API response status: ${res.statusCode}`);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const summary = json.choices?.[0]?.message?.content || 'No summary returned.';
      const summaryFile = path.join(cwd, 'hello-summary.txt');
      fs.writeFileSync(summaryFile, `=== Session Summary ===\n\n${summary}\n`, 'utf8');
      const summaryWinPath = summaryFile.replace(/\//g, '\\');
      console.log(`Summary written to: ${summaryWinPath}`);
    } catch (e) {
      console.log(`Summary failed: ${e.message}`);
    }
  });
});

req.on('error', (e) => console.log(`Summary request failed: ${e.message}`));
req.write(body);
req.end();
