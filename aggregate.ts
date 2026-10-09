// Combines several benchmark runs into the README output section (markdown on stdout).
// Usage: node aggregate.ts <run dir>...   where each dir has the result.json and benchmark.txt of one run
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { printRanking, rankGroups, RANKING_LEGEND, type Group } from "./ranking.ts";

type Result = {
  cpu: string;
  cores: number;
  node: string;
  server: string;
  batch: number;
  sequential: Group[];
  pipelined: Group[];
};

const runs = process.argv.slice(2).map((dir) => ({
  result: JSON.parse(readFileSync(join(dir, "result.json"), "utf-8")) as Result,
  output: readFileSync(join(dir, "benchmark.txt"), "utf-8").trimEnd(),
}));

if (runs.length === 0) {
  console.error("Usage: node aggregate.ts <run dir>...");
  process.exit(1);
}

const sequential = runs.flatMap(({ result }) => result.sequential);
const pipelined = runs.flatMap(({ result }) => result.pipelined);
const names = [...new Set([...sequential, ...pipelined].flatMap((g) => g.rows.map((r) => r.name)))];
const shortName = (name: string) => name.replace(/ \(.*\)$/, "");

console.log("```shell");
console.log(`${runs.length} runs, each on its own GitHub-hosted runner`);

// The ranking depends on the CPU the runner gets, so show how each run ranked on its own
console.log(`\nOverall relative latency of each run`);
console.table(
  runs.map(({ result }, i) => {
    const ranked = rankGroups([...result.sequential, ...result.pipelined]);
    return {
      Run: i + 1,
      CPU: `${result.cpu} (${result.cores} cores)`,
      ...Object.fromEntries(names.map((n) => [shortName(n), ranked.find((r) => r.name === n)?.score.toFixed(3) ?? "-"])),
    };
  })
);

console.log(`\n=== Final ranking over all runs ===`);
console.log(RANKING_LEGEND);
printRanking(`Sequential (${sequential.length} groups)`, sequential);
printRanking(`Pipelined x${runs[0]!.result.batch} (${pipelined.length} groups)`, pipelined);
printRanking(`Overall (${sequential.length + pipelined.length} groups)`, [...sequential, ...pipelined]);
console.log("```");

for (const [i, { result, output }] of runs.entries()) {
  console.log(`\n<details>\n<summary>Run ${i + 1}: ${result.cpu}</summary>\n\n\`\`\`shell\n${output}\n\`\`\`\n\n</details>`);
}
