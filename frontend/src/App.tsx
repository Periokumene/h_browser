import { lazy, Suspense } from "react";
import { Box, Spinner, useColorModeValue } from "@chakra-ui/react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { warmNeutrals } from "./theme";
import { getRouteConfig } from "./config/routes";
import TopNav from "./components/TopNav";

const WelcomePage = lazy(() => import("./pages/Welcome"));
const VideoLibPage = lazy(() => import("./pages/VideoLib"));
const DetailPage = lazy(() => import("./pages/Detail"));
const PlayPage = lazy(() => import("./pages/Play"));
const MediaLibraryConfigPage = lazy(() => import("./pages/MediaLibraryConfig"));
const TasksPage = lazy(() => import("./pages/Tasks"));

function Layout({ children }: { children: React.ReactNode }) {
  const bg = useColorModeValue("gray.50", warmNeutrals.bg);
  const { pathname } = useLocation();
  const routeConfig = getRouteConfig(pathname);

  return (
    <Box minH="100vh" bg={bg} transition="background-color 0.2s ease">
      <TopNav />
      <Box
        as="main"
        px={routeConfig.mainPx}
        pt={routeConfig.mainPt}
        pb={routeConfig.mainPb ?? 6}
      >
        {children}
      </Box>
    </Box>
  );
}

function PageFallback() {
  return (
    <Box display="flex" justifyContent="center" alignItems="center" minH="50vh">
      <Spinner size="xl" />
    </Box>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Layout><WelcomePage /></Layout>} />
        <Route path="/videolib" element={<Layout><VideoLibPage /></Layout>} />
        <Route path="/detail/:code" element={<Layout><DetailPage /></Layout>} />
        <Route path="/play/:code" element={<Layout><PlayPage /></Layout>} />
        <Route path="/config/media" element={<Layout><MediaLibraryConfigPage /></Layout>} />
        <Route path="/tasks" element={<Layout><TasksPage /></Layout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

