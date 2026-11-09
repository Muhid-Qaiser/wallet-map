"use client";

import cytoscape, { type Core } from "cytoscape";
import { useEffect, useRef } from "react";
import { shortAddress, type Address, type Connection } from "@/lib/domain";

type Props = {
  nodes: Address[];
  connections: Connection[];
  depths: Map<Address, number>;
  parents: Map<Address, Address>;
  roots: Address[];
  pinned: Address[];
  shared: Set<Address>;
  positions: Record<string, { x: number; y: number }>;
  selected: string | null;
  zoom: number;
  fit: number;
  fullScreen: boolean;
  onSelect: (kind: "address" | "connection", id: string) => void;
  onPosition: (address: string, position: { x: number; y: number }) => void;
};

function fitGraph(cy: Core, props: Props) {
  cy.resize();
  const positions = layerPositions(cy, props);
  cy.batch(() => {
    for (const address of props.nodes) {
      const position = props.positions[address] ?? positions.get(address);
      if (position) cy.getElementById(address).position(position);
    }
  });
  if (!isPortrait(cy) || !cy.nodes().length) {
    cy.fit(undefined, Math.min(48, Math.min(cy.width(), cy.height()) * 0.09));
    return;
  }
  const bounds = cy.elements().boundingBox();
  const width = cy.width();
  const height = cy.height();
  const top = width <= 335 ? 122 : 76;
  const bottom = props.fullScreen ? 110 : 66;
  const zoom = Math.max(
    cy.minZoom(),
    Math.min(
      cy.maxZoom(),
      (width - 36) / bounds.w,
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

function layerPositions(
  cy: Core,
  { nodes, depths, parents }: Pick<Props, "nodes" | "depths" | "parents">,
) {
  const layers = new Map<number, Address[]>();
  const portrait = isPortrait(cy);
  const separateLayer = Math.max(0, ...depths.values()) + 1;
  for (const address of nodes) {
    const depth = depths.get(address) ?? separateLayer;
    const layer = layers.get(depth) ?? [];
    layer.push(address);
    layers.set(depth, layer);
  }

  const children = new Map<Address, Address[]>();
  for (const [address, parent] of parents) {
    const branch = children.get(parent) ?? [];
    branch.push(address);
    children.set(parent, branch);
  }
  const order = new Map<Address, number>();
  const centers = new Map<Address, number>();
  const staggered = new Set<Address>();
  let lanes = 0;
  function visitBranch(address: Address) {
    order.set(address, order.size);
    const start = lanes;
    const branch = children.get(address) ?? [];
    if (!branch.length) lanes++;
    for (const [index, child] of branch.entries()) {
      if (staggered.has(child)) continue;
      const sibling = branch[index + 1];
      if (sibling && !children.has(child) && !children.has(sibling)) {
        order.set(child, order.size);
        order.set(sibling, order.size);
        centers.set(child, lanes - 0.3);
        centers.set(sibling, lanes + 0.3);
        staggered.add(sibling);
        lanes++;
      } else {
        visitBranch(child);
      }
    }
    centers.set(address, (start + lanes - 1) / 2);
  }
  for (const address of nodes) {
    if (!parents.has(address)) visitBranch(address);
  }
  const wrapLayers = lanes > (portrait ? 8 : 14);

  const positions = new Map<Address, { x: number; y: number }>();
  const step = portrait ? 85 : 106;
  const spacing = portrait ? 94 : 76;
  let offset = 0;
  for (const [, layer] of [...layers].sort(([a], [b]) => a - b)) {
    layer.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const breadth = wrapLayers
      ? Math.min(
          layer.length,
          portrait ? 4 : Math.max(6, Math.ceil(Math.sqrt(layer.length))),
        )
      : layer.length;
    layer.forEach((address, index) => {
      const track = Math.floor(index / breadth);
      const count = Math.min(breadth, layer.length - track * breadth);
      const cross =
        spacing *
        (wrapLayers
          ? (index % breadth) - (count - 1) / 2
          : (centers.get(address) ?? 0) - (lanes - 1) / 2);
      const along =
        offset + (wrapLayers ? track * step : staggered.has(address) ? 46 : 0);
      positions.set(
        address,
        portrait ? { x: cross, y: along } : { x: along, y: cross },
      );
    });
    offset +=
      (Math.ceil(layer.length / breadth) - 1) * step + (portrait ? 115 : 164);
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
            width: 42,
            height: 42,
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
            width: 34,
            height: 34,
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
            width: 58,
            height: 58,
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
            width: "mapData(count, 1, 10, 1.2, 4)",
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
      if (nextPortrait !== portrait) fitGraph(cy, callbacks.current);
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
    const positions = layerPositions(cy, {
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
          edge.data({ count, label }).toggleClass("direct", direct);
        else
          cy.add({
            group: "edges",
            data: { id: c.id, source: c.from, target: c.to, count, label },
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
    if (core.current) fitGraph(core.current, callbacks.current);
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
