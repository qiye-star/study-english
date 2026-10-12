/**
 * `@` 补全(spec addressing §3.2 第 4 条,R-AW13)。服务端只认消息开头的 `@名字` / `@ai` / `@助手`,补全也只在开头;
 * 全角「＠」(中文输入法)同样触发,插入时换成半角。服务端是权威,这里只帮用户拼写。
 */
export interface MentionAgent { id: string; name: string; disabled?: boolean }
export interface MentionOption {
  key: string;
  /** 列表里显示的文字(别名项:「AI(Emma)」) */
  label: string;
  /** 替换开头 @词 的文字,带结尾空格 */
  insert: string;
  /** 别名项为 null(由服务端交给默认智能体) */
  personaId: string | null;
}

const LEADING = /^\s*[@＠]([^\s@＠]*)$/u;
const ALIASES = ["ai", "助手"];

/** 光标前的文字是「开头的 @词(还没打空格)」时返回这个词(可为空串),否则 null。 */
export function mentionQuery(value: string, caret: number): string | null {
  const head = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  const m = LEADING.exec(head);
  return m ? m[1] : null;
}

export function mentionOptions(agents: readonly MentionAgent[], query: string, aliasLabel: string): MentionOption[] {
  const q = query.toLowerCase();
  const out: MentionOption[] = [];
  if (ALIASES.some((a) => a.startsWith(q))) out.push({ key: "alias", label: aliasLabel, insert: "@AI ", personaId: null });
  for (const a of agents) {
    const name = a.name.trim();
    if (!a.disabled && name && name.toLowerCase().startsWith(q)) out.push({ key: a.id, label: name, insert: `@${name} `, personaId: a.id });
  }
  return out;
}

/** 用选中的项替换开头的 @词(到词尾为止),其余文字原样接在后面;返回新值与光标位置。 */
export function applyMention(value: string, caret: number, option: MentionOption): { value: string; caret: number } {
  const wordEnd = caret + (/^[^\s]*/u.exec(value.slice(caret))?.[0].length ?? 0);
  const tail = value.slice(wordEnd).replace(/^\s+/u, "");
  return { value: option.insert + tail, caret: option.insert.length };
}
