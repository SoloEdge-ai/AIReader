import type {
  ReadingSelection,
  ReadingSnapshot,
  PdfRegionSourceInput,
  QuestionMaterialSnapshot,
} from "../../../packages/protocol/src";
import { MAX_CHAT_IMAGES, MAX_QUESTION_MATERIALS, questionMaterialCount,
  questionMaterialImageCount } from "../../../packages/protocol/src";
import { prepareQuestionImage, type DraftImage } from "./QuestionImages";

export type QuestionDraft = {
  question: string;
  scope: ReadingSnapshot["scope"];
  attachment?: ReadingSelection;
  images: DraftImage[];
  materials: QuestionMaterialSnapshot[];
  preparing: number;
  imageError?: string;
  materialError?: string;
};

const emptyDraft: QuestionDraft = {
  question: "",
  scope: "auto",
  images: [],
  materials: [],
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
      questionMaterialImageCount(draft.materials, draft.images.length + draft.preparing + files.length) >
      MAX_CHAT_IMAGES
    ) {
      this.update(key, { imageError: "每次最多添加 4 张图片" });
      return;
    }
    if (questionMaterialCount(draft.materials, draft.images.length + draft.preparing + files.length,
        Boolean(draft.attachment)) > MAX_QUESTION_MATERIALS) {
      this.update(key, { imageError: "本轮材料最多 20 项，请移除部分内容" });
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

  addMaterial(key: string, material: QuestionMaterialSnapshot) {
    const draft = this.get(key);
    if (draft.materials.some((entry) => entry.id === material.id)) return true;
    if (questionMaterialCount([...draft.materials, material], draft.images.length,
        Boolean(draft.attachment)) > MAX_QUESTION_MATERIALS) {
      this.update(key, { materialError: "每轮最多 20 项材料，请移除部分选择" });
      return false;
    }
    const images = questionMaterialImageCount([...draft.materials, material], draft.images.length);
    if (images > MAX_CHAT_IMAGES) {
      this.update(key, { materialError: "本轮图片最多 4 张，请移除部分截图或材料" });
      return false;
    }
    this.update(key, { materials: [...draft.materials, material], materialError: undefined });
    return true;
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
