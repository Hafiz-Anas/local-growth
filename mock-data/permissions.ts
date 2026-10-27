import { PLAN_PRESETS } from "@/config/plans";
import type { Permissions } from "@/types";

/**
 * Initial per-client feature permissions. Starts from each client's plan preset,
 * with a few per-client overrides so the admin panel shows real variation.
 */
export const MOCK_PERMISSIONS: Record<string, Permissions> = {
  cl_mathanet: { ...PLAN_PRESETS.pro },
  cl_cafe: {
    ...PLAN_PRESETS.growth,
    "competitors.trendingAudio": true,
    "experiment.heatmap": true,
  },
  cl_boutique: {
    ...PLAN_PRESETS.starter,
  },
};
