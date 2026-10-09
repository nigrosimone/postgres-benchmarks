// Ranking shared by index.ts (one run) and aggregate.ts (several runs).

export type Group = {
  label: string;
  rows: { name: string; medianNs: number }[];
  winner: string | null;
};

export const RANKING_LEGEND =
  `Relative latency is the geometric mean of each client's median latency, normalized to the fastest\n` +
  `client of every group: 1.000 means fastest everywhere, 1.100 means 10% slower than the group leader\n` +
  `on average. "Outright wins" counts only the groups whose winner was statistically clear.`;

// Aggregate several groups into one ranking.
//
// Each client's median is normalized against the fastest median of its own group, which makes the
// query sizes comparable (a `LIMIT 500` group is an order of magnitude slower than `LIMIT 1` and
// would otherwise dominate any average). Those per-group ratios are combined with a GEOMETRIC mean:
// for normalized numbers the arithmetic mean is not meaningful, since it would rank differently
// depending on which client happened to be the baseline.
export const rankGroups = (groups: Group[]) => {
  const names = [...new Set(groups.flatMap((g) => g.rows.map((r) => r.name)))];

  return names
    .map((name) => {
      let logSum = 0;
      let counted = 0;
      let wins = 0;
      let bestIn = 0;
      for (const group of groups) {
        const row = group.rows.find((r) => r.name === name);
        if (!row) continue;
        const best = Math.min(...group.rows.map((r) => r.medianNs));
        logSum += Math.log(row.medianNs / best);
        counted++;
        if (row.medianNs === best) bestIn++;
        if (group.winner === name) wins++;
      }
      return {
        name,
        // 1.00 = fastest everywhere; 1.15 = 15% slower than the group leader on average
        score: counted > 0 ? Math.exp(logSum / counted) : NaN,
        bestIn,
        wins,
        groups: counted,
      };
    })
    .filter((r) => Number.isFinite(r.score))
    .sort((a, b) => a.score - b.score);
};

const MEDALS = ["🥇", "🥈", "🥉"];

export const printRanking = (title: string, groups: Group[]) => {
  if (groups.length === 0) return;
  const ranked = rankGroups(groups);
  console.log(`\n${title}`);
  console.table(
    ranked.map((r, i) => ({
      "": MEDALS[i] ?? "  ",
      "Task name": r.name,
      // Geometric mean of per-group median latency, normalized to each group's leader
      "Relative latency": r.score.toFixed(3),
      "Slower than best": i === 0 ? "-" : `+${((r.score / ranked[0]!.score - 1) * 100).toFixed(1)}%`,
      "Fastest median": `${r.bestIn}/${r.groups}`,
      "Outright wins": `${r.wins}/${r.groups}`,
    }))
  );
};
