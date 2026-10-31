// Login and registration (transport §2.5 登录, §7.1 /login): a person is
// their email; a six-digit code mailed to it is the proof, good for ten
// minutes; the first login names the person and gives them a hosted agent
// (transport §6) whose first word waits in a DM. Pure: the rules and the
// words; the relay keeps the codes and sends the mail.

export const HOSTED_AGENT = "helper";
export const CODE_TTL_MS = 10 * 60_000;
export const CODES_PER_EMAIL = 3;
export const CODES_PER_IP_HOUR = 10;
export const CODE_RE = /^\d{6}$/;
/** The API's roads and the speakers' kinds, which no person may be named after. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(["me", "cards", "tasks", "tokens", "venues", "agents", "queues", "presence", "inbox", "trust", "grants", "quota", "wallet", "guests", "c", "ask", "g", "r", "login", "subscribe", "relay", "host", "platform", "guest", "person", "agent"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

export const normalizeEmail = (v: string): string => v.trim().toLowerCase();

export function emailFault(v: unknown): string | undefined {
  return typeof v === "string" && EMAIL_RE.test(normalizeEmail(v)) ? undefined : "要一个邮箱地址";
}

export function nameFault(v: unknown): string | undefined {
  if (typeof v !== "string" || v.trim() === "") return "新用户要取个名字";
  if (!NAME_RE.test(v)) return "名字不合法：字母、数字、_ 和 -，最多 64 个";
  if (RESERVED_NAMES.has(v.toLowerCase())) return "这个名字留给系统";
  return undefined;
}

export const codeMail = (code: string): { subject: string; text: string } => ({ subject: "Gemsbang 登录验证码", text: `你的验证码是 ${code}，10 分钟内有效。不是你在登录的话，不用管这封信。` });

export const LOGIN_WORDS = { sent: "验证码发到邮箱了，10 分钟内有效", wrong: "验证码不对或过期了", tooMany: "验证码发得太频繁，过十分钟再试", taken: "这个名字已经有人用了" } as const;

/** The hosted agent's first word in the DM a registration opens (transport §7.1: 注册后看到的第一个东西). */
export function welcomeText(person: string): string {
  return `你好 ${person}，我是 ${HOSTED_AGENT}，你的托管 agent，代你守在这里。想让我知道你的项目，就在电脑上运行 gemworks connect，把会话接过来；有人在你的分享卡上提问，我会按公开范围答，答不了的给你留言。`;
}
