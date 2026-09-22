import { useEffect, useRef } from "react";
import * as pdfjs from "pdfjs-dist";
import { fileUrl } from "./api";
export function BookCover({ id }: { id: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let dead = false;
    let task: ReturnType<typeof pdfjs.getDocument> | undefined;
    let render: ReturnType<pdfjs.PDFPageProxy["render"]> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || task) return;
        task = pdfjs.getDocument({
          url: fileUrl(id),
          withCredentials: true,
          isEvalSupported: false,
        });
        void task.promise
          .then(async (pdf) => {
            const page = await pdf.getPage(1);
            if (dead || !canvas.current) return;
            const viewport = page.getViewport({
              scale: 340 / page.getViewport({ scale: 1 }).width,
            });
            canvas.current.width = viewport.width;
            canvas.current.height = viewport.height;
            render = page.render({
              canvas: canvas.current,
              canvasContext: canvas.current.getContext("2d")!,
              viewport,
            });
            await render.promise;
          })
          .catch(() => {});
      },
      { rootMargin: "150px" },
    );
    observer.observe(canvas.current!);
    return () => {
      dead = true;
      observer.disconnect();
      render?.cancel();
      void task?.destroy();
    };
  }, [id]);
  return (
    <canvas ref={canvas} className="cover-canvas" aria-label="PDF 首页预览" />
  );
}
