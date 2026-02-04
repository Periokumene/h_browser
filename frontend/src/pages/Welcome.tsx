import { Box, Button, Heading, Stack } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";

export default function WelcomePage() {
  const navigate = useNavigate();

  return (
    <Box py={10}>
      <Stack align="center" spacing={6}>
        <Heading size="lg">欢迎使用个人影音库</Heading>
        <Button
          colorScheme="orange"
          size="lg"
          onClick={() => navigate("/videolib")}
        >
          进入媒体库
        </Button>
      </Stack>
    </Box>
  );
}
