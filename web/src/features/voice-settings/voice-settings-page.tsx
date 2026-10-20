import { PlayIcon, SquareIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { voicesFor, type ServerAiConfig } from "~/api/server-config";
import { PAGE_NOTE } from "~/components/list-card";
import { SurfaceCard } from "~/components/surface-card";
import { cn } from "~/lib/cn";
import { PageHeader } from "~/layout/page-header";
import {
  TTS_SCENES, resolveTtsVoice, storedTtsVoice, useTtsVoicePref,
  type TtsScene, type TtsVoiceChoice, type TtsVoicePref,
} from "~/settings/tts-voice-pref";

/** 试听用的播放器(由 pages/ 用 features/chat 的 useTtsPlayer 提供;这里只认结构,不直接引入 chat) */
export interface VoicePreviewPlayer {
  states: Record<string, "idle" | "loading" | "playing" | "error">;
  play(key: string, text: string, model: string, voice: string): unknown;
  stop(): void;
}

/**
 * 我的 → 朗读音色(/me/voice):单词 / 句子 / 对话消息三行,各选一个模型和音色;选「默认」跟随服务端。
 * ai:undefined = 配置加载中,null = 取不到配置。
 */
export function VoiceSettingsPage({ ai, player, sample }: {
  ai: ServerAiConfig | null | undefined;
  player: VoicePreviewPlayer;
  sample: string;
}) {
  const { t } = useTranslation();
  const { pref, setTtsVoice } = useTtsVoicePref();
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.voiceSettings.title")} back="/me" />
      <div className="px-frame pb-8">
        <p className="mt-2 text-meta text-ink-2">{t("web.voiceSettings.intro")}</p>
        {ai === undefined ? <p className={PAGE_NOTE}>{t("web.voiceSettings.loading")}</p>
          : ai === null ? <p className={PAGE_NOTE}>{t("web.voiceSettings.unavailable")}</p>
            : TTS_SCENES.map((scene) => (
              <SurfaceCard key={scene} className="mt-4 p-4">
                <SceneRow scene={scene} ai={ai} pref={pref} setVoice={setTtsVoice} player={player} sample={sample} />
              </SurfaceCard>
            ))}
      </div>
    </div>
  );
}

const selectClass = "h-11 w-full rounded-tile border-[0.5px] border-hair bg-surface px-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const labelClass = "mb-1.5 block text-sub font-semibold text-ink";

function SceneRow({ scene, ai, pref, setVoice, player, sample }: {
  scene: TtsScene;
  ai: ServerAiConfig;
  pref: TtsVoicePref;
  setVoice(scene: TtsScene, choice: TtsVoiceChoice | null): void;
  player: VoicePreviewPlayer;
  sample: string;
}) {
  const { t } = useTranslation();
  const stored = storedTtsVoice(scene, ai, pref);
  const effective = resolveTtsVoice(scene, ai, pref);
  const stale = !!pref[scene] && !stored;
  // 只列出确实有音色的模型;存的模型即使不在列表里也保留,否则下拉框显示不出当前值
  const models = (ai.ttsModels ?? []).filter((m) => voicesFor(ai, m).length > 0);
  const modelOptions = stored && !models.includes(stored.model) ? [stored.model, ...models] : models;
  const voices = stored ? voicesFor(ai, stored.model) : [];
  const key = `voice-settings:${scene}`;
  const state = player.states[key] ?? "idle";
  const playing = state === "playing" || state === "loading";

  return (
    <div data-testid={`voice-scene-${scene}`} className="space-y-3">
      <div>
        <h2 className="text-body font-semibold text-ink">{t(`web.voiceSettings.scene.${scene}.title`)}</h2>
        <p className="mt-0.5 text-meta text-ink-2">{t(`web.voiceSettings.scene.${scene}.hint`)}</p>
      </div>
      <label className="block">
        <span className={labelClass}>{t("web.voiceSettings.model")}</span>
        <select data-testid={`voice-scene-${scene}-model`} className={selectClass} value={stored?.model ?? ""}
          onChange={(e) => {
            const model = e.target.value;
            setVoice(scene, model ? { model, voice: voicesFor(ai, model)[0]?.value ?? "" } : null);
          }}>
          <option value="">{t("web.voiceSettings.followDefault")}</option>
          {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>{t("web.voiceSettings.voice")}</span>
        <select data-testid={`voice-scene-${scene}-voice`} className={selectClass} value={stored?.voice ?? ""} disabled={!stored}
          onChange={(e) => setVoice(scene, e.target.value && stored ? { model: stored.model, voice: e.target.value } : null)}>
          <option value="">{t("web.voiceSettings.followDefault")}</option>
          {voices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </label>
      {stale ? <p data-testid={`voice-scene-${scene}-stale`} className="text-meta text-amber">{t("web.voiceSettings.stale")}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <span data-testid={`voice-scene-${scene}-effective`} className="min-w-0 truncate text-meta text-ink-2">{effective.voice}</span>
        <button type="button" data-testid={`voice-scene-${scene}-preview`} data-state={state}
          disabled={!effective.model || !effective.voice}
          className={cn("inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sub font-semibold text-blue transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
            playing ? "bg-blue-tint liquid:bg-wash" : "hover:bg-surface-2")}
          onClick={() => {
            if (playing) player.stop();
            else void player.play(key, sample, effective.model, effective.voice); // 同步段内 prime(iOS),不要在这之前 await
          }}>
          {playing ? <SquareIcon aria-hidden className="size-4 fill-current" /> : <PlayIcon aria-hidden className="size-4 fill-current" />}
          {t(playing ? "web.voiceSettings.stopPreview" : "web.voiceSettings.preview")}
        </button>
      </div>
    </div>
  );
}
