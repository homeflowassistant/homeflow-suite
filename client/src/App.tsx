import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import AddContactsPage from "./pages/AddContactsPage";
import RequestScheduling from "./pages/RequestScheduling";
import ReactivationPage from "./pages/ReactivationPage";

function Router() {
  return (
    <Switch>
      <Route path={"/request-scheduling"} component={RequestScheduling} />
      <Route path={"/reactivation"} component={ReactivationPage} />
      <Route path={"/add-contacts"} component={AddContactsPage} />
      <Route path={"/"}>
        <Redirect to="/add-contacts" />
      </Route>
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <Toaster position="top-right" richColors />
        <Router />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
