import { CircleNotch } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-grid animate-spin origin-center place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <CircleNotch size={size} weight="bold" className="h-full w-full" aria-hidden="true" />
    </span>
  )
}

export { Spinner }
