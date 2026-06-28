// guardEnterSubmit: in the @mention input, MentionSender's handleKeyDown calls
// submit() unconditionally on Enter — even while the mention dropdown is still open
// (the inner el-mention only preventDefault, not stopPropagation, and the dropdown
// closes on a nextTick after handleKeyDown). So in the capture phase: while the
// dropdown is visible, stopPropagation cancels this premature submit; after the
// dropdown closes (popoverVisible=false) Enter submits normally. Returns whether it
// intercepted, for test assertions.
export function guardEnterSubmit(
  e: Pick<KeyboardEvent, "stopPropagation">,
  popoverVisible: boolean | undefined
): boolean {
  if (popoverVisible) {
    e.stopPropagation();
    return true; // blocked the premature submit
  }
  return false; // let Enter through → submit
}
