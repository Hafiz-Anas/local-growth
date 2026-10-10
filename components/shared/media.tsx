import {
  CakeSlice,
  Coffee,
  CupSoda,
  Gem,
  Gift,
  Nut,
  Shirt,
  ShoppingBag,
  Sparkles,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RemoteImage } from "./remote-image";
import type { MediaIcon, MediaTone } from "@/types";

/**
 * Stand-in artwork for post photos (no real media in the front-end phase).
 * Tones are content colours for mock imagery, not UI tokens.
 */
const TONES: Record<MediaTone, string> = {
  roast: "linear-gradient(135deg, #c08552 0%, #6b3e26 100%)",
  pistachio: "linear-gradient(135deg, #b5d99c 0%, #4d7c0f 100%)",
  date: "linear-gradient(135deg, #e0b07a 0%, #7b3f00 100%)",
  rose: "linear-gradient(135deg, #f8c8d4 0%, #c2185b 100%)",
  latte: "linear-gradient(135deg, #ede0d4 0%, #9c6644 100%)",
  sand: "linear-gradient(135deg, #f1e4d3 0%, #b08968 100%)",
  night: "linear-gradient(135deg, #4b5563 0%, #111827 100%)",
  berry: "linear-gradient(135deg, #e84393 0%, #6c3483 100%)",
};

const ICONS: Record<MediaIcon, LucideIcon> = {
  coffee: Coffee,
  nut: Nut,
  cake: CakeSlice,
  gift: Gift,
  truck: Truck,
  cup: CupSoda,
  shirt: Shirt,
  bag: ShoppingBag,
  gem: Gem,
  sparkles: Sparkles,
};

export function toneBackground(tone: MediaTone) {
  return TONES[tone];
}

export function MediaPlaceholder({
  tone,
  icon,
  className,
  iconClassName,
  children,
  src,
  alt,
}: {
  tone: MediaTone;
  icon: MediaIcon;
  className?: string;
  iconClassName?: string;
  children?: React.ReactNode;
  /** A real image (e.g. from Instagram) shown over the artwork; the artwork stays as the fallback while it loads. */
  src?: string | null;
  alt?: string;
}) {
  const Icon = ICONS[icon];
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden", className)} style={{ background: TONES[tone] }}>
      <Icon className={cn("size-1/4 text-white/85", iconClassName)} strokeWidth={1.25} aria-hidden="true" />
      {src && <RemoteImage src={src} alt={alt} className="absolute inset-0 size-full object-cover" />}
      {children}
    </div>
  );
}
