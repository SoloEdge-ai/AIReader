import {
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_IMAGE_PIXELS,
  type ChatImageInput,
} from "../../../packages/protocol/src";
export type DraftImage = ChatImageInput & { id: string };

export async function prepareQuestionImage(file: File): Promise<DraftImage> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("支持 PNG、JPEG、WebP 图片");
  if (!file.size || file.size > MAX_CHAT_IMAGE_BYTES)
    throw new Error("每张图片不能超过 8 MB");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("图片无法读取，请重新截图或选择其他文件");
  }
  try {
    if (bitmap.width * bitmap.height > MAX_CHAT_IMAGE_PIXELS)
      throw new Error("图片不能超过 1600 万像素，请缩小截图");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,"))
      throw new Error("图片尺寸超出本机图像处理范围，请缩小截图后重试");
    if (((dataUrl.length - 22) * 3) / 4 > MAX_CHAT_IMAGE_BYTES)
      throw new Error("图片处理后超过 8 MB，请缩小截图");
    return {
      id: crypto.randomUUID(),
      name: (file.name || "截图.png").slice(0, 100),
      dataUrl,
    };
  } finally {
    bitmap.close();
  }
}
