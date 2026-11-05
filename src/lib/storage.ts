import { openDB } from "idb";
import { investigationSchema, type Investigation } from "./domain";

const database = () =>
  openDB("wallet-map", 1, {
    upgrade(db) {
      db.createObjectStore("investigations", { keyPath: "id" });
    },
  });
export async function saveInvestigation(investigation: Investigation) {
  const db = await database();
  await db.put("investigations", {
    ...investigation,
    savedAt: new Date().toISOString(),
  });
  db.close();
}
export async function listInvestigations(): Promise<Investigation[]> {
  const db = await database();
  const records: unknown[] = await db.getAll("investigations");
  db.close();
  return records
    .flatMap((r) => {
      const parsed = investigationSchema.safeParse(r);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function deleteInvestigation(id: string) {
  const db = await database();
  await db.delete("investigations", id);
  db.close();
}
export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
