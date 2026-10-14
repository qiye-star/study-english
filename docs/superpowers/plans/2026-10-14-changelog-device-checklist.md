# 更新日志 · 真机与真实浏览器验证清单(未验证 UNVERIFIED)

- 日期:2026-10-14 · 计划:`2026-10-14-changelog.md` · 状态:**全部未验证(UNVERIFIED)**。写计划与实现时,以下每一项都没有在真机或真实浏览器上跑过;单元测试在 jsdom 里通过不代表这些成立。
- 做完一项在方括号里写日期与结论(通过 / 失败 + 现象),失败的另记到「发现的问题」。

## A. iPhone Safari(浏览器标签页)与主屏幕 PWA

| # | 做什么 | 预期 | 结果 |
|---|---|---|---|
| A1 | 有已发布条目、有未读时打开练习页(360 / 390 / 430 px 宽) | 顶栏:标题 + 副标题 + 星花图标 + 「练习清单」图标,44 px 命中区,标题截断不挤压图标 | [ ] UNVERIFIED |
| A2 | 看红点与提示环 | 红点在星花右上角,带 2 px 背景色描边;提示环缓慢扩散,不卡顿、不抖动版面 | [ ] UNVERIFIED |
| A3 | 系统「减少动态效果」打开 | 提示环静止,红点仍在 | [ ] UNVERIFIED |
| A4 | 第一次出现未读 | 图标下方弹「有 N 条新更新」气泡,箭头对准星花,不被顶栏或内容遮挡;点别处消失;再次进入练习页不再出现 | [ ] UNVERIFIED |
| A5 | 退出登录再登录后再有未读 | 小提示可以再次出现(本机偏好随退出清除) | [ ] UNVERIFIED |
| A6 | 深色模式下看红点、提示环、气泡、各类型标签、「新」角标 | 对比度足够,跟读库标签是紫色 | [ ] UNVERIFIED |
| A7 | 点入口进日志页 | 整页打开;左上返回回练习页;1 秒后返回,红点消失 | [ ] UNVERIFIED |
| A8 | 在另一台设备读完日志,回到这台刷新练习页 | 红点消失(服务端已读位置同步;入口 60 秒内不重复请求,等一分钟或重开应用) | [ ] UNVERIFIED |
| A9 | 日志页滚动 | 惯性滚动顺滑;玻璃顶栏滚动后变玻璃;月份标题、首条展开、「展开全部 N 条」折叠 / 展开正常 | [ ] UNVERIFIED |
| A10 | 滚到底(条目多于 20 条时,先在管理端造够) | 自动加载下一页;**记录 `IntersectionObserver` 在应用壳的滚动容器里是否真的触发**;不触发时「加载更多」按钮能用 | [ ] UNVERIFIED |
| A11 | 类型筛选芯片 | 横向滚动不带动页面横向滚动;切换后卡片与条目正确过滤 | [ ] UNVERIFIED |
| A12 | 飞行模式下打开日志页(之前成功加载过) | 显示上次缓存的第一页 + 「离线」提示 + 重试;没有「新」角标;联网后点重试恢复 | [ ] UNVERIFIED |
| A13 | 直接打开 `/practice/changelog`(未登录 → 登录 → 回到) | 登录后回到日志页(或练习页),无白屏 | [ ] UNVERIFIED |
| A14 | 中文 / 英文 / 西班牙文界面 | 中文显示中文;英文显示英文,英文留空的条目显示中文;西班牙文按英文回退 | [ ] UNVERIFIED |
| A15 | 底栏与键盘 | 日志页没有输入框;底栏「练习」保持高亮 | [ ] UNVERIFIED |

## B. 管理端(桌面浏览器,≥ 1024 px)

| # | 做什么 | 预期 | 结果 |
|---|---|---|---|
| B1 | 1024 / 1280 / 1440 px 宽打开「配置 → 更新日志」(`/admin/changelog`) | 左列表 340 px + 右编辑器不溢出,无横向滚动 | [ ] UNVERIFIED |
| B2 | Safari 与 Chrome 里的日期控件 | `input type=date` 能选日期、值是 `YYYY-MM-DD` | [ ] UNVERIFIED |
| B3 | 新建 → 保存 → 发布(真实服务) | 手机端练习页出现红点;日志页有这条,「新」角标 | [ ] UNVERIFIED |
| B4 | 下架 → 删除 | 手机端刷新后消失;管理端列表不再显示已删除的 | [ ] UNVERIFIED |
| B5 | 查看者账号登录 | 能看列表与预览,不能新建 / 保存 / 发布 / 下架 / 删除 | [ ] UNVERIFIED |
| B6 | 预览 | 与手机端显示一致(英文为空回退中文;版本号补 v) | [ ] UNVERIFIED |
| B7 | 打开「审计日志」页 | `changelog.create|update|publish|unpublish|delete` 各一行,只有条目 id 与动作,没有标题或正文 | [ ] UNVERIFIED |
| B8 | 编辑器里的 Tailwind 色(类型标签、草稿 / 已发布徽标,如 `bg-violet-100`)与深色主题 | 颜色与对比度正常 | [ ] UNVERIFIED |

## C. 导入首批草稿(部署后,只在用户要求时做)

| # | 做什么 | 预期 | 结果 |
|---|---|---|---|
| C1 | 镜像带上草稿:重建容器后 `docker compose exec server ls /app/changelog` | 看到 `2026-10.json`(**重建容器只在用户要求时做**;`COPY docs/changelog /app/changelog` 目前只被测试做了字符串检查,没有真的构建过镜像) | [ ] UNVERIFIED |
| C2 | `docker compose exec server python -m app.admin.changelog_import --dry-run` | `would create 8, skipped 0` | [ ] UNVERIFIED |
| C3 | 去掉 `--dry-run` 再执行,然后再执行一次 | 第一次 `created 8, skipped 0`,第二次 `created 0, skipped 8`;管理端出现 8 条草稿,日期升序 | [ ] UNVERIFIED |
| C4 | 逐条核对草稿事实 | 与实际部署一致;`AGENTS_ENABLED` / `LIBRARY_ENABLED` / `WORDBOOK_ENABLED` 关闭的功能,对应条目在发布前删除或改写 | [ ] UNVERIFIED |
| C5 | 按日期从早到晚逐条发布 | 用户的未读数 = 最近 3 条;红点与「新」角标正确 | [ ] UNVERIFIED |
| C6 | 真实 Postgres 上跑迁移 `0020` 与「只前进」的已读写入 | 迁移成功;`POST /api/changelog/seen` 重复调用幂等 | [ ] UNVERIFIED |

## D. 体积

| # | 做什么 | 预期 | 结果 |
|---|---|---|---|
| D1 | `yarn web:build`,然后 `cd web && yarn bundle:check --max-delta=0.5` | 主包增量 ≤ 0.5 kB gzip;把实测数字写在这里(不预估) | [ ] UNVERIFIED |

## 发现的问题
(无)
