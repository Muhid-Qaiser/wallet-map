"use client";

import cytoscape, { type Core } from "cytoscape";
import { useEffect, useRef } from "react";
import { shortAddress, type Address, type Connection } from "@/lib/domain";

type Point = { x: number; y: number };
type RingNode = { address: Address; angle: number };

const nodeSize = { root: 58, direct: 42, indirect: 34 };
const preferredArrowLength = 68;

type Props = {
  nodes: Address[];
  connections: Connection[];
  depths: Map<Address, number>;
  parents: Map<Address, Address>;
  roots: Address[];
  pinned: Address[];
  shared: Set<Address>;
  positions: Record<string, Point>;
  selected: string | null;
  zoom: number;
  fit: number;
  fullScreen: boolean;
  onSelect: (kind: "address" | "connection", id: string) => void;
  onPosition: (address: string, position: Point) => void;
};

function fitGraph(cy: Core, fullScreen: boolean) {
  cy.resize();
  if (!cy.nodes().length) return;
  const bounds = cy.elements().boundingBox();
  const width = cy.width();
  const height = cy.height();
  const portrait = isPortrait(cy);
  const padding = Math.min(48, Math.min(width, height) * 0.09);
  const sides = portrait ? 18 : padding;
  const top = portrait ? (width <= 335 ? 122 : 76) : padding;
  const bottom = portrait ? (fullScreen ? 110 : 66) : padding;
  const zoom = Math.max(
    cy.minZoom(),
    Math.min(
      1,
      (width - 2 * sides) / bounds.w,
      (height - top - bottom) / bounds.h,
    ),
  );
  cy.viewport({
    zoom,
    pan: {
      x: width / 2 - ((bounds.x1 + bounds.x2) / 2) * zoom,
      y: (height + top - bottom) / 2 - ((bounds.y1 + bounds.y2) / 2) * zoom,
    },
  });
}

function isPortrait(cy: Core) {
  return cy.width() < 580;
}

const branchAngles = [
  0,
  ...Array.from({ length: 10 }, (_, index) => {
    const angle = ((index + 1) * Math.PI) / 24;
    return [-angle, angle];
  }).flat(),
];

function positionsOverlap(a: Point, b: Point) {
  return Math.hypot((a.x - b.x) / 78, (a.y - b.y) / 62) < 1;
}

function uniformFanPositions(
  roots: RingNode[],
  direct: RingNode[],
  children: Map<Address, Address[]>,
) {
  const rootRadius = roots.length > 1 ? 46 : 0;
  const firstAngle = direct[0]?.angle ?? 0;
  const closestSpokes = Math.min(
    2 * Math.PI,
    ...direct.map(
      ({ angle }, index) =>
        (direct[index + 1]?.angle ?? firstAngle + 2 * Math.PI) - angle,
    ),
  );
  // Each fan stays inside the angular sector of its direct wallet.
  const maxFanSpan = Math.min((5 * Math.PI) / 6, closestSpokes * 1.8);
  const directInset = (nodeSize.root + nodeSize.direct) / 2;
  const branchInset = (nodeSize.direct + nodeSize.indirect) / 2;

  for (
    let arrowLength = preferredArrowLength;
    ;
    arrowLength += Math.max(10, arrowLength * 0.08)
  ) {
    const positions = new Map<Address, Point>();
    for (const { address, angle } of roots) {
      positions.set(address, {
        x: rootRadius * Math.cos(angle),
        y: rootRadius * Math.sin(angle),
      });
    }
    const directRadius = rootRadius + directInset + arrowLength;
    const branchRadius = branchInset + arrowLength;
    for (const { address, angle } of direct) {
      const origin = {
        x: directRadius * Math.cos(angle),
        y: directRadius * Math.sin(angle),
      };
      positions.set(address, origin);
      const branch = children.get(address) ?? [];
      const intervals = Math.max(1, branch.length - 1);
      const span =
        branch.length > 1 ? Math.min(maxFanSpan, (intervals * Math.PI) / 4) : 0;
      branch.forEach((child, index) => {
        const bearing = angle + span * (index / intervals - 0.5);
        positions.set(child, {
          x: origin.x + branchRadius * Math.cos(bearing),
          y: origin.y + branchRadius * Math.sin(bearing),
        });
      });
    }
    const points = [...positions.values()];
    if (
      points.every((point, index) =>
        points.every(
          (other, otherIndex) =>
            otherIndex >= index || !positionsOverlap(point, other),
        ),
      )
    )
      return { positions, arrowLength };
  }
}

function nearbyPosition(
  origin: Point,
  placed: Point[],
  preferredDistance: number,
): Point {
  const outward = Math.atan2(origin.y, origin.x);
  let closest: { point: Point; deviation: number } | undefined;
  for (let deviation = 0; ; deviation += 12) {
    const distances = deviation
      ? [preferredDistance - deviation, preferredDistance + deviation]
      : [preferredDistance];
    for (const distance of distances) {
      if (distance < 62) continue;
      for (const offset of branchAngles) {
        const dx = distance * Math.cos(outward + offset);
        const dy = distance * Math.sin(outward + offset);
        const point = { x: origin.x + dx, y: origin.y + dy };
        if (placed.some((other) => positionsOverlap(point, other))) continue;

        closest ??= { point, deviation };
        const blocked = placed.some((other) => {
          const x = other.x - origin.x;
          const y = other.y - origin.y;
          const along = (x * dx + y * dy) / distance;
          const across = Math.abs(x * dy - y * dx) / distance;
          return along > 0 && along < distance && across < 23;
        });
        if (!blocked) return point;
      }
    }
    // Allow a modest change in length to keep the arrow clear of other nodes.
    if (closest && deviation >= closest.deviation + 36) return closest.point;
  }
}

export function radialPositions({
  nodes,
  depths,
  parents,
}: Pick<Props, "nodes" | "depths" | "parents">) {
  const children = new Map<Address, Address[]>();
  for (const [address, parent] of parents) {
    const branch = children.get(parent) ?? [];
    branch.push(address);
    children.set(parent, branch);
  }
  const turn = 2 * Math.PI;

  const rings = new Map<number, RingNode[]>();
  function addToRing(depth: number, address: Address, angle: number) {
    const ring = rings.get(depth) ?? [];
    ring.push({ address, angle });
    rings.set(depth, ring);
  }
  function placeRing(
    branch: Address[],
    depth: number,
    start: number,
    span: number,
  ) {
    const weights = branch.map((address) => ({
      address,
      weight: depth === 0 ? Math.max(1, children.get(address)?.length ?? 0) : 1,
    }));
    const total = weights.reduce((sum, { weight }) => sum + weight, 0);
    for (const { address, weight } of weights) {
      const sector = (span * weight) / total;
      const angle = start + sector / 2;
      addToRing(depth, address, angle);
      if (depth === 0) placeRing(children.get(address) ?? [], 1, start, sector);
      start += sector;
    }
  }

  const roots = nodes.filter((address) => depths.get(address) === 0);
  placeRing(roots, 0, -Math.PI / 2, turn);

  const direct = rings.get(1) ?? [];
  const { positions, arrowLength } = uniformFanPositions(
    rings.get(0) ?? [],
    direct,
    children,
  );
  const branches = direct.flatMap(({ address }) => children.get(address) ?? []);
  for (const address of branches) {
    const origin = positions.get(address);
    if (!origin) continue;
    for (const child of children.get(address) ?? []) {
      const point = nearbyPosition(
        origin,
        [...positions.values()],
        arrowLength + nodeSize.indirect,
      );
      positions.set(child, point);
      branches.push(child);
    }
  }

  const separate = nodes.filter((address) => !depths.has(address));
  if (separate.length) {
    const connectedRadius = Math.max(
      0,
      ...[...positions.values()].map(({ x, y }) => Math.hypot(x, y)),
    );
    const spacingRadius =
      separate.length > 1 ? 82 / (2 * Math.sin(Math.PI / separate.length)) : 0;
    const outerRadius = Math.max(connectedRadius + 80, spacingRadius);
    separate.forEach((address, index) => {
      const angle = -Math.PI / 2 + (turn * index) / separate.length;
      positions.set(address, {
        x: outerRadius * Math.cos(angle),
        y: outerRadius * Math.sin(angle),
      });
    });
  }
  return positions;
}

export default function Graph(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const core = useRef<Core | null>(null);
  const callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  });
  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements: [],
      minZoom: 0.05,
      maxZoom: 2.5,
      selectionType: "single",
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#253951",
            "border-color": "#78a5ce",
            "border-width": 2,
            width: nodeSize.direct,
            height: nodeSize.direct,
            label: "data(label)",
            color: "#adbbcd",
            "font-size": 11,
            "font-family": "Consolas, monospace",
            "text-valign": "bottom",
            "text-wrap": "wrap",
            "text-margin-y": 8,
            "text-background-color": "#101721",
            "text-background-opacity": 0.9,
            "text-background-padding": "3px",
          },
        },
        {
          selector: "node.indirect",
          style: {
            "background-color": "#193b37",
            "border-color": "#70b6a2",
            width: nodeSize.indirect,
            height: nodeSize.indirect,
          },
        },
        {
          selector: "node.separate",
          style: {
            "background-color": "#222b3c",
            "border-color": "#77839a",
            "border-style": "dashed",
          },
        },
        {
          selector: "node.root",
          style: {
            "background-color": "#e9bd79",
            "border-color": "#f5dcae",
            width: nodeSize.root,
            height: nodeSize.root,
            color: "#f1dfc1",
            "border-width": 3,
          },
        },
        {
          selector: "node.second",
          style: {
            "background-color": "#b69460",
            "border-color": "#f5dcae",
            width: 54,
            height: 54,
          },
        },
        {
          selector: "node.shared",
          style: {
            "border-color": "#bd9ade",
            "border-style": "dashed",
            "border-width": 3,
          },
        },
        { selector: "node.pinned", style: { "border-width": 4 } },
        {
          selector: "edge",
          style: {
            width: 2.2,
            "line-color": "#3d716c",
            "target-arrow-color": "#73a99e",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "control-point-step-size": 40,
            opacity: 0.8,
            "arrow-scale": 1.05,
          },
        },
        {
          selector: "edge.direct",
          style: { "line-color": "#527392", "target-arrow-color": "#9cb9d7" },
        },
        { selector: "edge.muted", style: { opacity: 0.18 } },
        {
          selector: "node.highlighted",
          style: {
            "underlay-color": "#e9bd79",
            "underlay-opacity": 0.3,
            "underlay-padding": 6,
            "underlay-shape": "ellipse",
          },
        },
        {
          selector: "edge.highlighted, edge.hovered",
          style: {
            "line-color": "#d8ad70",
            "target-arrow-color": "#d8ad70",
            label: "data(label)",
            color: "#f1dfc1",
            "font-size": 11,
            "text-background-color": "#101721",
            "text-background-opacity": 1,
            "text-background-padding": "4px",
            opacity: 1,
            "z-index": 10,
          },
        },
      ],
    });
    cy.on("tap", "node", (event) => {
      const id: unknown = event.target.id();
      if (typeof id === "string") callbacks.current.onSelect("address", id);
    });
    cy.on("tap", "edge", (event) => {
      const id: unknown = event.target.id();
      if (typeof id === "string") callbacks.current.onSelect("connection", id);
    });
    cy.on("mouseover", "edge", (event) => event.target.addClass("hovered"));
    cy.on("mouseout", "edge", (event) => event.target.removeClass("hovered"));
    cy.on("dragfree", "node", (event) => {
      const id: unknown = event.target.id();
      const p: unknown = event.target.position();
      if (
        typeof id === "string" &&
        p &&
        typeof p === "object" &&
        "x" in p &&
        "y" in p &&
        typeof p.x === "number" &&
        typeof p.y === "number"
      )
        callbacks.current.onPosition(id, { x: p.x, y: p.y });
    });
    let portrait = isPortrait(cy);
    const resize = new ResizeObserver(() => {
      cy.resize();
      const nextPortrait = isPortrait(cy);
      if (nextPortrait !== portrait) fitGraph(cy, callbacks.current.fullScreen);
      portrait = nextPortrait;
    });
    resize.observe(container.current);
    core.current = cy;
    return () => {
      resize.disconnect();
      cy.destroy();
      core.current = null;
    };
  }, []);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    const ids = new Set([
      ...props.nodes,
      ...props.connections.map((c) => c.id),
    ]);
    const positions = radialPositions({
      nodes: props.nodes,
      depths: props.depths,
      parents: props.parents,
    });
    cy.batch(() => {
      cy.elements()
        .filter((e) => !ids.has(e.id()))
        .remove();
      for (const address of props.nodes) {
        const rootIndex = props.roots.indexOf(address);
        const depth = props.depths.get(address);
        const position = props.positions[address] ??
          positions.get(address) ?? { x: 0, y: 0 };
        const classes = [
          rootIndex === 0 ? "root" : rootIndex === 1 ? "second" : "",
          depth === undefined ? "separate" : depth > 1 ? "indirect" : "",
          props.shared.has(address) ? "shared" : "",
          props.pinned.includes(address) ? "pinned" : "",
        ].join(" ");
        const label =
          rootIndex === 0
            ? `Start\n${shortAddress(address)}`
            : rootIndex === 1
              ? `Compare\n${shortAddress(address)}`
              : shortAddress(address);
        const existing = cy.getElementById(address);
        if (existing.length) {
          existing.classes(classes).data("label", label).position(position);
        } else {
          cy.add({
            group: "nodes",
            data: { id: address, label },
            classes,
            position,
          });
        }
      }
      for (const c of props.connections) {
        const count = c.transfers.length;
        const label = `${count} transfer${count === 1 ? "" : "s"}`;
        const direct =
          props.depths.get(c.from) === 0 || props.depths.get(c.to) === 0;
        const edge = cy.getElementById(c.id);
        if (edge.length)
          edge.data("label", label).toggleClass("direct", direct);
        else
          cy.add({
            group: "edges",
            data: { id: c.id, source: c.from, target: c.to, label },
            classes: direct ? "direct" : "",
          });
      }
    });
  }, [
    props.nodes,
    props.connections,
    props.depths,
    props.parents,
    props.roots,
    props.pinned,
    props.shared,
    props.positions,
  ]);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    cy.elements().removeClass("highlighted muted");
    if (props.selected) {
      const selected = cy.getElementById(props.selected);
      selected.union(selected.connectedNodes()).addClass("highlighted");
      if (
        selected.isNode() &&
        !selected.hasClass("root") &&
        !selected.hasClass("second")
      ) {
        cy.edges().not(selected.connectedEdges()).addClass("muted");
      } else if (selected.isEdge()) {
        cy.edges().not(selected).addClass("muted");
      }
    }
  }, [props.selected, props.nodes, props.connections, props.roots]);
  useEffect(() => {
    const cy = core.current;
    if (!cy || props.zoom === 0) return;
    cy.zoom({
      level: Math.min(
        cy.maxZoom(),
        Math.max(cy.minZoom(), cy.zoom() * (props.zoom > 0 ? 1.2 : 1 / 1.2)),
      ),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }, [props.zoom]);
  useEffect(() => {
    if (core.current) fitGraph(core.current, callbacks.current.fullScreen);
  }, [props.fit]);
  return (
    <div
      ref={container}
      className="graph-canvas"
      role="img"
      aria-label={`Wallet relationship graph: ${props.nodes.length} addresses, ${props.connections.length} directed connections. Use the table view for keyboard access.`}
      aria-describedby="graph-reading-guide"
      data-testid="graph"
    />
  );
}
