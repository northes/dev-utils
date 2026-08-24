import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

const AlertDialog = (props:AlertDialogPrimitive.Root.Props)=><AlertDialogPrimitive.Root data-slot="alert-dialog" {...props}/>
const AlertDialogTrigger = (props:AlertDialogPrimitive.Trigger.Props)=><AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props}/>
const AlertDialogPortal = (props:AlertDialogPrimitive.Portal.Props)=><AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props}/>
function AlertDialogOverlay({className,...props}:AlertDialogPrimitive.Backdrop.Props){return <AlertDialogPrimitive.Backdrop data-slot="alert-dialog-overlay" className={cn("fixed inset-0 isolate z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",className)} {...props}/>}
function AlertDialogContent({className,...props}:AlertDialogPrimitive.Popup.Props){return <AlertDialogPortal><AlertDialogOverlay/><AlertDialogPrimitive.Popup data-slot="alert-dialog-content" className={cn("fixed top-1/2 left-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0",className)} {...props}/></AlertDialogPortal>}
function AlertDialogHeader({className,...props}:React.ComponentProps<"div">){return <div className={cn("flex flex-col gap-1.5 text-center sm:text-left",className)} {...props}/>}
function AlertDialogFooter({className,...props}:React.ComponentProps<"div">){return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",className)} {...props}/>}
function AlertDialogTitle({className,...props}:AlertDialogPrimitive.Title.Props){return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn("text-base font-medium",className)} {...props}/>}
function AlertDialogDescription({className,...props}:AlertDialogPrimitive.Description.Props){return <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={cn("text-sm text-muted-foreground",className)} {...props}/>}
function AlertDialogAction({className,...props}:React.ComponentProps<typeof Button>){return <Button data-slot="alert-dialog-action" className={cn(className)} {...props}/>}
function AlertDialogCancel({className,...props}:AlertDialogPrimitive.Close.Props & Pick<React.ComponentProps<typeof Button>,"variant"|"size">){const {variant="outline",size="default",...closeProps}=props;return <AlertDialogPrimitive.Close data-slot="alert-dialog-cancel" className={cn(buttonVariants({variant,size,className}))} render={<Button variant={variant} size={size}/>} {...closeProps}/>}

export {AlertDialog,AlertDialogPortal,AlertDialogOverlay,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogFooter,AlertDialogTitle,AlertDialogDescription,AlertDialogAction,AlertDialogCancel}
