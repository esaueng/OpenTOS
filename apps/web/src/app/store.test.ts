import { beforeEach, describe, expect, it } from "vitest";

import { resetStudyStoreForTests, useStudyStore } from "./store";

describe("study workspace store", () => {
  beforeEach(() => resetStudyStoreForTests());

  it("updates a focused slice without replacing unrelated settings", () => {
    useStudyStore.getState().set({ selectedOutcomeId: "OUT-02", metricMode: "stress" });

    expect(useStudyStore.getState().selectedOutcomeId).toBe("OUT-02");
    expect(useStudyStore.getState().metricMode).toBe("stress");
    expect(useStudyStore.getState().settings.material).toBe("Aluminum 6061");
  });
});
