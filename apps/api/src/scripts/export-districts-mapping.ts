import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPublicDistrictsPayload } from "../services/districts.service.js";
import { prisma } from "../lib/prisma.js";

type MappingDistrict = {
  id: string;
  name: string;
};

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const defaultOutput = path.resolve(__dirname, "../../../web/public/districts.mapping.json");
  const outputPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2] as string)
    : defaultOutput;

  const payload = await getPublicDistrictsPayload();
  const lightweight = {
    generatedAt: new Date().toISOString(),
    states: payload.states,
    mapping: Object.fromEntries(
      Object.entries(payload.mapping).map(([state, districts]) => [
        state,
        districts.map((d) => ({ id: d.id, name: d.name } satisfies MappingDistrict))
      ])
    ),
    districts: payload.districts.map((d) => ({ id: d.id, name: d.name, state: d.state }))
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(lightweight, null, 2)}\n`, "utf8");

  console.log(
    `Exported districts mapping JSON to ${outputPath} (${lightweight.districts.length} districts)`
  );
}

main()
  .catch((error) => {
    console.error("Failed to export districts mapping JSON", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
