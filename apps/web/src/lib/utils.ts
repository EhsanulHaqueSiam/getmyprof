import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// The theme's extra font sizes (index.css). Unregistered, tailwind-merge reads
// text-2xs as a color and drops it next to text-muted-foreground.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["2xs", "3xs"] } } });

/** Joins class names, letting later Tailwind classes win. Used by every components/ui export. */
export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}
