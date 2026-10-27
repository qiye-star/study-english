// Command-line flow for scripts/enjoy-export.mjs (plan R-E2, R-E9). Exit codes:
// 0 ok (or cancelled pick), 1 error, 2 usage / refused, 3 nothing exportable, 130 interrupted.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { findLibrary, resolveDb } from './locate.mjs';
import { loadCandidates } from './enjoy-db.mjs';
import {
  exportPackage, skippedCounts, parseSelection, formatListing, fmtMB,
  REASON_TEXT, LARGE_MEDIA_BYTES,
} from './export.mjs';
import { ExportError } from './errors.mjs';

const USAGE = `用法: node scripts/enjoy-export.mjs [选项]
  --library <目录>   Enjoy 库目录(缺省时自动查找)
  --user <名字>      库目录下的用户文件夹名(有多个时必填)
  --db <文件>        直接指定 enjoy_database.sqlite(媒体取它旁边的 videos/)
  --out <文件>       输出 zip(缺省 enjoy-export-YYYYMMDD-HHmm.zip,在当前目录)
  --pick             先列清单,再输入序号选择(all / 1,3,5-8,空行取消)
  --list             只列清单,不导出
  --force            允许覆盖已存在的输出文件
  --dev              读取开发版数据库 enjoy_database_dev.sqlite
只读数据库副本,不联网,不读登录信息。导出的包里是你的视频和字幕,请勿上传到公共位置。`;

function defaultOutName(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `enjoy-export-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

function ask(stdin, stdout, question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    let interrupted = false;
    rl.on('SIGINT', () => {
      interrupted = true;
      rl.close();
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(interrupted ? undefined : answer);
    });
  });
}

export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin }) {
  const out = (s) => io.stdout.write(`${s}\n`);
  const err = (s) => io.stderr.write(`${s}\n`);

  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        library: { type: 'string' },
        user: { type: 'string' },
        db: { type: 'string' },
        out: { type: 'string' },
        pick: { type: 'boolean' },
        list: { type: 'boolean' },
        force: { type: 'boolean' },
        dev: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (e) {
    err(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    out(USAGE);
    return 0;
  }
  if (values.pick && values.list) {
    err('--pick 与 --list 不能同时使用');
    return 2;
  }

  const now = process.env.ENJOY_EXPORT_NOW ? new Date(process.env.ENJOY_EXPORT_NOW) : new Date();

  let library = values.library;
  if (!values.db && !library) {
    const found = findLibrary({ home: os.homedir() });
    if (!found.dir) {
      err(`找不到 Enjoy 库目录。已尝试:\n${found.tried.map((t) => `  ${t}`).join('\n')}\n请用 --library 指定。`);
      return 2;
    }
    library = found.dir;
    out(`库目录: ${library}`);
  }

  let resolved;
  try {
    resolved = resolveDb({ library, user: values.user, db: values.db, dev: values.dev });
  } catch (e) {
    if (e instanceof ExportError) {
      err(e.message);
      return 2;
    }
    throw e;
  }

  const outPath = path.resolve(values.out ?? defaultOutName(now));
  if (!values.list && existsSync(outPath) && !values.force) {
    err(`输出文件已存在: ${outPath}(加 --force 覆盖)`);
    return 2;
  }

  let candidates;
  try {
    candidates = loadCandidates({ dbPath: resolved.dbPath, mediaDir: resolved.mediaDir });
  } catch (e) {
    err(`读取数据库失败(请确认 Enjoy 桌面端的数据库完整)。${e instanceof ExportError ? e.message : ''}`.trim());
    return 1;
  }

  if (values.list) {
    out(formatListing(candidates));
    return 0;
  }

  let scope = candidates;
  if (values.pick) {
    if (!io.stdin.isTTY) {
      err('--pick 需要在交互式终端里运行');
      return 2;
    }
    out(formatListing(candidates));
    const answer = await ask(io.stdin, io.stdout, '选择(all / 1,3,5-8,空行取消): ');
    if (answer === undefined) {
      err('已中断,未生成文件');
      return 130;
    }
    let picks;
    try {
      picks = parseSelection(answer, candidates.length);
    } catch (e) {
      err(e.message);
      return 2;
    }
    if (picks === null) {
      out('已取消,未生成文件');
      return 0;
    }
    scope = picks.map((i) => candidates[i - 1]);
  }

  const items = scope.filter((c) => c.status === 'ok');
  if (items.length === 0) {
    err('没有可导出的视频,未生成文件');
    return 3;
  }
  const large = items.filter((c) => c.media.bytes > LARGE_MEDIA_BYTES).length;
  if (large > 0) {
    out(`注意:${large} 条超过 500 MB,可能超过云端单文件上限(管理端导入时会按实际设置判断)。`);
  }

  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    const r = await exportPackage({ items, skipped: skippedCounts(scope), outPath, now, signal: ac.signal });
    out(`已导出 ${r.count} 条,${fmtMB(r.bytes)},输出: ${outPath}`);
    const skipped = scope.filter((c) => c.status !== 'ok');
    if (skipped.length > 0) {
      out('跳过的条目(标题只在本机显示):');
      for (const c of skipped) out(`  - ${REASON_TEXT[c.reason] ?? c.reason}: ${c.title}`);
    }
    out('包里是你的视频和字幕,请勿上传到公共位置。');
    return 0;
  } catch (e) {
    if (ac.signal.aborted || e?.code === 'aborted') {
      err('已中断,未生成文件');
      return 130;
    }
    if (e instanceof ExportError) {
      err(`导出失败: ${e.message}`);
      return e.code === 'disk_full' || e.code === 'too_many_items' ? 2 : 1;
    }
    err('导出失败(未知错误)');
    return 1;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
