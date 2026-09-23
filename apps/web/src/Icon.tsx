const paths = {
  link: "m10 13 4-4M8 15l-2 2a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m4 0 2-2a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  fit: "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6",
  focus:
    "M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6Zm12 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  down: "m6 9 6 6 6-6",
  copy: "M9 9h12v12H9ZM15 5V3H3v12h2",
  outward: "M7 17 17 7M7 7h10v10",
  newChat: "M12 4H4v16h16v-8M10 14l1-4 8-8 3 3-8 8Z",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8Z",
  chevron: "m9 6 6 6-6 6",
  reset: "M3 3v6h6M3 9a9 9 0 1 1 0 6",
  check: "m5 12 4 4L19 6",
  stop: "M6 6h12v12H6Z",
  back: "m14 6-6 6 6 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  chat: "M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z",
  note: "M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h6",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  plus: "M12 5v14M5 12h14",
  image: "M3 3h18v18H3ZM3 16l6-6 4 4 3-3 5 5M15 7h.01",
  close: "m6 6 12 12M6 18 18 6",
  bookmark: "M6 3h12v18l-6-4-6 4Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  book: "M12 5C7 2 3 3 3 3v16s4-1 9 2c5-3 9-2 9-2V3s-4-1-9 2Zm0 0v16",
  arrow: "M12 20V4m-7 7 7-7 7 7",
  pen: "m4 16 12-12 4 4L8 20H4Zm10-10 4 4",
  crop: "M5 2v17h17M2 5h17v17",
  undo: "M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12",
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
