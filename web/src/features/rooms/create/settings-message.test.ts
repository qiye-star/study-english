import { afterEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { describeSettingsChanges } from "./settings-message";

const SCENARIOS = [{ key: "cafe", titleZh: "咖啡店点单", titleEn: "At a café" }];

describe("describeSettingsChanges", () => {
  afterEach(async () => { await i18n.changeLanguage("en"); });

  it("renders each change of one PATCH", async () => {
    await i18n.changeLanguage("zh-CN");
    const meta = { changes: [{ field: "name", value: "美食角" }, { field: "scenario", value: "cafe" }, { field: "max_members", value: 5 },
      { field: "join_mode", value: "approval" }, { field: "ai_public", value: false }, { field: "unknown", value: 1 }] };
    expect(describeSettingsChanges(i18n.t, meta, SCENARIOS, "zh-CN"))
      .toBe("房主把房间名改为「美食角」,把场景改为「咖啡店点单」,把人数上限改为 5,改为需房主同意才能加入,关闭了 AI 公开回答");
    await i18n.changeLanguage("en");
    expect(describeSettingsChanges(i18n.t, { changes: [{ field: "scenario", value: "cafe" }, { field: "allow_voice", value: true }] }, SCENARIOS, "en"))
      .toBe("The owner changed the scenario to “At a café”, allowed voice messages");
  });

  it("returns null when nothing is recognised", () => {
    expect(describeSettingsChanges(i18n.t, null)).toBeNull();
    expect(describeSettingsChanges(i18n.t, { changes: [{ field: "x", value: 1 }] })).toBeNull();
    expect(i18n.t("web.rooms.room.system.settings", { lng: "zh-CN" })).toBe("房主修改了房间设置");
  });
});
