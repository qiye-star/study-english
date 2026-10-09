import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 测试专用:服务端钉住的段位契约样例(snake_case 原样),只由 *.test.tsx 引入。 */
const here = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CONTRACT: Record<string, any> = JSON.parse(
  readFileSync(path.resolve(here, "../../../../server/tests/fixtures/rank_contract.json"), "utf8"),
);
