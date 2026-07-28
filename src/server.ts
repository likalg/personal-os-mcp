import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { PersonalOsClient } from "./http-client.js";
import { executeTool, toolDefinitions } from "./tools.js";

export function createServer(client: PersonalOsClient): McpServer {
  const server = new McpServer({
    name: "personal-os-mcp",
    version: "0.1.0",
  });

  for (const definition of toolDefinitions) {
    let advertisedSchema: z.ZodTypeAny = definition.inputSchema;
    while (advertisedSchema instanceof z.ZodEffects) {
      advertisedSchema = advertisedSchema._def.schema;
    }
    if (!(advertisedSchema instanceof z.ZodObject)) {
      throw new Error(`Tool ${definition.name} must have an object input schema.`);
    }

    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: advertisedSchema.shape,
        annotations: definition.annotations,
      },
      async (args: Record<string, unknown>) => {
        const output = await executeTool(definition.name, args, client);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
          structuredContent: output,
          isError: "error" in output,
        };
      },
    );
  }

  return server;
}
