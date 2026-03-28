import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

type CsvDistrict = {
  name: string;
  state: string;
  key: string;
};

type ParsedCsv = {
  rowsRead: number;
  invalidRows: number;
  duplicateRows: number;
  districts: CsvDistrict[];
  headers: string[];
};

type DistrictRow = {
  id: string;
  name: string;
  state: string;
  isActive: boolean;
  createdAt: Date;
  referenceCount: number;
  assignmentCount: number;
  leadCount: number;
  customerDetailCount: number;
  publicLeadCount: number;
};

type SyncSummary = {
  csvPath: string;
  csvRowsRead: number;
  csvInvalidRows: number;
  csvDuplicateRows: number;
  csvUniqueRows: number;
  dbRowsBefore: number;
  dbDuplicateGroupsBefore: number;
  inserted: number;
  mergedDuplicates: number;
  activatedFromCsv: number;
  updatedLabels: number;
  deletedMissing: number;
  inactivatedMissing: number;
  mappingExportedRows: number;
  dbRowsAfter: number;
  dbDuplicateGroupsAfter: number;
};

type Options = {
  csvPath: string;
  apply: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mappingOutputPath = path.resolve(__dirname, "../../../web/public/districts.mapping.json");
const PRIORITY_STATES = ["Bihar", "Delhi"] as const;
const PRIORITY_STATE_RANK = new Map(
  PRIORITY_STATES.map((state, index) => [state.toLocaleLowerCase("en-US"), index])
);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return normalizeWhitespace(value).toLocaleLowerCase("en-US");
}

function buildDistrictKey(state: string, name: string) {
  return `${normalizeKey(state)}::${normalizeKey(name)}`;
}

function compareDistrictOrder(
  left: { state: string; name: string },
  right: { state: string; name: string }
) {
  const leftKey = left.state.trim().toLocaleLowerCase("en-US");
  const rightKey = right.state.trim().toLocaleLowerCase("en-US");

  const leftRank = PRIORITY_STATE_RANK.get(leftKey);
  const rightRank = PRIORITY_STATE_RANK.get(rightKey);

  if (leftRank !== undefined || rightRank !== undefined) {
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  const stateCompare = left.state.localeCompare(right.state);
  if (stateCompare !== 0) return stateCompare;
  return left.name.localeCompare(right.name);
}

function parseArgs(argv: string[]): Options {
  let csvPath = "";
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--csv") {
      csvPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }
  }

  if (!csvPath) {
    throw new Error("Missing required --csv <path> argument.");
  }

  return {
    csvPath: path.resolve(process.cwd(), csvPath),
    apply
  };
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm exec tsx src/scripts/sync-districts-from-csv.ts --csv <path> [--apply]",
      "",
      "Examples:",
      "  pnpm exec tsx src/scripts/sync-districts-from-csv.ts --csv C:\\Users\\chand\\Downloads\\india_states_districts_with_delhi.csv",
      "  pnpm exec tsx src/scripts/sync-districts-from-csv.ts --csv C:\\Users\\chand\\Downloads\\india_states_districts_with_delhi.csv --apply"
    ].join("\n")
  );
}

// Small CSV parser so the import works without adding another dependency.
function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }

      currentField += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length && rows[0]?.[0]?.charCodeAt(0) === 0xfeff) {
    rows[0][0] = rows[0][0].slice(1);
  }

  return rows;
}

function normalizeHeader(value: string) {
  return normalizeWhitespace(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

function findHeaderIndex(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => candidates.includes(normalizeHeader(header)));
}

async function loadCsv(csvPath: string): Promise<ParsedCsv> {
  const raw = await fs.readFile(csvPath, "utf8");
  const rows = parseCsvRows(raw).filter((row) => row.some((value) => value.trim().length > 0));

  if (rows.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const headers = rows[0] ?? [];
  const stateIndex = findHeaderIndex(headers, [
    "state",
    "statename",
    "stateut",
    "stateutname",
    "stateorut",
    "ut",
    "utname"
  ]);
  const districtIndex = findHeaderIndex(headers, [
    "district",
    "districtname",
    "districts",
    "districtorcity",
    "name"
  ]);

  if (stateIndex < 0 || districtIndex < 0) {
    throw new Error(
      `Could not detect district/state columns in CSV headers: ${headers.join(", ")}`
    );
  }

  const unique = new Map<string, CsvDistrict>();
  let invalidRows = 0;
  let duplicateRows = 0;

  for (const row of rows.slice(1)) {
    const rawState = normalizeWhitespace(row[stateIndex] ?? "");
    const rawDistrict = normalizeWhitespace(row[districtIndex] ?? "");

    if (!rawState || !rawDistrict) {
      invalidRows += 1;
      continue;
    }

    const key = buildDistrictKey(rawState, rawDistrict);
    if (unique.has(key)) {
      duplicateRows += 1;
      continue;
    }

    unique.set(key, {
      name: rawDistrict,
      state: rawState,
      key
    });
  }

  return {
    rowsRead: rows.length - 1,
    invalidRows,
    duplicateRows,
    districts: [...unique.values()].sort(compareDistrictOrder),
    headers
  };
}

function countDuplicateGroupsByKey(rows: Array<{ key: string }>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function pickSurvivor(rows: DistrictRow[], canonical?: CsvDistrict) {
  return [...rows].sort((left, right) => {
    const leftExact =
      canonical && left.name === canonical.name && left.state === canonical.state ? 1 : 0;
    const rightExact =
      canonical && right.name === canonical.name && right.state === canonical.state ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;
    if (left.referenceCount !== right.referenceCount) {
      return right.referenceCount - left.referenceCount;
    }
    return left.createdAt.getTime() - right.createdAt.getTime();
  })[0]!;
}

async function readCurrentDistrictRows(prisma: PrismaClient) {
  const [districts, publicLeadCounts] = await Promise.all([
    prisma.district.findMany({
      select: {
        id: true,
        name: true,
        state: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            assignments: true,
            leads: true,
            customerDetails: true
          }
        }
      },
      orderBy: [{ state: "asc" }, { name: "asc" }]
    }),
    prisma.publicLeadSubmission.groupBy({
      by: ["districtId"],
      _count: {
        _all: true
      }
    })
  ]);

  const publicLeadCountByDistrictId = new Map(
    publicLeadCounts.map((row) => [row.districtId, row._count._all])
  );

  return districts.map((district) => {
    const publicLeadCount = publicLeadCountByDistrictId.get(district.id) ?? 0;
    return {
      id: district.id,
      name: district.name,
      state: district.state,
      isActive: district.isActive,
      createdAt: district.createdAt,
      assignmentCount: district._count.assignments,
      leadCount: district._count.leads,
      customerDetailCount: district._count.customerDetails,
      publicLeadCount,
      referenceCount:
        district._count.assignments +
        district._count.leads +
        district._count.customerDetails +
        publicLeadCount
    } satisfies DistrictRow;
  });
}

async function mergeDistrictIntoSurvivor(
  prisma: PrismaClient,
  sourceId: string,
  survivorId: string
) {
  const assignments = await prisma.userDistrictAssignment.findMany({
    where: { districtId: sourceId },
    select: { userId: true }
  });

  if (assignments.length) {
    await prisma.userDistrictAssignment.createMany({
      data: assignments.map((assignment) => ({
        districtId: survivorId,
        userId: assignment.userId
      })),
      skipDuplicates: true
    });
  }

  await prisma.userDistrictAssignment.deleteMany({
    where: { districtId: sourceId }
  });
  await prisma.lead.updateMany({
    where: { districtId: sourceId },
    data: { districtId: survivorId }
  });
  await prisma.customerDetail.updateMany({
    where: { districtId: sourceId },
    data: { districtId: survivorId }
  });
  await prisma.publicLeadSubmission.updateMany({
    where: { districtId: sourceId },
    data: { districtId: survivorId }
  });
  await prisma.district.delete({
    where: { id: sourceId }
  });
}

async function exportDistrictMapping(prisma: PrismaClient) {
  const districts = await prisma.district.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      state: true
    },
    orderBy: [{ state: "asc" }, { name: "asc" }]
  });
  const orderedDistricts = [...districts].sort(compareDistrictOrder);

  const mapping = orderedDistricts.reduce<Record<string, Array<{ id: string; name: string }>>>(
    (acc, district) => {
      if (!acc[district.state]) {
        acc[district.state] = [];
      }
      acc[district.state].push({
        id: district.id,
        name: district.name
      });
      return acc;
    },
    {}
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    states: Object.keys(mapping),
    mapping,
    districts: orderedDistricts
  };

  await fs.mkdir(path.dirname(mappingOutputPath), { recursive: true });
  await fs.writeFile(mappingOutputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return orderedDistricts.length;
}

async function runSync(prisma: PrismaClient, csv: ParsedCsv, apply: boolean) {
  const csvByKey = new Map(csv.districts.map((district) => [district.key, district]));
  const beforeRows = await readCurrentDistrictRows(prisma);
  const beforeGroups = new Map<string, DistrictRow[]>();

  for (const row of beforeRows) {
    const key = buildDistrictKey(row.state, row.name);
    const group = beforeGroups.get(key) ?? [];
    group.push(row);
    beforeGroups.set(key, group);
  }

  const summary: SyncSummary = {
    csvPath: "",
    csvRowsRead: csv.rowsRead,
    csvInvalidRows: csv.invalidRows,
    csvDuplicateRows: csv.duplicateRows,
    csvUniqueRows: csv.districts.length,
    dbRowsBefore: beforeRows.length,
    dbDuplicateGroupsBefore: [...beforeGroups.values()].filter((group) => group.length > 1).length,
    inserted: 0,
    mergedDuplicates: 0,
    activatedFromCsv: 0,
    updatedLabels: 0,
    deletedMissing: 0,
    inactivatedMissing: 0,
    mappingExportedRows: 0,
    dbRowsAfter: beforeRows.length,
    dbDuplicateGroupsAfter: [...beforeGroups.values()].filter((group) => group.length > 1).length
  };

  const missingReferencedKeys: Array<{ id: string; name: string; state: string; refs: number }> =
    [];

  if (!apply) {
    const projectedKeys = new Set(csvByKey.keys());
    for (const [key, group] of beforeGroups) {
      if (projectedKeys.has(key)) {
        summary.mergedDuplicates += Math.max(group.length - 1, 0);
        continue;
      }

      const refCount = group.reduce((total, row) => total + row.referenceCount, 0);
      if (refCount > 0) {
        const survivor = pickSurvivor(group);
        missingReferencedKeys.push({
          id: survivor.id,
          name: survivor.name,
          state: survivor.state,
          refs: refCount
        });
        summary.mergedDuplicates += Math.max(group.length - 1, 0);
        summary.inactivatedMissing += 1;
      } else {
        summary.deletedMissing += group.length;
      }
    }

    for (const district of csv.districts) {
      const existing = beforeGroups.get(district.key);
      if (!existing?.length) {
        summary.inserted += 1;
        continue;
      }

      const survivor = pickSurvivor(existing, district);
      if (!survivor.isActive) {
        summary.activatedFromCsv += 1;
      }
      if (survivor.name !== district.name || survivor.state !== district.state) {
        summary.updatedLabels += 1;
      }
    }

    summary.dbRowsAfter =
      beforeRows.length + summary.inserted - summary.mergedDuplicates - summary.deletedMissing;
    summary.dbDuplicateGroupsAfter = 0;

    return {
      summary,
      missingReferencedKeys
    };
  }

  await prisma.$transaction(
    async (tx) => {
      const currentRows = await readCurrentDistrictRows(tx as unknown as PrismaClient);
      const groups = new Map<string, DistrictRow[]>();

      for (const row of currentRows) {
        const key = buildDistrictKey(row.state, row.name);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
      }

      for (const district of csv.districts) {
        const existingGroup = groups.get(district.key) ?? [];

        if (!existingGroup.length) {
          await tx.district.create({
            data: {
              id: randomUUID(),
              name: district.name,
              state: district.state,
              isActive: true
            }
          });
          summary.inserted += 1;
          continue;
        }

        const survivor = pickSurvivor(existingGroup, district);
        const duplicates = existingGroup.filter((row) => row.id !== survivor.id);

        for (const duplicate of duplicates) {
          await mergeDistrictIntoSurvivor(tx as unknown as PrismaClient, duplicate.id, survivor.id);
          summary.mergedDuplicates += 1;
        }

        if (!survivor.isActive) {
          summary.activatedFromCsv += 1;
        }
        if (survivor.name !== district.name || survivor.state !== district.state) {
          summary.updatedLabels += 1;
        }

        await tx.district.update({
          where: { id: survivor.id },
          data: {
            name: district.name,
            state: district.state,
            isActive: true
          }
        });
      }

      for (const [key, group] of groups) {
        if (csvByKey.has(key)) {
          continue;
        }

        const survivor = pickSurvivor(group);
        const duplicates = group.filter((row) => row.id !== survivor.id);
        for (const duplicate of duplicates) {
          await mergeDistrictIntoSurvivor(tx as unknown as PrismaClient, duplicate.id, survivor.id);
          summary.mergedDuplicates += 1;
        }

        const referenceCount = group.reduce((total, row) => total + row.referenceCount, 0);
        if (referenceCount > 0) {
          if (survivor.isActive) {
            await tx.district.update({
              where: { id: survivor.id },
              data: { isActive: false }
            });
          }
          summary.inactivatedMissing += 1;
          missingReferencedKeys.push({
            id: survivor.id,
            name: survivor.name,
            state: survivor.state,
            refs: referenceCount
          });
        } else {
          await tx.district.delete({
            where: { id: survivor.id }
          });
          summary.deletedMissing += 1;
        }
      }
    },
    { timeout: 600000, maxWait: 60000 }
  );

  summary.mappingExportedRows = await exportDistrictMapping(prisma);

  const afterRows = await readCurrentDistrictRows(prisma);
  summary.dbRowsAfter = afterRows.length;
  summary.dbDuplicateGroupsAfter = countDuplicateGroupsByKey(
    afterRows.map((row) => ({
      key: buildDistrictKey(row.state, row.name)
    }))
  );

  return {
    summary,
    missingReferencedKeys
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const csv = await loadCsv(options.csvPath);
  const clientUrl = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();

  if (!clientUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL is required.");
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: clientUrl
      }
    }
  });

  try {
    const result = await runSync(prisma, csv, options.apply);
    result.summary.csvPath = options.csvPath;

    console.log(JSON.stringify(result.summary, null, 2));

    if (result.missingReferencedKeys.length) {
      console.log(
        JSON.stringify(
          {
            keptInactiveBecauseReferenced: result.missingReferencedKeys
          },
          null,
          2
        )
      );
    }

    if (!options.apply) {
      console.log("Dry run only. Re-run with --apply to sync the database.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "District CSV sync failed with an unknown error."
  );
  process.exitCode = 1;
});
