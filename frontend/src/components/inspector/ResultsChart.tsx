/**
 * Plotly charts for model execution results.
 * Shows per-node values across trials as line plots.
 */

import { useMemo } from "react";
import Plot from "react-plotly.js";
import { CHART_SERIES, paletteColor } from "@/utils/paletteColor";

interface NodeLog {
  trials: number[];
  values: number[][][]; // trials × rows × cols
}

interface RunResults {
  results: { trial: number; output: number[][] }[];
  outputLabels?: string[]; // one label per output vector (#632)
  logs: Record<string, NodeLog>;
  numTrials: number;
}

// Each node's line takes the next chart series colour (styles/palette.css).

export function ResultsChart({ results }: { results: RunResults }) {
  const traces = useMemo(() => {
    const allTraces: any[] = [];
    let colorIdx = 0;

    for (const [nodeName, log] of Object.entries(results.logs)) {
      const cleanName = nodeName.replace(/-\d+$/, "");
      const color = paletteColor(CHART_SERIES[colorIdx % CHART_SERIES.length]);
      colorIdx++;

      // Each value is trials × [rows] × [cols]
      // Flatten to get per-dimension traces
      if (!log.values || log.values.length === 0) continue;

      // Determine dimensions from first trial
      const firstTrial = log.values[0];
      const flat = Array.isArray(firstTrial[0]) ? firstTrial[0] : firstTrial;
      const numDims = Array.isArray(flat) ? flat.length : 1;

      for (let dim = 0; dim < numDims; dim++) {
        const yValues = log.values.map((trialVal: any) => {
          // Navigate: trialVal might be [[x,y,z]] (1 row, N cols)
          const row = Array.isArray(trialVal[0]) ? trialVal[0] : trialVal;
          return Array.isArray(row) ? (row[dim] ?? 0) : row;
        });

        allTraces.push({
          // 1-indexed trial labels on the chart so "Trial 1" matches the
          // trial nav button and pill tooltip; raw trial_num lives on the
          // hover (Plotly's default hover prints x verbatim, which is what
          // we want for cross-referencing PsyNeuLink state). #336 gap 5.
          x: log.trials.map((t: number) => t + 1),
          y: yValues,
          type: "scatter",
          mode: "lines+markers",
          name: numDims > 1 ? `${cleanName}[${dim}]` : cleanName,
          line: { color, width: 2, dash: dim > 0 ? "dot" : "solid" },
          marker: { size: 5 },
        });
      }
    }

    return allTraces;
  }, [results]);

  // Also add output traces
  const outputTraces = useMemo(() => {
    if (!results.results || results.results.length === 0) return [];

    const numDims = results.results[0].output[0]?.length ?? 1;
    const outTraces: any[] = [];
    // The chart plots the first output vector; name it by its source (#632).
    const outLabel = results.outputLabels?.[0] ?? "output";

    for (let dim = 0; dim < numDims; dim++) {
      outTraces.push({
        // 1-indexed trial labels — see comment on the upper chart. #336 gap 5.
        x: results.results.map((r) => r.trial + 1),
        y: results.results.map((r) => {
          const row = r.output[0];
          return row ? row[dim] : 0;
        }),
        type: "scatter",
        mode: "lines+markers",
        name: numDims > 1 ? `${outLabel}[${dim}]` : outLabel,
        line: { color: paletteColor("--pnv-text-body"), width: 3 },
        marker: { size: 6 },
      });
    }

    return outTraces;
  }, [results]);

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--pnv-text-body)",
          marginBottom: 6,
          borderBottom: "1px solid var(--pnv-border-faint)",
          paddingBottom: 3,
        }}
      >
        Node Values by Trial
      </div>
      <Plot
        data={traces}
        layout={{
          height: 250,
          margin: { l: 50, r: 20, t: 10, b: 40 },
          xaxis: { title: { text: "Trial" }, dtick: 1 },
          yaxis: { title: { text: "Value" } },
          legend: { orientation: "h", y: -0.3 },
          font: { size: 11 },
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%" }}
      />

      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--pnv-text-body)",
          marginTop: 12,
          marginBottom: 6,
          borderBottom: "1px solid var(--pnv-border-faint)",
          paddingBottom: 3,
        }}
      >
        Composition Output
      </div>
      <Plot
        data={outputTraces}
        layout={{
          height: 200,
          margin: { l: 50, r: 20, t: 10, b: 40 },
          xaxis: { title: { text: "Trial" }, dtick: 1 },
          yaxis: { title: { text: "Output" } },
          legend: { orientation: "h", y: -0.3 },
          font: { size: 11 },
        }}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
