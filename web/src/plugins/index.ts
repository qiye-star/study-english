// 组合层(spec 2026-10-11-learning-links §8.3)。顺序无关;每行一个插件;删一行 = 删一个联动。
import "./core"; // 核心贡献:加入生词本(任何开关下都在)
import "./links"; // 联动配置加载、我的 → 学习联动、/me/links
import "./word-actions"; // 1 单词操作位置
import "./daily-tasks"; // 2 今日任务聚合卡
import "./mistakes"; // 3 易错词
import "./pron-shadow"; // 4 发音弱词 ↔ 跟读
import "./chat-words"; // 5 对话用到今日词(6 段位点来源只在服务端)
