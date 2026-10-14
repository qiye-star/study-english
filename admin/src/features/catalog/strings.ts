/** features/catalog 的界面文案(zh-CN);`components/layout.tsx` 的导航项用 `S.title`。 */
export const S = {
  title: "精选库",
  intro: "内置素材:导入一次,所有学习者都能加入自己的跟读库。学习者只在跟读评测时扣额度。",
  backup: "数据库备份不包含音频与封面文件。服务器数据卷丢失或只恢复了数据库时,精选条目会显示「媒体缺失」,需要重新导入。",
  state: {
    enabled: (on: boolean) => (on ? "学习端「精选」已开启" : "学习端「精选」未开启(去「设置 → 跟读库」打开)"),
    unavailable: "跟读库不可用(总开关关闭或服务器缺少 ffmpeg),现在不能导入",
    asr: (on: boolean) => (on ? "没有字幕时会自动识别(系统付费)" : "自动识别不可用:没有字幕的素材会导入失败"),
    ai: (on: boolean) => (on ? "导入时自动生成逐句译文(系统付费)" : "译文不可用:导入后没有译文"),
    link: (on: boolean, proxy: boolean) => (on ? `链接导入可用 · 代理${proxy ? "已配置" : "未配置"}` : "链接导入不可用(没有 yt-dlp)"),
    shared: (today: string, cap: string) => `共享句子分析:今日 ${today} / ${cap} 句`,
  },
  actions: { importLink: "按链接导入", upload: "上传文件", refresh: "刷新" },
  cols: { title: "标题", level: "级别", tags: "标签", status: "状态", duration: "时长", sentences: "句数", translated: "已译", refs: "副本", published: "发布" },
  status: { uploading: "上传中", queued: "排队中", processing: "处理中", ready: "就绪", failed: "失败", canceled: "已取消" },
  stage: { fetch: "下载", probe: "检查", transcode: "转码", subtitles: "字幕", transcribe: "识别", segment: "分句", translate: "翻译" } as Record<string, string>,
  badges: { retired: "已退役", mediaMissing: "媒体缺失", partial: "部分未译", lowConfidence: "句界可能不准" },
  empty: "还没有精选条目",
  form: {
    url: "视频页面链接", urlHint: "可直接粘贴分享文本;服务器在大陆时需要配置代理才能访问 YouTube。",
    file: "音频或视频文件", subs: "字幕(可选,SRT / VTT)", title: "标题", titleHint: "留空则用页面标题或文件名",
    level: "级别", noLevel: "不设", tags: "话题标签(逗号分隔,最多 5 个)", license: "来源与许可说明",
    licenseHint: "例如:VOA Learning English · Public domain;TED · 讲者 · CC BY-NC-ND 4.0", aiLang: "译文语言",
    submit: "开始导入", uploading: (p: string) => `上传中 ${p}`, cancel: "取消", tooLarge: (mb: number) => `文件超过 ${mb} MB 上限`,
  },
  detail: {
    listen: "试听", sentences: "句子", edit: "编辑", save: "保存", meta: "元数据", translate: "补全译文",
    retry: "重试", cancelJob: "取消处理", publish: "发布", unpublish: "下架", del: "删除", purge: "强制删除",
    editLocked: "已发布的条目不能改句子:先下架,改好再发布。已加入的学习者副本不会随之更新。",
    text: "原文", zh: "译文", startMs: "开始(毫秒)", endMs: "结束(毫秒)", close: "关闭",
  },
  confirm: {
    deleteTitle: "删除精选条目",
    deleteBody: (refs: number) =>
      refs === 0 ? "将删除音频、封面与全部句子,无法恢复。" : `有 ${refs} 个学习者已加入:将下架并退役,等最后一个副本被删除后自动清理文件。`,
    purgeTitle: "强制删除(含学习者副本)",
    purgeBody: (refs: number) => `会同时删除这 ${refs} 个学习者的副本(学习记录中的评测保留)。需要超级管理员与二次验证。`,
  },
  errors: {
    "Invalid link": "链接无效", "Link import is unavailable": "链接导入不可用(服务器没有 yt-dlp)",
    "Media tools are not installed": "服务器缺少 ffmpeg", "Unsupported file type": "不支持的文件类型",
    "File is too large": "文件太大", "Item is not ready": "条目还没处理完", "Item is published": "已发布的条目不能这样修改",
    "Media is missing": "媒体文件缺失,请重新导入", "Item is retired": "条目已退役", "Item is not running": "条目没有在处理",
    "Item has not failed": "条目没有失败", "AI is unavailable": "译文服务不可用", "Invalid sentence times": "句子时间不合法",
    "Invalid sentence text": "句子文字不合法", "Invalid level": "级别不合法", "Invalid tags": "标签不合法(最多 5 个,每个 ≤ 16 字,不能含逗号)",
    "Invalid license_note": "许可说明太长", "Unsupported language": "不支持的译文语言", "Catalog item not found": "条目不存在",
    // 以下是服务端实际会返回、计划未列出的(裁定 R-AU7)
    "Sentence not found": "句子不存在", "No changes": "没有改动", "Confirmation required": "需要输入确认短语",
    "Upload is not in progress": "上传已结束或被取消", "Upload expired": "上传已过期,请重新上传",
    "Unexpected chunk": "分片顺序不对,请重新上传", "Wrong chunk size": "分片大小不对,请重新上传",
    "Upload is incomplete": "文件还没传完", "Subtitles cannot be changed now": "现在不能补传字幕",
    "Invalid subtitle file": "字幕文件无法解析", "File is required": "没有选择文件", "Invalid title": "标题不合法",
  } as Record<string, string>,
  errorKinds: { no_subtitles: "没有字幕且自动识别不可用:补传字幕后会自动重试", upstream: "上游服务失败", blocked: "站点拒绝了服务器(试试配置代理,或本机下载后上传)", drm: "受 DRM 保护,无法导入" } as Record<string, string>,
};

export const errorText = (message: string) => S.errors[message] ?? message;
