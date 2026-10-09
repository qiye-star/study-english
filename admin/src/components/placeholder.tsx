import { S } from "../strings";
import { Page } from "./layout";

/** 功能车道尚未实现的页面占位(各车道替换)。 */
export function Placeholder({ title }: { title: string }) {
  return (
    <Page title={title}>
      <div className="panel px-6 py-12 text-center text-sm text-fg-2">{S.shell.placeholder}</div>
    </Page>
  );
}
