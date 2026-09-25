import type { InkPage } from "./ink";

/** Supplied by the PDF adapter; no PDF.js or DOM objects cross this boundary. */
export interface WorkspacePage extends InkPage {
  locate(rect: [number, number, number, number]): { x: number; y: number };
}
