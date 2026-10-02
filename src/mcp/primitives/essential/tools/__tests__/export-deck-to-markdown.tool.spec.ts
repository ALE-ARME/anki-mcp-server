import { Test, TestingModule } from "@nestjs/testing";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";
import { ExportDeckToMarkdownTool } from "../export-deck-to-markdown.tool";
import { htmlToMarkdown } from "../deckActions/actions/exportDeckToMarkdown.action";
import { parseToolResult } from "@/test-fixtures/test-helpers";

describe("htmlToMarkdown", () => {
  it("should convert bold, italic, and code tags correctly", () => {
    const input = "<b>Bold</b> and <i>Italic</i> and <code>inline code</code>";
    const res = htmlToMarkdown(input);
    expect(res.markdown).toBe("**Bold** and *Italic* and `inline code`");
  });

  it("should convert img tags to Obsidian wikilinks and extract filename", () => {
    const input = 'Question with <img src="diagram_1.png"> and <img src="folder/image%202.jpg">';
    const res = htmlToMarkdown(input);
    expect(res.markdown).toContain("![[diagram_1.png]]");
    expect(res.markdown).toContain("![[image 2.jpg]]");
    expect(res.images).toEqual(["diagram_1.png", "image 2.jpg"]);
  });

  it("should convert LaTeX math brackets to dollar syntax", () => {
    const input = "Formula \\(x = \\frac{a}{b}\\) and \\[E = mc^2\\]";
    const res = htmlToMarkdown(input);
    expect(res.markdown).toContain("$x = \\frac{a}{b}$");
    expect(res.markdown).toContain("$$E = mc^2$$");
  });
});

describe("ExportDeckToMarkdownTool", () => {
  let tool: ExportDeckToMarkdownTool;
  let ankiClient: { invoke: jest.Mock };

  beforeEach(async () => {
    ankiClient = {
      invoke: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportDeckToMarkdownTool,
        {
          provide: AnkiConnectClient,
          useValue: ankiClient,
        },
      ],
    }).compile();

    tool = module.get<ExportDeckToMarkdownTool>(ExportDeckToMarkdownTool);
  });

  it("should call remote AnkiConnect exportDeckToMarkdown if supported", async () => {
    ankiClient.invoke.mockResolvedValueOnce({
      success: true,
      deck: "TestDeck",
      exportedNotes: 42,
      copiedImages: 5,
      file: "C:\\path\\flashcards testdeck.md",
      filename: "flashcards testdeck.md",
      message: "Exported 42 notes",
    });

    const result = await tool.execute({ deckName: "TestDeck" });
    expect(result.success).toBe(true);
    expect(result.exportedNotes).toBe(42);
    expect(ankiClient.invoke).toHaveBeenCalledWith("exportDeckToMarkdown", {
      deck: "TestDeck",
    });
  });

  it("should return error if deckName is empty", async () => {
    const rawResult = await tool.execute({ deckName: "" });
    const result = parseToolResult(rawResult);
    expect(result.success).toBe(false);
    expect(result.error).toContain("deckName cannot be empty");
  });
});
