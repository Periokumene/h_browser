import {
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Spinner,
  Stack,
  Text,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { fetchConfig, updateConfig, type MediaLibraryConfig } from "../api/calls";

/** 与后端 GET/PUT /api/config 保持一致：仅 media_roots */
function normalizeMediaRoots(roots: string[] | undefined): string[] {
  if (!Array.isArray(roots) || roots.length === 0) return [""];
  return roots.every((r) => !r?.trim()) ? [""] : roots.map((r) => String(r ?? "").trim());
}

function PathRow({
  value,
  onChange,
  onRemove,
  onSelectFolder,
  showDelete = true,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onRemove?: () => void;
  onSelectFolder?: () => void;
  showDelete?: boolean;
  placeholder?: string;
}) {
  return (
    <Flex gap={2} align="center">
      <InputGroup size="md">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          fontFamily="mono"
        />
        <InputRightElement width="auto" pr={1}>
          <IconButton
            aria-label="选择文件夹"
            size="sm"
            variant="ghost"
            onClick={onSelectFolder}
            title="Web 环境下请手动输入路径"
          >
            📁
          </IconButton>
        </InputRightElement>
      </InputGroup>
      {showDelete && (
        <IconButton
          aria-label="删除"
          size="sm"
          variant="ghost"
          colorScheme="red"
          onClick={onRemove}
        >
          ✕
        </IconButton>
      )}
    </Flex>
  );
}

export default function MediaLibraryConfigPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mediaRoots, setMediaRoots] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, isFetched } = useQuery({
    queryKey: ["config"],
    queryFn: fetchConfig,
    staleTime: 30 * 1000,
  });

  // 以服务端数据为来源：有 data 且未在编辑时，同步到本地表单（含刷新后首次加载）
  useEffect(() => {
    if (data?.media_roots != null && !dirty) {
      setMediaRoots(normalizeMediaRoots(data.media_roots));
    }
  }, [data?.media_roots, dirty, isFetched]);

  // 展示用：未编辑时优先用服务端 data，避免刷新后首帧空白
  const displayRoots =
    dirty || !data?.media_roots
      ? mediaRoots
      : normalizeMediaRoots(data.media_roots);

  const updateMutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: (updated) => {
      setMediaRoots(normalizeMediaRoots(updated.media_roots));
      setDirty(false);
      queryClient.setQueryData(["config"], updated);
      toast({ title: "配置已保存", status: "success", duration: 2000 });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      const msg = err?.response?.data?.error ?? "保存失败";
      toast({ title: msg, status: "error", duration: 3000 });
    },
  });

  const handleSave = useCallback(() => {
    const toSave = dirty ? mediaRoots : normalizeMediaRoots(data?.media_roots);
    updateMutation.mutate({
      media_roots: toSave.map((r) => r.trim()).filter(Boolean),
    });
  }, [mediaRoots, data?.media_roots, dirty, updateMutation]);

  const setMediaRootAt = useCallback((index: number, value: string) => {
    setDirty(true);
    setMediaRoots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const addMediaRoot = useCallback(() => {
    setDirty(true);
    setMediaRoots((prev) => [...prev, ""]);
  }, []);

  const removeMediaRoot = useCallback((index: number) => {
    setDirty(true);
    setMediaRoots((prev) => prev.filter((_, i) => i !== index));
  }, []);

  if (isLoading && !data) {
    return (
      <Flex justify="center" align="center" minH="40vh">
        <Spinner size="lg" />
      </Flex>
    );
  }

  return (
    <Box maxW="560px" mx="auto" py={8}>
      <VStack align="stretch" spacing={8}>
        <Heading size="md">媒体库配置</Heading>

        <Stack spacing={6} as="form" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          {/* Section 1: 媒体库基础配置 */}
          <Box>
            <Text fontWeight="semibold" mb={3} color="app.muted">
              媒体库基础配置
            </Text>
            <VStack align="stretch" spacing={4}>
              <Box>
                <Text fontSize="sm" mb={2} color="app.muted.fg">
                  媒体库路径（可多个）
                </Text>
                <VStack align="stretch" spacing={2}>
                  {displayRoots.map((path, i) => (
                    <PathRow
                      key={i}
                      value={path}
                      onChange={(v) => setMediaRootAt(i, v)}
                      onRemove={displayRoots.length > 1 ? () => removeMediaRoot(i) : undefined}
                      showDelete={displayRoots.length > 1}
                      placeholder="例如：D:\Media 或 /path/to/media"
                      onSelectFolder={() => {}}
                    />
                  ))}
                </VStack>
                <Button
                  size="sm"
                  variant="outline"
                  mt={2}
                  onClick={addMediaRoot}
                >
                  + 添加媒体库路径
                </Button>
              </Box>
            </VStack>
          </Box>

          <Button
            type="submit"
            colorScheme="orange"
            isLoading={updateMutation.isPending}
            loadingText="保存中"
            onClick={() => handleSave()}
          >
            保存配置
          </Button>
        </Stack>
      </VStack>
    </Box>
  );
}
