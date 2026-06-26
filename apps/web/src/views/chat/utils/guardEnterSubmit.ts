// guardEnterSubmit: 在 @mention 输入框里,MentionSender 的 handleKeyDown 会在
// Enter 上无条件 submit()——即使 mention 下拉还开着(内层 el-mention 只 preventDefault
// 不 stopPropagation,且下拉关闭跑在 handleKeyDown 之后的 nextTick)。于是在捕获阶段:
// 下拉可见时 stopPropagation 拦掉这次过早的 submit;下拉关闭后(popoverVisible=false)
// Enter 正常提交。返回是否拦截,便于测试断言。
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
