/**
 * file-extractor.ts
 * Extracts text/image content from uploaded files for NPC chat attachments.
 */

// ─── Constants ───────────────────────────────────────────────────────

export const FILE_LIMITS = {
  maxFileSize: 5 * 1024 * 1024, // 5 MB
  maxFileCount: 3,
  maxTextLength: 50_000,
} as const;

const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv",
  ".pdf",
  ".xlsx", ".xls",
  ".docx", ".doc",
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
]);

// ─── Helpers ─────────────────────────────────────────────────────────

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export function isAllowedFileType(name: string, _mimeType: string): boolean {
  return ALLOWED_EXTENSIONS.has(extOf(name));
}

// ─── Types ───────────────────────────────────────────────────────────

export interface ExtractedFile {
  name: string;
  mimeType: string;
  textContent: string | null;
  base64Data: string | null;
  truncated: boolean;
}

// ─── Truncation ──────────────────────────────────────────────────────

function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= FILE_LIMITS.maxTextLength) {
    return { text, truncated: false };
  }
  const total = text.length.toLocaleString();
  const limit = FILE_LIMITS.maxTextLength.toLocaleString();
  const truncated = text.slice(0, FILE_LIMITS.maxTextLength);
  return {
    text: `${truncated}\n\n(... 이하 생략, 총 ${total}자 중 ${limit}자 표시)`,
    truncated: true,
  };
}

// ─── Extraction ──────────────────────────────────────────────────────

async function extractText(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8");
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text;
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    parts.push(`[Sheet: ${name}]\n${csv}`);
  }
  return parts.join("\n\n");
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractImage(
  buffer: Buffer,
  mimeType: string,
): Promise<{ base64Data: string }> {
  const sharp = (await import("sharp")).default;
  const resized = await sharp(buffer)
    .resize({ width: 1024, height: 1024, fit: "inside" })
    .toBuffer();
  const b64 = resized.toString("base64");
  return { base64Data: `data:${mimeType};base64,${b64}` };
}

// ─── Main extract function ───────────────────────────────────────────

export async function extractFileContent(
  buffer: Buffer,
  name: string,
  mimeType: string,
): Promise<ExtractedFile> {
  try {
    const ext = extOf(name);

    // Images
    if (mimeType.startsWith("image/")) {
      const { base64Data } = await extractImage(buffer, mimeType);
      return { name, mimeType, textContent: null, base64Data, truncated: false };
    }

    // Text-based
    let rawText: string | null = null;

    if ([".txt", ".md", ".json", ".csv"].includes(ext)) {
      rawText = await extractText(buffer);
    } else if (ext === ".pdf") {
      rawText = await extractPdf(buffer);
    } else if (ext === ".xlsx" || ext === ".xls") {
      rawText = await extractXlsx(buffer);
    } else if (ext === ".docx" || ext === ".doc") {
      rawText = await extractDocx(buffer);
    } else {
      return {
        name,
        mimeType,
        textContent: "지원하지 않는 파일 형식입니다.",
        base64Data: null,
        truncated: false,
      };
    }

    const { text, truncated } = truncateText(rawText);
    return { name, mimeType, textContent: text, base64Data: null, truncated };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name,
      mimeType,
      textContent: `[파일 처리 오류: ${name}] ${msg}`,
      base64Data: null,
      truncated: false,
    };
  }
}

// ─── Prompt builders ─────────────────────────────────────────────────

export function buildFilePromptSection(files: ExtractedFile[]): string {
  if (files.length === 0) return "";

  const sections = files.map((f) => {
    if (f.base64Data) {
      return `📎 첨부 이미지: ${f.name}`;
    }
    if (f.textContent) {
      return `📎 첨부파일: ${f.name}\n\`\`\`\n${f.textContent}\n\`\`\``;
    }
    return `📎 첨부파일: ${f.name} (내용을 읽을 수 없습니다)`;
  });

  return "\n\n" + sections.join("\n\n");
}

export function buildAttachments(
  files: ExtractedFile[],
): Array<{ name: string; mimeType: string; media: string }> | undefined {
  const images = files.filter((f) => f.base64Data);
  if (images.length === 0) return undefined;
  return images.map((f) => ({
    name: f.name,
    mimeType: f.mimeType,
    media: f.base64Data!,
  }));
}
