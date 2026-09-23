import type {
  ReadingSelection,
  ReadingSnapshot,
  PdfRegionSourceInput,
} from "../../../packages/protocol/src";
import { MAX_CHAT_IMAGES } from "../../../packages/protocol/src";
import { prepareQuestionImage, type DraftImage } from "./QuestionImages";

export type QuestionDraft = {
  question: string;
  scope: ReadingSnapshot["scope"];
  attachment?: ReadingSelection;
  images: DraftImage[];
  preparing: number;
  imageError?: string;
};

const emptyDraft: QuestionDraft = {
  question: "",
  scope: "auto",
  images: [],
  preparing: 0,
};

// Lives with App, not the sidebar. A delayed submission must also update a
// reopened view without erasing a newer draft for the same book/session.
export class QuestionDraftStore {
  private drafts = new Map<string, QuestionDraft>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(key: string): QuestionDraft {
    return this.drafts.get(key) ?? emptyDraft;
  }

  update(key: string, patch: Partial<QuestionDraft>) {
    this.drafts.set(key, { ...this.get(key), ...patch });
    this.emit();
  }

  clearIfUnchanged(key: string, submitted: QuestionDraft) {
    if (this.get(key) !== submitted) return;
    this.drafts.delete(key);
    this.emit();
  }
  async addImages(key: string, files: File[], source?: PdfRegionSourceInput) {
    const draft = this.get(key);
    if (
      draft.images.length + draft.preparing + files.length >
      MAX_CHAT_IMAGES
    ) {
      this.update(key, { imageError: "每次最多添加 4 张图片" });
      return;
    }
    this.update(key, {
      preparing: draft.preparing + files.length,
      imageError: undefined,
    });
    for (const file of files) {
      try {
        const image = await prepareQuestionImage(file);
        this.update(key, {
          images: [
            ...this.get(key).images,
            { ...image, ...(source ? { source } : {}) },
          ],
        });
      } catch (error) {
        this.update(key, {
          imageError: error instanceof Error ? error.message : "图片处理失败",
        });
      } finally {
        this.update(key, { preparing: this.get(key).preparing - 1 });
      }
    }
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
