import { useTranslation } from "react-i18next";
import { enPosLabel, visibleDefs, type DictEntry } from "./dictionary";

/** 抽屉里词典命中的显示:词 / 音标 / 原形 / 中文释义 / 英文释义(遵守 def_lang)/ 最多 3 条短语。 */
export function DictionaryResult({ entry }: { entry: DictEntry }) {
  const { t } = useTranslation();
  const { zh, en } = visibleDefs(entry);
  return (
    <div data-testid="lookup-dict" className="space-y-2">
      <p className="text-lg font-semibold">
        {entry.word}
        {entry.phonetic && <span className="ml-2 font-code font-normal text-muted-foreground">/{entry.phonetic}/</span>}
      </p>
      {entry.lemma && entry.lemma.toLowerCase() !== entry.word.toLowerCase() && (
        <p className="text-sm text-muted-foreground">{t("web.lookup.lemma")}: {entry.lemma}</p>
      )}
      {zh.length > 0 && (
        <ul data-testid="lookup-dict-zh" className="space-y-0.5">
          {zh.map((d, i) => (
            <li key={`${d.pos}|${d.text}|${i}`}>{d.pos && <span className="mr-1.5 text-sm text-muted-foreground">{d.pos}</span>}{d.text}</li>
          ))}
        </ul>
      )}
      {en.length > 0 && (
        <ul data-testid="lookup-dict-en" className="space-y-0.5 text-sm text-ink-2">
          {en.map((d, i) => (
            <li key={`${d.pos}|${d.text}|${i}`}><span className="mr-1.5 text-muted-foreground">{enPosLabel(d.pos)}</span>{d.text}</li>
          ))}
        </ul>
      )}
      {entry.phrases.length > 0 && (
        <div data-testid="lookup-dict-phrases">
          <p className="text-sm text-muted-foreground">{t("web.lookup.phrases")}</p>
          <ul className="space-y-0.5 text-sm">
            {entry.phrases.map((p) => <li key={p.en}><span className="font-medium">{p.en}</span>{p.zh && <span className="ml-2 text-muted-foreground">{p.zh}</span>}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
