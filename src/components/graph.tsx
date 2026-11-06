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

function fitGraph(cy: Core) {
  cy.resize();
  cy.fit(undefined, Math.min(48, Math.min(cy.width(), cy.height()) * 0.09));
}

function placeNeighbor(
  cy: Core,
  center: { x: number; y: number },
  angle: number,
  distance: number,
) {
  const occupied = cy.nodes().map((node) => node.position());
  const atDistance = (radius: number) => ({
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  });
  let position = atDistance(distance);
  const searchLimit = distance + occupied.length * 192;
  while (
    distance < searchLimit &&
    occupied.some(
      (other) => Math.hypot(position.x - other.x, position.y - other.y) < 84,
    )
  ) {
    distance += 48;
    position = atDistance(distance);
  }
  return position;
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
            "background-color": "#25344b",
            "border-color": "#536b8c",
            "border-width": 1.5,
            width: 42,
            height: 42,
            label: "data(label)",
            color: "#adbbcd",
            "font-size": 10,
            "font-family": "Consolas, monospace",
            "text-valign": "bottom",
            "text-margin-y": 10,
            "text-background-color": "#101721",
            "text-background-opacity": 0.9,
            "text-background-padding": "3px",
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
            "background-color": "#29483f",
            "border-color": "#77bda0",
            "border-width": 3,
          },
        },
        { selector: "node.pinned", style: { "border-width": 4 } },
        {
          selector: "edge",
          style: {
            width: "mapData(count, 1, 10, 1.2, 4)",
            "line-color": "#42546b",
            "target-arrow-color": "#647992",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "control-point-step-size": 40,
            opacity: 0.8,
            "arrow-scale": 0.8,
          },
        },
        {
          selector: ".highlighted",
          style: {
            "border-color": "#f4d5a1",
            "border-width": 4,
            "line-color": "#d8ad70",
            "target-arrow-color": "#d8ad70",
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
    const first = cy.nodes().length === 0;
    cy.batch(() => {
      cy.elements()
        .filter((e) => !ids.has(e.id()))
        .remove();
      for (let i = 0; i < props.nodes.length; i++) {
        const address = props.nodes[i];
        if (!address) continue;
        const rootIndex = props.roots.indexOf(address);
        const classes = [
          rootIndex === 0 ? "root" : rootIndex === 1 ? "second" : "",
          props.shared.has(address) ? "shared" : "",
          props.pinned.includes(address) ? "pinned" : "",
        ].join(" ");
        const existing = cy.getElementById(address);
        if (existing.length) existing.classes(classes);
        else {
          const count = Math.max(1, props.nodes.length - 1),
            angle = ((i - 1) * 2 * Math.PI) / count - Math.PI / 2;
          const parent = props.connections.find(
            (c) =>
              (c.to === address && cy.getElementById(c.from).length) ||
              (c.from === address && cy.getElementById(c.to).length),
          );
          const parentId = parent
            ? parent.to === address
              ? parent.from
              : parent.to
            : props.roots[0];
          const parentPosition = parentId
            ? cy.getElementById(parentId).position()
            : undefined;
          const center = parentPosition ?? { x: 450, y: 320 };
          cy.add({
            group: "nodes",
            data: { id: address, label: shortAddress(address) },
            classes,
            position:
              props.positions[address] ??
              (rootIndex === 0
                ? { x: 450, y: 320 }
                : placeNeighbor(cy, center, angle, first ? 210 : 145)),
          });
        }
      }
      for (const c of props.connections)
        if (!cy.getElementById(c.id).length)
          cy.add({
            group: "edges",
            data: {
              id: c.id,
              source: c.from,
              target: c.to,
              count: c.transfers.length,
            },
          });
    });
  }, [
    props.nodes,
    props.connections,
    props.roots,
    props.pinned,
    props.shared,
    props.positions,
  ]);
  useEffect(() => {
    const cy = core.current;
    if (!cy) return;
    cy.elements().removeClass("highlighted");
    if (props.selected)
      cy.getElementById(props.selected).addClass("highlighted");
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
    if (core.current) fitGraph(core.current);
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
