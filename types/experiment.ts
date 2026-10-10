import type { PostWindow, ScheduledPost } from "./content";

export interface WindowResult {
  id: PostWindow;
  startHour: number;
  endHour: number;
  postsSampled: number;
  avgReach: number;
  vsBaselinePct: number;
}

export interface ExperimentData {
  daysSampled: number;
  daysPlanned: number;
  dailyTarget: number;
  baselineReach: number;
  windows: WindowResult[];
  opportunity: {
    window: PostWindow;
    liftPct: number;
    sampleSize: number;
    confidencePct: number;
  };
  /** 7 rows (Sun–Sat) × 24 hours — relative engagement 0..1. */
  heatmap: number[][];
  queue: ScheduledPost[];
}
