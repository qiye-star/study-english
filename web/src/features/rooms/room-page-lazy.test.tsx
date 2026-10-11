import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RoomPage } from "./room-page-lazy";

vi.mock("./room-page", () => ({ RoomPage: () => <p>room view</p> }));

it("loads the room page lazily behind its own fallback", async () => {
  render(<RoomPage />);
  expect(screen.getByTestId("room-page-loading")).toHaveAttribute("aria-busy", "true");
  expect(await screen.findByText("room view")).toBeInTheDocument();
});
