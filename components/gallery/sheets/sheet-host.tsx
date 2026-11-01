"use client";

import { AlbumNameSheet, AlbumSheet, PerformanceSheet, PostNowSheet, PostSheet, ScheduleSheet, UploadSheet } from "./photo-sheets";

/** Every Gallery / AI chat sheet lives here; which one is open comes from the store. */
export function SheetHost() {
  return (
    <>
      <ScheduleSheet />
      <PostNowSheet />
      <AlbumSheet />
      <AlbumNameSheet />
      <PostSheet />
      <UploadSheet />
      <PerformanceSheet />
    </>
  );
}
