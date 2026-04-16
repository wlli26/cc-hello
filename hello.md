# Print Current Session Conversation History

Print the raw Q&A history of the current Claude Code session and optionally summarize it.

## Instructions

Run this command using the Bash tool:

```bash
node ~/.claude/hello.js
```

The script writes Q&A content to a file and prints the file path. If `SILICONFLOW_API_KEY` is set, it also calls SiliconFlow API to generate a summary and writes it to `hello-summary.txt`. Do NOT read, repeat, or summarize the file content. Just report the file paths from the output so the user can open them.
