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

## 挖坑手册

交卷后的成绩栏显示“查看挖坑手册”按钮。单套试卷汇总题库中这套试卷的全部错误陈述和错误选项；即使一条旧记录只保存了一题，仍汇总整套。随机、错题、收藏及跨套练习按本次实际题目顺序汇总。

手册按题目与选项顺序连续编号，复用已核对的红绿批注，保留没有直接替换词的错误项及原有说明。仅“不符合题意”而非内容错误的项目不收录。每项可以展开原题；当前作答记录中存在该题时，可以返回对应作答解析。

交互回归共 45 场景，包含全部 55 套、1447 条已复核错误表述的完整性、单题历史补全整套、未交卷入口保护、回题与返回状态保留、计时冻结、输入转义及空手册。成绩栏不显示提交日期；历史列表的日期保留。
