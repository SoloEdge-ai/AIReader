import { z } from "zod";

export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_CHAT_IMAGE_PIXELS = 16000000;
export const PdfRegionSourceInputSchema = z
  .object({
    kind: z.literal("pdf-region"),
    bookId: z.string().min(1).max(100),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    page: z.number().int().positive(),
    /** PDF coordinates [x1, y1, x2, y2], not normalized citation rectangles. */
    rect: z.tuple([
      z.number().finite().min(-200000).max(200000),
      z.number().finite().min(-200000).max(200000),
      z.number().finite().min(-200000).max(200000),
      z.number().finite().min(-200000).max(200000),
    ]),
  })
  .strict()
  .refine(
    (value) => value.rect[2] > value.rect[0] && value.rect[3] > value.rect[1],
    "图片来源区域必须具有正面积",
  );
export type PdfRegionSourceInput = z.infer<typeof PdfRegionSourceInputSchema>;
export interface PdfRegionSource extends PdfRegionSourceInput {
  /** Core supplies the page label; this is position metadata, not a verified text citation. */
  label: string;
}
export const ChatImageInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    dataUrl: z.string().max(Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4 + 64),
    source: PdfRegionSourceInputSchema.optional(),
  })
  .strict();
export type ChatImageInput = z.infer<typeof ChatImageInputSchema>;
export interface ChatImage {
  id: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  source?: PdfRegionSource;
}
