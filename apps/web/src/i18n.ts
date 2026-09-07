/**
 * i18n foundation (Task 0005): zh-CN + en, browser-locale default.
 * Messages are plain records — a fuller catalog system can come later.
 */

export type Locale = 'en' | 'zh-CN';

export const LOCALES: readonly Locale[] = ['en', 'zh-CN'];

/** Human labels for the language switcher, shown in the language itself. */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  en: 'English',
  'zh-CN': '简体中文'
};

const LOCALE_STORAGE_KEY = 'miwifi-webui.locale';

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const languages = navigator.languages ?? [navigator.language];
  for (const lang of languages) {
    if (lang?.toLowerCase().startsWith('zh')) return 'zh-CN';
  }
  return 'en';
}

/**
 * Stored explicit choice wins; otherwise follow the browser locale.
 * Wrap storage access defensively — private-mode browsers throw on access.
 */
export function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'en' || stored === 'zh-CN') return stored;
  } catch {
    // Storage unavailable (private mode / blocked site data): fall through.
  }
  return detectLocale();
}

/** Persist an explicit language choice for future visits. */
export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Best-effort persistence; the switch still applies for this session.
  }
}

/** Locales the switcher cycles/hides — all supported values. */
export function isLocale(value: string): value is Locale {
  return value === 'en' || value === 'zh-CN';
}

const messages = {
  en: {
    'app.title': 'miwifi-webui',
    'app.tagline': 'Router administration and observability',
    'nav.dashboard': 'Dashboard',
    'nav.devices': 'Devices',
    'nav.network': 'Network',
    'nav.events': 'Events',
    'nav.investigations': 'Investigations',
    'nav.settings': 'Settings',
    'login.title': 'Sign in',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.error': 'Invalid username or password.',
    'login.bootstrap_title': 'Create administrator',
    'login.bootstrap_hint':
      'No administrator exists yet. Create one now — bootstrap is only available from this machine.',
    'login.bootstrap_submit': 'Create and sign in',
    'status.online': 'Online',
    'status.offline': 'Offline',
    'status.unknown': 'Unknown',
    'status.unreachable': 'Unreachable',
    'dashboard.router_health': 'Router health',
    'dashboard.devices_online': 'Devices online',
    'dashboard.recent_events': 'Recent events',
    'dashboard.no_routers': 'No router onboarded yet. Add one in Settings.',
    'dashboard.cpu': 'CPU',
    'dashboard.memory': 'Memory',
    'dashboard.temperature': 'Temperature',
    'dashboard.wan': 'WAN',
    'dashboard.traffic_overview': 'Traffic Overview',
    'dashboard.traffic_tab_total': 'Cumulative',
    'dashboard.traffic_tab_live': 'Live Rate',
    'dashboard.wan_traffic_total': 'WAN Total',
    'dashboard.live_throughput': 'Live Throughput',
    'dashboard.no_traffic_data': 'No device traffic recorded yet',
    'dashboard.traffic_down_rate': 'Down Speed',
    'dashboard.traffic_up_rate': 'Up Speed',
    'dashboard.traffic_total_rate': 'Total Speed',
    'dashboard.identified_traffic': 'Identified Traffic',
    'dashboard.client_types': 'Client Device Types',
    'dashboard.total_clients': 'Total Clients',
    'dashboard.wifi_clients': 'WiFi Clients',
    'dashboard.most_active_clients': 'Most Active Clients',
    'dashboard.throughput_history': 'Network Throughput & Active Clients',
    'dashboard.down_utilization': 'Down Utilization',
    'dashboard.up_utilization': 'Up Utilization',
    'dashboard.uptime': 'System Uptime',
    'dashboard.gateway_ip': 'Gateway IP',
    'dashboard.wan_ip': 'WAN IP',
    'dashboard.tab_all': 'All',
    'dashboard.tab_wired': 'Wired',
    'dashboard.tab_wireless': 'Wireless',
    'dashboard.tab_guest': 'Guest',
    'dashboard.range_1d': '1D',
    'dashboard.range_1w': '1W',
    'dashboard.range_1m': '1M',
    'dashboard.down': 'Down',
    'dashboard.up': 'Up',
    'dashboard.traffic': 'Traffic',
    'dashboard.customize_layout': 'Customize Layout',
    'dashboard.done_editing': 'Done',
    'dashboard.reset_layout': 'Reset Layout',
    'dashboard.layout_saved': 'Layout saved',
    'devices.downspeed': 'Down speed',
    'devices.upspeed': 'Up speed',
    'devices.download_total': 'Total Download',
    'devices.upload_total': 'Total Upload',
    'devices.traffic_total': 'Cumulative Traffic',
    'devices.total_data': 'Total Data',
    'devices.details': 'Device Details',
    'devices.connection': 'Connection Type',
    'devices.internet_control': 'Internet Access Control',
    'devices.title': 'Devices',
    'devices.name': 'Name',
    'devices.ip': 'IP',
    'devices.mac': 'MAC',
    'devices.status': 'Status',
    'devices.first_seen': 'First seen',
    'devices.last_seen': 'Last seen',
    'devices.empty': 'No devices observed yet.',
    'devices.back': 'Back to devices',
    'device.timeline': 'Presence timeline',
    'device.empty_timeline': 'No presence history recorded yet.',
    'events.title': 'Events',
    'events.empty': 'No events yet.',
    'events.presence': 'Presence',
    'settings.title': 'Settings',
    'settings.routers': 'Routers',
    'settings.router_add': 'Onboard router',
    'settings.router_host': 'Router address',
    'settings.router_username': 'Router username',
    'settings.router_password': 'Router password',
    'settings.router_compatibility': 'Compatibility',
    'settings.router_capabilities': 'Capabilities',
    'settings.change_password': 'Change password',
    'settings.current_password': 'Current password',
    'settings.new_password': 'New password',
    'settings.logout': 'Sign out',
    'common.loading': 'Loading…',
    'common.error': 'Something went wrong.',
    'common.save': 'Save',
    'presence.FIRST_SEEN': 'First seen',
    'presence.ONLINE': 'Came online',
    'presence.OFFLINE': 'Went offline',
    'investigations.title': 'Investigations',
    'investigations.question_label': 'Ask a question about your network',
    'investigations.submit': 'Investigate',
    'investigations.empty': 'No investigations yet.',
    'investigations.finding': 'Finding',
    'investigations.evidence': 'Evidence',
    'investigations.no_evidence': 'No evidence linked.',
  'investigations.alias_legend': 'Aliases in this finding',
  'investigations.alias': 'Alias',
  'investigations.original': 'Actual value',
    'investigations.disabled_hint': 'AI is disabled. Configure a provider (see .env.example).',
    'investigations.finding_failed': 'The investigation failed. Check provider availability and try again.',
    'investigations.placeholder': 'Why did the TV lose connectivity at 14:32?'
  },
  'zh-CN': {
    'app.title': 'miwifi-webui',
    'app.tagline': '路由器管理与观测',
    'nav.dashboard': '仪表盘',
    'nav.devices': '设备',
    'nav.network': '网络',
    'nav.events': '事件',
    'nav.investigations': '调查',
    'nav.settings': '设置',
    'login.title': '登录',
    'login.username': '用户名',
    'login.password': '密码',
    'login.submit': '登录',
    'login.error': '用户名或密码错误。',
    'login.bootstrap_title': '创建管理员',
    'login.bootstrap_hint': '尚无管理员账户。请立即创建 — 引导功能仅限本机使用。',
    'login.bootstrap_submit': '创建并登录',
    'status.online': '在线',
    'status.offline': '离线',
    'status.unknown': '未知',
    'status.unreachable': '不可达',
    'dashboard.router_health': '路由器健康',
    'dashboard.devices_online': '在线设备',
    'dashboard.recent_events': '最近事件',
    'dashboard.no_routers': '尚未添加路由器。请在设置中添加。',
    'dashboard.cpu': 'CPU',
    'dashboard.memory': '内存',
    'dashboard.temperature': '温度',
    'dashboard.wan': '外网 (WAN)',
    'dashboard.traffic_overview': '流量概览',
    'dashboard.traffic_tab_total': '累計用量',
    'dashboard.traffic_tab_live': '即時速率',
    'dashboard.wan_traffic_total': 'WAN 總用量',
    'dashboard.live_throughput': '即時總速率',
    'dashboard.no_traffic_data': '暫無設備流量數據',
    'dashboard.traffic_down_rate': '下載速率',
    'dashboard.traffic_up_rate': '上傳速率',
    'dashboard.traffic_total_rate': '總速率',
    'dashboard.identified_traffic': '已識別流量',
    'dashboard.client_types': '客戶端連線類型',
    'dashboard.total_clients': '客戶端總數',
    'dashboard.wifi_clients': 'Wi-Fi 頻段分佈',
    'dashboard.most_active_clients': '最活躍客戶端',
    'dashboard.throughput_history': '網路吞吐頻寬與在線設備趨勢',
    'dashboard.down_utilization': '下載頻寬負載',
    'dashboard.up_utilization': '上傳頻寬負載',
    'dashboard.uptime': '系統運行時間',
    'dashboard.gateway_ip': '網關 IP',
    'dashboard.wan_ip': '外網 (WAN) IP',
    'dashboard.tab_all': '全部',
    'dashboard.tab_wired': '有線',
    'dashboard.tab_wireless': '無線',
    'dashboard.tab_guest': '訪客',
    'dashboard.range_1d': '24 小時',
    'dashboard.range_1w': '7 天',
    'dashboard.range_1m': '30 天',
    'dashboard.down': '下載',
    'dashboard.up': '上傳',
    'dashboard.traffic': '總用量',
    'dashboard.customize_layout': '自訂版面',
    'dashboard.done_editing': '完成',
    'dashboard.reset_layout': '恢復預設佈局',
    'dashboard.layout_saved': '版面已儲存',
    'devices.downspeed': '即時下載速率',
    'devices.upspeed': '即時上傳速率',
    'devices.download_total': '累計下載量',
    'devices.upload_total': '累計上傳量',
    'devices.traffic_total': '累計流量統計',
    'devices.total_data': '總傳輸數據量',
    'devices.details': '設備詳細規格',
    'devices.connection': '連線介質',
    'devices.internet_control': '外網連線權限控制',
    'devices.title': '设备',
    'devices.name': '名称',
    'devices.ip': 'IP 地址',
    'devices.mac': 'MAC 地址',
    'devices.status': '状态',
    'devices.first_seen': '首次发现',
    'devices.last_seen': '最近在线',
    'devices.empty': '尚未发现设备。',
    'devices.back': '返回设备列表',
    'device.timeline': '在线时间线',
    'device.empty_timeline': '暂无在线记录。',
    'events.title': '事件',
    'events.empty': '暂无事件。',
    'events.presence': '在线状态',
    'settings.title': '设置',
    'settings.routers': '路由器',
    'settings.router_add': '添加路由器',
    'settings.router_host': '路由器地址',
    'settings.router_username': '路由器用户名',
    'settings.router_password': '路由器密码',
    'settings.router_compatibility': '兼容性',
    'settings.router_capabilities': '能力',
    'settings.change_password': '修改密码',
    'settings.current_password': '当前密码',
    'settings.new_password': '新密码',
    'settings.logout': '退出登录',
    'common.loading': '加载中…',
    'common.error': '出现错误。',
    'common.save': '保存',
    'presence.FIRST_SEEN': '首次发现',
    'presence.ONLINE': '已上线',
    'presence.OFFLINE': '已离线',
    'investigations.title': '网络调查',
    'investigations.question_label': '提出一个关于网络的问题',
    'investigations.submit': '开始调查',
    'investigations.empty': '暂无调查记录。',
    'investigations.finding': '调查结论',
    'investigations.evidence': '证据',
    'investigations.no_evidence': '未关联证据。',
  'investigations.alias_legend': '结论中的别名对照',
  'investigations.alias': '别名',
  'investigations.original': '实际值',
    'investigations.disabled_hint': 'AI 未启用。请先配置 provider（见 .env.example）。',
    'investigations.finding_failed': '调查失败。请检查 provider 是否可用后重试。',
    'investigations.placeholder': '为什么电视在 14:32 失去连接？'
  }
} as const;

export type MessageKey = keyof (typeof messages)['en'];

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages.en[key] ?? key;
}
