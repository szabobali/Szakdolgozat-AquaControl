import { createBrowserRouter } from "react-router";
import Root from "./components/Root";
import { Dashboard } from "./components/Dashboard";
import { Schedule } from "./components/Schedule";
import { History } from "./components/History";
import { Settings } from "./components/Settings";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
      { path: "schedule", Component: Schedule },
      { path: "history", Component: History },
      { path: "settings", Component: Settings },
    ],
  },
]);
