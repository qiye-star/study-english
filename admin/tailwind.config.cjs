const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // 只做桌面网页端(裁定 R-7):< desk 时整页提示"请使用桌面浏览器"
      screens: { desk: "1024px" },
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        sunken: token("sunken"),
        raised: token("raised"),
        line: token("line"),
        "line-strong": token("line-strong"),
        fg: token("fg"),
        "fg-2": token("fg-2"),
        muted: token("muted"),
        accent: token("accent"),
        "accent-strong": token("accent-strong"),
        "accent-soft": token("accent-soft"),
        "accent-fg": token("accent-fg"),
        good: token("good"),
        warn: token("warn"),
        bad: token("bad"),
        "good-soft": token("good-soft"),
        "warn-soft": token("warn-soft"),
        "bad-soft": token("bad-soft"),
        wave: token("wave"),
      },
      fontFamily: {
        // 系统无衬线;CJK 回退 PingFang / HarmonyOS / 微软雅黑。不加载网络字体。
        sans: ["-apple-system", "BlinkMacSystemFont", "system-ui", '"Segoe UI"', "Roboto", '"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei"', "sans-serif"],
        // 等宽字体承担所有数字:时间码、分数、计数、ID
        mono: ["ui-monospace", '"SF Mono"', '"Cascadia Mono"', "Menlo", "Consolas", '"Roboto Mono"', "monospace"],
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "14px" }],
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "18px" }],
        base: ["15px", { lineHeight: "22px" }],
        md: ["17px", { lineHeight: "24px" }],
        lg: ["20px", { lineHeight: "26px" }],
        xl: ["24px", { lineHeight: "30px" }],
        "2xl": ["32px", { lineHeight: "36px", letterSpacing: "-0.01em" }],
        "3xl": ["40px", { lineHeight: "44px", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        lg: "10px",
        xl: "14px",
        "2xl": "18px",
      },
      boxShadow: {
        card: "0 1px 2px rgb(var(--shadow) / 0.06), 0 6px 20px -8px rgb(var(--shadow) / 0.12)",
        float: "0 -1px 0 rgb(var(--line)), 0 -8px 24px -12px rgb(var(--shadow) / 0.18)",
      },
      maxWidth: {
        col: "600px",
        content: "1200px",
      },
      width: {
        sidebar: "232px",
      },
    },
  },
};
