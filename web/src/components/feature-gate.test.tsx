import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "~/i18n";
import { FeatureGate } from "./feature-gate";

describe("FeatureGate", () => {
  it("renders children only when ready", () => {
    const { rerender } = render(<FeatureGate state="loading" disabledText="off"><p>body</p></FeatureGate>);
    expect(screen.queryByText("body")).toBeNull();
    expect(screen.getByTestId("feature-gate-loading")).toBeTruthy();
    rerender(<FeatureGate state="disabled" disabledText="段位赛未开启"><p>body</p></FeatureGate>);
    expect(screen.getByText("段位赛未开启")).toBeTruthy();
    rerender(<FeatureGate state="ready" disabledText="off"><p>body</p></FeatureGate>);
    expect(screen.getByText("body")).toBeTruthy();
  });

  it("offers a retry on error", () => {
    const retry = vi.fn();
    render(<FeatureGate state="error" disabledText="off" onRetry={retry}><p>body</p></FeatureGate>);
    fireEvent.click(screen.getByTestId("feature-gate-retry"));
    expect(retry).toHaveBeenCalledOnce();
  });
});
