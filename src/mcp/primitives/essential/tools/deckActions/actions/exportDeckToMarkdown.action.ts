import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { AnkiConnectClient } from "@/mcp/clients/anki-connect.client";

/**
 * Parameters for exportDeckToMarkdown action
 */
export interface ExportDeckToMarkdownParams {
  /** Target deck name to export */
  deckName: string;

  /** Optional custom export directory */
  exportDir?: string;
}

/**
 * Result of exportDeckToMarkdown action
 */
export interface ExportDeckToMarkdownResult {
  success: boolean;
  deck: string;
  exportedNotes: number;
  copiedImages: number;
  file: string;
  filename: string;
  message: string;
}

/**
 * Unescapes standard HTML entities and numeric character references
 */
function unescapeHtml(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    );
}

/**
 * Converts Anki HTML field content into Obsidian Markdown and extracts image filenames.
 * Matches the logic in the user's export_deck_to_markdown Anki add-on.
 */
export function htmlToMarkdown(htmlStr: string): {
  markdown: string;
  images: string[];
} {
  if (!htmlStr || htmlStr.trim() === "") {
    return { markdown: "", images: [] };
  }

  let s = htmlStr;

  // Math formulas conversion: Anki -> Obsidian
  s = s.replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, "$$$$$1$$$$");
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, "$$$$$1$$$$");
  s = s.replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, "$$$1$$");
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$");

  const images: string[] = [];

  // Extract <img src="..."> tags and convert to Obsidian wikilinks ![[image.ext]]
  s = s.replace(
    /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi,
    (_, src: string) => {
      const decodedSrc = decodeURIComponent(src);
      const filename = path.basename(decodedSrc);
      if (filename) {
        images.push(filename);
        return `![[${filename}]]`;
      }
      return "";
    },
  );

  // Formatting tags conversion
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  s = s.replace(/<(s|strike|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~");
  s = s.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, "<u>$1</u>");

  // Line breaks and blocks
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>/gi, "\n\n");
  s = s.replace(/<\/div>/gi, "\n");
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");

  // Links <a href="...">text</a> -> [text](href)
  s = s.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Strip remaining HTML tags
  s = s.replace(/<[^>]+>/g, "");

  // Unescape entities and normalize non-breaking spaces
  s = unescapeHtml(s);
  s = s.replace(/\u00a0/g, " ");

  // Clean lines and blank space
  const lines = s.split("\n").map((line) => line.trimEnd());
  const cleaned: string[] = [];
  let blank = false;
  for (const l of lines) {
    if (!l.trim()) {
      if (!blank) {
        cleaned.push("");
        blank = true;
      }
    } else {
      cleaned.push(l);
      blank = false;
    }
  }

  return {
    markdown: cleaned.join("\n").trim(),
    images,
  };
}

/**
 * Extracts Front and Back field contents from an Anki note object
 */
function extractFrontAndBack(note: any): { frontRaw: string; backRaw: string } {
  const fields = note.fields || {};

  if (fields["Fronte"] && fields["Retro"]) {
    return {
      frontRaw: fields["Fronte"].value || "",
      backRaw: fields["Retro"].value || "",
    };
  }

  if (fields["Front"] && fields["Back"]) {
    return {
      frontRaw: fields["Front"].value || "",
      backRaw: fields["Back"].value || "",
    };
  }

  const keys = Object.keys(fields);
  if (keys.length >= 2) {
    return {
      frontRaw: fields[keys[0]].value || "",
      backRaw: fields[keys[1]].value || "",
    };
  }

  if (keys.length === 1) {
    return {
      frontRaw: fields[keys[0]].value || "",
      backRaw: "",
    };
  }

  return { frontRaw: "", backRaw: "" };
}

const DEFAULT_ARCHIVE_PATH_WIN =
  "C:\\Users\\aless\\OneDrive\\RECORDS-OF-THE-ABYSS\\20s - UNIVERSITY\\24 - SCUOLA MISC\\ANKI DECKS PACKAGES\\Flashcards in md archive";

const DEFAULT_ARCHIVE_PATH_ANDROID =
  "/sdcard/OBSIDIAN/RECORDS-OF-THE-ABYSS/20s - UNIVERSITY/24 - SCUOLA MISC/ANKI DECKS PACKAGES/Flashcards in md archive";

/**
 * Resolves the destination directory for markdown exports
 */
function resolveExportDirectory(customDir?: string): string {
  if (customDir && customDir.trim() !== "") {
    return customDir.trim();
  }

  // If on Windows, check the Anki add-on config.json
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const addonConfigPath = path.join(
      appData,
      "Anki2",
      "addons21",
      "export_deck_to_markdown",
      "config.json",
    );
    try {
      if (fs.existsSync(addonConfigPath)) {
        const raw = fs.readFileSync(addonConfigPath, "utf-8");
        const cfg = JSON.parse(raw);
        if (
          cfg.export_dir &&
          typeof cfg.export_dir === "string" &&
          cfg.export_dir.trim() !== ""
        ) {
          return cfg.export_dir.trim();
        }
      }
    } catch {
      // Continue to default
    }
    return DEFAULT_ARCHIVE_PATH_WIN;
  }

  // Non-Windows (Termux / Android / Linux)
  try {
    if (fs.existsSync(DEFAULT_ARCHIVE_PATH_ANDROID)) {
      return DEFAULT_ARCHIVE_PATH_ANDROID;
    }
  } catch {
    // Continue to fallback
  }

  return path.join(process.cwd(), "export");
}

/**
 * Performs full export of the specified deck to Obsidian-compatible Markdown
 */
export async function exportDeckToMarkdown(
  params: ExportDeckToMarkdownParams,
  client: AnkiConnectClient,
): Promise<ExportDeckToMarkdownResult> {
  const { deckName, exportDir } = params;

  if (!deckName || deckName.trim() === "") {
    throw new Error("deckName cannot be empty");
  }

  const trimmedDeck = deckName.trim();

  // 1. First attempt: call AnkiConnect custom action if the add-on registered it
  try {
    const remoteResult = await client.invoke<any>("exportDeckToMarkdown", {
      deck: trimmedDeck,
    });
    if (remoteResult && remoteResult.success) {
      return {
        success: true,
        deck: trimmedDeck,
        exportedNotes: remoteResult.exportedNotes ?? 0,
        copiedImages: remoteResult.copiedImages ?? 0,
        file: remoteResult.file ?? "",
        filename: remoteResult.filename ?? "",
        message:
          remoteResult.message ||
          `Successfully exported deck "${trimmedDeck}" to Markdown via Anki add-on`,
      };
    }
  } catch {
    // If custom action is not available (e.g. Anki hasn't restarted yet),
    // smoothly fallback to direct execution below
  }

  // 2. Fallback: Direct export via standard AnkiConnect API calls
  const noteIds = await client.invoke<number[]>("findNotes", {
    query: `deck:"${trimmedDeck}"`,
  });

  if (!noteIds || noteIds.length === 0) {
    throw new Error(
      `No notes found in deck "${trimmedDeck}". Make sure the deck exists and has notes.`,
    );
  }

  const notes = await client.invoke<any[]>("notesInfo", {
    notes: noteIds,
  });

  if (!notes || notes.length === 0) {
    throw new Error(`Failed to retrieve note details for deck "${trimmedDeck}"`);
  }

  const targetDir = resolveExportDirectory(exportDir);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const cardsBlocks: string[] = [];
  const allReferencedImages = new Set<string>();

  for (const note of notes) {
    const rawModel = note.modelName || "Standard";
    const noteType =
      rawModel.toLowerCase() === "basic" || rawModel.toLowerCase() === "standard"
        ? "Standard"
        : rawModel;

    const { frontRaw, backRaw } = extractFrontAndBack(note);
    const frontConv = htmlToMarkdown(frontRaw);
    const backConv = htmlToMarkdown(backRaw);

    for (const img of frontConv.images) allReferencedImages.add(img);
    for (const img of backConv.images) allReferencedImages.add(img);

    const cardLines = [
      "START",
      noteType,
      frontConv.markdown,
      `Retro:${backConv.markdown}`,
      `<!--ID: ${note.noteId}-->`,
      "END",
    ];

    cardsBlocks.push(cardLines.join("\n"));
  }

  const header = `TARGET DECK: ${trimmedDeck}\n\n`;
  const fileContent = header + cardsBlocks.join("\n\n") + "\n";

  const safeName = trimmedDeck
    .replace(/::/g, " - ")
    .replace(/[\\/*?:"<>|]/g, "-")
    .trim();
  const filename = `flashcards ${safeName.toLowerCase()}.md`;
  const filePath = path.join(targetDir, filename);

  fs.writeFileSync(filePath, fileContent, "utf-8");

  // Copy / download referenced images
  let copiedImagesCount = 0;
  let localMediaDir: string | null = null;

  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const candidate = path.join(
      appData,
      "Anki2",
      "Utente 1",
      "collection.media",
    );
    if (fs.existsSync(candidate)) {
      localMediaDir = candidate;
    }
  }

  for (const imgName of allReferencedImages) {
    const destImgPath = path.join(targetDir, imgName);
    try {
      if (localMediaDir) {
        const srcImgPath = path.join(localMediaDir, imgName);
        if (fs.existsSync(srcImgPath)) {
          if (
            !fs.existsSync(destImgPath) ||
            fs.statSync(srcImgPath).size !== fs.statSync(destImgPath).size
          ) {
            fs.copyFileSync(srcImgPath, destImgPath);
          }
          copiedImagesCount++;
          continue;
        }
      }

      // Retrieve via AnkiConnect
      const base64Data = await client.invoke<string>("retrieveMediaFile", {
        filename: imgName,
      });
      if (base64Data) {
        const buffer = Buffer.from(base64Data, "base64");
        if (
          !fs.existsSync(destImgPath) ||
          fs.statSync(destImgPath).size !== buffer.length
        ) {
          fs.writeFileSync(destImgPath, buffer);
        }
        copiedImagesCount++;
      }
    } catch {
      // Non-fatal if a specific image cannot be retrieved
    }
  }

  return {
    success: true,
    deck: trimmedDeck,
    exportedNotes: notes.length,
    copiedImages: copiedImagesCount,
    file: filePath,
    filename,
    message: `Successfully exported ${notes.length} notes and ${copiedImagesCount} images to ${filename}`,
  };
}
