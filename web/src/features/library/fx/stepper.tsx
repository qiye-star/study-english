import { CheckIcon } from "lucide-react";
import { Fragment } from "react";

export interface StepperStep { key: string; label: string }

/** 当前阶段在步骤里的位置;未知或没有(排队中)为 -1。 */
export function stepIndex(steps: readonly StepperStep[], current: string | null): number {
  return current === null ? -1 : steps.findIndex((s) => s.key === current);
}

/**
 * 处理阶段(Stepper):圆点 + 连线,已完成实心蓝 + 勾,当前阶段脉冲圈(只动 transform / opacity),其余灰。
 * 纯装饰(aria-hidden):语义由卡片上的 role="progressbar" 承担。
 */
export function Stepper({ steps, current, className }: { steps: readonly StepperStep[]; current: string | null; className?: string }) {
  const at = stepIndex(steps, current);
  return (
    <div aria-hidden className={className}>
      <div className="lib-steps">
        {steps.map((step, i) => {
          const state = at < 0 ? "todo" : i < at ? "done" : i === at ? "now" : "todo";
          return (
            <Fragment key={step.key}>
              {i > 0 ? <span className="lib-step-line" data-state={at >= 0 && i <= at ? "done" : "todo"} /> : null}
              <span className="lib-step" data-state={state}>
                {state === "done" ? <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} /> : null}
              </span>
            </Fragment>
          );
        })}
      </div>
      <div className="lib-step-labels">
        {steps.map((step) => <span key={step.key}>{step.label}</span>)}
      </div>
    </div>
  );
}
