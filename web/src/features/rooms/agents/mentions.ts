/** 与服务端 app/rooms/agent_mentions.agent_mention 相同(共用 server/tests/fixtures/room_agent_mentions.json);服务端是权威,这里只用于高亮与「正在回答」。 */
const SEP = String.raw`(?=$|[\s:：,，.!?！？])`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentionsAgent(text: string, names: string[]): { index: number | null; question: string } {
  const stripped = text.trim();
  if (!stripped.startsWith("@")) return { index: null, question: "" };
  const body = stripped.slice(1);
  const order = names.map((n, i) => [n.trim(), i] as const).filter(([n]) => n).sort((a, b) => b[0].length - a[0].length);
  for (const [name, i] of order) {
    const m = new RegExp(`^${escape(name)}${SEP}`, "iu").exec(body);
    if (m) {
      const question = body.slice(m[0].length).replace(/^[\s:：,，]*/u, "").trim();
      return question ? { index: i, question } : { index: null, question: "" };
    }
  }
  return { index: null, question: "" };
}
