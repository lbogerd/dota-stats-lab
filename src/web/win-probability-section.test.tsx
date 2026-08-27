import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WinProbabilitySection } from "./win-probability-section";

const getWinProbability = vi.hoisted(() => vi.fn());

vi.mock("./overview-data.js", () => ({
  matchWinProbabilityQuery: (matchId: string) => ({
    queryKey: ["match-win-probability", matchId],
    queryFn: () => getWinProbability({ matchId }),
    retry: false,
  }),
}));

describe("WinProbabilitySection", () => {
  beforeEach(() => {
    getWinProbability.mockReset();
  });

  it("shows the required description and a loading state", () => {
    getWinProbability.mockReturnValue(new Promise(() => undefined));
    renderSection();

    expect(screen.getByRole("heading", { name: "Valve win probability" })).toBeTruthy();
    expect(screen.getByText("Server prediction from the replay. This application does not calculate the prediction.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading win probability");
  });

  it("uses team names and shows graph-history data", async () => {
    getWinProbability.mockResolvedValue({
      matchId: "42",
      source: "graph_history",
      points: [{ gameTimeSeconds: 30, radiantProbability: 0.6, direProbability: 0.4 }],
    });
    renderSection();

    expect(await screen.findByText("0:30 · Team Spirit 60.0% · Liquid 40.0%")).toBeTruthy();
    expect(screen.getByText("Replay graph history")).toBeTruthy();
    expect(screen.getByText("Team Spirit (Radiant)")).toBeTruthy();
    expect(screen.getByText("Liquid (Dire)")).toBeTruthy();
  });

  it("explains when an extraction has no probability data", async () => {
    getWinProbability.mockResolvedValue({ matchId: "42", source: null, points: [] });
    renderSection();
    expect(await screen.findByText("Valve win probability is not available for this extraction. Extract the replay with the current parser.")).toBeTruthy();
  });

  it("shows an error and retries the query", async () => {
    getWinProbability
      .mockRejectedValueOnce(new Error("warehouse unavailable"))
      .mockResolvedValueOnce({ matchId: "42", source: "spectator_updates", points: [] });
    renderSection();

    expect((await screen.findByRole("alert")).textContent).toContain("warehouse unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(getWinProbability).toHaveBeenCalledTimes(2);
  });
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <WinProbabilitySection matchId="42" radiantName="Team Spirit" direName="Liquid" />
  </QueryClientProvider>);
}
