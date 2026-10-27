import { CalendarClock, Heart, Images, PencilLine, Send, Sparkles, Upload, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/gallery/i18n";
import type { Photo } from "@/mock-data/gallery/types";

export interface SmartAlbum {
  id: string;
  key: MessageKey;
  icon: LucideIcon;
  filter: (p: Photo) => boolean;
}

export const SMART_ALBUMS: SmartAlbum[] = [
  { id: "all", key: "allPhotos", icon: Images, filter: () => true },
  { id: "uploads", key: "uploads", icon: Upload, filter: (p) => p.source === "upload" },
  { id: "instagram", key: "instagram", icon: Send, filter: (p) => p.status === "published" },
  { id: "drafts", key: "drafts", icon: PencilLine, filter: (p) => p.status === "draft" },
  { id: "scheduled", key: "scheduled", icon: CalendarClock, filter: (p) => p.status === "scheduled" },
  // AI-made images, and posts the AI wrote that were saved to the gallery.
  { id: "ai", key: "aiGenerated", icon: Sparkles, filter: (p) => p.source === "ai" || !!p.aiPost },
  { id: "favorites", key: "favorites", icon: Heart, filter: (p) => p.favorite },
];
