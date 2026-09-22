import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  ChatImageInputSchema,
  MAX_CHAT_IMAGES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_PIXELS,
  type ChatImage,
  type ChatTurn,
  type ChatImageInput,
} from "../../../packages/protocol/src";
import { Library } from "./library";

function decode(input: ChatImageInput) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.dataUrl))
    throw new Error("图片格式无效，请重新粘贴或选择图片");
  const bytes = Buffer.from(input.dataUrl.slice(22), "base64");
  if (
    bytes.length < 45 ||
    bytes.length > MAX_CHAT_IMAGE_BYTES ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("图片无效或超过 8 MB");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width * height > MAX_CHAT_IMAGE_PIXELS ||
    bytes[24] !== 8 ||
    ![2, 6].includes(bytes[25]) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  )
    throw new Error("图片尺寸或格式不支持，请缩小截图后重试");
  // Bound decoding before allocation, including duplicate headers and chunk counts.
  let ended = false,
    chunks = 0;
  for (let offset = 8; offset < bytes.length; ) {
    if (ended || ++chunks > 10000 || offset + 12 > bytes.length)
      throw new Error("图片损坏");
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8);
    if (
      offset + 12 + length > bytes.length ||
      (type === "IHDR" && offset !== 8)
    )
      throw new Error("图片损坏");
    ended = type === "IEND";
    offset += length + 12;
  }
  if (!ended) throw new Error("图片损坏");
  try {
    const png = PNG.sync.read(bytes, { checkCRC: true });
    const normalized = PNG.sync.write(png);
    if (normalized.length > MAX_CHAT_IMAGE_BYTES)
      throw new Error("Image too large");
    return { name: input.name, width, height, buffer: normalized };
  } catch {
    throw new Error("图片损坏或超过 8 MB，请重新截图");
  }
}

export class ChatImages {
  constructor(private library: Library) {}
  create(bookId: string, input: ChatImageInput[]) {
    this.library.book(bookId);
    const values = ChatImageInputSchema.array()
      .max(MAX_CHAT_IMAGES)
      .parse(input)
      .map(decode);
    const images: ChatImage[] = [];
    try {
      if (values.length)
        mkdirSync(join(this.library.directory, "chat-images", bookId), {
          recursive: true,
        });
      for (const value of values) {
        const image = {
          id: randomUUID(),
          name: value.name,
          width: value.width,
          height: value.height,
          bytes: value.buffer.length,
        };
        writeFileSync(this.path(bookId, image.id), value.buffer, {
          flag: "wx",
        });
        images.push(image);
      }
      return images;
    } catch (error) {
      this.discard(bookId, images);
      throw error;
    }
  }
  discard(bookId: string, images: ChatImage[]) {
    for (const image of images) {
      try {
        unlinkSync(this.path(bookId, image.id));
      } catch {
        /* Best-effort rollback of newly created files only. */
      }
    }
  }
  private path(bookId: string, id: string) {
    return join(this.library.directory, "chat-images", bookId, id + ".png");
  }
  asset(bookId: string, id: string) {
    this.library.book(bookId);
    const image = this.library.store
      .list<ChatTurn>("turn", bookId)
      .flatMap((turn) => turn.images ?? [])
      .find((image) => image.id === id);
    if (!image) throw new Error("图片不存在或不属于本书");
    return this.path(bookId, image.id);
  }
}
