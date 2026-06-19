# chat-ai tests

## Run

```bash
npm run test       # watch mode
npm run test:run   # one-shot, CI/gate 用
npm run test:ui    # vitest --ui, 浏览器查看
npm run coverage   # run + 阈值检查 + HTML 报表
```

## Layout

```
tests/
├── setup.ts                  # 全局 stub(i18n / pinia / element-plus / localStorage + cookies reset)
├── unit/
│   ├── utils/                # pure func 单测
│   └── api/                  # API client 单测(axios mock)
└── component/                # Vue 组件 mount 测试(@vue/test-utils)
```

## Coverage policy

当前 `vitest.config.ts` 的 `coverage.include` 列出 3 个 fully-tested 文件:`src/utils/auth-redirect.ts` / `src/utils/auth.ts` / `src/components/LangSwitch.vue`。Thresholds:lines/functions/statements 80%, branches 75%。

`src/api/chat.ts` 有 spec 文件并 run(覆盖 `getReactionType`),但**不在 coverage.include 内** — 该 file 含 ~35 个 thin axios wrappers,全测会逼着写 30+ 重复 assertion 模板。等反应/收藏类测试家族扩(TW-D10 / TW-D8 落地后),把 chat.ts 升进 include。

**Ramp plan:**
- 加新测试时:如新测试 fully cover 一个新源文件,扩 `coverage.include`(在 PR 描述列出新覆盖文件)
- chat.ts 升 include 触发条件:reaction / collect / chat lifecycle 测试家族 ≥ 5 cases 后
- 5-8 批后试切到 `src/utils/**` 全 glob, thresholds 维持 80%
- 10+ 批后扩到 `src/api/**` + `src/components/**`
- 最终目标:`src/**/*.{ts,vue}` 全 80%

## Adding a test

1. 决定测试类型:pure func / DOM / Vue 组件 / API mock
2. 放 `tests/unit/<分类>/` 或 `tests/component/`
3. 文件名 `<source-basename>.spec.ts`(镜像 src/ 路径)
4. 如新测覆盖了新源文件,扩 `vitest.config.ts` 的 `coverage.include`
5. `npm run coverage` 本地确认通过 + 阈值满足
