# Enjoy 手机网页版

手机优先的 PWA,练习子集(登录、跟读评测、AI 对话、查词翻译)。与自建后端同源部署,见 `server/README.md`。

## 开发

    cd server && uv run uvicorn app.main:create_app --factory --port 8000   # 另一个终端
    yarn web:dev                                                           # http://localhost:5173,/api 代理到 8000

## 别名约定

- `~/…` → `web/src/…`(web 自己的代码)
- `@/…`、`@renderer/…` → `enjoy/src/…`(只读复用桌面端源码;不复制、不修改)
- `@renderer/components`、`@renderer/components/ui` 两个 barrel 被替换为 `src/shims/` 下的精简版;web 代码一律从子路径引入。
- `enjoy/src` 引入的第三方包必须写进 `web/package.json`,否则构建报 `guard-enjoy-deps` 错误。

## 检查

    yarn web:typecheck && yarn web:test && yarn web:build
