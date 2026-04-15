#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = process.env.USERPROFILE || os.homedir();
const claudeDir = path.join(home, '.claude');
const commandsDir = path.join(claudeDir, 'commands');

// Ensure directories exist
[claudeDir, commandsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Copy files
const srcDir = __dirname;

fs.copyFileSync(path.join(srcDir, 'hello.js'), path.join(claudeDir, 'hello.js'));
fs.copyFileSync(path.join(srcDir, 'hello.md'), path.join(commandsDir, 'hello.md'));

console.log('Installed /hello command for Claude Code:');
console.log(`  Script: ${path.join(claudeDir, 'hello.js')}`);
console.log(`  Command: ${path.join(commandsDir, 'hello.md')}`);
console.log('\nRestart Claude Code, then type /hello to use.');
