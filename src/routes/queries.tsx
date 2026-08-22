import { Outlet, createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/queries")({ component: Outlet });
