import type { PostWindow } from "@/types";

export const POST_WINDOWS: PostWindow[] = ["morning", "afternoon", "evening"];

/** Default start hour (Kuwait time) used when queueing a post into a window. */
export const WINDOW_START_HOUR: Record<PostWindow, number> = {
  morning: 9,
  afternoon: 14,
  evening: 20,
};

/** Length of a posting experiment, in days. */
export const EXPERIMENT_DAYS = 21;
