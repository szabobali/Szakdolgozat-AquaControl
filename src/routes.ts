import { createBrowserRouter } from "react-router";
import Root from "./components/Root";
import { Dashboard } from "./components/Dashboard";
import { Schedule } from "./components/Schedule";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
      { path: "schedule", Component: Schedule },
    ],
  },
]);
