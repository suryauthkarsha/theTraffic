import { MapPin } from "lucide-react";
import { type InputHTMLAttributes, useId } from "react";

import { cn } from "@/lib/utils";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  compact?: boolean;
}

/** Text input with a leading pin icon and inline label, matching the design contract inputs. */
export function LocationField({ label, compact = false, className, ...rest }: FieldProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("input-field cursor-text", compact && "h-10 text-[14px]", className)}>
      <MapPin size={compact ? 15 : 18} className="shrink-0 text-gw-muted" aria-hidden />
      {!compact && <span className="w-12 shrink-0 text-[14px] text-gw-secondary">{label}</span>}
      <input
        id={id}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent font-medium text-gw-text outline-none placeholder:font-normal placeholder:text-gw-muted"
        autoComplete="off"
        spellCheck={false}
        {...rest}
      />
    </label>
  );
}
