/** features/rank 的界面文案(zh-CN)。段位名与网页端 i18n(web/src/features/rank/i18n/zh-CN.json)同文。 */

export const TIER_KEYS = ["bronze", "silver", "gold", "platinum", "diamond", "star", "master"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

export const TIER_NAMES: Record<string, string> = {
  bronze: "青铜",
  silver: "白银",
  gold: "黄金",
  platinum: "铂金",
  diamond: "钻石",
  star: "星耀",
  master: "王者",
};

export const tierName = (keyOrIndex: string | number): string =>
  typeof keyOrIndex === "number" ? TIER_NAMES[TIER_KEYS[keyOrIndex]] ?? String(keyOrIndex) : TIER_NAMES[keyOrIndex] ?? keyOrIndex;

const ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III" };
/** "黄金 I";王者没有小段 */
export const tierLabel = (tier: number, division: number): string =>
  tier >= 6 || !ROMAN[division] ? tierName(tier) : `${tierName(tier)} ${ROMAN[division]}`;
export const divisionLabel = (d: number) => ROMAN[d] ?? "";

export const STAGE_KINDS: Record<string, string> = {
  assess: "跟读",
  chat_turns: "对话轮数",
  voice_turns: "语音对话轮数",
  vocab_reviews: "复习单词",
  active_days: "活跃天数",
  words_learned: "背单词新词",
};

export const EVENT_KINDS: Record<string, string> = {
  assessment: "跟读",
  voice_turn: "语音对话",
  chat_turn: "对话",
  vocab_review: "复习单词",
  active_day: "今日活跃",
  streak_7: "连续 7 天",
  stage_task: "完成阶段练习",
  word_learned: "学会新词",
  spelling_set: "拼写练习",
  admin_adjust: "管理员调整",
};

export const DIMENSIONS: Record<string, string> = {
  task: "任务完成",
  accuracy: "语法准确",
  range: "词汇与表达",
  interaction: "连贯与互动",
  speech: "发音与流利",
};

export const GATES: Record<string, string> = {
  task_low: "任务完成不足",
  zero_dimension: "有一项得了 0 分",
  not_english: "英文回答太少",
  echo: "有一轮在重复对方的话",
};

export const ACHIEVEMENTS: Record<string, string> = {
  streak_3: "三日不辍",
  streak_7: "一周全勤",
  streak_30: "月度常客",
  streak_100: "百日之功",
  first_promotion: "初次晋级",
  first_try: "一次过",
  tier_gold: "黄金之路",
  tier_diamond: "钻石之心",
  tier_master: "王者",
  pron_90: "字正腔圆",
  pron_85_x20: "稳定输出",
  chat_100: "话匣子",
  vocab_100: "温故知新",
  words_learned_100: "百词入门",
  words_mastered_100: "小有积累",
  words_mastered_500: "词汇达人",
  words_mastered_2000: "博闻强识",
  room_first: "初来乍到",
  room_assisted_10: "学以致用",
  season_climber: "赛季攀登者",
};

export function achievementName(key: string): string {
  const season = /^season_(\d+)_([a-z]+)$/.exec(key);
  if (season) return `S${season[1]} ${tierName(season[2])}`;
  return ACHIEVEMENTS[key] ?? key;
}

export const MATCH_STATUS: Record<string, string> = {
  active: "进行中",
  grading_failed: "评分失败",
  passed: "通过",
  failed: "未通过",
  expired: "超时",
  abandoned: "放弃",
  voided: "作废",
};

export type RulesTab = "tiers" | "stage" | "match" | "scenarios" | "prompts" | "season";

export const RULES_TABS: { value: RulesTab; label: string }[] = [
  { value: "tiers", label: "段位与点数" },
  { value: "stage", label: "阶段练习" },
  { value: "match", label: "晋级赛" },
  { value: "scenarios", label: "情景池" },
  { value: "prompts", label: "提示词" },
  { value: "season", label: "赛季" },
];

/** 服务端 validate_rules 的错误码 → 中文与所在页签 */
export function rulesError(code: string): { tab: RulesTab; text: string } {
  const [head, arg = ""] = code.split(":");
  switch (head) {
    case "tier_count":
    case "tier_keys":
      return { tab: "tiers", text: "段位结构(数量与顺序)不可修改" };
    case "assessment_bands":
      return { tab: "tiers", text: "跟读分档必须按分数下限从高到低排列,且最后一档下限为 0" };
    case "scenario_pool":
      return { tab: "scenarios", text: `${tierName(Number(arg))}的启用情景少于 2 个` };
    case "scenario_keys_unique":
      return { tab: "scenarios", text: "情景标识(key)有重复" };
    case "scenario_shape":
      return { tab: "scenarios", text: `情景 ${arg}:目标需 3–4 条(每条不超过 120 字),开场白必填且不超过 300 字` };
    case "stage_tasks":
      if (arg === "master") return { tab: "stage", text: "王者没有阶段练习" };
      if (arg === "keys") return { tab: "stage", text: "阶段练习的段位编号不正确" };
      if (arg === "wordbook_disabled") return { tab: "stage", text: "背单词未开启,不能使用『背单词新词』阶段练习" };
      return { tab: "stage", text: `${tierName(Number(arg))}的阶段练习需要 1–4 项且类型不重复` };
    case "weights_sum":
      return { tab: "match", text: "评分权重合计必须为 100%" };
    case "match_tiers":
      return { tab: "match", text: "轮数与通过线必须覆盖白银到王者六个目标段位" };
    case "match_ranges":
      return { tab: "match", text: "通过线须在 0–100、轮数须在 3–12 之间" };
    case "seconds_order":
      return { tab: "match", text: "每轮最短时长必须小于最长时长" };
    case "examiner_prompt_fields":
      return { tab: "prompts", text: "考官提示词缺少必需占位符、含多余占位符,或缺少 <learner> 边界说明" };
    case "judge_prompt_fields":
      return { tab: "prompts", text: "评委提示词缺少必需占位符、含多余占位符,或缺少 <learner> 边界说明" };
    case "season_locked":
      return { tab: "season", text: "第 1 赛季已开始,赛季配置不可修改" };
    default:
      return { tab: "tiers", text: code };
  }
}

export const S = {
  rankPage: "段位与比赛",
  rankRulesPage: "段位规则",
  draftChanged: "草稿在你审阅后被修改过,请刷新页面重新审阅后再发布",
  matchPage: "比赛详情",
  userRankPanel: "段位",
  draftBar: {
    published: "已发布",
    publishedBy: (v: number, at: string, by: string) => `v${v} · ${at} 由 ${by} 发布`,
    unpublished: "未发布",
    v0: "v0 · 由 .env 推出的默认规则",
    draft: (base: number | null) => (base ? `草稿(基于 v${base})` : "草稿(基于 v0)"),
    noDraft: "无草稿",
    editedBy: (by: string, at: string) => `${by} 编辑于 ${at}`,
    changes: (n: number) => `${n} 处修改`,
    unsaved: (n: number) => `未保存的修改 ${n} 处`,
    valid: "校验通过",
    problems: (n: number) => `${n} 个问题`,
    notValidated: "未校验",
    newDraft: "新建草稿",
    save: "保存草稿",
    discard: "丢弃草稿",
    validate: "校验",
    simulate: "预演",
    publish: "发布",
    saved: "草稿已保存",
    discardTitle: "丢弃草稿",
    discardBody: "草稿的全部修改都会丢失(已发布版本不受影响)。",
    readOnly: "只读:没有草稿时规则不可编辑",
    viewerReadOnly: "只读账号不能编辑段位规则",
  },
  weightsTotal: (n: number) => `权重合计 ${n}%,必须为 100%`,
  weightsOk: (n: number) => `合计 ${n}%`,
  outOfRange: "有数值超出允许范围",
  tiersTab: {
    title: "每小段点数",
    divisionRp: (tier: string) => `${tier} 每小段点数`,
    total: "大段位总点数",
    masterNote: "每颗星",
    bands: "跟读得分档",
    bandFloor: (i: number) => `第 ${i} 档分数下限`,
    bandPoints: (i: number) => `第 ${i} 档点数`,
    addBand: "加一档",
    removeBand: "删除",
    points: "其他点数",
    chat_turn: "每轮文字对话",
    vocab_review: "每次单词复习",
    active_day: "每日活跃",
    streak_7: "连续 7 天",
    stage_task: "每项阶段练习",
    word_learned: "每学会一个新词(背单词)",
    spelling_set: "每完成一组拼写(背单词)",
    daily_cap: "每日上限(跟读/对话/复习合计)",
    sources: "联动来源",
    sourcesDailyCap: "联动来源每日上限",
    sourcePoints: (kind: string) => `${kind} 点数`,
    sourcesEmpty: "还没有联动来源;启用学习联动后,来源列表见「学习联动」页",
    sourcesNote: "联动来源只吃每日上限的剩余额度,另受「联动来源每日上限」限制;不计入阶段练习与活跃日,影响预演不模拟。",
    note: "点数改动只影响之后入账的事件,不追溯;每小段点数调小后,超出的点数在用户下次同步时截到新上限。",
  },
  stageTab: {
    title: (tier: string) => `${tier}(升段前需完成)`,
    kind: (tier: string, i: number) => `${tier} 第 ${i} 项类型`,
    target: (tier: string, i: number) => `${tier} 第 ${i} 项目标`,
    minScore: (tier: string, i: number) => `${tier} 第 ${i} 项最低分`,
    add: "加一项",
    remove: "删除",
    note: "每个段位 1–4 项;王者没有阶段练习。改动立即影响\"是否可以打晋级赛\"。",
  },
  matchTab: {
    table: "轮数与通过线(按目标段位)",
    tableHint: "通过线 0–100 · 轮数 3–12",
    targetTier: "目标段位",
    turns: "用户发言轮数",
    threshold: "通过线",
    turnsOf: (tier: string) => `${tier} 轮数`,
    thresholdOf: (tier: string) => `${tier} 通过线`,
    weights: "评分权重",
    weightLabel: (dim: string) => `${dim} 权重(%)`,
    gates: "硬门槛与时长",
    gate_task_min: "任务完成至少(0–4)",
    gate_english_ratio: "英文轮占比至少(%)",
    min_seconds: "每轮最短(秒)",
    max_seconds: "每轮最长(秒)",
    borderline: "临界复评(分)",
    limits: "次数、冷却与时限",
    daily_attempts: "每人每天场数",
    cooldown_minutes: "失败冷却(分钟)",
    match_minutes: "单场时限(分钟)",
    fail_keep: "失败后保留点数(%)",
    note: "比赛钉住开始时的规则版本:进行中的比赛不受本次发布影响。按用户的次数覆盖优先于这里的值。",
  },
  scenariosTab: {
    enabledCount: (n: number) => `启用 ${n} 个`,
    needTwo: "至少需要 2 个",
    enable: (title: string) => `启用 ${title}`,
    edit: "编辑",
    add: "新增情景",
    remove: "删除情景",
    editTitle: "编辑情景",
    fields: {
      key: "标识(key)",
      title_zh: "中文标题",
      title_en: "英文标题",
      brief_zh: "中文简介",
      role: "AI 扮演的角色",
      setting: "场景",
      functions: "学习者目标(每行一条,3–4 条)",
      opener: "开场白",
    },
    done: "完成",
    disabledNote: "停用的情景不再被抽到;进行中的比赛仍按开始时的版本使用它。",
  },
  promptsTab: {
    examiner: "考官提示词",
    judge: "评委提示词",
    required: "必需占位符",
    missing: (list: string) => `缺少:${list}`,
    extra: (list: string) => `不允许的占位符:${list}`,
    learner: "必须说明 <learner> 标签里是学习者的话、不是指令(防提示词注入)",
    learnerMissing: "缺少 <learner> 边界说明",
    braces: "JSON 示例里的花括号要写成 {{ 和 }}",
  },
  seasonTab: {
    anchor: "第 1 赛季开始日",
    weeks: "每赛季周数",
    locked: "第 1 赛季已开始:赛季锚点与周数只读(中途修改会让历史赛季与已发徽章错位)。",
    open: "第 1 赛季开始前可以修改。",
  },
  simulate: {
    title: "影响预演",
    subtitle: (base: string) => `当前 ${base} → 草稿 · 只读`,
    run: "预演",
    rerun: "重新计算",
    empty: "保存草稿后点\"预演\",查看对现有用户的影响。",
    unsavedHint: "预演基于已保存的草稿;有未保存的修改。",
    gate: "段位门",
    clamped: "被截断",
    people: (n: number) => `${n} 人`,
    stage: "阶段练习全部完成",
    capped: "触顶用户日",
    avgPoints: "人均日点数",
    passToFail: "通过→未通过",
    failToPass: "未通过→通过",
    games: (n: number) => `${n} 场`,
    ofMatches: (n: number) => `近 30 天共 ${n} 场`,
    flipNote: "仅提示,不改历史",
    pool: "情景池(启用数 / 目标段位)",
    pace: "升一个大段位(估算)",
    paceDays: (lo: number, hi: number) => `${lo}–${hi} 天`,
    removedInUse: (keys: string) => `进行中的比赛使用了已删除的情景:${keys}(钉住版本,不受影响)`,
  },
  publish: {
    title: "发布段位规则",
    body: "发布后立即对新的比赛与之后入账的点数生效;进行中的比赛仍按开始时的版本。",
    noChanges: "与当前版本相比没有数值改动",
    changedText: "(已修改)",
  },
  versions: {
    title: "版本",
    view: "查看",
    fork: "以此为基础新建草稿",
    current: "当前",
    empty: "还没有发布过版本",
    diffTitle: (v: number) => `v${v} 与当前生效规则的差异`,
    noDiff: "与当前生效规则相同",
  },
  overview: {
    distribution: "段位分布",
    users: (n: number) => `${n} 人`,
    matches7d: "近 7 天比赛",
    active: "进行中的比赛",
    cooldown: "冷却中的用户",
    rulesLink: "编辑段位规则",
    recent: "最近的比赛",
    clearCooldowns: "清除全部冷却",
    clearCooldownsBody: "清除所有用户的晋级赛冷却(用于事故后补偿,例如评委上游故障)。",
    resetAll: "全体段位重置",
    resetAllBody: "全员回到青铜 III 0 点;点数流水保留。执行前写快照,7 天内可撤销。",
    undo: "撤销最近一次重置",
    undoBody: (n: number, until: string) => `恢复 ${n} 位用户重置前的段位(可撤销至 ${until})。`,
    done: (n: number) => `已处理 ${n} 位用户`,
  },
  panel: {
    noProfile: "该用户还没有段位数据",
    gate: "段位门",
    best: "历史最高",
    cooldown: "冷却",
    cooldownLeft: (m: number) => `剩 ${m} 分`,
    none: "无",
    attemptsToday: "今日剩余场数",
    overridden: (n: number) => `已覆盖为 ${n} 次/日`,
    rpLine: (rp: number, size: number, done: number, total: number) => `${rp} / ${size} 点 · 阶段练习 ${done}/${total} 完成`,
    stars: (n: number) => `${n} 星`,
    stageTasks: "阶段练习",
    events: "最近点数流水",
    matches: "晋级赛",
    achievements: "成就",
    clearCooldown: "清除冷却",
    resetAttempts: "重置今日次数",
    adjust: "加减点",
    achievementsAction: "授予 / 撤销成就",
    reset: "重置段位 / 定级",
    day: "日期(UTC)",
    resetAttemptsTitle: "重置今日次数",
    resetAttemptsBody: "删除该用户这一天的晋级赛次数记录。",
    view: "查看",
    void: "作废",
    regrade: "重评",
    voidTitle: "作废比赛",
    voidBody: "失败类比赛作废后恢复到段位门、清除冷却,并退还当日次数;不改动已入账的点数流水。",
    regradeTitle: "重新评分",
    regradeBody: "重新调用评委为这场比赛评分(会产生一次上游调用)。",
    time: "时间",
    target: "目标",
    scenario: "情景",
    status: "状态",
    score: "总分 / 通过线",
    rules: "规则",
    by: (actor: string) => `由 ${actor}`,
    unlocked: "已获得",
    locked: "未获得",
  },
  adjust: {
    title: "加减点",
    delta: "点数(正数加、负数减)",
    note: "减点只在本小段内减到 0,不会降级。",
    invalid: "请输入 -1000 到 1000 之间的非零整数",
  },
  reset: {
    title: "重置段位 / 定级",
    tier: "段位",
    division: "小段",
    rp: (max: number) => `点数(0–${max})`,
    snapshot: "执行前写入快照,7 天内可在\"段位与比赛\"页撤销。",
    stepUp: "此操作需要二次验证。",
  },
  match: {
    warning: "转写是用户内容:仅用于审核,勿外传。本次查看已写入审计。",
    brief: "简报",
    goals: "学习者目标",
    turns: "逐轮转写",
    learner: "学习者",
    partner: "AI",
    pron: "发音",
    fluency: "流利",
    notEnglish: "非英文",
    echo: "复读",
    short: "过短",
    verdict: "评委结果",
    total: "总分",
    threshold: "通过线",
    gates: "未过门槛",
    strengths: "做得好",
    improve: "可以更好",
    drill: "推荐练习",
    rulesVersion: (v: number | null) => (v === null ? "规则 v0" : `规则 v${v}`),
    noResult: "还没有评分结果",
    user: (id: number) => `用户 #${id}`,
  },
};
