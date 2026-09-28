import "./connection-overlay.css";
import {
  projectConnections,
  type ConnectionEdge,
  type ConnectionOverlayItem,
  type ConnectionRect,
  type ProjectedEndpoint,
} from "./geometry";

export type ConnectionOverlayProps = Readonly<{
  /** Screen-space bounds of the positioned element that owns this overlay. */
  container: ConnectionRect;
  connections: readonly ConnectionOverlayItem[];
  className?: string;
  edgePadding?: number;
}>;

type EdgeLabelPlacement = Readonly<{
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}>;

function edgeLabelPlacement(
  endpoint: ProjectedEndpoint,
  edge: ConnectionEdge,
): EdgeLabelPlacement {
  switch (edge) {
    case "left":
      return {
        x: endpoint.point.x + 8,
        y: endpoint.point.y - 7,
        anchor: "start",
      };
    case "right":
      return {
        x: endpoint.point.x - 8,
        y: endpoint.point.y - 7,
        anchor: "end",
      };
    case "top":
      return {
        x: endpoint.point.x,
        y: endpoint.point.y + 15,
        anchor: "middle",
      };
    case "bottom":
      return { x: endpoint.point.x, y: endpoint.point.y - 8, anchor: "middle" };
  }
}

function EdgeLabel({ endpoint }: { endpoint: ProjectedEndpoint }) {
  if (!endpoint.offscreen || !endpoint.edge || !endpoint.edgeLabel) return null;
  const placement = edgeLabelPlacement(endpoint, endpoint.edge);
  return (
    <text
      className="connection-overlay-edge-label"
      x={placement.x}
      y={placement.y}
      textAnchor={placement.anchor}
    >
      {endpoint.edgeLabel}
    </text>
  );
}

/**
 * A screen-space, display-only connection layer. Its parent must be positioned;
 * the overlay never captures pointer input or owns persistent connection data.
 */
export function ConnectionOverlay({
  container,
  connections,
  className,
  edgePadding,
}: ConnectionOverlayProps) {
  const projected = projectConnections(container, connections, { edgePadding });
  if (container.width <= 0 || container.height <= 0 || !projected.length)
    return null;
  const classes = ["connection-overlay", className].filter(Boolean).join(" ");
  return (
    <svg
      aria-hidden="true"
      className={classes}
      data-connection-count={projected.length}
      viewBox={`0 0 ${container.width} ${container.height}`}
      preserveAspectRatio="none"
      style={{ pointerEvents: "none" }}
    >
      {projected.map((connection) => (
        <g
          key={connection.id}
          className={`connection-overlay-item${connection.selected ? " is-selected" : ""}`}
          data-connection-id={connection.id}
          data-kind={connection.kind}
          data-from-offscreen={connection.from.offscreen || undefined}
          data-to-offscreen={connection.to.offscreen || undefined}
        >
          <path className="connection-overlay-path" d={connection.curve.path} />
          {connection.selected && (
            <>
              <circle
                className="connection-overlay-endpoint"
                cx={connection.from.point.x}
                cy={connection.from.point.y}
                r="3"
              />
              <circle
                className="connection-overlay-endpoint"
                cx={connection.to.point.x}
                cy={connection.to.point.y}
                r="3"
              />
            </>
          )}
          {connection.label && connection.selected && (
            <text
              className="connection-overlay-label"
              x={connection.curve.midpoint.x}
              y={connection.curve.midpoint.y - 7}
              textAnchor="middle"
            >
              {connection.label}
            </text>
          )}
          <EdgeLabel endpoint={connection.from} />
          <EdgeLabel endpoint={connection.to} />
        </g>
      ))}
    </svg>
  );
}
