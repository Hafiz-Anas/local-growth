"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Chips with remove buttons plus an inline "Add" field. */
export function TagInput({
  values,
  onChange,
  placeholder,
  addLabel,
  normalize = (v) => v,
  className,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  addLabel: string;
  normalize?: (value: string) => string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = normalize(draft.trim());
    if (!value || values.includes(value)) return setDraft("");
    onChange([...values, value]);
    setDraft("");
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex h-8 items-center gap-1 rounded-pill border border-border bg-background ps-3 pe-1.5 text-body"
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              className="rounded-pill p-0.5 text-muted hover:bg-hover hover:text-foreground"
              aria-label={`Remove ${value}`}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <form
        className={cn("mt-3 flex gap-2", values.length === 0 && "mt-0")}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="max-w-64" />
        <Button type="submit" variant="secondary" disabled={!draft.trim()}>
          <Plus className="size-4" />
          {addLabel}
        </Button>
      </form>
    </div>
  );
}
