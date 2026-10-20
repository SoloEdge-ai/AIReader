import { z } from "zod";

const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const InquirySchema = z.object({
  action: z.enum(["explain", "compare", "check", "custom"]),
  targetIds: z.array(id).min(1).max(20),
  claimId: id.optional(),
  bounds: z.object({
    x: z.number().finite().min(0).max(1000000),
    y: z.number().finite().min(0).max(1000000),
    width: z.number().finite().min(0).max(1000000),
    height: z.number().finite().min(0).max(1000000),
  }).strict().optional(),
}).strict();
export type Inquiry = z.infer<typeof InquirySchema>;
