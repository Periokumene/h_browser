import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Progress,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useToast,
} from "@chakra-ui/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FaCopy } from "react-icons/fa";
import { fetchTasks, cancelTask, type TaskItem } from "../api/calls";

const POLL_INTERVAL_MS = 2000;

function statusColor(status: string): string {
  switch (status) {
    case "pending":
      return "gray";
    case "running":
      return "blue";
    case "success":
      return "green";
    case "failed":
    case "cancelled":
      return "red";
    default:
      return "gray";
  }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "等待中",
    running: "进行中",
    success: "完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return map[status] ?? status;
}

function CopyableCell({ fullText, children }: { fullText: string; children: React.ReactNode }) {
  const toast = useToast();
  const handleCopy = () => {
    if (!fullText) return;
    navigator.clipboard.writeText(fullText).then(
      () => toast({ title: "已复制到剪贴板", status: "success", duration: 2000 }),
      () => toast({ title: "复制失败", status: "error" })
    );
  }
  if (!fullText) return <>{children}</>;
  return (
    <Flex align="center" gap={2}>
      <Box flex={1} minW={0}>
        {children}
      </Box>
      <IconButton
        aria-label="复制完整内容"
        size="xs"
        variant="ghost"
        icon={<FaCopy />}
        onClick={handleCopy}
        title="复制完整内容"
      />
    </Flex>
  );
}

function taskDisplayKey(task: TaskItem): string {
  if (task.task_type === "gen_all_thumbnails") return "全部缩略图";
  return task.payload?.unique_key ?? "-";
}

function TaskRow({
  task,
  onCancel,
  isCancelling,
}: {
  task: TaskItem;
  onCancel: (id: string) => void;
  isCancelling: string | null;
}) {
  const keyText = taskDisplayKey(task);
  const progress = task.progress_pct;
  const payload = task.payload ?? {};
  const done = payload.done as number | undefined;
  const total = payload.total as number | undefined;
  const showProgress = task.status === "running" && progress != null;
  const showIndeterminate = task.status === "running" && progress == null;

  const progressDesc =
    task.status === "running" && total != null && total > 0 && done != null
      ? `${done}/${total}`
      : task.status === "running" && progress != null
        ? `${Math.round(progress)}%`
        : null;
  const copyableText =
    task.result ?? task.error ?? (task.status === "running" && progressDesc ? `进行中 ${progressDesc}` : null) ?? (task.status === "running" ? "进行中（进度未知）" : null);

  return (
    <Tr>
      <Td fontFamily="mono" fontSize="sm">
        {keyText}
      </Td>
      <Td>
        <Badge colorScheme={statusColor(task.status)}>{statusLabel(task.status)}</Badge>
      </Td>
      <Td maxW="320px">
        <CopyableCell fullText={copyableText ?? ""}>
          {showProgress && (
            <Flex align="center" gap={2}>
              <Progress value={progress} size="sm" colorScheme="blue" borderRadius="md" maxW="120px" flex={1} />
              {progressDesc != null && (
                <Text fontSize="xs" color="gray.500" whiteSpace="nowrap">
                  {progressDesc}
                </Text>
              )}
            </Flex>
          )}
          {showIndeterminate && (
            <Text fontSize="xs" color="gray.500">
              进行中（进度未知）
            </Text>
          )}
          {task.status === "success" && task.result && (
            <Text fontSize="xs" noOfLines={2} title={task.result}>
              {task.result}
            </Text>
          )}
          {task.error && (
            <Text fontSize="xs" color="red.500" noOfLines={3} whiteSpace="pre-wrap" title={task.error}>
              {task.error}
            </Text>
          )}
        </CopyableCell>
      </Td>
      <Td fontSize="xs" color="gray.500">
        {task.created_at ? new Date(task.created_at).toLocaleString() : "-"}
      </Td>
      <Td>
        {task.status === "pending" || task.status === "running" ? (
          <Button
            size="xs"
            variant="outline"
            colorScheme="red"
            onClick={() => onCancel(task.id)}
            isDisabled={isCancelling === task.id}
          >
            {isCancelling === task.id ? <Spinner size="xs" /> : "取消"}
          </Button>
        ) : null}
      </Td>
    </Tr>
  );
}

export default function TasksPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => fetchTasks(),
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? [];
      const hasRunning = tasks.some((t: TaskItem) => t.status === "running" || t.status === "pending");
      return hasRunning ? POLL_INTERVAL_MS : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setCancellingId(null);
      toast({ title: "已取消任务", status: "info" });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setCancellingId(null);
      toast({ title: err?.response?.data?.error ?? "取消失败", status: "error" });
    },
  });

  const handleCancel = (taskId: string) => {
    setCancellingId(taskId);
    cancelMutation.mutate(taskId);
  };

  const tasks = data?.tasks ?? [];

  return (
    <Box>
      <Heading size="md" mb={4}>
        任务中心
      </Heading>
      <Text fontSize="sm" color="gray.500" mb={4}>
        异步任务列表（如 TS→MP4 转换）。进行中任务将自动刷新进度。
      </Text>
      {isLoading && !data && (
        <Box py={8} textAlign="center">
          <Spinner />
        </Box>
      )}
      {isError && (
        <Text color="red.500">加载任务列表失败，请稍后重试。</Text>
      )}
      {data && (
        <Table size="sm" variant="simple">
          <Thead>
            <Tr>
              <Th>Key</Th>
              <Th>状态</Th>
              <Th>进度 / 结果</Th>
              <Th>创建时间</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {tasks.length === 0 ? (
              <Tr>
                <Td colSpan={5} color="gray.500" textAlign="center" py={8}>
                  暂无任务
                </Td>
              </Tr>
            ) : (
              tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onCancel={handleCancel}
                  isCancelling={cancellingId}
                />
              ))
            )}
          </Tbody>
        </Table>
      )}
    </Box>
  );
}
