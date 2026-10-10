import { type ChangeEvent, type CompositionEvent, type Dispatch, type FormEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ClozeAction, type ClozeState, interpretInput, SENTINEL } from "./cloze-engine";

/**
 * 一个视觉隐藏的 <input> 管理全部空(spec §11.5)。值 = 哨兵 + 当前空内容;只在 input 事件里比较差异,
 * 不依赖 keydown 带字符(安卓 Gboard keyCode 恒为 229)。
 *
 * 输入法组合(Gboard 英文联想、iOS / 搜狗拼音):组合期间输入框显示原始值(否则受控值回写会打断组合),
 * 只把字母预览进当前空;空格跳空、退格回跳等结构性动作等 compositionend 后按最终值解释一次。
 * Enter:keydown(组合中 / keyCode 229 不算)、所在 <form> 的隐式提交、beforeinput 的换行三条路,都只调 onSubmit。
 */
export function useClozeInput({ state, dispatch, onSubmit }: { state: ClozeState; dispatch: Dispatch<ClozeAction>; onSubmit: () => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 输入框常在首屏之后才出现(加载中 → 打字),「再练一遍 / 下一组」还会重新挂载:用回调 ref 记下元素,
  // 监听器按元素挂载(review web M1)
  const [inputEl, setInputEl] = useState<HTMLInputElement | null>(null);
  const setInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    setInputEl(node);
  }, []);
  const composing = useRef(false);
  const [raw, setRaw] = useState<string | null>(null);
  const committed = SENTINEL + (state.values[state.active] ?? "");
  const value = raw ?? committed;

  // 原生 beforeinput 监听器读最新值(React 的 onBeforeInput 是 textInput/keypress 合成的,不带 inputType)
  const latest = useRef({ state, onSubmit, dispatch });
  latest.current = { state, onSubmit, dispatch };

  const remaining = state.values.length - 1 - state.active;
  const apply = useCallback((next: string) => {
    for (const action of interpretInput(committed, next, remaining)) dispatch(action);
  }, [dispatch, committed, remaining]);

  const submit = useCallback(() => {
    if (!composing.current) latest.current.onSubmit();
  }, []);

  const caretToEnd = () => {
    const el = inputRef.current;
    if (!el || composing.current) return;
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      /* 某些输入类型不支持选区 */
    }
  };

  // 光标总在末尾:否则落在哨兵前时,空的空上按退格什么也删不掉
  useLayoutEffect(() => {
    if (raw === null && typeof document !== "undefined" && document.activeElement === inputRef.current) caretToEnd();
  }, [value, raw]);

  useEffect(() => {
    const el = inputEl;
    if (!el) return;
    const onBeforeInput = (event: Event) => {
      const e = event as InputEvent;
      if (e.isComposing || composing.current) return;
      if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") {
        e.preventDefault();
        latest.current.onSubmit();
        return;
      }
      // 空的空上退格:能取消就在这里处理(哨兵不被删,键盘状态不被重置);不能取消(多数安卓输入法)就留给 input 事件
      const { state: s, dispatch: d } = latest.current;
      if (e.inputType === "deleteContentBackward" && e.cancelable && !(s.values[s.active] ?? "")) {
        e.preventDefault();
        d({ type: "backspaceEmpty" });
      }
    };
    el.addEventListener("beforeinput", onBeforeInput);
    return () => el.removeEventListener("beforeinput", onBeforeInput);
  }, [inputEl]);

  const focusBlank = useCallback((i: number) => {
    const el = inputRef.current;
    if (composing.current && el) el.blur(); // 先结束组合(compositionend 落在原来的空),再换空
    dispatch({ type: "focus", index: i });
    el?.focus({ preventScroll: true }); // 必须在点击手势里调用,iOS 才弹键盘
    caretToEnd();
  }, [dispatch]);

  return {
    inputRef,
    focusBlank,
    formProps: {
      noValidate: true,
      onSubmit: (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        submit();
      },
    },
    inputProps: {
      ref: setInput,
      type: "text",
      value,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const next = e.target.value;
        if (composing.current || (e.nativeEvent as InputEvent).isComposing) {
          setRaw(next);
          dispatch({ type: "set", value: next.split(SENTINEL).join("") });
          return;
        }
        apply(next);
      },
      onCompositionStart: () => {
        composing.current = true;
      },
      onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => {
        composing.current = false;
        setRaw(null);
        apply(e.currentTarget.value);
      },
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Enter") return;
        if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
        e.preventDefault(); // 也挡掉表单的隐式提交,避免提交两次
        submit();
      },
      onBlur: () => {
        // 失焦时组合被浏览器结束;个别浏览器不发 compositionend,这里兜底
        if (composing.current) {
          composing.current = false;
          setRaw(null);
        }
      },
      autoComplete: "off",
      autoCorrect: "off",
      autoCapitalize: "none",
      spellCheck: false,
      enterKeyHint: "done" as const,
      inputMode: "text" as const,
      "aria-label": t("web.wordbookSpell.input", { n: state.active + 1, total: state.values.length }),
      // 视觉隐藏但可聚焦:不能 display:none / visibility:hidden(移动端不弹键盘);16px 防 iOS 聚焦缩放。
      // 钉在视口顶部而不是底部:iOS 布局视口不随键盘变矮,bottom:0 会落在键盘后面,Safari 为露出光标会把整页上推
      // (review web M3;需真机确认)。pointer-events-none:不挡页头的点击,聚焦只走 focusBlank。
      className: "pointer-events-none fixed left-0 top-0 h-px w-px border-0 bg-transparent p-0 text-[16px] text-transparent caret-transparent opacity-0 outline-none",
    },
  };
}
