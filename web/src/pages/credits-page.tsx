import { ExternalLinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionGroup } from "~/components/section-group";
import { SurfaceCard } from "~/components/surface-card";
import { PageHeader } from "~/layout/page-header";

/**
 * KyleBing/english-vocabulary 的许可证原文(逐字复制 server/dictionaries/kylebing-english-vocabulary/LICENSE,
 * credits-page.test.tsx 校验两者一致)。不翻译。
 */
export const KYLEBING_LICENSE = `BSD 3-Clause License

Copyright (c) 2022-2026, KyleBing

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const REPO = "KyleBing/english-vocabulary";
const COMMIT = "c4c6c808";

/** 致谢与许可(spec §11.1,视觉稿 12):第三方数据的来源、版本与许可全文。不受背单词开关影响。 */
export function CreditsPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t("web.credits.title")} back="/me" />
      <div className="px-gutter pb-6">
        <SectionGroup title={t("web.credits.dataGroup")} bare>
          <SurfaceCard as="section" aria-labelledby="credits-vocab" className="p-3.5">
            <h2 id="credits-vocab" className="text-body font-semibold">{t("web.credits.vocabTitle")}</h2>
            <p className="mt-1 text-sub leading-dialogue text-ink-2">{t("web.credits.vocabUse")}</p>
            <a href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer"
              className="tap-link mt-1 font-medium text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {REPO}
              <ExternalLinkIcon aria-hidden className="h-3.5 w-3.5" />
            </a>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sub">
              <dt className="text-ink-2">{t("web.credits.version")}</dt>
              <dd className="num">{t("web.credits.versionValue", { commit: COMMIT, date: "2026-09-30" })}</dd>
              <dt className="text-ink-2">{t("web.credits.license")}</dt>
              <dd>BSD 3-Clause</dd>
            </dl>
            <p className="mt-2 text-sub leading-dialogue text-ink-2">{t("web.credits.disclaimer")}</p>
            <pre data-testid="license-text" lang="en"
              className="mt-3 whitespace-pre-wrap break-words rounded-badge bg-surface-2 p-3 font-mono text-[11px] leading-[1.5] text-ink-2">
              {KYLEBING_LICENSE}
            </pre>
          </SurfaceCard>
        </SectionGroup>
      </div>
    </div>
  );
}
