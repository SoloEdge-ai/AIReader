export interface Chapter {
  depth?: number;
  parentId?: string;
  id: string;
  title: string;
  page: number;
  endPage: number;
  inferred: boolean;
}
export interface Book {
  lastOpenedAt?: string;
  id: string;
  fingerprint: string;
  title: string;
  pages: number;
  parsedPages: number;
  textPages: number;
  status: "queued" | "parsing" | "ready" | "error";
  error?: string;
  progress: number;
  createdAt: string;
  chapters: Chapter[];
  labels: string[];
  indexVersion: number;
}
export interface Bookmark {
  id: string;
  bookId: string;
  page: number;
  note: string;
}
