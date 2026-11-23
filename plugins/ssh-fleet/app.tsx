import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode, RefObject } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { FLEET_CHANNEL } from "./lib/channel";
import { AGENT_PROMPT } from "./lib/agent-prompt";
import { costLine, costTotals, hourly, rubles } from "./lib/cost";
import { DEFAULT_GROUP, GROUP_LABEL_MAX } from "./lib/groups";
import { cn } from "./lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Server = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: "root";
  identityPath: string;
  status: "unchecked" | "up" | "down";
  checkedAt: number | null;
  metricsAt: number | null;
  errorCode: string | null;
  errorText: string | null;
  uptimeSeconds: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpuPercent: number | null;
  memTotalBytes: number | null;
  memAvailableBytes: number | null;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  cpuCount: number | null;
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
  procsRunning: number | null;
  procsTotal: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
  iconName: string;
  iconImage: string | null;
  description: string;
  hosting: string;
  monthlyCostRub: number | null;
  group: string;
};

type Group = {
  id: string;
  label: string;
  position: number;
  count: number;
};

type Candidate = {
  alias: string;
  host: string;
  port: number;
  configUser: string;
  identityPath: string;
  already: boolean;
  error: string | null;
  notice: string;
};

type Draft = {
  name: string;
  host: string;
  port: string;
  identityPath: string;
  iconName: string;
  iconImage: string | null;
  description: string;
  hosting: string;
  monthlyCostRub: string;
  group: string;
};

/** "All groups" in the filter; `*` can never be a group id. */
const ALL = "*";

type Filter = string;

const FILTER_KEY = "ssh-fleet:group-filter";

/** Phones get 44px targets; wider screens keep bb's compact control height. */
const TOUCH = "max-sm:min-h-11";

const emptyDraft = (): Draft => ({
  name: "",
  host: "",
  port: "22",
  identityPath: "",
  iconName: "Server",
  iconImage: null,
  description: "",
  hosting: "",
  monthlyCostRub: "",
  group: DEFAULT_GROUP,
});

function draftFrom(server: Server): Draft {
  return {
    name: server.name,
    host: server.host,
    port: String(server.port),
    identityPath: server.identityPath,
    iconName: server.iconName,
    iconImage: server.iconImage,
    description: server.description,
    hosting: server.hosting,
    monthlyCostRub: server.monthlyCostRub === null ? "" : String(server.monthlyCostRub),
    group: server.group,
  };
}

function costPayload(value: string): number | null {
  const text = value.replace(/\s/g, "");
  return text === "" ? null : Number(text);
}

function draftPayload(draft: Draft) {
  return {
    name: draft.name,
    host: draft.host,
    port: Number(draft.port),
    identityPath: draft.identityPath,
    iconName: draft.iconName,
    iconImage: draft.iconImage,
    description: draft.description,
    hosting: draft.hosting,
    monthlyCostRub: costPayload(draft.monthlyCostRub),
    group: draft.group,
  };
}

function plural(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function serversWord(count: number): string {
  return `${count} ${plural(count, ["сервер", "сервера", "серверов"])}`;
}

function readFilter(): Filter {
  try {
    return window.localStorage.getItem(FILTER_KEY) ?? ALL;
  } catch {
    return ALL;
  }
}

function writeFilter(value: Filter): void {
  try {
    window.localStorage.setItem(FILTER_KEY, value);
  } catch {
    // Storage can be unavailable; the filter then lasts for this visit only.
  }
}

function useFleet() {
  const rpc = useRpc<typeof rpcContract>();
  const [servers, setServers] = useState<Server[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [passInProgress, setPassInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(() => {
    rpc.call("list", null).then((result) => {
      setServers(result.servers as Server[]);
      setGroups(result.groups as Group[]);
      setPassInProgress(result.passInProgress);
      setError(null);
    }, report);
  }, [report, rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(FLEET_CHANNEL, refetch);
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    if (connection === "connected") refetch();
  }, [connection, refetch]);
  return { rpc, servers, groups, passInProgress, error, report, refetch };
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="@container mx-auto box-border w-full max-w-4xl space-y-5 px-4 py-5 md:px-6">
        {children}
      </div>
    </div>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm break-words text-destructive"
    >
      {message}
    </p>
  );
}

function age(value: number | null): string {
  if (value === null) return "ещё не проверялся";
  const minutes = Math.max(0, Math.round((Date.now() - value) / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ч назад`;
  return `${Math.round(hours / 24)} д назад`;
}

function gibNumber(value: number): string {
  return (value / 1024 ** 3).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function gib(value: number | null): string {
  if (value === null) return "—";
  return `${gibNumber(value)} ГБ`;
}

function memoryParts(server: Pick<Server, "memTotalBytes" | "memAvailableBytes">) {
  const total = server.memTotalBytes;
  const free = server.memAvailableBytes;
  if (total === null || free === null) return { used: null, free, total };
  return { used: Math.max(0, total - free), free, total };
}

function memoryLine(server: Pick<Server, "memTotalBytes" | "memAvailableBytes">): string {
  const { used, free } = memoryParts(server);
  if (used === null && free === null) return "—";
  return `${gib(used)} занято · ${gib(free)} свободно`;
}

type Tone = "up" | "down" | "partial" | "unchecked";

function toneOf(server: Server): Tone {
  if (server.status === "down") return "down";
  if (server.status === "unchecked") return "unchecked";
  if (server.errorCode === "partial") return "partial";
  return "up";
}

const TONE_LABEL: Record<Tone, string> = {
  up: "на связи",
  down: "не отвечает",
  partial: "частично",
  unchecked: "не проверен",
};

function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "up" && "bg-success",
        tone === "down" && "bg-destructive",
        tone === "partial" && "bg-warning",
        tone === "unchecked" && "bg-muted-foreground/40",
        className,
      )}
    />
  );
}

function StatusBadge({ tone }: { tone: Tone }) {
  if (tone === "up") return <span className="sr-only">{TONE_LABEL.up}</span>;
  return (
    <Badge
      variant={tone === "down" ? "destructive" : "secondary"}
      className="shrink-0 px-1.5 py-0 font-medium"
    >
      {TONE_LABEL[tone]}
    </Badge>
  );
}

function groupLabel(groups: Group[], id: string): string {
  return groups.find((group) => group.id === id)?.label ?? id;
}

function GroupBadge({ label }: { label: string }) {
  return (
    <Badge variant="outline" className="max-w-full shrink-0 px-1.5 py-0 font-normal break-words whitespace-normal text-muted-foreground">
      {label}
    </Badge>
  );
}

const ADD_GROUP = ":add";
const REMOVE_GROUP = ":remove";

/**
 * The group dropdown of the server form. Besides the groups it holds two
 * actions: "new group" opens a name field under the dropdown, and "delete
 * group" removes the selected one (never the default). A group that still
 * has servers is removed only after an inline confirmation; its servers move
 * to the default group on the server.
 */
function GroupPicker({
  id,
  groups,
  value,
  onChange,
  onGroupsChanged,
}: {
  id: string;
  groups: Group[];
  value: string;
  onChange: (group: string) => void;
  onGroupsChanged: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [mode, setMode] = useState<"idle" | "add" | "remove">("idle");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = groups.find((group) => group.id === value) ?? null;
  const fallback = groupLabel(groups, DEFAULT_GROUP);

  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  const add = async () => {
    if (name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call("groupCreate", { label: name });
      onChange(result.group.id);
      setMode("idle");
      setName("");
      onGroupsChanged();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: Group) => {
    setBusy(true);
    setError(null);
    try {
      await rpc.call("groupRemove", { id: target.id });
      if (value === target.id) onChange(DEFAULT_GROUP);
      setMode("idle");
      onGroupsChanged();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Select
        value={value}
        onValueChange={(next) => {
          setError(null);
          if (next === ADD_GROUP) {
            setName("");
            setMode("add");
            return;
          }
          if (next === REMOVE_GROUP) {
            if (current === null) return;
            if (current.count > 0) setMode("remove");
            else void remove(current);
            return;
          }
          if (groups.some((group) => group.id === next)) {
            setMode("idle");
            onChange(next);
          }
        }}
      >
        <SelectTrigger id={id} aria-label="Группа" className={TOUCH}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id} className={TOUCH}>
              {group.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={ADD_GROUP} className={TOUCH} textValue="Новая группа">
            Новая группа…
          </SelectItem>
          {current === null || current.id === DEFAULT_GROUP ? null : (
            <SelectItem
              value={REMOVE_GROUP}
              className={cn("text-destructive focus:text-destructive", TOUCH)}
              textValue="Удалить группу"
            >
              Удалить группу «{current.label}»…
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {mode === "add" ? (
        <div className="flex flex-wrap gap-2">
          <Input
            autoFocus
            aria-label="Название новой группы"
            placeholder="Название группы"
            className={cn("min-w-0 flex-1 basis-40", TOUCH)}
            maxLength={GROUP_LABEL_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void add();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setMode("idle");
              }
            }}
          />
          <div className="flex gap-2">
            <Button type="button" className={TOUCH} disabled={busy || name.trim() === ""} onClick={() => void add()}>
              Добавить
            </Button>
            <Button type="button" variant="outline" className={TOUCH} onClick={() => setMode("idle")}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
      {mode === "remove" && current !== null ? (
        <div role="alertdialog" aria-label="Удаление группы" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="break-words">
            Удалить группу «{current.label}»? Серверов в ней: {current.count}. Они перейдут в «{fallback}».
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" className={TOUCH} disabled={busy} onClick={() => void remove(current)}>
              Удалить группу
            </Button>
            <Button type="button" variant="outline" className={TOUCH} onClick={() => setMode("idle")}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-xs break-words text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type AuthMode = "key" | "password";

type HostKeyScan = { scanId: string; keyType: string; fingerprint: string; known: "same" | "new" };

/**
 * The "root password, once" part of the add form. The password field is
 * uncontrolled: its value lives only in the DOM input until the confirm
 * click reads it for one request, and the field is emptied when that
 * request resolves. It never enters React state.
 */
type PasswordAuth = {
  mode: AuthMode;
  onMode: (mode: AuthMode) => void;
  passwordRef: RefObject<HTMLInputElement | null>;
  addSshConfig: boolean;
  onAddSshConfig: (value: boolean) => void;
  scan: HostKeyScan | null;
  onConfirm: () => void;
  onCancelScan: () => void;
};

function HostKeyConfirm({ scan, pending, onConfirm, onCancel }: { scan: HostKeyScan; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label="Ключ хоста" className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <div className="space-y-1">
        <p className="font-medium">Ключ хоста {scan.keyType}</p>
        <p className="font-mono text-xs break-all">{scan.fingerprint}</p>
        <p className="text-xs text-muted-foreground">
          {scan.known === "same"
            ? "Эта машина уже знает этот ключ."
            : "Сверьте отпечаток с сервером: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub в консоли хостера."}{" "}
          Пароль ещё не отправлен.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className={TOUCH} disabled={pending} onClick={onConfirm}>
          {pending ? "Подключаемся…" : "Отпечаток верный, подключиться"}
        </Button>
        <Button type="button" variant="outline" className={TOUCH} disabled={pending} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function DraftForm({
  title,
  draft,
  groups,
  pending,
  onChange,
  onGroupsChanged,
  onSubmit,
  onCancel,
  auth,
}: {
  title: string;
  draft: Draft;
  groups: Group[];
  pending: boolean;
  onChange: (draft: Draft) => void;
  onGroupsChanged: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  auth?: PasswordAuth;
}) {
  const byPassword = auth !== undefined && auth.mode === "password";
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const cost = costPayload(draft.monthlyCostRub);
  const costHint =
    cost !== null && Number.isFinite(cost) && cost >= 0
      ? `≈ ${hourly(cost)} ₽ в час`
      : "Целое число рублей. Пусто, если цена неизвестна.";
  const control = TOUCH;
  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            Пользователь всегда root. Приватный ключ остаётся файлом на этой машине.
          </p>
        </div>
        <Field id={`${id}-name`} label="Имя">
          <Input
            id={`${id}-name`}
            className={control}
            maxLength={80}
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 @md:grid-cols-2">
          <Field id={`${id}-group`} label="Группа">
            <GroupPicker
              id={`${id}-group`}
              groups={groups}
              value={draft.group}
              onChange={(group) => onChange({ ...draft, group })}
              onGroupsChanged={onGroupsChanged}
            />
          </Field>
          <Field id={`${id}-hosting`} label="Хостинг">
            <Input
              id={`${id}-hosting`}
              className={control}
              placeholder="Например, Selectel"
              maxLength={80}
              value={draft.hosting}
              onChange={(event) => onChange({ ...draft, hosting: event.target.value })}
            />
          </Field>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-4">
          <Field id={`${id}-host`} label="Хост или IP">
            <Input
              id={`${id}-host`}
              className={control}
              value={draft.host}
              onChange={(event) => onChange({ ...draft, host: event.target.value })}
            />
          </Field>
          <Field id={`${id}-port`} label="Порт">
            <Input
              id={`${id}-port`}
              className={control}
              inputMode="numeric"
              value={draft.port}
              onChange={(event) => onChange({ ...draft, port: event.target.value })}
            />
          </Field>
        </div>
        {auth === undefined ? null : (
          <Tabs value={auth.mode} onValueChange={(next) => auth.onMode(next === "password" ? "password" : "key")}>
            <TabsList aria-label="Как войти на сервер" className="grid h-auto w-full grid-cols-2 gap-1">
              <TabsTrigger value="key" className={cn("whitespace-normal", TOUCH)}>Ключ уже есть</TabsTrigger>
              <TabsTrigger value="password" className={cn("whitespace-normal", TOUCH)}>У меня есть пароль root</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {byPassword && auth !== undefined ? (
          <>
            <Field
              id={`${id}-password`}
              label="Пароль root"
              hint="Нужен один раз: плагин создаст отдельный ключ в ~/.ssh, запишет его на сервер и проверит вход. Пароль не сохраняется."
            >
              <Input
                id={`${id}-password`}
                ref={auth.passwordRef}
                type="password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                className={control}
              />
            </Field>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox
                checked={auth.addSshConfig}
                onCheckedChange={(checked) => auth.onAddSshConfig(checked === true)}
              />
              <span>Добавить Host в ~/.ssh/config</span>
            </label>
          </>
        ) : (
          <Field id={`${id}-key`} label="Путь к приватному ключу">
            <Input
              id={`${id}-key`}
              className={cn(control, "font-mono")}
              placeholder="/Users/you/.ssh/id_ed25519"
              value={draft.identityPath}
              onChange={(event) => onChange({ ...draft, identityPath: event.target.value })}
            />
          </Field>
        )}
        <Field id={`${id}-cost`} label="Стоимость, ₽ в месяц" hint={costHint}>
          <Input
            id={`${id}-cost`}
            className={cn(control, "sm:max-w-48")}
            inputMode="numeric"
            value={draft.monthlyCostRub}
            onChange={(event) => onChange({ ...draft, monthlyCostRub: event.target.value })}
          />
        </Field>
        <Field id={`${id}-description`} label="Описание">
          <Textarea
            id={`${id}-description`}
            placeholder="Что на сервере, комментарии"
            maxLength={500}
            rows={3}
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
          />
        </Field>
        {byPassword && auth !== undefined && auth.scan !== null ? (
          <HostKeyConfirm scan={auth.scan} pending={pending} onConfirm={auth.onConfirm} onCancel={auth.onCancelScan} />
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" className={TOUCH} disabled={pending}>
              {byPassword ? (pending ? "Получаем ключ хоста…" : "Получить ключ хоста") : pending ? "Сохраняем…" : "Сохранить"}
            </Button>
            <Button type="button" variant="outline" className={TOUCH} onClick={onCancel}>
              Отмена
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function CostCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="min-w-0 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-base font-semibold tabular-nums" title={value}>
        {value}
      </dd>
    </Card>
  );
}

function CostSummary({ servers }: { servers: Server[] }) {
  const totals = costTotals(servers);
  return (
    <Card className="px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 @lg:grid-cols-4">
        <Stat label="Серверов" value={String(totals.count)} />
        <Stat label="В месяц" value={`${rubles(totals.monthly)} ₽`} />
        <Stat label="В час" value={`${hourly(totals.monthly)} ₽`} />
        {totals.unpriced === 0 ? null : (
          <Stat label="Без цены" value={serversWord(totals.unpriced)} />
        )}
      </dl>
    </Card>
  );
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function MetricsLine({ server, className }: { server: Server; className?: string }) {
  const parts =
    server.metricsAt === null
      ? []
      : [
          `CPU ${percent(server.cpuPercent)}`,
          `Память ${percent(memoryShare(server))}`,
          `Диск ${percent(diskShare(server))}`,
        ];
  return (
    <span className={cn("flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums", className)}>
      {parts.map((part) => (
        <span key={part} className="whitespace-nowrap">{part}</span>
      ))}
      <span className="whitespace-nowrap">{age(server.checkedAt)}</span>
    </span>
  );
}

function hostingAndCost(server: Server): string | null {
  const parts = [server.hosting === "" ? null : server.hosting, costLine(server.monthlyCostRub)].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? null : parts.join(" · ");
}

function ServerRow({ server, onOpen }: { server: Server; onOpen: () => void }) {
  const tone = toneOf(server);
  const summary = server.description.split("\n")[0] ?? "";
  const money = hostingAndCost(server);
  return (
    <li className={cn(tone === "down" && "bg-destructive/5")}>
      <button
        type="button"
        className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none"
        onClick={onOpen}
      >
        <StatusDot tone={tone} className="mt-[7px]" />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-medium break-words">{server.name}</span>
            <StatusBadge tone={tone} />
          </span>
          {tone === "down" && server.errorText !== null ? (
            <span className="block text-sm break-words text-destructive">{server.errorText}</span>
          ) : null}
          {summary === "" ? null : (
            <span className="block truncate text-sm text-muted-foreground" title={summary}>
              {summary}
            </span>
          )}
          {money === null ? null : <span className="block text-sm break-words tabular-nums">{money}</span>}
          <MetricsLine server={server} className="pt-0.5" />
        </span>
        <Icon name="ChevronRight" aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

const KEY_HINT = "Вход root по SSH-ключу. Первый успешный заход запоминает ключ хоста.";

function KeyHint() {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={KEY_HINT}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-sm:size-11"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              setOpen((current) => !current);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden="true"
            >
              <circle cx="7.5" cy="15.5" r="4.5" />
              <path d="M10.7 12.3 21 2" />
              <path d="m16 7 3 3" />
              <path d="m18.5 4.5 2 2" />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">{KEY_HINT}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function GroupFilter({
  value,
  groups,
  counts,
  onChange,
}: {
  value: Filter;
  groups: Group[];
  counts: Map<Filter, number>;
  onChange: (value: Filter) => void;
}) {
  const options = [{ id: ALL, label: "Все" }, ...groups];
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (options.some((option) => option.id === next)) onChange(next);
      }}
    >
      <TabsList aria-label="Группа серверов" className="flex h-auto w-full flex-wrap gap-1">
        {options.map((option) => (
          <TabsTrigger
            key={option.id}
            value={option.id}
            className={cn(
              "min-w-0 flex-[1_1_calc(50%-0.25rem)] gap-1.5 whitespace-normal break-words @md:flex-[1_1_0]",
              TOUCH,
            )}
          >
            <span className="min-w-0">{option.label}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{counts.get(option.id) ?? 0}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function ImportPanel({
  candidates,
  picked,
  importing,
  onPick,
  onCommit,
  onCancel,
}: {
  candidates: Candidate[];
  picked: string[];
  importing: boolean;
  onPick: (alias: string, checked: boolean) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Импорт из ~/.ssh/config</h2>
        <p className="text-xs text-muted-foreground">Отметьте Host, которые нужно добавить. Пользователь станет root.</p>
      </div>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">В ~/.ssh/config нет Host с IdentityFile.</p>
      ) : null}
      <ul className="space-y-3">
        {candidates.map((candidate) => {
          const disabled = candidate.already || candidate.error !== null;
          return (
            <li key={candidate.alias}>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={picked.includes(candidate.alias)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onPick(candidate.alias, checked === true)}
                  aria-label={candidate.alias}
                />
                <span className="min-w-0">
                  <span className="font-medium break-words">{candidate.alias}</span>
                  <span className="block break-words text-muted-foreground">
                    {candidate.host === "" ? "хост не разобран" : `${candidate.host}:${candidate.port}`}
                    {candidate.configUser === "" ? "" : `, в конфиге ${candidate.configUser}`}
                    . {candidate.notice}
                  </span>
                  {candidate.already ? <span className="block text-muted-foreground">Уже в списке.</span> : null}
                  {candidate.error === null ? null : <span className="block text-destructive">{candidate.error}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className={TOUCH} disabled={importing || picked.length === 0} onClick={onCommit}>
          Добавить выбранные
        </Button>
        <Button type="button" variant="outline" className={TOUCH} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </Card>
  );
}

function AgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT);
    } catch {
      area.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Настроить через агента</DialogTitle>
          <DialogDescription>
            Вставьте этот текст агенту, у которого есть терминал на этой машине. Он найдёт серверы, спросит вас перед
            изменениями и добавит их сюда.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          ref={area}
          readOnly
          value={AGENT_PROMPT}
          rows={14}
          aria-label="Текст для агента"
          className="max-h-[50vh] font-mono text-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" className={TOUCH} onClick={() => void copy()}>
            <Icon name={copied ? "Check" : "Copy"} />
            {copied ? "Скопировано" : "Копировать"}
          </Button>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FleetList() {
  const navigate = useBbNavigate();
  const fleet = useFleet();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("key");
  const [addSshConfig, setAddSshConfig] = useState(false);
  const [scan, setScan] = useState<HostKeyScan | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [storedFilter, setFilterState] = useState<Filter>(readFilter);
  // A remembered group that no longer exists falls back to "all".
  const filter =
    storedFilter === ALL || fleet.groups.some((group) => group.id === storedFilter) ? storedFilter : ALL;

  const setFilter = (value: Filter) => {
    setFilterState(value);
    writeFilter(value);
  };

  const counts = useMemo(() => {
    const result = new Map<Filter, number>([[ALL, 0]]);
    for (const server of fleet.servers ?? []) {
      result.set(ALL, (result.get(ALL) ?? 0) + 1);
      result.set(server.group, (result.get(server.group) ?? 0) + 1);
    }
    return result;
  }, [fleet.servers]);

  const visible = useMemo(
    () => (fleet.servers ?? []).filter((server) => filter === ALL || server.group === filter),
    [fleet.servers, filter],
  );

  const clearPassword = () => {
    if (passwordRef.current !== null) passwordRef.current.value = "";
  };

  const closeForm = () => {
    clearPassword();
    setScan(null);
    setAdding(false);
  };

  const save = async () => {
    if (authMode === "password") {
      if ((passwordRef.current?.value ?? "") === "") {
        fleet.report(new Error("Введите пароль root."));
        return;
      }
      setPending(true);
      try {
        const result = await fleet.rpc.call("hostKeyScan", { host: draft.host, port: Number(draft.port) });
        setScan(result as HostKeyScan);
      } catch (cause) {
        fleet.report(cause);
      } finally {
        setPending(false);
      }
      return;
    }
    setPending(true);
    try {
      await fleet.rpc.call("create", draftPayload(draft));
      setDraft(emptyDraft());
      setAdding(false);
      fleet.refetch();
    } catch (cause) {
      fleet.report(cause);
    } finally {
      setPending(false);
    }
  };

  /** The only place the password is read: once, for one request, then the field is emptied. */
  const confirmHostKey = async () => {
    if (scan === null) return;
    const { identityPath: _unused, ...fields } = draftPayload(draft);
    setPending(true);
    try {
      await fleet.rpc.call("createWithPassword", {
        ...fields,
        scanId: scan.scanId,
        fingerprint: scan.fingerprint,
        password: passwordRef.current?.value ?? "",
        addSshConfig,
      });
      setDraft(emptyDraft());
      setAddSshConfig(false);
      closeForm();
      fleet.refetch();
    } catch (cause) {
      fleet.report(cause);
    } finally {
      clearPassword();
      setPending(false);
    }
  };

  const openImport = async () => {
    setImporting(true);
    try {
      const result = await fleet.rpc.call("importPreview", null);
      setCandidates(result.candidates as Candidate[]);
      setPicked([]);
    } catch (cause) {
      fleet.report(cause);
    } finally {
      setImporting(false);
    }
  };

  const commitImport = async () => {
    setImporting(true);
    try {
      await fleet.rpc.call("importCommit", { aliases: picked });
      setCandidates(null);
      fleet.refetch();
    } catch (cause) {
      fleet.report(cause);
    } finally {
      setImporting(false);
    }
  };

  const startAdding = () => {
    setDraft({ ...emptyDraft(), group: filter === ALL ? DEFAULT_GROUP : filter });
    setScan(null);
    setAdding(true);
  };

  const changeDraft = (next: Draft) => {
    if (next.host !== draft.host || next.port !== draft.port) setScan(null);
    setDraft(next);
  };

  return (
    <Shell>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="text-xl font-semibold">Все VPS</h1>
          <KeyHint />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className={TOUCH} onClick={() => (adding ? closeForm() : startAdding())}>
            <Icon name="Plus" />
            Добавить
          </Button>
          <Button type="button" size="sm" variant="outline" className={TOUCH} disabled={importing} onClick={() => void openImport()}>
            <Icon name="Download" />
            Импорт
          </Button>
          <Button type="button" size="sm" variant="outline" className={TOUCH} onClick={() => setAgentOpen(true)}>
            <Icon name="AiBrain01" />
            Настроить через агента
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={TOUCH}
            disabled={fleet.passInProgress || fleet.servers === null || fleet.servers.length === 0}
            onClick={() => {
              fleet.rpc.call("checkAll", null).then(fleet.refetch, fleet.report);
            }}
          >
            <Icon name="ArrowReloadHorizontal" />
            {fleet.passInProgress ? "Проверяем…" : "Проверить все"}
          </Button>
        </div>
      </header>
      <ErrorNote message={fleet.error} />
      {adding ? (
        <DraftForm
          title="Новый сервер"
          draft={draft}
          groups={fleet.groups}
          pending={pending}
          onChange={changeDraft}
          onGroupsChanged={fleet.refetch}
          onSubmit={() => void save()}
          onCancel={closeForm}
          auth={{
            mode: authMode,
            onMode: (mode) => {
              clearPassword();
              setScan(null);
              setAuthMode(mode);
            },
            passwordRef,
            addSshConfig,
            onAddSshConfig: setAddSshConfig,
            scan,
            onConfirm: () => void confirmHostKey(),
            onCancelScan: () => setScan(null),
          }}
        />
      ) : null}
      {candidates === null ? null : (
        <ImportPanel
          candidates={candidates}
          picked={picked}
          importing={importing}
          onPick={(alias, checked) =>
            setPicked((current) => (checked ? [...current, alias] : current.filter((item) => item !== alias)))
          }
          onCommit={() => void commitImport()}
          onCancel={() => setCandidates(null)}
        />
      )}
      {fleet.servers === null ? (
        fleet.error === null ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null
      ) : fleet.servers.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          <p>Серверов нет. Добавьте сервер формой, импортом из ~/.ssh/config или поручите это агенту.</p>
          <Button type="button" size="sm" variant="outline" className={TOUCH} onClick={() => setAgentOpen(true)}>
            <Icon name="AiBrain01" />
            Настроить через агента
          </Button>
        </Card>
      ) : (
        <>
          <GroupFilter value={filter} groups={fleet.groups} counts={counts} onChange={setFilter} />
          <CostSummary servers={visible} />
          {visible.length === 0 ? (
            <Card className="border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              В группе «{filter === ALL ? "Все" : groupLabel(fleet.groups, filter)}» серверов нет.
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {visible.map((server) => (
                  <ServerRow
                    key={server.id}
                    server={server}
                    onOpen={() => navigate.toPluginPanel("servers", { subPath: server.id })}
                  />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <AgentDialog open={agentOpen} onOpenChange={setAgentOpen} />
    </Shell>
  );
}

function FleetDetail({ id }: { id: string }) {
  const navigate = useBbNavigate();
  const fleet = useFleet();
  const server = fleet.servers?.find((item) => item.id === id) ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (server === null || editing) return;
    setDraft(draftFrom(server));
  }, [server, editing]);

  const save = async () => {
    setPending(true);
    try {
      await fleet.rpc.call("update", { id, ...draftPayload(draft) });
      setEditing(false);
      fleet.refetch();
    } catch (cause) {
      fleet.report(cause);
    } finally {
      setPending(false);
    }
  };

  const check = () => {
    setChecking(true);
    fleet.rpc
      .call("checkOne", { id })
      .then(fleet.refetch, fleet.report)
      .finally(() => setChecking(false));
  };

  const tone = server === null ? "unchecked" : toneOf(server);
  const money = server === null ? null : hostingAndCost(server);

  return (
    <Shell>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("-ml-2", TOUCH)}
        onClick={() => navigate.toPluginPanel("servers")}
      >
        <Icon name="ArrowLeft" />
        Все VPS
      </Button>
      {server === null && fleet.servers !== null ? (
        <Card className="border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Сервер не найден.</Card>
      ) : null}
      {server === null && fleet.servers === null && fleet.error === null ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : null}
      {server === null ? null : (
        <>
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <StatusDot tone={tone} />
              <h1 className="min-w-0 text-xl font-semibold break-words">{server.name}</h1>
              <StatusBadge tone={tone} />
              <GroupBadge label={groupLabel(fleet.groups, server.group)} />
            </div>
            {server.errorText === null ? null : (
              <p className={cn("text-sm break-words", server.status === "down" ? "text-destructive" : "text-muted-foreground")}>
                {server.errorText}
              </p>
            )}
            {server.description === "" ? null : (
              <p className="text-sm whitespace-pre-wrap break-words">{server.description}</p>
            )}
          </header>
          {money === null ? null : (
            <dl className="grid grid-cols-1 gap-2 @xs:grid-cols-3">
              <CostCard label="Хостинг" value={server.hosting === "" ? "—" : server.hosting} />
              <CostCard
                label="В месяц"
                value={server.monthlyCostRub === null ? "—" : `${rubles(server.monthlyCostRub)} ₽`}
              />
              <CostCard
                label="В час"
                value={server.monthlyCostRub === null ? "—" : `${hourly(server.monthlyCostRub)} ₽`}
              />
            </dl>
          )}
          <Card className="divide-y divide-border overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <h2 className="text-sm font-medium">Мощности</h2>
              <span className="text-xs text-muted-foreground">
                проверен {age(server.checkedAt)}
                {server.metricsAt !== null && server.metricsAt !== server.checkedAt ? `, цифры от ${age(server.metricsAt)}` : ""}
              </span>
            </div>
            {server.metricsAt === null ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Снимка ещё нет.</p>
            ) : (
              <>
                <CapacityTrack
                  label="Процессор"
                  percent={server.cpuPercent}
                  detail={server.cpuPercent === null ? "—" : `${server.cpuPercent.toFixed(0)}%`}
                />
                <CapacityTrack label="Память" percent={memoryShare(server)} detail={memoryLine(server)} />
                <CapacityTrack label="Диск" percent={diskShare(server)} detail={diskLine(server)} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 text-sm @md:grid-cols-3">
                  <Fact label="Нагрузка" value={loadLine(server)} />
                  <Fact label="Аптайм" value={uptimeLine(server.uptimeSeconds)} />
                  <Fact label="Ядра" value={server.cpuCount === null ? "—" : String(server.cpuCount)} />
                  <Fact label="Процессы" value={procsLine(server)} />
                  <Fact label="Swap" value={swapLine(server)} wide="two" />
                  <Fact label="Сеть" value={netLine(server)} wide="row" />
                </dl>
              </>
            )}
          </Card>
          <div className="space-y-1 text-sm">
            <p className="break-all">{server.user}@{server.host}:{server.port}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{server.identityPath}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className={TOUCH} disabled={checking} onClick={check}>
              <Icon name="ArrowReloadHorizontal" />
              {checking ? "Проверяем…" : "Проверить"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={TOUCH}
              aria-pressed={editing}
              onClick={() => setEditing((open) => !open)}
            >
              Изменить
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn("text-destructive hover:text-destructive", TOUCH)}
              onClick={() => {
                fleet.rpc.call("remove", { id }).then(() => navigate.toPluginPanel("servers"), fleet.report);
              }}
            >
              Удалить
            </Button>
          </div>
          <ErrorNote message={fleet.error} />
          {editing ? (
            <DraftForm
              title="Изменить сервер"
              draft={draft}
              groups={fleet.groups}
              pending={pending}
              onChange={setDraft}
              onGroupsChanged={fleet.refetch}
              onSubmit={() => void save()}
              onCancel={() => {
                setEditing(false);
                setDraft(draftFrom(server));
              }}
            />
          ) : null}
        </>
      )}
      {server === null ? <ErrorNote message={fleet.error} /> : null}
    </Shell>
  );
}

function diskParts(server: Pick<Server, "diskTotalBytes" | "diskUsedBytes">) {
  const total = server.diskTotalBytes;
  const used = server.diskUsedBytes;
  if (total === null || used === null) return { used, free: null, total };
  return { used, free: Math.max(0, total - used), total };
}

function diskLine(server: Pick<Server, "diskTotalBytes" | "diskUsedBytes">): string {
  const { used, free } = diskParts(server);
  if (used === null && free === null) return "—";
  return `${gib(used)} занято · ${gib(free)} свободно`;
}

function memoryShare(server: Server): number | null {
  const { used, total } = memoryParts(server);
  if (used === null || total === null || total <= 0) return null;
  return Math.min(100, (used / total) * 100);
}

function diskShare(server: Server): number | null {
  const { used, total } = diskParts(server);
  if (used === null || total === null || total <= 0) return null;
  return Math.min(100, (used / total) * 100);
}

function loadLine(server: Server): string {
  if (server.load1 === null) return "—";
  return [server.load1, server.load5, server.load15].map((value) => value === null ? "—" : value.toFixed(2)).join(" · ");
}

function uptimeLine(seconds: number | null): string {
  if (seconds === null) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days} д ${hours} ч`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

function procsLine(server: Server): string {
  if (server.procsRunning === null || server.procsTotal === null) return "—";
  return `${server.procsRunning} из ${server.procsTotal}`;
}

function swapLine(server: Server): string {
  if (server.swapTotalBytes === null || server.swapFreeBytes === null) return "—";
  const used = Math.max(0, server.swapTotalBytes - server.swapFreeBytes);
  if (server.swapTotalBytes === 0) return "нет";
  return `${gib(used)} занято · ${gib(server.swapFreeBytes)} свободно`;
}

function rate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return "—";
  if (bytesPerSecond < 1024) return `${bytesPerSecond} Б/с`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} КБ/с`;
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} МБ/с`;
}

function netLine(server: Server): string {
  if (server.netRxBps === null && server.netTxBps === null) return "—";
  return `↓ ${rate(server.netRxBps)} · ↑ ${rate(server.netTxBps)}`;
}

function CapacityTrack({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number | null;
  detail: string;
}) {
  const width = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const hot = percent !== null && percent >= 90;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{detail}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
        <div className={cn("h-full rounded-full", hot ? "bg-destructive" : "bg-foreground/70")} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/** `wide` facts hold long values: they take a full row and stay on one line. */
function Fact({ label, value, wide }: { label: string; value: string; wide?: "two" | "row" }) {
  return (
    <div className={cn("min-w-0", wide !== undefined && "col-span-2", wide === "row" && "@md:col-span-3")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-medium tabular-nums",
          wide === undefined ? "break-words" : "truncate whitespace-nowrap",
        )}
        title={wide === undefined ? undefined : value}
      >
        {value}
      </dd>
    </div>
  );
}

function useDownBadge() {
  const rpc = useRpc<typeof rpcContract>();
  const [count, setCount] = useState(0);
  const load = useCallback(() => {
    rpc.call("badge", null).then(
      (result) => setCount(result.count),
      () => setCount(0),
    );
  }, [rpc]);
  useEffect(() => {
    load();
  }, [load]);
  useRealtime(FLEET_CHANNEL, load);
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    if (connection === "connected") load();
  }, [connection, load]);
  if (count <= 0) return null;
  return { count, tone: "critical" as const, label: `${count} серверов не отвечают` };
}

function FleetPage({ subPath }: { subPath: string }) {
  const segment = subPath.split("/").find((part) => part !== "");
  if (segment === undefined) return <FleetList />;
  return <FleetDetail id={decodeURIComponent(segment)} />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "servers",
    title: "Серверы",
    icon: "ComputerCloud",
    path: "servers",
    component: FleetPage,
    experimental_useBadge: useDownBadge,
  });
});
