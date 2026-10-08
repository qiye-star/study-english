import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as endpoints from "../api/endpoints";
import { AudioPlayer } from "./audio-player";

vi.mock("../api/endpoints", () => ({ fetchAudio: vi.fn() }));
const fetchAudio = vi.mocked(endpoints.fetchAudio);

beforeEach(() => {
  fetchAudio.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:audio-1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("AudioPlayer", () => {
  it("does not touch the network until play is tapped", () => {
    render(<AudioPlayer assessmentId="a1" />);
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("fetches the blob on first tap, wires an object URL into <audio>, and revokes it on unmount", async () => {
    fetchAudio.mockResolvedValue(new Blob(["RIFF"], { type: "audio/wav" }));
    const { unmount } = render(<AudioPlayer assessmentId="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(fetchAudio).toHaveBeenCalledWith("a1", expect.any(AbortSignal));
    await waitFor(() => expect(document.querySelector("audio")).toHaveAttribute("src", "blob:audio-1"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audio-1");
  });

  it("does not refetch on later taps", async () => {
    fetchAudio.mockResolvedValue(new Blob(["x"]));
    render(<AudioPlayer assessmentId="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "播放" }));
    await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
    act(() => {
      document.querySelector("audio")!.dispatchEvent(new Event("play"));
    });
    await userEvent.click(await screen.findByRole("button", { name: "暂停" }));
    expect(fetchAudio).toHaveBeenCalledTimes(1);
  });

  it("shows the server error and lets the user retry", async () => {
    fetchAudio.mockRejectedValueOnce(new ApiError(404, "录音文件不存在"));
    render(<AudioPlayer assessmentId="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("录音文件不存在");
    fetchAudio.mockResolvedValueOnce(new Blob(["x"]));
    await userEvent.click(screen.getByRole("button", { name: "播放" }));
    await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
  });
});

describe("AudioPlayer controls", () => {
  it("cycles playback speed 1x → 1.25x → 0.75x and applies it to the audio element", async () => {
    fetchAudio.mockResolvedValue(new Blob(["x"]));
    render(<AudioPlayer assessmentId="a1" />);
    const speed = screen.getByRole("button", { name: /播放速度/ });
    expect(speed).toHaveTextContent("1×");
    await userEvent.click(speed);
    expect(speed).toHaveTextContent("1.25×");
    await userEvent.click(screen.getByRole("button", { name: "播放" }));
    await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
    expect(document.querySelector("audio")!.playbackRate).toBe(1.25);
    await userEvent.click(speed);
    expect(speed).toHaveTextContent("0.75×");
    expect(document.querySelector("audio")!.playbackRate).toBe(0.75);
    await userEvent.click(speed);
    expect(speed).toHaveTextContent("1×");
  });

  it("exposes the waveform as a keyboard-operable slider once audio is ready", async () => {
    fetchAudio.mockResolvedValue(new Blob(["x"]));
    render(<AudioPlayer assessmentId="a1" />);
    const slider = screen.getByRole("slider", { name: "播放进度" });
    expect(slider).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: "播放" }));
    await waitFor(() => expect(document.querySelector("audio")).not.toBeNull());
    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 20 });
    act(() => {
      audio.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(slider).toHaveAttribute("aria-valuemax", "20");
    expect(slider).toHaveAttribute("aria-disabled", "false");
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(audio.currentTime).toBe(2);
    await userEvent.keyboard("{End}");
    expect(audio.currentTime).toBe(20);
    await userEvent.keyboard("{Home}");
    expect(audio.currentTime).toBe(0);
  });
});
