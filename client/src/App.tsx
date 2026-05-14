import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import ContactsPage from "./pages/ContactsPage";
import MessagingPage from "./pages/MessagingPage.tsx";
import RequestScheduling from "./pages/RequestScheduling";
import AccountManagement from "./pages/AccountManagement";
import AccountEntry from "./pages/AccountEntry";
import ZapierIntegrationPage from "./pages/ZapierIntegrationPage.tsx";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/account-entry"} component={AccountEntry} />
      <Route path={"/account"} component={AccountManagement} />
      <Route path={"/request-scheduling"} component={RequestScheduling} />
      <Route path={"/integrate"} component={ZapierIntegrationPage} />
      <Route path={"/messaging"} component={MessagingPage} />
      <Route path={"/contacts"} component={ContactsEntry} />
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-right" richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
