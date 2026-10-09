import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TemplatesEditor } from "./templates-editor";

const ROWS = [{ key: "job-interview", name: "求职面试", description: "练习回答面试问题", prompt: "You are an interviewer." }];

function Harness({ onBody }: { onBody?: (b: string) => void }) {
  const [body, setBody] = useState(JSON.stringify(ROWS));
  return (
    <TemplatesEditor
      body={body}
      onChange={(b) => {
        setBody(b);
        onBody?.(b);
      }}
    />
  );
}

function readBlob(b: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(b);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("adds a row and flags a duplicate key", async () => {
  const onBody = vi.fn();
  render(<Harness onBody={onBody} />);
  await userEvent.click(screen.getByRole("button", { name: "新增一行" }));
  await userEvent.type(screen.getByLabelText("key(第 2 行)"), "job-interview");
  expect(screen.getByText("key 重复")).toBeInTheDocument();
  const last = JSON.parse(onBody.mock.calls.at(-1)![0]);
  expect(last).toHaveLength(2);
  expect(last[1].key).toBe("job-interview");
});

it("removes a row", async () => {
  const onBody = vi.fn();
  render(<Harness onBody={onBody} />);
  await userEvent.click(screen.getByRole("button", { name: "删除(第 1 行)" }));
  expect(JSON.parse(onBody.mock.calls.at(-1)![0])).toEqual([]);
});

it("exports JSON identical to the table", async () => {
  let blob: Blob | null = null;
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    blob = b as Blob;
    return "blob:x";
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "导出 JSON" }));
  expect(blob).not.toBeNull();
  expect(JSON.parse(await readBlob(blob!))).toEqual(ROWS);
});

it("imports a JSON file into the table", async () => {
  const onBody = vi.fn();
  render(<Harness onBody={onBody} />);
  const next = [{ key: "a", name: "A", description: "", prompt: "p" }];
  const file = new File([JSON.stringify(next)], "t.json", { type: "application/json" });
  await userEvent.upload(screen.getByLabelText("导入 JSON"), file);
  await screen.findByDisplayValue("A");
  expect(JSON.parse(onBody.mock.calls.at(-1)![0])).toEqual(next);
});

it("is read-only when asked", () => {
  render(<TemplatesEditor body={JSON.stringify(ROWS)} onChange={() => undefined} readOnly />);
  expect(screen.queryByRole("button", { name: "新增一行" })).toBeNull();
  expect(screen.getByDisplayValue("求职面试")).toHaveAttribute("readonly");
});
