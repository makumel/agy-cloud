const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const memory = require('./memory');

const WORKSPACE_ROOT = memory.WORKSPACE_ROOT;

// Resolve safe path within workspace
function resolveSafePath(targetPath) {
  if (!targetPath) return WORKSPACE_ROOT;
  const resolved = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(WORKSPACE_ROOT, targetPath);
  return resolved;
}

// Tool Definitions for Gemini Function Calling
const TOOL_DEFINITIONS = [
  {
    name: "execute_command",
    description: "Run a shell/bash command inside the Linux workspace container (e.g. npm install, git, python, curl, ls, node).",
    parameters: {
      type: "OBJECT",
      properties: {
        command: {
          type: "STRING",
          description: "The shell command line to execute."
        }
      },
      required: ["command"]
    }
  },
  {
    name: "read_file",
    description: "Read the full text content of a file in the workspace.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Relative or absolute path to the file."
        }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in the workspace with new content.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Relative or absolute path to the file."
        },
        content: {
          type: "STRING",
          description: "The complete text/code content to write."
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "list_files",
    description: "List directory contents in the workspace.",
    parameters: {
      type: "OBJECT",
      properties: {
        directory: {
          type: "STRING",
          description: "Directory path relative to workspace (defaults to root workspace if omitted)."
        }
      }
    }
  },
  {
    name: "create_artifact",
    description: "Generate an interactive artifact (HTML/Tailwind app, React preview, Markdown doc, SVG, or code) for the user to view, test, and interact with in the Artifacts tab.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "Title of the artifact (e.g., 'Dashboard UI Mockup', 'Calculator App', 'API Spec')."
        },
        type: {
          type: "STRING",
          description: "Artifact format type: 'html', 'react', 'markdown', 'svg', or 'code'."
        },
        content: {
          type: "STRING",
          description: "Complete runnable code or markdown content for the artifact."
        },
        description: {
          type: "STRING",
          description: "Brief summary of what this artifact provides."
        }
      },
      required: ["title", "type", "content"]
    }
  },
  {
    name: "read_memory",
    description: "Read the current persistent memory bank to recall past project details, architectural decisions, and setup history.",
    parameters: {
      type: "OBJECT",
      properties: {}
    }
  },
  {
    name: "update_memory",
    description: "Save an important project fact, completed milestone, or user instruction into long-term persistent memory so it stays remembered forever.",
    parameters: {
      type: "OBJECT",
      properties: {
        heading: {
          type: "STRING",
          description: "Topic heading for this memory entry."
        },
        content: {
          type: "STRING",
          description: "The information to remember."
        }
      },
      required: ["heading", "content"]
    }
  }
];

// Tool Execution Handlers
async function executeTool(name, args, onArtifactCreated) {
  try {
    switch (name) {
      case "execute_command": {
        const cmd = args.command;
        return new Promise((resolve) => {
          exec(cmd, { cwd: WORKSPACE_ROOT, timeout: 60000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
            let result = "";
            if (stdout) result += stdout;
            if (stderr) result += `\n[STDERR]\n${stderr}`;
            if (error) result += `\n[EXIT CODE: ${error.code || 1}] ${error.message}`;
            if (!result.trim()) result = "(Command completed with no output)";
            resolve({ output: result.slice(0, 15000) });
          });
        });
      }

      case "read_file": {
        const filePath = resolveSafePath(args.path);
        if (!fs.existsSync(filePath)) {
          return { error: `File not found: ${args.path}` };
        }
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          return { error: `Path is a directory, use list_files instead: ${args.path}` };
        }
        const content = fs.readFileSync(filePath, 'utf8');
        return { path: args.path, content: content.slice(0, 50000) };
      }

      case "write_file": {
        const filePath = resolveSafePath(args.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, args.content, 'utf8');
        return { success: true, path: args.path, bytesWritten: Buffer.byteLength(args.content, 'utf8') };
      }

      case "list_files": {
        const targetDir = resolveSafePath(args.directory || '');
        if (!fs.existsSync(targetDir)) {
          return { error: `Directory not found: ${args.directory}` };
        }
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        const items = entries.map(e => {
          const full = path.join(targetDir, e.name);
          let size = 0;
          try {
            if (!e.isDirectory()) size = fs.statSync(full).size;
          } catch (_) {}
          return {
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
            size: size
          };
        });
        return { directory: args.directory || '/', items };
      }

      case "create_artifact": {
        const artifact = {
          id: 'art_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          title: args.title,
          type: args.type || 'html',
          content: args.content,
          description: args.description || '',
          createdAt: Date.now()
        };
        if (onArtifactCreated) {
          onArtifactCreated(artifact);
        }
        return { success: true, artifactId: artifact.id, title: artifact.title };
      }

      case "read_memory": {
        const mem = memory.getMemory();
        return { memory: mem };
      }

      case "update_memory": {
        const ok = memory.appendToMemory(args.heading, args.content);
        return { success: ok, heading: args.heading };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: `Execution error: ${err.message}` };
  }
}

module.exports = {
  WORKSPACE_ROOT,
  TOOL_DEFINITIONS,
  executeTool,
  resolveSafePath
};
