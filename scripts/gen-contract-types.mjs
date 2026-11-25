// Generates src/lib/content/types.generated.ts from the JSON Schemas in contracts/.
// Run with `bun run gen:contracts` after editing a schema; tests/contracts.test.mjs fails if the committed file is stale.
import { compileFromFile } from "json-schema-to-typescript";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

/** Schemas that become types, in output order. common.schema.json only holds shared $defs, so it is not listed. */
export const SCHEMAS = ["game", "lab", "project", "opening", "tab", "about", "play-v1"];

export const OUT = root("src/lib/content/types.generated.ts");

const HEADER = `/* Machine-written by scripts/gen-contract-types.mjs from contracts/*.schema.json. Do not hand-edit:
 * change the schema, then run \`bun run gen:contracts\`. */
`;

/** Split json2ts output into top-level declarations, keyed by exported name (comments travel with their declaration). */
function declarations(ts) {
  const out = [];
  const lines = ts.replace(/\r\n/g, "\n").trim().split("\n");
  let buf = [];
  let name = null;
  const flush = () => {
    if (name) out.push({ name, text: buf.join("\n").trim() });
    buf = [];
    name = null;
  };
  for (const line of lines) {
    const m = /^export (?:type|interface) (\w+)/.exec(line);
    // A new top-level declaration starts at its leading comment, or at the export line if it has none.
    if ((line.startsWith("/**") || m) && name) flush();
    buf.push(line);
    if (m) name = m[1];
  }
  flush();
  return out;
}

export async function generate() {
  const seen = new Map();
  const parts = [];
  for (const kind of SCHEMAS) {
    const ts = await compileFromFile(root(`contracts/${kind}.schema.json`), {
      bannerComment: "",
      additionalProperties: false,
      maxItems: -1,
      cwd: root("contracts"),
      format: true,
    });
    for (const d of declarations(ts)) {
      const prev = seen.get(d.name);
      if (prev === undefined) {
        seen.set(d.name, d.text);
        parts.push(d.text);
      } else if (prev !== d.text) {
        throw new Error(`gen-contract-types: ${d.name} differs between schemas (${kind}). Keep shared $defs identical.`);
      }
    }
  }
  return `${HEADER}\n${parts.join("\n\n")}\n`;
}

if (import.meta.main) {
  writeFileSync(OUT, await generate());
  console.log(`gen-contract-types: wrote ${OUT}`);
}
