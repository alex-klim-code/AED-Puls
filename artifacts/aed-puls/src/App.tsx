import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import MapPage from '@/pages/map';
import AedDetail from '@/pages/aed-detail';
import ReportPage from '@/pages/report';
import About from '@/pages/about';
import DataPage from '@/pages/data';
import StatusPage from '@/pages/status';
import RedMapPage from '@/pages/red-map';
import Login from '@/pages/login';
import SubmitAed from '@/pages/submit-aed';
import AdminSourcesPage from '@/pages/admin-sources';
import AdminDuplicatesPage from '@/pages/admin-duplicates';
import {
  AdminAedsPage, AdminPage, AdminReportsPage, AdminSubmissionsPage, DashboardPage, MySubmissionsPage, ProviderAedsPage, ProviderPage,
} from '@/pages/workspace';
import { RegisterOrganizationPage, McodPage, AdminMcodPage } from '@/pages/mcod';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, refetchInterval: 60_000, retry: 1 } } });

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/map" component={MapPage} />
        <Route path="/aed/:id" component={AedDetail} />
        <Route path="/report" component={ReportPage} />
        <Route path="/about" component={About} />
        <Route path="/data" component={DataPage} />
        <Route path="/status" component={StatusPage} />
        <Route path="/login" component={Login} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/my-submissions" component={MySubmissionsPage} />
        <Route path="/submit-aed" component={SubmitAed} />
        <Route path="/provider" component={ProviderPage} />
        <Route path="/provider/aeds" component={ProviderAedsPage} />
        <Route path="/provider/red-map" component={RedMapPage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/admin/aeds" component={AdminAedsPage} />
        <Route path="/admin/submissions" component={AdminSubmissionsPage} />
        <Route path="/admin/reports" component={AdminReportsPage} />
        <Route path="/admin/sources" component={AdminSourcesPage} />
        <Route path="/admin/duplicates" component={AdminDuplicatesPage} />
        <Route path="/register-organization" component={RegisterOrganizationPage} />
        <Route path="/mcod" component={McodPage} />
        <Route path="/admin/mcod" component={AdminMcodPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
