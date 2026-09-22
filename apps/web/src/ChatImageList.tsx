import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
type PreviewImage = { id: string; name: string; url: string };

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
