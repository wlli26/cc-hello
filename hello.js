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

// Helper: strip system tags like <local-command-caveat>, <system-reminder>
function stripSystemTags(text) {
  // Remove entire tag blocks (opening tag + content + closing tag)
  text = text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '');
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '');
  text = text.replace(/<command-name>[\s\S]*?<\/command-name>/gi, '');
  text = text.replace(/<command-message>[\s\S]*?<\/command-message>/gi, '');
  text = text.replace(/<command-args>[\s\S]*?<\/command-args>/gi, '');
  text = text.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '');
  // Remove any remaining standalone tags
  text = text.replace(/<[^>]+>/g, '');
  return text.trim();
}

// Tools worth including (carry meaningful context for workflow generation)
const RELEVANT_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch',
  'NotebookEdit', 'Agent', 'AskUserQuestion'
]);

// Helper: extract key params from tool input
function summarizeToolInput(toolName, input) {
  if (toolName === 'Read') return { file: input.file_path };
  if (toolName === 'Write') return { file: input.file_path };
  if (toolName === 'Edit') return { file: input.file_path };
  if (toolName === 'Bash') return { command: (input.command || '').slice(0, 80) };
  if (toolName === 'Grep') return { pattern: input.pattern, path: input.path };
  if (toolName === 'Glob') return { pattern: input.pattern };
  return input;
}

let count = 0;
const messages = [];

lines.forEach(line => {
  try {
    const obj = JSON.parse(line);
    if (obj.type !== 'user' && obj.type !== 'assistant') return;

    const role = obj.type === 'user' ? 'user' : 'assistant';
    const msg = obj.message;
    const entry = { role, content: [] };

    if (!msg.content) return;

    // Extract text content
    if (typeof msg.content === 'string') {
      const cleaned = stripSystemTags(msg.content);
      if (cleaned) entry.content.push({ type: 'text', text: cleaned });
    } else if (Array.isArray(msg.content)) {
      msg.content.forEach(c => {
        if (c.type === 'text') {
          const cleaned = stripSystemTags(c.text);
          if (cleaned) entry.content.push({ type: 'text', text: cleaned });
        } else if (c.type === 'tool_use') {
          if (!RELEVANT_TOOLS.has(c.name)) return; // skip internal tools
          const toolSummary = summarizeToolInput(c.name, c.input || {});
          entry.content.push({ type: 'tool_use', name: c.name, input: toolSummary });
        } else if (c.type === 'tool_result') {
          let resultText = '';
          if (typeof c.content === 'string') {
            resultText = c.content;
          } else if (Array.isArray(c.content)) {
            resultText = c.content.filter(x => x.type === 'text').map(x => x.text).join('\n');
          }
          resultText = stripSystemTags(resultText).slice(0, 500);
          // Skip internal tool results (Task/Config/etc)
          if (/^(Task|Updated task|Set model|Installed|Done\.|Summary)/i.test(resultText)) return;
          if (resultText) entry.content.push({ type: 'tool_result', text: resultText });
        }
      });
    }

    if (entry.content.length > 0) {
      count++;
      messages.push(entry);
    }
  } catch (e) {}
});

// Write structured JSON for workflow generation
const jsonFile = path.join(cwd, 'hello-output.json');
fs.writeFileSync(jsonFile, JSON.stringify(messages, null, 2), 'utf8');

// Write human-readable text for quick review
const textLines = [];
messages.forEach((m, i) => {
  textLines.push(`=== #${i + 1} [${m.role}] ===`);
  m.content.forEach(c => {
    if (c.type === 'text') {
      textLines.push(c.text);
    } else if (c.type === 'tool_use') {
      textLines.push(`[Tool: ${c.name}] ${JSON.stringify(c.input)}`);
    } else if (c.type === 'tool_result') {
      textLines.push(`[Result] ${c.text}`);
    }
  });
  textLines.push('');
});
textLines.push(`--- Total: ${count} messages ---`);

const outFile = path.join(cwd, 'hello-output.txt');
fs.writeFileSync(outFile, textLines.join('\n'), 'utf8');

const winPath = outFile.replace(/\//g, '\\');
const jsonWinPath = jsonFile.replace(/\//g, '\\');
console.log(`Done. ${count} messages written to:`);
console.log(`  Text: ${winPath}`);
console.log(`  JSON: ${jsonWinPath}`);

// --- Summarize via SiliconFlow API ---
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
if (!SILICONFLOW_API_KEY) {
  console.log('Skipped summary: set SILICONFLOW_API_KEY env var to enable.');
  process.exit(0);
}

const MAX_CHARS = 12000;
const qaText = textLines.join('\n').slice(0, MAX_CHARS);

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
