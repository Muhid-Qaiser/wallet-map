import { expect, it } from "vitest";
import { radialPositions } from "@/components/graph";
import { addressSchema, type Address } from "@/lib/domain";

it("uses one visible arrow length for the first two hops of a crowded graph", () => {
  const address = (number: number) =>
    addressSchema.parse(`0x${String(number).padStart(40, "0")}`);
  const root = address(1);
  const nodes = [root];
  const depths = new Map<Address, number>([[root, 0]]);
  const parents = new Map<Address, Address>();
  function addChild(parent: Address, depth: number) {
    const child = address(nodes.length + 1);
    nodes.push(child);
    depths.set(child, depth);
    parents.set(child, parent);
    return child;
  }
  for (const count of [14, 13, 14, 11, 0]) {
    const direct = addChild(root, 1);
    for (let index = 0; index < count; index++) addChild(direct, 2);
  }

  const positions = radialPositions({ nodes, depths, parents });
  expect(positions.size).toBe(58);
  const lengths = [...parents].map(([child, parent]) => {
    const start = positions.get(parent);
    const end = positions.get(child);
    if (!start || !end) throw new Error("Missing wallet position");
    const nodeRadii = parent === root ? 29 + 21 : 21 + 17;
    return Math.hypot(end.x - start.x, end.y - start.y) - nodeRadii;
  });
  expect(Math.min(...lengths)).toBeGreaterThan(60);
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(0.01);
});
