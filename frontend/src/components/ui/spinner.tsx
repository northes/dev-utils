import { CircleNotch } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <CircleNotch
      role="status"
      aria-label="Loading"
      size={size}
      weight="bold"
      className={cn("animate-spin transform-view origin-center", className)}
    />
  )
}

export { Spinner }
