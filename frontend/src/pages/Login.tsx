import {
  Box,
  Button,
  Card,
  CardBody,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Stack,
  Text,
  useToast
} from "@chakra-ui/react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../api/client";

export default function LoginPage() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiClient.post("/api/auth/login", {
        username,
        password
      });
      localStorage.setItem("authToken", res.data.token);
      toast({ title: "登录成功", status: "success", duration: 1500 });
      navigate("/");
    } catch (err: any) {
      const msg =
        err?.response?.data?.error || "登录失败，请检查用户名和密码";
      toast({ title: msg, status: "error", duration: 2000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      minH="100vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="gray.900"
    >
      <Card w="sm" bg="gray.800" color="white">
        <CardBody>
          <Heading size="md" mb={4}>
            登录个人影音库
          </Heading>
          <Text fontSize="sm" mb={4} color="gray.300">
            默认账号密码为 admin / admin，可在后端环境变量中修改。
          </Text>
          <Box as="form" onSubmit={handleSubmit}>
            <Stack spacing={4}>
              <FormControl>
                <FormLabel>用户名</FormLabel>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </FormControl>
              <FormControl>
                <FormLabel>密码</FormLabel>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormControl>
              <Button
                type="submit"
                colorScheme="teal"
                isLoading={loading}
              >
                登录
              </Button>
            </Stack>
          </Box>
        </CardBody>
      </Card>
    </Box>
  );
}

