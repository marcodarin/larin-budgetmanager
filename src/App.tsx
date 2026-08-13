import React, { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { RoleSimulationProvider } from "./contexts/RoleSimulationContext";
import { LoadingScreen } from "./components/LoadingScreen";
import { ThemeProvider } from "./components/ThemeProvider";

// Auth pages - eagerly loaded (entry points)
import Auth from "./pages/Auth";
import EmailConfirmed from "./pages/EmailConfirmed";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

// Lazy-loaded pages
const AppLayout = React.lazy(() => import("./components/AppLayout").then(m => ({ default: m.AppLayout })));
const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const Index = React.lazy(() => import("./pages/Index"));
const ProjectBudget = React.lazy(() => import("./pages/ProjectBudget"));
const ProjectCanvas = React.lazy(() => import("./pages/ProjectCanvas"));
const Calendar = React.lazy(() => import("./pages/Calendar"));
const Quotes = React.lazy(() => import("./pages/Quotes"));
const QuoteDetail = React.lazy(() => import("./pages/QuoteDetail"));
const Offers = React.lazy(() => import("./pages/Offers"));
const OfferDetail = React.lazy(() => import("./pages/OfferDetail"));
const ApprovedProjects = React.lazy(() => import("./pages/ApprovedProjects"));
const Settings = React.lazy(() => import("./pages/Settings"));
const Profile = React.lazy(() => import("./pages/Profile"));
const RolesDocumentation = React.lazy(() => import("./pages/RolesDocumentation"));
const Notifications = React.lazy(() => import("./pages/Notifications"));
const NotFound = React.lazy(() => import("./pages/NotFound"));
const PublicTimesheet = React.lazy(() => import("./pages/PublicTimesheet"));
const StyleGuide = React.lazy(() => import("./pages/StyleGuide"));
const Workload = React.lazy(() => import("./pages/Workload"));
const Workflows = React.lazy(() => import("./pages/Workflows"));
const Help = React.lazy(() => import("./pages/Help"));
const UserActionLogs = React.lazy(() => import("./pages/UserActionLogs"));
const HelpFeedback = React.lazy(() => import("./pages/HelpFeedback"));
const SystemMonitor = React.lazy(() => import("./pages/SystemMonitor"));
const OAuthConsent = React.lazy(() => import("./pages/OAuthConsent"));
const Connect = React.lazy(() => import("./pages/Connect"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <TooltipProvider>
      <RoleSimulationProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/email-confirmed" element={<EmailConfirmed />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/timesheet/public" element={<PublicTimesheet />} />
              <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
              <Route path="/" element={<Dashboard />} />
              <Route path="/budgets" element={<AppLayout><Index /></AppLayout>} />
              <Route path="/calendar" element={<AppLayout><Calendar /></AppLayout>} />
              <Route path="/projects" element={<Navigate to="/budgets" replace />} />
              <Route path="/projects/:projectId" element={<AppLayout><ProjectBudget /></AppLayout>} />
              <Route path="/projects/:projectId/canvas" element={<AppLayout><ProjectCanvas /></AppLayout>} />
              <Route path="/approved-projects" element={<AppLayout><ApprovedProjects /></AppLayout>} />
              <Route path="/quotes" element={<AppLayout><Quotes /></AppLayout>} />
              <Route path="/quotes/:quoteId" element={<AppLayout><QuoteDetail /></AppLayout>} />
              <Route path="/offers" element={<AppLayout><Offers /></AppLayout>} />
              <Route path="/offers/:offerId" element={<AppLayout><OfferDetail /></AppLayout>} />
              <Route path="/settings" element={<AppLayout><Settings /></AppLayout>} />
              <Route path="/roles-documentation" element={<AppLayout><RolesDocumentation /></AppLayout>} />
              <Route path="/notifications" element={<AppLayout><Notifications /></AppLayout>} />
              <Route path="/profile" element={<AppLayout><Profile /></AppLayout>} />
              <Route path="/style-guide" element={<AppLayout><StyleGuide /></AppLayout>} />
              <Route path="/workload" element={<AppLayout><Workload /></AppLayout>} />
              <Route path="/workflows" element={<AppLayout><Workflows /></AppLayout>} />
              <Route path="/help" element={<AppLayout><Help /></AppLayout>} />
              <Route path="/user-action-logs" element={<AppLayout><UserActionLogs /></AppLayout>} />
              <Route path="/settings/help-feedback" element={<AppLayout><HelpFeedback /></AppLayout>} />
              <Route path="/settings/system-monitor" element={<AppLayout><SystemMonitor /></AppLayout>} />
              <Route path="/connect" element={<AppLayout><Connect /></AppLayout>} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </RoleSimulationProvider>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
