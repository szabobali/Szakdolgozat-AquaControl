import {
  Droplets,
  Calendar,
  Settings as SettingsIcon,
  History as HistoryIcon,
  Moon,
  Sun,
} from "lucide-react";
import { Outlet, Link, useLocation } from "react-router";
import { Toaster } from "../ui/sonner";
import { Button } from "../ui/button";

function Root() {
  const location = useLocation();
  const navItems = [
    { path: "/", label: "Dashboard", icon: Droplets },
    { path: "/schedule", label: "Schedule", icon: Calendar },
    { path: "/history", label: "History", icon: HistoryIcon },
    { path: "/settings", label: "Settings", icon: SettingsIcon },
  ];
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <Droplets className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  AquaControl
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Garden Watering System
                </p>
              </div>
            </div>
            <Button className="text-slate-600 dark:text-slate-400">
              <Sun className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>
      <nav className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="container mx-auto px-4">
          <div className="flex gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    isActive
                      ? "border-blue-600 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}

export default Root;
