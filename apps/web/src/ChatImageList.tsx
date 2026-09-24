import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui/Icon";
type PreviewImage = {
  id: string;
  name: string;
  url: string;
  pageLabel?: string;
  source?: {
    page: number;
    label?: string;
    rect: [number, number, number, number];
  };
};

function ImagePreview({
  image,
  onClose,
}: {
  image: PreviewImage;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="image-preview-dialog"
      aria-label="图片预览"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <header>
        <span>{image.name}</span>
        <button
          aria-label="关闭图片预览"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </header>
      <img src={image.url} alt={image.name} />
      {image.source && (
        <p className="image-hint">
          本书第 {image.pageLabel ?? image.source.label ?? image.source.page}{" "}
          页区域（物理页 {image.source.page}） · PDF 坐标{" "}
          {image.source.rect.map((n) => Math.round(n)).join(", ")}
          <br />
          图片来源位置不代表 AI 的解释已获原文支持。
        </p>
      )}
    </dialog>
  );
}
export function ChatImageList({
  images,
  onRemove,
}: {
  images: PreviewImage[];
  onRemove?: (id: string) => void;
}) {
  const [preview, setPreview] = useState<PreviewImage>();
  if (!images.length) return null;
  return (
    <>
      <div
        className="chat-images"
        aria-label={onRemove ? "待发送图片" : "本轮图片"}
      >
        {images.map((image) => (
          <div className="image-attachment" key={image.id}>
            <button
              className="image-thumbnail"
              aria-label={`预览 ${image.name}`}
              onClick={() => setPreview(image)}
            >
              <img src={image.url} alt={image.name} />
              <span>{image.name}</span>
              {image.source && (
                <span>
                  本书第{" "}
                  {image.pageLabel ?? image.source.label ?? image.source.page}{" "}
                  页 · 区域
                </span>
              )}
            </button>
            {onRemove && (
              <button
                className="image-remove"
                aria-label={`移除图片 ${image.name}`}
                onClick={() => onRemove(image.id)}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        ))}
      </div>
      {preview && (
        <ImagePreview image={preview} onClose={() => setPreview(undefined)} />
      )}
    </>
  );
}
