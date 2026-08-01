/**
 * DeepSeek 工具扩展：
 * 1. 峰谷计费时段提示（footer 常驻，每 30 秒刷新）
 * 2. /balance 查询账户余额（官方 API https://api.deepseek.com/user/balance）
 *
 * 高峰时段（北京时间 9:00~12:00、14:00~18:00）：[高峰计费中]
 * 其余时段：[普通计费中]
 */

import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";

const STATUS_ID = "deepseek-billing";

/** 非高峰用固定鲜绿（dark 主题的 success=#b5bd68 是橄榄绿，偏黄） */
const OFFPEAK_ANSI = "\x1b[38;2;74;222;128m"; // #4ade80

/** 高峰时段定义：北京时间 [9,12) 与 [14,18) */
const PEAK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [9, 12],
  [14, 18],
];

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

/** 返回北京时间的小时数（0-23），不受本机时区影响 */
function getBeijingHour(date: Date): number {
  for (const part of hourFormatter.formatToParts(date)) {
    if (part.type === "hour") return Number(part.value) % 24;
  }
  return date.getHours(); // 兜底（理论上不会走到）
}

function isPeak(date: Date): boolean {
  const hour = getBeijingHour(date);
  return PEAK_RANGES.some(([start, end]) => hour >= start && hour < end);
}

/** 距下一次高峰/非高峰切换的毫秒数（按北京时间整分扫描） */
function msUntilNextChange(date: Date): number {
  const stepMs = 60_000;
  const now = Date.now();
  let t = Math.floor(now / stepMs) * stepMs + stepMs;
  for (let i = 0; i < 24 * 60; i++, t += stepMs) {
    if (isPeak(new Date(t)) !== isPeak(date)) return t - now;
  }
  return 0;
}

/** 剩余时间格式：如 "1h23m" 或 "45m" */
function formatRemaining(ms: number): string {
  const mins = Math.ceil(ms / 60_000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h${mins % 60}m`;
  return `${mins}m`;
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;

  pi.on("session_start", (_event, ctx) => {
    const refresh = () => {
      const now = new Date();
      const peak = isPeak(now);
      const theme = ctx.ui.theme;
      const label = peak ? "[高峰计费中]" : "[普通计费中]";
      const remaining = formatRemaining(msUntilNextChange(now));
      const suffix = peak ? `距结束 ${remaining}` : `距高峰 ${remaining}`;
      const main = peak
        ? theme.fg("warning", label)
        : `${OFFPEAK_ANSI}${label}\x1b[39m`;
      ctx.ui.setStatus(STATUS_ID, main + theme.fg("dim", ` ${suffix}`));
    };

    refresh();
    clearInterval(timer);
    timer = setInterval(refresh, 30_000);
  });

  pi.on("session_shutdown", () => {
    clearInterval(timer);
    timer = undefined;
  });

  /** 查询 DeepSeek 账户余额（GET https://api.deepseek.com/user/balance） */
  pi.registerCommand("balance", {
    description: "查询 DeepSeek 账户余额",
    handler: async (_args, ctx) => {
      const auth = await ctx.modelRegistry.getProviderAuth("deepseek");
      const apiKey = auth?.auth?.apiKey;
      if (!apiKey) {
        ctx.ui.notify("未找到 DeepSeek API key，请先 /login deepseek 配置", "error");
        return;
      }

      let data: {
        is_available: boolean;
        balance_infos?: Array<{
          currency: string;
          total_balance: string;
          granted_balance: string;
          topped_up_balance: string;
        }>;
      };
      try {
        const res = await fetch("https://api.deepseek.com/user/balance", {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          ctx.ui.notify(`余额查询失败：HTTP ${res.status} ${res.statusText}`, "error");
          return;
        }
        data = (await res.json()) as typeof data;
      } catch (err) {
        ctx.ui.notify(
          `余额查询失败：${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
        return;
      }

      if (ctx.mode !== "tui") {
        const summary = (data.balance_infos ?? [])
          .map((i) => `${i.currency ?? "CNY"} ${i.total_balance}`)
          .join(" / ");
        ctx.ui.notify(
          `DeepSeek 余额：${summary}${data.is_available ? "" : "（账户不可用）"}`,
          "info"
        );
        return;
      }

      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(
          new DynamicBorder((s: string) => theme.fg("accent", s))
        );
        container.addChild(
          new Text(theme.fg("accent", theme.bold("DeepSeek 账户余额")), 1, 0)
        );

        for (const info of data.balance_infos ?? []) {
          const cur = (info.currency ?? "CNY").padEnd(4);
          container.addChild(
            new Text(
              theme.fg("dim", `  ${cur}总余额   `) +
                OFFPEAK_ANSI +
                info.total_balance +
                "\x1b[39m",
              0,
              0
            )
          );
          container.addChild(
            new Text(
              theme.fg("dim", `  ${cur}充值余额 `) +
                theme.fg("text", info.topped_up_balance) +
                theme.fg("dim", "  赠送余额 ") +
                theme.fg("text", info.granted_balance),
              0,
              0
            )
          );
        }

        container.addChild(
          new Text(
            theme.fg("dim", "  状态 ") +
              (data.is_available
                ? OFFPEAK_ANSI + "可用" + "\x1b[39m"
                : theme.fg("error", "不可用")),
            0,
            0
          )
        );
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", "  按任意键关闭"), 0, 0));
        container.addChild(
          new DynamicBorder((s: string) => theme.fg("accent", s))
        );

        return {
          render: (w) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: () => done(),
        };
      });
    },
  });
}
