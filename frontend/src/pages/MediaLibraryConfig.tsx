import {
  Box,
  Button,
  Flex,
  FormControl,
  FormHelperText,
  FormLabel,
  Heading,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Spinner,
  Stack,
  Switch,
  Text,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { fetchConfig, updateConfig, type DataSourceConfig } from "../api/calls";

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
  const [avatarSource, setAvatarSource] = useState<string>("");
  const [scanOnStartup, setScanOnStartup] = useState<boolean>(true);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, isFetched } = useQuery<DataSourceConfig>({
    queryKey: ["config"],
    queryFn: fetchConfig,
    staleTime: 30 * 1000,
  });

  // 以服务端数据为来源：有 data 且未在编辑时，同步到本地表单（含刷新后首次加载）
  useEffect(() => {
    if (!dirty) {
      if (data?.media_roots != null) {
        setMediaRoots(normalizeMediaRoots(data.media_roots));
      }
      if (data?.avatar_source_url !== undefined) {
        setAvatarSource(data.avatar_source_url ?? "");
      }
      if (data?.scan_on_startup !== undefined) {
        setScanOnStartup(data.scan_on_startup);
      }
    }
  }, [data?.media_roots, data?.avatar_source_url, data?.scan_on_startup, dirty, isFetched]);

  // 展示用：未编辑时优先用服务端 data，避免刷新后首帧空白
  const displayRoots =
    dirty || !data?.media_roots
      ? mediaRoots
      : normalizeMediaRoots(data.media_roots);

  const updateMutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: (updated: DataSourceConfig) => {
      setMediaRoots(normalizeMediaRoots(updated.media_roots));
      setAvatarSource(updated.avatar_source_url ?? "");
      setScanOnStartup(updated.scan_on_startup ?? true);
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
      avatar_source_url: avatarSource.trim() || null,
      scan_on_startup: scanOnStartup,
    });
  }, [mediaRoots, data?.media_roots, dirty, avatarSource, scanOnStartup, updateMutation]);

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
        <Heading size="md">数据源配置</Heading>

        <Stack spacing={6} as="form" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          {/* Section 1: 媒体库 / 数据源基础配置 */}
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

          {/* Section 2: 启动时扫描 */}
          <Box>
            <Text fontWeight="semibold" mb={3} color="app.muted">
              启动行为
            </Text>
            <FormControl>
              <Flex align="center">
                <FormLabel htmlFor="scan-on-startup" mb={0} flex="1">
                  后端启动时自动执行扫描
                </FormLabel>
                <Switch
                  id="scan-on-startup"
                  isChecked={scanOnStartup}
                  onChange={(e) => {
                    setDirty(true);
                    setScanOnStartup(e.target.checked);
                  }}
                />
              </Flex>
              <FormHelperText mt={1} color="app.muted.fg">
                开启后，每次启动后端会自动扫描媒体库路径并更新库；关闭则需在界面手动点击刷新。
              </FormHelperText>
            </FormControl>
          </Box>

          {/* Section 3: 演员头像仓库配置 */}
          <Box>
            <Text fontWeight="semibold" mb={3} color="app.muted">
              演员头像数据源
            </Text>
            <VStack align="stretch" spacing={4}>
              <Box>
                <Text fontSize="sm" mb={2} color="app.muted.fg">
                  头像仓库源 URL（留空则禁用头像同步）
                </Text>
                <Input
                  value={avatarSource}
                  onChange={(e) => {
                    setDirty(true);
                    setAvatarSource(e.target.value);
                  }}
                  placeholder="https://example.com/avatars"
                  fontFamily="mono"
                />
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
