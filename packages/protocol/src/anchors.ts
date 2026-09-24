import { z } from "zod";

export const PdfAnchorSchema = z.object({
  page: z.number().int().positive(),
  rects: z
    .array(
      z.tuple([
        z.number().finite().min(-200000).max(200000),
        z.number().finite().min(-200000).max(200000),
        z.number().finite().min(-200000).max(200000),
        z.number().finite().min(-200000).max(200000),
      ]),
    )
    .min(1)
    .max(500),
});
export type PdfAnchor = z.infer<typeof PdfAnchorSchema>;
