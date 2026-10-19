import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

type SaveHandler = () => void | Promise<void>;

type OnboardingSaveContextValue = {
  registerSaveHandler: (handler: SaveHandler) => () => void;
  saveActivePage: () => Promise<void>;
};

const OnboardingSaveContext = createContext<OnboardingSaveContextValue | null>(
  null
);

export function OnboardingSaveProvider({ children }: { children: ReactNode }) {
  const activeHandlerRef = useRef<SaveHandler | null>(null);

  const registerSaveHandler = useCallback((handler: SaveHandler) => {
    const previousHandler = activeHandlerRef.current;
    activeHandlerRef.current = handler;
    return () => {
      if (activeHandlerRef.current === handler) {
        activeHandlerRef.current = previousHandler;
      }
    };
  }, []);

  const saveActivePage = useCallback(async () => {
    if (activeHandlerRef.current) {
      await activeHandlerRef.current();
    }
  }, []);

  return (
    <OnboardingSaveContext.Provider
      value={{ registerSaveHandler, saveActivePage }}
    >
      {children}
    </OnboardingSaveContext.Provider>
  );
}

export function useOnboardingSaveHandler(
  enabled: boolean,
  handler: SaveHandler
) {
  const context = useContext(OnboardingSaveContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled || !context) return;
    const currentHandler = () => handlerRef.current();
    return context.registerSaveHandler(currentHandler);
  }, [context, enabled]);
}

export function useOnboardingSaveContext() {
  return useContext(OnboardingSaveContext);
}
