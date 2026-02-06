import { Box, useColorModeValue } from "@chakra-ui/react";
import { Navigate, Route, Routes } from "react-router-dom";
import { warmNeutrals } from "./theme";
import TopNav from "./components/TopNav";
import LoginPage from "./pages/Login";
import WelcomePage from "./pages/Welcome";
import VideoLibPage from "./pages/VideoLib";
import DetailPage from "./pages/Detail";
import PlayPage from "./pages/Play";

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem("authToken");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function Layout({ children }: { children: React.ReactNode }) {
  const bg = useColorModeValue("gray.50", warmNeutrals.bg);

  return (
    <Box minH="100vh" bg={bg} transition="background-color 0.2s ease">
      <TopNav />
      <Box as="main" px={6} py={6}>
        {children}
      </Box>
    </Box>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout>
              <WelcomePage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/videolib"
        element={
          <RequireAuth>
            <Layout>
              <VideoLibPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/detail/:code"
        element={
          <RequireAuth>
            <Layout>
              <DetailPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/play/:code"
        element={
          <RequireAuth>
            <Layout>
              <PlayPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

