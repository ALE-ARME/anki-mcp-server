import { Logger } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { McpController, Tool } from "@rekog/mcp-nest";
import { z } from "zod";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { createErrorResponse } from "@/mcp/utils/anki.utils";
import { exportDeckToMarkdown } from "./deckActions/actions/exportDeckToMarkdown.action";

@McpController()
export class ExportDeckToMarkdownTool {
  private readonly logger = new Logger(ExportDeckToMarkdownTool.name);

  constructor(private readonly ankiClient: AnkiConnectClient) {}

  @Tool({
    name: "exportDeckToMarkdown",
    description:
      "Export an Anki deck into an Obsidian-compatible Markdown file, saving it directly into the Vault's Flashcards archive ('20s - UNIVERSITY/24 - SCUOLA MISC/ANKI DECKS PACKAGES/Flashcards in md archive').",
    parameters: z.object({
      deckName: z
        .string()
        .min(1)
        .describe(
          "The name of the deck to export into Markdown format (e.g. 'BIOCHIMICA - ESAME DI STATO')",
        ),
      exportDir: z
        .string()
        .optional()
        .describe(
          "Optional custom directory to save the Markdown file and media images to (defaults to the Flashcards archive: '20s - UNIVERSITY/24 - SCUOLA MISC/ANKI DECKS PACKAGES/Flashcards in md archive')",
        ),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      deck: z.string(),
      exportedNotes: z.number(),
      copiedImages: z.number(),
      file: z.string(),
      filename: z.string(),
      message: z.string(),
    }),
    annotations: {
      title: "Export Deck to Markdown",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  })
  async execute(
    @Payload()
    params: {
      deckName: string;
      exportDir?: string;
    },
  ) {
    try {
      this.logger.log(`Executing exportDeckToMarkdown for deck: ${params.deckName}`);

      const result = await exportDeckToMarkdown(params, this.ankiClient);
      return result;
    } catch (error) {
      this.logger.error("Failed to execute exportDeckToMarkdown", error);
      return createErrorResponse(error, {
        action: "exportDeckToMarkdown",
        hint: "Make sure Anki is running and the deck name is valid",
      });
    }
  }
}
