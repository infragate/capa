import type { ToolSchema, EnrichedTool } from '../../../types/api';

export function estimateToolTokens(tool: {
  name?: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; description?: string }> };
}): number {
  let text = (tool.name || '') + ' ' + (tool.description || '');
  const props = tool.inputSchema?.properties || {};
  for (const [name, schema] of Object.entries(props)) {
    text += ' ' + name + ' ' + (schema.type || '') + ' ' + (schema.description || '');
  }
  return Math.ceil(text.trim().length / 4);
}

export interface TokenSavingsResult {
  tokensSaved: number;
  tokensWithout: number;
  tokensWith: number;
  reduction: number;
  overhead: number;
  proxiedCount: number;
  totalServerTools: number;
  serverCount: number;
}

export function computeTokenSavings(
  tools: EnrichedTool[],
  serverToolsMap: Record<string, ToolSchema[]>,
  serverCount: number,
): TokenSavingsResult | null {
  let tokensWithout = 0;
  let totalServerTools = 0;

  for (const serverTools of Object.values(serverToolsMap)) {
    totalServerTools += serverTools.length;
    for (const t of serverTools) {
      tokensWithout += estimateToolTokens(t);
    }
  }

  if (tokensWithout === 0) return null;

  const mcpTools = tools.filter(
    (t) => t.type === 'mcp' && t.mcpServer && t.mcpTool,
  );

  let tokensWith = 0;
  for (const tool of mcpTools) {
    const serverId = (tool.mcpServer || '').replace(/^@/, '');
    const serverTools = serverToolsMap[serverId] || [];
    const schema = serverTools.find((st) => st.name === tool.mcpTool);
    if (schema) {
      tokensWith += estimateToolTokens({
        name: tool.mcpTool,
        description: schema.description,
        inputSchema: schema.inputSchema,
      });
    } else {
      tokensWith += estimateToolTokens({ name: tool.mcpTool });
    }
  }

  const saved = tokensWithout - tokensWith;
  const reduction = (saved / tokensWithout) * 100;
  const overhead = (tokensWith / tokensWithout) * 100;

  return {
    tokensSaved: Math.max(0, saved),
    tokensWithout,
    tokensWith,
    reduction: Math.max(0, reduction),
    overhead: Math.min(100, overhead),
    proxiedCount: mcpTools.length,
    totalServerTools,
    serverCount,
  };
}
