import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RegionExcerptInputSchema, WorkspaceCommandBatchSchema,
  type WorkspaceCard } from "../../../packages/protocol/src/workspace";
import { PDFDocument } from "pdf-lib";
import { decodeImage } from "./chat-images";
import { Library } from "./library";
import { Workspaces } from "./workspace";
import { WorkspaceCommandV2Schema } from "../../../packages/protocol/src/workspace-commands";

interface AssetRecord {
  id: string;
  bookId: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

/** Core owns immutable PNG bytes and their book-scoped references. */
export class WorkspaceAssets {
  constructor(private readonly library: Library, private readonly workspaces: Workspaces) {}

  private path(bookId: string, assetId: string) {
    return join(this.library.directory, "workspace-assets", bookId, assetId + ".png");
  }
  async read(bookId: string, assetId: string) {
    this.library.book(bookId);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(assetId)) throw new Error("资源标识无效");
    const record = this.library.store.get<AssetRecord>("workspace-asset", assetId);
    if (record?.bookId !== bookId) throw new Error("图片不属于本书");
    return readFile(this.path(bookId, assetId));
  }
  private async pageBounds(bookId: string, page: number): Promise<[number, number, number, number]> {
    const key = `${bookId}:${page}`;
    const cached = this.library.store.get<[number, number, number, number]>("pdf-page-bounds", key);
    if (cached) return cached;
    const document = await PDFDocument.load(await readFile(this.library.file(bookId)),
      { updateMetadata: false });
    const proxy = document.getPage(page - 1);
    const media = proxy.getMediaBox(), crop = proxy.getCropBox();
    const bounds: [number, number, number, number] = [
      Math.max(media.x, crop.x), Math.max(media.y, crop.y),
      Math.min(media.x + media.width, crop.x + crop.width),
      Math.min(media.y + media.height, crop.y + crop.height),
    ];
    if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3])
      throw new Error("PDF 页面裁剪范围无效");
    this.library.store.put("pdf-page-bounds", key, bookId, bounds);
    return bounds;
  }
  async validateCommandObjects(bookId: string, raw: unknown, version: 1 | 2 = 1) {
    const batch = version === 2 ? WorkspaceCommandV2Schema.parse(raw) : WorkspaceCommandBatchSchema.parse(raw);
    if (batch.bookId !== bookId) throw new Error("工作区命令与书籍不匹配");
    const book = this.library.book(bookId);
    const bounds = new Map<number, [number, number, number, number]>();
    for (const change of batch.changes) {
      if (change.type !== "upsert-object") continue;
      const object = change.object;
      const areas = object.kind === "ink" ? object.segments.map((segment) => ({
        surface: segment.surface, points: segment.points,
      })) : [{ surface: object.surface, points: [
        [object.x, object.y], [object.x + object.width, object.y + object.height],
      ] }];
      for (const area of areas) {
        if (area.surface.kind !== "pdf") continue;
        if (area.surface.fingerprint !== book.fingerprint || area.surface.page > book.pages)
          throw new Error("画布对象不属于此 PDF");
        let page = bounds.get(area.surface.page);
        if (!page) {
          page = await this.pageBounds(bookId, area.surface.page);
          bounds.set(area.surface.page, page);
        }
        if (area.points.some(([x, y]) => x < page![0] - 1 || x > page![2] + 1 ||
            y < page![1] - 1 || y > page![3] + 1))
          throw new Error("画布对象超出 PDF 页面范围");
      }
    }
    return batch;
  }
  async createRegion(bookId: string, raw: unknown) {
    const input = RegionExcerptInputSchema.parse(raw);
    const book = this.library.book(bookId);
    if (input.bookId !== bookId || input.fingerprint !== book.fingerprint || input.page > book.pages ||
        input.rect[2] <= input.rect[0] || input.rect[3] <= input.rect[1])
      throw new Error("图片摘录与书籍或页面不匹配");
    const bounds = await this.pageBounds(bookId, input.page);
    if (input.rect[0] < bounds[0] - 1 || input.rect[1] < bounds[1] - 1 ||
        input.rect[2] > bounds[2] + 1 || input.rect[3] > bounds[3] + 1)
      throw new Error("图片摘录超出 PDF 页面范围");
    const commandKey = `${bookId}:${input.commandId}`;
    if (this.library.store.get("workspace-command", commandKey))
      return { workspace: this.workspaces.get(bookId), cardId: input.commandId };
    const image = decodeImage({ name: input.title || "图片摘录", dataUrl: input.image });
    const assetId = randomUUID();
    const card: WorkspaceCard = {
      id: input.commandId,
      kind: "region",
      title: input.title || `第 ${book.labels[input.page - 1] ?? input.page} 页摘录`,
      text: "",
      comment: "",
      x: input.x,
      y: input.y,
      width: 300,
      height: Math.max(180, Math.min(900, Math.round(300 * image.height / image.width + 115))),
      region: {
        fingerprint: book.fingerprint,
        page: input.page,
        rect: input.rect,
        assetId,
        includePersonalMarks: input.includePersonalMarks,
      },
    };
    const record: AssetRecord = {
      id: assetId, bookId, width: image.width, height: image.height,
      bytes: image.buffer.length,
      sha256: createHash("sha256").update(image.buffer).digest("hex"),
    };
    const directory = join(this.library.directory, "workspace-assets", bookId);
    await mkdir(directory, { recursive: true });
    const path = this.path(bookId, assetId), temporary = path + ".tmp";
    await writeFile(temporary, image.buffer, { flag: "wx" });
    try {
      await rename(temporary, path);
      const workspace = this.workspaces.command(bookId, {
        bookId, commandId: input.commandId, expectedVersion: input.expectedVersion,
        changes: [{ type: "upsert-card", card }],
      }, () => this.library.store.put("workspace-asset", assetId, bookId, record));
      if (workspace.cards.find((entry) => entry.id === card.id)?.region?.assetId !== assetId)
        await rm(path, { force: true });
      return { workspace, cardId: card.id };
    } catch (error) {
      await rm(path, { force: true });
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
