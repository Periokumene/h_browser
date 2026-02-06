import { Box, useColorModeValue } from "@chakra-ui/react";
import { Navigate, Route, Routes } from "react-router-dom";
import { warmNeutrals } from "./theme";
import TopNav from "./components/TopNav";
import WelcomePage from "./pages/Welcome";
import VideoLibPage from "./pages/VideoLib";
import DetailPage from "./pages/Detail";
import PlayPage from "./pages/Play";

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
      <Route path="/" element={<Layout><WelcomePage /></Layout>} />
      <Route path="/videolib" element={<Layout><VideoLibPage /></Layout>} />
      <Route path="/detail/:code" element={<Layout><DetailPage /></Layout>} />
      <Route path="/play/:code" element={<Layout><PlayPage /></Layout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

