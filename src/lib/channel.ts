import { Bindings } from './auth';
import { OrderRow } from './db';

export interface ChannelRow {
  id: number;
  plugin: string;
  name: string;
  status: number;
  config: string; // JSON
  types: string; // JSON array
}

export interface ChannelCtx {
  env: Bindings;
  channel: { id: number; plugin: string; config: Record<string, string> };
  order: OrderRow;
  payType: string;
  siteUrl: string; // 本站对外地址, 用于拼上游回调
}

export interface CreateOrderResult {
  ok: boolean;
  msg?: string;
  payUrl?: string; // 跳转型: 上游收银台/支付链接
  qrContent?: string; // 展示型: 二维码内容 (收款码链接/转账链接)
  payAmount?: string; // 展示型: 实际应付金额(含尾数, 与订单金额可能不同)
  transferUrl?: string; // 支付宝转账 scheme (免输金额, 唤起APP)
}

export interface NotifyCtx {
  env: Bindings;
  channel: { id: number; plugin: string; config: Record<string, string> };
  req: Request;
  url: URL;
}

export interface NotifyResult {
  ok: boolean;
  respond: string; // 回给上游的响应体
  tradeNo?: string;
  money?: number; // 分
  apiTradeNo?: string;
}

export interface RefundCtx {
  env: Bindings;
  channel: { id: number; plugin: string; config: Record<string, string> };
  order: OrderRow;
}

export interface ChannelInput {
  name: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  hint?: string; // 字段下方的灰色说明, 用于告诉管理员去哪里拿这个值
}

export interface ChannelPlugin {
  id: string;
  name: string;
  types: string[];
  inputs: ChannelInput[];
  /** 配置引导: 后台渠道弹窗里展示的步骤说明 (每项一行, 支持简单 HTML) */
  help?: string[];
  createOrder(ctx: ChannelCtx): Promise<CreateOrderResult>;
  onNotify?(ctx: NotifyCtx): Promise<NotifyResult>;
  refund?(ctx: RefundCtx): Promise<{ ok: boolean; msg: string }>;
}

const registry = new Map<string, ChannelPlugin>();

export function registerPlugin(p: ChannelPlugin): void {
  registry.set(p.id, p);
}

export function getPlugin(id: string): ChannelPlugin | undefined {
  return registry.get(id);
}

export function listPlugins(): ChannelPlugin[] {
  return Array.from(registry.values());
}

export function parseChannel(row: ChannelRow): {
  id: number;
  plugin: string;
  name: string;
  status: number;
  config: Record<string, string>;
  types: string[];
} {
  let config: Record<string, string> = {};
  let types: string[] = [];
  try {
    config = JSON.parse(row.config || '{}');
  } catch {}
  try {
    types = JSON.parse(row.types || '[]');
  } catch {}
  return { id: row.id, plugin: row.plugin, name: row.name, status: row.status, config, types };
}

/** 对外站点地址: 优先 x-forwarded-proto/host (兼容反代), 否则请求 URL */
export function getExternalOrigin(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
  return `${proto}://${host}`;
}
