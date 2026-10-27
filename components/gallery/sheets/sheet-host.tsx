"use client";

import { AiChatSheet } from "@/components/ai-chat/ai-chat-sheet";
import { AlbumNameSheet, AlbumSheet, PerformanceSheet, PostSheet, ScheduleSheet, UploadSheet } from "./photo-sheets";

/** Every Gallery / AI chat sheet lives here; which one is open comes from the store. */
export function SheetHost({ aiChat }: { aiChat: boolean }) {
  return (
    <>
      {aiChat && <AiChatSheet />}
      <ScheduleSheet />
      <AlbumSheet />
      <AlbumNameSheet />
      <PostSheet />
      <UploadSheet />
      <PerformanceSheet />
    </>
  );
}
