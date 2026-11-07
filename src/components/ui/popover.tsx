import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}
function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}
function PopoverContent({ className, align = 'center', sideOffset = 10, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 w-72 rounded-xl border border-white/10 bg-neutral-950/80 p-4 text-white shadow-2xl outline-hidden backdrop-blur-xl', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
export { Popover, PopoverTrigger, PopoverContent }
