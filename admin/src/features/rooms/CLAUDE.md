# admin/src/features/rooms/

## What lives here
房间治理与举报页(桌面端,≥ 1024px):`api.ts`(接口层,snake_case → camelCase)、`rooms-page.tsx`(列表)、
`room-detail-page.tsx`(详情 + 关闭/重新开启/禁 AI(同时禁用智能体与带练)/移出/隐藏;只读「智能体」卡片)、`reports-page.tsx` + `resolve-dialog.tsx`(举报)、
`room-timeline.tsx`(消息时间线)、`strings.ts`(全部文案)、`test-fixtures.ts`(测试数据)、`index.ts`(`app.tsx` 的公共导出)。

## Allowed dependencies
`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`。不依赖其他 feature。

## Test
`cd admin && yarn vitest run src/features/rooms`(mock `./api`,角色用 `session.useAdminSession` 的 spy)。

## Pitfalls
- 每个写操作必填理由并写审计;经 `ConfirmDialog` 提交,服务端校验 CSRF 与 step-up。
- 「重新开启」只对已结束房间显示,仅 operator 及以上可见;服务端会换新房间号、保留成员、遵守房主开放房间数上限。
- 查看私聊时间线需确认并审计;不显示邀请 token,日志与文案不含消息文本。
