import { createContext, useContext, useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "appMode";
const VALID_MODES = ["full", "simple"];

function readStoredMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return VALID_MODES.includes(stored) ? stored : "full";
  } catch {
    return "full";
  }
}

const AppModeContext = createContext(null);

export function AppModeProvider({ children }) {
  const [appMode, setAppModeState] = useState(readStoredMode);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, appMode);
    } catch {
      // ignore
    }
  }, [appMode]);

  const setAppMode = useCallback((mode) => {
    setAppModeState(VALID_MODES.includes(mode) ? mode : "full");
  }, []);

  return (
    <AppModeContext.Provider value={{ appMode, setAppMode }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode() {
  const ctx = useContext(AppModeContext);
  if (!ctx) {
    throw new Error("useAppMode must be used within AppModeProvider");
  }
  return ctx;
}
