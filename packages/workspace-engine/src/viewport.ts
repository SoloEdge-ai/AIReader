/** Viewport coordinates are CSS pixels; all workspace content shares the zoom. */
export function zoomWorkspaceAtPointer(input: {
  zoom: number;
  left: number;
  top: number;
  x: number;
  y: number;
  deltaY: number;
  deltaMode: number;
  viewportHeight: number;
}) {
  const pixels =
    input.deltaY *
    (input.deltaMode === 1
      ? 16
      : input.deltaMode === 2
        ? input.viewportHeight
        : 1);
  const zoom = Math.max(
    0.4,
    Math.min(
      3,
      input.zoom * Math.exp(-Math.max(-300, Math.min(300, pixels)) * 0.002),
    ),
  );
  return {
    zoom,
    left: Math.max(0, ((input.left + input.x) * zoom) / input.zoom - input.x),
    top: Math.max(0, ((input.top + input.y) * zoom) / input.zoom - input.y),
  };
}
