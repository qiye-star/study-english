// 联动插件 词汇激活(计划 L4 Task 15):我的 → 沉睡词一行、/me/activation 页面。删一行 = 删这个功能的入口。
// 开关由服务端 ACTIVATION_ENABLED 决定;关闭时 config 返回 enabled=false,入口与页面都不出现。
import "~/features/activation/register";
