# 发布前核对

题库为 `data/questions.json`，共 1100 题。参考答案的逐项显示另存于来源复核数据，保留题库原文与答案键。2026-11-23 对全部题干、选项、原解析及显示结果重新核对，原解析图确认了 4 处漏标错误；另补齐 439 项正确标注与 92 项题意排除说明。

复核数据重建后，运行：

```powershell
node scripts/build-reference-reviews.cjs
node scripts/test-source-verdict-consistency.cjs
node scripts/test-reviewed-references.cjs
node scripts/test-option-reviews.cjs
node scripts/test-explanation-format.cjs
node scripts/test-text-format.cjs
node scripts/test-quiz-features.cjs
node scripts/audit-bank.mjs
```

`test-source-verdict-consistency.cjs` 独立扫描原解析的错误判词，防止引号和 OCR 判词边界导致遗漏；同时核对全部计数题、535 条逐项复核决定，以及选项或答案变化后旧判断失效。原题、选项、解析或答案改变后，必须重新核实对应的复核数据。

页面检查包括手机宽度的题目笔记保存与恢复、参考答案中错误词句的突出显示、进度专辑跳转与返回、练习记录的多选/全选/取消。检查时不删除实际练习记录；删除成功和保存失败的情况用隔离的测试数据验证。

浏览器中的个人进度、笔记和草稿只保存在当前浏览器。发布和题库复核不清空这些数据。
