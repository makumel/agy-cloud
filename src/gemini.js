const memory = require('./memory');
const tools = require('./tools');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Format tools into Gemini Function Declarations
function getGeminiTools() {
  return [
    {
      functionDeclarations: tools.TOOL_DEFINITIONS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: "OBJECT",
          properties: Object.keys(t.parameters.properties || {}).reduce((acc, key) => {
            acc[key] = {
              type: t.parameters.properties[key].type,
              description: t.parameters.properties[key].description
            };
            return acc;
          }, {}),
          required: t.parameters.required || []
        }
      }))
    }
  ];
}

// Build System Instruction with Long-term Memory
function buildSystemInstruction() {
  const currentMemory = memory.getMemory();
  return {
    parts: [
      {
        text: `You are Antigravity 2.0 (Agy), an autonomous AI developer and pair programming agent running directly inside the user's 24/7 cloud environment.

YOUR PRIMARY CAPABILITIES:
1. Shell & Workspace Control: You can execute commands (bash, git, node, python, etc.), create, edit, and read files in the workspace.
2. Interactive Artifacts: Whenever writing web apps, UI components, HTML/CSS/JS mockups, dashboards, or rich markdown docs, call the 'create_artifact' tool so the user can immediately see and interact with live running code in their Artifacts tab!
3. Continuous Memory: You have access to persistent memory. When important decisions, project architecture, or user configurations are established, save them using 'update_memory' so you never forget them across sessions and device switches.
4. Mobile & Touch Optimized: Keep explanations clear, structured, and easy to read on mobile devices.

CURRENT PERSISTENT MEMORY BANK:
\`\`\`markdown
${currentMemory}
\`\`\`

Always verify your changes and execute tasks end-to-end.`
      }
    ]
  };
}

// Convert internal message format to Gemini contents format
function formatGeminiContents(messages) {
  return messages.map(msg => {
    const role = (msg.role === 'user' || msg.role === 'user_input') ? 'user' : 'model';
    const parts = [];

    if (msg.parts && Array.isArray(msg.parts)) {
      return { role, parts: msg.parts };
    }

    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    }

    if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.args
          }
        });
      }
    }

    if (msg.toolResults && Array.isArray(msg.toolResults)) {
      for (const tr of msg.toolResults) {
        parts.push({
          functionResponse: {
            name: tr.name,
            response: { output: tr.result }
          }
        });
      }
    }

    return { role, parts };
  });
}

// Run multi-turn agent loop with tool execution
async function runAgentTurn({ apiKey, model, messages, onChunk, onArtifactCreated }) {
  const fallbackModels = [
    model,
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite'
  ].filter(Boolean);

  // Deduplicate
  const candidateModels = Array.from(new Set(fallbackModels));
  let lastError = null;

  for (const targetModel of candidateModels) {
    try {
      return await executeModelTurn({
        apiKey,
        targetModel,
        messages,
        onChunk,
        onArtifactCreated
      });
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
      if (msg.includes('404') || msg.includes('no longer available') || msg.includes('not found')) {
        console.warn(`[Gemini] Model ${targetModel} failed (${msg}), falling back to next candidate...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All model attempts failed');
}

async function executeModelTurn({ apiKey, targetModel, messages, onChunk, onArtifactCreated }) {
  let turnContents = formatGeminiContents(messages);
  const maxToolIterations = 10;
  let iteration = 0;
  let finalAssistantMessage = {
    role: 'model',
    content: '',
    toolCalls: [],
    toolResults: [],
    artifacts: []
  };

  while (iteration < maxToolIterations) {
    iteration++;

    const payload = {
      contents: turnContents,
      systemInstruction: buildSystemInstruction(),
      tools: getGeminiTools(),
      generationConfig: {
        temperature: 0.2,
        topP: 0.95
      }
    };

    const url = `${GEMINI_API_BASE}/models/${targetModel}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content) {
      break;
    }

    const modelParts = candidate.content.parts || [];
    let textContent = "";
    const functionCalls = [];

    for (const part of modelParts) {
      if (part.text) {
        textContent += part.text;
        finalAssistantMessage.content += part.text;
        if (onChunk) {
          onChunk({ type: 'token', content: part.text });
        }
      }
      if (part.functionCall) {
        functionCalls.push(part.functionCall);
      }
    }

    // Add model step to context
    turnContents.push({
      role: 'model',
      parts: modelParts
    });

    // If no tool calls, turn is done
    if (functionCalls.length === 0) {
      break;
    }

    // Execute each function call
    const functionResponseParts = [];
    for (const call of functionCalls) {
      const toolName = call.name;
      const toolArgs = call.args || {};

      if (onChunk) {
        onChunk({ type: 'tool_call', name: toolName, args: toolArgs });
      }
      finalAssistantMessage.toolCalls.push({ name: toolName, args: toolArgs });

      // Execute tool
      const result = await tools.executeTool(toolName, toolArgs, (art) => {
        finalAssistantMessage.artifacts.push(art);
        if (onArtifactCreated) onArtifactCreated(art);
      });

      if (onChunk) {
        onChunk({ type: 'tool_result', name: toolName, result });
      }
      finalAssistantMessage.toolResults.push({ name: toolName, result });

      functionResponseParts.push({
        functionResponse: {
          name: toolName,
          response: { output: result }
        }
      });
    }

    // Append tool execution responses into conversation for the next agent step
    turnContents.push({
      role: 'user',
      parts: functionResponseParts
    });
  }

  return finalAssistantMessage;
}

module.exports = {
  runAgentTurn
};
