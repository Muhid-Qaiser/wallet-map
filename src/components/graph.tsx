"use client";

import cytoscape, { type Core } from "cytoscape";
import { useEffect, useRef } from "react";
import {
  addressSchema,
  shortAddress,
  type Address,
  type Connection,
} from "@/lib/domain";

type Props = {
  nodes: Address[];
  connections: Connection[];
  depths: Map<Address, number>;
  roots: Address[];
  pinned: Address[];
  shared: Set<Address>;
  positions: Record<string, { x: number; y: number }>;
  selected: string | null;
  layout: number;
  zoom: number;
  fit: number;
  onSelect: (kind: "address" | "connection", id: string) => void;
  onPosition: (address: string, position: { x: number; y: number }) => void;
};

function fitGraph(cy: Core, props: Props) {
  cy.resize();
  const positions = ringPositions(cy, props);
  cy.batch(() => {
    for (const address of props.nodes) {
      const position = props.positions[address] ?? positions.get(address);
      if (position) cy.getElementById(address).position(position);
    }
  });
  cy.fit(undefined, Math.min(48, Math.min(cy.width(), cy.height()) * 0.09));
}

function ringPositions(
  cy: Core,
  {
    nodes,
    depths,
    connections,
  }: Pick<Props, "nodes" | "depths" | "connections">,
) {
  const rings = new Map<number, Address[]>();
  const horizontalScale = cy.width() < cy.height() ? 0.72 : 1;
  const outerRing = Math.max(0, ...depths.values()) + 1;
  for (const address of nodes) {
    const depth = depths.get(address) ?? outerRing;
    const ring = rings.get(depth) ?? [];
    ring.push(address);
    rings.set(depth, ring);
  }
  const positions = new Map<Address, { x: number; y: number }>();
  let radius = 0;
  for (const [depth, ring] of [...rings].sort(([a], [b]) => a - b)) {
    if (depth === 0) radius = ring.length > 1 ? 72 : 0;
    else radius = Math.max(radius + 130, (ring.length * 84) / (2 * Math.PI));
    const slots =
      depth > 1
        ? Math.max(ring.length, Math.floor((2 * Math.PI * radius) / 84))
        : ring.length;
    const angles = Array.from(
      { length: slots },
      (_, index) =>
        (index * 2 * Math.PI) / slots - (depth === 0 ? 0 : Math.PI / 2),
    );
    for (const address of ring) {
      const parent =
        depth > 1
          ? connections.find(
              (edge) =>
                (edge.from === address && depths.get(edge.to) === depth - 1) ||
                (edge.to === address && depths.get(edge.from) === depth - 1),
            )
          : undefined;
      const parentPosition = parent
        ? positions.get(parent.from === address ? parent.to : parent.from)
        : undefined;
      let slot = 0;
      if (parentPosition) {
        const parentAngle = Math.atan2(
          parentPosition.y,
          parentPosition.x / horizontalScale,
        );
        for (let index = 1; index < angles.length; index++) {
          if (
            Math.cos(angles[index] - parentAngle) >
            Math.cos(angles[slot] - parentAngle)
          )
            slot = index;
        }
      }
      const [angle] = angles.splice(slot, 1);
      positions.set(address, {
        x: Math.cos(angle) * radius * horizontalScale,
        y: Math.sin(angle) * radius,
      });
    }
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
            "background-color": "#6ca9ca",
            "border-color": "#acd5e9",
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
    const resize = new ResizeObserver(() => cy.resize());
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
    const positions = ringPositions(cy, {
      nodes: props.nodes,
      depths: props.depths,
      connections: props.connections,
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
    props.roots,
    props.pinned,
    props.shared,
    props.positions,
  ]);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    cy.elements().removeClass("highlighted");
    if (props.selected) {
      const selected = cy.getElementById(props.selected);
      selected.union(selected.connectedNodes()).addClass("highlighted");
    }
  }, [props.selected, props.nodes, props.connections]);
  useEffect(() => {
    const cy = core.current;
    if (!cy || props.layout === 0) return;
    cy.layout({
      name: "cose",
      animate: false,
      fit: true,
      padding: 60,
      nodeRepulsion: () => 200000,
      idealEdgeLength: () => 150,
    }).run();
    cy.nodes().forEach((node) => {
      const address = addressSchema.safeParse(node.id());
      if (address.success) props.onPosition(address.data, node.position());
    });
    // Position updates should not restart the requested arrangement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.layout]);
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
      data-testid="graph"
    />
  );
}
