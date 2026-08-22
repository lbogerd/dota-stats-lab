import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { matchIdSchema, queryNameSchema } from "../data";
import { StatusBadge } from "../ui";

describe("frontend input contracts", () => {
  it("accepts a Dota match ID and safe query name", () => {
    expect(matchIdSchema.safeParse("8041927713").success).toBe(true);
    expect(queryNameSchema.safeParse("hero-property-history").success).toBe(true);
  });

  it("rejects unsafe saved-query paths", () => {
    expect(queryNameSchema.safeParse("../warehouse").success).toBe(false);
    expect(queryNameSchema.safeParse("Team Net Worth").success).toBe(false);
  });
});

describe("StatusBadge", () => {
  it("gives successful jobs a clear text state", () => {
    render(<StatusBadge status="succeeded" />);
    expect(screen.getByText("Complete")).toBeTruthy();
  });
});
