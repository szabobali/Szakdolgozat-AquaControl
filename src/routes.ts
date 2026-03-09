import { createBrowserRouter } from "react-router";
import Root from "./components/Root";
import { Dashboard } from "./components/Dashboard";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
    ],
  },
]);
