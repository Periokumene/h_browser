import {
  Box,
  Button,
  Flex,
  Heading,
  Spacer,
  useColorMode,
  useColorModeValue
} from "@chakra-ui/react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
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
  const { colorMode, toggleColorMode } = useColorMode();
  const bg = useColorModeValue("gray.100", "gray.900");
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("authToken");
    navigate("/login");
  };

  return (
    <Box minH="100vh" bg={bg}>
      <Flex
        as="header"
        px={6}
        py={4}
        borderBottomWidth="1px"
        align="center"
        gap={4}
      >
        <Heading
          size="md"
          cursor="pointer"
          onClick={() => navigate("/")}
        >
          个人影音库
        </Heading>
        <Spacer />
        <Button size="sm" onClick={toggleColorMode} mr={2}>
          {colorMode === "light" ? "暗色" : "亮色"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleLogout}>
          退出
        </Button>
      </Flex>
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

