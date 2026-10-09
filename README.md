<div align="center">
  <img src="./enjoy/assets/icon.png" alt="Clash" width="128" />
</div>

<h3 align="center">
AI 是当今世界上最好的外语老师，Enjoy 做 AI 最好的助教。
</h3>

[![Deploy 1000h website](https://github.com/ZuodaoTech/everyone-can-use-english/actions/workflows/deploy-1000h.yml/badge.svg)](https://github.com/ZuodaoTech/everyone-can-use-english/actions/workflows/deploy-1000h.yml)
[![Test Enjoy App](https://github.com/ZuodaoTech/everyone-can-use-english/actions/workflows/test-enjoy-app.yml/badge.svg)](https://github.com/ZuodaoTech/everyone-can-use-english/actions/workflows/test-enjoy-app.yml)
[![Release Enjoy App](https://github.com/ZuodaoTech/everyone-can-use-english/actions/workflows/release-enjoy-app.yml/badge.svg)](https://github.com/ZuodaoTech/everyone-can-use-english/actions/workflows/release-enjoy-app.yml)
![Latest Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fenjoy.bot%2Fapi%2Fconfig%2Fapp_version&query=%24.version&label=Latest&link=https%3A%2F%2F1000h.org%2Fenjoy-app%2Finstall.html)
![Recording Duration](https://img.shields.io/endpoint?url=https%3A%2F%2Fenjoy.bot%2Fapi%2Fbadges%2Frecordings)

---

## 网页版

Enjoy 全新版本已经上线，可访问 [https://enjoy.bot](https://enjoy.bot) 直接使用。

![](./enjoy/snapshots/screenshot-video.png)
![](./enjoy/snapshots/screenshot-ebook.png)
![](./enjoy/snapshots/screenshot-flashcard.png)
![](./enjoy/snapshots/screenshot-course.png)

## 浏览器插件

Enjoy 浏览器插件已经上线，支持 YouTube 和 Netflix。可访问 [Chrome Web Store](https://chromewebstore.google.com/detail/enjoy-echo/hiijpdndbjfnffibdhajdanjekbnalob) 安装使用。

![](./enjoy/snapshots/screenshot-youtube.png)
![](./enjoy/snapshots/screenshot-netflix.png)

---

## 桌面版

新版桌面版将会是对网页版的套壳和增强，即将发布。

## 自建后端(本分支)

本分支新增 `server/`,用于脱离 enjoy.bot 自行部署:账号密码登录、AI 服务由自己的上游提供。
详见 [server/README.md](./server/README.md) 与 [设计文档](./docs/superpowers/specs/2026-10-02-self-hosted-backend-design.md)。

### 手机网页版

`web/` 是手机优先的 PWA,由同一个后端镜像同源托管,只覆盖练习子集:登录、跟读发音评测(含录音回放)、AI 对话(含朗读与听写)、查词与翻译。不含视频/音频库、字幕编辑等桌面端功能。

    cp server/.env.example server/.env   # 填写上游配置;公网部署用 invite 或 closed 注册
    docker compose up -d --build         # 同时构建并托管网页版,默认只监听 127.0.0.1:8000

手机端录音与「添加到主屏幕」必须通过 HTTPS 访问(反向代理或隧道指向 127.0.0.1:8000),部署、数据与上限见 [server/README.md](./server/README.md)「手机网页版」,开发与测试见 [web/README.md](./web/README.md)。

段位赛与联机练习默认关闭,开启时在 `server/.env` 中设置(改后 `docker compose up -d` 重启):

    RANK_ENABLED=true                # 段位、阶段练习、成就与晋级赛(练习页与「我的」出现段位卡)
    ROOMS_ENABLED=true               # 联机房间(底部导航从 3 个标签变为 4 个);反向代理需放行 WS /api/rooms/ws
    ROOM_MESSAGE_RETENTION_DAYS=0    # 0 = 房间消息永久保留(默认);正数 = 房间关闭满 N 天后删除

两个开关关闭时应用与原来完全一样。其余上限与成本见 [server/README.md](./server/README.md)「段位赛与联机练习」。


## 相关阅读

### 一千小时（2024）

- [简要说明](https://1000h.org/intro.html)
- [训练任务](https://1000h.org/training-tasks/kick-off.html)
- [语音塑造](https://1000h.org/sounds-of-american-english/0-intro.html)
- [大脑内部](https://1000h.org/in-the-brain/01-inifinite.html)
- [自我训练](https://1000h.org/self-training/00-intro.html)

### 人人都能用英语（2010）

- [简介](./book/README.md)
- [第一章：起点](./book/chapter1.md)
- [第二章：口语](./book/chapter2.md)
- [第三章：语音](./book/chapter3.md)
- [第四章：朗读](./book/chapter4.md)
- [第五章：词典](./book/chapter5.md)
- [第六章：语法](./book/chapter6.md)
- [第七章：精读](./book/chapter7.md)
- [第八章：叮嘱](./book/chapter8.md)
- [后记](./book/end.md)

## 常见问题

请查询 [文档 FAQ](https://1000h.org/enjoy-app/faq.html)。
