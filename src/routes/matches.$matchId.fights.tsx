import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/matches/$matchId/fights")({
  component: Outlet,
});
